---
lesson: 4
lang: vi
title: "Bố cục — Align, Flex và Grid"
description: "Ngừng gõ cứng toạ độ pixel. Đơn vị kích thước, căn chỉnh, Flexbox và Grid trong LVGL, kèm một dashboard co giãn được khi đổi độ phân giải."
duration: "16 phút"
tags: ["LVGL", "Flexbox", "Grid", "Bố cục"]
---

## Vấn đề của toạ độ pixel

Đoạn này chạy được:

```c
lv_obj_set_pos(card1, 10, 10);
lv_obj_set_pos(card2, 120, 10);
lv_obj_set_pos(card3, 230, 10);
```

…cho tới khi khách đổi sang màn 480×320 thay vì 320×240, hoặc bạn chèn thêm một thẻ vào
giữa, hoặc chữ tiếng Việt dài hơn tiếng Anh. Lúc đó bạn phải tính lại từng con số bằng tay.

LVGL cho bạn ba công cụ để tránh việc đó, mạnh dần lên.

![Công cụ bố cục](/MyPortfolio/images/lvgl/layout-flex-grid.svg)

## Đơn vị kích thước

Trước khi nói tới layout, hãy đặt kích thước cho đúng:

```c
lv_obj_set_width(obj, 120);              /* 120 pixel vật lý                */
lv_obj_set_width(obj, lv_pct(50));       /* 50% bề rộng nội dung của cha    */
lv_obj_set_width(obj, LV_SIZE_CONTENT);  /* vừa khít nội dung bên trong     */

lv_obj_set_size(obj, lv_pct(100), 60);   /* full chiều ngang, cao cố định   */
```

`LV_SIZE_CONTENT` là thứ làm cái nút ôm sát nhãn của nó, còn `lv_pct()` là thứ giúp bố cục
sống sót khi đổi độ phân giải. Hãy dùng chúng làm mặc định; chỉ dùng pixel thô cho những
thứ thật sự mang tính vật lý, ví dụ vùng chạm tối thiểu 44 px.

## 1. Align — cho một đối tượng so với một đối tượng khác

```c
lv_obj_align(obj, LV_ALIGN_CENTER, 0, 0);            /* bên trong cha  */
lv_obj_align(obj, LV_ALIGN_TOP_RIGHT, -10, 10);      /* kèm độ lệch    */

/* căn theo anh em, không theo cha */
lv_obj_align_to(icon, label, LV_ALIGN_OUT_LEFT_MID, -8, 0);
```

Chín vị trí `LV_ALIGN_*` phủ hết bốn góc, bốn cạnh và tâm. Các biến thể `LV_ALIGN_OUT_*`
đặt đối tượng *bên ngoài* mốc tham chiếu — đó là cách dựng "icon nằm cạnh chữ" mà không cần
đo chiều dài chữ.

## 2. Flex — hàng và cột tự quản

Biến một container thành flex container là các con tự sắp xếp:

```c
lv_obj_t * row = lv_obj_create(lv_scr_act());
lv_obj_set_size(row, lv_pct(100), LV_SIZE_CONTENT);

lv_obj_set_layout(row, LV_LAYOUT_FLEX);
lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
lv_obj_set_flex_align(row,
        LV_FLEX_ALIGN_SPACE_EVENLY,   /* trục chính: dọc theo hàng     */
        LV_FLEX_ALIGN_CENTER,         /* trục phụ: ở đây là chiều dọc  */
        LV_FLEX_ALIGN_CENTER);        /* giữa các dòng khi wrap        */

/* chỉ việc tạo con — không cần toạ độ nào cả */
for (int i = 0; i < 3; i++) {
    lv_obj_t * btn = lv_btn_create(row);
    lv_obj_set_size(btn, 80, 44);
    lv_obj_t * l = lv_label_create(btn);
    lv_label_set_text_fmt(l, "CH%d", i + 1);
    lv_obj_center(l);
}
```

Các kiểu dòng chảy:

| Flow | Tác dụng |
| --- | --- |
| `LV_FLEX_FLOW_ROW` | trái sang phải |
| `LV_FLEX_FLOW_COLUMN` | trên xuống dưới |
| `LV_FLEX_FLOW_ROW_WRAP` | tự xuống dòng khi đầy |
| `LV_FLEX_FLOW_COLUMN_REVERSE` | dưới lên trên |

Và các kiểu căn: `START`, `END`, `CENTER`, `SPACE_EVENLY`, `SPACE_AROUND`,
`SPACE_BETWEEN` — ngữ nghĩa giống hệt flexbox của CSS.

### Grow

Một con có thể "ăn" hết phần không gian còn lại:

```c
lv_obj_set_flex_grow(main_area, 1);   /* chiếm toàn bộ chiều cao còn dư */
```

Đây là cách dựng khung ứng dụng kinh điển — header cố định, footer cố định, thân co giãn:

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
lv_obj_set_flex_grow(body, 1);          /* <- phần co giãn */

lv_obj_t * footer = lv_obj_create(scr);
lv_obj_set_size(footer, lv_pct(100), 48);
```

Đổi màn hình từ cao 240 px sang 320 px, giao diện vẫn đúng. Đó chính là toàn bộ mục đích.

## 3. Grid — bố cục hai chiều

Khi cả hàng *và* cột đều phải thẳng nhau, hãy dùng Grid. Bạn mô tả các "đường ray" một lần:

```c
/* LV_GRID_TEMPLATE_LAST kết thúc mảng — đừng quên */
static lv_coord_t cols[] = {LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_TEMPLATE_LAST};
static lv_coord_t rows[] = {60, LV_GRID_FR(1), 40, LV_GRID_TEMPLATE_LAST};

lv_obj_t * grid = lv_obj_create(lv_scr_act());
lv_obj_set_size(grid, lv_pct(100), lv_pct(100));
lv_obj_set_grid_dsc_array(grid, cols, rows);
lv_obj_set_layout(grid, LV_LAYOUT_GRID);
```

`LV_GRID_FR(n)` là một phần của không gian trống — `FR(1)` với `FR(1)` chia đôi đều nhau,
`FR(2)` với `FR(1)` cho tỉ lệ 2:1. Số cụ thể là pixel.

Rồi đặt con vào ô:

```c
lv_obj_t * a = lv_obj_create(grid);
lv_obj_set_grid_cell(a,
        LV_GRID_ALIGN_STRETCH, 0, 1,    /* cột:  căn, bắt đầu, số ô chiếm */
        LV_GRID_ALIGN_STRETCH, 0, 1);   /* hàng: căn, bắt đầu, số ô chiếm */

lv_obj_t * wide = lv_obj_create(grid);
lv_obj_set_grid_cell(wide,
        LV_GRID_ALIGN_STRETCH, 0, 2,    /* chiếm cả hai cột */
        LV_GRID_ALIGN_STRETCH, 2, 1);
```

## Padding và khoảng cách

Layout tôn trọng padding của container và các thuộc tính khoảng cách:

```c
lv_obj_set_style_pad_all(cont, 12, 0);     /* lề trong cả bốn phía      */
lv_obj_set_style_pad_row(cont, 8, 0);      /* khoảng cách dọc giữa item */
lv_obj_set_style_pad_column(cont, 8, 0);   /* khoảng cách ngang         */
```

Nếu các item flex dính sát vào nhau, gần như luôn là do `pad_row`/`pad_column`, chứ không
phải do bản thân item.

## Ví dụ hoàn chỉnh — dashboard 3 thẻ co giãn

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

    /* --- hàng thẻ, tự xuống dòng trên màn hẹp --- */
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
        lv_obj_set_flex_grow(card, 1);          /* chia đều chiều ngang */
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

Không một toạ độ cứng nào. Chạy trong simulator, đổi kích thước cửa sổ trong `lv_conf.h`
hoặc cấu hình simulator, bố cục tự thích ứng.

## Gỡ lỗi bố cục

- Không thấy gì → cha đang để chiều cao `LV_SIZE_CONTENT` mà chưa có con nào kích thước cố
  định, nên nó co về 0. Hãy cho cha một chiều cao thật trước.
- Các item chồng lên nhau → bạn trộn `lv_obj_align()` với layout. Layout *sở hữu* vị trí
  các con; gọi align lên chúng sẽ bị bỏ qua hoặc "đánh nhau" với layout.
- Bố cục có vẻ cũ sau khi đổi kích thước lúc chạy → gọi `lv_obj_update_layout(cont)` để
  tính lại ngay, thay vì đợi lần `lv_timer_handler()` kế tiếp.

## Bài tiếp theo

Dashboard đã chạy nhưng trông vẫn "mặc định". Bài 5 nói về style: màu, viền, đổ bóng, font,
trạng thái, và các đối tượng style dùng lại được để giữ chi phí RAM gần như bằng không.
