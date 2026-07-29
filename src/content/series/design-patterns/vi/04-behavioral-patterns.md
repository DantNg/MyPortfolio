---
lesson: 4
lang: vi
title: "Pattern hành vi — Observer, Command, Strategy"
description: "Tách bên tạo ra sự kiện khỏi bên phản ứng với nó: publish/subscribe trong C, hàng đợi lệnh loại bỏ việc khoá, và strategy cho các thuật toán hoán đổi được."
duration: "14 phút"
tags: ["Design pattern", "Observer", "Command"]
---

## Vấn đề gắn kết chặt

```c
void temperature_updated(float t)
{
    display_show_temp(t);
    logger_write(t);
    if (t > 80.0f) alarm_trigger();
    cloud_publish(t);            /* ← thêm sprint trước */
    hvac_notify(t);              /* ← thêm sprint này   */
}
```

Module cảm biến giờ phụ thuộc vào màn hình, bộ ghi log, chuông báo, mạng và điều hoà. Nó không
unit-test được nếu thiếu cả năm thứ đó, không tái sử dụng được trong sản phẩm không có màn
hình, và mỗi bên tiêu thụ mới lại phải sửa file này.

Cả ba pattern trong bài này đều đánh vào đúng vấn đề đó, từ ba góc khác nhau.

![Observer và command queue](/MyPortfolio/images/patterns/observer-command.svg)

## Observer — xuất bản/đăng ký

Đảo chiều lại: bên tiêu thụ tự đăng ký, còn bên sản xuất không biết gì về chúng.

```c
/* temp_pub.h */
typedef void (*temp_observer_fn)(float celsius, void *ctx);

int  temp_subscribe(temp_observer_fn cb, void *ctx);   /* 0 = ok, -1 = đầy */
void temp_unsubscribe(temp_observer_fn cb);
void temp_publish(float celsius);                      /* module cảm biến gọi */
```

```c
/* temp_pub.c — một mảng cố định, không malloc */
#define MAX_OBSERVERS 8

typedef struct { temp_observer_fn fn; void *ctx; } observer_t;

static observer_t observers[MAX_OBSERVERS];
static uint8_t    count;

int temp_subscribe(temp_observer_fn cb, void *ctx)
{
    if (count >= MAX_OBSERVERS) return -1;
    observers[count++] = (observer_t){ .fn = cb, .ctx = ctx };
    return 0;
}

void temp_publish(float celsius)
{
    for (uint8_t i = 0; i < count; i++) {
        observers[i].fn(celsius, observers[i].ctx);
    }
}
```

Bên tiêu thụ tự nối dây lúc khởi động:

```c
static void on_temp_display(float c, void *ctx) { display_show_temp(c); }
static void on_temp_alarm(float c, void *ctx)   { if (c > 80.0f) alarm_trigger(); }

void app_init(void)
{
    temp_subscribe(on_temp_display, NULL);
    temp_subscribe(on_temp_alarm,   NULL);
    /* thêm bên đẩy dữ liệu lên cloud chỉ động vào file này */
}
```

Module cảm biến giờ hoàn toàn không biết gì về bên tiêu thụ, và bài test cho nó chỉ là một
observer duy nhất ghi lại thứ nó nhận được.

**Ba điều phải làm đúng:**

**1. Observer phải nhanh.** Chúng chạy trong ngữ cảnh của bên xuất bản — có thể là một ISR.
Một observer chậm làm trễ mọi observer khác và cả bên xuất bản. Nếu việc chậm, observer nên
đăng vào một queue chứ đừng làm ngay.

**2. Đừng bao giờ sửa danh sách observer trong lúc đang xuất bản.** Một observer gọi
`temp_unsubscribe()` từ chính callback của nó sẽ phá hỏng vòng lặp. Hoặc cấm hẳn (ghi rõ và
assert), hoặc hoãn thay đổi lại:

```c
void temp_unsubscribe(temp_observer_fn cb)
{
    for (uint8_t i = 0; i < count; i++) {
        if (observers[i].fn == cb) {
            observers[i].fn = NULL;      /* đánh dấu; dồn lại sau vòng xuất bản */
            pending_compact = true;
            return;
        }
    }
}
```

**3. Chặn trên kích thước mảng, và kiểm tra giá trị trả về.** Một lần `subscribe` thất bại
trong im lặng lúc khởi động sinh ra một tính năng đơn giản là không bao giờ chạy, và rất khó
truy ra.

## Command — biến hành động thành dữ liệu

Thay vì gọi một hàm, hãy dựng một struct nhỏ mô tả điều cần xảy ra rồi đưa vào queue. Một bên
tiêu thụ duy nhất sẽ thực thi tất cả.

```c
typedef enum {
    CMD_SET_TEMP,
    CMD_START_PUMP,
    CMD_STOP_PUMP,
    CMD_CALIBRATE,
    CMD_SAVE_CONFIG,
} cmd_id_t;

typedef struct {
    cmd_id_t id;
    int32_t  arg;
    uint32_t timestamp_ms;
} cmd_t;                        /* dữ liệu thuần — sao chép gọn qua queue */
```

Bên sản xuất, kể cả bộ xử lý ngắt, chỉ việc đăng:

```c
void BUTTON_IRQHandler(void)
{
    cmd_t c = { .id = CMD_START_PUMP, .timestamp_ms = now_ms() };
    BaseType_t woken = pdFALSE;
    xQueueSendFromISR(cmd_q, &c, &woken);
    portYIELD_FROM_ISR(woken);
}
```

Một bên tiêu thụ thực thi:

```c
static void cmd_task(void *arg)
{
    cmd_t c;
    for (;;) {
        xQueueReceive(cmd_q, &c, portMAX_DELAY);

        switch (c.id) {
        case CMD_SET_TEMP:    setpoint = c.arg;      break;
        case CMD_START_PUMP:  pump_set(true);        break;
        case CMD_STOP_PUMP:   pump_set(false);       break;
        case CMD_SAVE_CONFIG: config_write_flash();  break;   /* 20 ms, ở đây thì ổn */
        }
    }
}
```

Bạn vừa được những gì, và đó là khá nhiều:

- **Không cần khoá.** Một task sở hữu trạng thái, nên chẳng có gì phải bảo vệ.
- **ISR nhỏ xíu.** Chúng đăng bốn byte rồi trả về.
- **Lệnh soi được.** Ghi log chúng, phát lại chúng, hoặc nạp chúng từ console serial — một
  `cmd_t` sinh ra từ bộ phân tích lệnh UART không khác gì một cái sinh ra từ nút bấm.
- **Hoàn tác và thử lại trở nên khả thi**, vì hành động là một giá trị bạn đã giữ lại.

Pattern này ghép rất tự nhiên với máy trạng thái ở bài 2: lệnh đi vào, máy chuyển trạng thái,
tác động đi ra.

## Strategy — thuật toán hoán đổi được

Khi cùng một thao tác có nhiều bản hiện thực, chọn lúc cấu hình:

```c
typedef struct {
    const char *name;
    float (*compute)(void *ctx, float setpoint, float measured, float dt);
    void  (*reset)(void *ctx);
    void  *ctx;
} controller_if_t;

/* hai chiến lược, cùng một hình dạng */
extern const controller_if_t pid_controller;
extern const controller_if_t bangbang_controller;
```

```c
/* bên gọi chẳng quan tâm là cái nào */
static const controller_if_t *ctrl = &pid_controller;

void control_loop(void)
{
    float out = ctrl->compute(ctrl->ctx, setpoint, measured, 0.01f);
    actuator_set(out);
}

/* đổi chiến lược chỉ là một phép gán */
void set_control_mode(mode_t m)
{
    ctrl->reset(ctrl->ctx);
    ctrl = (m == MODE_SIMPLE) ? &bangbang_controller : &pid_controller;
}
```

Đây đúng là cơ chế interface của bài 3, nhưng áp cho *thuật toán* thay vì *phần cứng*. Nó xuất
hiện mỗi khi dòng sản phẩm có bản rẻ và bản đắt, hoặc khi bạn cần so sánh A/B hai bộ lọc trên
cùng một bộ dữ liệu đã ghi.

Đừng vớ tới nó khi chỉ có một bản hiện thực. Một `controller_if_t` với đúng một thành viên là
gián tiếp mà chẳng được gì.

## Ghép lại: một kiến trúc nhỏ

Ba thứ đó hợp thành một hình dạng mở rộng rất tốt:

```
ISR / timer / bộ phân tích UART
        │  đăng cmd_t
        ▼
   hàng đợi lệnh
        │
        ▼
   task lệnh ──► máy trạng thái ──► tác động (qua interface)
        │
        └──► xuất bản sự kiện ──► observer (màn hình, log, cloud)
```

Mọi mũi tên đều một chiều, và mọi khối đều kiểm thử độc lập được:

- **Máy trạng thái** là hàm thuần khiết (bài 2).
- **Tác động** đi qua interface (bài 3).
- **Observer** được đăng ký, không ghi cứng.
- **Queue** loại bỏ tính đồng thời khỏi bức tranh.

Một phiên bản cụ thể:

```c
static void app_task(void *arg)
{
    cmd_t c;
    for (;;) {
        if (xQueueReceive(cmd_q, &c, pdMS_TO_TICKS(100)) == pdPASS) {
            step_result_t r = machine_step(state, cmd_to_event(&c));
            apply_action(r.action);            /* qua interface */
            if (r.next != state) {
                trace(state, c.id, r.next);
                state = r.next;
                state_publish(state);          /* observer phản ứng */
            }
        } else {
            step_result_t r = machine_step(state, EV_TICK);
            /* ... xử lý tương tự ... */
        }
    }
}
```

Khoảng 20 dòng, và đó là xương sống của một ứng dụng firmware bảo trì được.

## Thêm hai pattern nữa, nói ngắn

**Chain of responsibility** — cho việc xử lý giao thức theo tầng, mỗi handler hoặc tiêu thụ
khung tin hoặc chuyển tiếp:

```c
typedef bool (*frame_handler_fn)(const frame_t *f);   /* true = đã tiêu thụ */

static const frame_handler_fn chain[] = {
    handle_diagnostic,      /* thử trước  */
    handle_control,
    handle_telemetry,
};

void frame_received(const frame_t *f)
{
    for (size_t i = 0; i < ARRAY_SIZE(chain); i++) {
        if (chain[i](f)) return;
    }
    stats.unhandled_frames++;
}
```

**Template method** — một trình tự cố định với các bước thay đổi được, hữu ích cho các driver
thiết bị có chung hình dạng khởi động:

```c
typedef struct {
    int (*power_on)(void);
    int (*probe)(void);         /* khác nhau theo thiết bị */
    int (*configure)(void);     /* khác nhau theo thiết bị */
} device_ops_t;

int device_bringup(const device_ops_t *ops)   /* trình tự thì cố định */
{
    if (ops->power_on() != 0)  return -1;
    delay_ms(10);
    if (ops->probe() != 0)     return -2;
    if (ops->configure() != 0) return -3;
    return 0;
}
```

## Khi nào KHÔNG nên dùng

Giới hạn thành thật, vì lạm dụng pattern cũng là một kiểu thất bại:

- **Observer với đúng một người đăng ký** là một lời gọi hàm kèm thêm mấy bước thừa và một
  kiểu hỏng lúc chạy. Cứ gọi thẳng hàm đó.
- **Hàng đợi lệnh cho một hành động đồng bộ đơn lẻ** thêm độ trễ và thêm một queue mà chẳng
  để làm gì.
- **Strategy với đúng một chiến lược** là gián tiếp mà không có lợi ích.
- **Bất kỳ cái nào trong dự án 500 dòng** đều tốn nhiều hơn thu về.

Dấu hiệu để bắt đầu dùng luôn giống nhau: *bên tiêu thụ thứ hai*, *bản hiện thực thứ hai*,
hoặc *luồng thứ hai*. Trước đó, cứ viết thẳng.

## Tự kiểm tra

1. Vì sao callback của observer phải nhanh?
2. Hàng đợi lệnh đem lại điều gì về mặt khoá tài nguyên, và tại sao?
3. Strategy khác gì với interface ở bài 3?
4. Khi nào observer là lựa chọn sai?

## Bài tiếp theo

Bài 5: C++ thêm được gì khi bạn được phép dùng — RAII, template thay cho lời gọi ảo, và truy
cập thanh ghi an toàn kiểu, tất cả với chi phí lúc chạy bằng không.
