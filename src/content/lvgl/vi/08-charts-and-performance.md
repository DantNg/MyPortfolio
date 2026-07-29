---
lesson: 8
lang: vi
title: "Widget dữ liệu, hiệu năng và dự án cuối"
description: "Chart, table, meter; đo FPS và RAM; những tối ưu thực sự có tác dụng trên MCU — và một dashboard cảm biến hoàn chỉnh gói lại cả series."
duration: "20 phút"
tags: ["LVGL", "Chart", "Hiệu năng", "Dự án"]
---

## lv_chart — widget bạn sẽ dùng nhiều nhất

```c
lv_obj_t * chart = lv_chart_create(parent);
lv_obj_set_size(chart, 300, 160);
lv_chart_set_type(chart, LV_CHART_TYPE_LINE);
lv_chart_set_point_count(chart, 60);                 /* hiển thị 60 mẫu */
lv_chart_set_range(chart, LV_CHART_AXIS_PRIMARY_Y, 0, 100);

lv_chart_series_t * s1 = lv_chart_add_series(chart,
        lv_palette_main(LV_PALETTE_BLUE), LV_CHART_AXIS_PRIMARY_Y);
lv_chart_series_t * s2 = lv_chart_add_series(chart,
        lv_palette_main(LV_PALETTE_CYAN), LV_CHART_AXIS_PRIMARY_Y);
```

Đưa dữ liệu vào. Chế độ `SHIFT` cho kiểu chạy như dao động ký — thứ bạn gần như luôn muốn:

```c
lv_chart_set_update_mode(chart, LV_CHART_UPDATE_MODE_SHIFT);

/* trong timer lấy mẫu */
lv_chart_set_next_value(chart, s1, temperature);
lv_chart_set_next_value(chart, s2, humidity);
```

Hai chi tiết quan trọng:

**1. Mảng điểm được cấp phát từ heap của LVGL.** 60 điểm × 2 series × 4 byte là 480 byte;
500 điểm × 4 series là 8 kB. Trên MCU nhỏ, `lv_chart_set_point_count()` là một quyết định
về bộ nhớ, không phải chuyện thẩm mỹ.

**2. Dùng mảng bên ngoài cho dữ liệu lớn hoặc đã có sẵn** để khỏi phải sao chép:

```c
static lv_coord_t samples[240];       /* ring buffer của bạn */
lv_chart_set_ext_y_array(chart, s1, samples);

/* sau khi tự cập nhật samples[] */
lv_chart_refresh(chart);
```

Trang trí lưới và trục:

```c
lv_chart_set_div_line_count(chart, 5, 7);
lv_obj_set_style_line_width(chart, 2, LV_PART_ITEMS);   /* độ dày đường  */
lv_obj_set_style_size(chart, 0, LV_PART_INDICATOR);     /* ẩn chấm điểm  */
lv_chart_set_axis_tick(chart, LV_CHART_AXIS_PRIMARY_Y, 5, 3, 5, 1, true, 40);
```

Ẩn chấm điểm (`size 0`) là một cải thiện hiệu năng thật sự với đồ thị dày.

## lv_table và lv_meter, nói ngắn

```c
/* table — ô là chuỗi; widget chỉ vẽ những hàng đang thấy */
lv_obj_t * tbl = lv_table_create(parent);
lv_table_set_col_cnt(tbl, 2);
lv_table_set_row_cnt(tbl, 8);
lv_table_set_cell_value(tbl, 0, 0, "Node");
lv_table_set_cell_value_fmt(tbl, 1, 1, "%d dBm", rssi);

/* meter — đồng hồ kim với cung màu */
lv_obj_t * meter = lv_meter_create(parent);
lv_meter_scale_t * sc = lv_meter_add_scale(meter);
lv_meter_set_scale_range(meter, sc, 0, 120, 270, 135);
lv_meter_indicator_t * needle =
        lv_meter_add_needle_line(meter, sc, 3, lv_palette_main(LV_PALETTE_RED), -10);
lv_meter_set_indicator_value(meter, needle, rpm);
```

`lv_meter` đẹp nhưng đắt — nó vẽ lại cả một vùng tròn lớn. Trên MCU 100 MHz dùng SPI, một
cái meter chạy liên tục có thể ngốn hết ngân sách khung hình. Hãy đo đạc.

## Đo trước, tối ưu sau

Bật bộ theo dõi dựng sẵn:

```c
#define LV_USE_PERF_MONITOR 1     /* lớp phủ FPS + CPU%, góc dưới phải */
#define LV_USE_MEM_MONITOR  1     /* lớp phủ mức dùng heap của LVGL    */
```

Đọc chúng như sau:

- **FPS dưới 20** mà **CPU dưới 50%** → nút thắt nằm ở đường flush (xung SPI, không DMA,
  buffer quá nhỏ), không phải ở LVGL.
- **FPS dưới 20** mà **CPU gần 100%** → chính việc vẽ đang đắt. Hãy soi shadow, gradient,
  ảnh lớn và `lv_meter`.
- **Bộ nhớ tăng dần** và không bao giờ tụt xuống → bạn đang rò rỉ đối tượng.

Bằng code:

```c
lv_mem_monitor_t m;
lv_mem_monitor(&m);
printf("dung %u / %u (%u%%), phan manh %u%%, khoi trong lon nhat %u\n",
       (unsigned)(m.total_size - m.free_size), (unsigned)m.total_size,
       m.used_pct, m.frag_pct, (unsigned)m.free_biggest_size);
```

Hãy để mắt tới `frag_pct`. Tạo rồi xoá màn hình liên tục sẽ phân mảnh heap của LVGL; nếu
`free_size` lớn mà `free_biggest_size` nhỏ, bạn sẽ gặp lỗi cấp phát trông rất "ngẫu nhiên".

## Những tối ưu thực sự có tác dụng

**Xếp theo mức tác động, trên MCU dùng LCD SPI điển hình:**

1. **DMA + hai draw buffer.** Thường cải thiện 2–3 lần. Không gì sánh được.
2. **Draw buffer lớn hơn.** Từ 1/10 lên 1/4 màn hình giúp giảm số lần flush và chi phí
   cố định mỗi lần.
3. **Bỏ đổ bóng.** `shadow_width` trên danh sách cuộn là nguyên nhân giật hình phổ biến
   nhất tôi từng gặp khi review.
4. **Tránh vẽ lại toàn màn hình.** Hãy đổi một cái label, đừng đổi nền cả màn hình. Gọi
   `lv_obj_invalidate()` trên đối tượng nhỏ nhất có thể.
5. **Tắt những gì không dùng** trong `lv_conf.h`. Mỗi `LV_USE_*` bị tắt là flash được
   trả lại:

```c
#define LV_USE_CALENDAR   0
#define LV_USE_KEYBOARD   0
#define LV_USE_CANVAS     0
#define LV_USE_SPAN       0
#define LV_BUILD_EXAMPLES 0
```

6. **Ít cỡ font hơn.** Riêng Montserrat 28 đã khoảng 12 kB flash.
7. **Ảnh `LV_IMG_CF_TRUE_COLOR` khớp với `LV_COLOR_DEPTH`** để không phải chuyển đổi màu
   từng pixel lúc chạy.

**Đừng** vội vi tối ưu code C trong callback. Đó chưa bao giờ là nút thắt.

## Ngân sách bộ nhớ, ước lượng

| Hạng mục | Chi phí điển hình |
| --- | --- |
| Mã lõi LVGL | 60–120 kB flash |
| Một `lv_obj_t` | ~120–200 byte RAM |
| Montserrat 14 | ~7 kB flash |
| Montserrat 28 | ~12 kB flash |
| Draw buffer 320×240, 1/10, RGB565 | 15 kB RAM mỗi buffer |
| Chart 100 điểm × 2 series | ~800 byte |

Giao diện 320×240 với hai màn hình và khoảng 40 widget nằm gọn trong `LV_MEM_SIZE` 48 kB
cộng hai draw buffer 15 kB. Đó là lý do STM32F407 (192 kB RAM) là đích ngắm rất phổ biến
của LVGL.

## Dự án cuối — dashboard cảm biến

Toàn bộ series gói trong một màn hình:

![Dự án cuối](/MyPortfolio/images/lvgl/dashboard-project.svg)

```c
#include "lvgl/lvgl.h"

/* ---------- trạng thái ---------- */
typedef struct {
    lv_obj_t          * temp_val;
    lv_obj_t          * hum_val;
    lv_obj_t          * chart;
    lv_chart_series_t * s_temp;
    lv_chart_series_t * s_hum;
    lv_obj_t          * btn_log;
    bool                logging;
} dash_t;

static dash_t d;

/* ---------- style dùng chung ---------- */
static lv_style_t st_card, st_caption, st_value;

static void styles_init(void)
{
    lv_style_init(&st_card);
    lv_style_set_bg_color(&st_card, lv_color_white());
    lv_style_set_border_color(&st_card, lv_color_hex(0xe4e4e7));
    lv_style_set_border_width(&st_card, 1);
    lv_style_set_radius(&st_card, 10);
    lv_style_set_pad_all(&st_card, 10);

    lv_style_init(&st_caption);
    lv_style_set_text_color(&st_caption, lv_color_hex(0x71717a));

    lv_style_init(&st_value);
    lv_style_set_text_color(&st_value, lv_color_hex(0x18181b));
    lv_style_set_text_font(&st_value, &lv_font_montserrat_28);
}

/* ---------- thẻ số liệu dùng lại được ---------- */
static lv_obj_t * stat_card(lv_obj_t * parent, const char * caption)
{
    lv_obj_t * card = lv_obj_create(parent);
    lv_obj_add_style(card, &st_card, 0);
    lv_obj_set_height(card, LV_SIZE_CONTENT);
    lv_obj_set_flex_grow(card, 1);
    lv_obj_set_layout(card, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(card, LV_FLEX_FLOW_COLUMN);
    lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t * cap = lv_label_create(card);
    lv_obj_add_style(cap, &st_caption, 0);
    lv_label_set_text(cap, caption);

    lv_obj_t * val = lv_label_create(card);
    lv_obj_add_style(val, &st_value, 0);
    lv_label_set_text(val, "--");
    return val;                       /* trả về label giá trị cho bên gọi */
}

/* ---------- sự kiện ---------- */
static void log_cb(lv_event_t * e)
{
    d.logging = !d.logging;
    lv_obj_t * lbl = lv_obj_get_child(d.btn_log, 0);
    lv_label_set_text(lbl, d.logging ? LV_SYMBOL_STOP "  Dung ghi"
                                     : LV_SYMBOL_PLAY "  Bat dau ghi");
}

/* ---------- cập nhật định kỳ ---------- */
static void tick_cb(lv_timer_t * t)
{
    int temp_x10 = sensor_temp_x10();      /* vd 274 => 27.4 C */
    int hum      = sensor_humidity();

    lv_label_set_text_fmt(d.temp_val, "%d.%d C", temp_x10 / 10, temp_x10 % 10);
    lv_label_set_text_fmt(d.hum_val,  "%d %%", hum);

    lv_chart_set_next_value(d.chart, d.s_temp, temp_x10 / 10);
    lv_chart_set_next_value(d.chart, d.s_hum,  hum);
}

/* ---------- dựng giao diện ---------- */
void dashboard_create(void)
{
    styles_init();

    lv_obj_t * scr = lv_scr_act();
    lv_obj_set_style_bg_color(scr, lv_color_hex(0xf4f4f5), 0);
    lv_obj_set_style_pad_all(scr, 8, 0);
    lv_obj_set_layout(scr, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(scr, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_row(scr, 8, 0);

    /* header */
    lv_obj_t * hdr = lv_obj_create(scr);
    lv_obj_set_size(hdr, lv_pct(100), LV_SIZE_CONTENT);
    lv_obj_set_style_bg_color(hdr, lv_color_hex(0x2563eb), 0);
    lv_obj_set_style_border_width(hdr, 0, 0);
    lv_obj_set_style_radius(hdr, 10, 0);
    lv_obj_set_style_pad_all(hdr, 10, 0);
    lv_obj_t * title = lv_label_create(hdr);
    lv_label_set_text(title, "Sensor Dashboard");
    lv_obj_set_style_text_color(title, lv_color_white(), 0);

    /* hàng số liệu */
    lv_obj_t * row = lv_obj_create(scr);
    lv_obj_set_size(row, lv_pct(100), LV_SIZE_CONTENT);
    lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(row, 0, 0);
    lv_obj_set_style_pad_all(row, 0, 0);
    lv_obj_set_style_pad_column(row, 8, 0);
    lv_obj_set_layout(row, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);

    d.temp_val = stat_card(row, "TEMPERATURE");
    d.hum_val  = stat_card(row, "HUMIDITY");

    /* đồ thị */
    d.chart = lv_chart_create(scr);
    lv_obj_add_style(d.chart, &st_card, 0);
    lv_obj_set_width(d.chart, lv_pct(100));
    lv_obj_set_flex_grow(d.chart, 1);
    lv_chart_set_type(d.chart, LV_CHART_TYPE_LINE);
    lv_chart_set_point_count(d.chart, 60);
    lv_chart_set_update_mode(d.chart, LV_CHART_UPDATE_MODE_SHIFT);
    lv_chart_set_range(d.chart, LV_CHART_AXIS_PRIMARY_Y, 0, 100);
    lv_obj_set_style_size(d.chart, 0, LV_PART_INDICATOR);      /* bỏ chấm */
    d.s_temp = lv_chart_add_series(d.chart, lv_palette_main(LV_PALETTE_BLUE),
                                   LV_CHART_AXIS_PRIMARY_Y);
    d.s_hum  = lv_chart_add_series(d.chart, lv_palette_main(LV_PALETTE_CYAN),
                                   LV_CHART_AXIS_PRIMARY_Y);

    /* nút hành động */
    d.btn_log = lv_btn_create(scr);
    lv_obj_set_width(d.btn_log, lv_pct(100));
    lv_obj_add_event_cb(d.btn_log, log_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t * bl = lv_label_create(d.btn_log);
    lv_label_set_text(bl, LV_SYMBOL_PLAY "  Bat dau ghi");
    lv_obj_center(bl);

    /* bơm dữ liệu */
    lv_timer_create(tick_cb, 1000, NULL);
}
```

Mọi khái niệm của series đều nằm trong đó: cây đối tượng, flex layout với `flex_grow`,
style dùng chung, event callback, `lv_timer` định kỳ, và chart ở chế độ shift. Nó chạy
nguyên si trên simulator PC lẫn trên phần cứng.

## Đi tiếp từ đâu

- **SquareLine Studio** — trình kéo-thả xuất ra code C của LVGL. Hữu ích khi bạn đã hiểu
  code nó sinh ra; là cái bẫy nếu dùng trước khi hiểu.
- **EEZ Studio** — lựa chọn mã nguồn mở với mục tiêu tương tự.
- **`lv_examples`** — mỗi widget đều có ví dụ chạy được ngay trong repo LVGL. Hãy đọc
  chúng thay vì lục diễn đàn.
- **Tài liệu chính thức docs.lvgl.io** — thật sự tốt, có demo chạy ngay trên trình duyệt.

## Tóm tắt cả series

1. Mô hình retained-mode và hai callback nối LVGL với phần cứng.
2. Simulator trước; rồi draw buffer, flush, tick và `lv_conf.h`.
3. Object, quan hệ cha–con, label, button.
4. Align, Flex, Grid và đơn vị kích thước.
5. Style cục bộ và style dùng chung; part × state; theme.
6. Sự kiện, user data, bubbling và đầu vào bằng encoder.
7. Timer và animation.
8. Chart, đo đạc, tối ưu và một dashboard hoàn chỉnh.

Nếu bạn đã làm theo, giờ bạn có một project simulator chạy được và một màn hình thật trên
thiết bị. Đó chính là mục tiêu — phần còn lại chỉ là thêm widget.
