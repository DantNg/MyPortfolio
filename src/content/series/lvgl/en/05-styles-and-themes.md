---
lesson: 5
lang: en
title: "Styles, Parts and States"
description: "How LVGL styling really works: local styles vs shared style objects, the part × state matrix, inheritance, transitions, and building a small design system."
duration: "16 min"
tags: ["LVGL", "Styling", "Theme"]
---

## Two ways to style, and when to use each

**Local style** — applies to one object, stored inside it:

```c
lv_obj_set_style_bg_color(btn, lv_color_hex(0x2563eb), 0);
lv_obj_set_style_radius(btn, 8, 0);
```

Fast to write, but each property costs a few bytes *per object*. Perfect for one-offs.

**Style object** — one `lv_style_t` shared by many objects:

```c
static lv_style_t style_card;                       /* must be static/global! */

void init_styles(void)
{
    lv_style_init(&style_card);
    lv_style_set_bg_color(&style_card, lv_color_hex(0xffffff));
    lv_style_set_border_color(&style_card, lv_color_hex(0xe4e4e7));
    lv_style_set_border_width(&style_card, 1);
    lv_style_set_radius(&style_card, 12);
    lv_style_set_pad_all(&style_card, 12);
}

lv_obj_add_style(card1, &style_card, 0);
lv_obj_add_style(card2, &style_card, 0);   /* same memory, zero extra cost */
```

> The style variable **must outlive every object using it**. A style declared as a local
> variable inside a function is the classic crash: LVGL keeps a pointer, the stack frame
> disappears, and you get corrupted rendering or a hard fault. `static` or global. Always.

Rule of thumb: three or more objects share a look → make it a style object.

## Parts and states

The third argument of every style function is a *selector*: `part | state`.

![Parts and states](/MyPortfolio/images/lvgl/style-parts-states.svg)

**Parts** are the pieces a widget is made of:

| Part | Where it appears |
| --- | --- |
| `LV_PART_MAIN` | the background of everything |
| `LV_PART_INDICATOR` | slider/bar fill, checkbox tick, arc value |
| `LV_PART_KNOB` | slider and arc handle |
| `LV_PART_SCROLLBAR` | scrollable containers |
| `LV_PART_ITEMS` | table cells, chart series, list items |
| `LV_PART_SELECTED` | the highlighted entry of a dropdown/roller |

**States** are how the object currently is:

`LV_STATE_DEFAULT`, `PRESSED`, `CHECKED`, `DISABLED`, `FOCUSED`, `FOCUS_KEY`, `EDITED`,
`HOVERED`, `SCROLLED`.

Combine them with `|`:

```c
/* the slider's filled track, normally */
lv_obj_set_style_bg_color(sl, lv_color_hex(0x2563eb), LV_PART_INDICATOR);

/* the knob, while being dragged */
lv_obj_set_style_bg_color(sl, lv_color_hex(0x1d4ed8), LV_PART_KNOB | LV_STATE_PRESSED);

/* the whole widget, when disabled */
lv_obj_set_style_bg_opa(sl, LV_OPA_40, LV_PART_MAIN | LV_STATE_DISABLED);
```

Passing `0` as the selector means `LV_PART_MAIN | LV_STATE_DEFAULT`, which is why you see
so many calls ending in `, 0)`.

State is set for you by LVGL on touch, but you can force it:

```c
lv_obj_add_state(btn, LV_STATE_DISABLED);
lv_obj_clear_state(btn, LV_STATE_DISABLED);
bool checked = lv_obj_has_state(btn, LV_STATE_CHECKED);
```

## The properties you will actually use

```c
/* background */
lv_style_set_bg_color(&s, lv_color_hex(0x2563eb));
lv_style_set_bg_opa(&s, LV_OPA_COVER);            /* 0..255, or LV_OPA_TRANSP  */
lv_style_set_bg_grad_color(&s, lv_color_hex(0x0891b2));
lv_style_set_bg_grad_dir(&s, LV_GRAD_DIR_VER);

/* border and shape */
lv_style_set_border_width(&s, 1);
lv_style_set_border_color(&s, lv_color_hex(0xe4e4e7));
lv_style_set_border_side(&s, LV_BORDER_SIDE_BOTTOM);
lv_style_set_radius(&s, 12);                      /* LV_RADIUS_CIRCLE for pills */

/* shadow — cheap-looking depth, but it costs draw time */
lv_style_set_shadow_width(&s, 16);
lv_style_set_shadow_ofs_y(&s, 4);
lv_style_set_shadow_opa(&s, LV_OPA_20);

/* spacing */
lv_style_set_pad_all(&s, 12);
lv_style_set_pad_hor(&s, 16);

/* text */
lv_style_set_text_color(&s, lv_color_hex(0x18181b));
lv_style_set_text_font(&s, &lv_font_montserrat_20);
lv_style_set_text_align(&s, LV_TEXT_ALIGN_CENTER);

/* lines and arcs (chart, arc, meter) */
lv_style_set_line_width(&s, 2);
lv_style_set_arc_width(&s, 8);
```

## Inheritance

Some properties cascade to children — text color, text font, text alignment, opacity.
Most do not: background, border, and padding stay where you put them.

That gives you a clean trick for consistent typography:

```c
/* every label inside this screen becomes 16 px and dark grey */
lv_obj_set_style_text_font(scr, &lv_font_montserrat_16, 0);
lv_obj_set_style_text_color(scr, lv_color_hex(0x27272a), 0);
```

## Transitions

Style changes can animate between states, which turns a flat UI into a responsive-feeling
one for almost no code:

```c
static lv_style_t style_btn, style_btn_pressed;
static lv_style_transition_dsc_t trans;

/* which properties animate, and how */
static const lv_style_prop_t props[] = {
    LV_STYLE_BG_COLOR, LV_STYLE_TRANSFORM_WIDTH, LV_STYLE_PROP_INV
};

lv_style_transition_dsc_init(&trans, props, lv_anim_path_ease_out, 150, 0, NULL);

lv_style_init(&style_btn);
lv_style_set_bg_color(&style_btn, lv_color_hex(0x2563eb));
lv_style_set_transition(&style_btn, &trans);

lv_style_init(&style_btn_pressed);
lv_style_set_bg_color(&style_btn_pressed, lv_color_hex(0x1d4ed8));
lv_style_set_transform_width(&style_btn_pressed, -4);   /* squeeze in on press */

lv_obj_add_style(btn, &style_btn, 0);
lv_obj_add_style(btn, &style_btn_pressed, LV_STATE_PRESSED);
```

`LV_STYLE_PROP_INV` terminates the property array — same pattern as
`LV_GRID_TEMPLATE_LAST`.

## Themes

Before your styles are applied, LVGL's active theme has already styled everything. The
default theme is configured in `lv_conf.h`:

```c
#define LV_USE_THEME_DEFAULT 1
#define LV_THEME_DEFAULT_DARK 0        /* light UI */
#define LV_THEME_DEFAULT_GROW 1        /* widgets grow slightly when pressed */
```

You can also swap the palette at runtime:

```c
lv_theme_t * th = lv_theme_default_init(
        lv_disp_get_default(),
        lv_palette_main(LV_PALETTE_BLUE),        /* primary   */
        lv_palette_main(LV_PALETTE_CYAN),        /* secondary */
        false,                                   /* dark mode */
        &lv_font_montserrat_14);
lv_disp_set_theme(lv_disp_get_default(), th);
```

That single call is how you ship a light/dark toggle: rebuild the theme with `dark = true`
and every widget restyles itself.

## A small design system

This is the pattern I use on every project — one file, initialised once, then referenced
everywhere:

```c
/* ui_theme.c */
lv_style_t st_card, st_title, st_value, st_btn, st_btn_pr;

#define COL_BG      lv_color_hex(0xf4f4f5)
#define COL_SURFACE lv_color_hex(0xffffff)
#define COL_LINE    lv_color_hex(0xe4e4e7)
#define COL_TEXT    lv_color_hex(0x18181b)
#define COL_MUTED   lv_color_hex(0x71717a)
#define COL_BRAND   lv_color_hex(0x2563eb)

void ui_theme_init(void)
{
    lv_style_init(&st_card);
    lv_style_set_bg_color(&st_card, COL_SURFACE);
    lv_style_set_border_color(&st_card, COL_LINE);
    lv_style_set_border_width(&st_card, 1);
    lv_style_set_radius(&st_card, 12);
    lv_style_set_pad_all(&st_card, 12);

    lv_style_init(&st_title);
    lv_style_set_text_color(&st_title, COL_MUTED);
    lv_style_set_text_font(&st_title, &lv_font_montserrat_14);

    lv_style_init(&st_value);
    lv_style_set_text_color(&st_value, COL_TEXT);
    lv_style_set_text_font(&st_value, &lv_font_montserrat_28);

    lv_style_init(&st_btn);
    lv_style_set_bg_color(&st_btn, COL_BRAND);
    lv_style_set_text_color(&st_btn, lv_color_white());
    lv_style_set_radius(&st_btn, 8);
    lv_style_set_pad_hor(&st_btn, 16);
    lv_style_set_pad_ver(&st_btn, 10);

    lv_style_init(&st_btn_pr);
    lv_style_set_bg_color(&st_btn_pr, lv_color_hex(0x1d4ed8));
}
```

Usage stays one line per widget, and changing the brand colour is a one-line edit that
propagates through the entire product.

## Costs to keep in mind

- Every **font size** you enable is a full glyph bitmap set in flash. Two sizes is usually
  enough; three is a lot.
- **Shadows and gradients** are the most expensive things to draw on an MCU without a GPU.
  If your UI stutters while scrolling, remove shadows first and measure again.
- `lv_obj_add_style()` on an object that already has many styles costs a small allocation
  each time. Add styles at creation, not repeatedly at runtime.

## Next

The UI looks right. Lesson 6 makes it respond: the event system, callbacks, user data,
and how to handle input from touch, encoder and buttons with the same code.
