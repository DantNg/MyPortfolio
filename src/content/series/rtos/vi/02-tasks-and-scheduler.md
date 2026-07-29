---
lesson: 2
lang: vi
title: "Task, trạng thái và bộ lập lịch"
description: "Bốn trạng thái của task, ưu tiên thực sự nghĩa là gì, chính xác lúc nào xảy ra chuyển ngữ cảnh, và một phương pháp gán ưu tiên không phải bằng cách đoán."
duration: "15 phút"
tags: ["RTOS", "Scheduler", "Ưu tiên"]
---

## Task là một hàm không bao giờ trả về

```c
void my_task(void *pvParameters)
{
    my_ctx_t *ctx = (my_ctx_t *)pvParameters;   /* truyền vào lúc tạo task */

    init_something();          /* chạy một lần */

    for (;;) {                 /* chạy mãi mãi */
        do_work(ctx);
        vTaskDelay(pdMS_TO_TICKS(100));
    }
    /* rơi ra khỏi đây là lỗi — xem bên dưới */
}
```

Nếu hàm task trả về, FreeRTOS gọi hook lỗi và thường là treo luôn. Task nào thật sự cần kết
thúc thì phải tự xoá mình:

```c
vTaskDelete(NULL);     /* NULL = "chính tôi" */
```

Mỗi task có stack riêng và bản sao riêng của các thanh ghi CPU. Toàn bộ phép màu nằm ở đó:
khi scheduler chuyển, nó lưu thanh ghi hiện tại vào stack của task đang chạy rồi khôi phục
thanh ghi của task kế tiếp. Mọi thứ khác — biến toàn cục, ngoại vi, flash — đều dùng chung,
và đó chính xác là nơi sinh ra các vấn đề của bài 4.

## Bốn trạng thái

![Trạng thái của task](/MyPortfolio/images/rtos/task-states.svg)

| Trạng thái | Ý nghĩa |
| --- | --- |
| **Running** | đang thực sự chạy. Mỗi nhân đúng một task. |
| **Ready** | chạy được, đang chờ CPU vì có task ưu tiên cao hơn đang giữ. |
| **Blocked** | đang chờ thời gian hoặc sự kiện. **Không tốn CPU.** |
| **Suspended** | bị gỡ hẳn khỏi lịch cho tới khi có ai đó gọi resume. |

Câu quan trọng nhất của cả series: **task ở Blocked không tốn gì cả.** Đó là lý do RTOS cho
phép bạn viết

```c
xQueueReceive(q, &msg, portMAX_DELAY);
```

thay vì

```c
while (!flag) { }        /* đốt 100% CPU và bỏ đói mọi thứ bên dưới */
```

Nếu thấy mình đang hỏi vòng một cái cờ trong task, tức là bạn đang chống lại kernel. Gần
như luôn có một cơ chế — queue, semaphore, notification, event group — biến việc đó thành
một lần chặn.

## Ưu tiên nghĩa là gì

FreeRTOS là bộ lập lịch **ưu tiên cố định, có giành quyền**. Luật chỉ gồm một dòng:

> Task có ưu tiên cao nhất mà đang ở Ready thì luôn được chạy.

Không phải "được nhiều thời gian CPU hơn". Không phải "chạy thường xuyên hơn". Mà là *luôn
chạy*, ngay lập tức, giành quyền khỏi thứ đang chạy đúng khoảnh khắc nó chuyển sang Ready.

Những hệ quả hay làm người ta bất ngờ:

- **Một task ưu tiên cao mà không bao giờ chặn sẽ bỏ đói mọi thứ bên dưới. Vĩnh viễn.**
  Không phải "dần dần được ít CPU hơn" — mà là không bao giờ chạy. Đây là lỗi đầu tiên kinh
  điển.
- **Các task cùng ưu tiên chia nhau theo vòng**, mỗi task một tick, nếu
  `configUSE_TIME_SLICING` bằng 1 (mặc định).
- **Ưu tiên không phải mức gấp của công việc, mà là mức gấp của phản hồi.** Một task phải
  phản ứng trong 1 ms rồi mới làm việc mất 10 ms vẫn xứng đáng ưu tiên cao — miễn là sau đó
  nó chặn lại.

Trong FreeRTOS, **0 là thấp nhất** (task idle nằm ở đó) và `configMAX_PRIORITIES - 1` là cao
nhất. Lưu ý điều này ngược với nhiều kernel khác và ngược với ưu tiên ngắt NVIC của
Cortex-M, nơi số nhỏ hơn nghĩa là *gấp hơn*. Nhầm lẫn hai thứ này trong cùng một file là
nghi thức trưởng thành của nghề.

## Chính xác lúc nào thì chuyển ngữ cảnh?

Chỉ ở những thời điểm này:

1. **Ngắt tick nổ** (mặc định 1 kHz) và có task ưu tiên cao hơn vừa chuyển sang Ready — ví
   dụ hết thời gian delay.
2. **Task đang chạy tự chặn** — `vTaskDelay`, nhận từ queue rỗng, lấy mutex đang bị giữ.
3. **Task đang chạy làm cho một task ưu tiên cao hơn sẵn sàng** — gửi vào queue mà task đó
   đang chờ. Việc chuyển xảy ra *ngay bên trong lời gọi API đó*, trước khi nó trả về.
4. **Một ISR làm task ưu tiên cao hơn sẵn sàng** và gọi `portYIELD_FROM_ISR()` (bài 5).
5. **Task tự nguyện nhường** bằng `taskYIELD()`.

Không còn trường hợp nào khác. Nếu một task không chặn và cũng không gọi API nào của kernel,
nó chạy tới tick kế tiếp, và nếu nó là ưu tiên cao nhất thì sau tick nó vẫn chạy tiếp.

## Chọn ưu tiên

Đừng rải số ma thuật khắp code. Hãy gom vào một header và đặt tên:

```c
/* priorities.h — toàn bộ thiết kế định thời của sản phẩm, nằm ở một chỗ */
#define PRIO_IDLE          0        /* kernel giữ chỗ            */
#define PRIO_LOGGING       1        /* lúc nào rảnh thì chạy     */
#define PRIO_DISPLAY       2        /* 30 Hz là đủ               */
#define PRIO_APP_LOGIC     3
#define PRIO_SENSOR_LOOP   4        /* vòng điều khiển 100 Hz    */
#define PRIO_COMMS         5        /* phải rút kịp FIFO của UART*/
#define PRIO_SAFETY        6        /* ngắt khi quá dòng         */
```

Phương pháp — **rate-monotonic**, đã được chứng minh là tối ưu với ưu tiên cố định:

> **Chu kỳ càng ngắn thì ưu tiên càng cao.**

Vòng 1 ms xếp trên vòng 10 ms, vòng 10 ms xếp trên việc vẽ màn hình mỗi 100 ms. Với task
hướng sự kiện, dùng deadline thay cho chu kỳ: thứ phải phản hồi trong 2 ms thì coi như có
chu kỳ 2 ms.

Thêm hai quy tắc thực dụng:

- **Giữ số mức ưu tiên ít thôi** — năm tới bảy mức. Mỗi mức thêm vào là một quyết định bạn
  sẽ phải biện minh về sau, và `configMAX_PRIORITIES` tốn RAM (mỗi mức một đầu danh sách).
- **Chừa khoảng trống** nếu cấu hình cho phép, để sau này chèn thêm mức mà không phải đánh
  số lại toàn bộ.

Cuối cùng, một phép kiểm tra làm được trên giấy. Với các task định kỳ, tính mức sử dụng CPU:

```
U = Σ (thời_gian_chạy / chu_kỳ)
```

Việc 2 ms mỗi 10 ms cộng việc 5 ms mỗi 50 ms cho `0,2 + 0,1 = 0,3`, tức 30%. Theo lý thuyết
rate-monotonic, `n` task chắc chắn xếp lịch được nếu `U ≤ n(2^(1/n) − 1)` — khoảng 0,69 khi
số task lớn. **Vượt quá 70% là bạn đang sống nguy hiểm**, bất kể trên bàn thử mọi thứ trông
vẫn ổn.

## Tạo task

```c
BaseType_t ok = xTaskCreate(
        sensor_task,          /* hàm                                  */
        "sensor",             /* tên — hiện ra trong debugger         */
        256,                  /* độ sâu stack tính bằng TỪ (=1 kB)    */
        &sensor_ctx,          /* tham số truyền vào task              */
        PRIO_SENSOR_LOOP,     /* ưu tiên                              */
        &sensor_handle);      /* out: handle, hoặc NULL nếu không cần */

configASSERT(ok == pdPASS);   /* thất bại khi hết heap                */
```

Cái `configASSERT` đó quan trọng. `xTaskCreate` cấp phát stack và TCB từ heap của FreeRTOS,
và khi hết heap nó trả về `errCOULD_NOT_ALLOCATE_REQUIRED_MEMORY` — trong im lặng, nếu bạn
không kiểm tra. Một sản phẩm mà task thứ năm âm thầm không bao giờ được tạo là thứ cực kỳ
khổ sở để gỡ lỗi.

Với công việc an toàn quan trọng hoặc thiếu bộ nhớ, hãy cấp phát tĩnh để triệt tiêu hẳn kiểu
hỏng này:

```c
static StaticTask_t sensor_tcb;
static StackType_t  sensor_stack[256];

xTaskCreateStatic(sensor_task, "sensor", 256, &ctx,
                  PRIO_SENSOR_LOOP, sensor_stack, &sensor_tcb);
```

Đây là cách bạn dùng khi tắt `configSUPPORT_DYNAMIC_ALLOCATION` — rất phổ biến trong firmware
ô tô và y tế, nơi cấp phát động sau khi khởi động là điều đơn giản là không được phép.

## Làm việc định kỳ cho đúng

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

`vTaskDelayUntil` tính thời điểm đánh thức kế tiếp dựa trên lần đánh thức *trước*, nên độ
dao động của phần xử lý không tích luỹ thành trôi chu kỳ. Với `vTaskDelay(period)`, chu kỳ
thực tế thành `thời_gian_xử_lý + period` và trượt dần — nhìn trên máy hiện sóng một phút thì
không thấy, sau một giờ thì lộ rõ.

> Nếu phần xử lý lỡ dài hơn chu kỳ, `vTaskDelayUntil` trả về ngay và bạn âm thầm mất một
> nhịp. Từ FreeRTOS 10.4 trở đi, `xTaskDelayUntil()` trả `pdFALSE` đúng trong trường hợp
> này — hãy kiểm tra và đếm số lần quá hạn. Bộ đếm đó là chỉ số sức khoẻ thời gian thực rẻ
> nhất bạn từng thêm vào.

## Xem scheduler đang làm gì

```c
/* bật trong FreeRTOSConfig.h */
#define configUSE_TRACE_FACILITY             1
#define configGENERATE_RUN_TIME_STATS        1
#define configUSE_STATS_FORMATTING_FUNCTIONS 1

char buf[512];
vTaskGetRunTimeStats(buf);   /* % CPU theo từng task */
vTaskList(buf);              /* trạng thái, ưu tiên, mức stack còn lại */
printf("%s", buf);
```

Kết quả của `vTaskList` trông như dưới đây, và trả lời gần hết các câu "sao nó chậm thế" chỉ
trong một lần nhìn:

```
Name          State  Priority  Stack  Num
sensor          B        4       118    2
comms           R        5        64    3
display         B        2       201    4
IDLE            R        0       112    1
```

Cột `Stack` là phần **còn dư**, tính bằng từ — chính là high-water mark ở bài 6. Con số `64`
nghĩa là task đó đã tiến tới sát mép tràn, chỉ còn 256 byte.

## Tự kiểm tra

1. Chuyện gì xảy ra với task ưu tiên 2 nếu task ưu tiên 3 không bao giờ chặn?
2. Kể ra năm thời điểm có thể xảy ra chuyển ngữ cảnh.
3. Vì sao `vTaskDelay` bị trôi còn `vTaskDelayUntil` thì không?
4. Một task lấy mẫu mỗi 5 ms, mất 1 ms; task khác chạy mỗi 20 ms, mất 4 ms. Mức sử dụng CPU
   là bao nhiêu, và task nào được ưu tiên cao hơn?

<details>
<summary>Đáp án câu 4</summary>

`1/5 + 4/20 = 0,2 + 0,2 = 0,4` → 40% mức sử dụng, xếp lịch được thoải mái. Theo
rate-monotonic: task 5 ms có chu kỳ ngắn hơn nên được ưu tiên cao hơn.
</details>

## Bài tiếp theo

Bài 3: các task nói chuyện với nhau thế nào. Queue, khác biệt giữa chia sẻ bộ nhớ và truyền
thông điệp, và vì sao queue nên là câu trả lời mặc định của bạn.
