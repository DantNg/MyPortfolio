---
title: "FreeRTOS Task Scheduling: A Deep Dive"
description: "Understanding FreeRTOS scheduler internals, priority inversion, and practical patterns for building reliable real-time embedded systems."
date: 2024-09-18
tags: ["FreeRTOS", "RTOS", "C", "Embedded", "Real-Time"]
coverImage: "/images/blog/freertos.jpg"
draft: false
featured: false
---

## The Scheduler in 60 Seconds

FreeRTOS uses a fixed-priority preemptive scheduler with optional time-slicing for equal-priority tasks. The scheduler runs in the SysTick ISR every tick period (configTICK_RATE_HZ, typically 1000 Hz) and makes a single decision: should the current task keep running?

The answer is no if:
1. A higher-priority task became ready (preemption)
2. The current task called `vTaskDelay()`, `xQueueReceive()`, or any blocking API
3. Time-slicing is enabled and another equal-priority task is ready

## The Ready List

Internally, FreeRTOS maintains `pxReadyTasksLists[configMAX_PRIORITIES]` — one list per priority level. The scheduler always picks the head of the highest non-empty list. This is O(1) regardless of task count.

```c
/* Simplified scheduler tick handler */
void xTaskIncrementTick(void) {
    /* Move delayed tasks back to ready list if their time has come */
    checkDelayedTasks();
    
    /* If preemption enabled and a higher-priority task is now ready, yield */
    if (highestReadyPriority > currentTaskPriority) {
        portYIELD_FROM_ISR(pdTRUE);
    }
}
```

## Priority Inversion: The Silent Killer

Classic priority inversion happens when:

1. Low-priority task L holds mutex M
2. High-priority task H tries to acquire M → blocks
3. Medium-priority task M (no need for M) preempts L
4. H is effectively stuck behind M, not L — inversion

FreeRTOS solves this with **Priority Inheritance**: when H blocks on M held by L, L's priority is temporarily raised to H's priority, allowing L to preempt M and release M quickly.

```c
/* Enable priority inheritance — use mutexes, not binary semaphores */
SemaphoreHandle_t mutex = xSemaphoreCreateMutex(); /* has priority inheritance */
SemaphoreHandle_t sem   = xSemaphoreCreateBinary(); /* does NOT */
```

## Stack Overflow Detection

Always enable stack checking in development:

```c
/* FreeRTOSConfig.h */
#define configCHECK_FOR_STACK_OVERFLOW 2  /* Pattern-fill method */

/* Implement the hook */
void vApplicationStackOverflowHook(TaskHandle_t xTask, char *pcTaskName) {
    /* Log, assert, or reset — never return */
    configASSERT(0);
}
```

Method 2 fills the stack with a known pattern (0xA5) at task creation and checks the last N bytes on each context switch. It catches overflows that FillStack method 1 misses.

## Practical Task Design Rules

After shipping several FreeRTOS products, I follow these rules:

**Rule 1: One task, one responsibility.** A task that does I2C reads AND processes data AND sends UART will be impossible to profile and impossible to test in isolation.

**Rule 2: Size stacks with `uxTaskGetStackHighWaterMark()`.**
```c
UBaseType_t hwm = uxTaskGetStackHighWaterMark(NULL);
/* hwm is remaining stack in words — add 20% margin */
```

**Rule 3: Never use `vTaskDelay(0)` as a yield.** Use `taskYIELD()` — it makes intent clear and compiles to a single instruction on Cortex-M.

**Rule 4: Queues over global variables.** Inter-task communication through queues is inherently thread-safe. Shared globals require critical sections and are a source of subtle race conditions.

## Measuring Jitter

Worst-case interrupt latency on Cortex-M4 @ 168 MHz with FreeRTOS:

- Best case (no preemption overhead): ~20 cycles
- With context switch: ~200–400 cycles
- With 10 nested ISRs: ~600 cycles

Use a logic analyzer or the DWT cycle counter to measure your actual worst-case:

```c
#define DWT_CYCCNT (*(volatile uint32_t*)0xE0001004)
uint32_t start = DWT_CYCCNT;
/* ... critical section ... */
uint32_t elapsed = DWT_CYCCNT - start;
```

Understanding your system's timing budget is non-negotiable for real-time guarantees.
