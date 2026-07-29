---
lesson: 3
lang: en
title: "Interfaces and Dependency Injection in Plain C"
description: "How to test code that talks to hardware, without the hardware: function-pointer interfaces, link-time and compile-time substitution, and when each is the right tool."
duration: "15 min"
tags: ["Design patterns", "Testing", "HAL"]
---

## The problem, precisely

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

`is_overheating()` contains one line of logic and is untestable. To exercise it you need an
STM32, an I²C sensor, and a way to make that sensor read 81 °C — which realistically means a
heat gun and a technician.

The dependency points the wrong way: high-level policy depends on a low-level driver.

## The fix — invert it

![Interfaces in C](/MyPortfolio/images/patterns/interfaces-c.svg)

Define what you *need* rather than using what *exists*:

```c
/* i2c_if.h — a contract. No vendor header anywhere in this file. */
#ifndef I2C_IF_H
#define I2C_IF_H

#include <stdint.h>
#include <stddef.h>

typedef struct {
    /* Read `len` bytes from `reg` of device `addr`.
     * Returns 0 on success, negative on error.
     * Blocks up to an implementation-defined timeout. Never blocks forever. */
    int (*read)(void *ctx, uint8_t addr, uint8_t reg, uint8_t *buf, size_t len);

    /* Write `len` bytes to `reg` of device `addr`. Same return convention. */
    int (*write)(void *ctx, uint8_t addr, uint8_t reg, const uint8_t *buf, size_t len);

    void *ctx;      /* implementation state — the caller never inspects it */
} i2c_if_t;

#endif
```

Note the comments. That is the Liskov contract from lesson 1, written down where every
implementer will see it.

The logic now takes the interface as a parameter:

```c
/* temp_monitor.c — no vendor headers */
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
    if (temp_read_celsius(bus, &t) != 0) return true;   /* fail safe */
    return t > 80.0f;
}
```

The real implementation:

```c
/* i2c_stm32.c — the only file that includes the vendor header */
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

And the fake, for tests:

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

/* helpers the tests use */
void fake_set_temp(float c) {
    int16_t raw = (int16_t)(c / 0.0625f);
    fake.regs[0x00] = raw >> 8;
    fake.regs[0x01] = raw & 0xFF;
}
void fake_set_error(int on) { fake.force_error = on; }
```

Now the test, running on your laptop in milliseconds:

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
    TEST_ASSERT_TRUE(is_overheating(&i2c_fake_if));   /* error → assume hot */
}
```

That third test is the one you could never write before, and it covers the case most likely
to matter in the field.

## Three ways to substitute

Function-pointer interfaces are one option. There are three, and each has a place.

### 1. Runtime — function pointers

What we just did. The implementation is chosen while the program runs.

**Cost:** an indirect call (2–4 cycles on Cortex-M) and 8–16 bytes per interface instance.

**Use when** you need several implementations *simultaneously* — three I²C buses, two sensor
types, or a mock alongside the real thing.

### 2. Link time — same symbol, different object file

```c
/* i2c.h — plain functions, no struct */
int i2c_read(uint8_t addr, uint8_t reg, uint8_t *buf, size_t len);
```

Then compile `i2c_stm32.c` into the firmware and `i2c_fake.c` into the test binary. The
linker resolves the same symbol differently.

```makefile
firmware: main.o temp_monitor.o i2c_stm32.o
	$(CC) -o $@ $^

test_temp: test_temp.o temp_monitor.o i2c_fake.o
	$(HOSTCC) -o $@ $^
```

**Cost:** zero. It is a direct call.

**Use when** there is exactly one implementation per build. This is the cheapest option and
is often overlooked because it is not fashionable — but for a project with one target chip
it is the right answer.

### 3. Compile time — templates or macros

In C++, a template gives you zero-overhead substitution with full inlining (lesson 5). In C,
the macro equivalent works but hurts readability:

```c
#ifdef UNIT_TEST
  #define I2C_READ(a, r, b, l)  fake_i2c_read(a, r, b, l)
#else
  #define I2C_READ(a, r, b, l)  HAL_I2C_Mem_Read(&hi2c1, a, r, 1, b, l, 100)
#endif
```

**Cost:** zero at runtime, but `#ifdef` in application code is a smell — it means two
versions of the logic, and the test build stops resembling the shipping build.

**Use sparingly**, and prefer link-time substitution to macros in C.

## Choosing

| | Runtime | Link time | Compile time |
| --- | --- | --- | --- |
| Overhead | one indirect call | none | none |
| Multiple impls at once | **yes** | no | no (per build) |
| Readability | good | **best** | poor in C |
| Swap without rebuild | **yes** | no | no |
| RAM cost | 8–16 B each | 0 | 0 |

Default: **link-time when there is one implementation, function pointers when there are
several.** That covers almost every real case.

## Fakes, mocks, stubs

Words that get used interchangeably and should not be:

- **Stub** — returns a canned value. `fake_read` always gives 25 °C.
- **Fake** — a working simplified implementation. An in-memory register file, like above.
- **Mock** — records calls and asserts on them. "`write` must be called once with `0x01`."
- **Spy** — a real implementation that also records what happened.

For firmware, **fakes are usually the sweet spot**. A fake I²C device with a register array
lets you write tests that read naturally, and it does not break every time you refactor an
internal call sequence — which is the chronic problem with mocks.

Where mocks genuinely earn their place is verifying *protocol order*: that you sent the
unlock command before the write, or that you asserted chip-select before clocking data.
CMock (with Ceedling) and FFF (Fake Function Framework) generate them from a header.

## A realistic module

Wiring it all together, with the interfaces held in a small struct:

```c
/* pump_ctl.h */
typedef struct {
    const i2c_if_t   *sensor_bus;
    const gpio_if_t  *pump_pin;
    const timer_if_t *clock;
    float             threshold_c;
} pump_ctl_t;

void pump_ctl_init(pump_ctl_t *p, const pump_cfg_t *cfg);
void pump_ctl_update(pump_ctl_t *p);      /* call periodically */
```

```c
/* main.c — the composition root: the ONE place that knows real types */
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

That "composition root" idea is the key organizational move: **exactly one file wires the
real implementations together**, and every other file works against interfaces. In the test
binary, a different composition root wires the fakes.

## Getting tests running

Ceedling is the path of least resistance for C:

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
ceedling gcov:all        # coverage report
```

The rule that keeps this working long-term: **tests compile for the host, never for the
target.** The moment a test needs the cross-compiler, the boundary has leaked and you should
find out why.

## Check yourself

1. Why is `is_overheating()` untestable in the original version, when it contains one line of
   logic?
2. What is a composition root and how many should a program have?
3. When is link-time substitution better than function pointers?
4. Why do fakes tend to survive refactoring better than mocks?

## Next

Lesson 4: behavioral patterns — observer, command queues and strategy, and how they decouple
interrupt handlers from the logic that reacts to them.
