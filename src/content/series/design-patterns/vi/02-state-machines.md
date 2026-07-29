---
lesson: 2
lang: vi
title: "Máy trạng thái — bốn cách làm, kèm đánh đổi"
description: "Pattern firmware dùng nhiều hơn mọi pattern khác: switch lồng nhau, bảng chuyển, con trỏ hàm, và phân cấp — khi nào dùng cái nào, kèm code đầy đủ."
duration: "16 phút"
tags: ["Design pattern", "Máy trạng thái", "C"]
---

## Vì sao pattern này thống trị firmware

Gần như mọi bài toán nhúng đều là một máy trạng thái đang cải trang: bộ phân tích giao thức,
bộ điều khiển sạc, một trình đơn, một trình tự khởi động, một động cơ có nhiều chế độ. Lý do
là firmware phản ứng với sự kiện theo thời gian và phải nhớ mình đang ở đâu — đúng định nghĩa
của máy trạng thái.

Viết nó ra một cách tường minh, thay vì rải rác một mớ cờ `bool`, cho bạn ba thứ: bạn vẽ được
nó, bạn review được nó, và bạn kiểm thử vét cạn được nó.

![Bốn cách hiện thực máy trạng thái](/MyPortfolio/images/patterns/state-machine.svg)

Xuyên suốt bài này là một ví dụ duy nhất — bộ sạc pin:

```
IDLE → (cắm điện) → PRECHARGE → (V > 3,0) → FAST → (I < 0,1C) → DONE
mọi trạng thái → (rút điện) → IDLE
mọi trạng thái → (quá nhiệt) → FAULT
```

## 1. Switch lồng nhau

Phiên bản ai cũng viết đầu tiên:

```c
typedef enum { ST_IDLE, ST_PRECHARGE, ST_FAST, ST_DONE, ST_FAULT } state_t;
typedef enum { EV_PLUGGED, EV_UNPLUGGED, EV_V_OK, EV_I_LOW, EV_OVERTEMP } event_t;

static state_t state = ST_IDLE;

void charger_handle(event_t ev)
{
    if (ev == EV_OVERTEMP) { charger_stop(); state = ST_FAULT; return; }
    if (ev == EV_UNPLUGGED) { charger_stop(); state = ST_IDLE; return; }

    switch (state) {
    case ST_IDLE:
        if (ev == EV_PLUGGED) { set_current(PRECHARGE_MA); state = ST_PRECHARGE; }
        break;

    case ST_PRECHARGE:
        if (ev == EV_V_OK) { set_current(FAST_MA); state = ST_FAST; }
        break;

    case ST_FAST:
        if (ev == EV_I_LOW) { charger_stop(); state = ST_DONE; }
        break;

    case ST_DONE:
    case ST_FAULT:
        break;
    }
}
```

**Ưu:** không tốn thêm gì, không có lớp gián tiếp, ai đọc cũng hiểu.

**Nhược:** không mở rộng được. Với sáu trạng thái và sáu sự kiện, bạn có ma trận 36 ô được
diễn đạt bằng văn xuôi, và thật sự rất khó thấy mình đã quên ô nào. Hãy để ý hai chuyển tiếp
toàn cục phải được nâng lên trên khối switch — đó chính là hình dáng của vấn đề xuất hiện từ
sớm.

**Dùng khi** có từ năm trạng thái trở xuống, với đặc tả ổn định.

## 2. Bảng chuyển trạng thái

Đưa máy trạng thái vào dữ liệu thay vì vào luồng điều khiển:

```c
typedef void (*action_fn)(void);

typedef struct {
    state_t  from;
    event_t  ev;
    state_t  to;
    action_fn action;      /* có thể là NULL */
} transition_t;

static const transition_t table[] = {
    /* từ            sự kiện       tới           hành động     */
    { ST_IDLE,      EV_PLUGGED,   ST_PRECHARGE, act_precharge  },
    { ST_PRECHARGE, EV_V_OK,      ST_FAST,      act_fast       },
    { ST_FAST,      EV_I_LOW,     ST_DONE,      act_stop       },

    /* chuyển tiếp toàn cục, liệt kê rõ cho từng trạng thái nguồn */
    { ST_PRECHARGE, EV_UNPLUGGED, ST_IDLE,      act_stop       },
    { ST_FAST,      EV_UNPLUGGED, ST_IDLE,      act_stop       },
    { ST_DONE,      EV_UNPLUGGED, ST_IDLE,      NULL           },
};

void charger_handle(event_t ev)
{
    for (size_t i = 0; i < ARRAY_SIZE(table); i++) {
        if (table[i].from == state && table[i].ev == ev) {
            if (table[i].action) table[i].action();
            state = table[i].to;
            return;
        }
    }
    /* không chuyển tiếp nào khớp — hãy ghi log, đây là nơi lỗi ẩn nấp */
    log_unhandled(state, ev);
}
```

**Ưu:** toàn bộ máy trạng thái hiện ra trong một khối mà bạn đọc như đọc đặc tả. Người không
lập trình cũng review được. Nó sinh được từ một sơ đồ hoặc một file CSV. Chuyển tiếp còn thiếu
lộ ra thành khoảng trống, và sự kiện không được xử lý phát hiện được lúc chạy.

**Nhược:** quét tuyến tính là O(n). Với bảng lớn và tần suất sự kiện cao, hãy sắp xếp rồi tìm
nhị phân, hoặc đánh chỉ mục theo `[state][event]`.

**Dùng nó** làm mặc định. Đây là phiên bản tôi chọn trong hầu hết dự án, và việc máy trạng
thái là *dữ liệu* chính là thứ làm cho nó review được và sinh tự động được.

## 3. Con trỏ hàm — trạng thái chính là một hàm

Mỗi trạng thái thành một handler trả về trạng thái kế tiếp:

```c
typedef state_t (*state_fn)(event_t ev);

static state_t st_idle(event_t ev);
static state_t st_precharge(event_t ev);
static state_t st_fast(event_t ev);

static state_fn current = st_idle;

static state_t st_idle(event_t ev)
{
    if (ev == EV_PLUGGED) { set_current(PRECHARGE_MA); return (state_t)st_precharge; }
    return (state_t)st_idle;
}

static state_t st_precharge(event_t ev)
{
    switch (ev) {
    case EV_V_OK:      set_current(FAST_MA); return (state_t)st_fast;
    case EV_UNPLUGGED: charger_stop();       return (state_t)st_idle;
    default:                                 return (state_t)st_precharge;
    }
}

void charger_handle(event_t ev)
{
    current = (state_fn)current(ev);
}
```

Sạch hơn nếu có một struct ngữ cảnh tường minh, đồng thời cho phép có nhiều thực thể:

```c
typedef struct charger charger_t;
typedef void (*handler_fn)(charger_t *c, event_t ev);

struct charger {
    handler_fn handler;
    uint32_t   timer_ms;
    uint16_t   mv;
};

static void on_precharge(charger_t *c, event_t ev)
{
    if (ev == EV_V_OK) { set_current(FAST_MA); c->handler = on_fast; }
}

void charger_dispatch(charger_t *c, event_t ev) { c->handler(c, ev); }
```

**Ưu:** điều phối là O(1) bất kể máy lớn cỡ nào. Mỗi trạng thái là một hàm khép kín, rất dễ
chịu khi một trạng thái có logic đáng kể. Thêm hành động vào/ra rất dễ.

**Nhược:** bạn không nhìn thấy toàn bộ máy ở bất cứ đâu. Để trả lời "ở FAST mà UNPLUGGED thì
sao?" bạn phải mở đúng một hàm cụ thể. Người review không thích nó chính vì lý do đó.

**Dùng khi** có nhiều trạng thái, ít sự kiện, và mỗi trạng thái làm việc thật.

## 4. Máy trạng thái phân cấp

Vấn đề mà cả ba cách trên đều mắc: **chuyển tiếp toàn cục bị lặp lại.** `EV_UNPLUGGED` và
`EV_OVERTEMP` xuất hiện ở mọi trạng thái, và quên một chỗ khi thêm trạng thái mới là lỗi kinh
điển.

Máy trạng thái phân cấp (HSM) giải quyết bằng cách lồng nhau. `PRECHARGE` và `FAST` trở thành
trạng thái con của `CHARGING`, và `CHARGING` xử lý `EV_UNPLUGGED` một lần cho cả hai. Sự kiện
không được xử lý sẽ nổi lên trạng thái cha.

```
CHARGING                        ← xử lý UNPLUGGED và OVERTEMP cho mọi con
  ├── PRECHARGE
  └── FAST
IDLE
DONE
FAULT
```

Cộng thêm **hành động vào và ra**, chạy tự động ở mỗi chuyển tiếp vượt qua ranh giới:

```c
/* mang tính khái niệm — framework HSM thật sẽ sinh phần này */
state_t charging_on_entry(void) { fan_on();  led_set(LED_CHARGING); }
state_t charging_on_exit(void)  { fan_off(); charger_stop(); }
```

Giờ điều "quạt phải tắt mỗi khi không sạc" được bảo đảm bởi cấu trúc, chứ không phải bởi việc
nhớ gọi `fan_off()` ở sáu nhánh khác nhau.

**Ưu:** không lặp chuyển tiếp, bảo đảm cặp vào/ra luôn khớp, mở rộng được tới hành vi thật sự
phức tạp.

**Nhược:** gần như chắc chắn bạn nên dùng framework thay vì tự viết. Lựa chọn: **QP/C** (Miro
Samek), phân hệ **`smf` của Zephyr**, hoặc một bộ sinh code như **Yakindu/itemis CREATE** tạo
ra C từ sơ đồ.

**Dùng khi** làm giao diện người dùng, giao thức phức tạp, và bất cứ khi nào bạn thấy mình
viết cùng một chuyển tiếp ở năm nơi.

## Làm cho cách nào cũng test được

Chọn cách nào thì cũng áp dụng đúng quy tắc của bài 1: **tách máy trạng thái khỏi tác động của
nó.** Đừng gọi `HAL_GPIO_WritePin` bên trong một hành động chuyển tiếp. Hãy trả về ý định, hoặc
gọi qua một interface được tiêm vào:

```c
/* thuần khiết — kiểm thử cực dễ */
typedef struct {
    state_t  next;
    action_t action;      /* ACT_NONE, ACT_SET_PRECHARGE, ACT_STOP, ... */
} step_result_t;

step_result_t charger_step(state_t current, event_t ev);
```

```c
/* bài test không cần chút phần cứng nào */
void test_precharge_to_fast(void)
{
    step_result_t r = charger_step(ST_PRECHARGE, EV_V_OK);
    TEST_ASSERT_EQUAL(ST_FAST, r.next);
    TEST_ASSERT_EQUAL(ACT_SET_FAST, r.action);
}
```

Với hàm step thuần khiết, kiểm thử vét cạn chỉ là một vòng lặp lồng:

```c
for (state_t s = 0; s < ST_COUNT; s++) {
    for (event_t e = 0; e < EV_COUNT; e++) {
        step_result_t r = charger_step(s, e);
        TEST_ASSERT_TRUE(r.next < ST_COUNT);       /* không bao giờ ra trạng thái lạ */
    }
}
```

Vòng lặp đó tìm ra những chuyển tiếp bạn đã quên, và đó chính là toàn bộ mục đích.

## Vài chi tiết thực tế quan trọng

**Đưa sự kiện qua một queue.** ISR không nên gọi thẳng `charger_handle()` — nó nên đăng một sự
kiện. Một luồng duy nhất sở hữu biến trạng thái và không cần khoá gì cả:

```c
void ADC_IRQHandler(void) {
    event_t ev = EV_V_OK;
    BaseType_t woken = pdFALSE;
    xQueueSendFromISR(event_q, &ev, &woken);
    portYIELD_FROM_ISR(woken);
}
```

**Coi hết giờ cũng là sự kiện.** Trạng thái nào có thể treo thì cần một timer đăng `EV_TIMEOUT`
và một chuyển tiếp về trạng thái an toàn. Mọi trạng thái chờ đầu vào từ bên ngoài đều cần.

**Ghi log mọi chuyển tiếp.** Bốn byte mỗi lần — mốc thời gian, từ, sự kiện, tới — trong một
ring buffer. Khi thiết bị giở chứng ngoài thực địa, cái ring buffer đó là khác biệt giữa chẩn
đoán được và đoán mò:

```c
static void trace(state_t from, event_t ev, state_t to) {
    trace_buf[idx++ & (TRACE_N - 1)] = (trace_t){ now_ms(), from, ev, to };
}
```

**Đừng bao giờ dùng `state++`.** Chuyển tiếp phải tường minh và có tên. Tăng một enum là gắn
chặt logic vào thứ tự khai báo, và sẽ có người sắp xếp lại thứ tự đó.

## Chọn cách nào, gói trong một bảng

| | Switch lồng | Bảng | Con trỏ hàm | Phân cấp |
| --- | --- | --- | --- | --- |
| Số trạng thái phù hợp | ≤ 5 | 5–20 | 10–50 | bất kỳ, phức tạp |
| Nhìn thấy toàn bộ máy | một phần | **có** | không | trong sơ đồ |
| Chi phí điều phối | O(1) | O(n) | **O(1)** | O(độ sâu) |
| Chuyển tiếp toàn cục | lặp lại | lặp lại | lặp lại | **kế thừa** |
| Hành động vào/ra | thủ công | thủ công | dễ | **tự động** |
| Sinh được từ sơ đồ | không | **có** | vụng | **có** |
| Cần framework | không | không | không | thường là có |

## Tự kiểm tra

1. Vì sao bảng chuyển dễ review hơn switch lồng nhau?
2. Cả ba cách phẳng đều mắc chung vấn đề gì, và phân cấp sửa nó ra sao?
3. Vì sao ISR nên đăng sự kiện thay vì gọi thẳng máy trạng thái?
4. Làm `charger_step()` thành hàm thuần khiết đem lại cho bạn điều gì?

## Bài tiếp theo

Bài 3: interface và dependency injection bằng C thuần — cách kiểm thử đoạn code nói chuyện với
phần cứng, mà không cần phần cứng.
