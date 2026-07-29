---
lesson: 3
lang: vi
title: "Interface và Dependency Injection bằng C thuần"
description: "Cách kiểm thử code nói chuyện với phần cứng mà không cần phần cứng: interface bằng con trỏ hàm, thay thế lúc liên kết và lúc biên dịch, và khi nào dùng cách nào."
duration: "15 phút"
tags: ["Design pattern", "Kiểm thử", "HAL"]
---

## Vấn đề, nói cho chính xác

```c
/* temp_monitor.c */
#include "stm32f4xx_hal.h"

float get_temperature(void)
{
    uint8_t raw[2];
    HAL_I2C_Mem_Read(&hi2c1, 0x90, 0x00, 1, raw, 2, 100);
    return ((raw[0] << 8) | raw[1]) * 0.0625f;
}

bool is_overheating(void)
{
    return get_temperature() > 80.0f;
}
```

`is_overheating()` chứa đúng một dòng logic và không thể kiểm thử được. Để chạy được nó, bạn
cần một con STM32, một cảm biến I²C, và một cách làm cho cảm biến đó đọc ra 81 °C — mà trên
thực tế nghĩa là một cái súng khò và một kỹ thuật viên.

Phụ thuộc đang chỉ sai hướng: chính sách cấp cao lại phụ thuộc vào driver cấp thấp.

## Cách sửa — đảo ngược nó

![Interface trong C](/MyPortfolio/images/patterns/interfaces-c.svg)

Hãy định nghĩa thứ bạn *cần*, thay vì dùng thứ đang *có sẵn*:

```c
/* i2c_if.h — một hợp đồng. Không có header nào của hãng chip trong file này. */
#ifndef I2C_IF_H
#define I2C_IF_H

#include <stdint.h>
#include <stddef.h>

typedef struct {
    /* Đọc `len` byte từ thanh ghi `reg` của thiết bị `addr`.
     * Trả 0 khi thành công, số âm khi lỗi.
     * Chặn tối đa bằng một timeout do bản hiện thực quy định. Không bao giờ chặn mãi. */
    int (*read)(void *ctx, uint8_t addr, uint8_t reg, uint8_t *buf, size_t len);

    /* Ghi `len` byte vào `reg` của `addr`. Quy ước trả về như trên. */
    int (*write)(void *ctx, uint8_t addr, uint8_t reg, const uint8_t *buf, size_t len);

    void *ctx;      /* trạng thái của bản hiện thực — bên gọi không bao giờ soi vào */
} i2c_if_t;

#endif
```

Hãy để ý phần chú thích. Đó chính là hợp đồng Liskov ở bài 1, được viết ra đúng chỗ mà mọi
người hiện thực đều nhìn thấy.

Logic giờ nhận interface làm tham số:

```c
/* temp_monitor.c — không header nào của hãng chip */
#include "i2c_if.h"

#define TMP75_ADDR 0x90
#define TMP75_REG_TEMP 0x00

int temp_read_celsius(const i2c_if_t *bus, float *out)
{
    uint8_t raw[2];
    int rc = bus->read(bus->ctx, TMP75_ADDR, TMP75_REG_TEMP, raw, sizeof(raw));
    if (rc != 0) return rc;

    *out = (float)((int16_t)((raw[0] << 8) | raw[1])) * 0.0625f;
    return 0;
}

bool is_overheating(const i2c_if_t *bus)
{
    float t;
    if (temp_read_celsius(bus, &t) != 0) return true;   /* lỗi thì nghiêng về an toàn */
    return t > 80.0f;
}
```

Bản hiện thực thật:

```c
/* i2c_stm32.c — file duy nhất include header của hãng */
#include "stm32f4xx_hal.h"
#include "i2c_if.h"

static int stm32_read(void *ctx, uint8_t addr, uint8_t reg, uint8_t *buf, size_t len)
{
    I2C_HandleTypeDef *h = (I2C_HandleTypeDef *)ctx;
    return HAL_I2C_Mem_Read(h, addr, reg, 1, buf, len, 100) == HAL_OK ? 0 : -1;
}

static int stm32_write(void *ctx, uint8_t addr, uint8_t reg, const uint8_t *buf, size_t len)
{
    I2C_HandleTypeDef *h = (I2C_HandleTypeDef *)ctx;
    return HAL_I2C_Mem_Write(h, addr, reg, 1, (uint8_t *)buf, len, 100) == HAL_OK ? 0 : -1;
}

const i2c_if_t i2c1_if = {
    .read  = stm32_read,
    .write = stm32_write,
    .ctx   = &hi2c1,
};
```

Và bản giả, dùng cho kiểm thử:

```c
/* i2c_fake.c */
#include "i2c_if.h"
#include <string.h>

typedef struct {
    uint8_t regs[256];
    int     force_error;
    int     read_count;
} fake_ctx_t;

static fake_ctx_t fake;

static int fake_read(void *ctx, uint8_t addr, uint8_t reg, uint8_t *buf, size_t len)
{
    fake_ctx_t *f = ctx;
    f->read_count++;
    if (f->force_error) return -1;
    memcpy(buf, &f->regs[reg], len);
    return 0;
}

const i2c_if_t i2c_fake_if = { .read = fake_read, .write = fake_write, .ctx = &fake };

/* các hàm phụ trợ cho bài test */
void fake_set_temp(float c) {
    int16_t raw = (int16_t)(c / 0.0625f);
    fake.regs[0x00] = raw >> 8;
    fake.regs[0x01] = raw & 0xFF;
}
void fake_set_error(int on) { fake.force_error = on; }
```

Giờ là bài test, chạy trên laptop trong vài mili-giây:

```c
void test_overheating_above_threshold(void)
{
    fake_set_temp(81.0f);
    TEST_ASSERT_TRUE(is_overheating(&i2c_fake_if));
}

void test_not_overheating_below_threshold(void)
{
    fake_set_temp(79.9f);
    TEST_ASSERT_FALSE(is_overheating(&i2c_fake_if));
}

void test_bus_error_fails_safe(void)
{
    fake_set_error(1);
    TEST_ASSERT_TRUE(is_overheating(&i2c_fake_if));   /* lỗi → coi như đang nóng */
}
```

Bài test thứ ba là bài bạn chưa từng viết được trước đây, và nó phủ đúng trường hợp dễ gây
chuyện nhất ngoài thực địa.

## Ba cách thay thế

Interface bằng con trỏ hàm chỉ là một lựa chọn. Có ba, và mỗi cách có chỗ của nó.

### 1. Lúc chạy — con trỏ hàm

Chính là thứ ta vừa làm. Bản hiện thực được chọn trong lúc chương trình chạy.

**Chi phí:** một lời gọi gián tiếp (2–4 chu kỳ trên Cortex-M) và 8–16 byte cho mỗi thực thể
interface.

**Dùng khi** bạn cần nhiều bản hiện thực *cùng lúc* — ba bus I²C, hai loại cảm biến, hoặc một
bản mock chạy song song với bản thật.

### 2. Lúc liên kết — cùng tên hàm, khác file object

```c
/* i2c.h — hàm thường, không có struct */
int i2c_read(uint8_t addr, uint8_t reg, uint8_t *buf, size_t len);
```

Rồi biên dịch `i2c_stm32.c` vào firmware và `i2c_fake.c` vào bản test. Trình liên kết sẽ phân
giải cùng một ký hiệu theo hai cách khác nhau.

```makefile
firmware: main.o temp_monitor.o i2c_stm32.o
	$(CC) -o $@ $^

test_temp: test_temp.o temp_monitor.o i2c_fake.o
	$(HOSTCC) -o $@ $^
```

**Chi phí:** bằng không. Đó là lời gọi trực tiếp.

**Dùng khi** mỗi bản build chỉ có đúng một bản hiện thực. Đây là lựa chọn rẻ nhất và thường bị
bỏ qua vì nó không "thời thượng" — nhưng với dự án chỉ có một dòng chip đích thì đó là câu trả
lời đúng.

### 3. Lúc biên dịch — template hoặc macro

Trong C++, template cho bạn thay thế không tốn gì kèm nội tuyến hoàn toàn (bài 5). Trong C,
bản macro tương đương thì chạy được nhưng hại khả năng đọc:

```c
#ifdef UNIT_TEST
  #define I2C_READ(a, r, b, l)  fake_i2c_read(a, r, b, l)
#else
  #define I2C_READ(a, r, b, l)  HAL_I2C_Mem_Read(&hi2c1, a, r, 1, b, l, 100)
#endif
```

**Chi phí:** bằng không lúc chạy, nhưng `#ifdef` trong code ứng dụng là một mùi khó chịu — nó
nghĩa là có hai phiên bản logic, và bản build để test thôi không còn giống bản build xuất
xưởng.

**Dùng dè dặt**, và trong C thì hãy ưu tiên thay thế lúc liên kết hơn là macro.

## Chọn cách nào

| | Lúc chạy | Lúc liên kết | Lúc biên dịch |
| --- | --- | --- | --- |
| Chi phí | một lời gọi gián tiếp | không | không |
| Nhiều bản cùng lúc | **có** | không | không (theo từng build) |
| Dễ đọc | tốt | **tốt nhất** | kém, trong C |
| Đổi mà không build lại | **có** | không | không |
| Tốn RAM | 8–16 B mỗi cái | 0 | 0 |

Mặc định: **lúc liên kết khi chỉ có một bản hiện thực, con trỏ hàm khi có nhiều bản.** Vậy là
phủ gần hết mọi trường hợp thực tế.

## Fake, mock, stub

Những từ hay bị dùng lẫn lộn mà lẽ ra không nên:

- **Stub** — trả về một giá trị đóng hộp. `fake_read` luôn cho 25 °C.
- **Fake** — một bản hiện thực đơn giản hoá nhưng chạy được. Một tệp thanh ghi trong bộ nhớ,
  như ở trên.
- **Mock** — ghi lại các lời gọi rồi kiểm chứng chúng. "`write` phải được gọi đúng một lần với
  `0x01`."
- **Spy** — một bản hiện thực thật, đồng thời ghi lại những gì đã xảy ra.

Với firmware, **fake thường là điểm ngọt**. Một thiết bị I²C giả với một mảng thanh ghi cho
phép bạn viết những bài test đọc rất tự nhiên, và nó không vỡ mỗi lần bạn tái cấu trúc trình
tự gọi bên trong — vốn là vấn đề kinh niên của mock.

Chỗ mà mock thật sự xứng đáng là khi kiểm chứng *thứ tự giao thức*: rằng bạn đã gửi lệnh mở
khoá trước khi ghi, hay đã kéo chip-select xuống trước khi đẩy xung nhịp. CMock (đi cùng
Ceedling) và FFF (Fake Function Framework) sinh chúng từ một header.

## Một module sát thực tế

Ghép tất cả lại, với các interface được gom trong một struct nhỏ:

```c
/* pump_ctl.h */
typedef struct {
    const i2c_if_t   *sensor_bus;
    const gpio_if_t  *pump_pin;
    const timer_if_t *clock;
    float             threshold_c;
} pump_ctl_t;

void pump_ctl_init(pump_ctl_t *p, const pump_cfg_t *cfg);
void pump_ctl_update(pump_ctl_t *p);      /* gọi định kỳ */
```

```c
/* main.c — composition root: nơi DUY NHẤT biết các kiểu thật */
int main(void)
{
    hal_init();

    static pump_ctl_t pump = {
        .sensor_bus  = &i2c1_if,
        .pump_pin    = &gpio_pb5_if,
        .clock       = &systick_if,
        .threshold_c = 80.0f,
    };

    for (;;) {
        pump_ctl_update(&pump);
        delay_ms(100);
    }
}
```

Ý tưởng "composition root" đó là nước cờ tổ chức then chốt: **đúng một file nối các bản hiện
thực thật lại với nhau**, còn mọi file khác chỉ làm việc với interface. Trong bản build để
test, một composition root khác sẽ nối các bản giả.

## Cho bộ test chạy được

Ceedling là con đường ít trở lực nhất với C:

```bash
gem install ceedling
ceedling new my_firmware
cd my_firmware
```

```
src/
  temp_monitor.c
  i2c_stm32.c
test/
  test_temp_monitor.c
  support/
    i2c_fake.c
```

```bash
ceedling test:all
ceedling gcov:all        # báo cáo độ phủ
```

Quy tắc giữ cho việc này bền lâu: **test biên dịch cho máy tính, không bao giờ cho chip đích.**
Khoảnh khắc một bài test cần tới trình biên dịch chéo là lúc ranh giới đã rò rỉ, và bạn nên
tìm hiểu vì sao.

## Tự kiểm tra

1. Vì sao `is_overheating()` ở phiên bản gốc không kiểm thử được, dù nó chỉ chứa một dòng logic?
2. Composition root là gì và một chương trình nên có bao nhiêu cái?
3. Khi nào thay thế lúc liên kết tốt hơn con trỏ hàm?
4. Vì sao fake thường sống sót qua tái cấu trúc tốt hơn mock?

## Bài tiếp theo

Bài 4: các pattern hành vi — observer, hàng đợi lệnh và strategy, cùng cách chúng tách bộ xử
lý ngắt khỏi phần logic phản ứng với nó.
