---
lesson: 8
lang: en
title: "Low Power — Tickless Idle and the Battery Budget"
description: "Why a 1 kHz tick destroys battery life, how tickless idle fixes it, the peripheral and clock work the kernel cannot do for you, and how to measure current honestly."
duration: "16 min"
tags: ["FreeRTOS", "Low power", "Tickless"]
---

## The problem the tick creates

A default FreeRTOS build takes a timer interrupt 1,000 times per second. Each one wakes the
CPU from sleep, runs the tick handler, decides nothing needs to happen, and goes back to
sleep. On an STM32L4 that is roughly:

- 1,000 × (wake-up latency + ~3 µs of tick handler)
- average current around **1 mA**, against a **1.2 µA** stop-mode floor

A CR2032 holds about 220 mAh. At 1 mA that is nine days. At 10 µA it is two and a half years.
**The tick is the entire difference**, and no amount of optimising your application code
touches it.

![Tickless idle](/MyPortfolio/images/rtos/tickless-idle.svg)

## Tickless idle

The idea: when the idle task is about to run and nothing needs attention for the next N
ticks, **stop the tick entirely**, put the CPU in a deep sleep, and program a low-power timer
to wake up in N ticks' time. On waking, tell the kernel how much time actually passed.

Turn it on:

```c
/* FreeRTOSConfig.h */
#define configUSE_TICKLESS_IDLE                 1
#define configEXPECTED_IDLE_TIME_BEFORE_SLEEP   5   /* only sleep if ≥5 ticks idle */
```

With `configUSE_TICKLESS_IDLE 1` you get the generic implementation, which uses SysTick and
gives you `WFI` (sleep, clocks running). That is already a large win. For **stop mode**, where
SysTick itself is off, you must provide your own — `configUSE_TICKLESS_IDLE 2` plus a
`portSUPPRESS_TICKS_AND_SLEEP()` macro.

### Writing it for an STM32L4

```c
/* FreeRTOSConfig.h */
#define configUSE_TICKLESS_IDLE   2
#define portSUPPRESS_TICKS_AND_SLEEP(x)  vApplicationSleep(x)
```

```c
void vApplicationSleep(TickType_t xExpectedIdleTime)
{
    /* 1. Clamp to what the wake-up timer can actually count */
    uint32_t sleep_ms = xExpectedIdleTime * portTICK_PERIOD_MS;
    if (sleep_ms > MAX_LPTIM_MS) sleep_ms = MAX_LPTIM_MS;

    /* 2. Stop the tick so it cannot fire while we decide */
    portSUPPRESS_TICKS_AND_SLEEP_ENTER();

    /* 3. Last chance to abort — the kernel checks whether an ISR
     *    readied a task between the idle decision and here. */
    eSleepModeStatus status = eTaskConfirmSleepModeStatus();

    if (status == eAbortSleep) {
        /* something became ready — do not sleep, just restart the tick */
        restart_systick();
    } else {
        uint32_t before = lptim_get_count();

        lptim_set_wakeup(sleep_ms);
        if (status != eNoTasksWaitingTimeout) {
            /* a task has a timeout; wake for it */
        }

        suspend_unneeded_peripherals();
        HAL_PWR_EnterSTOPMode(PWR_LOWPOWERREGULATOR_ON, PWR_STOPENTRY_WFI);
        /* ---- execution resumes here after the wake-up interrupt ---- */
        SystemClock_Config();               /* PLL was stopped — restore it */
        resume_peripherals();

        uint32_t slept_ms = lptim_elapsed_ms(before);

        /* 4. Tell the kernel how much time really passed */
        vTaskStepTick(pdMS_TO_TICKS(slept_ms));
        restart_systick();
    }

    portSUPPRESS_TICKS_AND_SLEEP_EXIT();
}
```

The four things that make or break this:

1. **`eTaskConfirmSleepModeStatus()` is not optional.** There is a window between the kernel
   deciding to idle and your code stopping the clock. An ISR firing in that window readies a
   task, and if you sleep anyway you have just added an unbounded latency. This function tells
   you.
2. **`vTaskStepTick()` must reflate reality.** If you slept 500 ms and tell the kernel 400,
   every timeout in the system is now wrong and drifts further with each sleep.
3. **The clock tree stops in stop mode.** The PLL is off on wake; if you do not call
   `SystemClock_Config()` you are running from the internal RC at a fraction of the speed,
   and every baud rate and timing calculation is wrong. This produces the classic "works but
   UART is garbage after the first sleep".
4. **Read elapsed time from a clock that kept running** — RTC or LPTIM, not SysTick, which
   was stopped.

## What the kernel cannot do for you

Tickless idle handles the CPU. The rest of the board is your problem, and on most designs the
peripherals dominate:

| Consumer | Typical current | Fix |
| --- | --- | --- |
| CPU in stop mode | 1–10 µA | tickless idle |
| GPIO left floating | **10–100 µA each** | configure every unused pin as analog or pull it |
| Peripheral clocks left on | 50–500 µA | disable in the sleep hook, re-enable on wake |
| ADC / comparator | 200 µA–2 mA | power down explicitly |
| Sensor in continuous mode | 100 µA–5 mA | one-shot mode, or its own sleep command |
| LED left on | **2–20 mA** | it dominates everything else |
| Pull-up on an I²C bus | 200 µA per resistor at 3.3 V/10 kΩ | gate the bus power, or use larger resistors |

A floating input pin is the one that catches people: an undriven CMOS input oscillates around
the switching threshold and burns current continuously. On a 64-pin part with twenty unused
pins, that alone can be a milliamp. In CubeMX, set every unused pin to *Analog* mode — it is
the lowest-leakage state.

## Structuring an application for low power

The RTOS habits from lesson 3 turn out to be exactly the right ones:

```c
/* GOOD — blocks, so the idle task gets to run and the CPU can sleep */
static void sensor_task(void *arg)
{
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        sensor_wake();
        sample_and_send();
        sensor_sleep();
        vTaskDelayUntil(&last, pdMS_TO_TICKS(60000));   /* 60 s between samples */
    }
}
```

```c
/* BAD — polls, so the idle task never runs and nothing ever sleeps */
static void sensor_task(void *arg)
{
    for (;;) {
        if (timer_elapsed()) { sample_and_send(); }
        taskYIELD();
    }
}
```

**Any task that polls prevents every sleep in the system.** One `taskYIELD()` loop anywhere
costs you the entire power budget, and it is invisible on the bench because everything still
works.

The design rules that follow:

- **Every task blocks on something.** A queue, a notification, or a delay. Never a flag.
- **Sample as rarely as the specification allows.** Going from 1 Hz to 0.1 Hz is a 10× power
  saving that no code optimisation can match.
- **Batch radio traffic.** A BLE or LoRa transmission costs 10–100 mA for milliseconds. Ten
  readings in one packet cost a tenth of ten packets.
- **Align wake-ups.** Three tasks waking at 1 s, 2 s and 5 s means wake-ups at 1,2,3,4,5,6…
  Making them 1 s, 2 s and 4 s means far fewer distinct wake events, because they coincide.

That last point is subtle and worth more than it looks: the fixed cost of waking up (clock
restart, regulator settling) is often larger than the work done, so **fewer, larger wake-ups
beat more, smaller ones.**

## Idle and tick hooks

Two hooks are useful even before you do full tickless work:

```c
#define configUSE_IDLE_HOOK 1

void vApplicationIdleHook(void)
{
    /* Runs whenever the idle task runs. The simplest possible power saving:
     * sleep until the next interrupt. Clocks stay on, so no reconfiguration
     * is needed — this is safe to add to an existing project today. */
    __WFI();
}
```

That single line often cuts average current by 50–70% on a system that was busy-looping in
idle, and it cannot break anything, because the next tick wakes you.

```c
#define configUSE_TICK_HOOK 1

void vApplicationTickHook(void)
{
    /* Runs in the tick ISR — keep it to a few instructions.
     * Useful for a cheap uptime counter or feeding a hardware watchdog. */
    tick_counter++;
}
```

## Measuring current honestly

You cannot optimise what you have not measured, and a multimeter will lie to you here. It
averages, and it usually cannot resolve a 2 mA spike lasting 500 µs against a 5 µA floor.

What actually works:

- **A current probe with logging** — Nordic PPK2 (~$100), Otii Arc, or Joulescope. The PPK2
  is the pragmatic choice: microamp resolution, and it plots current against time so you can
  *see* each wake-up.
- **A shunt resistor and a scope** — put 1 Ω in series, measure the voltage across it. Crude
  but free, and enough to spot the shape.
- **A GPIO marker** — set a pin high while awake. Correlating that trace with the current
  trace tells you exactly which wake-up costs what.

What to look for, in order:

1. **The floor.** With everything idle, what is the baseline? If it is 500 µA instead of
   10 µA, you have a peripheral or a pin problem, not a firmware problem.
2. **Wake-up frequency.** How many spikes per second? If it is 1,000, tickless is not working.
3. **Wake-up duration.** How long is each spike? If it is much longer than your work, the
   clock restart dominates and you should batch.
4. **The peaks.** Is anything drawing far more than expected? A radio, a display backlight, an
   inrush into a capacitor.

Then compute the honest number:

```
average = (I_active × t_active + I_sleep × t_sleep) / (t_active + t_sleep)
life_hours = battery_mAh / average_mA
```

A 60-second sample cycle where you are awake 20 ms at 8 mA and asleep the rest at 6 µA:

```
average = (8 × 0.020 + 0.006 × 59.98) / 60 = (0.16 + 0.36) / 60 ≈ 8.7 µA
220 mAh / 0.0087 mA ≈ 25,000 hours ≈ 2.9 years
```

Note what that arithmetic reveals: the sleep current, at 0.36, is now *larger* than the active
contribution at 0.16. Once you have got tickless idle working, further gains come from the
floor, not from making your code faster.

## Common failures

- **Tickless does nothing.** Something is polling. Check `vTaskGetRunTimeStats` — if the idle
  task is not getting 95%+ of the CPU, find out who is.
- **UART garbage after the first sleep.** The PLL was not restored. See point 3 above.
- **Timeouts slowly drift.** `vTaskStepTick()` is being given the wrong count, or you are
  measuring elapsed time with a clock that also stopped.
- **The device never wakes.** The wake-up source was not enabled before entering stop mode, or
  it is on a clock domain that also got disabled.
- **Current is fine on the dev board, terrible on the product.** The dev board has a
  regulator, LEDs and a debug chip you are also powering. Measure the MCU rail alone.

## Check yourself

1. Why does a 1 kHz tick dominate the power budget of a battery device?
2. What does `eTaskConfirmSleepModeStatus()` protect against?
3. Why must `SystemClock_Config()` be called after stop mode?
4. One task calls `taskYIELD()` in a loop. What happens to your battery life, and why is it
   invisible during functional testing?

## Next

Lesson 9: two cores. FreeRTOS SMP, task affinity, why `taskENTER_CRITICAL` is no longer
enough, and how FreeRTOS compares with Zephyr and ThreadX when you have to choose.
