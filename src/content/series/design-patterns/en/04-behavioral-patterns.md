---
lesson: 4
lang: en
title: "Behavioral Patterns — Observer, Command, Strategy"
description: "Decoupling who produces an event from who reacts to it: publish/subscribe in C, command queues that eliminate locking, and strategy for swappable algorithms."
duration: "14 min"
tags: ["Design patterns", "Observer", "Command"]
---

## The coupling problem

```c
void temperature_updated(float t)
{
    display_show_temp(t);
    logger_write(t);
    if (t > 80.0f) alarm_trigger();
    cloud_publish(t);            /* ← added last sprint  */
    hvac_notify(t);              /* ← added this sprint  */
}
```

The sensor module now depends on the display, the logger, the alarm, the network and the
HVAC. It cannot be unit-tested without all five, cannot be reused in a product that has no
display, and every new consumer edits this file.

The three patterns in this lesson all attack that one problem from different angles.

![Observer and command queue](/MyPortfolio/images/patterns/observer-command.svg)

## Observer — publish/subscribe

Invert the direction: consumers register themselves, and the producer knows nothing about
them.

```c
/* temp_pub.h */
typedef void (*temp_observer_fn)(float celsius, void *ctx);

int  temp_subscribe(temp_observer_fn cb, void *ctx);   /* 0 = ok, -1 = full */
void temp_unsubscribe(temp_observer_fn cb);
void temp_publish(float celsius);                      /* called by the sensor module */
```

```c
/* temp_pub.c — a fixed array, no malloc */
#define MAX_OBSERVERS 8

typedef struct { temp_observer_fn fn; void *ctx; } observer_t;

static observer_t observers[MAX_OBSERVERS];
static uint8_t    count;

int temp_subscribe(temp_observer_fn cb, void *ctx)
{
    if (count >= MAX_OBSERVERS) return -1;
    observers[count++] = (observer_t){ .fn = cb, .ctx = ctx };
    return 0;
}

void temp_publish(float celsius)
{
    for (uint8_t i = 0; i < count; i++) {
        observers[i].fn(celsius, observers[i].ctx);
    }
}
```

Consumers wire themselves up at startup:

```c
static void on_temp_display(float c, void *ctx) { display_show_temp(c); }
static void on_temp_alarm(float c, void *ctx)   { if (c > 80.0f) alarm_trigger(); }

void app_init(void)
{
    temp_subscribe(on_temp_display, NULL);
    temp_subscribe(on_temp_alarm,   NULL);
    /* adding a cloud publisher touches only this file */
}
```

The sensor module now has zero knowledge of its consumers, and the test for it is a single
observer that records what it received.

**Three things to get right:**

**1. Observers must be fast.** They run in the publisher's context — which may be an ISR.
A slow observer delays every other observer and the publisher. If work is slow, the observer
should post to a queue, not do the work.

**2. Never modify the observer list while publishing.** An observer that calls
`temp_unsubscribe()` from inside its own callback corrupts the iteration. Either forbid it
(document and assert) or defer the change:

```c
void temp_unsubscribe(temp_observer_fn cb)
{
    for (uint8_t i = 0; i < count; i++) {
        if (observers[i].fn == cb) {
            observers[i].fn = NULL;      /* mark; compact after the publish loop */
            pending_compact = true;
            return;
        }
    }
}
```

**3. Bound the array, and check the return value.** A silent `subscribe` failure at startup
produces a feature that simply never works, and it is very hard to find.

## Command — turning actions into data

Instead of calling a function, build a small struct describing what should happen, and put it
in a queue. One consumer executes them all.

```c
typedef enum {
    CMD_SET_TEMP,
    CMD_START_PUMP,
    CMD_STOP_PUMP,
    CMD_CALIBRATE,
    CMD_SAVE_CONFIG,
} cmd_id_t;

typedef struct {
    cmd_id_t id;
    int32_t  arg;
    uint32_t timestamp_ms;
} cmd_t;                        /* plain data — copies cleanly through a queue */
```

Producers, including interrupt handlers, just post:

```c
void BUTTON_IRQHandler(void)
{
    cmd_t c = { .id = CMD_START_PUMP, .timestamp_ms = now_ms() };
    BaseType_t woken = pdFALSE;
    xQueueSendFromISR(cmd_q, &c, &woken);
    portYIELD_FROM_ISR(woken);
}
```

One consumer executes:

```c
static void cmd_task(void *arg)
{
    cmd_t c;
    for (;;) {
        xQueueReceive(cmd_q, &c, portMAX_DELAY);

        switch (c.id) {
        case CMD_SET_TEMP:    setpoint = c.arg;      break;
        case CMD_START_PUMP:  pump_set(true);        break;
        case CMD_STOP_PUMP:   pump_set(false);       break;
        case CMD_SAVE_CONFIG: config_write_flash();  break;   /* 20 ms, fine here */
        }
    }
}
```

What this bought you, and it is a lot:

- **No locking.** One task owns the state, so there is nothing to protect.
- **ISRs stay tiny.** They post four bytes and return.
- **Commands are inspectable.** Log them, replay them, or feed them from a serial console —
  a `cmd_t` from a UART command parser is indistinguishable from one from a button.
- **Undo and retry become possible**, because the action is a value you kept.

This pattern pairs naturally with the state machine from lesson 2: commands go in, the
machine transitions, effects come out.

## Strategy — swappable algorithms

When the same operation has several implementations selected at configuration time:

```c
typedef struct {
    const char *name;
    float (*compute)(void *ctx, float setpoint, float measured, float dt);
    void  (*reset)(void *ctx);
    void  *ctx;
} controller_if_t;

/* two strategies, same shape */
extern const controller_if_t pid_controller;
extern const controller_if_t bangbang_controller;
```

```c
/* the caller does not care which */
static const controller_if_t *ctrl = &pid_controller;

void control_loop(void)
{
    float out = ctrl->compute(ctrl->ctx, setpoint, measured, 0.01f);
    actuator_set(out);
}

/* switching is one assignment */
void set_control_mode(mode_t m)
{
    ctrl->reset(ctrl->ctx);
    ctrl = (m == MODE_SIMPLE) ? &bangbang_controller : &pid_controller;
}
```

This is the same mechanism as lesson 3's interfaces, applied to *algorithms* rather than
*hardware*. It shows up whenever a product line has a cheap variant and an expensive one, or
when you need to A/B two filters against the same recorded data.

Do not reach for it with only one implementation. A `controller_if_t` with a single member is
indirection with no benefit.

## Combining them: a small architecture

The three compose into a shape that scales well:

```
ISR / timer / UART parser
        │  post cmd_t
        ▼
   command queue
        │
        ▼
   command task ──► state machine ──► effects (via interfaces)
        │
        └──► publish events ──► observers (display, log, cloud)
```

Every arrow is one-directional, and every box is independently testable:

- The **state machine** is a pure function (lesson 2).
- The **effects** go through interfaces (lesson 3).
- The **observers** are registered, not hardcoded.
- The **queue** removes concurrency from the picture.

A concrete version:

```c
static void app_task(void *arg)
{
    cmd_t c;
    for (;;) {
        if (xQueueReceive(cmd_q, &c, pdMS_TO_TICKS(100)) == pdPASS) {
            step_result_t r = machine_step(state, cmd_to_event(&c));
            apply_action(r.action);            /* through interfaces */
            if (r.next != state) {
                trace(state, c.id, r.next);
                state = r.next;
                state_publish(state);          /* observers react */
            }
        } else {
            step_result_t r = machine_step(state, EV_TICK);
            /* ... same handling ... */
        }
    }
}
```

Around 20 lines, and it is the backbone of a maintainable firmware application.

## Two more, briefly

**Chain of responsibility** — for layered protocol handling, where each handler either
consumes a frame or passes it on:

```c
typedef bool (*frame_handler_fn)(const frame_t *f);   /* true = consumed */

static const frame_handler_fn chain[] = {
    handle_diagnostic,      /* tries first  */
    handle_control,
    handle_telemetry,
};

void frame_received(const frame_t *f)
{
    for (size_t i = 0; i < ARRAY_SIZE(chain); i++) {
        if (chain[i](f)) return;
    }
    stats.unhandled_frames++;
}
```

**Template method** — a fixed sequence with variable steps, useful for device drivers that
share a startup shape:

```c
typedef struct {
    int (*power_on)(void);
    int (*probe)(void);         /* varies per device */
    int (*configure)(void);     /* varies per device */
} device_ops_t;

int device_bringup(const device_ops_t *ops)   /* the sequence is fixed */
{
    if (ops->power_on() != 0)  return -1;
    delay_ms(10);
    if (ops->probe() != 0)     return -2;
    if (ops->configure() != 0) return -3;
    return 0;
}
```

## When not to use these

Honest limits, because over-applying patterns is its own failure mode:

- **Observer with one subscriber** is a function call with extra steps and a runtime failure
  mode. Just call the function.
- **Command queue for a single synchronous action** adds latency and a queue for nothing.
- **Strategy with one strategy** is indirection with no payoff.
- **Any of them in a 500-line project** costs more than it returns.

The trigger for adopting one is always the same: *the second consumer*, *the second
implementation*, or *the second thread*. Before that, keep it direct.

## Check yourself

1. Why must an observer callback be fast?
2. What does a command queue buy you regarding locking, and why?
3. What is the difference between strategy and the interfaces from lesson 3?
4. When is observer the wrong choice?

## Next

Lesson 5: what C++ adds when you can use it — RAII, templates instead of virtual calls, and
type-safe register access, all at zero runtime cost.
