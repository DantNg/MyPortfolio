---
lesson: 1
lang: en
title: "When a Superloop Stops Being Enough"
description: "What an RTOS actually buys you, what it costs, and the honest test for whether your project needs one at all."
duration: "12 min"
tags: ["RTOS", "FreeRTOS", "Real-time"]
---

## The question nobody asks first

"Should we use an RTOS?" usually gets answered by habit rather than analysis. So start
with the thing an RTOS is actually for.

An RTOS does not make your code faster. It does not make it smaller. What it gives you is
**bounded latency for the work that matters**, by letting you say *this is more important
than that* and having the machine enforce it.

## Where the superloop breaks

![Superloop vs RTOS](/MyPortfolio/images/rtos/superloop-vs-rtos.svg)

A superloop is fine, and for a lot of products it is the right answer:

```c
while (1) {
    read_sensor();       /*  2 ms */
    update_display();    /* 40 ms */
    handle_uart();       /*  1 ms */
}
```

The problem is arithmetic. Your worst-case latency for `handle_uart()` is the sum of
everything else in the loop — 42 ms here. If the UART peer sends a frame every 20 ms and
your receive buffer holds one frame, you drop data. Not sometimes: predictably.

You can fight this without an RTOS, and people do:

- **Split the slow work into a state machine** so each pass through the loop is short. This
  works and is often the right fix. It also turns readable sequential code into a pile of
  `switch` statements with manual context saved in globals.
- **Do more in interrupts.** Also works, until two ISRs need to share data and you discover
  concurrency the hard way.
- **Add a scheduler-lite** — a table of function pointers with periods. Congratulations,
  you have written a cooperative RTOS. That is a legitimate choice, but be honest that you
  now own and must debug scheduler code.

The RTOS answer is different: keep the code sequential and readable, and let a scheduler
decide who runs.

```c
void uart_task(void *p)
{
    for (;;) {
        xQueueReceive(rx_queue, &msg, portMAX_DELAY);   /* sleeps here */
        handle(&msg);                                    /* runs within ~µs of arrival */
    }
}
```

That task consumes **zero CPU** while waiting, and preempts the display task the moment a
message lands.

## What "real-time" means

Real-time does not mean fast. It means **the deadline is part of the specification, and
missing it is a failure**.

| | Meaning | Example |
| --- | --- | --- |
| Hard real-time | a missed deadline is a system failure | motor commutation, airbag |
| Firm real-time | late output is worthless but not dangerous | sensor fusion frame |
| Soft real-time | late is degraded but tolerable | UI redraw, logging |

A 200 MHz MCU that occasionally takes 50 ms to respond is worse for hard real-time than an
8 MHz one that always responds in 2 ms. **Predictability beats speed.**

This is also why the phrase "FreeRTOS is real-time" is only half true. FreeRTOS gives you
the *mechanism* — priority-based preemption with bounded scheduler operations. Whether your
system meets deadlines depends on your priorities, your ISR lengths, and your locking. The
kernel can only enforce what you designed.

## What it costs

Be clear-eyed. An RTOS is not free:

- **RAM.** Every task needs its own stack — typically 256 B to 2 kB each — plus a TCB
  (~90 bytes) and the kernel's own data. Ten tasks can easily be 8 kB of RAM you did not
  need before. On a part with 20 kB total, that is the whole design.
- **Flash.** The FreeRTOS kernel is roughly 6–12 kB depending on the features you enable.
  Small, but not nothing on a 32 kB part.
- **Latency, slightly.** A context switch costs 50–200 cycles. Irrelevant at 100 Hz,
  significant if you are switching at 50 kHz.
- **A new class of bugs.** Race conditions, deadlocks, priority inversion, and stack
  overflows that corrupt a *different* task's memory. Superloops cannot have these. This is
  the real cost, and lessons 4 and 6 exist because of it.

## The honest decision test

Use an RTOS when **two or more** of these are true:

1. You have activities with genuinely different timing requirements (a 1 ms control loop
   *and* a 100 ms display refresh).
2. Something must respond within a bounded time regardless of what else is happening.
3. You have blocking I/O — a network stack, a filesystem, a modem AT-command sequence —
   where sequential code is dramatically clearer than a state machine.
4. You are integrating middleware that assumes threads (lwIP, mbedTLS, a USB stack, a BLE
   host).

Stay with a superloop when:

- The whole application is one periodic activity, or a few with the same period.
- You are under 32 kB flash / 8 kB RAM.
- Your team has never debugged a race condition and the schedule is tight.
- The code is already working and shipping.

> Point 4 is the one that decides most real projects. The moment you pull in a TCP/IP or
> BLE stack, it will want threads, and fighting that is more work than adopting the RTOS.

## What the kernel actually is

Strip away the marketing and FreeRTOS is three things:

1. **A scheduler** — a list of tasks, each with a priority and a state, and a rule for
   choosing which one runs.
2. **A tick** — a periodic timer interrupt (usually 1 kHz) that lets it track timeouts and
   preempt.
3. **Communication primitives** — queues, semaphores, mutexes, event groups. All of them
   built on the same "block this task until something happens" machinery.

That is genuinely it. It is about 9,000 lines of C. Reading `tasks.c` once is one of the
better afternoons a firmware developer can spend.

## Minimum viable FreeRTOS

```c
#include "FreeRTOS.h"
#include "task.h"

static void blink_task(void *arg)
{
    for (;;) {
        HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
        vTaskDelay(pdMS_TO_TICKS(500));      /* sleeps — does NOT spin */
    }
}

static void sensor_task(void *arg)
{
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        sample_and_process();
        vTaskDelayUntil(&last, pdMS_TO_TICKS(10));   /* exact 100 Hz */
    }
}

int main(void)
{
    HAL_Init();
    SystemClock_Config();
    MX_GPIO_Init();

    xTaskCreate(blink_task,  "blink",  128, NULL, 1, NULL);
    xTaskCreate(sensor_task, "sensor", 256, NULL, 3, NULL);

    vTaskStartScheduler();      /* never returns */

    for (;;) { }                /* only reached if the heap was too small */
}
```

Note the two details that matter already:

- **`vTaskDelay` vs `vTaskDelayUntil`.** `vTaskDelay(10)` means "sleep 10 ticks *from now*",
  so the period drifts by however long the work took. `vTaskDelayUntil` gives a fixed
  period. For a control loop, always the second one.
- **The stack size (`128`, `256`) is in words, not bytes.** On a 32-bit MCU, `128` means
  512 bytes. Getting this wrong is the most common first-day mistake, and lesson 6 covers
  how to size it properly.

## Check yourself

1. Why does an RTOS not make code faster?
2. What is the worst-case latency of the last task in a superloop?
3. Name two costs of adopting an RTOS that a superloop does not have.
4. When would `vTaskDelay` be wrong for a periodic task?

## Next

Lesson 2 opens up the scheduler: task states, what priority really means, when a context
switch happens, and how to pick priorities without guessing.
