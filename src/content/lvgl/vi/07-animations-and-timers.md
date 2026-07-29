---
lesson: 7
lang: vi
title: "Animation và Timer"
description: "lv_anim nội suy một con số rồi đưa cho callback của bạn. lv_timer thay thế mọi delay() trong code giao diện. Kết hợp lại, UI thôi giống một máy trạng thái khô cứng."
duration: "13 phút"
tags: ["LVGL", "Animation", "Timer"]
---

## lv_timer — xoá sạch delay() khỏi code giao diện

`lv_timer` là timer phần mềm hợp tác, do `lv_timer_handler()` chạy. Đây là cách đúng để
làm mọi việc lặp lại theo chu kỳ trong giao diện:

```c
static void refresh_cb(lv_timer_t * t)
{
    ui_ctx_t * ui = t->user_data;          /* LVGL 9: lv_timer_get_user_data(t) */

    float temp = sensor_read_temp();
    lv_label_set_text_fmt(ui->temp_label, "%d.%d C",
                          (int)temp, (int)(temp * 10) % 10);
}

lv_timer_t * t = lv_timer_create(refresh_cb, 500, &ui);   /* mỗi 500 ms */
```

Điều khiển nó về sau:

```c
lv_timer_set_period(t, 100);      /* tăng tốc khi đang xem đồ thị */
lv_timer_pause(t);
lv_timer_resume(t);
lv_timer_ready(t);                /* nổ ngay ở lần handler kế tiếp */
lv_timer_del(t);

/* chạy một lần rồi tự xoá */
lv_timer_t * once = lv_timer_create(splash_done_cb, 2000, NULL);
lv_timer_set_repeat_count(once, 1);
```

Vì timer chạy bên trong `lv_timer_handler()`, chúng cùng luồng với cây widget — nên gọi
hàm LVGL từ callback của timer luôn an toàn. Điều đó *không* đúng với task FreeRTOS hay ISR.

> Đừng bao giờ gọi `vTaskDelay()`, `HAL_Delay()` hay vòng chờ bận bên trong callback của
> timer hoặc sự kiện. Bạn đang chặn bộ vẽ. Hãy chia nhỏ công việc ra nhiều nhịp timer.

## lv_anim — một con số, chạy mượt theo thời gian

Animation làm đúng một việc: gọi hàm của bạn liên tục với một giá trị đi từ `start` tới
`end` theo một đường cong.

![Đường cong animation](/MyPortfolio/images/lvgl/animation.svg)

```c
static void set_x_cb(void * obj, int32_t v)
{
    lv_obj_set_x((lv_obj_t *)obj, v);
}

void slide_in(lv_obj_t * panel)
{
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, panel);
    lv_anim_set_exec_cb(&a, set_x_cb);
    lv_anim_set_values(&a, -240, 0);
    lv_anim_set_time(&a, 400);
    lv_anim_set_path_cb(&a, lv_anim_path_ease_out);
    lv_anim_start(&a);
}
```

Ở đây để `lv_anim_t` trên stack là an toàn — `lv_anim_start()` sao chép nó vào danh sách
riêng của LVGL. Đây là chỗ duy nhất mà mô tả cục bộ được phép, khác hẳn `lv_style_t`.

### Sức mạnh nằm ở exec callback

Vì *bạn* viết hàm setter, bạn có thể animate bất kỳ thứ gì là số:

```c
static void set_opa (void * o, int32_t v) { lv_obj_set_style_opa(o, v, 0); }
static void set_w   (void * o, int32_t v) { lv_obj_set_width(o, v); }
static void set_arc (void * o, int32_t v) { lv_arc_set_value(o, v); }
static void set_zoom(void * o, int32_t v) { lv_img_set_zoom(o, v); }

/* thậm chí không phải đối tượng LVGL: làm mờ dần đèn nền */
static void set_bl  (void * o, int32_t v) { pwm_set_duty(BACKLIGHT_CH, v); }
```

Cái cuối là mẹo tôi thích nhất: bộ animation của LVGL thực chất là một cỗ máy easing đa
dụng. Dùng nó cho cả phần cứng luôn.

### Vài tuỳ chọn hữu ích

```c
lv_anim_set_delay(&a, 200);                    /* chờ trước khi bắt đầu      */
lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
lv_anim_set_repeat_delay(&a, 500);
lv_anim_set_playback_time(&a, 400);            /* chạy ngược lại sau đó      */
lv_anim_set_ready_cb(&a, on_anim_done);        /* gọi khi chạy xong          */
lv_anim_set_deleted_cb(&a, on_anim_killed);
```

Đường cong: `lv_anim_path_linear`, `ease_in`, `ease_out`, `ease_in_out`, `overshoot`,
`bounce`, `step`.

### Dừng animation

```c
lv_anim_del(panel, set_x_cb);     /* đối tượng này, thuộc tính này  */
lv_anim_del(panel, NULL);         /* mọi animation của đối tượng    */
```

Luôn dừng animation trước khi xoá đối tượng đích — hoặc tốt hơn, để LVGL lo: xoá một widget
sẽ tự gỡ những animation có `var` là widget đó. Nguy hiểm nằm ở chỗ bạn animate *thứ khác*
(ví dụ một trường trong struct) mà lấy widget làm user data.

## Animation dựng sẵn của widget

Nhiều widget đã có sẵn hiệu ứng, không tốn công:

```c
lv_slider_set_value(sl, 70, LV_ANIM_ON);
lv_bar_set_value(bar, 45, LV_ANIM_ON);
lv_arc_set_value(arc, 220);
lv_chart_set_update_mode(chart, LV_CHART_UPDATE_MODE_SHIFT);

lv_scr_load_anim(scr2, LV_SCR_LOAD_ANIM_FADE_IN, 300, 0, false);
lv_obj_scroll_to_view(item, LV_ANIM_ON);
```

Hãy ưu tiên chúng thay vì tự viết: chúng hiểu cấu trúc bên trong widget và chỉ đánh dấu
vẽ lại đúng vùng thay đổi.

## Ví dụ hoàn chỉnh — đồng hồ đo chạy theo cảm biến

```c
typedef struct {
    lv_obj_t * arc;
    lv_obj_t * label;
    int32_t    shown;      /* giá trị giao diện đang hiển thị */
} gauge_t;

static gauge_t g;

static void arc_exec(void * obj, int32_t v)
{
    lv_arc_set_value((lv_obj_t *)obj, v);
    lv_label_set_text_fmt(g.label, "%d%%", (int)v);
    g.shown = v;
}

/* lv_timer gọi mỗi 250 ms */
static void poll_cb(lv_timer_t * t)
{
    int32_t target = sensor_read_load_percent();
    if (target == g.shown) return;              /* không có gì phải làm */

    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, g.arc);
    lv_anim_set_exec_cb(&a, arc_exec);
    lv_anim_set_values(&a, g.shown, target);
    lv_anim_set_time(&a, 300);
    lv_anim_set_path_cb(&a, lv_anim_path_ease_out);
    lv_anim_start(&a);                          /* thay thế cái đang chạy */
}

void gauge_create(lv_obj_t * parent)
{
    g.arc = lv_arc_create(parent);
    lv_obj_set_size(g.arc, 140, 140);
    lv_arc_set_range(g.arc, 0, 100);
    lv_arc_set_bg_angles(g.arc, 135, 45);
    lv_obj_remove_style(g.arc, NULL, LV_PART_KNOB);      /* chỉ để đọc */
    lv_obj_clear_flag(g.arc, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_center(g.arc);

    g.label = lv_label_create(parent);
    lv_obj_set_style_text_font(g.label, &lv_font_montserrat_28, 0);
    lv_obj_align_to(g.label, g.arc, LV_ALIGN_CENTER, 0, 0);

    lv_timer_create(poll_cb, 250, NULL);
}
```

Bắt đầu một animation mới trên cùng đối tượng + exec_cb sẽ tự động thay thế cái cũ, nên
cảm biến nhảy số liên tục vẫn cho ra cây kim đuổi theo mượt mà thay vì giật cục.

## Ghi chú hiệu năng

- Mỗi khung hình animation đều làm "bẩn" một vùng. Animate phần tử **chiếm cả màn hình**
  trên màn SPI chậm sẽ rớt khung — hãy animate thứ nhỏ, hoặc chấp nhận
  `LV_DISP_DEF_REFR_PERIOD` cao hơn.
- `LV_DISP_DEF_REFR_PERIOD` (mặc định 30 ms ≈ 33 fps) là trần độ mượt của animation. Chỉ
  hạ xuống 16 ms nếu đường flush của bạn theo kịp.
- Nhiều animation cùng lúc thì tốn ít CPU, nhưng mỗi lần vẽ lại thì không rẻ. Hãy lệch pha
  chúng bằng `lv_anim_set_delay()` — nhìn cũng đẹp hơn.

## Bài tiếp theo

Bài cuối: các widget dữ liệu (chart, table, meter), cùng kỹ thuật đo hiệu năng và bộ nhớ
để biến một bản demo thành firmware xuất xưởng được.
