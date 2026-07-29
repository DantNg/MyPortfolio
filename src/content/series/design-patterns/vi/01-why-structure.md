---
lesson: 1
lang: vi
title: "Vì sao firmware cần cấu trúc — SOLID, dịch sang tiếng nhúng"
description: "Điều gì thực sự đổ vỡ khi firmware lớn dần, năm nguyên tắc SOLID viết lại cho thiết bị hạn chế tài nguyên, và quy tắc phân tầng làm nền cho cả series."
duration: "13 phút"
tags: ["Design pattern", "SOLID", "Kiến trúc"]
---

## Cái file nuốt chửng dự án

Kỹ sư firmware nào cũng từng gặp nó: `main.c`, 4.000 dòng, ba chục biến toàn cục, một
`while(1)` kèm dòng chú thích `// TODO: refactor`. Nó chạy được. Không ai muốn động vào.

Nó thành ra như vậy qua một chuỗi quyết định mà từng cái đều hợp lý. Vấn đề không nằm ở đoạn
code đang có — mà ở những điều đoạn code đó khiến trở nên bất khả thi:

- **Không unit-test được**, vì mọi hàm đều thò tay thẳng vào `HAL_I2C_Read()`.
- **Không port được**, vì header của hãng chip được include từ đỉnh tới đáy đồ thị lời gọi.
- **Không sửa an toàn được**, vì mọi thứ chia sẻ trạng thái qua biến toàn cục và bạn không
  biết một thay đổi chạm tới những đâu.
- **Không làm song song được**, vì hai người cùng sửa file đó nghĩa là xung đột merge mỗi ngày.

Pattern không phải chuyện thanh lịch. Nó là chuyện giữ cho bốn điều trên vẫn khả thi khi dự
án vượt qua một kích cỡ nhất định.

## Khi nào cấu trúc đáng cái giá của nó

Hãy thành thật về sự đánh đổi. Pattern tốn thêm một lớp gián tiếp, mà gián tiếp thì tốn chu
kỳ, tốn flash và tốn cả sự dễ đọc. Một chương trình nháy LED 500 dòng không cần dependency
injection.

Các ngưỡng gần đúng mà khoản đầu tư bắt đầu sinh lời:

| Tình huống | Có nên cấu trúc? |
| --- | --- |
| < 1.000 dòng, một người, một board | Không. Cứ viết thẳng. |
| Nhiều board hoặc nhiều biến thể chip | Có — cần ranh giới HAL |
| Có ai đó muốn unit test | Có — cần interface |
| Nhiều hơn hai lập trình viên | Có — cần ranh giới module |
| Dòng sản phẩm sẽ có nhiều biến thể | Có — gần như cả series này |
| Liên quan an toàn | Có, và dù sao cũng bị bắt buộc |

Phần còn lại của bài này giả định bạn đã vượt qua ít nhất một trong những vạch đó.

## SOLID, dịch sang tiếng firmware

SOLID được viết cho code hướng đối tượng ở doanh nghiệp. Mỗi nguyên tắc đều có một bản dịch
sang firmware thực sự hữu ích, và một cách hiểu ngây thơ thì không.

### S — Single Responsibility (một trách nhiệm)

*Một module chỉ nên có một lý do để thay đổi.*

Trong firmware, phép thử sắc bén nhất là: **file này có trộn chính sách với cơ chế không?**

```c
/* TỆ — trộn giao thức cảm biến với luật nghiệp vụ với đầu ra */
void check_temperature(void) {
    uint8_t raw[2];
    HAL_I2C_Mem_Read(&hi2c1, 0x90, 0x00, 1, raw, 2, 100);   /* cơ chế     */
    float t = (raw[0] << 8 | raw[1]) * 0.0625f;             /* cơ chế     */
    if (t > 80.0f) {                                        /* chính sách */
        HAL_GPIO_WritePin(FAN_PORT, FAN_PIN, GPIO_PIN_SET); /* cơ chế     */
        log_printf("overheat %f", t);                       /* cơ chế     */
    }
}
```

Ba trách nhiệm trong chín dòng. Hãy tách ra:

```c
/* tmp75.c     — biết về cảm biến, không biết gì khác */
int  tmp75_read_celsius(const i2c_if_t *bus, float *out);

/* thermal.c   — biết về chính sách, hoàn toàn không biết phần cứng */
thermal_action_t thermal_evaluate(float celsius, const thermal_cfg_t *cfg);

/* fan.c       — biết về cơ cấu chấp hành */
void fan_set(bool on);
```

Giờ `thermal_evaluate()` là một hàm thuần khiết mà bạn kiểm thử được bằng một bảng đầu vào, và
phần chính sách — phần dễ thay đổi nhất khi bộ phận kinh doanh sửa đặc tả — nằm trong một file
không hề `#include` header nào của hãng chip.

### O — Open/Closed (mở để mở rộng, đóng để sửa đổi)

Bản dịch cho firmware: **thêm một thiết bị mới không được kéo theo việc sửa một `switch`.**

```c
/* TỆ — mỗi cảm biến mới lại sửa hàm này */
float read_sensor(sensor_type_t type) {
    switch (type) {
    case SENSOR_TMP75:  return tmp75_read();
    case SENSOR_DS18B20: return ds18b20_read();
    case SENSOR_BME280: return bme280_read();   /* ← lại sửa lần nữa */
    }
}

/* TỐT — cảm biến mới chỉ thêm một file và một dòng trong bảng */
typedef struct {
    const char *name;
    int (*read)(void *ctx, float *out);
    void *ctx;
} sensor_if_t;

static const sensor_if_t sensors[] = {
    { "tmp75",   tmp75_read,   &tmp75_ctx   },
    { "ds18b20", ds18b20_read, &ds18b20_ctx },
};
```

Đừng làm quá. Nếu bạn có đúng hai biến thể và chắc chắn không bao giờ có cái thứ ba, thì
`switch` rõ ràng hơn.

### L — Liskov Substitution (thay thế được)

*Một bản hiện thực phải tôn trọng hợp đồng của interface.*

Đây là điều người ta hay bỏ qua trong C rồi lãnh đủ. Nếu `i2c_if_t` của bạn nói rằng `read()`
trả về 0 khi thành công và chặn tối đa bằng một timeout, thì **mọi** bản hiện thực đều phải
làm đúng như vậy. Một bản trả về 1 khi thành công, hoặc chặn vĩnh viễn, sẽ phá vỡ những người
gọi vốn viết theo hợp đồng đó.

Hãy viết hợp đồng vào header, bằng lời, ngay cạnh con trỏ hàm. Nó tốn ba dòng chú thích và
ngăn được cả lớp lỗi kiểu "chạy với driver STM32 nhưng không chạy với bản giả lập".

### I — Interface Segregation (tách nhỏ interface)

*Đừng bắt bên gọi phụ thuộc vào những hàm nó không dùng.*

```c
/* TỆ — một cái ghi log nhiệt độ cũng phải hiện thực đủ mười hai hàm */
typedef struct {
    int (*init)(void); int (*read)(void); int (*write)(void);
    int (*erase)(void); int (*sleep)(void); int (*calibrate)(void);
    /* ... */
} device_if_t;

/* TỐT — interface nhỏ, tập trung */
typedef struct { int (*read)(void *ctx, float *out); void *ctx; } readable_if_t;
typedef struct { int (*write)(void *ctx, const void *d, size_t n); void *ctx; } writable_if_t;
```

Interface nhỏ cũng rẻ hơn: một struct hai con trỏ là 8 byte, mười hai con trỏ là 48 byte, và
trên MCU thì khác biệt đó là thật.

### D — Dependency Inversion (đảo ngược phụ thuộc)

*Module cấp cao không nên phụ thuộc module cấp thấp; cả hai cùng phụ thuộc vào trừu tượng.*

Đây là điều quan trọng nhất, và bài 3 dành trọn cho nó. Trong firmware nó nghĩa là: **logic
ứng dụng của bạn include một header interface, chứ không phải `stm32f4xx_hal.h`.**

## Quy tắc phân tầng

![Phân tầng firmware](/MyPortfolio/images/patterns/layering.svg)

Tất cả những điều trên gói lại thành một quy tắc mà bạn thực sự bắt tuân thủ được:

> **Phụ thuộc chỉ đi xuống, không bao giờ đi lên hay đi ngang qua ranh giới tầng.**

| Tầng | Chứa gì | Biết phần cứng? | Test được? |
| --- | --- | --- | --- |
| Application | chính sách, máy trạng thái, thuật toán | **không** | rất dễ |
| Device / Service | cảm biến, lưu trữ, giao thức | chỉ qua interface | với bản giả |
| HAL / Port | định nghĩa interface + hiện thực theo từng chip | có | trên phần cứng |
| Hardware | thanh ghi | — | — |

Phép kiểm tra tốn năm giây và tìm ra phần lớn vi phạm:

```bash
grep -rn "stm32\|esp_\|nrf_\|HAL_" src/app/
```

Có kết quả nào tức là tầng đã bị rò rỉ. Đưa nó vào CI thì kiến trúc sẽ thôi bị bào mòn — điều
mà nếu không làm, nó vẫn cứ diễn ra, lặng lẽ, trong mười tám tháng.

## Hai pattern thực dụng có thể dùng ngay hôm nay

### Con trỏ mờ (opaque pointer) — đóng gói thật sự trong C

```c
/* sensor.h — bên gọi không nhìn được vào trong */
typedef struct sensor sensor_t;

sensor_t *sensor_create(const i2c_if_t *bus, uint8_t addr);
int       sensor_read(sensor_t *s, float *out);
void      sensor_destroy(sensor_t *s);
```

```c
/* sensor.c — nơi duy nhất biết bố cục bên trong */
struct sensor {
    const i2c_if_t *bus;
    uint8_t addr;
    float   last;
    uint32_t error_count;
};
```

Bên gọi về mặt vật lý không với tới `s->error_count` được, nên bạn tái cấu trúc thoải mái. Đây
chính là `private` của C, không tốn gì lúc chạy, và là thói quen giá trị nhất trong bài này.

Với dự án cấp phát tĩnh, nơi `malloc` bị cấm, hãy dùng một bể cố định:

```c
#define MAX_SENSORS 4
static struct sensor pool[MAX_SENSORS];
static bool          used[MAX_SENSORS];

sensor_t *sensor_create(const i2c_if_t *bus, uint8_t addr) {
    for (int i = 0; i < MAX_SENSORS; i++) {
        if (!used[i]) {
            used[i] = true;
            pool[i] = (struct sensor){ .bus = bus, .addr = addr };
            return &pool[i];
        }
    }
    return NULL;
}
```

### Trả về giá trị thay vì dùng biến toàn cục

```c
/* TỆ */
extern int last_error;
void do_thing(void);          /* nhớ kiểm tra last_error sau đó, chắc thế */

/* TỐT */
typedef enum { OK = 0, ERR_TIMEOUT, ERR_CRC, ERR_BUSY } status_t;
status_t do_thing(void);
```

Một enum trả về thì grep được, buộc bên gọi phải quyết định, và dùng được với
`__attribute__((warn_unused_result))` để trình biên dịch càm ràm khi có ai đó lờ nó đi.

## Tự kiểm tra

1. Trong bốn điều mà một file khổng lồ khiến bất khả thi, điều nào quan trọng nhất với dự án
   hiện tại của bạn?
2. Câu grep một dòng nào phát hiện được vi phạm phân tầng?
3. Vì sao con trỏ mờ không tốn gì lúc chạy?
4. Khi nào thì `switch` theo loại thiết bị lại là câu trả lời *đúng*?

## Bài tiếp theo

Bài 2: máy trạng thái. Pattern mà firmware dùng nhiều hơn mọi pattern khác, làm theo bốn cách,
kèm đánh đổi và code cho từng cách.
