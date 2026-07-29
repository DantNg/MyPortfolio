---
lesson: 4
lang: en
title: "Layouts — Align, Flex, and Grid"
description: "Stop hard-coding pixel coordinates. Size units, alignment, Flexbox and Grid in LVGL, plus a responsive dashboard that survives a change of screen resolution."
duration: "16 min"
tags: ["LVGL", "Flexbox", "Grid", "Layout"]
---

## The problem with pixels

This works:

```c
lv_obj_set_pos(card1, 10, 10);
lv_obj_set_pos(card2, 120, 10);
lv_obj_set_pos(card3, 230, 10);
```

…until the customer asks for a 480×320 panel instead of 320×240, or you insert a card in
the middle, or the text is longer in Vietnamese than in English. Then you re-derive every
number by hand.

LVGL gives you three tools to avoid that, in increasing order of power.

![Layout tools](/MyPortfolio/images/lvgl/layout-flex-grid.svg)

## Size units

Before layouts, get sizes right:

```c
lv_obj_set_width(obj, 120);              /* 120 physical pixels             */
lv_obj_set_width(obj, lv_pct(50));       /* 50% of the parent content width */
lv_obj_set_width(obj, LV_SIZE_CONTENT);  /* exactly as wide as its content  */

lv_obj_set_size(obj, lv_pct(100), 60);   /* full width, fixed height        */
```

`LV_SIZE_CONTENT` is what makes a button hug its label, and `lv_pct()` is what makes a
layout survive a resolution change. Use them by default; use raw pixels for things that
genuinely are physical, like a 44 px minimum touch target.

## 1. Align — for one object relative to another

```c
lv_obj_align(obj, LV_ALIGN_CENTER, 0, 0);            /* inside the parent */
lv_obj_align(obj, LV_ALIGN_TOP_RIGHT, -10, 10);      /* with an offset    */

/* relative to a sibling, not the parent */
lv_obj_align_to(icon, label, LV_ALIGN_OUT_LEFT_MID, -8, 0);
```

The nine `LV_ALIGN_*` positions cover corners, edge centers, and the center.
`LV_ALIGN_OUT_*` variants place the object *outside* the reference, which is how you build
"icon next to text" without measuring the text.

## 2. Flex — rows and columns that manage themselves

Turn a container into a flex container and its children arrange themselves:

```c
lv_obj_t * row = lv_obj_create(lv_scr_act());
lv_obj_set_size(row, lv_pct(100), LV_SIZE_CONTENT);

lv_obj_set_layout(row, LV_LAYOUT_FLEX);
lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
lv_obj_set_flex_align(row,
        LV_FLEX_ALIGN_SPACE_EVENLY,   /* main axis: along the row      */
        LV_FLEX_ALIGN_CENTER,         /* cross axis: vertical here     */
        LV_FLEX_ALIGN_CENTER);        /* between wrapped tracks        */

/* just create children — no coordinates at all */
for (int i = 0; i < 3; i++) {
    lv_obj_t * btn = lv_btn_create(row);
    lv_obj_set_size(btn, 80, 44);
    lv_obj_t * l = lv_label_create(btn);
    lv_label_set_text_fmt(l, "CH%d", i + 1);
    lv_obj_center(l);
}
```

The flows:

| Flow | Effect |
| --- | --- |
| `LV_FLEX_FLOW_ROW` | left to right |
| `LV_FLEX_FLOW_COLUMN` | top to bottom |
| `LV_FLEX_FLOW_ROW_WRAP` | wraps to a new line when full |
| `LV_FLEX_FLOW_COLUMN_REVERSE` | bottom to top |

And the alignments: `START`, `END`, `CENTER`, `SPACE_EVENLY`, `SPACE_AROUND`,
`SPACE_BETWEEN` — identical semantics to CSS flexbox.

### Grow

A child can take the leftover space:

```c
lv_obj_set_flex_grow(main_area, 1);   /* eats all remaining height */
```

This is how you build the classic app frame — fixed header, fixed footer, elastic body:

```c
lv_obj_t * scr = lv_scr_act();
lv_obj_set_layout(scr, LV_LAYOUT_FLEX);
lv_obj_set_flex_flow(scr, LV_FLEX_FLOW_COLUMN);
lv_obj_set_style_pad_all(scr, 0, 0);
lv_obj_set_style_pad_row(scr, 0, 0);

lv_obj_t * header = lv_obj_create(scr);
lv_obj_set_size(header, lv_pct(100), 40);

lv_obj_t * body = lv_obj_create(scr);
lv_obj_set_width(body, lv_pct(100));
lv_obj_set_flex_grow(body, 1);          /* <- the elastic part */

lv_obj_t * footer = lv_obj_create(scr);
lv_obj_set_size(footer, lv_pct(100), 48);
```

Change the screen from 240 px tall to 320 px tall and this still looks right. That is the
entire point.

## 3. Grid — two-dimensional layouts

When rows *and* columns must line up, use Grid. You describe the tracks once:

```c
/* LV_GRID_TEMPLATE_LAST terminates the arrays — do not forget it */
static lv_coord_t cols[] = {LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_TEMPLATE_LAST};
static lv_coord_t rows[] = {60, LV_GRID_FR(1), 40, LV_GRID_TEMPLATE_LAST};

lv_obj_t * grid = lv_obj_create(lv_scr_act());
lv_obj_set_size(grid, lv_pct(100), lv_pct(100));
lv_obj_set_grid_dsc_array(grid, cols, rows);
lv_obj_set_layout(grid, LV_LAYOUT_GRID);
```

`LV_GRID_FR(n)` is a fraction of the free space — `FR(1)` and `FR(1)` split it evenly,
`FR(2)` and `FR(1)` gives a 2:1 ratio. Fixed numbers are pixels.

Then place children by cell:

```c
lv_obj_t * a = lv_obj_create(grid);
lv_obj_set_grid_cell(a,
        LV_GRID_ALIGN_STRETCH, 0, 1,    /* column: align, start, span */
        LV_GRID_ALIGN_STRETCH, 0, 1);   /* row:    align, start, span */

lv_obj_t * wide = lv_obj_create(grid);
lv_obj_set_grid_cell(wide,
        LV_GRID_ALIGN_STRETCH, 0, 2,    /* spans both columns */
        LV_GRID_ALIGN_STRETCH, 2, 1);
```

## Padding and gaps

Layouts respect the container's padding and the gap style properties:

```c
lv_obj_set_style_pad_all(cont, 12, 0);     /* inner margin on all sides */
lv_obj_set_style_pad_row(cont, 8, 0);      /* vertical gap between items */
lv_obj_set_style_pad_column(cont, 8, 0);   /* horizontal gap             */
```

If your flex items are glued together, it is almost always `pad_row`/`pad_column`, not the
items themselves.

## Worked example — a responsive 3-card dashboard

```c
void build_dashboard(void)
{
    lv_obj_t * scr = lv_scr_act();
    lv_obj_set_style_pad_all(scr, 8, 0);
    lv_obj_set_layout(scr, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(scr, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_row(scr, 8, 0);

    /* --- header --- */
    lv_obj_t * header = lv_obj_create(scr);
    lv_obj_set_size(header, lv_pct(100), LV_SIZE_CONTENT);
    lv_obj_set_style_pad_all(header, 10, 0);
    lv_obj_t * h = lv_label_create(header);
    lv_label_set_text(h, LV_SYMBOL_HOME "  Sensor Dashboard");

    /* --- a row of cards that wraps on narrow screens --- */
    lv_obj_t * row = lv_obj_create(scr);
    lv_obj_set_width(row, lv_pct(100));
    lv_obj_set_height(row, LV_SIZE_CONTENT);
    lv_obj_set_layout(row, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW_WRAP);
    lv_obj_set_flex_align(row, LV_FLEX_ALIGN_SPACE_BETWEEN,
                               LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_set_style_pad_column(row, 8, 0);

    const char * names[]  = {"TEMP", "HUMIDITY", "PRESSURE"};
    const char * values[] = {"27.4 C", "61 %", "1008 hPa"};

    for (int i = 0; i < 3; i++) {
        lv_obj_t * card = lv_obj_create(row);
        lv_obj_set_size(card, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
        lv_obj_set_flex_grow(card, 1);          /* share the width equally */
        lv_obj_set_layout(card, LV_LAYOUT_FLEX);
        lv_obj_set_flex_flow(card, LV_FLEX_FLOW_COLUMN);

        lv_obj_t * name = lv_label_create(card);
        lv_label_set_text(name, names[i]);

        lv_obj_t * val = lv_label_create(card);
        lv_label_set_text(val, values[i]);
        lv_obj_set_style_text_font(val, &lv_font_montserrat_28, 0);
    }
}
```

Not one hard-coded coordinate. Run it in the simulator, change the window size in
`lv_conf.h` or the simulator's settings, and the layout adapts.

## Debugging layouts

- Nothing appears → the parent has `LV_SIZE_CONTENT` height and no children with a fixed
  size yet, so it collapsed to zero. Give the parent a real height first.
- Items overlap → you mixed `lv_obj_align()` with a layout. A layout *owns* its children's
  positions; alignment calls on them are ignored or fight the layout.
- Layout looks stale after changing sizes at runtime → call
  `lv_obj_update_layout(cont)` to force an immediate recalculation instead of waiting for
  the next `lv_timer_handler()`.

## Next

The dashboard works but looks like a default. Lesson 5 is styles: colors, borders,
shadows, fonts, states, and reusable style objects that keep the RAM cost near zero.
