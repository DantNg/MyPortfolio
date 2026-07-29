---
lesson: 7
lang: en
title: "Animations and Timers"
description: "lv_anim interpolates a number and hands it to your callback. lv_timer replaces every delay() in your UI code. Together they are how a UI stops feeling like a state machine."
duration: "13 min"
tags: ["LVGL", "Animation", "Timer"]
---

## lv_timer — delete every delay() from your UI

`lv_timer` is a cooperative software timer run by `lv_timer_handler()`. It is the correct
way to do anything periodic in a UI:

```c
static void refresh_cb(lv_timer_t * t)
{
    ui_ctx_t * ui = t->user_data;          /* LVGL 9: lv_timer_get_user_data(t) */

    float temp = sensor_read_temp();
    lv_label_set_text_fmt(ui->temp_label, "%d.%d C",
                          (int)temp, (int)(temp * 10) % 10);
}

lv_timer_t * t = lv_timer_create(refresh_cb, 500, &ui);   /* every 500 ms */
```

Control it later:

```c
lv_timer_set_period(t, 100);      /* speed up while a chart is visible */
lv_timer_pause(t);
lv_timer_resume(t);
lv_timer_ready(t);                /* fire on the next handler call     */
lv_timer_del(t);

/* run once, then delete itself */
lv_timer_t * once = lv_timer_create(splash_done_cb, 2000, NULL);
lv_timer_set_repeat_count(once, 1);
```

Because timers run inside `lv_timer_handler()`, they are on the same thread as the widget
tree — so calling LVGL functions from a timer callback is always safe. That is *not* true
of a FreeRTOS task or an ISR.

> Never call `vTaskDelay()`, `HAL_Delay()`, or a busy-wait inside a timer or event
> callback. You are blocking the renderer. Split the work across timer ticks instead.

## lv_anim — one number, smoothly, over time

An animation does exactly one thing: it calls your function repeatedly with a value that
moves from `start` to `end` along a curve.

![Animation curves](/MyPortfolio/images/lvgl/animation.svg)

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

The `lv_anim_t` on the stack is fine here — `lv_anim_start()` copies it into LVGL's own
list. This is the one place where a local descriptor is safe, unlike `lv_style_t`.

### The exec callback is where the power is

Because *you* write the setter, you can animate anything numeric:

```c
static void set_opa (void * o, int32_t v) { lv_obj_set_style_opa(o, v, 0); }
static void set_w   (void * o, int32_t v) { lv_obj_set_width(o, v); }
static void set_arc (void * o, int32_t v) { lv_arc_set_value(o, v); }
static void set_zoom(void * o, int32_t v) { lv_img_set_zoom(o, v); }

/* even a non-LVGL target: fade a backlight */
static void set_bl  (void * o, int32_t v) { pwm_set_duty(BACKLIGHT_CH, v); }
```

The last one is my favorite trick: LVGL's animation engine is a general-purpose easing
engine. Use it for hardware too.

### Useful settings

```c
lv_anim_set_delay(&a, 200);                    /* wait before starting        */
lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
lv_anim_set_repeat_delay(&a, 500);
lv_anim_set_playback_time(&a, 400);            /* animate back afterwards     */
lv_anim_set_ready_cb(&a, on_anim_done);        /* called when it finishes     */
lv_anim_set_deleted_cb(&a, on_anim_killed);
```

Paths: `lv_anim_path_linear`, `ease_in`, `ease_out`, `ease_in_out`, `overshoot`, `bounce`,
`step`.

### Stopping animations

```c
lv_anim_del(panel, set_x_cb);     /* this object, this property */
lv_anim_del(panel, NULL);         /* all animations of this object */
```

Always kill animations before deleting the object they target — or better, let LVGL do it:
deleting a widget automatically removes animations whose `var` is that widget. The danger
is animating something *else* (like a struct field) with the widget as user data.

## Built-in animation helpers

Several widgets animate for free:

```c
lv_slider_set_value(sl, 70, LV_ANIM_ON);
lv_bar_set_value(bar, 45, LV_ANIM_ON);
lv_arc_set_value(arc, 220);
lv_chart_set_update_mode(chart, LV_CHART_UPDATE_MODE_SHIFT);

lv_scr_load_anim(scr2, LV_SCR_LOAD_ANIM_FADE_IN, 300, 0, false);
lv_obj_scroll_to_view(item, LV_ANIM_ON);
```

Prefer these over hand-rolled animations: they know about the widget's internals and only
invalidate the areas that actually changed.

## Worked example — an animated gauge that follows a sensor

```c
typedef struct {
    lv_obj_t * arc;
    lv_obj_t * label;
    int32_t    shown;      /* what the UI currently displays */
} gauge_t;

static gauge_t g;

static void arc_exec(void * obj, int32_t v)
{
    lv_arc_set_value((lv_obj_t *)obj, v);
    lv_label_set_text_fmt(g.label, "%d%%", (int)v);
    g.shown = v;
}

/* called every 250 ms by an lv_timer */
static void poll_cb(lv_timer_t * t)
{
    int32_t target = sensor_read_load_percent();
    if (target == g.shown) return;              /* nothing to do */

    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, g.arc);
    lv_anim_set_exec_cb(&a, arc_exec);
    lv_anim_set_values(&a, g.shown, target);
    lv_anim_set_time(&a, 300);
    lv_anim_set_path_cb(&a, lv_anim_path_ease_out);
    lv_anim_start(&a);                          /* replaces any running one */
}

void gauge_create(lv_obj_t * parent)
{
    g.arc = lv_arc_create(parent);
    lv_obj_set_size(g.arc, 140, 140);
    lv_arc_set_range(g.arc, 0, 100);
    lv_arc_set_bg_angles(g.arc, 135, 45);
    lv_obj_remove_style(g.arc, NULL, LV_PART_KNOB);      /* read-only gauge */
    lv_obj_clear_flag(g.arc, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_center(g.arc);

    g.label = lv_label_create(parent);
    lv_obj_set_style_text_font(g.label, &lv_font_montserrat_28, 0);
    lv_obj_align_to(g.label, g.arc, LV_ALIGN_CENTER, 0, 0);

    lv_timer_create(poll_cb, 250, NULL);
}
```

Starting a new animation on the same object + exec_cb automatically replaces the previous
one, so a rapidly changing sensor produces a smoothly chasing needle rather than a jump.

## Performance notes

- Animations invalidate an area every frame. Animating a **full-screen** element on a slow
  SPI display will drop frames — animate small things, or accept a lower `LV_DISP_DEF_REFR_PERIOD`.
- `LV_DISP_DEF_REFR_PERIOD` (default 30 ms ≈ 33 fps) is the ceiling for animation
  smoothness. Lower it to 16 ms only if your flush path can keep up.
- Many simultaneous animations are cheap in CPU but each redraw is not. Stagger them with
  `lv_anim_set_delay()` — it also looks better.

## Next

The final lesson: data widgets (chart, table, meter), and the profiling and memory
techniques that turn a demo into firmware you can ship.
