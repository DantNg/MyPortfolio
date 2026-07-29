---
lesson: 6
lang: vi
title: "Sự kiện và thiết bị nhập"
description: "Mã sự kiện, callback, user data, cơ chế bubbling, và cách điều khiển cùng một giao diện bằng cảm ứng, encoder xoay hay ba nút bấm."
duration: "15 phút"
tags: ["LVGL", "Sự kiện", "Encoder", "Cảm ứng"]
---

## Hệ thống sự kiện trong một bức hình

![Luồng sự kiện](/MyPortfolio/images/lvgl/events.svg)

`read_cb` của bạn chỉ báo toạ độ thô và trạng thái nhấn/nhả. LVGL tự tìm widget nằm dưới
điểm đó, đếm thời gian giữ, xét xem ngón tay có di chuyển không, rồi biến tất cả thành các
mã sự kiện có ngữ nghĩa gửi tới callback của bạn.

## Đăng ký callback

```c
lv_obj_add_event_cb(obj, my_cb, LV_EVENT_CLICKED, user_data);
```

Bạn có thể gắn nhiều callback lên cùng một đối tượng, và một callback cho nhiều mã sự kiện
bằng cách truyền `LV_EVENT_ALL`.

Bên trong callback:

```c
static void my_cb(lv_event_t * e)
{
    lv_event_code_t  code   = lv_event_get_code(e);
    lv_obj_t       * target = lv_event_get_target(e);       /* cái bị chạm     */
    void           * data   = lv_event_get_user_data(e);    /* cái bạn truyền  */

    if (code == LV_EVENT_CLICKED) {
        /* ... */
    }
}
```

## Những mã sự kiện quan trọng

**Sự kiện đầu vào**

| Mã | Khi nào |
| --- | --- |
| `LV_EVENT_PRESSED` | ngón tay chạm xuống đối tượng |
| `LV_EVENT_PRESSING` | lặp lại trong lúc giữ |
| `LV_EVENT_LONG_PRESSED` | sau `LV_INDEV_DEF_LONG_PRESS_TIME` (400 ms) |
| `LV_EVENT_LONG_PRESSED_REPEAT` | lặp lại sau đó |
| `LV_EVENT_RELEASED` | nhấc tay, ở bất kỳ đâu |
| `LV_EVENT_CLICKED` | nhấc tay **khi vẫn còn trên đối tượng** ← dùng cái này |
| `LV_EVENT_GESTURE` | phát hiện vuốt trên màn hình |

Khác biệt giữa `RELEASED` và `CLICKED` rất quan trọng: kéo ngón tay ra khỏi nút rồi mới
nhấc thì bạn nhận `RELEASED` chứ không có `CLICKED`. Đó chính là hành vi "huỷ thao tác" mà
người dùng mong đợi, và bạn có nó miễn phí chỉ bằng cách chọn đúng mã.

**Sự kiện giá trị**

| Mã | Khi nào |
| --- | --- |
| `LV_EVENT_VALUE_CHANGED` | slider kéo, checkbox tick, dropdown chọn, roller xoay |
| `LV_EVENT_READY` / `LV_EVENT_CANCEL` | xác nhận hoặc huỷ ở keyboard/msgbox |

**Sự kiện vòng đời**

| Mã | Khi nào |
| --- | --- |
| `LV_EVENT_DELETE` | đối tượng sắp bị giải phóng — hãy dọn tài nguyên ở đây |
| `LV_EVENT_SIZE_CHANGED` | kích thước thay đổi |
| `LV_EVENT_DRAW_MAIN` | điểm móc để tự vẽ thêm |

## User data — truyền ngữ cảnh cho gọn

Cách ngây thơ là tạo một biến toàn cục cho mỗi widget. Đừng. Hãy truyền con trỏ:

```c
typedef struct {
    uint8_t     channel;
    lv_obj_t  * readout;
} channel_ctx_t;

static channel_ctx_t ctx[4];        /* static: phải sống lâu hơn widget */

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

Một callback, bốn slider, không biến toàn cục, không cần `switch` theo con trỏ.

## Bubbling (nổi lên cha)

Mặc định sự kiện chỉ nổ ở đúng đối tượng đích. Bật bubbling thì nó truyền ngược lên cha:

```c
lv_obj_add_flag(child, LV_OBJ_FLAG_EVENT_BUBBLE);
```

Đó là cách xử lý danh sách 30 mục bằng đúng một callback đặt ở container:

```c
static void list_cb(lv_event_t * e)
{
    lv_obj_t * item = lv_event_get_target(e);        /* mục bị chạm          */
    lv_obj_t * cont = lv_event_get_current_target(e);/* nơi gắn callback     */

    uint32_t index = lv_obj_get_index(item);
    open_detail(index);
}
```

Phân biệt `lv_event_get_target()` và `lv_event_get_current_target()` là thứ hữu ích nhất
khi đã bật bubbling.

## Tự gửi sự kiện

```c
lv_event_send(obj, LV_EVENT_CLICKED, NULL);          /* giả lập một cú click */
lv_obj_send_event(obj, LV_EVENT_REFRESH, NULL);      /* cách viết của LVGL 9 */
```

Hữu ích cho kiểm thử, cho nút "khôi phục mặc định", và để điều khiển UI bằng lệnh serial
trong lúc bring-up.

## Các loại thiết bị nhập

LVGL hỗ trợ bốn loại đầu vào, tất cả qua cùng một dạng `read_cb`:

```c
indev_drv.type = LV_INDEV_TYPE_POINTER;   /* cảm ứng hoặc chuột      */
indev_drv.type = LV_INDEV_TYPE_ENCODER;   /* xoay + nhấn             */
indev_drv.type = LV_INDEV_TYPE_KEYPAD;    /* phím mũi tên + enter    */
indev_drv.type = LV_INDEV_TYPE_BUTTON;    /* nút gán vào toạ độ XY   */
```

### Encoder — chủ lực của thiết bị không cảm ứng

Bảng điều khiển công nghiệp và thiết bị giá rẻ thường chỉ có một encoder xoay. LVGL xử lý
việc này rất bài bản qua **group**: encoder di chuyển tiêu điểm giữa các widget, nhấn để
vào chế độ "edit" trên widget đang được chọn.

```c
static lv_group_t * g;

static void encoder_read(lv_indev_drv_t * drv, lv_indev_data_t * data)
{
    data->enc_diff = encoder_get_delta();        /* -N .. +N từ lần đọc trước */
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
    lv_group_set_default(g);        /* widget mới tự động gia nhập */
}

/* thêm widget vào thứ tự điều hướng */
lv_group_add_obj(g, btn_start);
lv_group_add_obj(g, slider_speed);
lv_group_add_obj(g, dropdown_mode);
```

Bây giờ: xoay → tiêu điểm chạy; nhấn → vào sửa widget đang chọn; xoay → đổi giá trị; nhấn →
xác nhận. Code nút và slider của bạn *giống hệt* bản dùng cảm ứng. Đây là lý lẽ mạnh nhất
để dùng hệ thống sự kiện của LVGL thay vì tự đi hỏi giá trị từng widget.

### Chống dội và hiệu chuẩn là việc của bạn

LVGL không chống dội. Nếu bộ điều khiển cảm ứng điện trở báo nhiễu, hãy lọc ngay trong
`read_cb` — trung vị 3 mẫu thường là đủ:

```c
static void touch_read(lv_indev_drv_t * drv, lv_indev_data_t * data)
{
    int16_t rx, ry;
    if (!touch_raw(&rx, &ry)) { data->state = LV_INDEV_STATE_RELEASED; return; }

    /* quy đổi dải ADC thô sang pixel — hiệu chuẩn một lần, lưu vào flash */
    data->point.x = (rx - CAL_X_MIN) * HRES / (CAL_X_MAX - CAL_X_MIN);
    data->point.y = (ry - CAL_Y_MIN) * VRES / (CAL_Y_MAX - CAL_Y_MIN);

    /* kẹp biên: điểm ngoài vùng khiến LVGL bỏ qua hoàn toàn cú chạm */
    if (data->point.x < 0) data->point.x = 0;
    if (data->point.y < 0) data->point.y = 0;
    if (data->point.x >= HRES) data->point.x = HRES - 1;
    if (data->point.y >= VRES) data->point.y = VRES - 1;

    data->state = LV_INDEV_STATE_PRESSED;
}
```

## Ví dụ hoàn chỉnh — một hàng điều khiển

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
    lv_obj_t * mb = lv_msgbox_create(NULL, "Da dung",
                                     "Dong co da dung theo lenh nguoi van hanh.",
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

Chú ý `LV_EVENT_VALUE_CHANGED` trên slider: nó nổ liên tục trong lúc kéo. Nếu hành động
tốn kém (ghi flash, gửi khung CAN), hãy giới hạn tần suất hoặc xử lý ở `LV_EVENT_RELEASED`.

## Lỗi thường gặp

- **Làm việc nặng trong callback.** Callback chạy bên trong `lv_timer_handler()`. Ghi flash
  200 ms ở đó là đóng băng giao diện 200 ms. Hãy bật cờ và xử lý ở vòng lặp chính.
- **Xoá chính đối tượng đang xử lý sự kiện.** Dùng `lv_obj_del_async(obj)` — nó hoãn việc
  xoá tới khi sự kiện kết thúc.
- **Tưởng rằng `LV_EVENT_VALUE_CHANGED` nổ khi bạn đặt giá trị bằng code.** Mặc định là
  không. `lv_slider_set_value(sl, v, LV_ANIM_OFF)` im lặng; hãy tự gửi sự kiện nếu muốn đi
  chung một luồng xử lý.

## Bài tiếp theo

Bài 7 thêm chuyển động và thời gian: animation, `lv_timer`, và cách cập nhật màn hình từ
dữ liệu cảm biến mà không chặn thứ gì.
