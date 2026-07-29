---
lesson: 6
lang: en
title: "Events and Input Devices"
description: "Event codes, callbacks, user data, bubbling, and how to drive the exact same UI with a touchscreen, a rotary encoder, or three push buttons."
duration: "15 min"
tags: ["LVGL", "Events", "Encoder", "Touch"]
---

## The event system in one picture

![Event flow](/MyPortfolio/images/lvgl/events.svg)

Your `read_cb` reports raw coordinates and a pressed/released state. LVGL figures out
which widget is under that point, tracks how long it has been held, whether the finger
moved, and turns all of that into semantic event codes it sends to your callbacks.

## Registering a callback

```c
lv_obj_add_event_cb(obj, my_cb, LV_EVENT_CLICKED, user_data);
```

You can register several callbacks on the same object, and one callback for several event
codes by passing `LV_EVENT_ALL`.

Inside the callback:

```c
static void my_cb(lv_event_t * e)
{
    lv_event_code_t  code   = lv_event_get_code(e);
    lv_obj_t       * target = lv_event_get_target(e);       /* what was touched */
    void           * data   = lv_event_get_user_data(e);    /* what you passed  */

    if (code == LV_EVENT_CLICKED) {
        /* ... */
    }
}
```

## The event codes that matter

**Input events**

| Code | When |
| --- | --- |
| `LV_EVENT_PRESSED` | finger goes down on the object |
| `LV_EVENT_PRESSING` | repeatedly, while held |
| `LV_EVENT_LONG_PRESSED` | after `LV_INDEV_DEF_LONG_PRESS_TIME` (400 ms) |
| `LV_EVENT_LONG_PRESSED_REPEAT` | repeatedly after that |
| `LV_EVENT_RELEASED` | finger lifts, anywhere |
| `LV_EVENT_CLICKED` | lifts **while still on the object** ← use this one |
| `LV_EVENT_GESTURE` | swipe detected on the screen |

The difference between `RELEASED` and `CLICKED` matters: drag your finger off a button
before lifting, and you get `RELEASED` but no `CLICKED`. That is the standard "cancel a
press" behavior users expect, and you get it for free by choosing the right code.

**Value events**

| Code | When |
| --- | --- |
| `LV_EVENT_VALUE_CHANGED` | slider moved, checkbox toggled, dropdown selected, roller turned |
| `LV_EVENT_READY` / `LV_EVENT_CANCEL` | keyboard/msgbox confirm or dismiss |

**Lifecycle events**

| Code | When |
| --- | --- |
| `LV_EVENT_DELETE` | object is about to be freed — release your resources here |
| `LV_EVENT_SIZE_CHANGED` | geometry changed |
| `LV_EVENT_DRAW_MAIN` | custom drawing hook |

## User data — passing context cleanly

The naive approach is a global for every widget. Don't. Pass a pointer instead:

```c
typedef struct {
    uint8_t     channel;
    lv_obj_t  * readout;
} channel_ctx_t;

static channel_ctx_t ctx[4];        /* static: must outlive the widget */

static void ch_cb(lv_event_t * e)
{
    channel_ctx_t * c = lv_event_get_user_data(e);
    int32_t v = lv_slider_get_value(lv_event_get_target(e));

    dac_set_output(c->channel, v);
    lv_label_set_text_fmt(c->readout, "CH%d: %d", c->channel, (int)v);
}

for (int i = 0; i < 4; i++) {
    lv_obj_t * sl = lv_slider_create(parent);
    ctx[i].channel = i;
    ctx[i].readout = make_readout(parent, i);
    lv_obj_add_event_cb(sl, ch_cb, LV_EVENT_VALUE_CHANGED, &ctx[i]);
}
```

One callback, four sliders, no globals, no `switch` on pointers.

## Bubbling

By default an event fires on the target only. Turn on bubbling and it also travels up to
the parents:

```c
lv_obj_add_flag(child, LV_OBJ_FLAG_EVENT_BUBBLE);
```

That is how you handle a list of 30 items with one callback on the container:

```c
static void list_cb(lv_event_t * e)
{
    lv_obj_t * item = lv_event_get_target(e);        /* the item that was hit */
    lv_obj_t * cont = lv_event_get_current_target(e);/* where the cb is bound */

    uint32_t index = lv_obj_get_index(item);
    open_detail(index);
}
```

`lv_event_get_target()` vs `lv_event_get_current_target()` is the single most useful
distinction once bubbling is on.

## Sending events yourself

```c
lv_event_send(obj, LV_EVENT_CLICKED, NULL);          /* simulate a click     */
lv_obj_send_event(obj, LV_EVENT_REFRESH, NULL);      /* LVGL 9 spelling      */
```

Useful for tests, for "apply defaults" buttons, and for driving your UI from a serial
command during bring-up.

## Input device types

LVGL supports four kinds of input, all through the same `read_cb` shape:

```c
indev_drv.type = LV_INDEV_TYPE_POINTER;   /* touch or mouse         */
indev_drv.type = LV_INDEV_TYPE_ENCODER;   /* rotary + push          */
indev_drv.type = LV_INDEV_TYPE_KEYPAD;    /* arrow keys + enter     */
indev_drv.type = LV_INDEV_TYPE_BUTTON;    /* buttons mapped to XY   */
```

### Encoder — the non-touch workhorse

Industrial panels and cheap devices often have one rotary encoder and nothing else. LVGL
handles this properly through **groups**: the encoder moves focus between widgets, and
pressing enters "edit" mode on the focused one.

```c
static lv_group_t * g;

static void encoder_read(lv_indev_drv_t * drv, lv_indev_data_t * data)
{
    data->enc_diff = encoder_get_delta();        /* -N .. +N since last call */
    data->state = encoder_button_pressed() ? LV_INDEV_STATE_PRESSED
                                           : LV_INDEV_STATE_RELEASED;
}

void encoder_init(void)
{
    static lv_indev_drv_t drv;
    lv_indev_drv_init(&drv);
    drv.type    = LV_INDEV_TYPE_ENCODER;
    drv.read_cb = encoder_read;
    lv_indev_t * indev = lv_indev_drv_register(&drv);

    g = lv_group_create();
    lv_indev_set_group(indev, g);
    lv_group_set_default(g);        /* new widgets join automatically */
}

/* add widgets to the navigation order */
lv_group_add_obj(g, btn_start);
lv_group_add_obj(g, slider_speed);
lv_group_add_obj(g, dropdown_mode);
```

Now: rotate → focus moves; press → edit the focused widget; rotate → change its value;
press → confirm. Your button and slider code is *identical* to the touch version. This is
the strongest argument for using LVGL's event system rather than polling widget values
yourself.

### Debouncing and calibration belong to you

LVGL does not debounce. If your resistive touch controller reports jitter, filter it in
`read_cb` — a simple 3-sample median is usually enough:

```c
static void touch_read(lv_indev_drv_t * drv, lv_indev_data_t * data)
{
    int16_t rx, ry;
    if (!touch_raw(&rx, &ry)) { data->state = LV_INDEV_STATE_RELEASED; return; }

    /* map raw ADC range to pixels — calibrate once, store in flash */
    data->point.x = (rx - CAL_X_MIN) * HRES / (CAL_X_MAX - CAL_X_MIN);
    data->point.y = (ry - CAL_Y_MIN) * VRES / (CAL_Y_MAX - CAL_Y_MIN);

    /* clamp: out-of-range points make LVGL ignore the press entirely */
    if (data->point.x < 0) data->point.x = 0;
    if (data->point.y < 0) data->point.y = 0;
    if (data->point.x >= HRES) data->point.x = HRES - 1;
    if (data->point.y >= VRES) data->point.y = VRES - 1;

    data->state = LV_INDEV_STATE_PRESSED;
}
```

## Worked example — a settings row

```c
static lv_obj_t * lbl_speed;

static void speed_cb(lv_event_t * e)
{
    int32_t v = lv_slider_get_value(lv_event_get_target(e));
    lv_label_set_text_fmt(lbl_speed, "%d RPM", (int)v * 10);
    motor_set_speed(v);
}

static void estop_cb(lv_event_t * e)
{
    motor_stop();
    lv_obj_t * mb = lv_msgbox_create(NULL, "Stopped",
                                     "Motor halted by operator.",
                                     NULL, true);
    lv_obj_center(mb);
}

void build_controls(lv_obj_t * parent)
{
    lv_obj_t * sl = lv_slider_create(parent);
    lv_slider_set_range(sl, 0, 300);
    lv_obj_set_width(sl, lv_pct(80));
    lv_obj_add_event_cb(sl, speed_cb, LV_EVENT_VALUE_CHANGED, NULL);

    lbl_speed = lv_label_create(parent);
    lv_label_set_text(lbl_speed, "0 RPM");

    lv_obj_t * stop = lv_btn_create(parent);
    lv_obj_add_event_cb(stop, estop_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_set_style_bg_color(stop, lv_palette_main(LV_PALETTE_RED), 0);
    lv_obj_t * l = lv_label_create(stop);
    lv_label_set_text(l, LV_SYMBOL_STOP "  E-STOP");
    lv_obj_center(l);
}
```

Note `LV_EVENT_VALUE_CHANGED` on the slider: it fires continuously while dragging. If your
action is expensive (writing flash, sending a CAN frame), throttle it or act on
`LV_EVENT_RELEASED` instead.

## Common mistakes

- **Doing slow work in a callback.** Callbacks run inside `lv_timer_handler()`. A 200 ms
  flash write there freezes the UI for 200 ms. Set a flag and do the work in your main loop.
- **Deleting the object that is currently handling an event.** Use
  `lv_obj_del_async(obj)` — it defers the delete until the event finishes.
- **Assuming `LV_EVENT_VALUE_CHANGED` fires when you set the value in code.** It does not,
  by default. `lv_slider_set_value(sl, v, LV_ANIM_OFF)` is silent; send the event yourself
  if you need the same code path.

## Next

Lesson 7 adds motion and time: animations, `lv_timer`, and how to refresh a screen from
sensor data without blocking anything.
