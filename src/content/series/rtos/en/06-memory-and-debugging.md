---
lesson: 6
lang: en
title: "Memory, Stacks and Debugging What You Cannot See"
description: "Heap schemes, sizing stacks with evidence instead of superstition, catching overflows before they corrupt another task, and the diagnostics worth shipping."
duration: "16 min"
tags: ["RTOS", "Memory", "Debugging"]
---

## Where the RAM goes

![RTOS memory layout](/MyPortfolio/images/rtos/stack-memory.svg)

Adding an RTOS changes your memory picture in a way that surprises people the first time:

| Consumer | Typical cost |
| --- | --- |
| Kernel data (ready lists, tick, current TCB) | ~200 bytes |
| Per task: TCB | ~90 bytes |
| Per task: stack | 256 B – 2 kB — **the big one** |
| Per queue | `length × item_size` + ~80 bytes |
| Per mutex/semaphore | ~80 bytes |
| Timer service task | its own stack, ~512 B |
| Idle task | its own stack, `configMINIMAL_STACK_SIZE` |

Eight tasks at 512 bytes each is 4 kB of stack before you have written a line of
application code. On a part with 20 kB of RAM, that is a fifth of your budget, and it is why
"how many tasks should I have?" has a real answer: **as few as the design honestly needs.**

## Heap schemes

FreeRTOS ships five allocators; you pick one by compiling exactly one `heap_n.c`.

| | What it does | Use when |
| --- | --- | --- |
| `heap_1` | allocate only, never free | you create everything at startup and never delete — **safest** |
| `heap_2` | allocate/free, no coalescing | legacy; do not choose it for new work |
| `heap_3` | wraps `malloc`/`free` with a lock | you already have a libc heap and want one pool |
| `heap_4` | allocate/free **with coalescing** | the sensible default |
| `heap_5` | like heap_4 across several non-contiguous regions | you have internal RAM + external SDRAM |

The honest recommendation:

- **`heap_1` if you can.** If every task, queue and semaphore is created before
  `vTaskStartScheduler()` and nothing is ever deleted, `heap_1` removes fragmentation as a
  concept. Many shipping products work this way.
- **`heap_4` otherwise.** It coalesces adjacent free blocks, so long-running
  allocate/free cycles do not shred the heap.
- **Static allocation for anything safety-related.** With
  `configSUPPORT_DYNAMIC_ALLOCATION 0` and `configSUPPORT_STATIC_ALLOCATION 1`, the entire
  class of allocation failures disappears — the linker tells you at build time if it does
  not fit. This is standard in automotive and medical firmware.

Size the heap in `FreeRTOSConfig.h` and then measure it:

```c
#define configTOTAL_HEAP_SIZE  ((size_t)(16 * 1024))

/* after startup */
printf("heap free now: %u, minimum ever: %u\n",
       (unsigned)xPortGetFreeHeapSize(),
       (unsigned)xPortGetMinimumEverFreeHeapSize());
```

`xPortGetMinimumEverFreeHeapSize()` is the number that matters. If it is 200 bytes, you are
one feature away from a silent `xTaskCreate` failure.

And install the hook so failure is loud:

```c
#define configUSE_MALLOC_FAILED_HOOK 1

void vApplicationMallocFailedHook(void)
{
    taskDISABLE_INTERRUPTS();
    /* light an LED, log to a reserved RAM region, then stop */
    for (;;) { }
}
```

## Sizing stacks with evidence

The stack parameter of `xTaskCreate` is **in words, not bytes**. On a 32-bit MCU, `128`
means 512 bytes. Getting this wrong by a factor of four is the single most common
first-week mistake.

Guessing does not work, and neither does copying numbers from an example. Use the
high-water mark:

```c
/* call from inside the task, or with its handle */
UBaseType_t words_remaining = uxTaskGetStackHighWaterMark(NULL);

printf("%s: %u words (%u bytes) never used\n",
       pcTaskGetName(NULL),
       (unsigned)words_remaining,
       (unsigned)(words_remaining * sizeof(StackType_t)));
```

It reports the **minimum free space the stack has ever had**, because FreeRTOS fills the
stack with a known pattern at creation and counts how much is still untouched.

The procedure:

1. Start generously — 1024 words (4 kB) for anything doing string formatting, 256 for a
   simple loop.
2. Run the **worst case**: deepest call path, error handling, all features active, longest
   `printf`. Bugs love the paths you did not exercise.
3. Read the high-water mark.
4. Set the stack to `(used + 30%)`, rounded up.

What eats stack, in rough order:

- **`printf` / `sprintf`** — 200 to 1000+ bytes depending on the libc. This alone decides
  many stack sizes.
- **Large local arrays.** `uint8_t buf[512]` is half a kilobyte of stack. Make it `static`
  if only one task uses it.
- **Floating point on a part without an FPU** — software float routines are stack-hungry.
- **Deep call chains through vendor HALs.**
- **Recursion.** Just do not, in firmware.

## Catching stack overflow

Overflow does not crash cleanly. It writes past the end of one task's stack into whatever
is next — usually another task's stack or TCB — and the failure appears somewhere else
entirely, minutes later. It is the worst bug class in RTOS work.

Turn on detection:

```c
#define configCHECK_FOR_STACK_OVERFLOW  2      /* 1 = pointer check, 2 = pattern check */

void vApplicationStackOverflowHook(TaskHandle_t xTask, char *pcTaskName)
{
    taskDISABLE_INTERRUPTS();
    /* pcTaskName tells you exactly which task — save it somewhere persistent */
    strncpy(crash_info.task, pcTaskName, sizeof(crash_info.task) - 1);
    crash_info.reason = CRASH_STACK_OVERFLOW;
    NVIC_SystemReset();
}
```

Method 2 checks a known pattern in the last 20 bytes of the stack at every context switch.
It costs a few cycles per switch and catches almost everything. **Leave it on in
development, and seriously consider leaving it on in production** — a defined reset with a
recorded task name beats corrupted behavior.

Also enable the MPU-based stack guard if your part has one and your port supports it. On a
Cortex-M with an MPU, an overflow becomes an immediate MemManage fault at the exact
instruction that did it.

## The diagnostics worth shipping

Build one function and call it from a debug command or a periodic timer:

```c
void system_report(void)
{
    static char buf[640];

    printf("--- tasks ---\n");
    vTaskList(buf);                    /* name, state, prio, stack HWM, id */
    printf("%s", buf);

    printf("--- cpu ---\n");
    vTaskGetRunTimeStats(buf);         /* absolute and %% run time per task */
    printf("%s", buf);

    printf("heap: free %u, min-ever %u\n",
           (unsigned)xPortGetFreeHeapSize(),
           (unsigned)xPortGetMinimumEverFreeHeapSize());

    printf("queues: sample=%u/%u  log=%u/%u\n",
           (unsigned)uxQueueMessagesWaiting(sample_q), 10u,
           (unsigned)uxQueueMessagesWaiting(log_q), 32u);

    printf("overruns: control=%lu  dropped=%lu\n",
           control_overruns, dropped_samples);
}
```

Those last two lines are the ones that catch real problems. A control loop that overran its
period four times in eight hours is a genuine finding you would otherwise never see.

Run-time stats need a high-resolution counter, typically a spare hardware timer at 10–20×
the tick rate:

```c
#define configGENERATE_RUN_TIME_STATS            1
#define portCONFIGURE_TIMER_FOR_RUN_TIME_STATS() timer2_init_20khz()
#define portGET_RUN_TIME_COUNTER_VALUE()         (TIM2->CNT)
```

## Tracing

When the numbers are not enough and you need to see the *sequence*, use a trace tool:

- **Percepio Tracealyzer** — the reference option. Shows every context switch, block, and
  API call on a timeline, and finds priority inversions visually. Commercial, with a free
  streaming tier.
- **SEGGER SystemView** — free with a J-Link, real-time streaming over RTT, minimal overhead.
  If you already own a J-Link, start here.
- **GPIO + logic analyzer** — set a pin high on entry to each task via
  `traceTASK_SWITCHED_IN()`. Crude, free, and often enough:

```c
/* FreeRTOSConfig.h */
#define traceTASK_SWITCHED_IN()  gpio_set_task_id(pxCurrentTCB->uxTCBNumber)
```

Seeing an actual timeline once will teach you more about your system than a week of
reasoning about it.

## The debugging checklist

When an RTOS system misbehaves, work down this list:

1. **Is `configASSERT` enabled?** Enable it first. It catches ISR priority errors, invalid
   handles, and API misuse at the exact line.
2. **Stack high-water marks.** Any task under ~15% headroom is a suspect.
3. **Minimum-ever heap free.** Near zero means a creation call failed silently.
4. **Priorities.** Does a high-priority task ever fail to block? Grep for `while` loops
   without a delay or a blocking call.
5. **ISR priorities.** Any interrupt calling `FromISR` must be numerically ≥
   `configMAX_SYSCALL_INTERRUPT_PRIORITY`.
6. **Lock ordering.** Two mutexes taken in opposite orders anywhere?
7. **Timeouts.** Any `portMAX_DELAY` on a mutex take or a queue send?

The first three take five minutes and explain most of it.

## Series recap

1. What an RTOS buys and costs, and the test for whether you need one.
2. Task states, fixed-priority preemption, rate-monotonic priority assignment.
3. Queues as the default communication mechanism; pointer passing and buffer pools.
4. Mutex vs semaphore, priority inheritance, deadlock rules.
5. Deferred interrupt handling, `FromISR`, and the Cortex-M priority threshold.
6. Heap schemes, evidence-based stack sizing, overflow detection, shipped diagnostics.

The thread running through all of it: an RTOS does not give you real-time behavior. It gives
you the *mechanisms* to build it, and the discipline to use them — measured priorities,
bounded critical sections, short ISRs, and numbers instead of hope — is what actually makes
a system meet its deadlines.
