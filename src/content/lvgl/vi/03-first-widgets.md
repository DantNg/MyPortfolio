---
lesson: 3
lang: vi
title: "Màn hình đầu tiên — Object, Label, Button"
description: "Mọi thứ đều là lv_obj_t. Quan hệ cha–con, screen, những cái bẫy của label mà ít ai cảnh báo, và một màn hình hoàn chỉnh bạn dán vào là chạy."
duration: "15 phút"
tags: ["LVGL", "Widget", "Cơ bản"]
---

## Mọi thứ đều là object

LVGL chỉ có đúng một kiểu cơ sở: `lv_obj_t`. Nút là một `lv_obj_t` có hành vi nút. Nhãn là
một `lv_obj_t` biết vẽ chữ. Màn hình là một `lv_obj_t` không có cha. Chấp nhận điều đó rồi
thì API thu gọn lại rất nhỏ:

```c
lv_obj_t * thing = lv_<widget>_create(parent);
```

Mọi hàm riêng của widget đều là `lv_<widget>_set_something(thing, ...)`, còn mọi hàm dùng
chung là `lv_obj_set_something(thing, ...)`.

![Cây đối tượng](/MyPortfolio/images/lvgl/widget-tree.svg)

## Cha và con

Cái parent bạn truyền vào `_create()` quyết định ba điều:

1. **Vị trí của con** — toạ độ tính theo vùng nội dung của cha, không phải theo màn hình.
2. **Con có hiện hay không** — con bị cắt (clip) theo biên của cha.
3. **Chuyện gì xảy ra khi xoá** — xoá cha là xoá sạch mọi con.

```c
lv_obj_t * card = lv_obj_create(lv_scr_act());   /* con của màn hình     */
lv_obj_set_size(card, 200, 120);
lv_obj_center(card);

lv_obj_t * title = lv_label_create(card);        /* con của card         */
lv_label_set_text(title, "Sensor");
lv_obj_align(title, LV_ALIGN_TOP_LEFT, 0, 0);    /* 0,0 = góc của card   */

lv_obj_del(card);                                /* title chết theo      */
```

Dòng cuối quan trọng hơn vẻ ngoài của nó: bạn không bao giờ phải tự quản lý con trỏ con để
dọn dẹp. Xoá container là cả nhánh cây biến mất.

## Screen (màn hình)

`lv_scr_act()` trả về màn hình đang hiển thị. Bạn có thể tạo thêm và chuyển qua lại:

```c
lv_obj_t * scr_home     = lv_obj_create(NULL);   /* parent = NULL nghĩa là screen */
lv_obj_t * scr_settings = lv_obj_create(NULL);

/* dựng cả hai... rồi */
lv_scr_load(scr_home);

/* hoặc có hiệu ứng chuyển */
lv_scr_load_anim(scr_settings, LV_SCR_LOAD_ANIM_MOVE_LEFT, 300, 0, false);
```

Tham số cuối của `lv_scr_load_anim()` là `auto_del`. Truyền `true` thì màn hình *cũ* bị xoá
sau khi chuyển xong — tiện, nhưng con trỏ tới nó thành treo lơ lửng. Trên thiết bị ít RAM,
đó thường là điều bạn muốn; chỉ cần nhớ lần sau phải dựng lại màn hình chứ đừng dùng lại
handle cũ.

## Label — ba chỗ hay vấp

```c
lv_obj_t * label = lv_label_create(lv_scr_act());
lv_label_set_text(label, "Nhiet do: 24.5 C");
```

**1. `lv_label_set_text()` sao chép chuỗi.** LVGL cấp phát trên heap riêng và giữ bản sao,
nên đoạn này an toàn:

```c
char buf[32];
snprintf(buf, sizeof(buf), "%.1f C", temperature);
lv_label_set_text(label, buf);      /* buf hết scope cũng không sao */
```

Nếu bạn cập nhật nhãn 20 lần mỗi giây, hãy tránh cấp phát bằng biến thể static — nhưng khi
đó **buffer phải sống lâu hơn label**:

```c
static char shared[32];             /* static! không phải biến cục bộ */
snprintf(shared, sizeof(shared), "%.1f C", temperature);
lv_label_set_text_static(label, shared);
```

**2. Chữ dài cần cả chế độ lẫn chiều rộng.** Mặc định label tự nở theo chữ và tràn ra
ngoài màn hình:

```c
lv_obj_set_width(label, 200);                        /* phải đặt width trước  */
lv_label_set_long_mode(label, LV_LABEL_LONG_WRAP);   /* hoặc SCROLL, DOT, CLIP */
```

`LV_LABEL_LONG_SCROLL_CIRCULAR` cho hiệu ứng chữ chạy như trên máy nghe nhạc.

**3. Định dạng có sẵn.** `lv_label_set_text_fmt()` nhận tham số kiểu printf:

```c
lv_label_set_text_fmt(label, "%d%%  %s", battery, charging ? "CHG" : "BAT");
```

Lưu ý: đa số bản build **không** hỗ trợ `%f` — printf của LVGL là bản rút gọn tự viết. Hãy
dùng số nguyên hoặc `snprintf` ra buffer trước.

## Button

Nút trong LVGL là một container biết phản hồi khi bị nhấn. Nó không có chữ của riêng mình
— bạn đặt một label vào bên trong:

```c
static void btn_event_cb(lv_event_t * e)
{
    lv_obj_t * btn   = lv_event_get_target(e);
    lv_obj_t * label = lv_obj_get_child(btn, 0);

    static uint32_t count = 0;
    count++;
    lv_label_set_text_fmt(label, "Da bam %u", count);
}

lv_obj_t * btn = lv_btn_create(lv_scr_act());
lv_obj_set_size(btn, 140, 50);
lv_obj_align(btn, LV_ALIGN_CENTER, 0, 40);
lv_obj_add_event_cb(btn, btn_event_cb, LV_EVENT_CLICKED, NULL);

lv_obj_t * btn_label = lv_label_create(btn);
lv_label_set_text(btn_label, "Bam di");
lv_obj_center(btn_label);
```

Nút cũng có thể ở dạng bật/tắt:

```c
lv_obj_add_flag(btn, LV_OBJ_FLAG_CHECKABLE);

/* trong callback */
bool on = lv_obj_has_state(btn, LV_STATE_CHECKED);
```

## Một màn hình hoàn chỉnh

Dán đoạn này vào `my_ui()` của simulator và chạy thử:

```c
#include "lvgl/lvgl.h"

static lv_obj_t * value_label;
static int16_t    setpoint = 24;

static void plus_cb(lv_event_t * e)
{
    if (setpoint < 35) setpoint++;
    lv_label_set_text_fmt(value_label, "%d C", setpoint);
}

static void minus_cb(lv_event_t * e)
{
    if (setpoint > 15) setpoint--;
    lv_label_set_text_fmt(value_label, "%d C", setpoint);
}

void my_ui(void)
{
    /* --- khung thẻ --- */
    lv_obj_t * card = lv_obj_create(lv_scr_act());
    lv_obj_set_size(card, 260, 180);
    lv_obj_center(card);

    /* --- tiêu đề --- */
    lv_obj_t * title = lv_label_create(card);
    lv_label_set_text(title, "Thermostat");
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 0);

    /* --- số lớn --- */
    value_label = lv_label_create(card);
    lv_label_set_text_fmt(value_label, "%d C", setpoint);
    lv_obj_set_style_text_font(value_label, &lv_font_montserrat_28, 0);
    lv_obj_align(value_label, LV_ALIGN_CENTER, 0, -10);

    /* --- nút trừ --- */
    lv_obj_t * bm = lv_btn_create(card);
    lv_obj_set_size(bm, 60, 44);
    lv_obj_align(bm, LV_ALIGN_BOTTOM_LEFT, 0, 0);
    lv_obj_add_event_cb(bm, minus_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t * lm = lv_label_create(bm);
    lv_label_set_text(lm, LV_SYMBOL_MINUS);
    lv_obj_center(lm);

    /* --- nút cộng --- */
    lv_obj_t * bp = lv_btn_create(card);
    lv_obj_set_size(bp, 60, 44);
    lv_obj_align(bp, LV_ALIGN_BOTTOM_RIGHT, 0, 0);
    lv_obj_add_event_cb(bp, plus_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t * lp = lv_label_create(bp);
    lv_label_set_text(lp, LV_SYMBOL_PLUS);
    lv_obj_center(lp);
}
```

`LV_SYMBOL_PLUS` và các bạn của nó đến từ font icon dựng sẵn của LVGL — khoảng 60 ký hiệu
(`LV_SYMBOL_WIFI`, `LV_SYMBOL_BATTERY_FULL`, `LV_SYMBOL_SETTINGS`, …) và không tốn thêm gì
vì font đó đã được link sẵn.

## Vài flag nên biết sớm

```c
lv_obj_add_flag(obj,    LV_OBJ_FLAG_HIDDEN);      /* không vẽ, không bấm được */
lv_obj_clear_flag(obj,  LV_OBJ_FLAG_SCROLLABLE);  /* chặn cuộn ngoài ý muốn   */
lv_obj_add_flag(obj,    LV_OBJ_FLAG_CHECKABLE);   /* hành vi bật/tắt          */
lv_obj_clear_flag(obj,  LV_OBJ_FLAG_CLICKABLE);   /* chỉ để trang trí         */
```

`LV_OBJ_FLAG_SCROLLABLE` mặc định BẬT với `lv_obj`. Nếu container của bạn cứ "nảy" khi
người dùng kéo, đó chính là lý do — hãy clear cờ này.

## Bài tiếp theo

Căn từng widget bằng tay với `lv_obj_align()` sẽ hết chịu nổi từ widget thứ năm trở đi.
Bài 4 giới thiệu Flex và Grid, và bố cục bắt đầu tự sắp xếp giúp bạn.
