---
lesson: 5
lang: vi
title: "Ngắt và RTOS"
description: "Vì sao ISR của bạn chỉ nên dài ba dòng, hậu tố FromISR thực sự thay đổi gì, portYIELD_FROM_ISR, và thiết lập ưu tiên Cortex-M âm thầm phá hỏng mọi thứ khi đặt sai."
duration: "14 phút"
tags: ["RTOS", "ISR", "Cortex-M"]
---

## ISR không phải là task

Ngắt nằm hoàn toàn bên ngoài scheduler. Trong lúc một ISR chạy, **không task nào chạy cả** —
kể cả task ưu tiên cao nhất. Scheduler không giành quyền khỏi ISR được; chỉ một ngắt ưu tiên
cao hơn mới làm được.

Chỉ riêng sự thật đó chi phối mọi quy tắc trong bài này. Thời gian nằm trong ISR là thời gian
lấy trộm từ mọi deadline của hệ thống, và nó không hề hiện ra trong `vTaskGetRunTimeStats`.

## Xử lý ngắt hoãn lại

![Xử lý ngắt hoãn lại](/MyPortfolio/images/rtos/isr-deferred.svg)

Khuôn mẫu luôn giống nhau: ISR làm đúng mức tối thiểu mà phần cứng đòi hỏi, đẩy công việc
cho một task, rồi thoát.

```c
/* SAI — 5 ms với ngắt gần như bị tắt */
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
/* ĐÚNG — vài micro-giây */
void USART2_IRQHandler(void)
{
    uint8_t b = USART2->RDR;              /* xoá cờ ngắt; phải làm ở đây */

    BaseType_t higher_woken = pdFALSE;
    xQueueSendFromISR(rx_queue, &b, &higher_woken);

    portYIELD_FROM_ISR(higher_woken);
}
```

Task sau đó làm việc phân tích và ghi flash ở mức ưu tiên bạn đã gán, và mất bao lâu cũng
được, vì nó là task và scheduler giành quyền khỏi nó được.

Chỉ những thứ sau mới thuộc về ISR:

- Đọc hoặc ghi thanh ghi ngoại vi để xoá cờ ngắt.
- Chép một byte hoặc một từ ra khỏi FIFO.
- Báo hiệu cho một task.
- Đóng dấu thời gian, nếu bạn cần độ chính xác micro-giây.

## Hậu tố FromISR

Mọi API của kernel dùng được từ ngắt đều có phiên bản `FromISR`, và đó không phải tuỳ chọn —
gọi `xQueueSend()` từ ISR làm hỏng kernel.

```c
xQueueSendFromISR(q, &item, &higher_woken);
xQueueReceiveFromISR(q, &item, &higher_woken);
xSemaphoreGiveFromISR(sem, &higher_woken);
vTaskNotifyGiveFromISR(handle, &higher_woken);
xEventGroupSetBitsFromISR(group, bits, &higher_woken);
xTimerStartFromISR(timer, &higher_woken);
```

Hai khác biệt so với bản dành cho task:

1. **Chúng không bao giờ chặn.** Không có tham số timeout, vì ISR không thể bị chặn — làm gì
   có task nào để đưa vào trạng thái Blocked. Nếu queue đầy, `xQueueSendFromISR` trả về
   `errQUEUE_FULL` ngay lập tức, và việc đếm số lần đó là trách nhiệm của bạn.
2. **Chúng báo lại có task ưu tiên cao hơn vừa thức dậy hay không**, qua tham số ra kiểu
   `BaseType_t *`.

## portYIELD_FROM_ISR — dòng người ta hay quên

```c
BaseType_t higher_woken = pdFALSE;          /* BẮT BUỘC khởi tạo bằng pdFALSE */

xQueueSendFromISR(rx_queue, &b, &higher_woken);

portYIELD_FROM_ISR(higher_woken);           /* chuyển ngữ cảnh khi ISR thoát, nếu cần */
```

Nếu lần gửi đó đánh thức một task có ưu tiên cao hơn task vừa bị ngắt, `higher_woken` thành
`pdTRUE`, và `portYIELD_FROM_ISR` thu xếp để scheduler chuyển sang task đó ngay khoảnh khắc
ISR trả về.

Bỏ dòng đó đi thì mọi thứ *vẫn chạy* — chỉ là task không được chạy cho tới tick kế tiếp. Với
tick 1 kHz, đó là tới 1 ms dao động, cộng thêm vào đúng con đường mà bạn đã cố tình thiết kế
cho nhanh. Đây là lỗi kinh điển kiểu "sao độ trễ thỉnh thoảng lại thành 1 ms".

Lưu ý API khác nhau theo port: một số phiên bản ESP-IDF dùng `portYIELD_FROM_ISR()` không
tham số, còn port của ST dùng `portYIELD_FROM_ISR(x)`. Hãy mở `portmacro.h` ra xem thay vì
copy từ một bài blog.

## Cái bẫy ưu tiên trên Cortex-M

Đây là thứ sinh ra những lỗi trông như bất khả thi, và đáng đọc hai lần.

Trên Cortex-M, **số NVIC nhỏ hơn nghĩa là ưu tiên cao hơn** — ngược với ưu tiên task của
FreeRTOS. FreeRTOS định nghĩa một ngưỡng:

```c
/* FreeRTOSConfig.h */
#define configMAX_SYSCALL_INTERRUPT_PRIORITY   (5 << (8 - configPRIO_BITS))
#define configKERNEL_INTERRUPT_PRIORITY        (15 << (8 - configPRIO_BITS))
```

Quy tắc:

> Một ngắt chỉ được gọi API `FromISR` **nếu** số ưu tiên của nó **lớn hơn hoặc bằng**
> `configMAX_SYSCALL_INTERRUPT_PRIORITY` — nghĩa là chỉ khi nó *kém gấp hơn* ngưỡng.

Những ngắt gấp hơn ngưỡng không bao giờ bị các đoạn găng của kernel tắt đi. Điều đó khiến
chúng có độ trễ cực thấp, và cũng có nghĩa chúng **tuyệt đối không được chạm vào đối tượng
nào của kernel** — kernel không thể bảo vệ cấu trúc dữ liệu của mình khỏi chúng.

Cái bẫy nằm ở giá trị mặc định. Trên STM32, `HAL_NVIC_SetPriority(USART2_IRQn, 0, 0)` đặt ưu
tiên 0 — gấp nhất có thể, nằm trên ngưỡng. Gọi `xQueueSendFromISR` từ đó sẽ làm hỏng queue,
một cách chập chờn, và hàng giờ sau mới lộ ra dưới dạng một giá trị vô lý ở một biến chẳng
liên quan.

**Hãy luôn đặt ưu tiên ngắt một cách tường minh:**

```c
/* số >= 5, nên gọi API kernel là hợp lệ */
HAL_NVIC_SetPriority(USART2_IRQn, 6, 0);
HAL_NVIC_EnableIRQ(USART2_IRQn);

/* một ngắt thực sự khắt khe thời gian, KHÔNG chạm API kernel nào */
HAL_NVIC_SetPriority(TIM1_UP_IRQn, 1, 0);
```

Và bật cái assert bắt hộ bạn lỗi này:

```c
#define configASSERT(x)  if ((x) == 0) { taskDISABLE_INTERRUPTS(); for (;;); }
```

FreeRTOS dùng `configASSERT` để kiểm tra ưu tiên ISR ngay khi vào mọi lời gọi `FromISR`. Bật
nó lên thì lỗi này trở thành một cú dừng cứng ngay tại dòng có vấn đề, thay vì một bí ẩn mỗi
tuần một lần. Hãy bật khi phát triển. Đó là dòng đáng giá nhất trong `FreeRTOSConfig.h`.

## Đường nhanh nhất: notification thẳng tới task

Với một ISR đánh thức đúng một task, notification thắng cả queue lẫn semaphore:

```c
static TaskHandle_t adc_task_handle;

void DMA1_Channel1_IRQHandler(void)
{
    DMA1->IFCR = DMA_IFCR_CTCIF1;              /* xoá cờ */

    BaseType_t woken = pdFALSE;
    vTaskNotifyGiveFromISR(adc_task_handle, &woken);
    portYIELD_FROM_ISR(woken);
}

static void adc_task(void *arg)
{
    adc_task_handle = xTaskGetCurrentTaskHandle();
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);   /* chặn tới khi DMA xong */
        process_adc_buffer();
    }
}
```

Nhanh hơn binary semaphore khoảng 45% và không cần đối tượng kernel riêng nào. Đây là hình
dạng nên dùng cho DMA hoàn tất ở tốc độ cao.

## Timer: phần mềm và phần cứng

Software timer của FreeRTOS chạy trong một task timer riêng, không phải trong ngắt:

```c
TimerHandle_t t = xTimerCreate("blink", pdMS_TO_TICKS(500),
                               pdTRUE,       /* tự nạp lại */
                               NULL, blink_cb);
xTimerStart(t, 0);

static void blink_cb(TimerHandle_t xTimer) {
    HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
}
```

Hãy hiểu điều đó nghĩa là gì: callback chạy ở ưu tiên của task dịch vụ timer
(`configTIMER_TASK_PRIORITY`), dùng stack của task đó, và **không được chặn** — chặn trong
callback của timer làm trễ mọi timer khác. Software timer dành cho việc dọn dẹp — hết giờ,
chống dội phím, kiểm tra sức khoẻ định kỳ — chứ không dành cho thứ gì khắt khe thời gian.
Với những thứ đó, hãy dùng ngoại vi timer phần cứng và ISR của nó.

## Đo thời lượng ISR

Không có số liệu thì không thể suy luận về độ trễ xấu nhất. Cách rẻ nhất là một chân GPIO và
một máy hiện sóng:

```c
void TIM2_IRQHandler(void)
{
    DEBUG_PIN_HIGH();
    /* ... phần việc ... */
    DEBUG_PIN_LOW();
}
```

Hoặc đếm chu kỳ bằng khối DWT:

```c
/* bật một lần lúc khởi động */
CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;

/* trong ISR */
uint32_t start = DWT->CYCCNT;
/* ... phần việc ... */
uint32_t cycles = DWT->CYCCNT - start;
if (cycles > isr_worst_case) isr_worst_case = cycles;
```

Hãy giữ `isr_worst_case` cho từng ISR và in ra trong phần chẩn đoán. Tổng các giá trị xấu
nhất đó chính là sàn dao động cho mọi task trong hệ thống, và là con số bạn đưa ra khi ai đó
hỏi thiết kế này có đạt deadline hay không.

## Tự kiểm tra

1. Vì sao scheduler không giành quyền khỏi một ISR được?
2. `portYIELD_FROM_ISR` làm gì, và bỏ nó đi thì chuyện gì xảy ra?
3. Những ngắt nào được phép gọi API `FromISR`, xét theo số ưu tiên NVIC?
4. Callback của software timer FreeRTOS thực ra chạy ở đâu?

## Bài tiếp theo

Bài cuối: bộ nhớ. Các sơ đồ heap, cách tính stack cho đúng, cách bắt lỗi tràn, và nhúm công
cụ chẩn đoán biến RTOS từ hộp đen thành thứ bạn suy luận được.
