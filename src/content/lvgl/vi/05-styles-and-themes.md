---
lesson: 5
lang: vi
title: "Style, Part và State"
description: "Cách style của LVGL thực sự vận hành: style cục bộ và style dùng chung, ma trận part × state, tính kế thừa, transition, và cách dựng một design system nhỏ."
duration: "16 phút"
tags: ["LVGL", "Style", "Theme"]
---

## Hai cách đặt style, và khi nào dùng cách nào

**Style cục bộ** — áp cho một đối tượng, lưu ngay bên trong nó:

```c
lv_obj_set_style_bg_color(btn, lv_color_hex(0x2563eb), 0);
lv_obj_set_style_radius(btn, 8, 0);
```

Viết nhanh, nhưng mỗi thuộc tính tốn vài byte *trên từng đối tượng*. Hợp cho thứ chỉ dùng
một lần.

**Đối tượng style** — một `lv_style_t` dùng chung cho nhiều đối tượng:

```c
static lv_style_t style_card;                       /* bắt buộc static/global! */

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
lv_obj_add_style(card2, &style_card, 0);   /* cùng vùng nhớ, không tốn thêm */
```

> Biến style **phải sống lâu hơn mọi đối tượng dùng nó**. Khai báo style là biến cục bộ
> trong hàm là lỗi crash kinh điển: LVGL giữ con trỏ, stack frame biến mất, và bạn nhận
> được hình vẽ hỏng hoặc hard fault. `static` hoặc global. Luôn luôn.

Quy tắc: từ ba đối tượng trở lên dùng chung một diện mạo → hãy tách thành style object.

## Part và State

Tham số thứ ba của mọi hàm style là một *selector*: `part | state`.

![Part và state](/MyPortfolio/images/lvgl/style-parts-states.svg)

**Part** là các bộ phận cấu thành widget:

| Part | Xuất hiện ở đâu |
| --- | --- |
| `LV_PART_MAIN` | nền của mọi widget |
| `LV_PART_INDICATOR` | phần đã điền của slider/bar, dấu tick, giá trị arc |
| `LV_PART_KNOB` | núm kéo của slider và arc |
| `LV_PART_SCROLLBAR` | container cuộn được |
| `LV_PART_ITEMS` | ô của table, series của chart, mục của list |
| `LV_PART_SELECTED` | mục đang chọn của dropdown/roller |

**State** là trạng thái hiện tại của đối tượng:

`LV_STATE_DEFAULT`, `PRESSED`, `CHECKED`, `DISABLED`, `FOCUSED`, `FOCUS_KEY`, `EDITED`,
`HOVERED`, `SCROLLED`.

Ghép chúng bằng `|`:

```c
/* phần đã điền của slider, trạng thái thường */
lv_obj_set_style_bg_color(sl, lv_color_hex(0x2563eb), LV_PART_INDICATOR);

/* cái núm, khi đang bị kéo */
lv_obj_set_style_bg_color(sl, lv_color_hex(0x1d4ed8), LV_PART_KNOB | LV_STATE_PRESSED);

/* cả widget, khi bị vô hiệu hoá */
lv_obj_set_style_bg_opa(sl, LV_OPA_40, LV_PART_MAIN | LV_STATE_DISABLED);
```

Truyền `0` làm selector nghĩa là `LV_PART_MAIN | LV_STATE_DEFAULT` — đó là lý do bạn thấy
rất nhiều lời gọi kết thúc bằng `, 0)`.

LVGL tự đặt state khi có thao tác chạm, nhưng bạn cũng có thể ép:

```c
lv_obj_add_state(btn, LV_STATE_DISABLED);
lv_obj_clear_state(btn, LV_STATE_DISABLED);
bool checked = lv_obj_has_state(btn, LV_STATE_CHECKED);
```

## Những thuộc tính bạn sẽ dùng thật

```c
/* nền */
lv_style_set_bg_color(&s, lv_color_hex(0x2563eb));
lv_style_set_bg_opa(&s, LV_OPA_COVER);            /* 0..255, hoặc LV_OPA_TRANSP */
lv_style_set_bg_grad_color(&s, lv_color_hex(0x0891b2));
lv_style_set_bg_grad_dir(&s, LV_GRAD_DIR_VER);

/* viền và hình dạng */
lv_style_set_border_width(&s, 1);
lv_style_set_border_color(&s, lv_color_hex(0xe4e4e7));
lv_style_set_border_side(&s, LV_BORDER_SIDE_BOTTOM);
lv_style_set_radius(&s, 12);                      /* LV_RADIUS_CIRCLE cho viên thuốc */

/* đổ bóng — tạo chiều sâu, nhưng tốn thời gian vẽ */
lv_style_set_shadow_width(&s, 16);
lv_style_set_shadow_ofs_y(&s, 4);
lv_style_set_shadow_opa(&s, LV_OPA_20);

/* khoảng cách */
lv_style_set_pad_all(&s, 12);
lv_style_set_pad_hor(&s, 16);

/* chữ */
lv_style_set_text_color(&s, lv_color_hex(0x18181b));
lv_style_set_text_font(&s, &lv_font_montserrat_20);
lv_style_set_text_align(&s, LV_TEXT_ALIGN_CENTER);

/* đường và cung (chart, arc, meter) */
lv_style_set_line_width(&s, 2);
lv_style_set_arc_width(&s, 8);
```

## Tính kế thừa

Một số thuộc tính lan xuống con — màu chữ, font chữ, căn chữ, độ mờ. Phần lớn thì không:
nền, viền và padding nằm đúng chỗ bạn đặt.

Điều đó cho một mẹo gọn để thống nhất kiểu chữ:

```c
/* mọi label trong màn hình này thành 16 px, màu xám đậm */
lv_obj_set_style_text_font(scr, &lv_font_montserrat_16, 0);
lv_obj_set_style_text_color(scr, lv_color_hex(0x27272a), 0);
```

## Transition

Thay đổi style có thể chạy hiệu ứng giữa các trạng thái, biến giao diện phẳng thành giao
diện "có phản hồi" mà gần như không cần thêm code:

```c
static lv_style_t style_btn, style_btn_pressed;
static lv_style_transition_dsc_t trans;

/* thuộc tính nào chạy hiệu ứng, và chạy thế nào */
static const lv_style_prop_t props[] = {
    LV_STYLE_BG_COLOR, LV_STYLE_TRANSFORM_WIDTH, LV_STYLE_PROP_INV
};

lv_style_transition_dsc_init(&trans, props, lv_anim_path_ease_out, 150, 0, NULL);

lv_style_init(&style_btn);
lv_style_set_bg_color(&style_btn, lv_color_hex(0x2563eb));
lv_style_set_transition(&style_btn, &trans);

lv_style_init(&style_btn_pressed);
lv_style_set_bg_color(&style_btn_pressed, lv_color_hex(0x1d4ed8));
lv_style_set_transform_width(&style_btn_pressed, -4);   /* co lại khi nhấn */

lv_obj_add_style(btn, &style_btn, 0);
lv_obj_add_style(btn, &style_btn_pressed, LV_STATE_PRESSED);
```

`LV_STYLE_PROP_INV` kết thúc mảng thuộc tính — cùng kiểu với `LV_GRID_TEMPLATE_LAST`.

## Theme

Trước khi style của bạn được áp, theme đang hoạt động của LVGL đã style sẵn mọi thứ. Theme
mặc định được cấu hình trong `lv_conf.h`:

```c
#define LV_USE_THEME_DEFAULT 1
#define LV_THEME_DEFAULT_DARK 0        /* giao diện sáng */
#define LV_THEME_DEFAULT_GROW 1        /* widget hơi phình ra khi nhấn */
```

Bạn cũng có thể đổi bảng màu lúc chạy:

```c
lv_theme_t * th = lv_theme_default_init(
        lv_disp_get_default(),
        lv_palette_main(LV_PALETTE_BLUE),        /* màu chính */
        lv_palette_main(LV_PALETTE_CYAN),        /* màu phụ   */
        false,                                   /* chế độ tối */
        &lv_font_montserrat_14);
lv_disp_set_theme(lv_disp_get_default(), th);
```

Chỉ một lời gọi đó là bạn có nút chuyển sáng/tối: dựng lại theme với `dark = true` và mọi
widget tự đổi diện mạo.

## Một design system nhỏ

Đây là khuôn mẫu tôi dùng cho mọi dự án — một file, khởi tạo một lần, rồi tham chiếu khắp
nơi:

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

Mỗi widget vẫn chỉ tốn một dòng, và đổi màu thương hiệu chỉ là sửa một dòng rồi lan ra
toàn bộ sản phẩm.

## Những chi phí cần nhớ

- Mỗi **cỡ font** bạn bật là một bộ bitmap glyph đầy đủ nằm trong flash. Hai cỡ thường là
  đủ; ba cỡ đã là nhiều.
- **Đổ bóng và gradient** là thứ tốn kém nhất khi vẽ trên MCU không có GPU. Nếu UI giật khi
  cuộn, hãy bỏ shadow trước rồi đo lại.
- Gọi `lv_obj_add_style()` lên đối tượng đã có nhiều style sẽ tốn một lần cấp phát nhỏ mỗi
  lần. Hãy thêm style lúc tạo, đừng thêm liên tục lúc chạy.

## Bài tiếp theo

Giao diện đã đẹp. Bài 6 làm nó biết phản hồi: hệ thống sự kiện, callback, user data, và
cách xử lý đầu vào từ cảm ứng, encoder hay nút bấm bằng cùng một đoạn code.
