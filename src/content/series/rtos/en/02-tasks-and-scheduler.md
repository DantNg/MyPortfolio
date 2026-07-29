---
lesson: 2
lang: en
title: "Tasks, States and the Scheduler"
description: "The four task states, what priority actually means, exactly when a context switch happens, and a method for assigning priorities that is not guesswork."
duration: "15 min"
tags: ["RTOS", "Scheduler", "Priorities"]
---

## A task is a function that never returns

```c
void my_task(void *pvParameters)
{
    my_ctx_t *ctx = (my_ctx_t *)pvParameters;   /* passed at creation */

    init_something();          /* runs once */

    for (;;) {                 /* runs forever */
        do_work(ctx);
        vTaskDelay(pdMS_TO_TICKS(100));
    }
    /* falling out of here is a bug — see below */
}
```

If a task function ever returns, FreeRTOS calls the error hook and typically traps. A task
that genuinely needs to end must delete itself:

```c
vTaskDelete(NULL);     /* NULL = "me" */
```

Each task gets its own stack and its own copy of the CPU registers. That is the whole magic:
when the scheduler switches, it saves the current registers onto the current task's stack
and restores the next task's. Everything else — globals, peripherals, flash — is shared,
which is exactly where lesson 4's problems come from.

## The four states

![Task states](/MyPortfolio/images/rtos/task-states.svg)

| State | Meaning |
| --- | --- |
| **Running** | actually executing. Exactly one per core. |
| **Ready** | able to run, waiting for the CPU because something higher-priority has it. |
| **Blocked** | waiting for time or an event. **Consumes no CPU.** |
| **Suspended** | removed from scheduling entirely until someone resumes it. |

The single most important sentence in this series: **a Blocked task costs nothing.** This
is why an RTOS lets you write

```c
xQueueReceive(q, &msg, portMAX_DELAY);
```

instead of

```c
while (!flag) { }        /* burns 100% CPU and starves everything below it */
```

If you find yourself polling a flag in a task, you are working against the kernel. There is
almost always a primitive — queue, semaphore, notification, event group — that turns it into
a block.

## What priority means

FreeRTOS is a **fixed-priority preemptive** scheduler. The rule is one line:

> The highest-priority task that is Ready always runs.

Not "gets more CPU time". Not "runs more often". *Always runs*, immediately, preempting
whatever was running the moment it becomes Ready.

Consequences that surprise people:

- **A high-priority task that never blocks starves everything below it. Forever.** Not
  "eventually gets less CPU" — never runs at all. This is the classic first bug.
- **Equal-priority tasks share time round-robin**, one tick each, if
  `configUSE_TIME_SLICING` is 1 (the default).
- **Priority is not urgency-of-the-work, it is urgency-of-the-response.** A task that must
  react in 1 ms but then does 10 ms of work still deserves high priority — provided it
  blocks afterwards.

In FreeRTOS, **0 is the lowest** priority (the idle task lives there) and
`configMAX_PRIORITIES - 1` is the highest. Note this is the opposite of many other kernels
and of Cortex-M NVIC interrupt priorities, where lower numbers mean *more* urgent. Getting
these two backwards in the same file is a rite of passage.

## When does a switch actually happen?

Only at these moments:

1. **The tick interrupt fires** (default 1 kHz) and a higher-priority task has become Ready
   — for example its delay expired.
2. **The running task blocks** — `vTaskDelay`, a queue receive on an empty queue, taking a
   held mutex.
3. **The running task readies a higher-priority one** — sending to a queue that a
   higher-priority task waits on. The switch happens *inside that API call*, before it
   returns.
4. **An ISR readies a higher-priority task** and calls `portYIELD_FROM_ISR()` (lesson 5).
5. **The task voluntarily yields** with `taskYIELD()`.

Nothing else. If a task neither blocks nor calls a kernel API, it runs until the tick, and
if it is the highest priority, it keeps running after the tick too.

## Choosing priorities

Do not scatter magic numbers through the code. Put them in one header and give them names:

```c
/* priorities.h — the whole timing design of the product, in one place */
#define PRIO_IDLE          0        /* reserved by the kernel      */
#define PRIO_LOGGING       1        /* whenever there is slack     */
#define PRIO_DISPLAY       2        /* 30 Hz is fine               */
#define PRIO_APP_LOGIC     3
#define PRIO_SENSOR_LOOP   4        /* 100 Hz control loop         */
#define PRIO_COMMS         5        /* must drain the UART FIFO    */
#define PRIO_SAFETY        6        /* overcurrent shutdown        */
```

The method — **rate-monotonic**, and it is provably optimal for fixed priorities:

> **The shorter the period, the higher the priority.**

A 1 ms loop outranks a 10 ms loop, which outranks a 100 ms display refresh. For
event-driven tasks, use the deadline instead of the period: something that must respond
within 2 ms is treated as if it had a 2 ms period.

Two practical rules on top:

- **Keep the number of distinct priorities small** — five to seven levels. Every extra
  level is a decision you have to justify later, and `configMAX_PRIORITIES` costs RAM
  (one list head per level).
- **Leave gaps** if your kernel config allows, so you can insert a level later without
  renumbering everything.

Finally, a sanity check you can do on paper. For periodic tasks, compute CPU utilization:

```
U = Σ (execution_time / period)
```

A 2 ms job every 10 ms plus a 5 ms job every 50 ms gives `0.2 + 0.1 = 0.3`, or 30%. Under
rate-monotonic scheduling, `n` tasks are guaranteed schedulable if `U ≤ n(2^(1/n) − 1)` —
about 0.69 for many tasks. **If you are above 70% utilization, you are living dangerously**
regardless of how well things look on the bench.

## Creating tasks

```c
BaseType_t ok = xTaskCreate(
        sensor_task,          /* function                         */
        "sensor",             /* name — shows up in debuggers     */
        256,                  /* stack depth in WORDS (=1 kB)     */
        &sensor_ctx,          /* parameter passed to the task     */
        PRIO_SENSOR_LOOP,     /* priority                         */
        &sensor_handle);      /* out: handle, or NULL if unused   */

configASSERT(ok == pdPASS);   /* fails when the heap is exhausted */
```

That `configASSERT` matters. `xTaskCreate` allocates the stack and TCB from the FreeRTOS
heap, and when the heap runs out it returns `errCOULD_NOT_ALLOCATE_REQUIRED_MEMORY` —
quietly, if you do not check. A product where task five silently never got created is a
miserable thing to debug.

For safety-critical or memory-constrained work, allocate statically instead and remove the
failure mode entirely:

```c
static StaticTask_t sensor_tcb;
static StackType_t  sensor_stack[256];

xTaskCreateStatic(sensor_task, "sensor", 256, &ctx,
                  PRIO_SENSOR_LOOP, sensor_stack, &sensor_tcb);
```

This is what you use when `configSUPPORT_DYNAMIC_ALLOCATION` is off — common in automotive
and medical firmware, where dynamic allocation after startup is simply not allowed.

## Periodic work, done right

```c
static void control_task(void *arg)
{
    TickType_t last_wake = xTaskGetTickCount();
    const TickType_t period = pdMS_TO_TICKS(10);      /* 100 Hz */

    for (;;) {
        read_sensors();
        compute_pid();
        drive_output();

        vTaskDelayUntil(&last_wake, period);
    }
}
```

`vTaskDelayUntil` computes the next wake time from the *previous* wake time, so jitter in
the work does not accumulate into drift. With `vTaskDelay(period)` the actual period becomes
`work + period` and slowly slides — invisible on a scope for a minute, obvious after an hour.

> If the work ever takes longer than the period, `vTaskDelayUntil` returns immediately and
> you silently lose a cycle. In FreeRTOS 10.4+, `xTaskDelayUntil()` returns `pdFALSE` in
> exactly that case — check it, and count the overruns. That counter is the cheapest
> real-time health metric you will ever add.

## Debugging what the scheduler is doing

```c
/* enable in FreeRTOSConfig.h */
#define configUSE_TRACE_FACILITY             1
#define configGENERATE_RUN_TIME_STATS        1
#define configUSE_STATS_FORMATTING_FUNCTIONS 1

char buf[512];
vTaskGetRunTimeStats(buf);   /* CPU % per task */
vTaskList(buf);              /* state, priority, stack high-water mark */
printf("%s", buf);
```

`vTaskList` output looks like this, and answers most "why is it slow" questions in one shot:

```
Name          State  Priority  Stack  Num
sensor          B        4       118    2
comms           R        5        64    3
display         B        2       201    4
IDLE            R        0       112    1
```

The `Stack` column is the **remaining** headroom in words — the high-water mark from
lesson 6. `64` means that task came within 256 bytes of overflowing.

## Check yourself

1. What happens to a priority-2 task if a priority-3 task never blocks?
2. Name the five moments a context switch can occur.
3. Why does `vTaskDelay` drift and `vTaskDelayUntil` not?
4. A task samples every 5 ms and takes 1 ms; another runs every 20 ms for 4 ms. What is the
   utilization, and which gets the higher priority?

<details>
<summary>Answer to 4</summary>

`1/5 + 4/20 = 0.2 + 0.2 = 0.4` → 40% utilization, comfortably schedulable. Rate-monotonic:
the 5 ms task has the shorter period, so it gets the higher priority.
</details>

## Next

Lesson 3: how tasks talk to each other. Queues, the difference between sharing memory and
passing messages, and why the queue should be your default answer.
