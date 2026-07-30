---
lesson: 9
lang: en
title: "Two Cores, and Choosing a Kernel"
description: "FreeRTOS SMP: task affinity, why taskENTER_CRITICAL is no longer enough, and spinlocks. Then an honest comparison with Zephyr, ThreadX and CMSIS-RTOS2."
duration: "15 min"
tags: ["FreeRTOS", "SMP", "Zephyr"]
---

## What changes with a second core

Multicore MCUs are now ordinary: ESP32 has two Xtensa cores, RP2040 two Cortex-M0+, STM32H7
dual-core an M7 and an M4. FreeRTOS gained official SMP support in v11.

The change is not "twice the CPU". It is that **two tasks now run at literally the same
instant**, and every assumption built on "only one thing runs at a time" needs rechecking.

![FreeRTOS SMP](/MyPortfolio/images/rtos/smp.svg)

Three specific assumptions break:

**1. Priority is no longer globally absolute.** On a single core, the highest-priority ready
task is always running. With two cores, the *two* highest-priority ready tasks are running. A
priority-3 task can be executing while a priority-5 task also executes — on the other core.
"Higher priority means it runs first" becomes "higher priority means it gets a core sooner".

**2. `taskENTER_CRITICAL()` only stops the current core.** It disables interrupts and the
scheduler *locally*. The other core keeps running, and can walk straight into the data you
thought you had protected. This is the single most dangerous difference, because the code looks
correct and works most of the time.

**3. Cache and memory ordering matter.** On parts with separate caches per core, a write by
core 0 may not be visible to core 1 until a cache operation. `volatile` does not help; you need
the kernel's primitives or explicit barriers.

## Task affinity

The safe way to adopt SMP is to pin most tasks to a core, which recovers single-core reasoning
within each one:

```c
/* ESP-IDF / FreeRTOS SMP */
xTaskCreatePinnedToCore(wifi_task,   "wifi",   4096, NULL, 5, NULL, 0);  /* core 0 */
xTaskCreatePinnedToCore(control_task,"control", 2048, NULL, 6, NULL, 1);  /* core 1 */
xTaskCreatePinnedToCore(app_task,    "app",    4096, NULL, 4, NULL, tskNO_AFFINITY);
```

Or with vanilla FreeRTOS SMP:

```c
TaskHandle_t h;
xTaskCreate(control_task, "control", 2048, NULL, 6, &h);
vTaskCoreAffinitySet(h, (1u << 1));      /* bitmask: only core 1 */
```

The pattern that works in practice, and is what ESP-IDF does by default:

- **Core 0: connectivity.** WiFi, BLE, the TCP/IP stack. These have their own timing needs and
  the vendor already pins them here.
- **Core 1: your application.** Control loops, sensor sampling, anything with deadlines you
  care about.
- **Unpinned: only tasks with no shared state and no timing requirement.** Logging, for
  example.

Pinning a deadline-sensitive task is not a workaround, it is good design: it makes the timing
analysable again. An unpinned task's worst case depends on what is happening on both cores.

## Locking that actually works

Since `taskENTER_CRITICAL()` is not enough, SMP ports provide a **spinlock** that coordinates
between cores:

```c
/* ESP-IDF */
static portMUX_TYPE my_lock = portMUX_INITIALIZER_UNLOCKED;

void update_shared(void)
{
    portENTER_CRITICAL(&my_lock);      /* blocks the other core too */
    shared.a = 1;
    shared.b = 2;
    portEXIT_CRITICAL(&my_lock);
}

/* from an ISR */
portENTER_CRITICAL_ISR(&my_lock);
/* ... */
portEXIT_CRITICAL_ISR(&my_lock);
```

A spinlock **busy-waits**. The other core spins, burning cycles, until you release it. So the
rule from lesson 4 becomes stricter: a critical section that was "keep it short" on one core is
"keep it a handful of instructions" on two, because you are now wasting another core's time,
not just delaying it.

What is still safe without any of this:

- **Queues, semaphores, mutexes, event groups, stream buffers.** The kernel implements them
  with the correct cross-core locking internally. This is the strongest argument for the
  message-passing discipline from lesson 3: **it ports to SMP unchanged.**
- **Atomic operations** on a single aligned word, where the architecture guarantees it.

What is not safe:

- Anything guarded only by `taskENTER_CRITICAL()`.
- `volatile` on a multi-word structure.
- Assuming a priority-based ordering between tasks on different cores.

## Inter-core communication

Two cores need to talk, and the mechanism depends on how coupled they are.

**Symmetric (SMP), shared RAM** — ESP32, RP2040. One kernel, one set of queues; just use a
queue exactly as you would on one core. The kernel handles the rest.

**Asymmetric (AMP), separate kernels** — STM32H7 with an M7 and an M4 running different
firmware. Here you need a real IPC mechanism:

- **Hardware mailboxes / HSEM** — a semaphore peripheral both cores can see.
- **Shared memory + OpenAMP / RPMsg** — the standard framework, and what ST's examples use.
- **A ring buffer in shared memory** with explicit cache maintenance:

```c
/* writer core, after filling the buffer */
SCB_CleanDCache_by_Addr((uint32_t *)buf, len);   /* push out of my cache  */
notify_other_core();

/* reader core, before reading */
SCB_InvalidateDCache_by_Addr((uint32_t *)buf, len);  /* drop my stale copy */
```

Forgetting those cache operations produces the archetypal AMP bug: the data is correct in
memory and wrong when read, intermittently, depending on cache pressure. If you take one thing
from this section, it is that on a cached AMP system **every shared buffer needs explicit clean
and invalidate**, and the region should ideally be configured as non-cacheable in the MPU
instead.

## Choosing a kernel

FreeRTOS is not always the right answer. An honest comparison:

| | FreeRTOS | Zephyr | ThreadX | RT-Thread |
| --- | --- | --- | --- | --- |
| Licence | MIT | Apache 2.0 | MIT | Apache 2.0 |
| Steward | AWS | Linux Foundation | Microsoft/Eclipse | community, strong in CN |
| Footprint | 6–12 kB | 8–50 kB+ | 2–20 kB | 4–20 kB |
| Learning curve | **low** | high | medium | medium |
| Drivers included | no | **yes, extensive** | some | yes |
| Build system | yours | west + CMake + Kconfig | yours | scons/CMake |
| Device tree | no | **yes** | no | no |
| Networking | separate (lwIP) | **built in** | NetX | built in |
| Safety certified | SafeRTOS (paid) | available | **pre-certified** | limited |
| Vendor support | universal | very broad | broad | mostly CN vendors |

Practical guidance:

**FreeRTOS when** you want a scheduler and nothing else, the vendor BSP already ships it, or
the team is learning. It is a kernel, not a platform, and that is its strength — you can read
all of it.

**Zephyr when** you need drivers, networking, Bluetooth, filesystems and power management as a
coherent whole, and you are building a product family. It is much more than a kernel: device
tree for hardware description, Kconfig for feature selection, an enormous driver library. The
cost is a genuinely steep learning curve — expect a week before you are productive, not an
afternoon.

**ThreadX when** you need pre-certified safety artefacts (IEC 61508 SIL 4, ISO 26262 ASIL D)
without building the case yourself. Now open source under Eclipse. Its footprint is the
smallest of the four.

**RT-Thread when** you are working with Chinese silicon vendors, where the BSP support is
strongest.

The conceptual overlap is large: everything in lessons 1 to 8 transfers. Zephyr's `k_msgq` is
a queue, `k_mutex` has priority inheritance, `k_sem` is a semaphore, and its tickless idle
works on the same principle. Learning one kernel properly means the second takes days, not
months.

## CMSIS-RTOS2 — the portability layer

ARM's standard wrapper API sits on top of FreeRTOS, RTX or ThreadX:

```c
#include "cmsis_os2.h"

static void my_thread(void *arg) { for (;;) { osDelay(100); } }

int main(void)
{
    osKernelInitialize();

    const osThreadAttr_t attr = {
        .name = "sensor",
        .stack_size = 1024,               /* NOTE: in BYTES, not words */
        .priority = osPriorityAboveNormal,
    };
    osThreadNew(my_thread, NULL, &attr);

    osKernelStart();
}
```

This is what STM32CubeMX generates when you enable FreeRTOS, so you will meet it whether you
choose it or not.

**The upside:** identical application code across kernels, and it is the documented path in ST's
tooling.

**The downsides**, which matter more than the upside in my experience:

- **It exposes only the common subset.** No stream buffers, no `xTaskDelayUntil` return value,
  a reduced notification API.
- **Error information is lost.** Where FreeRTOS distinguishes "queue full" from "invalid
  handle", CMSIS often returns a generic `osError`.
- **Debugging goes through two layers.** A stack trace passes through the wrapper, and the
  documentation you find online is about the layer underneath.
- **Units differ.** `stack_size` in bytes here, words in FreeRTOS. A silent factor of four.

My recommendation: if CubeMX generated it and you are not porting anywhere, keep it — fighting
the generator is not worth it. If you are writing from scratch, use the native API. Real
portability between kernels is limited by drivers and build systems far more than by the
scheduler API.

## Check yourself

1. Why is `taskENTER_CRITICAL()` insufficient on an SMP system?
2. What does pinning a deadline-sensitive task to a core buy you?
3. Which FreeRTOS primitives are safe across cores without extra work, and why does that
   validate the message-passing discipline?
4. When would you choose Zephyr over FreeRTOS, and what does it cost you?

## Next

The final lesson: one complete device, designed from the requirements down — task decomposition,
priority assignment, a computed CPU and RAM budget, and the diagnostics that ship with it.
