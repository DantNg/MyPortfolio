---
lesson: 1
lang: en
title: "Why Firmware Needs Structure — SOLID, Translated"
description: "What actually goes wrong as firmware grows, the five SOLID principles rewritten for constrained targets, and the layering rule that makes the rest of the series work."
duration: "13 min"
tags: ["Design patterns", "SOLID", "Architecture"]
---

## The file that ate the project

Every firmware engineer has met it: `main.c`, 4,000 lines, thirty globals, a `while(1)` with
a comment that says `// TODO: refactor`. It works. Nobody wants to touch it.

It got that way through a sequence of individually reasonable decisions. The problem is not
the code that exists — it is what the code makes impossible:

- **You cannot unit-test it**, because every function reaches straight into `HAL_I2C_Read()`.
- **You cannot port it**, because vendor headers are included from the top of the call graph
  to the bottom.
- **You cannot change it safely**, because everything shares state through globals and you
  cannot tell what a change touches.
- **You cannot work in parallel**, because two people editing that file means merge conflicts
  every day.

Patterns are not about elegance. They are about keeping those four things possible past a
certain size.

## When structure is worth the cost

Be honest about the trade-off. A pattern costs indirection, and indirection costs cycles,
flash and readability. A 500-line blinker does not need dependency injection.

Rough thresholds where the investment starts paying:

| Situation | Worth structuring? |
| --- | --- |
| < 1,000 lines, one developer, one board | No. Write it directly. |
| Multiple boards or chip variants | Yes — a HAL boundary |
| Anyone wants unit tests | Yes — interfaces |
| More than two developers | Yes — module boundaries |
| The product line will have variants | Yes — most of this series |
| Safety-relevant | Yes, and it is mandated anyway |

The rest of this lesson assumes you have crossed at least one of those lines.

## SOLID, translated to firmware

SOLID was written for enterprise object-oriented code. Every principle has a firmware
translation that is genuinely useful, and a naive reading that is not.

### S — Single Responsibility

*A module should have one reason to change.*

In firmware, the sharpest test is: **does this file mix policy with mechanism?**

```c
/* BAD — mixes the sensor protocol with the business rule with the output */
void check_temperature(void) {
    uint8_t raw[2];
    HAL_I2C_Mem_Read(&hi2c1, 0x90, 0x00, 1, raw, 2, 100);   /* mechanism */
    float t = (raw[0] << 8 | raw[1]) * 0.0625f;             /* mechanism */
    if (t > 80.0f) {                                        /* policy    */
        HAL_GPIO_WritePin(FAN_PORT, FAN_PIN, GPIO_PIN_SET); /* mechanism */
        log_printf("overheat %f", t);                       /* mechanism */
    }
}
```

Three responsibilities in nine lines. Split them:

```c
/* tmp75.c     — knows the sensor, nothing else */
int  tmp75_read_celsius(const i2c_if_t *bus, float *out);

/* thermal.c   — knows the policy, no hardware at all */
thermal_action_t thermal_evaluate(float celsius, const thermal_cfg_t *cfg);

/* fan.c       — knows the actuator */
void fan_set(bool on);
```

Now `thermal_evaluate()` is a pure function you can test with a table of inputs, and the
policy — the part most likely to change when marketing revises the spec — is in a file with
no `#include` of a vendor header.

### O — Open/Closed

*Open for extension, closed for modification.*

The firmware version: **adding a new device should not mean editing a `switch`.**

```c
/* BAD — every new sensor edits this function */
float read_sensor(sensor_type_t type) {
    switch (type) {
    case SENSOR_TMP75:  return tmp75_read();
    case SENSOR_DS18B20: return ds18b20_read();
    case SENSOR_BME280: return bme280_read();   /* ← edited again */
    }
}

/* GOOD — a new sensor adds a file and a table row */
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

Do not overdo this. If you have exactly two variants and there will never be a third, the
`switch` is clearer.

### L — Liskov Substitution

*An implementation must honour the contract of its interface.*

This is the one people ignore in C and then get burned by. If your `i2c_if_t` says `read()`
returns 0 on success and blocks up to a timeout, then **every** implementation must do that.
An implementation that returns 1 on success, or that blocks forever, breaks callers that were
written against the contract.

Write the contract in the header, in words, next to the function pointer. It costs three
comment lines and prevents the entire class of "it works with the STM32 driver but not the
simulated one".

### I — Interface Segregation

*Do not force a client to depend on functions it does not use.*

```c
/* BAD — a temperature logger must implement all twelve */
typedef struct {
    int (*init)(void); int (*read)(void); int (*write)(void);
    int (*erase)(void); int (*sleep)(void); int (*calibrate)(void);
    /* ... */
} device_if_t;

/* GOOD — small, focused interfaces */
typedef struct { int (*read)(void *ctx, float *out); void *ctx; } readable_if_t;
typedef struct { int (*write)(void *ctx, const void *d, size_t n); void *ctx; } writable_if_t;
```

Small interfaces are also cheaper: a struct of two pointers is 8 bytes, one of twelve is 48,
and on an MCU that difference is real.

### D — Dependency Inversion

*High-level modules should not depend on low-level ones; both depend on abstractions.*

This is the important one, and lesson 3 is entirely about it. In firmware it means: **your
application logic includes an interface header, not `stm32f4xx_hal.h`.**

## The layering rule

![Firmware layering](/MyPortfolio/images/patterns/layering.svg)

Everything above collapses into one rule you can actually enforce:

> **Dependencies point downward, never upward or sideways across a layer boundary.**

| Layer | Contains | Knows about hardware? | Testable? |
| --- | --- | --- | --- |
| Application | policy, state machines, algorithms | **no** | trivially |
| Device / Service | sensors, storage, protocols | via interfaces only | with fakes |
| HAL / Port | interface definitions + per-chip implementations | yes | on hardware |
| Hardware | registers | — | — |

The check that takes five seconds and finds most violations:

```bash
grep -rn "stm32\|esp_\|nrf_\|HAL_" src/app/
```

Any hit is a layer leak. Put it in CI and the architecture stops eroding, which it otherwise
will, quietly, over eighteen months.

## Two practical patterns to start with today

### Opaque pointers — real encapsulation in C

```c
/* sensor.h — the caller cannot see inside */
typedef struct sensor sensor_t;

sensor_t *sensor_create(const i2c_if_t *bus, uint8_t addr);
int       sensor_read(sensor_t *s, float *out);
void      sensor_destroy(sensor_t *s);
```

```c
/* sensor.c — the only place that knows the layout */
struct sensor {
    const i2c_if_t *bus;
    uint8_t addr;
    float   last;
    uint32_t error_count;
};
```

Callers physically cannot reach `s->error_count`, so you can restructure it freely. This is
`private` in C, it costs nothing at runtime, and it is the single highest-value habit in this
lesson.

For a static-allocation project where `malloc` is banned, use a fixed pool:

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

### Return values instead of globals

```c
/* BAD */
extern int last_error;
void do_thing(void);          /* check last_error afterwards, maybe */

/* GOOD */
typedef enum { OK = 0, ERR_TIMEOUT, ERR_CRC, ERR_BUSY } status_t;
status_t do_thing(void);
```

An enum return value is greppable, forces the caller to decide, and works with
`__attribute__((warn_unused_result))` so the compiler nags when someone ignores it.

## Check yourself

1. Which of the four things a monolithic file makes impossible matters most to your current
   project?
2. What is the single-line grep that detects a layering violation?
3. Why does an opaque pointer cost nothing at runtime?
4. When is a `switch` over device types the *right* answer?

## Next

Lesson 2: state machines. The pattern firmware uses more than any other, done four ways, with
the trade-offs and the code for each.
