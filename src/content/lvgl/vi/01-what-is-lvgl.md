---
lesson: 1
lang: vi
title: "LVGL là gì và thực sự hoạt động thế nào?"
description: "Mô hình tư duy bạn cần có trước khi viết dòng code UI đầu tiên: LVGL làm gì, cố tình không làm gì, và hai callback nối nó với phần cứng của bạn."
duration: "12 phút"
tags: ["LVGL", "GUI nhúng", "Kiến trúc"]
---

## Vì sao có bài này

Đa số mọi người đến với LVGL bằng cách copy một ví dụ, thấy cái nút hiện lên, rồi tắc
hoàn toàn ngay khi có gì đó chạy không như mong đợi. Lý do: LVGL **không phải** thư viện
"vẽ lên màn hình" — nó là một **GUI toolkit kiểu retained-mode**. Chưa có mô hình đó trong
đầu thì mọi lỗi đều trông như phép thuật.

Bài này đưa cho bạn mô hình đó. Chưa cài đặt gì, chưa toolchain. Chỉ bức tranh tổng thể.

## LVGL là gì

LVGL (Light and Versatile Graphics Library) là thư viện C giấy phép MIT, cho bạn:

- **Widget** — nút, nhãn, slider, đồ thị, bàn phím, bảng… khoảng 30 loại.
- **Hệ thống style** — màu, padding, viền, đổ bóng, font; theo từng trạng thái và bộ phận.
- **Bộ bố cục** — Flexbox và Grid, đúng khái niệm bạn đã biết ở CSS.
- **Sự kiện, timer, animation** — phần tương tác của giao diện.
- **Bộ vẽ (renderer)** — biến tất cả những thứ trên thành pixel trong một vùng RAM.

Cấu hình tối thiểu chạy được khoảng **64 kB flash và 16 kB RAM** — đó là lý do bạn thấy nó
chạy cả trên STM32F1 lẫn trên máy tính nhúng Linux.

![Kiến trúc LVGL](/MyPortfolio/images/lvgl/architecture.svg)

## LVGL *không* làm gì

Đây là nửa mà mọi người hay bỏ qua, và nó gây ra phần lớn bối rối lúc đầu:

- **Không nói chuyện trực tiếp với màn hình.** LVGL không hề ghi một byte SPI nào. Nó đổ
  đầy một vùng RAM rồi gọi *hàm của bạn* để đẩy pixel ra.
- **Không đọc cảm ứng.** Nó gọi *hàm của bạn* và hỏi: "có đang được nhấn không, ở đâu?"
- **Không biết bây giờ là mấy giờ.** Bạn phải "bón" mili-giây cho nó.

Ba câu đó chính là toàn bộ lớp porting. Phần còn lại chỉ là code C bạn gọi từ ứng dụng.

## Retained mode — ý tưởng cốt lõi

Có hai kiểu thư viện GUI.

**Immediate mode** (như Dear ImGui): mỗi khung hình bạn mô tả lại toàn bộ giao diện.
"Vẽ nút ở đây. Nếu vừa được bấm thì làm việc kia." Không lưu gì giữa các khung hình.

**Retained mode** (LVGL): bạn *tạo đối tượng một lần*, nó sống trong RAM cho tới khi bạn
xoá. LVGL sở hữu nó, nhớ vị trí, style, trạng thái, và chỉ vẽ lại khi có gì đó thay đổi.

```c
/* Đoạn này chạy MỘT LẦN, không phải mỗi khung hình. */
lv_obj_t * btn = lv_btn_create(lv_scr_act());
lv_obj_set_size(btn, 120, 50);
lv_obj_center(btn);

lv_obj_t * label = lv_label_create(btn);
lv_label_set_text(label, "Start");
lv_obj_center(label);
```

Sau bảy dòng đó, cái nút tồn tại mãi. Vòng `main` **không** tạo lại nó. Điều này kéo theo
ba hệ quả giải thích gần hết các câu hỏi của người mới:

1. **Con trỏ `lv_obj_t *` sống lâu.** Hãy lưu lại nếu sau này cần cập nhật.
2. **Gọi hàm create trong vòng lặp là rò rỉ đối tượng** — và chúng chồng lên nhau trên
   màn hình.
3. **LVGL chỉ vẽ lại vùng "bẩn".** Đổi một nhãn thì chỉ hình chữ nhật đó được vẽ và đẩy
   lại. Đó là lý do LVGL vẫn mượt trên MCU 72 MHz.

## Vòng đời chạy

LVGL cần hai thứ từ bạn, liên tục:

![Vòng lặp chạy LVGL](/MyPortfolio/images/lvgl/runtime-loop.svg)

```c
int main(void)
{
    hal_init();              /* clock, SPI, reset LCD… của bạn   */

    lv_init();               /* 1. khởi động thư viện            */
    my_display_register();   /* 2. draw buffer + flush_cb        */
    my_touch_register();     /* 3. read_cb                       */

    create_my_ui();          /* 4. dựng widget — một lần         */

    while (1) {
        lv_timer_handler();  /* 5. để LVGL làm việc              */
        my_delay_ms(5);
    }
}
```

Và ở đâu đó trong ngắt 1 ms:

```c
void SysTick_Handler(void)
{
    lv_tick_inc(1);          /* giờ LVGL mới biết thời gian trôi */
}
```

`lv_timer_handler()` là nơi mọi thứ diễn ra: đọc thiết bị nhập, chạy animation, kích hoạt
timer đến hạn, tính lại bố cục, vẽ vùng bẩn và gọi `flush_cb` của bạn. Hãy gọi nó mỗi
khoảng 5 ms. Gọi quá thưa thì UI ì ạch; còn khi không có việc gì, hàm này trả về rất nhanh.

> **Lỗi porting phổ biến nhất:** quên `lv_tick_inc()`. Giao diện vẫn vẽ đúng nhưng không
> có animation nào chạy, không nút nào nhận long-press, timer không bao giờ nổ. Với LVGL,
> thời gian đã đứng yên theo đúng nghĩa đen.

## Hai callback, đầy đủ

**Đẩy khung hình (flush)** — LVGL đưa bạn một hình chữ nhật và vùng pixel. Bạn đẩy ra màn
hình rồi báo lại là đã xong:

```c
static void my_flush_cb(lv_disp_drv_t * drv, const lv_area_t * area, lv_color_t * px)
{
    /* area->x1, y1, x2, y2 là toạ độ pixel, BAO GỒM cả hai đầu */
    lcd_set_window(area->x1, area->y1, area->x2, area->y2);
    lcd_write_pixels((uint16_t *)px, lv_area_get_size(area));

    lv_disp_flush_ready(drv);   /* BẮT BUỘC gọi, nếu không LVGL treo mãi */
}
```

Nếu dùng DMA, hãy gọi `lv_disp_flush_ready()` trong ngắt báo DMA hoàn tất — đó chính là
mẹo để UI mượt trên bus SPI chậm.

**Đọc đầu vào** — LVGL hỏi, bạn trả lời:

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

Hãy để ý cái *không* có ở đây: không nhận diện cử chỉ, không logic "click", không xử lý ý
nghĩa của thao tác. Bạn chỉ báo toạ độ và trạng thái nhấn/nhả thô. LVGL tự biến nó thành
`LV_EVENT_CLICKED`, nhấn giữ, cuộn, kéo thả — cho mọi widget, miễn phí.

## LVGL 8 và LVGL 9

Bạn sẽ gặp hướng dẫn cho cả hai. Khái niệm trong series này giống hệt nhau; v9 chỉ đổi tên
một số API:

| Khái niệm | LVGL 8 | LVGL 9 |
| --- | --- | --- |
| Đối tượng hiển thị | `lv_disp_drv_t` + `lv_disp_drv_register()` | `lv_display_create()` |
| Khai báo buffer | `lv_disp_draw_buf_init()` | `lv_display_set_buffers()` |
| Widget nút | `lv_btn_create()` | `lv_button_create()` |
| Nguồn thời gian | `lv_tick_inc()` | `lv_tick_inc()` hoặc tick callback |

Series này dùng **tên API của LVGL 8.3**, vì đa số BSP của hãng vẫn kèm bản này, và việc
chuyển sang v9 chỉ là thay tên máy móc. Chỗ nào v9 khác về bản chất, tôi sẽ nói rõ.

## Tự kiểm tra

Trước khi sang bài sau, hãy trả lời được mà không cần kéo lên:

1. Ai là người ghi pixel ra LCD — LVGL hay bạn?
2. Chuyện gì xảy ra nếu gọi `lv_label_create()` bên trong vòng `while(1)`?
3. Vì sao giao diện đứng hình nếu không bao giờ gọi `lv_disp_flush_ready()`?
4. Thiếu `lv_tick_inc()` thì hỏng những gì?

## Bài tiếp theo

Bài 2 sẽ cho LVGL chạy thật — trên PC trong khoảng mười phút, rồi trên phần cứng thật, với
một `flush_cb` hoàn chỉnh bạn có thể copy về dùng.
