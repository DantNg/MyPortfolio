---
lesson: 3
lang: vi
title: "Queue — truyền thông điệp thay vì chia sẻ bộ nhớ"
description: "Vì sao queue là câu trả lời mặc định cho giao tiếp giữa các task, chặn khi nhận thay cho hỏi vòng, và quy tắc thiết kế loại bỏ phần lớn việc khoá trong code."
duration: "14 phút"
tags: ["RTOS", "Queue", "Đồng thời"]
---

## Hai cách để các task nói chuyện

**Chia sẻ bộ nhớ:** một biến toàn cục, task này ghi, task kia đọc. Đơn giản, nhanh, và là
nguồn gốc của gần như mọi lỗi đồng thời bạn sẽ phải gỡ — vì một lần chuyển ngữ cảnh có thể
rơi vào đúng giữa lúc đang cập nhật.

**Truyền thông điệp:** một task đưa *bản sao* dữ liệu cho task khác qua một queue. Kernel lo
việc khoá, việc chờ và việc đánh thức.

Quy tắc tiết kiệm nhiều đau khổ nhất:

> Hãy ưu tiên truyền thông điệp. Chỉ dùng bộ nhớ chung kèm mutex khi dữ liệu quá lớn để sao
> chép, và ngay cả khi đó, nếu được thì hãy truyền con trỏ qua queue.

Phần lớn bài 4 (semaphore, mutex, đảo ngược ưu tiên) nói về những rắc rối phát sinh khi bạn
không theo được quy tắc đó. Queue giúp bạn né hẳn chúng.

## Queue cơ bản

Queue của FreeRTOS là hàng đợi FIFO có độ dài cố định, phần tử kích thước cố định. Phần tử
được **sao chép vào và sao chép ra** — bên gửi có thể dùng lại buffer của mình ngay khi
`xQueueSend` trả về.

```c
typedef struct {
    uint32_t timestamp_ms;
    int16_t  temp_c_x10;
    uint8_t  sensor_id;
} sample_t;

static QueueHandle_t sample_q;

void app_init(void)
{
    sample_q = xQueueCreate(10, sizeof(sample_t));   /* 10 phần tử */
    configASSERT(sample_q != NULL);                  /* NULL = hết heap */
}
```

Bên sản xuất:

```c
static void sensor_task(void *arg)
{
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        sample_t s = {
            .timestamp_ms = xTaskGetTickCount() * portTICK_PERIOD_MS,
            .temp_c_x10   = read_temp_x10(),
            .sensor_id    = 0,
        };

        if (xQueueSend(sample_q, &s, 0) != pdPASS) {
            dropped_samples++;    /* queue đầy — đừng bao giờ chặn vòng điều khiển */
        }

        vTaskDelayUntil(&last, pdMS_TO_TICKS(10));
    }
}
```

Bên tiêu thụ:

```c
static void logger_task(void *arg)
{
    sample_t s;
    for (;;) {
        if (xQueueReceive(sample_q, &s, portMAX_DELAY) == pdPASS) {
            write_to_flash(&s);   /* chậm — nhưng chẳng ai phải chờ mình */
        }
    }
}
```

Hãy nhìn lại xem bạn vừa được gì:

- Task cảm biến không bao giờ bị việc ghi flash làm chậm.
- Task ghi log tốn **0% CPU** giữa hai lần lấy mẫu.
- **Không có mutex nào cả**, và không thể xảy ra đọc dở dang `sample_t`.
- Queue hấp thụ được cụm dữ liệu dồn tới mười phần tử.

## Tham số timeout là một quyết định thiết kế

Cả `xQueueSend` lẫn `xQueueReceive` đều nhận thời gian chặn, và chọn nó có chủ đích chính là
phần lớn kỹ năng ở đây:

| Timeout | Ý nghĩa | Dùng cho |
| --- | --- | --- |
| `0` | thử, trả về ngay | bên sản xuất không được phép khựng — vòng điều khiển, code sát ISR |
| `pdMS_TO_TICKS(n)` | chờ tối đa n ms | kiểu hỏi–đáp, chờ có giới hạn |
| `portMAX_DELAY` | chờ mãi | task tiêu thụ không còn việc gì khác |

Sai lầm cần tránh: `portMAX_DELAY` khi **gửi**. Nếu bên tiêu thụ chết hoặc khựng, bên sản
xuất chặn vĩnh viễn và deadline của nó bay mất. Gửi với timeout `0` rồi đếm số lần thất bại
cho bạn một chỉ số sức khoẻ thay vì một cú treo.

> Một queue thường xuyên đầy đang nói cho bạn điều gì đó có thật: bên tiêu thụ quá chậm, ưu
> tiên của nó quá thấp, hoặc queue quá ngắn so với cụm dữ liệu dồn. Đừng "sửa" bằng cách làm
> queue thật to — làm vậy chỉ trì hoãn cú hỏng và che nó đi.

## Chọn độ dài queue

Hai câu hỏi:

1. **Cụm dồn lớn cỡ nào?** Nếu bên sản xuất có thể phát 5 phần tử liên tiếp trước khi bên
   tiêu thụ được lập lịch, queue cần ít nhất 5 ô.
2. **Tốn gì?** `độ_dài × kích_thước_phần_tử` byte, cấp phát một lần từ heap FreeRTOS. Mười
   `sample_t` (8 byte mỗi cái) là 80 byte cộng khoảng 80 byte quản lý. Rẻ.

Với bên sản xuất tốc độ `R` và bên tiêu thụ có thể bị trễ `T`, điểm khởi đầu là
`độ_dài = R × T × 1,5`. Rồi đo đạc thật:

```c
UBaseType_t waiting = uxQueueMessagesWaiting(sample_q);
UBaseType_t free_slots = uxQueueSpacesAvailable(sample_q);
```

Hãy ghi lại đỉnh `waiting` trong một đợt chạy dài. Nếu nó không bao giờ vượt 3, queue 10 của
bạn là dư và có thể cắt bớt. Nếu nó chạm 10, bạn đang mất dữ liệu.

## Dữ liệu lớn: gửi con trỏ

Sao chép một buffer 1 kB qua queue tốn một lần memcpy 1 kB bên trong đoạn găng. Với thứ gì
lớn, hãy truyền con trỏ — nhưng khi đó bạn phải trả lời được "ai sở hữu vùng nhớ này?"

Khuôn mẫu hiệu quả là một **bể buffer**, quyền sở hữu chuyển giao qua queue:

```c
#define POOL_N 4
static uint8_t   pool[POOL_N][512];
static QueueHandle_t free_q;      /* chứa con trỏ tới buffer đang rảnh  */
static QueueHandle_t full_q;      /* chứa con trỏ tới buffer đã đầy     */

void pool_init(void)
{
    free_q = xQueueCreate(POOL_N, sizeof(uint8_t *));
    full_q = xQueueCreate(POOL_N, sizeof(uint8_t *));
    for (int i = 0; i < POOL_N; i++) {
        uint8_t *p = pool[i];
        xQueueSend(free_q, &p, 0);
    }
}

/* bên sản xuất */
uint8_t *buf;
if (xQueueReceive(free_q, &buf, 0) == pdPASS) {
    fill(buf, 512);
    xQueueSend(full_q, &buf, 0);      /* quyền sở hữu chuyển cho bên tiêu thụ */
}

/* bên tiêu thụ */
uint8_t *buf;
xQueueReceive(full_q, &buf, portMAX_DELAY);
process(buf, 512);
xQueueSend(free_q, &buf, 0);          /* trả quyền sở hữu về bể */
```

Không `malloc` sau khi khởi động, không phân mảnh, bộ nhớ có trần cứng, và mỗi buffer luôn
chỉ có đúng một chủ tại mọi thời điểm. Đây là hình dạng chuẩn cho âm thanh do DMA nạp, khung
hình camera và gói tin mạng.

## Task notification — đường nhanh

Nếu bạn chỉ cần báo hiệu cho *đúng một task cụ thể*, task notification rẻ hơn queue rất
nhiều: không cần đối tượng riêng, không cấp phát, nhanh hơn khoảng 45%, và mỗi task có sẵn
một giá trị 32-bit dựng sẵn.

```c
/* báo hiệu */
xTaskNotifyGive(logger_handle);

/* chờ */
ulTaskNotifyTake(pdTRUE, portMAX_DELAY);   /* pdTRUE = xoá khi ra, giống binary sem */
```

Hoặc mang theo một chút thông tin:

```c
xTaskNotify(handle, EVENT_BIT_DATA_READY, eSetBits);

uint32_t bits;
xTaskNotifyWait(0, UINT32_MAX, &bits, portMAX_DELAY);
if (bits & EVENT_BIT_DATA_READY) { ... }
```

Hạn chế nằm ngay trong tên: nó báo cho **một** task, và mỗi task chỉ có một giá trị thông
báo, nên hai bên gửi không liên quan có thể ghi đè lên nhau. Hãy dùng notification cho đường
ISR-tới-một-task (bài 5), và dùng queue khi có dữ liệu thật hoặc có nhiều bên tiêu thụ.

## Chọn đúng cơ chế

| Nhu cầu | Dùng |
| --- | --- |
| Gửi dữ liệu, một hoặc nhiều bên gửi/nhận | **Queue** |
| Báo hiệu cho một task cụ thể, không kèm dữ liệu | **Task notification** |
| Báo hiệu cho task từ ISR, không kèm dữ liệu | **Task notification (FromISR)** |
| Chờ nhiều điều kiện cùng lúc | **Event group** |
| Bảo vệ một tài nguyên dùng chung | **Mutex** (bài 4) |
| Đếm số lượng tài nguyên còn rảnh | **Counting semaphore** (bài 4) |
| Nhiều bên ghi vào một dòng byte | **Stream buffer** |
| Thông điệp độ dài thay đổi | **Message buffer** |

Stream buffer và message buffer rất đáng biết: chúng tối ưu cho đúng một bên ghi và một bên
đọc — chính là trường hợp ISR-của-UART tới task — và không bị ràng buộc kích thước phần tử
cố định như queue.

## Một thiết kế hoàn chỉnh

Thiết bị đọc cảm biến ở 100 Hz, hiện giá trị lên màn hình ở 10 Hz, và ghi flash theo khối
1 kB. Ba task, hai queue, không mutex nào:

```c
/* 100 Hz, ưu tiên cao nhất: không bao giờ bị thứ chậm chạp nào chặn */
sensor_task:
    đọc cảm biến
    xQueueSend(display_q, &value, 0)      /* kiểu ghi đè, độ sâu 1     */
    xQueueSend(log_q,     &value, 0)      /* độ sâu 32, hấp thụ cụm dồn*/
    vTaskDelayUntil(10 ms)

/* 10 Hz, ưu tiên thấp                                                */
display_task:
    xQueueReceive(display_q, &v, portMAX_DELAY)
    draw(v)

/* hướng sự kiện, ưu tiên trung bình                                  */
log_task:
    xQueueReceive(log_q, &v, portMAX_DELAY)
    ghi vào khối RAM
    nếu khối đầy: write_flash(block)      /* 20 ms, chẳng chặn ai      */
```

Với `display_q`, queue độ sâu 1 dùng `xQueueOverwrite()` là chính xác điều bạn muốn: màn
hình chỉ quan tâm giá trị *mới nhất*, giá trị cũ hơn là vô dụng.

```c
xQueueOverwrite(display_q, &value);   /* luôn thành công, thay thế phần tử cũ */
```

## Tự kiểm tra

1. Vì sao queue không cần mutex bao quanh?
2. Khi nào `portMAX_DELAY` là timeout sai lúc gửi?
3. Một queue thường xuyên đầy thực chất đang nói lên điều gì?
4. Khi nào bạn dùng task notification thay cho queue?

## Bài tiếp theo

Bài 4: phải làm gì khi thông điệp không đủ. Mutex, semaphore, các lỗi deadlock và đảo ngược
ưu tiên mà từng cơ chế mở đường cho, và những quy tắc giữ bạn tránh xa cả hai.
