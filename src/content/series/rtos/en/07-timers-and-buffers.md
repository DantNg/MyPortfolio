---
lesson: 7
lang: en
title: "Software Timers, Event Groups and Stream Buffers"
description: "The primitives you reach for after queues and mutexes: timers that are not what people expect, event groups for startup ordering, and the buffers built for one writer and one reader."
duration: "15 min"
tags: ["FreeRTOS", "Timers", "Stream buffer"]
---

## Software timers, and what they really are

The mental model people arrive with is wrong, and it causes real bugs. A FreeRTOS software
timer is **not** a hardware timer and **not** an interrupt. It is a callback executed by a
normal task — the *timer service task* — which the kernel creates for you when
`configUSE_TIMERS` is 1.

```c
#define configUSE_TIMERS             1
#define configTIMER_TASK_PRIORITY    3      /* the priority your callbacks run at   */
#define configTIMER_QUEUE_LENGTH     10     /* pending timer commands               */
#define configTIMER_TASK_STACK_DEPTH 256    /* shared by ALL timer callbacks        */
```

Three consequences follow directly:

1. **Your callback runs at `configTIMER_TASK_PRIORITY`.** If that is 3 and you have tasks at
   4 and 5, your "1 ms timer" is not going to fire in 1 ms when those tasks are busy.
2. **All callbacks share one stack.** A callback that calls `snprintf` can overflow the timer
   task and corrupt something else. Size `configTIMER_TASK_STACK_DEPTH` for the *worst*
   callback.
3. **A blocking callback stalls every other timer.** There is one service task; a callback
   that waits 50 ms on a mutex delays every timer behind it.

```c
static TimerHandle_t led_timer;

static void led_cb(TimerHandle_t xTimer)
{
    /* Must not block. Must be short. Runs on the timer task's stack. */
    HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
}

void app_init(void)
{
    led_timer = xTimerCreate("led",
                             pdMS_TO_TICKS(500),
                             pdTRUE,          /* auto-reload            */
                             (void *)0,       /* timer ID — see below   */
                             led_cb);
    configASSERT(led_timer);
    xTimerStart(led_timer, 0);
}
```

### The API is a command queue

This is the detail that surprises people: `xTimerStart`, `xTimerStop`, `xTimerReset` and
`xTimerChangePeriod` do not act immediately. They **post a command** to the timer task's
queue. The second parameter is how long to block if that queue is full:

```c
xTimerStart(t, 0);                     /* try to queue, return immediately */
xTimerStart(t, pdMS_TO_TICKS(10));     /* wait up to 10 ms for queue space */
```

If the timer task has a lower priority than the caller, the command sits in the queue until
the timer task runs. So this does **not** work the way it reads:

```c
xTimerStop(t);
/* the timer may STILL fire once here — the stop has not been processed yet */
```

If ordering matters, either raise `configTIMER_TASK_PRIORITY` above the caller, or guard the
callback with a flag you set before stopping.

### The two genuinely useful patterns

**Debouncing** — a one-shot timer restarted on every edge:

```c
static void debounce_cb(TimerHandle_t t)
{
    /* 20 ms of quiet has passed — the level is now stable */
    if (gpio_read(BUTTON) == PRESSED) {
        cmd_t c = { .id = CMD_BUTTON_PRESS };
        xQueueSend(cmd_q, &c, 0);
    }
}

void BUTTON_IRQHandler(void)
{
    BaseType_t woken = pdFALSE;
    xTimerResetFromISR(debounce_timer, &woken);   /* restart the 20 ms window */
    portYIELD_FROM_ISR(woken);
}
```

Every bounce pushes the deadline out; the callback only runs once the input has been quiet.
Twelve lines and no delay loops anywhere.

**Watchdog per task** — one timer each, reset by the task it watches:

```c
static void task_stuck_cb(TimerHandle_t t)
{
    uint32_t task_id = (uint32_t)(uintptr_t)pvTimerGetTimerID(t);
    log_fault(FAULT_TASK_HUNG, task_id);
    NVIC_SystemReset();
}

/* inside each monitored task's loop */
xTimerReset(my_watchdog, 0);
```

The timer ID is how one callback serves several timers — cast a small integer or a pointer
into it and read it back with `pvTimerGetTimerID()`.

## Event groups — waiting for combinations

A queue signals one thing. An event group is 24 independent bits (8 are reserved for kernel
use), and a task can block until any or all of a set are raised.

The canonical use is startup ordering, which is otherwise a mess of flags and polling:

```c
static EventGroupHandle_t sys_events;

#define EV_CLOCKS_OK   (1 << 0)
#define EV_NVM_LOADED  (1 << 1)
#define EV_SENSOR_OK   (1 << 2)
#define EV_NET_UP      (1 << 3)
#define EV_ALL_READY   (EV_CLOCKS_OK | EV_NVM_LOADED | EV_SENSOR_OK | EV_NET_UP)

/* each subsystem raises its own bit when it finishes initialising */
void sensor_init_done(void) { xEventGroupSetBits(sys_events, EV_SENSOR_OK); }

/* the application waits for everything, with a bounded timeout */
static void app_task(void *arg)
{
    EventBits_t bits = xEventGroupWaitBits(
            sys_events,
            EV_ALL_READY,
            pdFALSE,                     /* do not clear on exit          */
            pdTRUE,                      /* wait for ALL bits             */
            pdMS_TO_TICKS(10000));

    if ((bits & EV_ALL_READY) != EV_ALL_READY) {
        /* Report exactly which subsystem never came up — this is the payoff */
        if (!(bits & EV_SENSOR_OK)) log_fault(FAULT_SENSOR_TIMEOUT, 0);
        if (!(bits & EV_NET_UP))    log_fault(FAULT_NET_TIMEOUT, 0);
        enter_degraded_mode();
    }

    run_normally();
}
```

That diagnostic — naming the subsystem that failed to start — is worth the whole primitive.
The flag-and-poll version usually just prints "init failed".

Two more things worth knowing:

**`xEventGroupSync()`** is a rendezvous: every participant raises its bit and blocks until all
of them have. It is how you make several tasks start a measurement on the same tick.

```c
/* all three tasks reach this line, then all three continue together */
xEventGroupSync(sync_group, MY_BIT, ALL_BITS, portMAX_DELAY);
```

**Clearing is not atomic with waiting** in the general case. If two tasks wait on the same
bit with `xClearOnExit = pdTRUE`, only one of them will see it. For a one-to-many broadcast,
leave the bit set and let each consumer clear its own separate bit.

## Stream buffers — the UART pattern

![Queue vs stream vs message buffer](/MyPortfolio/images/rtos/buffers.svg)

A queue moves fixed-size items and takes a kernel lock on every operation. For a byte stream
from a UART that is both awkward and slower than it needs to be.

A **stream buffer** is optimised for exactly **one writer and one reader**, and because of
that constraint it needs no critical section at all in the common path:

```c
static StreamBufferHandle_t uart_rx;

void app_init(void)
{
    /* 512-byte buffer; wake the reader once 1 byte is available */
    uart_rx = xStreamBufferCreate(512, 1);
    configASSERT(uart_rx);
}

/* producer: the ISR, writing whatever arrived */
void USART2_IRQHandler(void)
{
    uint8_t b = USART2->RDR;
    BaseType_t woken = pdFALSE;
    xStreamBufferSendFromISR(uart_rx, &b, 1, &woken);
    portYIELD_FROM_ISR(woken);
}

/* consumer: one task, taking as much as is there */
static void comms_task(void *arg)
{
    uint8_t chunk[64];
    for (;;) {
        size_t n = xStreamBufferReceive(uart_rx, chunk, sizeof(chunk), portMAX_DELAY);
        for (size_t i = 0; i < n; i++) parser_feed(&parser, chunk[i]);
    }
}
```

The **trigger level** (the second argument to create) is the tuning knob. Set it to 1 and the
task wakes on every byte — responsive, many context switches. Set it to 32 and the task wakes
once per 32 bytes — far fewer switches, but a partial frame sits in the buffer until more
arrives, so pair a larger trigger level with a receive timeout:

```c
/* wake at 32 bytes OR after 10 ms, whichever comes first */
size_t n = xStreamBufferReceive(uart_rx, chunk, sizeof(chunk), pdMS_TO_TICKS(10));
```

That combination — a trigger level for throughput and a timeout for latency — is how you get
both on a busy link.

## Message buffers — keeping frame boundaries

A stream buffer loses the notion of "where one message ends". A **message buffer** prepends a
4-byte length to each write, so reads come back one whole message at a time:

```c
static MessageBufferHandle_t frame_buf;
frame_buf = xMessageBufferCreate(1024);

/* writer: one complete frame per call */
xMessageBufferSend(frame_buf, frame, frame_len, 0);

/* reader: gets exactly one frame, whatever its length */
uint8_t rx[256];
size_t len = xMessageBufferReceive(frame_buf, rx, sizeof(rx), portMAX_DELAY);
handle_frame(rx, len);
```

Two practical notes: the 4-byte header counts against your buffer size, so a 1024-byte buffer
holds ten 100-byte messages, not ten and a bit. And a message longer than the buffer can never
be sent — `xMessageBufferSend` will block forever waiting for space that cannot exist. Check
your maximum frame size against the buffer at design time.

## Choosing, one more time

| You have | Use |
| --- | --- |
| Structs of one type, possibly several senders | queue |
| One ISR waking one task, no data | task notification |
| Bytes from a UART/DMA to one task | **stream buffer** |
| Variable-length frames, one reader | **message buffer** |
| Several conditions to wait on at once | **event group** |
| Periodic housekeeping, debouncing, timeouts | **software timer** |
| Anything with hard timing | hardware timer + ISR |

The last row is the one to remember. A software timer is a convenience, not a real-time
mechanism.

## Check yourself

1. At what priority does a software timer callback run, and why does that matter?
2. Why might a timer fire once *after* you called `xTimerStop()`?
3. What constraint makes a stream buffer cheaper than a queue?
4. What does a larger trigger level buy, and what does it cost?

## Next

Lesson 8: making all of this run on a battery. Tickless idle, measuring current properly, and
the design decisions that separate a two-day device from a two-year one.
