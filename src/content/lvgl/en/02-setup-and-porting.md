---
lesson: 2
lang: en
title: "Getting LVGL Running — Simulator First, Then Hardware"
description: "A working PC simulator in ten minutes, then a complete ESP32 and STM32 porting layer: draw buffers, flush_cb, tick source, and the config flags that matter."
duration: "18 min"
tags: ["LVGL", "ESP-IDF", "STM32", "Porting"]
---

## Start on your PC. Seriously.

Learning LVGL and bringing up an LCD driver at the same time is the classic way to give
up. Split the problems: learn the API where a build takes two seconds and you have a
debugger, then port to hardware once you know what correct looks like.

![Three ways to start](/MyPortfolio/images/lvgl/setup-paths.svg)

## Path A — PC simulator (SDL2)

```bash
git clone --recursive https://github.com/lvgl/lv_port_pc_vscode.git
cd lv_port_pc_vscode

# Ubuntu / WSL
sudo apt install build-essential cmake libsdl2-dev

cmake -B build -S .
cmake --build build -j
./build/bin/main
```

On Windows, the same repo works through MSYS2/MinGW, or use WSL2 with an X server. A
window appears with the LVGL demo. Now open `main/main.c`, delete the demo call, and put
your own UI function there:

```c
/* main/main.c */
#include "lvgl/lvgl.h"

void my_ui(void)
{
    lv_obj_t * label = lv_label_create(lv_scr_act());
    lv_label_set_text(label, "Hello from the simulator");
    lv_obj_center(label);
}
```

Everything in lessons 3–8 runs here unchanged.

## The porting layer, conceptually

Whatever the hardware, you always provide exactly four things:

| # | What | Function |
| --- | --- | --- |
| 1 | Memory to draw into | `lv_disp_draw_buf_init()` |
| 2 | A way to push pixels out | `flush_cb` |
| 3 | A way to read input | `read_cb` |
| 4 | A millisecond time source | `lv_tick_inc()` |

### 1. Sizing the draw buffer

![Draw buffer strategies](/MyPortfolio/images/lvgl/draw-buffers.svg)

The rule of thumb: **1/10 of the screen is the minimum, larger is smoother.**

```c
#define HRES 320
#define VRES 240

/* 1/10 screen, 16-bit color => 320 * 24 * 2 = 15,360 bytes per buffer */
static lv_color_t buf1[HRES * VRES / 10];
static lv_color_t buf2[HRES * VRES / 10];   /* second buffer: draw while DMA flushes */

static lv_disp_draw_buf_t draw_buf;
lv_disp_draw_buf_init(&draw_buf, buf1, buf2, HRES * VRES / 10);
```

Two small buffers plus DMA is the sweet spot for most SPI displays: the CPU renders the
next stripe while the previous one is still going out on the wire.

### 2. Registering the display

```c
static lv_disp_drv_t disp_drv;

lv_disp_drv_init(&disp_drv);
disp_drv.hor_res   = HRES;
disp_drv.ver_res   = VRES;
disp_drv.draw_buf  = &draw_buf;
disp_drv.flush_cb  = my_flush_cb;
lv_disp_drv_register(&disp_drv);
```

## Path B — ESP32 with ESP-IDF

LVGL is an official IDF component, so there is no vendoring:

```bash
idf.py add-dependency "lvgl/lvgl^8.3.0"
idf.py add-dependency "espressif/esp_lvgl_port^2.0.0"   # optional but convenient
```

A complete, working flush callback on top of `esp_lcd` (ST7789 over SPI):

```c
#include "esp_lcd_panel_ops.h"

static esp_lcd_panel_handle_t panel;      /* set up by esp_lcd_new_panel_st7789() */
static lv_disp_drv_t disp_drv;

/* Called by esp_lcd when the DMA transfer finished */
static bool notify_flush_ready(esp_lcd_panel_io_handle_t io,
                               esp_lcd_panel_io_event_data_t *ed, void *user_ctx)
{
    lv_disp_flush_ready((lv_disp_drv_t *)user_ctx);
    return false;
}

static void esp_flush_cb(lv_disp_drv_t *drv, const lv_area_t *area, lv_color_t *px)
{
    /* esp_lcd wants an EXCLUSIVE end coordinate, LVGL gives an inclusive one */
    esp_lcd_panel_draw_bitmap(panel, area->x1, area->y1,
                              area->x2 + 1, area->y2 + 1, px);
    /* NO lv_disp_flush_ready() here — notify_flush_ready() does it */
}
```

That `+1` is the single most common ESP32 porting bug: forget it and you get a one-pixel
column of garbage down the right edge of every redraw.

Allocate the buffers in DMA-capable memory:

```c
lv_color_t *buf1 = heap_caps_malloc(HRES * 40 * sizeof(lv_color_t), MALLOC_CAP_DMA);
lv_color_t *buf2 = heap_caps_malloc(HRES * 40 * sizeof(lv_color_t), MALLOC_CAP_DMA);
```

And the tick, from an IDF timer:

```c
static void tick_cb(void *arg) { lv_tick_inc(2); }

const esp_timer_create_args_t targs = { .callback = tick_cb, .name = "lv_tick" };
esp_timer_handle_t th;
esp_timer_create(&targs, &th);
esp_timer_start_periodic(th, 2 * 1000);   /* 2 ms */
```

If you run LVGL from a FreeRTOS task, remember that **LVGL is not thread-safe**. Either
touch LVGL only from that one task, or wrap every call in a mutex:

```c
void lvgl_task(void *arg)
{
    while (1) {
        if (xSemaphoreTake(lvgl_mux, portMAX_DELAY) == pdTRUE) {
            uint32_t next = lv_timer_handler();
            xSemaphoreGive(lvgl_mux);
            vTaskDelay(pdMS_TO_TICKS(next < 5 ? 5 : (next > 50 ? 50 : next)));
        }
    }
}
```

## Path C — STM32 with CubeMX + HAL

Copy the LVGL source into `Middlewares/`, add `lvgl/src` to your include paths, and add
`lv_conf.h` next to the `lvgl` folder.

Tick, in `stm32f4xx_it.c`:

```c
void SysTick_Handler(void)
{
    HAL_IncTick();
    lv_tick_inc(1);
}
```

Flush over SPI + DMA:

```c
static lv_disp_drv_t *flushing_drv;

static void stm32_flush_cb(lv_disp_drv_t *drv, const lv_area_t *area, lv_color_t *px)
{
    flushing_drv = drv;

    ili9341_set_window(area->x1, area->y1, area->x2, area->y2);
    LCD_DC_DATA();
    LCD_CS_LOW();

    uint32_t len = lv_area_get_size(area) * 2;     /* RGB565 => 2 bytes/px */
    HAL_SPI_Transmit_DMA(&hspi1, (uint8_t *)px, len);
}

void HAL_SPI_TxCpltCallback(SPI_HandleTypeDef *hspi)
{
    LCD_CS_HIGH();
    lv_disp_flush_ready(flushing_drv);
}
```

> On F4/F7/H7, `HAL_SPI_Transmit_DMA` takes a 16-bit length. A full-width stripe of a
> 480-px display in RGB565 is 960 bytes per line — fine — but a whole 320×240 frame is
> 153,600 bytes and will silently truncate. Another argument for small buffers.

If your part has **DMA2D** (Chrom-ART), enable it and LVGL will use it for fills and
blends:

```c
#define LV_USE_GPU_STM32_DMA2D  1
#define LV_GPU_DMA2D_CMSIS_INCLUDE "stm32f4xx.h"
```

## lv_conf.h — the flags that actually matter

Copy `lv_conf_template.h` to `lv_conf.h`, set the first `#if 0` to `#if 1`, then:

```c
#define LV_COLOR_DEPTH        16      /* 16 for almost every MCU LCD          */
#define LV_COLOR_16_SWAP      1       /* set to 1 if red and blue are swapped */

#define LV_MEM_CUSTOM         0
#define LV_MEM_SIZE      (48U * 1024U) /* LVGL's own heap for widgets         */

#define LV_DISP_DEF_REFR_PERIOD  30   /* ms between redraws                   */
#define LV_INDEV_DEF_READ_PERIOD 30

#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_28 1       /* enable ONLY the sizes you use        */

#define LV_USE_LOG            1
#define LV_LOG_LEVEL          LV_LOG_LEVEL_WARN
#define LV_USE_ASSERT_MALLOC  1       /* catches "out of LV_MEM_SIZE" early   */
```

Two of these cause 90% of "it looks wrong" reports:

- **Colors inverted or psychedelic** → toggle `LV_COLOR_16_SWAP`.
- **Widgets stop appearing after a while** → `LV_MEM_SIZE` is too small. Each font size
  and each widget costs RAM; turn on `LV_USE_ASSERT_MALLOC` and you get a clear failure
  instead of a blank screen.

## Bring-up checklist

Work through this in order. Each step isolates one failure:

1. **Fill the screen red with your own driver code**, no LVGL. Proves SPI, reset, and
   window commands.
2. **`lv_init()` + a solid-color screen.** Proves buffer and `flush_cb`.
3. **A centered label.** Proves fonts and `LV_MEM_SIZE`.
4. **`lv_timer_handler()` in the loop + a blinking `lv_led`.** Proves the tick.
5. **A button with an event callback.** Proves the input driver.

If step 4 fails but 3 works, your tick is missing. If 5 fails but 4 works, look at
`read_cb` and your touch calibration — not at LVGL.

## Next

You have pixels. Lesson 3 builds the first real screen: objects, parents, labels, buttons,
and the handful of functions you will use in every project after this.
