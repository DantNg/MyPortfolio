---
lesson: 3
lang: en
title: "Your First Screen — Objects, Labels, Buttons"
description: "Everything is an lv_obj_t. Parents, children, screens, the label pitfalls nobody warns you about, and a complete first screen you can paste and run."
duration: "15 min"
tags: ["LVGL", "Widgets", "Beginner"]
---

## Everything is an object

There is exactly one base type in LVGL: `lv_obj_t`. A button is an `lv_obj_t` with button
behavior. A label is an `lv_obj_t` that draws text. A screen is an `lv_obj_t` with no
parent. Once you accept that, the API collapses into something small:

```c
lv_obj_t * thing = lv_<widget>_create(parent);
```

Every widget-specific function is then `lv_<widget>_set_something(thing, ...)`, and every
generic one is `lv_obj_set_something(thing, ...)`.

![Object tree](/MyPortfolio/images/lvgl/widget-tree.svg)

## Parents and children

The parent you pass to `_create()` decides three things:

1. **Where the child is positioned** — coordinates are relative to the parent's content
   area, not the screen.
2. **Whether it is visible** — children are clipped to the parent's bounds.
3. **What happens on delete** — deleting a parent deletes all of its children.

```c
lv_obj_t * card = lv_obj_create(lv_scr_act());   /* child of the screen  */
lv_obj_set_size(card, 200, 120);
lv_obj_center(card);

lv_obj_t * title = lv_label_create(card);        /* child of the card    */
lv_label_set_text(title, "Sensor");
lv_obj_align(title, LV_ALIGN_TOP_LEFT, 0, 0);    /* 0,0 = card's corner  */

lv_obj_del(card);                                /* title dies too       */
```

That last line matters more than it looks: you never have to track child pointers for
cleanup. Delete the container, and the whole subtree goes.

## Screens

`lv_scr_act()` returns the currently active screen. You can create more and switch:

```c
lv_obj_t * scr_home     = lv_obj_create(NULL);   /* NULL parent = a screen */
lv_obj_t * scr_settings = lv_obj_create(NULL);

/* build both... then */
lv_scr_load(scr_home);

/* or with a transition */
lv_scr_load_anim(scr_settings, LV_SCR_LOAD_ANIM_MOVE_LEFT, 300, 0, false);
```

The last parameter of `lv_scr_load_anim()` is `auto_del`. Pass `true` and the *old* screen
is deleted after the animation — convenient, but then its pointers are dangling. On a
memory-constrained device, that is usually what you want; just make sure you rebuild the
screen next time instead of reusing stale handles.

## Labels — the three things that trip people up

```c
lv_obj_t * label = lv_label_create(lv_scr_act());
lv_label_set_text(label, "Temperature: 24.5 C");
```

**1. `lv_label_set_text()` copies the string.** LVGL allocates from its own heap and keeps
its own copy, so this is safe:

```c
char buf[32];
snprintf(buf, sizeof(buf), "%.1f C", temperature);
lv_label_set_text(label, buf);      /* buf can go out of scope, fine */
```

If you are updating a label 20 times a second, avoid the allocation with the static
variant — but then **the buffer must outlive the label**:

```c
static char shared[32];             /* static! not a local */
snprintf(shared, sizeof(shared), "%.1f C", temperature);
lv_label_set_text_static(label, shared);
```

**2. Long text needs a mode and a width.** By default a label grows to fit its text and
happily runs off the screen:

```c
lv_obj_set_width(label, 200);                        /* must set a width first */
lv_label_set_long_mode(label, LV_LABEL_LONG_WRAP);   /* or SCROLL, DOT, CLIP   */
```

`LV_LABEL_LONG_SCROLL_CIRCULAR` gives you the marquee effect used in media players.

**3. Formatting is built in.** `lv_label_set_text_fmt()` takes printf arguments directly:

```c
lv_label_set_text_fmt(label, "%d%%  %s", battery, charging ? "CHG" : "BAT");
```

Note: `%f` is **not** supported on most builds — LVGL's printf is a small custom one. Use
integer math or `snprintf` into a buffer.

## Buttons

A button in LVGL is a container that responds to presses. It has no text of its own — you
put a label inside it:

```c
static void btn_event_cb(lv_event_t * e)
{
    lv_obj_t * btn   = lv_event_get_target(e);
    lv_obj_t * label = lv_obj_get_child(btn, 0);

    static uint32_t count = 0;
    count++;
    lv_label_set_text_fmt(label, "Pressed %u", count);
}

lv_obj_t * btn = lv_btn_create(lv_scr_act());
lv_obj_set_size(btn, 140, 50);
lv_obj_align(btn, LV_ALIGN_CENTER, 0, 40);
lv_obj_add_event_cb(btn, btn_event_cb, LV_EVENT_CLICKED, NULL);

lv_obj_t * btn_label = lv_label_create(btn);
lv_label_set_text(btn_label, "Press me");
lv_obj_center(btn_label);
```

Buttons can also be checkable — a toggle:

```c
lv_obj_add_flag(btn, LV_OBJ_FLAG_CHECKABLE);

/* in the callback */
bool on = lv_obj_has_state(btn, LV_STATE_CHECKED);
```

## A complete first screen

Paste this into your simulator's `my_ui()` and run it:

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
    /* --- card container --- */
    lv_obj_t * card = lv_obj_create(lv_scr_act());
    lv_obj_set_size(card, 260, 180);
    lv_obj_center(card);

    /* --- title --- */
    lv_obj_t * title = lv_label_create(card);
    lv_label_set_text(title, "Thermostat");
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 0);

    /* --- big value --- */
    value_label = lv_label_create(card);
    lv_label_set_text_fmt(value_label, "%d C", setpoint);
    lv_obj_set_style_text_font(value_label, &lv_font_montserrat_28, 0);
    lv_obj_align(value_label, LV_ALIGN_CENTER, 0, -10);

    /* --- minus button --- */
    lv_obj_t * bm = lv_btn_create(card);
    lv_obj_set_size(bm, 60, 44);
    lv_obj_align(bm, LV_ALIGN_BOTTOM_LEFT, 0, 0);
    lv_obj_add_event_cb(bm, minus_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t * lm = lv_label_create(bm);
    lv_label_set_text(lm, LV_SYMBOL_MINUS);
    lv_obj_center(lm);

    /* --- plus button --- */
    lv_obj_t * bp = lv_btn_create(card);
    lv_obj_set_size(bp, 60, 44);
    lv_obj_align(bp, LV_ALIGN_BOTTOM_RIGHT, 0, 0);
    lv_obj_add_event_cb(bp, plus_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t * lp = lv_label_create(bp);
    lv_label_set_text(lp, LV_SYMBOL_PLUS);
    lv_obj_center(lp);
}
```

`LV_SYMBOL_PLUS` and friends come from LVGL's built-in icon font — about 60 glyphs
(`LV_SYMBOL_WIFI`, `LV_SYMBOL_BATTERY_FULL`, `LV_SYMBOL_SETTINGS`, …) that cost you
nothing extra because the font is already linked.

## Object flags worth knowing early

```c
lv_obj_add_flag(obj,    LV_OBJ_FLAG_HIDDEN);      /* not drawn, not clickable  */
lv_obj_clear_flag(obj,  LV_OBJ_FLAG_SCROLLABLE);  /* stop accidental scrolling */
lv_obj_add_flag(obj,    LV_OBJ_FLAG_CHECKABLE);   /* toggle behavior           */
lv_obj_clear_flag(obj,  LV_OBJ_FLAG_CLICKABLE);   /* decoration only           */
```

`LV_OBJ_FLAG_SCROLLABLE` is on by default for `lv_obj`. If your container "bounces" when
users drag it, that is why — clear the flag.

## Next

Positioning everything by hand with `lv_obj_align()` stops scaling around the fifth
widget. Lesson 4 introduces Flex and Grid, and your layouts start writing themselves.
