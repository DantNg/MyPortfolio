---
lesson: 3
lang: en
title: "Queues — Passing Messages Instead of Sharing Memory"
description: "Why the queue is the default answer for inter-task communication, how blocking receives replace polling, and the design rule that removes most locking from your code."
duration: "14 min"
tags: ["RTOS", "Queue", "Concurrency"]
---

## Two ways for tasks to communicate

**Share memory:** a global that one task writes and another reads. Simple, fast, and the
source of nearly every concurrency bug you will ever debug — because a context switch can
land in the middle of an update.

**Pass messages:** one task hands a *copy* of some data to another through a queue. The
kernel handles the locking, the waiting, and the wake-up.

The rule that saves the most pain:

> Prefer passing messages. Reach for shared memory plus a mutex only when the data is too
> large to copy, and even then, pass a pointer through a queue instead if you can.

Most of lesson 4 (semaphores, mutexes, priority inversion) is about the problems you get
when you cannot follow that rule. Queues let you skip them.

## The basic queue

A FreeRTOS queue is a fixed-length FIFO of fixed-size items. Items are **copied in and
copied out** — the sender can reuse its buffer immediately after `xQueueSend` returns.

```c
typedef struct {
    uint32_t timestamp_ms;
    int16_t  temp_c_x10;
    uint8_t  sensor_id;
} sample_t;

static QueueHandle_t sample_q;

void app_init(void)
{
    sample_q = xQueueCreate(10, sizeof(sample_t));   /* 10 items */
    configASSERT(sample_q != NULL);                  /* NULL = heap exhausted */
}
```

Producer:

```c
static void sensor_task(void *arg)
{
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        sample_t s = {
            .timestamp_ms = xTaskGetTickCount() * portTICK_PERIOD_MS,
            .temp_c_x10   = read_temp_x10(),
            .sensor_id    = 0,
        };

        if (xQueueSend(sample_q, &s, 0) != pdPASS) {
            dropped_samples++;          /* queue full — never block a control loop */
        }

        vTaskDelayUntil(&last, pdMS_TO_TICKS(10));
    }
}
```

Consumer:

```c
static void logger_task(void *arg)
{
    sample_t s;
    for (;;) {
        if (xQueueReceive(sample_q, &s, portMAX_DELAY) == pdPASS) {
            write_to_flash(&s);         /* slow — but nobody is waiting on us */
        }
    }
}
```

Look at what this bought you:

- The sensor task is never delayed by flash writes.
- The logger task uses **zero CPU** between samples.
- There is **no mutex anywhere**, and no possible torn read of `sample_t`.
- The queue absorbs bursts up to ten items deep.

## The timeout parameter is a design decision

Both `xQueueSend` and `xQueueReceive` take a block time, and choosing it deliberately is
most of the skill:

| Timeout | Meaning | Use for |
| --- | --- | --- |
| `0` | try, return immediately | producers that must never stall — control loops, ISR-adjacent code |
| `pdMS_TO_TICKS(n)` | wait up to n ms | RPC-style request/response, bounded waits |
| `portMAX_DELAY` | wait forever | consumer tasks with nothing else to do |

The mistake to avoid: `portMAX_DELAY` on a **send**. If the consumer dies or stalls, your
producer blocks forever and its deadline is gone. Sending with timeout `0` and counting
failures gives you a health metric instead of a hang.

> A queue that is regularly full is telling you something real: the consumer is too slow,
> its priority is too low, or the queue is too short for the burst size. Do not "fix" it by
> making the queue enormous — that only delays the failure and hides it.

## Sizing a queue

Two questions:

1. **What is the burst?** If the producer can emit 5 items back-to-back before the consumer
   gets scheduled, the queue needs at least 5 slots.
2. **What does it cost?** `length × item_size` bytes, allocated once from the FreeRTOS heap.
   Ten `sample_t` (8 bytes each) is 80 bytes plus ~80 bytes of overhead. Cheap.

For a producer at rate `R` and a consumer that may be delayed by `T`, a starting point is
`length = R × T × 1.5`. Then instrument it:

```c
UBaseType_t waiting = uxQueueMessagesWaiting(sample_q);
UBaseType_t free_slots = uxQueueSpacesAvailable(sample_q);
```

Log the peak `waiting` during a soak test. If it never exceeds 3, your queue of 10 is fine
and you can cut it. If it touches 10, you are dropping data.

## Passing large data: send a pointer

Copying a 1 kB buffer through a queue costs a 1 kB memcpy inside a critical section. For
anything large, pass a pointer — but you must then answer "who owns this memory?"

The pattern that works is a **pool of buffers**, with ownership transferred through the
queue:

```c
#define POOL_N 4
static uint8_t   pool[POOL_N][512];
static QueueHandle_t free_q;      /* holds pointers to unused buffers  */
static QueueHandle_t full_q;      /* holds pointers to filled buffers  */

void pool_init(void)
{
    free_q = xQueueCreate(POOL_N, sizeof(uint8_t *));
    full_q = xQueueCreate(POOL_N, sizeof(uint8_t *));
    for (int i = 0; i < POOL_N; i++) {
        uint8_t *p = pool[i];
        xQueueSend(free_q, &p, 0);
    }
}

/* producer */
uint8_t *buf;
if (xQueueReceive(free_q, &buf, 0) == pdPASS) {
    fill(buf, 512);
    xQueueSend(full_q, &buf, 0);      /* ownership moves to the consumer */
}

/* consumer */
uint8_t *buf;
xQueueReceive(full_q, &buf, portMAX_DELAY);
process(buf, 512);
xQueueSend(free_q, &buf, 0);          /* ownership returns to the pool */
```

No `malloc` after startup, no fragmentation, a hard bound on memory use, and exactly one
owner of each buffer at any moment. This is the standard shape for DMA-fed audio, camera
frames, and network packets.

## Task notifications — the fast path

If you only need to signal *one specific task*, a task notification is dramatically cheaper
than a queue: no separate object, no allocation, roughly 45% faster, and each task has a
built-in 32-bit value.

```c
/* signal */
xTaskNotifyGive(logger_handle);

/* wait */
ulTaskNotifyTake(pdTRUE, portMAX_DELAY);   /* pdTRUE = clear on exit, like a binary sem */
```

Or carry a small payload:

```c
xTaskNotify(handle, EVENT_BIT_DATA_READY, eSetBits);

uint32_t bits;
xTaskNotifyWait(0, UINT32_MAX, &bits, portMAX_DELAY);
if (bits & EVENT_BIT_DATA_READY) { ... }
```

The limitation is in the name: it notifies **one** task, and there is only one notification
value per task, so two unrelated senders can clobber each other. Use notifications for the
ISR-to-single-task path (lesson 5), and queues when there is real data or more than one
consumer.

## Choosing the right primitive

| Need | Use |
| --- | --- |
| Send data, one or many producers/consumers | **Queue** |
| Signal one specific task, no data | **Task notification** |
| Signal a task from an ISR, no data | **Task notification (FromISR)** |
| Wait for several conditions at once | **Event group** |
| Protect a shared resource | **Mutex** (lesson 4) |
| Count available instances of a resource | **Counting semaphore** (lesson 4) |
| Several producers into one stream of bytes | **Stream buffer** |
| Variable-length messages | **Message buffer** |

Stream and message buffers are worth knowing: they are optimized for a single writer and a
single reader, which is exactly the UART-ISR-to-task case, and they avoid the fixed item
size of a queue.

## A worked design

A device reads a sensor at 100 Hz, shows a value on screen at 10 Hz, and logs to flash in
1 kB blocks. Three tasks, two queues, no mutex:

```c
/* 100 Hz, highest priority: never blocked by anything slow  */
sensor_task:
    read sensor
    xQueueSend(display_q, &value, 0)      /* overwrite-style, depth 1  */
    xQueueSend(log_q,     &value, 0)      /* depth 32, absorbs bursts  */
    vTaskDelayUntil(10 ms)

/* 10 Hz, low priority                                       */
display_task:
    xQueueReceive(display_q, &v, portMAX_DELAY)
    draw(v)

/* event driven, medium priority                             */
log_task:
    xQueueReceive(log_q, &v, portMAX_DELAY)
    append to RAM block
    if block full: write_flash(block)      /* 20 ms, blocks nobody     */
```

For `display_q`, a depth-1 queue with `xQueueOverwrite()` is exactly right: the display only
ever wants the *latest* value, and an older one is worthless.

```c
xQueueOverwrite(display_q, &value);   /* always succeeds, replaces the item */
```

## Check yourself

1. Why does a queue not need a mutex around it?
2. When is `portMAX_DELAY` the wrong timeout on a send?
3. What does a persistently full queue actually tell you?
4. When would you use a task notification instead of a queue?

## Next

Lesson 4: what to do when messages are not enough. Mutexes, semaphores, the deadlock and
priority-inversion bugs each one enables, and the rules that keep you out of both.
