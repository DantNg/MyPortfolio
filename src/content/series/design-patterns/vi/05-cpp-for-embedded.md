---
lesson: 5
lang: vi
title: "C++ thêm được gì mà không tốn gì lúc chạy"
description: "RAII cho ngoại vi và khoá, template thay cho lời gọi ảo, truy cập thanh ghi và đơn vị an toàn kiểu — cùng những tính năng C++ thật sự nên tránh trên MCU."
duration: "15 phút"
tags: ["Design pattern", "C++", "Nhúng"]
---

## Tiền đề

C++ trên vi điều khiển mang tiếng xấu, và tiếng xấu đó có cơ sở thật — exception, RTTI,
`std::string` và iostream đúng là không nên có mặt trên con chip 64 kB. Nhưng tiếng xấu ấy lan
sang cả những tính năng **không tốn gì lúc chạy** và loại bỏ được cả lớp lỗi.

Bài này nói về đúng phần đó. Quy tắc xuyên suốt: nếu bạn không giải thích được một tính năng
biên dịch ra thành cái gì, đừng dùng nó trong firmware.

## RAII — lợi ích lớn nhất

Mọi tài nguyên bạn chiếm đều phải được nhả ở **mọi** nhánh thoát. Trong C, điều đó nghĩa là kỷ
luật:

```c
int read_sensor(void)
{
    if (xSemaphoreTake(i2c_mutex, 100) != pdTRUE) return -1;

    if (i2c_start() != 0)  { xSemaphoreGive(i2c_mutex); return -2; }
    if (i2c_write(0x90) != 0) { xSemaphoreGive(i2c_mutex); return -3; }
    if (i2c_read(&val) != 0)  { xSemaphoreGive(i2c_mutex); return -4; }

    xSemaphoreGive(i2c_mutex);
    return val;
}
```

Bốn lời gọi nhả khoá. Thêm một nhánh lỗi sau sáu tháng thì sẽ thành năm, hoặc thành bốn và
một cú deadlock.

Trong C++, destructor làm việc đó, vô điều kiện:

```cpp
class MutexLock {
public:
    explicit MutexLock(SemaphoreHandle_t m, TickType_t timeout = portMAX_DELAY)
        : mutex_(m), held_(xSemaphoreTake(m, timeout) == pdTRUE) {}

    ~MutexLock() { if (held_) xSemaphoreGive(mutex_); }

    bool held() const { return held_; }

    MutexLock(const MutexLock&)            = delete;   /* không cho sao chép */
    MutexLock& operator=(const MutexLock&) = delete;

private:
    SemaphoreHandle_t mutex_;
    bool              held_;
};

int read_sensor()
{
    MutexLock lock{i2c_mutex, pdMS_TO_TICKS(100)};
    if (!lock.held()) return -1;

    if (i2c_start() != 0)     return -2;      /* destructor nhả khoá */
    if (i2c_write(0x90) != 0) return -3;      /* destructor nhả khoá */
    if (i2c_read(&val) != 0)  return -4;      /* destructor nhả khoá */

    return val;                               /* destructor nhả khoá */
}
```

Mã máy sinh ra giống hệt bản C — trình biên dịch nội tuyến destructor vào từng nhánh return.
Bạn không trả thêm đồng nào mà loại bỏ được cả một lớp lỗi.

Hình dạng đó dùng được cho mọi thứ đi theo cặp:

```cpp
/* đoạn găng */
class CriticalSection {
public:
    CriticalSection()  { taskENTER_CRITICAL(); }
    ~CriticalSection() { taskEXIT_CRITICAL(); }
};

/* chip select */
class ChipSelect {
public:
    explicit ChipSelect(GpioPin p) : pin_(p) { pin_.clear(); }
    ~ChipSelect()                            { pin_.set(); }
private:
    GpioPin pin_;
};

void spi_transfer() {
    ChipSelect cs{flash_cs};       /* kéo xuống ở đây */
    spi_write(cmd);
    spi_read(buf, 4);
}                                  /* nhả lên ở đây, trên mọi nhánh */
```

Quên nhả chip-select là buổi gỡ lỗi kinh điển kéo dài nhiều ngày. RAII làm cho nó bất khả thi
về mặt cấu trúc.

## Template thay cho virtual

Bài 3 dùng con trỏ hàm, vốn tốn một lời gọi gián tiếp. Khi bản hiện thực đã biết lúc biên
dịch, template cho bạn đúng khả năng thay thế đó kèm **nội tuyến hoàn toàn**:

```cpp
/* "interface" ở đây là một khái niệm, không phải lớp cơ sở */
template <typename I2cBus>
class Tmp75 {
public:
    explicit Tmp75(I2cBus& bus, uint8_t addr = 0x90) : bus_(bus), addr_(addr) {}

    bool read_celsius(float& out) {
        uint8_t raw[2];
        if (!bus_.read(addr_, 0x00, raw, 2)) return false;
        out = static_cast<int16_t>((raw[0] << 8) | raw[1]) * 0.0625f;
        return true;
    }

private:
    I2cBus& bus_;
    uint8_t addr_;
};

/* firmware */
Stm32I2c i2c1{I2C1};
Tmp75<Stm32I2c> sensor{i2c1};

/* test — cùng một lớp, khác bus */
FakeI2c fake;
Tmp75<FakeI2c> sensor{fake};
```

Trình biên dịch sinh một bản `Tmp75` riêng cho từng kiểu bus và nội tuyến các lời gọi. Mã hợp
ngữ đúng bằng thứ bạn tự viết tay.

**Đánh đổi** là kích thước code: hai kiểu bus nghĩa là hai bản sao của lớp. Với ba cảm biến và
ba bus, lượng trùng lặp có thể lớn đến bất ngờ. Hãy xem file map thay vì phỏng đoán.

**Dùng virtual khi** bạn thật sự cần đa hình lúc chạy — một danh sách thiết bị khác loại được
duyệt lúc chạy. Một lời gọi ảo trên Cortex-M tốn xấp xỉ một con trỏ hàm, cộng 4 byte mỗi đối
tượng cho con trỏ vtable. Thường là chấp nhận được; chỉ cần biết bạn đang trả cái giá đó.

## Truy cập thanh ghi an toàn kiểu

Lỗi kinh điển mà cách này loại bỏ:

```c
/* cái nào là cái nào? Chẳng có gì ngăn bạn đảo chúng. */
void gpio_write(uint32_t port, uint32_t pin, uint32_t value);
gpio_write(5, GPIOB, 1);       /* biên dịch ngon lành, sai hoàn toàn */
```

Kiểu mạnh làm điều đó thành bất khả thi:

```cpp
enum class Port  : uint8_t { A, B, C, D };
enum class PinNo : uint8_t { P0, P1, P2, /* ... */ P15 };
enum class Level : uint8_t { Low, High };

class GpioPin {
public:
    constexpr GpioPin(Port p, PinNo n) : port_(p), pin_(n) {}

    void write(Level l) const;
    void set()   const { write(Level::High); }
    void clear() const { write(Level::Low);  }
    bool read()  const;

private:
    Port  port_;
    PinNo pin_;
};

constexpr GpioPin led{Port::B, PinNo::P5};
led.set();

/* gpio_write(5, Port::B, 1);  ← không biên dịch được */
```

`constexpr` nghĩa là `led` tồn tại hoàn toàn lúc biên dịch; đối tượng tốn 0 byte RAM và
`led.set()` biên dịch thành đúng một lệnh ghi.

Cùng ý tưởng đó ngăn việc nhầm đơn vị — thứ đã gây ra tai nạn thật:

```cpp
class Milliseconds {
public:
    constexpr explicit Milliseconds(uint32_t v) : v_(v) {}
    constexpr uint32_t count() const { return v_; }
private:
    uint32_t v_;
};

class Microseconds {
public:
    constexpr explicit Microseconds(uint32_t v) : v_(v) {}
    constexpr uint32_t count() const { return v_; }
private:
    uint32_t v_;
};

void delay(Milliseconds d);

delay(Milliseconds{100});     /* ổn */
/* delay(Microseconds{100});  ← không biên dịch được */
/* delay(100);                ← không biên dịch được, constructor là explicit */
```

Nếu bạn có C++11 trở lên, `std::chrono::milliseconds` cho bạn điều này miễn phí và chuyển đổi
đơn vị chính xác.

## constexpr — tính toán không tốn gì

```cpp
constexpr uint32_t baud_to_brr(uint32_t pclk, uint32_t baud) {
    return (pclk + baud / 2) / baud;
}

/* tính lúc biên dịch; nhị phân chứa con số, không chứa phép chia */
constexpr uint32_t brr = baud_to_brr(84'000'000, 115'200);
static_assert(brr > 0 && brr < 0xFFFF, "toc do baud khong dat duoc");
```

Cái `static_assert` đó mới là điểm mấu chốt: một cấu hình sai trở thành **lỗi build** thay vì
một cổng UART lặng lẽ nhả ra rác. Bảng tra cũng hoạt động y hệt — trình biên dịch tính sẵn,
lưu vào flash, không tốn gì lúc khởi động.

## Nên tránh gì, và vì sao

| Tính năng | Kết luận | Lý do |
| --- | --- | --- |
| **Exception** | tránh | 10–50 kB bảng unwind, độ trễ throw không chặn trên được. Dùng `-fno-exceptions`. |
| **RTTI** / `dynamic_cast` | tránh | bảng thông tin kiểu nằm trong flash. Dùng `-fno-rtti`. |
| `std::string` | tránh | cấp phát heap ở gần như mọi thao tác |
| `std::vector` | thường nên tránh | nở ra bằng heap; dùng `etl::vector` hoặc mảng cố định |
| `iostream` | **luôn tránh** | hàng chục kB, và thực sự chậm |
| `new` / `delete` | tránh sau khi khởi động | phân mảnh; dùng placement new vào một bể |
| Hàm ảo | ổn, nếu có chủ đích | một lời gọi gián tiếp + 4 B mỗi đối tượng |
| Template | ổn | không tốn gì lúc chạy; chú ý kích thước code |
| `constexpr` | **dùng thoải mái** | dời việc sang lúc build |
| RAII | **dùng ở mọi nơi** | không tốn gì, loại bỏ cả lớp lỗi |
| `std::array` | **dùng thoải mái** | không tốn gì so với mảng C, lại có `size()` và kiểm biên |
| `std::optional` | ổn | một giá trị kèm một bool; rõ hơn giá trị canh chừng |
| `std::span` | **dùng thoải mái** | con trỏ + độ dài, diệt cả lớp lỗi buffer |

Các cờ điển hình cho một bản build C++ nhúng:

```makefile
CXXFLAGS += -std=c++17 -fno-exceptions -fno-rtti -fno-threadsafe-statics
CXXFLAGS += -fno-use-cxa-atexit -Os -ffunction-sections -fdata-sections
LDFLAGS  += -Wl,--gc-sections
```

`-fno-threadsafe-statics` rất quan trọng: không có nó, mỗi biến static cục bộ trong hàm đều
kèm một biến canh và một phép kiểm tra nguyên tử. Trên MCU một nhân, nơi bạn kiểm soát thứ tự
khởi tạo, đó là chi phí thuần tuý thừa.

**Embedded Template Library (ETL)** rất đáng biết: `etl::vector`, `etl::map`, `etl::string`
với giao diện giống STL nhưng **sức chứa cố định, không dùng heap**. Đó là cách thực dụng để
có sự tiện lợi của container trên MCU.

## Một ví dụ hoàn chỉnh

Một driver dùng tất cả những thứ trên, không tốn thêm gì so với bản C:

```cpp
#include <array>
#include <optional>
#include <span>

template <typename SpiBus>
class W25Q {
public:
    W25Q(SpiBus& spi, GpioPin cs) : spi_(spi), cs_(cs) {}

    std::optional<uint32_t> read_id() {
        ChipSelect guard{cs_};                       /* RAII */
        std::array<uint8_t, 4> tx{0x9F, 0, 0, 0};
        std::array<uint8_t, 4> rx{};

        if (!spi_.transfer(tx, rx)) return std::nullopt;
        return (rx[1] << 16) | (rx[2] << 8) | rx[3];
    }

    bool read(uint32_t addr, std::span<uint8_t> out) {
        if (addr + out.size() > kCapacity) return false;   /* kiểm biên được */

        ChipSelect guard{cs_};
        std::array<uint8_t, 4> cmd{
            0x03,
            static_cast<uint8_t>(addr >> 16),
            static_cast<uint8_t>(addr >> 8),
            static_cast<uint8_t>(addr),
        };
        return spi_.write(cmd) && spi_.read(out);
    }

private:
    static constexpr uint32_t kCapacity = 16u * 1024u * 1024u;
    SpiBus& spi_;
    GpioPin cs_;
};
```

`std::span` mang độ dài đi cùng con trỏ, nên `read()` kiểm được biên — điều mà bản C nhận
`uint8_t*` và `size_t` rời nhau về mặt cấu trúc không làm tin cậy được.

`std::optional<uint32_t>` biến "không đọc được ID" thành một giá trị riêng biệt, thay vì một
con `0xFFFFFFFF` ma thuật mà cũng tình cờ là một ID hợp lệ.

## Chuyển đổi dần dần

Bạn không cần viết lại gì cả. C++ biên dịch được phần lớn code C:

1. **Đổi tên một file `.c` thành `.cpp`** và sửa những gì trình biên dịch khắt khe hơn kêu ca.
   Phần lớn thứ nó chỉ ra đều là lỗi tiềm ẩn — đặc biệt là chuyển kiểu `void*` ngầm.
2. **Bọc các cặp tài nguyên trước.** Mutex, đoạn găng, chip select. Giá trị cao nhất, rủi ro
   thấp nhất.
3. **Thêm kiểu mạnh ở ranh giới interface.** Port, pin, đơn vị.
4. **Dùng `constexpr`** cho mọi thứ hiện đang tính lúc khởi động.
5. **Phần còn lại cứ để là C.** `extern "C"` giữ cho mọi thứ liên kết được.

```cpp
extern "C" {
#include "legacy_driver.h"
}

extern "C" void TIM2_IRQHandler(void) {    /* ISR cần liên kết kiểu C */
    /* ... */
}
```

HAL của hãng chip là C, và điều đó vĩnh viễn không sao cả.

## Tự kiểm tra

1. Trình biên dịch sinh ra gì cho destructor của `MutexLock`, và nó tốn bao nhiêu?
2. Khi nào lời gọi ảo là lựa chọn đúng hơn template?
3. `-fno-threadsafe-statics` loại bỏ điều gì, và vì sao trên MCU thì làm vậy an toàn?
4. Vì sao `std::span` ngăn được lớp lỗi mà `uint8_t* + size_t` không ngăn nổi?

## Bài tiếp theo

Bài cuối: kiểm thử firmware, những anti-pattern khiến việc đó bất khả thi, và một danh sách
kiểm tra khi review cấu trúc.
