---
lesson: 1
lang: vi
title: "Khi superloop không còn đủ"
description: "RTOS thực sự đem lại gì, đánh đổi những gì, và bài kiểm tra thẳng thắn xem dự án của bạn có cần nó không."
duration: "12 phút"
tags: ["RTOS", "FreeRTOS", "Thời gian thực"]
---

## Câu hỏi ít ai đặt ra trước

"Có nên dùng RTOS không?" thường được trả lời theo thói quen chứ không theo phân tích. Vậy
hãy bắt đầu từ đúng thứ mà RTOS sinh ra để làm.

RTOS không làm code chạy nhanh hơn. Cũng không làm nó nhỏ đi. Thứ nó cho bạn là **độ trễ có
giới hạn cho phần việc quan trọng**, bằng cách để bạn tuyên bố *cái này quan trọng hơn cái
kia* và có một cỗ máy đứng ra thực thi tuyên bố đó.

## Superloop gãy ở đâu

![Superloop và RTOS](/MyPortfolio/images/rtos/superloop-vs-rtos.svg)

Superloop không có gì sai, và với rất nhiều sản phẩm nó là câu trả lời đúng:

```c
while (1) {
    read_sensor();       /*  2 ms */
    update_display();    /* 40 ms */
    handle_uart();       /*  1 ms */
}
```

Vấn đề nằm ở phép cộng. Độ trễ xấu nhất của `handle_uart()` bằng tổng mọi thứ còn lại trong
vòng lặp — ở đây là 42 ms. Nếu đầu bên kia gửi một khung mỗi 20 ms mà buffer nhận chỉ chứa
được một khung, bạn mất dữ liệu. Không phải thỉnh thoảng: mất một cách có thể đoán trước.

Bạn có thể chống lại điều này mà không cần RTOS, và người ta vẫn làm:

- **Xé việc chậm thành máy trạng thái** để mỗi vòng lặp đều ngắn. Cách này chạy được và
  thường là cách sửa đúng. Nó cũng biến đoạn code tuần tự dễ đọc thành một đống `switch`
  với ngữ cảnh phải tự giữ trong biến toàn cục.
- **Làm nhiều hơn trong ngắt.** Cũng chạy được, cho tới khi hai ISR cần chia sẻ dữ liệu và
  bạn học về đồng thời theo cách đau đớn.
- **Thêm một scheduler mini** — một bảng con trỏ hàm kèm chu kỳ. Xin chúc mừng, bạn vừa
  viết một RTOS hợp tác. Đó là lựa chọn chính đáng, nhưng hãy thành thật rằng giờ bạn sở
  hữu và phải tự gỡ lỗi cho code scheduler đó.

Câu trả lời của RTOS thì khác: giữ code tuần tự và dễ đọc, để scheduler quyết định ai chạy.

```c
void uart_task(void *p)
{
    for (;;) {
        xQueueReceive(rx_queue, &msg, portMAX_DELAY);   /* ngủ ở đây */
        handle(&msg);                                    /* chạy sau vài µs kể từ khi có tin */
    }
}
```

Task đó tiêu tốn **0% CPU** trong lúc chờ, và giành quyền chạy khỏi task hiển thị ngay
khoảnh khắc có tin nhắn tới.

## "Thời gian thực" nghĩa là gì

Thời gian thực không có nghĩa là nhanh. Nó nghĩa là **deadline là một phần của đặc tả, và
trễ hạn là hỏng**.

| | Ý nghĩa | Ví dụ |
| --- | --- | --- |
| Hard real-time | trễ hạn là hệ thống hỏng | chuyển mạch động cơ, túi khí |
| Firm real-time | kết quả trễ thì vô dụng nhưng không nguy hiểm | một khung dữ liệu hợp nhất cảm biến |
| Soft real-time | trễ thì kém đi nhưng chấp nhận được | vẽ lại giao diện, ghi log |

Một MCU 200 MHz thỉnh thoảng mất 50 ms mới phản hồi thì tệ hơn — với hard real-time — so
với một con 8 MHz luôn phản hồi trong 2 ms. **Tính dự đoán được thắng tốc độ.**

Đó cũng là lý do câu "FreeRTOS là thời gian thực" chỉ đúng một nửa. FreeRTOS cho bạn *cơ
chế* — giành quyền theo ưu tiên, với các thao tác scheduler có giới hạn thời gian. Còn hệ
thống của bạn có đạt deadline hay không thì phụ thuộc vào cách bạn đặt ưu tiên, độ dài ISR
và cách bạn khoá tài nguyên. Kernel chỉ thực thi được thứ bạn đã thiết kế.

## Cái giá phải trả

Hãy nhìn thẳng. RTOS không miễn phí:

- **RAM.** Mỗi task cần stack riêng — thường 256 B tới 2 kB — cộng một TCB (~90 byte) và
  dữ liệu của kernel. Mười task rất dễ thành 8 kB RAM mà trước đó bạn không cần. Trên con
  chip có tổng cộng 20 kB, đó là cả bản thiết kế.
- **Flash.** Kernel FreeRTOS khoảng 6–12 kB tuỳ tính năng bạn bật. Nhỏ, nhưng không phải
  không đáng kể trên chip 32 kB.
- **Độ trễ, một chút.** Một lần chuyển ngữ cảnh tốn 50–200 chu kỳ. Chẳng đáng gì ở 100 Hz,
  nhưng đáng kể nếu bạn chuyển ở 50 kHz.
- **Một lớp lỗi hoàn toàn mới.** Tranh chấp dữ liệu, deadlock, đảo ngược ưu tiên, và tràn
  stack làm hỏng bộ nhớ của một task *khác*. Superloop không thể có những lỗi này. Đây mới
  là cái giá thật, và bài 4 với bài 6 tồn tại chính vì nó.

## Bài kiểm tra quyết định

Hãy dùng RTOS khi **từ hai điều trở lên** đúng:

1. Bạn có những hoạt động với yêu cầu định thời khác hẳn nhau (vòng điều khiển 1 ms *và*
   cập nhật màn hình 100 ms).
2. Có thứ phải phản hồi trong thời gian giới hạn, bất kể lúc đó hệ thống đang làm gì.
3. Bạn có I/O chặn — ngăn xếp mạng, hệ thống file, chuỗi lệnh AT của module — nơi code tuần
   tự rõ ràng hơn hẳn máy trạng thái.
4. Bạn phải tích hợp middleware vốn giả định có luồng (lwIP, mbedTLS, stack USB, host BLE).

Hãy ở lại với superloop khi:

- Toàn bộ ứng dụng chỉ là một hoạt động định kỳ, hoặc vài hoạt động cùng chu kỳ.
- Bạn dưới 32 kB flash / 8 kB RAM.
- Đội của bạn chưa từng gỡ một lỗi tranh chấp và tiến độ đang gấp.
- Code đã chạy tốt và đang xuất xưởng.

> Điểm 4 là điểm quyết định phần lớn dự án thật. Ngay khi bạn kéo một stack TCP/IP hay BLE
> vào, nó sẽ đòi luồng, và chống lại điều đó tốn công hơn là chấp nhận RTOS.

## Kernel thực chất là gì

Bóc hết lớp quảng cáo đi, FreeRTOS chỉ gồm ba thứ:

1. **Một scheduler** — danh sách task, mỗi task có ưu tiên và trạng thái, cùng một luật để
   chọn ai được chạy.
2. **Một tick** — ngắt timer định kỳ (thường 1 kHz) để nó theo dõi thời hạn và giành quyền.
3. **Các cơ chế giao tiếp** — queue, semaphore, mutex, event group. Tất cả đều xây trên
   cùng một bộ máy "chặn task này lại cho tới khi có chuyện gì đó xảy ra".

Chỉ có vậy thật. Khoảng 9.000 dòng C. Đọc `tasks.c` một lần là một trong những buổi chiều
đáng giá nhất của đời lập trình viên firmware.

## FreeRTOS tối thiểu

```c
#include "FreeRTOS.h"
#include "task.h"

static void blink_task(void *arg)
{
    for (;;) {
        HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
        vTaskDelay(pdMS_TO_TICKS(500));      /* ngủ — KHÔNG quay vòng bận */
    }
}

static void sensor_task(void *arg)
{
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        sample_and_process();
        vTaskDelayUntil(&last, pdMS_TO_TICKS(10));   /* đúng 100 Hz */
    }
}

int main(void)
{
    HAL_Init();
    SystemClock_Config();
    MX_GPIO_Init();

    xTaskCreate(blink_task,  "blink",  128, NULL, 1, NULL);
    xTaskCreate(sensor_task, "sensor", 256, NULL, 3, NULL);

    vTaskStartScheduler();      /* không bao giờ trả về */

    for (;;) { }                /* chỉ tới đây nếu heap quá nhỏ */
}
```

Hãy chú ý hai chi tiết đã quan trọng ngay từ bây giờ:

- **`vTaskDelay` và `vTaskDelayUntil`.** `vTaskDelay(10)` nghĩa là "ngủ 10 tick *kể từ bây
  giờ*", nên chu kỳ bị trôi đúng bằng thời gian xử lý. `vTaskDelayUntil` cho chu kỳ cố định.
  Với vòng điều khiển, luôn chọn cái thứ hai.
- **Kích thước stack (`128`, `256`) tính bằng từ (word), không phải byte.** Trên MCU 32-bit,
  `128` nghĩa là 512 byte. Nhầm chỗ này là lỗi ngày đầu tiên phổ biến nhất, và bài 6 sẽ nói
  cách tính cho đúng.

## Tự kiểm tra

1. Vì sao RTOS không làm code chạy nhanh hơn?
2. Độ trễ xấu nhất của task cuối cùng trong một superloop là bao nhiêu?
3. Kể hai cái giá của RTOS mà superloop không phải trả.
4. Khi nào `vTaskDelay` là lựa chọn sai cho một task định kỳ?

## Bài tiếp theo

Bài 2 mở nắp scheduler: các trạng thái của task, ưu tiên thực sự nghĩa là gì, lúc nào xảy
ra chuyển ngữ cảnh, và cách chọn ưu tiên mà không phải đoán.
