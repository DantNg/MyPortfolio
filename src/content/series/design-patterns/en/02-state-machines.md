---
lesson: 2
lang: en
title: "State Machines — Four Ways, With the Trade-offs"
description: "The pattern firmware uses more than any other: nested switch, transition table, function pointers, and hierarchical — when each one is right, with complete code."
duration: "16 min"
tags: ["Design patterns", "State machine", "C"]
---

## Why this pattern dominates firmware

Almost every embedded problem is a state machine wearing a disguise: a protocol parser, a
charging controller, a menu, a boot sequence, a motor with modes. The reason is that firmware
reacts to events over time and must remember where it is — which is the definition.

Writing it explicitly, instead of as a scatter of `bool` flags, gives you three things: you
can draw it, you can review it, and you can test it exhaustively.

![Four ways to implement a state machine](/MyPortfolio/images/patterns/state-machine.svg)

Throughout this lesson, one running example — a battery charger:

```
IDLE → (plugged in) → PRECHARGE → (V > 3.0) → FAST → (I < 0.1C) → DONE
any state → (unplugged) → IDLE
any state → (over-temperature) → FAULT
```

## 1. Nested switch

The version everyone writes first:

```c
typedef enum { ST_IDLE, ST_PRECHARGE, ST_FAST, ST_DONE, ST_FAULT } state_t;
typedef enum { EV_PLUGGED, EV_UNPLUGGED, EV_V_OK, EV_I_LOW, EV_OVERTEMP } event_t;

static state_t state = ST_IDLE;

void charger_handle(event_t ev)
{
    if (ev == EV_OVERTEMP) { charger_stop(); state = ST_FAULT; return; }
    if (ev == EV_UNPLUGGED) { charger_stop(); state = ST_IDLE; return; }

    switch (state) {
    case ST_IDLE:
        if (ev == EV_PLUGGED) { set_current(PRECHARGE_MA); state = ST_PRECHARGE; }
        break;

    case ST_PRECHARGE:
        if (ev == EV_V_OK) { set_current(FAST_MA); state = ST_FAST; }
        break;

    case ST_FAST:
        if (ev == EV_I_LOW) { charger_stop(); state = ST_DONE; }
        break;

    case ST_DONE:
    case ST_FAULT:
        break;
    }
}
```

**Good:** zero overhead, no indirection, obvious to anyone.

**Bad:** it does not scale. At six states and six events you have a 36-cell matrix expressed
as prose, and it is genuinely difficult to see which cells you forgot. Note how the two
global transitions had to be hoisted above the switch — that is the shape of the problem
appearing early.

**Use it** for five states or fewer, with a stable specification.

## 2. Transition table

Put the machine in data instead of control flow:

```c
typedef void (*action_fn)(void);

typedef struct {
    state_t  from;
    event_t  ev;
    state_t  to;
    action_fn action;      /* may be NULL */
} transition_t;

static const transition_t table[] = {
    /* from          event         to            action        */
    { ST_IDLE,      EV_PLUGGED,   ST_PRECHARGE, act_precharge  },
    { ST_PRECHARGE, EV_V_OK,      ST_FAST,      act_fast       },
    { ST_FAST,      EV_I_LOW,     ST_DONE,      act_stop       },

    /* global transitions, listed explicitly for every source state */
    { ST_PRECHARGE, EV_UNPLUGGED, ST_IDLE,      act_stop       },
    { ST_FAST,      EV_UNPLUGGED, ST_IDLE,      act_stop       },
    { ST_DONE,      EV_UNPLUGGED, ST_IDLE,      NULL           },
};

void charger_handle(event_t ev)
{
    for (size_t i = 0; i < ARRAY_SIZE(table); i++) {
        if (table[i].from == state && table[i].ev == ev) {
            if (table[i].action) table[i].action();
            state = table[i].to;
            return;
        }
    }
    /* no transition matched — log it, this is where bugs hide */
    log_unhandled(state, ev);
}
```

**Good:** the entire machine is visible in one block you can read like a spec. It is
reviewable by a non-programmer. It can be generated from a diagram or a CSV. Missing
transitions are visible as gaps, and unhandled events are detectable at runtime.

**Bad:** the linear scan is O(n). For a big table with a high event rate, sort it and use
binary search, or index by `[state][event]`.

**Use it** as your default. This is the version I reach for in most projects, and the fact
that the machine is *data* is what makes it reviewable and generatable.

## 3. Function pointers — state as a function

Each state becomes a handler that returns the next state:

```c
typedef state_t (*state_fn)(event_t ev);

static state_t st_idle(event_t ev);
static state_t st_precharge(event_t ev);
static state_t st_fast(event_t ev);

static state_fn current = st_idle;

static state_t st_idle(event_t ev)
{
    if (ev == EV_PLUGGED) { set_current(PRECHARGE_MA); return (state_t)st_precharge; }
    return (state_t)st_idle;
}

static state_t st_precharge(event_t ev)
{
    switch (ev) {
    case EV_V_OK:      set_current(FAST_MA); return (state_t)st_fast;
    case EV_UNPLUGGED: charger_stop();       return (state_t)st_idle;
    default:                                 return (state_t)st_precharge;
    }
}

void charger_handle(event_t ev)
{
    current = (state_fn)current(ev);
}
```

Cleaner with an explicit context struct, which also lets you have several instances:

```c
typedef struct charger charger_t;
typedef void (*handler_fn)(charger_t *c, event_t ev);

struct charger {
    handler_fn handler;
    uint32_t   timer_ms;
    uint16_t   mv;
};

static void on_precharge(charger_t *c, event_t ev)
{
    if (ev == EV_V_OK) { set_current(FAST_MA); c->handler = on_fast; }
}

void charger_dispatch(charger_t *c, event_t ev) { c->handler(c, ev); }
```

**Good:** dispatch is O(1) regardless of size. Each state is a self-contained function, which
is pleasant when a state has substantial logic. Entry/exit actions are easy to add.

**Bad:** you cannot see the whole machine anywhere. To answer "what happens on UNPLUGGED in
FAST?" you must open a specific function. Reviewers dislike it for exactly that reason.

**Use it** when you have many states, few events, and each state does real work.

## 4. Hierarchical state machines

The problem all three versions share: **global transitions get duplicated.** `EV_UNPLUGGED`
and `EV_OVERTEMP` appear in every state, and forgetting one in a new state is the classic bug.

A hierarchical state machine (HSM) solves it with nesting. `PRECHARGE` and `FAST` become
substates of `CHARGING`, and `CHARGING` handles `EV_UNPLUGGED` once for both. An unhandled
event bubbles up to the parent.

```
CHARGING                        ← handles UNPLUGGED and OVERTEMP for all children
  ├── PRECHARGE
  └── FAST
IDLE
DONE
FAULT
```

Plus **entry and exit actions**, which run automatically on every transition crossing a
boundary:

```c
/* conceptual — real HSM frameworks generate this */
state_t charging_on_entry(void) { fan_on();  led_set(LED_CHARGING); }
state_t charging_on_exit(void)  { fan_off(); charger_stop(); }
```

Now "the fan must be off whenever we are not charging" is guaranteed by structure, not by
remembering to call `fan_off()` on six different paths.

**Good:** no duplicated transitions, guaranteed entry/exit pairing, scales to genuinely
complex behavior.

**Bad:** you almost certainly want a framework rather than hand-rolling it. Options:
**QP/C** (Miro Samek), **Zephyr's `smf`** subsystem, or a generator like **Yakindu/itemis
CREATE** that produces C from a diagram.

**Use it** for UIs, complex protocols, and anything where you find yourself writing the same
transition in five places.

## Making any of them testable

Whichever you pick, the same rule from lesson 1 applies: **separate the machine from its
effects.** Do not call `HAL_GPIO_WritePin` inside a transition action. Return an intent, or
call through an injected interface:

```c
/* pure — trivially testable */
typedef struct {
    state_t  next;
    action_t action;      /* ACT_NONE, ACT_SET_PRECHARGE, ACT_STOP, ... */
} step_result_t;

step_result_t charger_step(state_t current, event_t ev);
```

```c
/* the test needs no hardware at all */
void test_precharge_to_fast(void)
{
    step_result_t r = charger_step(ST_PRECHARGE, EV_V_OK);
    TEST_ASSERT_EQUAL(ST_FAST, r.next);
    TEST_ASSERT_EQUAL(ACT_SET_FAST, r.action);
}
```

With a pure step function, exhaustive testing is a nested loop:

```c
for (state_t s = 0; s < ST_COUNT; s++) {
    for (event_t e = 0; e < EV_COUNT; e++) {
        step_result_t r = charger_step(s, e);
        TEST_ASSERT_TRUE(r.next < ST_COUNT);       /* never an invalid state */
    }
}
```

That loop finds the transitions you forgot, which is the entire point.

## Practical details that matter

**Feed events through a queue.** An ISR should not call `charger_handle()` directly — it
should post an event. One thread owns the state variable and no locking is needed:

```c
void ADC_IRQHandler(void) {
    event_t ev = EV_V_OK;
    BaseType_t woken = pdFALSE;
    xQueueSendFromISR(event_q, &ev, &woken);
    portYIELD_FROM_ISR(woken);
}
```

**Handle timeouts as events.** A state that can hang needs a timer that posts `EV_TIMEOUT`,
and a transition to a safe state. Every state that waits for external input needs one.

**Log every transition.** Four bytes each — timestamp, from, event, to — in a ring buffer.
When a device misbehaves in the field, that ring buffer is the difference between diagnosing
it and guessing:

```c
static void trace(state_t from, event_t ev, state_t to) {
    trace_buf[idx++ & (TRACE_N - 1)] = (trace_t){ now_ms(), from, ev, to };
}
```

**Never use `state++`.** Transitions must be explicit and named. Incrementing an enum couples
your logic to the declaration order, and someone will reorder it.

## Choosing, in one table

| | Nested switch | Table | Function pointers | Hierarchical |
| --- | --- | --- | --- | --- |
| States it suits | ≤ 5 | 5–20 | 10–50 | any, complex |
| Whole machine visible | partly | **yes** | no | in the diagram |
| Dispatch cost | O(1) | O(n) | **O(1)** | O(depth) |
| Global transitions | duplicated | duplicated | duplicated | **inherited** |
| Entry/exit actions | manual | manual | easy | **automatic** |
| Generatable from a diagram | no | **yes** | awkward | **yes** |
| Needs a framework | no | no | no | usually |

## Check yourself

1. Why is a transition table easier to review than nested switches?
2. What problem do all of the flat approaches share, and how does hierarchy fix it?
3. Why should an ISR post an event rather than call the state machine?
4. What does making `charger_step()` pure buy you?

## Next

Lesson 3: interfaces and dependency injection in plain C — how to test code that talks to
hardware, without the hardware.
