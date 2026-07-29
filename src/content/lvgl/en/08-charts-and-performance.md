---
lesson: 8
lang: en
title: "Data Widgets, Performance, and the Final Project"
description: "Charts, tables and meters; measuring FPS and RAM; the optimizations that actually move the needle on an MCU — and a complete sensor dashboard tying the whole series together."
duration: "20 min"
tags: ["LVGL", "Chart", "Performance", "Project"]
---

## lv_chart — the widget you will use most

```c
lv_obj_t * chart = lv_chart_create(parent);
lv_obj_set_size(chart, 300, 160);
lv_chart_set_type(chart, LV_CHART_TYPE_LINE);
lv_chart_set_point_count(chart, 60);                 /* 60 samples visible */
lv_chart_set_range(chart, LV_CHART_AXIS_PRIMARY_Y, 0, 100);

lv_chart_series_t * s1 = lv_chart_add_series(chart,
        lv_palette_main(LV_PALETTE_BLUE), LV_CHART_AXIS_PRIMARY_Y);
lv_chart_series_t * s2 = lv_chart_add_series(chart,
        lv_palette_main(LV_PALETTE_CYAN), LV_CHART_AXIS_PRIMARY_Y);
```

Feed it. `SHIFT` mode is the scrolling-oscilloscope behavior you almost always want:

```c
lv_chart_set_update_mode(chart, LV_CHART_UPDATE_MODE_SHIFT);

/* in your sampling timer */
lv_chart_set_next_value(chart, s1, temperature);
lv_chart_set_next_value(chart, s2, humidity);
```

Two important details:

**1. The point array is allocated from LVGL's heap.** 60 points × 2 series × 4 bytes is
480 bytes; 500 points × 4 series is 8 kB. On a small MCU, `lv_chart_set_point_count()` is
a memory decision, not a cosmetic one.

**2. Use an external array for large or existing data** and skip the copy entirely:

```c
static lv_coord_t samples[240];       /* your own ring buffer */
lv_chart_set_ext_y_array(chart, s1, samples);

/* after updating samples[] yourself */
lv_chart_refresh(chart);
```

Styling the grid and axes:

```c
lv_chart_set_div_line_count(chart, 5, 7);
lv_obj_set_style_line_width(chart, 2, LV_PART_ITEMS);   /* series thickness */
lv_obj_set_style_size(chart, 0, LV_PART_INDICATOR);     /* hide point dots  */
lv_chart_set_axis_tick(chart, LV_CHART_AXIS_PRIMARY_Y, 5, 3, 5, 1, true, 40);
```

Hiding the point indicators (`size 0`) is a real performance win on dense charts.

## lv_table and lv_meter, briefly

```c
/* table — cells are strings; the widget only renders visible rows */
lv_obj_t * tbl = lv_table_create(parent);
lv_table_set_col_cnt(tbl, 2);
lv_table_set_row_cnt(tbl, 8);
lv_table_set_cell_value(tbl, 0, 0, "Node");
lv_table_set_cell_value_fmt(tbl, 1, 1, "%d dBm", rssi);

/* meter — analog gauge with needles and colored arcs */
lv_obj_t * meter = lv_meter_create(parent);
lv_meter_scale_t * sc = lv_meter_add_scale(meter);
lv_meter_set_scale_range(meter, sc, 0, 120, 270, 135);
lv_meter_indicator_t * needle =
        lv_meter_add_needle_line(meter, sc, 3, lv_palette_main(LV_PALETTE_RED), -10);
lv_meter_set_indicator_value(meter, needle, rpm);
```

`lv_meter` is beautiful and expensive — it redraws a large circular area. On a 100 MHz MCU
with SPI, one meter animating continuously can eat your whole frame budget. Measure it.

## Measuring — before optimizing anything

Turn on the built-in monitor:

```c
#define LV_USE_PERF_MONITOR 1     /* FPS + CPU% overlay, bottom right */
#define LV_USE_MEM_MONITOR  1     /* LVGL heap usage overlay          */
```

Read them like this:

- **FPS below 20** with **CPU under 50%** → your bottleneck is the flush path (SPI clock,
  no DMA, buffer too small), not LVGL.
- **FPS below 20** with **CPU near 100%** → the drawing itself is expensive. Look for
  shadows, gradients, large images, and `lv_meter`.
- **Memory monitor climbing** and never coming back down → you are leaking objects.

Programmatically:

```c
lv_mem_monitor_t m;
lv_mem_monitor(&m);
printf("used %u / %u (%u%%), frag %u%%, largest free %u\n",
       (unsigned)(m.total_size - m.free_size), (unsigned)m.total_size,
       m.used_pct, m.frag_pct, (unsigned)m.free_biggest_size);
```

Watch `frag_pct`. Creating and deleting screens repeatedly fragments LVGL's heap; if
`free_size` is large but `free_biggest_size` is small, you will get allocation failures
that look random.

## Optimizations that actually help

**Ranked by impact, on a typical SPI-LCD MCU:**

1. **DMA + two draw buffers.** Usually a 2–3× improvement. Nothing else comes close.
2. **A bigger draw buffer.** 1/10 → 1/4 of the screen reduces the number of flush calls
   and the per-call overhead.
3. **Remove shadows.** `shadow_width` on a scrolling list is the most common cause of
   stutter I have seen in review.
4. **Avoid full-screen redraws.** Change a label, not the whole screen background.
   `lv_obj_invalidate()` on the smallest possible object.
5. **Turn off what you do not use** in `lv_conf.h`. Each `LV_USE_*` you disable is flash
   you get back:

```c
#define LV_USE_CALENDAR   0
#define LV_USE_KEYBOARD   0
#define LV_USE_CANVAS     0
#define LV_USE_SPAN       0
#define LV_BUILD_EXAMPLES 0
```

6. **Fewer font sizes.** Montserrat 28 alone is roughly 12 kB of flash.
7. **`LV_IMG_CF_TRUE_COLOR` images matched to `LV_COLOR_DEPTH`** so no runtime conversion
   happens per pixel.

**Do not** micro-optimize your own C in the event callbacks first. That is never the
bottleneck.

## Memory budget, roughly

| Item | Typical cost |
| --- | --- |
| LVGL core code | 60–120 kB flash |
| One `lv_obj_t` | ~120–200 bytes RAM |
| Montserrat 14 | ~7 kB flash |
| Montserrat 28 | ~12 kB flash |
| Draw buffer, 320×240, 1/10, RGB565 | 15 kB RAM each |
| Chart, 100 points × 2 series | ~800 bytes |

A 320×240 UI with two screens and ~40 widgets fits comfortably in 48 kB `LV_MEM_SIZE`
plus two 15 kB draw buffers. That is why an STM32F407 (192 kB RAM) is such a common LVGL
target.

## Final project — sensor dashboard

Everything from the series in one screen:

![Final project](/MyPortfolio/images/lvgl/dashboard-project.svg)

```c
#include "lvgl/lvgl.h"

/* ---------- state ---------- */
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

/* ---------- shared styles ---------- */
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

/* ---------- a reusable stat card ---------- */
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
    return val;                       /* caller keeps the value label */
}

/* ---------- events ---------- */
static void log_cb(lv_event_t * e)
{
    d.logging = !d.logging;
    lv_obj_t * lbl = lv_obj_get_child(d.btn_log, 0);
    lv_label_set_text(lbl, d.logging ? LV_SYMBOL_STOP "  Stop logging"
                                     : LV_SYMBOL_PLAY "  Start logging");
}

/* ---------- periodic refresh ---------- */
static void tick_cb(lv_timer_t * t)
{
    int temp_x10 = sensor_temp_x10();      /* e.g. 274 => 27.4 C */
    int hum      = sensor_humidity();

    lv_label_set_text_fmt(d.temp_val, "%d.%d C", temp_x10 / 10, temp_x10 % 10);
    lv_label_set_text_fmt(d.hum_val,  "%d %%", hum);

    lv_chart_set_next_value(d.chart, d.s_temp, temp_x10 / 10);
    lv_chart_set_next_value(d.chart, d.s_hum,  hum);
}

/* ---------- build ---------- */
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

    /* stat row */
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

    /* chart */
    d.chart = lv_chart_create(scr);
    lv_obj_add_style(d.chart, &st_card, 0);
    lv_obj_set_width(d.chart, lv_pct(100));
    lv_obj_set_flex_grow(d.chart, 1);
    lv_chart_set_type(d.chart, LV_CHART_TYPE_LINE);
    lv_chart_set_point_count(d.chart, 60);
    lv_chart_set_update_mode(d.chart, LV_CHART_UPDATE_MODE_SHIFT);
    lv_chart_set_range(d.chart, LV_CHART_AXIS_PRIMARY_Y, 0, 100);
    lv_obj_set_style_size(d.chart, 0, LV_PART_INDICATOR);      /* no dots */
    d.s_temp = lv_chart_add_series(d.chart, lv_palette_main(LV_PALETTE_BLUE),
                                   LV_CHART_AXIS_PRIMARY_Y);
    d.s_hum  = lv_chart_add_series(d.chart, lv_palette_main(LV_PALETTE_CYAN),
                                   LV_CHART_AXIS_PRIMARY_Y);

    /* action button */
    d.btn_log = lv_btn_create(scr);
    lv_obj_set_width(d.btn_log, lv_pct(100));
    lv_obj_add_event_cb(d.btn_log, log_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t * bl = lv_label_create(d.btn_log);
    lv_label_set_text(bl, LV_SYMBOL_PLAY "  Start logging");
    lv_obj_center(bl);

    /* data pump */
    lv_timer_create(tick_cb, 1000, NULL);
}
```

Every concept from the series is in there: object tree, flex layout with `flex_grow`,
shared styles, an event callback, a periodic `lv_timer`, and a chart in shift mode. It runs
unchanged in the PC simulator and on hardware.

## Where to go next

- **SquareLine Studio** — a drag-and-drop editor that exports LVGL C code. Useful once you
  understand the code it generates; a trap if you use it before that.
- **EEZ Studio** — an open-source alternative with similar goals.
- **`lv_examples`** — every widget has a runnable example in the LVGL repo. Read them
  rather than searching forums.
- **The official docs at docs.lvgl.io** — genuinely good, with live browser demos.

## Series recap

1. Retained-mode model, and the two callbacks that connect LVGL to hardware.
2. Simulator first; then draw buffers, flush, tick, and `lv_conf.h`.
3. Objects, parents, labels, buttons.
4. Align, Flex, Grid, and size units.
5. Local styles vs shared styles; parts × states; themes.
6. Events, user data, bubbling, and encoder input.
7. Timers and animations.
8. Charts, measurement, optimization, and a complete dashboard.

If you built along, you now have a working simulator project and a real device screen. That
is the whole point — the rest is just more widgets.
