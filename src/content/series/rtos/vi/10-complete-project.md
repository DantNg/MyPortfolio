---
lesson: 10
lang: vi
title: "Một thiết bị hoàn chỉnh, thiết kế từ yêu cầu đi xuống"
description: "Một ví dụ trọn vẹn: từ yêu cầu tới phân rã task, ưu tiên suy ra từ deadline, ngân sách CPU và RAM tính bằng số, code, và bộ chẩn đoán đi kèm sản phẩm."
duration: "20 phút"
tags: ["FreeRTOS", "Kiến trúc", "Dự án"]
---

## Yêu cầu

Một thiết bị ghi dữ liệu rung cho máy công nghiệp. Ví dụ này cố tình chọn thứ bình thường — nó
mang hình dáng của phần lớn sản phẩm nhúng thật:

| # | Yêu cầu |
| --- | --- |
| R1 | Lấy mẫu gia tốc 3 trục ở 1 kHz, không được mất mẫu nào |
| R2 | Tính RMS và giá trị đỉnh theo từng trục trên cửa sổ 1 giây |
| R3 | Ghi các cửa sổ ra thẻ SD theo khối 4 kB |
| R4 | Nhận cấu hình qua UART 115200 (đặt ngưỡng, bắt đầu/dừng) |
| R5 | Phản hồi lệnh UART trong vòng 100 ms |
| R6 | Nút trên mặt máy đánh dấu cửa sổ hiện tại là sự kiện đáng quan tâm |
| R7 | Mất điện đột ngột không được làm hỏng thẻ |
| R8 | Báo cáo sức khoẻ qua UART: uptime, số mẫu, số mẫu mất, CPU, stack còn dư |

Đích: STM32F411, 100 MHz, 128 kB RAM, 512 kB flash.

Hãy để ý R1, R5 và R7 là gì: ba yêu cầu định thời khác nhau mà một vòng lặp duy nhất không thể
thoả cả ba. Đó chính là dấu hiệu ở bài 1 — chỗ này cần RTOS, và giờ ta nói được lý do trong một
câu.

## Từ yêu cầu ra task

Quy tắc phân rã: **một task cho mỗi hoạt động độc lập có yêu cầu định thời riêng.** Không phải
một task cho mỗi module, cũng không phải một task cho mỗi ngoại vi.

![Kiến trúc dự án](/MyPortfolio/images/rtos/project-architecture.svg)

| Task | Yêu cầu | Chu kỳ / kích hoạt | Deadline |
| --- | --- | --- | --- |
| `sample_task` | R1 | DMA xong nửa/đầy, ~1 ms | 1 ms |
| `comms_task` | R4, R5 | có byte UART tới | 100 ms |
| `app_task` | R2, R6, R8 | tick 1 s + các lệnh | 1 s |
| `storage_task` | R3, R7 | một khối 4 kB đã đầy | 1 s |

Bốn task. Hãy cưỡng lại việc thêm nữa: mỗi task thêm vào tốn một stack và một điểm đồng bộ.

Ưu tiên suy ra theo rate-monotonic ở bài 2 — deadline ngắn nhất thì ưu tiên cao nhất:

```c
/* priorities.h — thiết kế định thời, gom một chỗ */
#define PRIO_IDLE       0
#define PRIO_STORAGE    2    /* deadline 1 s, làm phần chậm và chặn      */
#define PRIO_APP        4    /* deadline 1 s, nhưng phải phản hồi nhanh  */
#define PRIO_COMMS      5    /* deadline 100 ms                          */
#define PRIO_SAMPLE     6    /* deadline 1 ms — khắt khe nhất             */
```

Storage nằm *dưới* app một cách có chủ đích: nó ghi SD chặn 40 ms, và không ai được phép chờ nó.

## Ngân sách, tính trước khi viết code

**Mức sử dụng CPU** (bài 2):

| Task | Thời gian chạy | Chu kỳ | Mức sử dụng |
| --- | --- | --- | --- |
| `sample_task` | 150 µs | 1 ms | 0,15 |
| `comms_task` | 400 µs | 10 ms (cụm) | 0,04 |
| `app_task` | 1 ms | 1 s | 0,001 |
| `storage_task` | 40 ms | 1 s | 0,04 |
| | | **tổng** | **≈ 0,23** |

23%, thấp hơn hẳn ngưỡng ~69% của rate-monotonic. Vẫn còn chỗ cho tính năng mà đến tháng thứ
sáu sẽ có người yêu cầu thêm.

**RAM:**

```
stack:   512 + 768 + 1024 + 1024 + 128 (idle) = 3456 từ × 4 B = 13,8 kB
queue:   sample_q  64 × 16 B = 1,0 kB
         cmd_q     16 × 12 B = 0,2 kB
         stream    512 B                    = 0,5 kB
bể khối: 3 × 4 kB                           = 12,0 kB
kernel:  TCB, danh sách, timer               ≈ 0,6 kB
                                            --------
                                              28,1 kB trên 128 kB
```

Làm phép tính này *trước* khi code là khác biệt giữa một bản thiết kế và một niềm hy vọng. Nó
cũng cho bạn biết ngay rằng bể khối chiếm phần lớn, nên đó là con số cần xem lại đầu tiên nếu
RAM căng.

## Code

### Kiểu dữ liệu dùng chung

```c
/* app_types.h */
typedef struct {
    uint32_t seq;
    int16_t  x, y, z;
    uint32_t t_ms;
} sample_t;                              /* 16 byte, dữ liệu thuần */

typedef enum {
    CMD_TICK, CMD_START, CMD_STOP, CMD_SET_THRESHOLD,
    CMD_MARK_EVENT, CMD_REPORT_HEALTH,
} cmd_id_t;

typedef struct {
    cmd_id_t id;
    int32_t  arg;
    uint32_t t_ms;
} cmd_t;                                 /* 12 byte */
```

### Lấy mẫu — từ ISR sang task

```c
static TaskHandle_t      h_sample;
static QueueHandle_t     q_sample;
static volatile uint32_t dropped_samples;

/* DMA đưa về 8 mẫu mỗi lần ngắt, dùng buffer kép */
void DMA2_Stream0_IRQHandler(void)
{
    BaseType_t woken = pdFALSE;

    if (DMA2->LISR & DMA_LISR_TCIF0) {
        DMA2->LIFCR = DMA_LIFCR_CTCIF0;
        dma_half = 1;
        vTaskNotifyGiveFromISR(h_sample, &woken);      /* bài 5: đường nhanh nhất */
    }
    portYIELD_FROM_ISR(woken);
}

static void sample_task(void *arg)
{
    h_sample = xTaskGetCurrentTaskHandle();
    uint32_t seq = 0;

    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);       /* 0% CPU trong lúc chờ */

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
                dropped_samples++;      /* đừng bao giờ chặn deadline 1 ms (bài 3) */
            }
        }
    }
}
```

Hãy để ý hai lựa chọn có chủ đích: dùng notification thay vì queue cho đường ISR, và timeout
`0` khi gửi kèm một bộ đếm. R1 nói "không được mất mẫu", và `dropped_samples` là cách bạn
*chứng minh* điều đó thay vì cho là như vậy.

### Ứng dụng — máy trạng thái sở hữu mọi thứ

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
        /* chủ duy nhất của toàn bộ trạng thái — cả file này không có mutex nào */
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
            case CMD_TICK:          /* xử lý ở dưới */         break;
            }
        }

        /* rút hết mẫu đang có và cộng dồn vào cửa sổ */
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

Timeout 50 ms khi nhận là thứ cho phép task này vừa phản hồi lệnh nhanh vừa tiến triển việc xử
lý mẫu, mà không cần task thứ hai và không cần hỏi vòng.

### Lưu trữ — phần chậm, làm cho an toàn

```c
static void storage_task(void *arg)
{
    uint8_t *block;
    for (;;) {
        xQueueReceive(q_full_blocks, &block, portMAX_DELAY);

        /* 40 ms ghi SD có chặn. Không ai đang chờ chúng ta:
         * task này ưu tiên 2, dưới mọi thứ có deadline. */
        if (sd_write_block(next_lba++, block, BLOCK_SIZE) != 0) {
            storage_errors++;
            cmd_t c = { .id = CMD_STOP };
            xQueueSend(q_cmd, &c, 0);          /* báo cho app, đừng tự quyết ở đây */
        }

        sd_flush();                            /* R7: chốt dữ liệu trước khi nhả */
        xQueueSend(q_free_blocks, &block, 0);  /* trả quyền sở hữu về bể */
    }
}
```

R7 — sống sót qua mất điện — là hai quyết định: gọi `sd_flush()` sau mỗi khối để tối đa chỉ một
khối đang dở, và cơ chế chuyển quyền sở hữu qua bể ở bài 3 để một khối không bao giờ vừa được
ghi lại vừa bị dùng lại.

### Khởi tạo

```c
int main(void)
{
    HAL_Init();
    SystemClock_Config();
    board_init();

    /* tạo mọi thứ trước khi scheduler chạy — nhờ vậy dùng được heap_1 (bài 6) */
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
    for (;;) { }        /* chỉ tới đây nếu heap quá nhỏ */
}
```

Mọi lời gọi tạo đối tượng đều được bọc trong `configASSERT`. Đây là điều bài 2 đã nói, nhắc lại
một lần nữa: một thiết bị mà task thứ tư âm thầm không được tạo là thứ khổ sở để gỡ lỗi ngoài
thực địa.

### Cấu hình quan trọng

```c
/* FreeRTOSConfig.h — những dòng là quyết định, không phải giá trị mặc định */
#define configUSE_PREEMPTION                    1
#define configTICK_RATE_HZ                      1000
#define configMAX_PRIORITIES                    7
#define configTOTAL_HEAP_SIZE                   (32 * 1024)

#define configCHECK_FOR_STACK_OVERFLOW          2      /* bài 6 */
#define configUSE_MALLOC_FAILED_HOOK            1
#define configASSERT(x) if((x)==0){taskDISABLE_INTERRUPTS();for(;;);}

#define configUSE_TRACE_FACILITY                1      /* R8 */
#define configGENERATE_RUN_TIME_STATS           1
#define configUSE_STATS_FORMATTING_FUNCTIONS    1

#define configMAX_SYSCALL_INTERRUPT_PRIORITY    (5 << (8 - configPRIO_BITS))
```

## Chẩn đoán — yêu cầu R8

R8 tồn tại vì một thiết bị ghi dữ liệu mà ngừng ghi thì phải chẩn đoán được từ xa:

```c
static void report_health(void)
{
    static char buf[512];

    printf("uptime_s=%lu\n", xTaskGetTickCount() / configTICK_RATE_HZ);
    printf("samples=%lu dropped=%lu\n", total_samples, dropped_samples);
    printf("blocks_written=%lu storage_errors=%lu\n", blocks_written, storage_errors);
    printf("q_sample_peak=%u/64 q_cmd_peak=%u/16\n", q_sample_peak, q_cmd_peak);
    printf("heap_min=%u\n", (unsigned)xPortGetMinimumEverFreeHeapSize());

    vTaskList(buf);              /* trạng thái, ưu tiên, stack còn dư theo task */
    printf("%s", buf);
    vTaskGetRunTimeStats(buf);    /* % CPU theo task                            */
    printf("%s", buf);
}
```

Ba dòng xứng đáng có mặt: `dropped` chứng minh R1, `q_sample_peak` cho biết queue có đúng cỡ
chưa, và `heap_min` cảnh báo bạn trước khi có lần cấp phát thất bại.

Hãy theo dõi đỉnh ngay tại nơi nó xảy ra:

```c
UBaseType_t w = uxQueueMessagesWaiting(q_sample);
if (w > q_sample_peak) q_sample_peak = w;
```

## Kiểm chứng

Việc thiết kế chưa xong cho tới khi đo đạc. Theo thứ tự:

1. **Chức năng.** Từng yêu cầu, mỗi cái một lần, bằng tay.
2. **Stack còn dư.** Chạy tải nặng nhất — đang ghi log, UART bị dội liên tục, có nhấn nút — rồi
   đọc mọi high-water mark và cắt stack về mức đã dùng + 30% (bài 6).
3. **Định thời.** Kéo GPIO ở lúc vào/ra `sample_task`, xem trên máy hiện sóng. Xác nhận deadline
   1 ms vẫn đạt ở trường hợp xấu nhất, chính là *trong lúc đang ghi SD*, vì đó là lúc CPU bận
   nhất.
4. **Chạy dài.** 72 giờ ghi liên tục. `dropped_samples` phải bằng 0 và `heap_min` phải phẳng.
   `heap_min` tụt dần là rò rỉ; đỉnh queue tăng dần là tính sai kích thước.
5. **Mất điện.** Rút phích 50 lần trong lúc đang ghi. Thẻ phải luôn mount được và khối hoàn
   chỉnh cuối cùng phải luôn đọc được.
6. **Tràn bộ đếm tick.** Nạp trước `xTickCount` gần `0xFFFFFFFF` trong bản debug và để nó tràn.
   Ở 1 kHz việc này xảy ra sau 49,7 ngày — ngoài thực địa thì có, trên bàn bạn thì không bao giờ
   (bài 6).

Bước 6 là bước người ta hay bỏ qua, và cũng là bước sinh ra một cuộc gọi hỗ trợ mười bốn tháng
sau khi xuất xưởng.

## Ví dụ này minh hoạ điều gì

Mọi bài trong series, gói trong một sản phẩm:

| Bài | Xuất hiện ở đâu |
| --- | --- |
| 1 — vì sao cần RTOS | R1/R5/R7 là ba yêu cầu định thời một vòng lặp không thoả nổi |
| 2 — task, ưu tiên | gán theo rate-monotonic, mức sử dụng tính bằng số |
| 3 — queue | queue mẫu, queue lệnh, quyền sở hữu qua bể khối |
| 4 — đồng bộ | **không có mutex nào** — mỗi phần trạng thái đúng một chủ |
| 5 — ngắt | notification từ DMA, stream buffer từ UART |
| 6 — bộ nhớ | ngân sách tính trước, phát hiện tràn, chẩn đoán trong sản phẩm |
| 7 — timer, buffer | software timer 1 s, stream buffer, nút đã chống dội |
| 8 — tiết kiệm điện | không cần ở đây (cấp nguồn lưới) — và đó là một quyết định, có ghi lại |
| 9 — SMP | một nhân, nên không có chuyện ghim nhân |

Dòng đáng để kết lại là dòng thứ tư: **không có mutex nào.** Không phải vì mutex là xấu, mà vì
bản thiết kế đã cho mỗi phần trạng thái đúng một chủ và chuyển dữ liệu qua queue. Đó chính là
điều cả series hướng tới — một kiến trúc mà lớp lỗi khó nhất của RTOS đơn giản là không có chỗ
để phát sinh.

## Tóm tắt cả series

1. RTOS cho gì và lấy đi gì, cùng bài kiểm tra xem bạn có cần nó.
2. Trạng thái task, giành quyền theo ưu tiên cố định, gán theo rate-monotonic.
3. Queue là mặc định; truyền con trỏ và bể buffer.
4. Mutex và semaphore, kế thừa ưu tiên, các quy tắc tránh deadlock.
5. Xử lý ngắt hoãn lại, `FromISR`, ngưỡng ưu tiên Cortex-M.
6. Sơ đồ heap, tính stack dựa trên bằng chứng, phát hiện tràn, chẩn đoán.
7. Software timer, event group, stream buffer và message buffer.
8. Tickless idle, ngân sách điện của ngoại vi, đo dòng cho trung thực.
9. SMP, ghim nhân, spinlock, và chọn giữa FreeRTOS, Zephyr, ThreadX.
10. Một thiết bị hoàn chỉnh, từ yêu cầu tới kiểm chứng.

RTOS không cho bạn hành vi thời gian thực. Nó cho bạn cơ chế, còn kỷ luật — ưu tiên tính bằng
số, đoạn găng có giới hạn, ISR ngắn, mỗi phần trạng thái một chủ, và số liệu thay cho hy vọng —
mới là thứ khiến hệ thống đạt deadline.
