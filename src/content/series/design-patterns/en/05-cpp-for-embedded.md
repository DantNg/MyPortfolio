---
lesson: 5
lang: en
title: "What C++ Adds at Zero Runtime Cost"
description: "RAII for peripherals and locks, templates instead of virtual calls, type-safe register access and units — plus the C++ features you should genuinely avoid on an MCU."
duration: "15 min"
tags: ["Design patterns", "C++", "Embedded"]
---

## The premise

C++ on microcontrollers has a bad reputation earned by real problems — exceptions, RTTI,
`std::string`, and iostreams genuinely do not belong on a 64 kB part. But the reputation
extends unfairly to features that cost **nothing at runtime** and remove entire classes of
bug.

This lesson is about that subset. The rule throughout: if you cannot explain what a feature
compiles to, do not use it in firmware.

## RAII — the single biggest win

Every resource you acquire must be released on **every** exit path. In C that means
discipline:

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

Four release calls. Add an error path in six months and there will be five, or four and a
deadlock.

In C++ the destructor does it, unconditionally:

```cpp
class MutexLock {
public:
    explicit MutexLock(SemaphoreHandle_t m, TickType_t timeout = portMAX_DELAY)
        : mutex_(m), held_(xSemaphoreTake(m, timeout) == pdTRUE) {}

    ~MutexLock() { if (held_) xSemaphoreGive(mutex_); }

    bool held() const { return held_; }

    MutexLock(const MutexLock&)            = delete;   /* not copyable */
    MutexLock& operator=(const MutexLock&) = delete;

private:
    SemaphoreHandle_t mutex_;
    bool              held_;
};

int read_sensor()
{
    MutexLock lock{i2c_mutex, pdMS_TO_TICKS(100)};
    if (!lock.held()) return -1;

    if (i2c_start() != 0)     return -2;      /* destructor releases */
    if (i2c_write(0x90) != 0) return -3;      /* destructor releases */
    if (i2c_read(&val) != 0)  return -4;      /* destructor releases */

    return val;                               /* destructor releases */
}
```

The generated code is identical to the C version — the compiler inlines the destructor into
each return path. You paid nothing and removed a bug class.

The same shape works for anything paired:

```cpp
/* critical section */
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
    ChipSelect cs{flash_cs};       /* asserted here */
    spi_write(cmd);
    spi_read(buf, 4);
}                                  /* deasserted here, on every path */
```

A forgotten chip-select release is a classic multi-day debugging session. RAII makes it
structurally impossible.

## Templates instead of virtual

Lesson 3 used function pointers, which cost an indirect call. When the implementation is known
at compile time, a template gives you the same substitution with **full inlining**:

```cpp
/* the "interface" is a concept, not a base class */
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

/* test — same class, different bus */
FakeI2c fake;
Tmp75<FakeI2c> sensor{fake};
```

The compiler generates a separate `Tmp75` for each bus type and inlines the calls. The
disassembly is what you would have written by hand.

**The trade-off** is code size: two bus types means two copies of the class. With three
sensors and three buses you can get a surprising amount of duplication. Check the map file
rather than assuming.

**Use virtual when** you genuinely need runtime polymorphism — a list of heterogeneous devices
iterated at runtime. A virtual call on Cortex-M costs about the same as a function pointer,
plus 4 bytes per object for the vtable pointer. That is often fine; just know you are paying
it.

## Type-safe register access

The classic bug this eliminates:

```c
/* which is which? Nothing stops you swapping them. */
void gpio_write(uint32_t port, uint32_t pin, uint32_t value);
gpio_write(5, GPIOB, 1);       /* compiles fine, completely wrong */
```

Strong types make it impossible:

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

/* gpio_write(5, Port::B, 1);  ← does not compile */
```

`constexpr` means `led` exists entirely at compile time; the object costs zero bytes of RAM
and `led.set()` compiles to a single store.

The same idea prevents unit mixups, which cause real accidents:

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

delay(Milliseconds{100});     /* fine */
/* delay(Microseconds{100});  ← does not compile */
/* delay(100);                ← does not compile, explicit constructor */
```

If you have C++11 or later, `std::chrono::milliseconds` gives you this for free and converts
between units correctly.

## constexpr — computation that costs nothing

```cpp
constexpr uint32_t baud_to_brr(uint32_t pclk, uint32_t baud) {
    return (pclk + baud / 2) / baud;
}

/* computed at compile time; the binary contains the number, not the division */
constexpr uint32_t brr = baud_to_brr(84'000'000, 115'200);
static_assert(brr > 0 && brr < 0xFFFF, "baud rate not achievable");
```

That `static_assert` is the point: a misconfiguration becomes a **build error** rather than a
UART that silently produces garbage. Lookup tables work the same way — computed by the
compiler, stored in flash, costing nothing at startup.

## What to avoid, and why

| Feature | Verdict | Reason |
| --- | --- | --- |
| **Exceptions** | avoid | 10–50 kB of unwind tables, unbounded throw latency. `-fno-exceptions`. |
| **RTTI** / `dynamic_cast` | avoid | type info tables in flash. `-fno-rtti`. |
| `std::string` | avoid | heap allocation on almost every operation |
| `std::vector` | usually avoid | grows via heap; use `etl::vector` or a fixed array |
| `iostream` | **always avoid** | tens of kB, and it is genuinely slow |
| `new` / `delete` | avoid after init | fragmentation; use placement new into a pool |
| Virtual functions | fine, deliberately | one indirect call + 4 B/object |
| Templates | fine | zero runtime cost; watch code size |
| `constexpr` | **use freely** | moves work to build time |
| RAII | **use everywhere** | zero cost, removes a bug class |
| `std::array` | **use freely** | zero overhead over a C array, with bounds and `size()` |
| `std::optional` | fine | a value plus a bool; clearer than sentinel returns |
| `std::span` | **use freely** | pointer + length, kills a whole class of buffer bugs |

Typical flags for an embedded C++ build:

```makefile
CXXFLAGS += -std=c++17 -fno-exceptions -fno-rtti -fno-threadsafe-statics
CXXFLAGS += -fno-use-cxa-atexit -Os -ffunction-sections -fdata-sections
LDFLAGS  += -Wl,--gc-sections
```

`-fno-threadsafe-statics` matters: without it, every function-local static gets a guard
variable and an atomic check. On a single-core MCU where you control initialization order,
that is pure overhead.

**Embedded Template Library (ETL)** is worth knowing: `etl::vector`, `etl::map`,
`etl::string` with the STL interface and **fixed capacity, no heap**. It is the practical way
to get container ergonomics on an MCU.

## A complete example

A driver that uses everything above, with no runtime cost over the C version:

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
        if (addr + out.size() > kCapacity) return false;   /* bounds are checkable */

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

`std::span` carries the length with the pointer, so `read()` can check bounds — which the C
version, taking `uint8_t*` and `size_t` separately, structurally cannot do reliably.

`std::optional<uint32_t>` makes "no ID could be read" a distinct value rather than a magic
`0xFFFFFFFF` that also happens to be a legal ID.

## Migrating incrementally

You do not need to rewrite anything. C++ compiles most C:

1. **Rename one `.c` to `.cpp`** and fix what the stricter compiler complains about. Most of
   what it flags is a latent bug — implicit `void*` conversions especially.
2. **Wrap the resource pairs first.** Mutex, critical section, chip select. Highest value,
   lowest risk.
3. **Add strong types at interface boundaries.** Ports, pins, units.
4. **Use `constexpr`** for anything currently computed at startup.
5. **Leave the rest as C.** `extern "C"` keeps everything linking.

```cpp
extern "C" {
#include "legacy_driver.h"
}

extern "C" void TIM2_IRQHandler(void) {    /* ISRs need C linkage */
    /* ... */
}
```

Vendor HALs are C, and that is fine forever.

## Check yourself

1. What does the compiler generate for a `MutexLock` destructor, and what does it cost?
2. When is a virtual call the right choice over a template?
3. What does `-fno-threadsafe-statics` remove, and why is that safe on an MCU?
4. Why does `std::span` prevent a class of bug that `uint8_t* + size_t` cannot?

## Next

The final lesson: testing firmware, the anti-patterns that make it impossible, and a checklist
for reviewing structure.
