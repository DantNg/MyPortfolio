---
lesson: 2
lang: vi
title: "Cho LVGL chạy — simulator trước, phần cứng sau"
description: "Chạy simulator trên PC trong mười phút, rồi lớp porting hoàn chỉnh cho ESP32 và STM32: draw buffer, flush_cb, nguồn tick và các cờ cấu hình thực sự quan trọng."
duration: "18 phút"
tags: ["LVGL", "ESP-IDF", "STM32", "Porting"]
---

## Hãy bắt đầu trên PC. Nghiêm túc đấy.

Vừa học LVGL vừa bring-up driver LCD là con đường kinh điển dẫn tới bỏ cuộc. Hãy tách hai
vấn đề: học API ở nơi build mất hai giây và có debugger đàng hoàng, rồi mới port sang phần
cứng khi đã biết "chạy đúng" trông như thế nào.

![Ba cách bắt đầu](/MyPortfolio/images/lvgl/setup-paths.svg)

## Cách A — Simulator trên PC (SDL2)

```bash
git clone --recursive https://github.com/lvgl/lv_port_pc_vscode.git
cd lv_port_pc_vscode

# Ubuntu / WSL
sudo apt install build-essential cmake libsdl2-dev

cmake -B build -S .
cmake --build build -j
./build/bin/main
```

Trên Windows, repo này chạy được qua MSYS2/MinGW, hoặc dùng WSL2 kèm X server. Một cửa sổ
demo LVGL sẽ hiện ra. Giờ mở `main/main.c`, xoá lời gọi demo và đặt hàm UI của bạn vào:

```c
/* main/main.c */
#include "lvgl/lvgl.h"

void my_ui(void)
{
    lv_obj_t * label = lv_label_create(lv_scr_act());
    lv_label_set_text(label, "Xin chao tu simulator");
    lv_obj_center(label);
}
```

Toàn bộ code ở bài 3–8 chạy nguyên si ở đây.

## Lớp porting, về mặt khái niệm

Dù phần cứng là gì, bạn luôn phải cung cấp đúng bốn thứ:

| # | Thứ cần cung cấp | Hàm |
| --- | --- | --- |
| 1 | Bộ nhớ để vẽ vào | `lv_disp_draw_buf_init()` |
| 2 | Cách đẩy pixel ra màn hình | `flush_cb` |
| 3 | Cách đọc đầu vào | `read_cb` |
| 4 | Nguồn thời gian mili-giây | `lv_tick_inc()` |

### 1. Chọn kích thước draw buffer

![Các chiến lược draw buffer](/MyPortfolio/images/lvgl/draw-buffers.svg)

Quy tắc ngón tay cái: **tối thiểu 1/10 màn hình, càng lớn càng mượt.**

```c
#define HRES 320
#define VRES 240

/* 1/10 màn hình, màu 16-bit => 320 * 24 * 2 = 15.360 byte mỗi buffer */
static lv_color_t buf1[HRES * VRES / 10];
static lv_color_t buf2[HRES * VRES / 10];   /* buffer 2: vẽ trong khi DMA đang đẩy */

static lv_disp_draw_buf_t draw_buf;
lv_disp_draw_buf_init(&draw_buf, buf1, buf2, HRES * VRES / 10);
```

Hai buffer nhỏ cộng DMA là điểm cân bằng tốt nhất cho hầu hết màn SPI: CPU vẽ dải tiếp
theo trong khi dải trước còn đang chạy trên đường truyền.

### 2. Đăng ký display

```c
static lv_disp_drv_t disp_drv;

lv_disp_drv_init(&disp_drv);
disp_drv.hor_res   = HRES;
disp_drv.ver_res   = VRES;
disp_drv.draw_buf  = &draw_buf;
disp_drv.flush_cb  = my_flush_cb;
lv_disp_drv_register(&disp_drv);
```

## Cách B — ESP32 với ESP-IDF

LVGL là component chính thức của IDF nên không cần chép source thủ công:

```bash
idf.py add-dependency "lvgl/lvgl^8.3.0"
idf.py add-dependency "espressif/esp_lvgl_port^2.0.0"   # tuỳ chọn, tiện
```

Một flush callback hoàn chỉnh dựa trên `esp_lcd` (ST7789 qua SPI):

```c
#include "esp_lcd_panel_ops.h"

static esp_lcd_panel_handle_t panel;      /* tạo bởi esp_lcd_new_panel_st7789() */
static lv_disp_drv_t disp_drv;

/* esp_lcd gọi khi DMA truyền xong */
static bool notify_flush_ready(esp_lcd_panel_io_handle_t io,
                               esp_lcd_panel_io_event_data_t *ed, void *user_ctx)
{
    lv_disp_flush_ready((lv_disp_drv_t *)user_ctx);
    return false;
}

static void esp_flush_cb(lv_disp_drv_t *drv, const lv_area_t *area, lv_color_t *px)
{
    /* esp_lcd cần toạ độ cuối KHÔNG bao gồm, LVGL đưa toạ độ BAO GỒM */
    esp_lcd_panel_draw_bitmap(panel, area->x1, area->y1,
                              area->x2 + 1, area->y2 + 1, px);
    /* KHÔNG gọi lv_disp_flush_ready() ở đây — notify_flush_ready() lo rồi */
}
```

Dấu `+1` đó là lỗi porting ESP32 phổ biến nhất: quên nó thì mỗi lần vẽ lại bạn sẽ thấy một
cột rác rộng một pixel ở mép phải.

Cấp phát buffer trong vùng nhớ DMA được:

```c
lv_color_t *buf1 = heap_caps_malloc(HRES * 40 * sizeof(lv_color_t), MALLOC_CAP_DMA);
lv_color_t *buf2 = heap_caps_malloc(HRES * 40 * sizeof(lv_color_t), MALLOC_CAP_DMA);
```

Và nguồn tick, dùng timer của IDF:

```c
static void tick_cb(void *arg) { lv_tick_inc(2); }

const esp_timer_create_args_t targs = { .callback = tick_cb, .name = "lv_tick" };
esp_timer_handle_t th;
esp_timer_create(&targs, &th);
esp_timer_start_periodic(th, 2 * 1000);   /* 2 ms */
```

Nếu chạy LVGL trong task FreeRTOS, nhớ rằng **LVGL không thread-safe**. Hoặc chỉ đụng vào
LVGL từ đúng một task, hoặc bọc mọi lời gọi bằng mutex:

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

## Cách C — STM32 với CubeMX + HAL

Chép source LVGL vào `Middlewares/`, thêm `lvgl/src` vào include path, và đặt `lv_conf.h`
ngang cấp với thư mục `lvgl`.

Tick, trong `stm32f4xx_it.c`:

```c
void SysTick_Handler(void)
{
    HAL_IncTick();
    lv_tick_inc(1);
}
```

Flush qua SPI + DMA:

```c
static lv_disp_drv_t *flushing_drv;

static void stm32_flush_cb(lv_disp_drv_t *drv, const lv_area_t *area, lv_color_t *px)
{
    flushing_drv = drv;

    ili9341_set_window(area->x1, area->y1, area->x2, area->y2);
    LCD_DC_DATA();
    LCD_CS_LOW();

    uint32_t len = lv_area_get_size(area) * 2;     /* RGB565 => 2 byte/pixel */
    HAL_SPI_Transmit_DMA(&hspi1, (uint8_t *)px, len);
}

void HAL_SPI_TxCpltCallback(SPI_HandleTypeDef *hspi)
{
    LCD_CS_HIGH();
    lv_disp_flush_ready(flushing_drv);
}
```

> Trên F4/F7/H7, `HAL_SPI_Transmit_DMA` nhận độ dài 16-bit. Một dải ngang đầy đủ của màn
> 480 px ở RGB565 là 960 byte mỗi dòng — không sao — nhưng cả khung 320×240 là 153.600 byte
> và sẽ bị cắt cụt trong im lặng. Thêm một lý do để dùng buffer nhỏ.

Nếu chip của bạn có **DMA2D** (Chrom-ART), bật lên và LVGL sẽ dùng nó để tô và trộn màu:

```c
#define LV_USE_GPU_STM32_DMA2D  1
#define LV_GPU_DMA2D_CMSIS_INCLUDE "stm32f4xx.h"
```

## lv_conf.h — những cờ thật sự quan trọng

Chép `lv_conf_template.h` thành `lv_conf.h`, đổi `#if 0` đầu file thành `#if 1`, rồi:

```c
#define LV_COLOR_DEPTH        16      /* 16 cho gần như mọi LCD của MCU        */
#define LV_COLOR_16_SWAP      1       /* để 1 nếu đỏ và xanh dương bị hoán đổi */

#define LV_MEM_CUSTOM         0
#define LV_MEM_SIZE      (48U * 1024U) /* heap riêng của LVGL cho widget       */

#define LV_DISP_DEF_REFR_PERIOD  30   /* ms giữa hai lần vẽ lại                */
#define LV_INDEV_DEF_READ_PERIOD 30

#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_28 1       /* CHỈ bật cỡ font bạn thực sự dùng      */

#define LV_USE_LOG            1
#define LV_LOG_LEVEL          LV_LOG_LEVEL_WARN
#define LV_USE_ASSERT_MALLOC  1       /* báo sớm khi hết LV_MEM_SIZE           */
```

Hai cờ dưới đây gây ra 90% các báo cáo kiểu "nhìn sai sai":

- **Màu bị đảo hoặc loè loẹt** → đổi `LV_COLOR_16_SWAP`.
- **Chạy một lúc thì widget không hiện nữa** → `LV_MEM_SIZE` quá nhỏ. Mỗi cỡ font và mỗi
  widget đều tốn RAM; bật `LV_USE_ASSERT_MALLOC` để nhận lỗi rõ ràng thay vì màn hình trắng.

## Danh sách kiểm tra khi bring-up

Làm đúng thứ tự này, mỗi bước cô lập một loại lỗi:

1. **Tô đỏ cả màn hình bằng code driver của bạn**, chưa có LVGL. Chứng minh SPI, reset và
   lệnh set window đều đúng.
2. **`lv_init()` + một màn hình đơn sắc.** Chứng minh buffer và `flush_cb` đúng.
3. **Một nhãn ở giữa màn hình.** Chứng minh font và `LV_MEM_SIZE` đủ.
4. **`lv_timer_handler()` trong vòng lặp + một `lv_led` nhấp nháy.** Chứng minh tick chạy.
5. **Một nút có event callback.** Chứng minh driver đầu vào chạy.

Nếu bước 4 hỏng mà bước 3 chạy → thiếu tick. Nếu bước 5 hỏng mà bước 4 chạy → hãy soi
`read_cb` và hiệu chuẩn cảm ứng, đừng đổ tại LVGL.

## Bài tiếp theo

Bạn đã có pixel. Bài 3 dựng màn hình thật đầu tiên: object, quan hệ cha–con, label, button
và nhóm hàm bạn sẽ dùng lại trong mọi dự án về sau.
