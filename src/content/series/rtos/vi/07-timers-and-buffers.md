---
lesson: 7
lang: vi
title: "Software timer, event group và stream buffer"
description: "Những cơ chế bạn dùng tới sau queue và mutex: timer không giống điều người ta tưởng, event group cho thứ tự khởi động, và các buffer sinh ra cho một bên ghi một bên đọc."
duration: "15 phút"
tags: ["FreeRTOS", "Timer", "Stream buffer"]
---

## Software timer thực chất là gì

Mô hình mà người ta mang tới thường sai, và nó gây ra lỗi thật. Software timer của FreeRTOS
**không phải** timer phần cứng và **không phải** ngắt. Nó là một callback do một task bình
thường thực thi — *task dịch vụ timer* — mà kernel tạo giúp bạn khi `configUSE_TIMERS` bằng 1.

```c
#define configUSE_TIMERS             1
#define configTIMER_TASK_PRIORITY    3      /* ưu tiên mà callback của bạn chạy      */
#define configTIMER_QUEUE_LENGTH     10     /* số lệnh timer đang chờ                */
#define configTIMER_TASK_STACK_DEPTH 256    /* MỌI callback dùng chung stack này     */
```

Ba hệ quả suy ra ngay:

1. **Callback của bạn chạy ở `configTIMER_TASK_PRIORITY`.** Nếu nó là 3 mà bạn có task ở mức
   4 và 5, thì cái "timer 1 ms" của bạn sẽ không nổ trong 1 ms khi các task kia đang bận.
2. **Mọi callback dùng chung một stack.** Một callback gọi `snprintf` có thể làm tràn task
   timer và phá hỏng thứ khác. Hãy tính `configTIMER_TASK_STACK_DEPTH` theo callback *nặng
   nhất*.
3. **Một callback bị chặn sẽ làm đứng mọi timer khác.** Chỉ có một task dịch vụ; callback chờ
   mutex 50 ms sẽ làm trễ mọi timer xếp sau nó.

```c
static TimerHandle_t led_timer;

static void led_cb(TimerHandle_t xTimer)
{
    /* Không được chặn. Phải ngắn. Chạy trên stack của task timer. */
    HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
}

void app_init(void)
{
    led_timer = xTimerCreate("led",
                             pdMS_TO_TICKS(500),
                             pdTRUE,          /* tự nạp lại              */
                             (void *)0,       /* timer ID — xem bên dưới */
                             led_cb);
    configASSERT(led_timer);
    xTimerStart(led_timer, 0);
}
```

### API thực chất là một hàng đợi lệnh

Đây là chi tiết làm nhiều người bất ngờ: `xTimerStart`, `xTimerStop`, `xTimerReset` và
`xTimerChangePeriod` không tác dụng ngay. Chúng **đăng một lệnh** vào queue của task timer.
Tham số thứ hai là thời gian chặn nếu queue đó đầy:

```c
xTimerStart(t, 0);                     /* thử đăng, trả về ngay             */
xTimerStart(t, pdMS_TO_TICKS(10));     /* chờ tối đa 10 ms để có chỗ trống  */
```

Nếu task timer có ưu tiên thấp hơn bên gọi, lệnh nằm trong queue cho tới khi task timer được
chạy. Nên đoạn này **không** hoạt động như cách nó đọc:

```c
xTimerStop(t);
/* timer VẪN có thể nổ một lần ở đây — lệnh stop chưa được xử lý */
```

Nếu thứ tự quan trọng, hãy nâng `configTIMER_TASK_PRIORITY` lên trên bên gọi, hoặc canh
callback bằng một cái cờ mà bạn đặt trước khi stop.

### Hai khuôn mẫu thật sự hữu ích

**Chống dội phím** — một timer chạy một lần, được restart ở mỗi sườn tín hiệu:

```c
static void debounce_cb(TimerHandle_t t)
{
    /* đã yên tĩnh 20 ms — mức tín hiệu giờ đã ổn định */
    if (gpio_read(BUTTON) == PRESSED) {
        cmd_t c = { .id = CMD_BUTTON_PRESS };
        xQueueSend(cmd_q, &c, 0);
    }
}

void BUTTON_IRQHandler(void)
{
    BaseType_t woken = pdFALSE;
    xTimerResetFromISR(debounce_timer, &woken);   /* đẩy lại cửa sổ 20 ms */
    portYIELD_FROM_ISR(woken);
}
```

Mỗi lần dội lại đẩy mốc hạn ra xa; callback chỉ chạy khi đầu vào đã im. Mười hai dòng và
không có vòng delay nào.

**Watchdog riêng cho từng task** — mỗi task một timer, do chính task đó reset:

```c
static void task_stuck_cb(TimerHandle_t t)
{
    uint32_t task_id = (uint32_t)(uintptr_t)pvTimerGetTimerID(t);
    log_fault(FAULT_TASK_HUNG, task_id);
    NVIC_SystemReset();
}

/* trong vòng lặp của mỗi task được giám sát */
xTimerReset(my_watchdog, 0);
```

Timer ID là cách để một callback phục vụ nhiều timer — nhét một số nguyên nhỏ hoặc một con trỏ
vào đó rồi đọc lại bằng `pvTimerGetTimerID()`.

## Event group — chờ nhiều điều kiện

Queue báo hiệu một thứ. Event group là 24 bit độc lập (8 bit còn lại kernel giữ), và một task
chặn được tới khi bất kỳ hoặc toàn bộ một tập bit được bật.

Ứng dụng kinh điển là thứ tự khởi động, thứ mà nếu không có nó sẽ thành một mớ cờ và vòng hỏi:

```c
static EventGroupHandle_t sys_events;

#define EV_CLOCKS_OK   (1 << 0)
#define EV_NVM_LOADED  (1 << 1)
#define EV_SENSOR_OK   (1 << 2)
#define EV_NET_UP      (1 << 3)
#define EV_ALL_READY   (EV_CLOCKS_OK | EV_NVM_LOADED | EV_SENSOR_OK | EV_NET_UP)

/* mỗi phân hệ tự bật bit của mình khi khởi tạo xong */
void sensor_init_done(void) { xEventGroupSetBits(sys_events, EV_SENSOR_OK); }

/* ứng dụng chờ đủ mọi thứ, có timeout rõ ràng */
static void app_task(void *arg)
{
    EventBits_t bits = xEventGroupWaitBits(
            sys_events,
            EV_ALL_READY,
            pdFALSE,                     /* không xoá khi thoát           */
            pdTRUE,                      /* chờ ĐỦ CẢ các bit             */
            pdMS_TO_TICKS(10000));

    if ((bits & EV_ALL_READY) != EV_ALL_READY) {
        /* Chỉ ra chính xác phân hệ nào không lên — đây mới là phần đáng giá */
        if (!(bits & EV_SENSOR_OK)) log_fault(FAULT_SENSOR_TIMEOUT, 0);
        if (!(bits & EV_NET_UP))    log_fault(FAULT_NET_TIMEOUT, 0);
        enter_degraded_mode();
    }

    run_normally();
}
```

Chỉ riêng khả năng chẩn đoán đó — nêu tên phân hệ không khởi động được — đã đáng giá bằng cả
cơ chế. Bản dùng cờ và vòng hỏi thường chỉ in ra được "init failed".

Hai điều nữa nên biết:

**`xEventGroupSync()`** là một điểm hẹn: mỗi bên bật bit của mình rồi chặn tới khi tất cả đã
tới. Đó là cách bắt nhiều task cùng bắt đầu một phép đo ở đúng cùng một tick.

```c
/* cả ba task đều tới dòng này, rồi cả ba cùng đi tiếp */
xEventGroupSync(sync_group, MY_BIT, ALL_BITS, portMAX_DELAY);
```

**Việc xoá bit không nguyên tử với việc chờ** trong trường hợp tổng quát. Nếu hai task cùng
chờ một bit với `xClearOnExit = pdTRUE`, chỉ một trong hai thấy được nó. Với kiểu quảng bá
một-tới-nhiều, hãy để bit đó bật và cho mỗi bên tiêu thụ tự xoá một bit riêng của nó.

## Stream buffer — khuôn mẫu cho UART

![Queue, stream buffer và message buffer](/MyPortfolio/images/rtos/buffers.svg)

Queue chuyển các phần tử kích thước cố định và lấy khoá kernel ở mỗi thao tác. Với một dòng
byte từ UART, cách đó vừa vụng vừa chậm hơn mức cần thiết.

**Stream buffer** được tối ưu cho đúng **một bên ghi và một bên đọc**, và chính nhờ ràng buộc
đó mà nó không cần đoạn găng nào ở đường đi thông thường:

```c
static StreamBufferHandle_t uart_rx;

void app_init(void)
{
    /* buffer 512 byte; đánh thức bên đọc khi đã có 1 byte */
    uart_rx = xStreamBufferCreate(512, 1);
    configASSERT(uart_rx);
}

/* bên sản xuất: ISR, ghi bất cứ gì vừa tới */
void USART2_IRQHandler(void)
{
    uint8_t b = USART2->RDR;
    BaseType_t woken = pdFALSE;
    xStreamBufferSendFromISR(uart_rx, &b, 1, &woken);
    portYIELD_FROM_ISR(woken);
}

/* bên tiêu thụ: một task, lấy hết những gì đang có */
static void comms_task(void *arg)
{
    uint8_t chunk[64];
    for (;;) {
        size_t n = xStreamBufferReceive(uart_rx, chunk, sizeof(chunk), portMAX_DELAY);
        for (size_t i = 0; i < n; i++) parser_feed(&parser, chunk[i]);
    }
}
```

**Ngưỡng kích hoạt** (tham số thứ hai khi tạo) là núm điều chỉnh. Đặt là 1 thì task thức ở mỗi
byte — phản hồi nhanh, nhiều lần chuyển ngữ cảnh. Đặt là 32 thì task thức một lần mỗi 32 byte
— ít chuyển hơn nhiều, nhưng một khung dở dang sẽ nằm trong buffer cho tới khi có thêm dữ
liệu, nên hãy ghép ngưỡng lớn với một timeout khi đọc:

```c
/* thức khi đủ 32 byte HOẶC sau 10 ms, cái nào tới trước */
size_t n = xStreamBufferReceive(uart_rx, chunk, sizeof(chunk), pdMS_TO_TICKS(10));
```

Tổ hợp đó — ngưỡng kích hoạt cho thông lượng và timeout cho độ trễ — là cách bạn có được cả
hai trên một đường truyền bận.

## Message buffer — giữ ranh giới khung tin

Stream buffer làm mất khái niệm "một thông điệp kết thúc ở đâu". **Message buffer** thêm 4 byte
độ dài vào trước mỗi lần ghi, nên mỗi lần đọc trả về đúng một thông điệp trọn vẹn:

```c
static MessageBufferHandle_t frame_buf;
frame_buf = xMessageBufferCreate(1024);

/* bên ghi: một khung hoàn chỉnh mỗi lần gọi */
xMessageBufferSend(frame_buf, frame, frame_len, 0);

/* bên đọc: nhận đúng một khung, dài bao nhiêu cũng được */
uint8_t rx[256];
size_t len = xMessageBufferReceive(frame_buf, rx, sizeof(rx), portMAX_DELAY);
handle_frame(rx, len);
```

Hai lưu ý thực tế: 4 byte header cũng tính vào dung lượng buffer, nên buffer 1024 byte chứa
được mười thông điệp 100 byte, chứ không phải mười cái và dư ra. Và một thông điệp dài hơn cả
buffer thì không bao giờ gửi được — `xMessageBufferSend` sẽ chặn vĩnh viễn để chờ khoảng trống
không thể tồn tại. Hãy đối chiếu kích thước khung lớn nhất với buffer ngay từ lúc thiết kế.

## Chọn lại lần nữa

| Bạn đang có | Dùng |
| --- | --- |
| Struct cùng một kiểu, có thể nhiều bên gửi | queue |
| Một ISR đánh thức một task, không kèm dữ liệu | task notification |
| Byte từ UART/DMA về một task | **stream buffer** |
| Khung tin độ dài thay đổi, một bên đọc | **message buffer** |
| Nhiều điều kiện phải chờ cùng lúc | **event group** |
| Việc dọn dẹp định kỳ, chống dội, hết giờ | **software timer** |
| Bất cứ gì khắt khe thời gian | timer phần cứng + ISR |

Dòng cuối là dòng cần nhớ. Software timer là tiện lợi, không phải cơ chế thời gian thực.

## Tự kiểm tra

1. Callback của software timer chạy ở ưu tiên nào, và vì sao điều đó quan trọng?
2. Vì sao timer có thể nổ một lần *sau khi* bạn đã gọi `xTimerStop()`?
3. Ràng buộc nào làm cho stream buffer rẻ hơn queue?
4. Ngưỡng kích hoạt lớn hơn đem lại gì và mất gì?

## Bài tiếp theo

Bài 8: cho tất cả những thứ này chạy bằng pin. Tickless idle, cách đo dòng cho đúng, và những
quyết định thiết kế tách biệt một thiết bị dùng hai ngày với một thiết bị dùng hai năm.
