---
lesson: 4
lang: en
title: "Mutexes, Semaphores and the Bugs They Cause"
description: "Race conditions, the difference between a mutex and a binary semaphore, deadlock, priority inversion — and the small set of rules that avoid all of them."
duration: "16 min"
tags: ["RTOS", "Mutex", "Priority inversion"]
---

## The bug that started it all

```c
static uint32_t counter;      /* shared by two tasks */

void task_a(void *p) { for (;;) { counter++; vTaskDelay(1); } }
void task_b(void *p) { for (;;) { counter++; vTaskDelay(1); } }
```

`counter++` is not one operation. On Cortex-M it compiles to three:

```asm
LDR  r0, [counter]     ; read
ADDS r0, r0, #1        ; modify
STR  r0, [counter]     ; write
```

If the scheduler switches between the `LDR` and the `STR`, one increment is lost. The
window is nanoseconds, so it works perfectly on your desk and fails once a week in the
field. That is a **race condition**, and it applies to anything that is not a single
aligned word-sized access: 64-bit values, structs, linked lists, a peripheral that needs
two register writes.

Three ways out, in order of preference:

1. **Do not share.** Give the data one owner and use a queue (lesson 3). Most cases.
2. **Make the access atomic.** For a single flag, `volatile` plus a naturally-aligned
   32-bit write is enough on Cortex-M — but `volatile` alone does **not** make `x++` safe.
3. **Use a mutex.** When you genuinely have a shared resource: an I²C bus, a display, a
   filesystem.

## Critical sections — the blunt instrument

The cheapest protection is to stop the scheduler or the interrupts:

```c
taskENTER_CRITICAL();      /* disables interrupts up to configMAX_SYSCALL_INTERRUPT_PRIORITY */
shared_struct.a = 1;
shared_struct.b = 2;
taskEXIT_CRITICAL();
```

This is correct and fast, and it is also a hammer: while inside, **nothing else runs** —
not other tasks, not most interrupts. Your whole system's worst-case latency grows by the
length of your longest critical section.

Rules: no loops, no function calls you have not read, no logging, no blocking API. A few
assignments. Tens of instructions, not thousands.

A lighter variant suspends only the scheduler, leaving interrupts alive:

```c
vTaskSuspendAll();
/* other tasks cannot run; ISRs still can */
xTaskResumeAll();
```

Use this when you need mutual exclusion against tasks but must not delay interrupts.

## Mutex — for protecting a resource

```c
static SemaphoreHandle_t i2c_mutex;

void i2c_init(void)
{
    i2c_mutex = xSemaphoreCreateMutex();
    configASSERT(i2c_mutex);
}

int sensor_read(uint8_t reg, uint8_t *out)
{
    if (xSemaphoreTake(i2c_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return -ETIMEDOUT;        /* always have a timeout, always handle it */
    }

    int rc = i2c_transfer(reg, out);

    xSemaphoreGive(i2c_mutex);    /* every path must reach this */
    return rc;
}
```

Two properties make a mutex different from a semaphore:

- **Ownership.** Only the task that took it may give it back. FreeRTOS asserts if another
  one tries.
- **Priority inheritance.** The reason mutexes exist — see below.

Mutexes are also **recursive** if you use `xSemaphoreCreateRecursiveMutex()`, letting the
same task take it several times. Convenient, and usually a sign that your layering is
muddled.

> **Never take a mutex from an ISR.** There is no `xSemaphoreTakeFromISR()` for mutexes at
> all, precisely because an ISR has no task identity to inherit priority to.

## Priority inversion

![Priority inversion](/MyPortfolio/images/rtos/priority-inversion.svg)

Three tasks, priorities Low, Medium, High:

1. **L** takes the I²C mutex and starts a transfer.
2. **H** wakes up, wants the same mutex, and blocks. Reasonable so far — H waits for L.
3. **M** — which needs no mutex at all — becomes ready and preempts L, because M outranks L.

Now **H is waiting on M**, a task it outranks, indirectly and for an unbounded time. M could
run for a hundred milliseconds. H's deadline is gone, and no amount of priority analysis
predicts it.

This is not theoretical. It nearly ended the Mars Pathfinder mission in 1997: the lander
kept resetting because a high-priority bus-management task was blocked by exactly this
pattern.

**The fix is priority inheritance**, and FreeRTOS mutexes implement it: while H is blocked
on the mutex L holds, the kernel temporarily raises L to H's priority. M can no longer
preempt L, L finishes quickly, releases the mutex, and drops back down.

This is precisely why you must use `xSemaphoreCreateMutex()` and not
`xSemaphoreCreateBinary()` for resource protection. They look interchangeable in the API.
They are not.

## Binary and counting semaphores — for signalling

A semaphore has no owner, which makes it wrong for locking but right for signalling:

```c
/* binary semaphore: "an event happened" */
static SemaphoreHandle_t data_ready;
data_ready = xSemaphoreCreateBinary();

/* in an ISR */
BaseType_t woken = pdFALSE;
xSemaphoreGiveFromISR(data_ready, &woken);
portYIELD_FROM_ISR(woken);

/* in a task */
xSemaphoreTake(data_ready, portMAX_DELAY);
process_data();
```

A **counting** semaphore tracks how many instances of something are available:

```c
/* three DMA channels */
static SemaphoreHandle_t dma_slots;
dma_slots = xSemaphoreCreateCounting(3, 3);   /* max 3, start with 3 free */

xSemaphoreTake(dma_slots, portMAX_DELAY);     /* wait for a free channel */
use_a_dma_channel();
xSemaphoreGive(dma_slots);                    /* release it */
```

Summary of the distinction, which is the most commonly confused thing in RTOS work:

| | Mutex | Binary semaphore |
| --- | --- | --- |
| Purpose | protect a resource | signal an event |
| Owner | yes — only the taker gives | no — anyone can give |
| Priority inheritance | yes | no |
| Usable from ISR | no | yes (`GiveFromISR`) |
| Initial state | available | empty |

## Deadlock

Two tasks, two mutexes, taken in different orders:

```c
/* task A */                        /* task B */
take(mutex_i2c);                    take(mutex_display);
take(mutex_display);                take(mutex_i2c);
   ... work ...                        ... work ...
```

If A gets the I²C mutex and B gets the display mutex at the same moment, both block forever.
Everything below them still runs, which is what makes this so confusing to diagnose: the
system is not dead, just two tasks are.

Three rules that prevent it:

1. **Always take multiple locks in the same global order.** Write the order down in a header
   and enforce it in review. This single rule eliminates the classic case.
2. **Never block while holding a lock.** No `vTaskDelay`, no queue receive with a timeout,
   no waiting on another semaphore.
3. **Always use a timeout, and handle the failure.** `portMAX_DELAY` on a mutex turns a
   recoverable timeout into a hang.

Related and equally nasty: **holding a lock too long.** A mutex held across a 50 ms flash
write makes every other user of that resource miss its deadline. The fix is usually to copy
what you need under the lock and do the slow work outside it.

## Event groups — waiting for several things

When a task must wait for a combination of conditions:

```c
static EventGroupHandle_t sys_events;
#define EV_WIFI_UP   (1 << 0)
#define EV_TIME_SYNC (1 << 1)
#define EV_CONFIG_OK (1 << 2)

sys_events = xEventGroupCreate();

/* various tasks set bits as they finish */
xEventGroupSetBits(sys_events, EV_WIFI_UP);

/* a task that needs all three before it can start */
EventBits_t bits = xEventGroupWaitBits(
        sys_events,
        EV_WIFI_UP | EV_TIME_SYNC | EV_CONFIG_OK,
        pdFALSE,                 /* do not clear on exit  */
        pdTRUE,                  /* wait for ALL of them  */
        pdMS_TO_TICKS(30000));

if ((bits & (EV_WIFI_UP | EV_TIME_SYNC | EV_CONFIG_OK)) == 0) {
    /* timed out — report which subsystem never came up */
}
```

This replaces a tangle of flags and polling with one blocking call, and it is the cleanest
way to express startup ordering.

## The rules, condensed

Print these and stick them above your desk:

1. Prefer a queue over a shared variable.
2. Mutex for resources, semaphore for events. Never swap them.
3. Every lock take has a timeout, and every timeout is handled.
4. Never block while holding a lock.
5. Take multiple locks in one documented global order.
6. Keep critical sections to a handful of instructions.
7. Never take a mutex in an ISR.

## Check yourself

1. Why is `counter++` unsafe even when `counter` is `volatile`?
2. What exactly does priority inheritance fix, and which primitive provides it?
3. Give a two-task, two-mutex sequence that deadlocks, and the one-line rule that prevents it.
4. Which of a mutex or a binary semaphore can be given from an ISR, and why the other cannot?

## Next

Lesson 5: interrupts. Why almost every ISR you write should be three lines long, what the
`FromISR` suffix really changes, and the Cortex-M priority setting that silently breaks
everything if you get it wrong.
