---
lesson: 1
lang: en
title: "What Is LVGL, and How Does It Actually Work?"
description: "The mental model you need before writing a single line of UI code: what LVGL does, what it refuses to do, and the two callbacks that connect it to your hardware."
duration: "12 min"
tags: ["LVGL", "Embedded GUI", "Architecture"]
---

## Why this lesson exists

Most people meet LVGL by copying an example, seeing a button appear, and then getting
completely stuck the moment something behaves unexpectedly. That happens because LVGL is
not a "draw on the screen" library — it is a **retained-mode GUI toolkit**. Until you
have that model in your head, every bug looks like magic.

This lesson gives you the model. No setup yet, no toolchain. Just the picture.

## What LVGL is

LVGL (Light and Versatile Graphics Library) is an MIT-licensed C library that gives you:

- **Widgets** — buttons, labels, sliders, charts, keyboards, tables, and around 30 more.
- **A style system** — colors, padding, borders, shadows, fonts, per state and per part.
- **Layout engines** — Flexbox and Grid, the same concepts you know from CSS.
- **Events, timers, and animations** — the interactive parts of a UI.
- **A renderer** — it converts all of the above into pixels in a RAM buffer.

It runs on roughly **64 kB flash and 16 kB RAM** at the low end, which is why you see it
on STM32F1-class parts as well as on Linux SBCs.

![LVGL architecture](/MyPortfolio/images/lvgl/architecture.svg)

## What LVGL is *not*

This is the half people skip, and it causes most of the early confusion:

- **It does not talk to your display.** LVGL never writes an SPI byte. It fills a RAM
  buffer and calls *your* function to push those pixels out.
- **It does not read your touch panel.** It calls *your* function and asks "is something
  pressed, and where?"
- **It does not know what time it is.** You must feed it milliseconds.

Those three sentences are the entire porting layer. Everything else is just C code you
call from your application.

## Retained mode — the key idea

There are two ways a GUI library can work.

**Immediate mode** (like Dear ImGui): every frame, you re-describe the whole UI.
"Draw a button here. If it was clicked, do this." Nothing is stored between frames.

**Retained mode** (LVGL): you *create an object once*, and it stays alive in RAM until
you delete it. LVGL owns it, remembers its position, style, and state, and redraws it
when — and only when — something about it changed.

```c
/* This runs ONCE, not every frame. */
lv_obj_t * btn = lv_btn_create(lv_scr_act());
lv_obj_set_size(btn, 120, 50);
lv_obj_center(btn);

lv_obj_t * label = lv_label_create(btn);
lv_label_set_text(label, "Start");
lv_obj_center(label);
```

After those seven lines, the button exists forever. Your `main` loop does *not* recreate
it. This has three consequences that explain almost every beginner question:

1. **`lv_obj_t *` handles are long-lived.** Store them if you need to update them later.
2. **If you call a create function in a loop, you leak objects** — and they all stack on
   top of each other on screen.
3. **LVGL only redraws dirty areas.** Change one label and only that rectangle is
   re-rendered and flushed. That is why LVGL is fast on a 72 MHz MCU.

## The runtime loop

LVGL needs two things from you, forever:

![LVGL runtime loop](/MyPortfolio/images/lvgl/runtime-loop.svg)

```c
int main(void)
{
    hal_init();              /* your clocks, SPI, LCD reset, etc. */

    lv_init();               /* 1. start the library            */
    my_display_register();   /* 2. draw buffer + flush_cb       */
    my_touch_register();     /* 3. read_cb                      */

    create_my_ui();          /* 4. build widgets — once         */

    while (1) {
        lv_timer_handler();  /* 5. let LVGL work                */
        my_delay_ms(5);
    }
}
```

And somewhere in a 1 ms interrupt:

```c
void SysTick_Handler(void)
{
    lv_tick_inc(1);          /* LVGL now knows time passes */
}
```

`lv_timer_handler()` is where everything happens: it polls your input device, advances
animations, runs expired timers, recalculates layouts, renders the dirty areas, and calls
your `flush_cb`. Call it every ~5 ms. Call it too rarely and the UI feels sluggish; the
function itself returns quickly when there is nothing to do.

> **The single most common porting bug:** forgetting `lv_tick_inc()`. Your UI draws
> correctly but nothing animates, no button ever registers a long-press, and timers never
> fire. LVGL literally believes time has stopped.

## The two callbacks, in full

**Display flush** — LVGL hands you a rectangle and a pixel buffer. You push it out, then
tell LVGL you are done:

```c
static void my_flush_cb(lv_disp_drv_t * drv, const lv_area_t * area, lv_color_t * px)
{
    /* area->x1, y1, x2, y2 are INCLUSIVE pixel coordinates */
    lcd_set_window(area->x1, area->y1, area->x2, area->y2);
    lcd_write_pixels((uint16_t *)px, lv_area_get_size(area));

    lv_disp_flush_ready(drv);   /* MUST be called, or LVGL blocks forever */
}
```

If you use DMA, call `lv_disp_flush_ready()` from the DMA-complete interrupt instead —
that is the whole trick behind smooth UIs on slow SPI buses.

**Input read** — LVGL asks, you answer:

```c
static void my_touch_cb(lv_indev_drv_t * drv, lv_indev_data_t * data)
{
    int16_t x, y;
    if (touch_is_pressed(&x, &y)) {
        data->point.x = x;
        data->point.y = y;
        data->state   = LV_INDEV_STATE_PRESSED;
    } else {
        data->state   = LV_INDEV_STATE_RELEASED;
    }
}
```

Note what is missing: no gesture detection, no click logic, no debouncing of *meaning*.
You report raw pressed/released and coordinates. LVGL turns that into `LV_EVENT_CLICKED`,
long presses, scrolling, and drag — for every widget, for free.

## LVGL 8 vs LVGL 9

You will find tutorials for both. The concepts in this series are identical; some names
changed in v9:

| Concept | LVGL 8 | LVGL 9 |
| --- | --- | --- |
| Display object | `lv_disp_drv_t` + `lv_disp_drv_register()` | `lv_display_create()` |
| Buffer setup | `lv_disp_draw_buf_init()` | `lv_display_set_buffers()` |
| Button widget | `lv_btn_create()` | `lv_button_create()` |
| Time base | `lv_tick_inc()` | `lv_tick_inc()` or a tick callback |

This series uses **LVGL 8.3 naming**, because it is what most vendor BSPs still ship, and
the mapping to v9 is mechanical. Where v9 differs meaningfully, I will say so.

## Check yourself

Before moving on, you should be able to answer these without scrolling up:

1. Who writes pixels to the LCD — LVGL or you?
2. What happens if you call `lv_label_create()` inside your `while(1)` loop?
3. Why does a UI freeze if `lv_disp_flush_ready()` is never called?
4. What breaks when `lv_tick_inc()` is missing?

## Next

Lesson 2 gets LVGL actually running — on your PC in about ten minutes, and then on real
hardware, with a working `flush_cb` you can copy.
