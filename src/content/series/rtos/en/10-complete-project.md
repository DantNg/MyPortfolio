---
lesson: 10
lang: en
title: "A Complete Device, Designed From the Requirements Down"
description: "One worked example end to end: requirements to task decomposition, priorities from deadlines, a computed CPU and RAM budget, the code, and the diagnostics that ship with it."
duration: "20 min"
tags: ["FreeRTOS", "Architecture", "Project"]
---

## The requirements

A vibration data logger for industrial machines. This is deliberately ordinary — it has the
shape of most real embedded products:

| # | Requirement |
| --- | --- |
| R1 | Sample a 3-axis accelerometer at 1 kHz, no dropped samples |
| R2 | Compute RMS and peak per axis over 1-second windows |
| R3 | Store windows to SD card in 4 kB blocks |
| R4 | Accept configuration over UART at 115200 (set thresholds, start/stop) |
| R5 | Respond to a UART command within 100 ms |
| R6 | A front-panel button marks the current window as an event of interest |
| R7 | Survive power loss without corrupting the card |
| R8 | Report health over UART: uptime, samples, dropped, CPU, stack headroom |

Target: STM32F411, 100 MHz, 128 kB RAM, 512 kB flash.

Notice what R1, R5 and R7 are: three different timing requirements that cannot all be met by
one loop. That is the trigger from lesson 1 — this needs an RTOS, and now we can say why in
one sentence.

## From requirements to tasks

The decomposition rule: **one task per independent activity with its own timing requirement.**
Not one task per module, not one per peripheral.

![Project architecture](/MyPortfolio/images/rtos/project-architecture.svg)

| Task | Requirement | Period / trigger | Deadline |
| --- | --- | --- | --- |
| `sample_task` | R1 | DMA half/full complete, ~1 ms | 1 ms |
| `comms_task` | R4, R5 | UART bytes arrive | 100 ms |
| `app_task` | R2, R6, R8 | 1 s tick + commands | 1 s |
| `storage_task` | R3, R7 | a full 4 kB block | 1 s |

Four tasks. Resist adding more: every extra one costs a stack and a synchronisation edge.

Priorities follow rate-monotonic from lesson 2 — shortest deadline highest:

```c
/* priorities.h — the timing design, in one place */
#define PRIO_IDLE       0
#define PRIO_STORAGE    2    /* 1 s deadline, does the slow blocking work */
#define PRIO_APP        4    /* 1 s deadline, but must be responsive      */
#define PRIO_COMMS      5    /* 100 ms deadline                          */
#define PRIO_SAMPLE     6    /* 1 ms deadline — the tightest              */
```

Storage sits *below* app deliberately: it does a 40 ms blocking SD write, and nothing else may
wait on it.

## The budget, computed before writing code

**CPU utilisation** (lesson 2):

| Task | Execution | Period | Utilisation |
| --- | --- | --- | --- |
| `sample_task` | 150 µs | 1 ms | 0.15 |
| `comms_task` | 400 µs | 10 ms (bursts) | 0.04 |
| `app_task` | 1 ms | 1 s | 0.001 |
| `storage_task` | 40 ms | 1 s | 0.04 |
| | | **total** | **≈ 0.23** |

23%, comfortably under the ~69% rate-monotonic bound. There is room for the feature someone
will ask for in month six.

**RAM:**

```
stacks:  512 + 768 + 1024 + 1024 + 128 (idle) = 3456 words × 4 B = 13.8 kB
queues:  sample_q  64 × 16 B = 1.0 kB
         cmd_q     16 × 12 B = 0.2 kB
         stream    512 B                    = 0.5 kB
pool:    3 × 4 kB blocks                    = 12.0 kB
kernel:  TCBs, lists, timers                ≈ 0.6 kB
                                            --------
                                              28.1 kB of 128 kB
```

Doing this arithmetic *before* coding is the difference between a design and a hope. It also
tells you immediately that the block pool dominates, so that is the number to revisit if RAM
gets tight.

## The code

### Shared types

```c
/* app_types.h */
typedef struct {
    uint32_t seq;
    int16_t  x, y, z;
    uint32_t t_ms;
} sample_t;                              /* 16 bytes, POD */

typedef enum {
    CMD_TICK, CMD_START, CMD_STOP, CMD_SET_THRESHOLD,
    CMD_MARK_EVENT, CMD_REPORT_HEALTH,
} cmd_id_t;

typedef struct {
    cmd_id_t id;
    int32_t  arg;
    uint32_t t_ms;
} cmd_t;                                 /* 12 bytes */
```

### Sampling — ISR to task

```c
static TaskHandle_t      h_sample;
static QueueHandle_t     q_sample;
static volatile uint32_t dropped_samples;

/* DMA delivers 8 samples per interrupt into a double buffer */
void DMA2_Stream0_IRQHandler(void)
{
    BaseType_t woken = pdFALSE;

    if (DMA2->LISR & DMA_LISR_TCIF0) {
        DMA2->LIFCR = DMA_LIFCR_CTCIF0;
        dma_half = 1;
        vTaskNotifyGiveFromISR(h_sample, &woken);      /* lesson 5: fastest path */
    }
    portYIELD_FROM_ISR(woken);
}

static void sample_task(void *arg)
{
    h_sample = xTaskGetCurrentTaskHandle();
    uint32_t seq = 0;

    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);       /* zero CPU while waiting */

        const raw_t *src = dma_half ? &dma_buf[8] : &dma_buf[0];

        for (int i = 0; i < 8; i++) {
            sample_t s = {
                .seq  = seq++,
                .x    = accel_scale(src[i].x),
                .y    = accel_scale(src[i].y),
                .z    = accel_scale(src[i].z),
                .t_ms = xTaskGetTickCount(),
            };
            if (xQueueSend(q_sample, &s, 0) != pdPASS) {
                dropped_samples++;      /* never block a 1 ms deadline (lesson 3) */
            }
        }
    }
}
```

Note the two deliberate choices: notification rather than a queue for the ISR path, and
timeout `0` on the send with a counter. R1 says "no dropped samples", and `dropped_samples`
is how you *prove* it rather than assume it.

### Application — the state machine owns everything

```c
typedef enum { ST_IDLE, ST_LOGGING, ST_FLUSHING, ST_ERROR } state_t;

static state_t state = ST_IDLE;
static uint8_t *cur_block;
static size_t   cur_used;

static void app_task(void *arg)
{
    cmd_t c;
    window_t win = {0};

    for (;;) {
        /* single owner of all state — no mutex anywhere in this file */
        if (xQueueReceive(q_cmd, &c, pdMS_TO_TICKS(50)) == pdPASS) {
            switch (c.id) {
            case CMD_START:
                if (state == ST_IDLE && block_acquire(&cur_block) == 0) {
                    cur_used = 0;
                    state = ST_LOGGING;
                }
                break;

            case CMD_STOP:
                if (state == ST_LOGGING) {
                    flush_current_block();
                    state = ST_IDLE;
                }
                break;

            case CMD_SET_THRESHOLD: threshold_mg = c.arg;      break;
            case CMD_MARK_EVENT:    win.flags |= WIN_MARKED;   break;   /* R6 */
            case CMD_REPORT_HEALTH: report_health();           break;   /* R8 */
            case CMD_TICK:          /* handled below */        break;
            }
        }

        /* drain whatever samples are available and accumulate the window */
        sample_t s;
        while (xQueueReceive(q_sample, &s, 0) == pdPASS) {
            window_accumulate(&win, &s);
        }

        if (window_is_complete(&win)) {                          /* R2 */
            append_to_block(&win);
            window_reset(&win);
        }
    }
}
```

The 50 ms receive timeout is what lets this task both react to commands promptly and make
progress on samples without a second task or any polling.

### Storage — the slow work, safely

```c
static void storage_task(void *arg)
{
    uint8_t *block;
    for (;;) {
        xQueueReceive(q_full_blocks, &block, portMAX_DELAY);

        /* 40 ms of blocking SD write. Nobody is waiting on us:
         * this task is priority 2, below everything that has a deadline. */
        if (sd_write_block(next_lba++, block, BLOCK_SIZE) != 0) {
            storage_errors++;
            cmd_t c = { .id = CMD_STOP };
            xQueueSend(q_cmd, &c, 0);          /* tell the app, do not decide here */
        }

        sd_flush();                            /* R7: commit before releasing */
        xQueueSend(q_free_blocks, &block, 0);  /* ownership returns to the pool */
    }
}
```

R7 — survive power loss — is two decisions: `sd_flush()` after every block so at most one
block is ever in flight, and the pool ownership transfer from lesson 3 so a block is never
written and reused at the same time.

### Bring-up

```c
int main(void)
{
    HAL_Init();
    SystemClock_Config();
    board_init();

    /* create everything before the scheduler starts — allows heap_1 (lesson 6) */
    q_sample      = xQueueCreate(64, sizeof(sample_t));
    q_cmd         = xQueueCreate(16, sizeof(cmd_t));
    q_free_blocks = xQueueCreate(3,  sizeof(uint8_t *));
    q_full_blocks = xQueueCreate(3,  sizeof(uint8_t *));
    sb_uart_rx    = xStreamBufferCreate(512, 1);
    configASSERT(q_sample && q_cmd && q_free_blocks && q_full_blocks && sb_uart_rx);

    block_pool_init();

    configASSERT(xTaskCreate(sample_task,  "sample",  512, NULL, PRIO_SAMPLE,  NULL));
    configASSERT(xTaskCreate(comms_task,   "comms",   768, NULL, PRIO_COMMS,   NULL));
    configASSERT(xTaskCreate(app_task,     "app",    1024, NULL, PRIO_APP,     NULL));
    configASSERT(xTaskCreate(storage_task, "storage",1024, NULL, PRIO_STORAGE, NULL));

    TimerHandle_t tick = xTimerCreate("tick", pdMS_TO_TICKS(1000), pdTRUE, NULL, tick_cb);
    xTimerStart(tick, 0);

    vTaskStartScheduler();
    for (;;) { }        /* only reached if the heap was too small */
}
```

Every creation call is wrapped in `configASSERT`. This is lesson 2's point restated: a device
where task four silently failed to be created is a miserable thing to debug in the field.

### The config that matters

```c
/* FreeRTOSConfig.h — the lines that are decisions, not defaults */
#define configUSE_PREEMPTION                    1
#define configTICK_RATE_HZ                      1000
#define configMAX_PRIORITIES                    7
#define configTOTAL_HEAP_SIZE                   (32 * 1024)

#define configCHECK_FOR_STACK_OVERFLOW          2      /* lesson 6 */
#define configUSE_MALLOC_FAILED_HOOK            1
#define configASSERT(x) if((x)==0){taskDISABLE_INTERRUPTS();for(;;);}

#define configUSE_TRACE_FACILITY                1      /* R8 */
#define configGENERATE_RUN_TIME_STATS           1
#define configUSE_STATS_FORMATTING_FUNCTIONS    1

#define configMAX_SYSCALL_INTERRUPT_PRIORITY    (5 << (8 - configPRIO_BITS))
```

## Diagnostics — requirement R8

R8 exists because a logger that stops logging must be diagnosable remotely:

```c
static void report_health(void)
{
    static char buf[512];

    printf("uptime_s=%lu\n", xTaskGetTickCount() / configTICK_RATE_HZ);
    printf("samples=%lu dropped=%lu\n", total_samples, dropped_samples);
    printf("blocks_written=%lu storage_errors=%lu\n", blocks_written, storage_errors);
    printf("q_sample_peak=%u/64 q_cmd_peak=%u/16\n", q_sample_peak, q_cmd_peak);
    printf("heap_min=%u\n", (unsigned)xPortGetMinimumEverFreeHeapSize());

    vTaskList(buf);              /* per-task state, priority, stack headroom */
    printf("%s", buf);
    vTaskGetRunTimeStats(buf);    /* per-task CPU %                          */
    printf("%s", buf);
}
```

The three lines that earn their place: `dropped` proves R1, `q_sample_peak` tells you whether
the queue is right-sized, and `heap_min` warns you before an allocation fails.

Track the peaks where they happen:

```c
UBaseType_t w = uxQueueMessagesWaiting(q_sample);
if (w > q_sample_peak) q_sample_peak = w;
```

## Validating it

Design work is not finished until measured. In order:

1. **Function.** Every requirement, once, by hand.
2. **Stack headroom.** Run the heaviest load — logging, UART flooded, button pressed — then
   read every high-water mark and cut the stacks to used + 30% (lesson 6).
3. **Timing.** GPIO on entry/exit of `sample_task`, on a scope. Confirm the 1 ms deadline is
   met in the worst case, which is *during an SD write*, since that is when the CPU is busiest.
4. **Soak.** 72 hours logging continuously. `dropped_samples` must be 0 and `heap_min` must be
   flat. A rising `heap_min` is a leak; a rising queue peak is a sizing error.
5. **Power loss.** Pull the plug 50 times during writes. The card must always mount and the
   last complete block must always be readable.
6. **Tick wraparound.** Preload `xTickCount` near `0xFFFFFFFF` in a debug build and let it
   wrap. At 1 kHz this happens after 49.7 days — in the field, never on your bench (lesson 6).

Step 6 is the one people skip, and it is the one that produces a support call fourteen months
after shipping.

## What this example demonstrates

Every lesson in the series, in one artefact:

| Lesson | Where it appears |
| --- | --- |
| 1 — why an RTOS | R1/R5/R7 are three timing requirements one loop cannot meet |
| 2 — tasks, priorities | rate-monotonic assignment, computed utilisation |
| 3 — queues | sample queue, command queue, block pool ownership |
| 4 — synchronisation | **no mutex anywhere** — one owner per piece of state |
| 5 — interrupts | notification from DMA, stream buffer from UART |
| 6 — memory | budget computed up front, overflow detection, shipped diagnostics |
| 7 — timers, buffers | 1 s software timer, stream buffer, debounced button |
| 8 — low power | not needed here (mains powered) — and that is a decision, recorded |
| 9 — SMP | single core, so pinning does not apply |

The line worth ending on is the fourth: **no mutex anywhere.** Not because mutexes are bad,
but because the design gave every piece of state exactly one owner and moved data through
queues. That is what the whole series has been building towards — an architecture where the
hardest class of RTOS bug simply has nowhere to occur.

## Series recap

1. What an RTOS buys and costs, and the test for whether you need one.
2. Task states, fixed-priority preemption, rate-monotonic assignment.
3. Queues as the default; pointer passing and buffer pools.
4. Mutex vs semaphore, priority inheritance, deadlock rules.
5. Deferred interrupt handling, `FromISR`, the Cortex-M priority threshold.
6. Heap schemes, evidence-based stack sizing, overflow detection, diagnostics.
7. Software timers, event groups, stream and message buffers.
8. Tickless idle, the peripheral power budget, honest current measurement.
9. SMP, affinity, spinlocks, and choosing between FreeRTOS, Zephyr and ThreadX.
10. One complete device, from requirements to validation.

An RTOS does not give you real-time behaviour. It gives you the mechanisms, and the discipline
— computed priorities, bounded critical sections, short ISRs, one owner per piece of state, and
numbers instead of hope — is what makes a system meet its deadlines.
