---
lesson: 4
lang: vi
title: "Mutex, semaphore và những lỗi chúng gây ra"
description: "Tranh chấp dữ liệu, khác biệt giữa mutex và binary semaphore, deadlock, đảo ngược ưu tiên — và bộ quy tắc nhỏ tránh được tất cả."
duration: "16 phút"
tags: ["RTOS", "Mutex", "Đảo ngược ưu tiên"]
---

## Lỗi khởi đầu mọi chuyện

```c
static uint32_t counter;      /* hai task dùng chung */

void task_a(void *p) { for (;;) { counter++; vTaskDelay(1); } }
void task_b(void *p) { for (;;) { counter++; vTaskDelay(1); } }
```

`counter++` không phải một thao tác. Trên Cortex-M nó biên dịch thành ba:

```asm
LDR  r0, [counter]     ; đọc
ADDS r0, r0, #1        ; sửa
STR  r0, [counter]     ; ghi
```

Nếu scheduler chuyển ngữ cảnh giữa `LDR` và `STR`, một lần tăng bị mất. Cửa sổ chỉ vài
nano-giây, nên trên bàn làm việc thì chạy hoàn hảo còn ngoài thực địa thì hỏng mỗi tuần một
lần. Đó là **tranh chấp dữ liệu (race condition)**, và nó áp dụng cho mọi thứ không phải một
lần truy cập đơn lẻ đúng kích thước từ: giá trị 64-bit, struct, danh sách liên kết, một
ngoại vi cần ghi hai thanh ghi.

Ba lối thoát, xếp theo thứ tự nên ưu tiên:

1. **Đừng dùng chung.** Cho dữ liệu một chủ duy nhất và dùng queue (bài 3). Phần lớn trường
   hợp.
2. **Làm cho truy cập trở thành nguyên tử.** Với một cái cờ đơn lẻ, `volatile` cộng một lần
   ghi 32-bit căn thẳng là đủ trên Cortex-M — nhưng riêng `volatile` **không** làm cho `x++`
   an toàn.
3. **Dùng mutex.** Khi bạn thật sự có tài nguyên dùng chung: một bus I²C, một màn hình, một
   hệ thống file.

## Đoạn găng — công cụ thô bạo

Cách bảo vệ rẻ nhất là dừng scheduler hoặc dừng ngắt:

```c
taskENTER_CRITICAL();      /* tắt ngắt tới mức configMAX_SYSCALL_INTERRUPT_PRIORITY */
shared_struct.a = 1;
shared_struct.b = 2;
taskEXIT_CRITICAL();
```

Cách này đúng và nhanh, nhưng cũng là một cái búa tạ: khi đang ở trong đó, **không gì khác
chạy được** — không task nào, và phần lớn ngắt cũng không. Độ trễ xấu nhất của cả hệ thống
tăng thêm đúng bằng đoạn găng dài nhất của bạn.

Quy tắc: không vòng lặp, không gọi hàm mà bạn chưa đọc, không ghi log, không API chặn. Vài
phép gán thôi. Vài chục lệnh, không phải vài nghìn.

Một biến thể nhẹ hơn chỉ tạm dừng scheduler, để ngắt vẫn sống:

```c
vTaskSuspendAll();
/* task khác không chạy được; ISR thì vẫn chạy */
xTaskResumeAll();
```

Dùng nó khi bạn cần loại trừ lẫn nhau với các task nhưng không được phép làm trễ ngắt.

## Mutex — để bảo vệ tài nguyên

```c
static SemaphoreHandle_t i2c_mutex;

void i2c_init(void)
{
    i2c_mutex = xSemaphoreCreateMutex();
    configASSERT(i2c_mutex);
}

int sensor_read(uint8_t reg, uint8_t *out)
{
    if (xSemaphoreTake(i2c_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return -ETIMEDOUT;        /* luôn có timeout, và luôn xử lý nó */
    }

    int rc = i2c_transfer(reg, out);

    xSemaphoreGive(i2c_mutex);    /* mọi nhánh thoát đều phải tới được đây */
    return rc;
}
```

Hai tính chất khiến mutex khác semaphore:

- **Quyền sở hữu.** Chỉ task đã lấy mới được trả lại. FreeRTOS sẽ assert nếu task khác thử.
- **Kế thừa ưu tiên.** Lý do tồn tại của mutex — xem bên dưới.

Mutex cũng có thể **đệ quy** nếu bạn dùng `xSemaphoreCreateRecursiveMutex()`, cho phép cùng
một task lấy nó nhiều lần. Tiện, và thường là dấu hiệu việc phân tầng của bạn đang lộn xộn.

> **Đừng bao giờ lấy mutex trong ISR.** Thậm chí không hề có `xSemaphoreTakeFromISR()` cho
> mutex, chính bởi vì ISR không có danh tính task nào để kế thừa ưu tiên sang.

## Đảo ngược ưu tiên

![Đảo ngược ưu tiên](/MyPortfolio/images/rtos/priority-inversion.svg)

Ba task, ưu tiên Thấp, Trung bình, Cao:

1. **L** lấy mutex I²C và bắt đầu truyền.
2. **H** thức dậy, cần đúng cái mutex đó, và bị chặn. Tới đây vẫn hợp lý — H chờ L.
3. **M** — vốn chẳng cần mutex nào — chuyển sang sẵn sàng và giành quyền khỏi L, vì M xếp
   trên L.

Bây giờ **H đang chờ M**, một task mà nó xếp trên, một cách gián tiếp và trong khoảng thời
gian không giới hạn. M có thể chạy cả trăm mili-giây. Deadline của H bay mất, và không phép
phân tích ưu tiên nào dự đoán được điều đó.

Đây không phải chuyện lý thuyết. Nó suýt kết liễu sứ mệnh Mars Pathfinder năm 1997: tàu đổ
bộ liên tục tự khởi động lại vì một task quản lý bus ưu tiên cao bị chặn đúng theo mô hình
này.

**Cách sửa là kế thừa ưu tiên**, và mutex của FreeRTOS có hiện thực nó: trong lúc H bị chặn
trên mutex mà L đang giữ, kernel tạm nâng L lên đúng ưu tiên của H. M không giành quyền khỏi
L được nữa, L làm xong nhanh, nhả mutex, rồi tụt về mức cũ.

Đó chính xác là lý do bạn phải dùng `xSemaphoreCreateMutex()` chứ không phải
`xSemaphoreCreateBinary()` khi bảo vệ tài nguyên. Trên API chúng trông như thay thế được cho
nhau. Không hề.

## Binary và counting semaphore — để báo hiệu

Semaphore không có chủ, nên nó sai cho việc khoá nhưng đúng cho việc báo hiệu:

```c
/* binary semaphore: "có một sự kiện vừa xảy ra" */
static SemaphoreHandle_t data_ready;
data_ready = xSemaphoreCreateBinary();

/* trong ISR */
BaseType_t woken = pdFALSE;
xSemaphoreGiveFromISR(data_ready, &woken);
portYIELD_FROM_ISR(woken);

/* trong task */
xSemaphoreTake(data_ready, portMAX_DELAY);
process_data();
```

**Counting** semaphore theo dõi còn bao nhiêu thực thể của một thứ:

```c
/* ba kênh DMA */
static SemaphoreHandle_t dma_slots;
dma_slots = xSemaphoreCreateCounting(3, 3);   /* tối đa 3, khởi đầu 3 rảnh */

xSemaphoreTake(dma_slots, portMAX_DELAY);     /* chờ một kênh rảnh */
use_a_dma_channel();
xSemaphoreGive(dma_slots);                    /* trả lại */
```

Tóm tắt sự khác biệt — thứ hay bị nhầm nhất trong công việc với RTOS:

| | Mutex | Binary semaphore |
| --- | --- | --- |
| Mục đích | bảo vệ tài nguyên | báo hiệu sự kiện |
| Chủ sở hữu | có — chỉ người lấy mới trả | không — ai trả cũng được |
| Kế thừa ưu tiên | có | không |
| Dùng được trong ISR | không | có (`GiveFromISR`) |
| Trạng thái ban đầu | sẵn sàng | rỗng |

## Deadlock

Hai task, hai mutex, lấy theo thứ tự khác nhau:

```c
/* task A */                        /* task B */
take(mutex_i2c);                    take(mutex_display);
take(mutex_display);                take(mutex_i2c);
   ... làm việc ...                    ... làm việc ...
```

Nếu A giành được mutex I²C và B giành được mutex màn hình cùng lúc, cả hai chặn vĩnh viễn.
Mọi thứ bên dưới chúng vẫn chạy, và chính điều đó làm việc chẩn đoán rối rắm: hệ thống chưa
chết, chỉ có hai task chết.

Ba quy tắc phòng ngừa:

1. **Luôn lấy nhiều khoá theo cùng một thứ tự toàn cục.** Hãy ghi thứ tự đó vào một header
   và bắt tuân thủ khi review. Riêng quy tắc này đã loại bỏ trường hợp kinh điển.
2. **Đừng bao giờ chặn khi đang giữ khoá.** Không `vTaskDelay`, không nhận queue có timeout,
   không chờ một semaphore khác.
3. **Luôn dùng timeout, và luôn xử lý khi thất bại.** `portMAX_DELAY` trên mutex biến một cú
   timeout cứu được thành một cú treo.

Liên quan và cũng khó chịu không kém: **giữ khoá quá lâu.** Một mutex bị giữ suốt một lần
ghi flash 50 ms khiến mọi người dùng khác của tài nguyên đó trễ deadline. Cách sửa thường là
sao chép thứ mình cần khi đang giữ khoá, rồi làm phần chậm ở bên ngoài.

## Event group — chờ nhiều thứ cùng lúc

Khi một task phải chờ một tổ hợp điều kiện:

```c
static EventGroupHandle_t sys_events;
#define EV_WIFI_UP   (1 << 0)
#define EV_TIME_SYNC (1 << 1)
#define EV_CONFIG_OK (1 << 2)

sys_events = xEventGroupCreate();

/* các task khác nhau bật bit khi chúng xong việc */
xEventGroupSetBits(sys_events, EV_WIFI_UP);

/* một task cần đủ cả ba mới khởi động được */
EventBits_t bits = xEventGroupWaitBits(
        sys_events,
        EV_WIFI_UP | EV_TIME_SYNC | EV_CONFIG_OK,
        pdFALSE,                 /* không xoá khi thoát   */
        pdTRUE,                  /* chờ ĐỦ CẢ ba          */
        pdMS_TO_TICKS(30000));

if ((bits & (EV_WIFI_UP | EV_TIME_SYNC | EV_CONFIG_OK)) == 0) {
    /* hết giờ — hãy báo ra phân hệ nào không chịu lên */
}
```

Nó thay cả mớ cờ và vòng hỏi bằng một lời gọi chặn duy nhất, và là cách sạch sẽ nhất để diễn
đạt thứ tự khởi động.

## Bộ quy tắc, cô đọng

Hãy in ra và dán lên bàn:

1. Ưu tiên queue hơn biến dùng chung.
2. Mutex cho tài nguyên, semaphore cho sự kiện. Đừng bao giờ hoán đổi.
3. Mọi lần lấy khoá đều có timeout, và mọi timeout đều được xử lý.
4. Đừng bao giờ chặn khi đang giữ khoá.
5. Lấy nhiều khoá theo đúng một thứ tự toàn cục đã ghi thành văn.
6. Giữ đoạn găng chỉ vài lệnh.
7. Đừng bao giờ lấy mutex trong ISR.

## Tự kiểm tra

1. Vì sao `counter++` vẫn không an toàn dù `counter` là `volatile`?
2. Kế thừa ưu tiên sửa chính xác vấn đề gì, và cơ chế nào cung cấp nó?
3. Nêu một chuỗi hai task hai mutex gây deadlock, và quy tắc một dòng ngăn được nó.
4. Mutex hay binary semaphore mới trả (give) được từ ISR, và vì sao cái kia thì không?

## Bài tiếp theo

Bài 5: ngắt. Vì sao gần như mọi ISR bạn viết chỉ nên dài ba dòng, hậu tố `FromISR` thực sự
thay đổi điều gì, và thiết lập ưu tiên trên Cortex-M sẽ âm thầm phá hỏng mọi thứ nếu bạn đặt
sai.
