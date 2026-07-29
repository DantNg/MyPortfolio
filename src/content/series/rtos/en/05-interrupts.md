---
lesson: 5
lang: en
title: "Interrupts and the RTOS"
description: "Why your ISR should be three lines, what FromISR actually changes, portYIELD_FROM_ISR, and the Cortex-M priority setting that silently corrupts everything when it is wrong."
duration: "14 min"
tags: ["RTOS", "ISR", "Cortex-M"]
---

## An ISR is not a task

Interrupts sit outside the scheduler entirely. While an ISR runs, **no task runs at all** —
not even the highest-priority one. The scheduler cannot preempt an ISR; only a
higher-priority interrupt can.

That single fact drives every rule in this lesson. Time spent in an ISR is time stolen from
every deadline in the system, and it does not show up in `vTaskGetRunTimeStats`.

## Deferred interrupt handling

![Deferred interrupt handling](/MyPortfolio/images/rtos/isr-deferred.svg)

The pattern is always the same: the ISR does the minimum the hardware demands, hands the
work to a task, and gets out.

```c
/* WRONG — 5 ms with interrupts effectively disabled */
void USART2_IRQHandler(void)
{
    uint8_t b = USART2->RDR;
    parse_protocol(b);        /* 300 µs */
    if (frame_complete) {
        write_to_flash();     /* 5 ms !! */
    }
}
```

```c
/* RIGHT — a few microseconds */
void USART2_IRQHandler(void)
{
    uint8_t b = USART2->RDR;              /* clears the flag; must happen here */

    BaseType_t higher_woken = pdFALSE;
    xQueueSendFromISR(rx_queue, &b, &higher_woken);

    portYIELD_FROM_ISR(higher_woken);
}
```

The task then does the parsing and the flash write at whatever priority you assigned, and
can take as long as it needs, because it is a task and the scheduler can preempt it.

The only things that belong in an ISR:

- Reading or writing the peripheral register that clears the interrupt flag.
- Copying a byte or a word out of a FIFO.
- Signalling a task.
- Timestamping, if you need microsecond accuracy.

## The FromISR suffix

Every kernel API that can be used from an interrupt has a `FromISR` variant, and it is not
optional — calling `xQueueSend()` from an ISR corrupts the kernel.

```c
xQueueSendFromISR(q, &item, &higher_woken);
xQueueReceiveFromISR(q, &item, &higher_woken);
xSemaphoreGiveFromISR(sem, &higher_woken);
vTaskNotifyGiveFromISR(handle, &higher_woken);
xEventGroupSetBitsFromISR(group, bits, &higher_woken);
xTimerStartFromISR(timer, &higher_woken);
```

Two differences from the task versions:

1. **They never block.** There is no timeout parameter, because an ISR cannot be blocked —
   there is no task to put in the Blocked state. If the queue is full, `xQueueSendFromISR`
   returns `errQUEUE_FULL` immediately, and it is your job to count that.
2. **They report whether a higher-priority task woke up**, through that
   `BaseType_t *` out-parameter.

## portYIELD_FROM_ISR — the line people forget

```c
BaseType_t higher_woken = pdFALSE;          /* MUST be initialized to pdFALSE */

xQueueSendFromISR(rx_queue, &b, &higher_woken);

portYIELD_FROM_ISR(higher_woken);           /* switch on ISR exit if needed */
```

If the send unblocked a task with higher priority than the one that was interrupted,
`higher_woken` becomes `pdTRUE`, and `portYIELD_FROM_ISR` arranges for the scheduler to
switch to it the instant the ISR returns.

Leave the line out and everything still *works* — the task just does not run until the next
tick. On a 1 kHz tick that is up to 1 ms of jitter, added to a path you specifically designed
to be fast. It is the classic "why is my latency sometimes 1 ms" bug.

Note the API differs by port: ESP-IDF uses `portYIELD_FROM_ISR()` with no argument in some
versions, ST's ports use `portYIELD_FROM_ISR(x)`. Check your `portmacro.h` rather than
copying from a blog post.

## The Cortex-M priority trap

This is the one that produces impossible-looking bugs, and it is worth reading twice.

On Cortex-M, **lower NVIC numbers mean higher priority** — the opposite of FreeRTOS task
priorities. FreeRTOS defines a threshold:

```c
/* FreeRTOSConfig.h */
#define configMAX_SYSCALL_INTERRUPT_PRIORITY   (5 << (8 - configPRIO_BITS))
#define configKERNEL_INTERRUPT_PRIORITY        (15 << (8 - configPRIO_BITS))
```

The rule:

> An interrupt may call `FromISR` APIs **only if** its numerical priority is **greater than
> or equal to** `configMAX_SYSCALL_INTERRUPT_PRIORITY` — that is, only if it is *less
> urgent* than the threshold.

Interrupts more urgent than the threshold are never disabled by the kernel's critical
sections. That makes them wonderfully low-latency, and it also means they **must not touch
kernel objects at all** — the kernel cannot protect its own data structures from them.

The trap is the default. On STM32, `HAL_NVIC_SetPriority(USART2_IRQn, 0, 0)` sets priority
0 — the most urgent possible, above the threshold. Calling `xQueueSendFromISR` from there
corrupts the queue, intermittently, in a way that shows up hours later as an impossible
value in an unrelated variable.

**Always set your interrupt priorities explicitly:**

```c
/* numerically >= 5, so kernel APIs are legal */
HAL_NVIC_SetPriority(USART2_IRQn, 6, 0);
HAL_NVIC_EnableIRQ(USART2_IRQn);

/* a genuinely time-critical interrupt that touches NO kernel API */
HAL_NVIC_SetPriority(TIM1_UP_IRQn, 1, 0);
```

And turn on the assertion that catches this for you:

```c
#define configASSERT(x)  if ((x) == 0) { taskDISABLE_INTERRUPTS(); for (;;); }
```

FreeRTOS uses `configASSERT` to validate ISR priorities on entry to every `FromISR` call.
With it enabled, this bug becomes a hard stop at the offending line instead of a
once-a-week mystery. Enable it in development. It is the highest-value line in
`FreeRTOSConfig.h`.

## The fastest path: direct-to-task notification

For a single ISR waking a single task, notifications beat both queues and semaphores:

```c
static TaskHandle_t adc_task_handle;

void DMA1_Channel1_IRQHandler(void)
{
    DMA1->IFCR = DMA_IFCR_CTCIF1;              /* clear the flag */

    BaseType_t woken = pdFALSE;
    vTaskNotifyGiveFromISR(adc_task_handle, &woken);
    portYIELD_FROM_ISR(woken);
}

static void adc_task(void *arg)
{
    adc_task_handle = xTaskGetCurrentTaskHandle();
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);   /* blocks until the DMA fires */
        process_adc_buffer();
    }
}
```

Roughly 45% faster than a binary semaphore and it needs no separate kernel object. This is
the shape to use for high-rate DMA completion.

## Timers: software vs hardware

FreeRTOS software timers run in a dedicated timer task, not in an interrupt:

```c
TimerHandle_t t = xTimerCreate("blink", pdMS_TO_TICKS(500),
                               pdTRUE,       /* auto-reload */
                               NULL, blink_cb);
xTimerStart(t, 0);

static void blink_cb(TimerHandle_t xTimer) {
    HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
}
```

Understand what that means: the callback runs at the priority of the timer service task
(`configTIMER_TASK_PRIORITY`), with its stack, and **must not block** — blocking in a timer
callback delays every other timer. Software timers are for housekeeping — timeouts,
debouncing, periodic health checks — not for anything with tight timing. For that, use a
hardware timer peripheral and its ISR.

## Measuring ISR duration

You cannot reason about worst-case latency without numbers. The cheapest method is a GPIO
pin and a scope:

```c
void TIM2_IRQHandler(void)
{
    DEBUG_PIN_HIGH();
    /* ... the work ... */
    DEBUG_PIN_LOW();
}
```

Or count cycles with the DWT unit:

```c
/* enable once at startup */
CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;

/* in the ISR */
uint32_t start = DWT->CYCCNT;
/* ... work ... */
uint32_t cycles = DWT->CYCCNT - start;
if (cycles > isr_worst_case) isr_worst_case = cycles;
```

Keep `isr_worst_case` for each ISR and print it in your diagnostics. The sum of your worst
cases is the jitter floor for every task in the system, and it is the number to quote when
someone asks whether the design meets its deadlines.

## Check yourself

1. Why can the scheduler not preempt an ISR?
2. What does `portYIELD_FROM_ISR` do, and what happens if you omit it?
3. Which interrupts may call `FromISR` APIs, in terms of NVIC priority numbers?
4. Where does a FreeRTOS software timer callback actually run?

## Next

The final lesson: memory. Heap schemes, sizing stacks properly, catching overflows, and the
handful of diagnostics that turn an RTOS from a black box into something you can reason
about.
