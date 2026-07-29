---
lesson: 6
lang: en
title: "Testing Firmware, and the Anti-patterns That Prevent It"
description: "The test pyramid for embedded, faking time and hardware, the seven anti-patterns that make firmware untestable, and a review checklist you can actually use."
duration: "15 min"
tags: ["Design patterns", "Testing", "Code review"]
---

## What is actually testable

Not everything can or should be unit-tested. Being clear about which layer gets which kind of
test is what keeps the effort proportionate:

| Layer | Test type | Runs on | Speed |
| --- | --- | --- | --- |
| Application logic, state machines, algorithms | unit | host | ms |
| Device drivers with fake buses | unit | host | ms |
| Driver + real peripheral | integration | target | seconds |
| Full system | system / HIL | target + rig | minutes |

The pyramid shape matters: hundreds of host unit tests, dozens of on-target integration
tests, a handful of system tests. Inverting it — relying mostly on manual testing on hardware
— is what makes firmware slow to change.

**The single highest-value move** is getting the top row running on your laptop. Everything
in lessons 1 to 3 exists to make that possible.

## Faking time

Time is the dependency people forget, and it makes tests slow and flaky:

```c
/* untestable — a 60-second test, and it depends on the wall clock */
void check_timeout(void) {
    if (HAL_GetTick() - start > 60000) { handle_timeout(); }
}
```

Inject the clock like any other dependency:

```c
typedef struct {
    uint32_t (*now_ms)(void *ctx);
    void     *ctx;
} clock_if_t;

bool timeout_expired(const clock_if_t *clk, uint32_t start, uint32_t limit_ms)
{
    return (clk->now_ms(clk->ctx) - start) >= limit_ms;
}
```

```c
/* the test controls time completely, and runs in microseconds */
static uint32_t fake_now;
static uint32_t fake_now_ms(void *ctx) { return fake_now; }
static const clock_if_t fake_clock = { .now_ms = fake_now_ms };

void test_timeout(void)
{
    fake_now = 1000;
    TEST_ASSERT_FALSE(timeout_expired(&fake_clock, 1000, 60000));

    fake_now = 61000;
    TEST_ASSERT_TRUE(timeout_expired(&fake_clock, 1000, 60000));

    /* the case everyone forgets: the tick counter wrapping at 2^32 */
    fake_now = 500;
    TEST_ASSERT_TRUE(timeout_expired(&fake_clock, 0xFFFFFF00, 1000));
}
```

That last assertion is why this matters. Tick wraparound happens after 49.7 days at 1 kHz,
which means it appears in the field and never on your desk — unless you can set the clock.

## Testing state machines exhaustively

With the pure step function from lesson 2, you can test every cell of the matrix:

```c
void test_no_invalid_transitions(void)
{
    for (state_t s = 0; s < ST_COUNT; s++) {
        for (event_t e = 0; e < EV_COUNT; e++) {
            step_result_t r = charger_step(s, e);
            TEST_ASSERT_TRUE_MESSAGE(r.next < ST_COUNT,
                                     "transition produced an invalid state");
        }
    }
}

void test_safety_invariant(void)
{
    /* over-temperature must reach FAULT from every state, no exceptions */
    for (state_t s = 0; s < ST_COUNT; s++) {
        step_result_t r = charger_step(s, EV_OVERTEMP);
        TEST_ASSERT_EQUAL(ST_FAULT, r.next);
    }
}
```

That second test encodes a safety requirement directly. If someone adds a state next year and
forgets the over-temperature transition, the build fails. That is the highest-leverage test
you can write for a safety-relevant machine.

## Testing protocol parsers

Parsers are pure functions over bytes, so they are the easiest thing in firmware to test well
— and historically the richest source of security bugs:

```c
void test_parser_handles_split_frame(void)
{
    parser_t p;
    parser_init(&p);

    /* a frame arriving in three chunks, as it would over UART */
    TEST_ASSERT_EQUAL(PARSE_INCOMPLETE, parser_feed(&p, (uint8_t[]){0xAA, 0x03}, 2));
    TEST_ASSERT_EQUAL(PARSE_INCOMPLETE, parser_feed(&p, (uint8_t[]){0x01, 0x02}, 2));
    TEST_ASSERT_EQUAL(PARSE_COMPLETE,   parser_feed(&p, (uint8_t[]){0x03, 0x5C}, 2));
}

void test_parser_rejects_bad_crc(void)   { /* ... */ }
void test_parser_rejects_oversize_len(void) { /* ... */ }
void test_parser_recovers_after_garbage(void) { /* ... */ }
```

If your parser takes untrusted input — anything from a radio, a bus, or a USB port — fuzz it:

```c
/* libFuzzer: builds and runs on the host, finds the inputs you did not imagine */
int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
    parser_t p;
    parser_init(&p);
    parser_feed(&p, data, size);
    return 0;
}
```

```bash
clang -fsanitize=fuzzer,address parser.c fuzz_parser.c -o fuzz
./fuzz -max_total_time=60
```

Sixty seconds of fuzzing regularly finds buffer overruns that months of manual testing did
not.

## The seven anti-patterns

Each of these makes firmware untestable, and each has a mechanical fix.

### 1. Direct hardware access from logic

```c
if (HAL_GPIO_ReadPin(BUTTON_PORT, BUTTON_PIN) == GPIO_PIN_SET) { start_pump(); }
```

**Fix:** an interface (lesson 3). This is the root cause of most of the others.

### 2. Global mutable state

```c
int   g_temperature;
bool  g_pump_running;
float g_setpoint;
```

Tests cannot run independently, because test 2 sees whatever test 1 left behind. **Fix:** pass
a context struct; make globals `static` and reachable only through functions.

### 3. Blocking delays inside logic

```c
void calibrate(void) {
    start();
    HAL_Delay(5000);      /* the test now takes 5 seconds */
    finish();
}
```

**Fix:** a state machine plus an injected clock. The calibration becomes
`calibrate_step(state, now_ms)`.

### 4. Doing everything in the ISR

```c
void UART_IRQHandler(void) {
    parse_and_execute_command();     /* untestable and slow */
}
```

**Fix:** the command queue from lesson 4. The ISR posts; a task executes; the parser is a pure
function you can test.

### 5. `#ifdef` scattered through logic

```c
#ifdef BOARD_V1
    set_pin(5);
#elif defined(BOARD_V2)
    set_pin(7);
#endif
```

Each combination is a separate untested program. **Fix:** put the variation in a
configuration struct or a board-support file, and keep the logic single-variant.

### 6. Functions that do five things

A 200-line function with eight parameters and four responsibilities cannot be tested in
isolation, because there is no isolation. **Fix:** lesson 1. If you cannot describe what a
function does in one sentence without "and", split it.

### 7. Magic numbers

```c
if (status & 0x40) { ... }
delay(250);
if (voltage > 3686) { ... }
```

Nobody — including you, in three months — can tell whether a test is asserting the right
thing. **Fix:** named constants with units:

```c
#define STATUS_READY_MASK    (1u << 6)
#define SETTLE_TIME_MS       250u
#define OVERVOLTAGE_MV       3686u   /* 3.686 V */
```

## Getting a test build running

Ceedling for C:

```bash
gem install ceedling && ceedling new fw && cd fw
ceedling test:all
ceedling gcov:all
```

CMake + CTest, if you are already on CMake:

```cmake
add_library(app_logic STATIC src/charger.c src/parser.c)
target_include_directories(app_logic PUBLIC include)
# note: no HAL, no vendor headers — that is what makes it host-buildable

enable_testing()
add_executable(test_charger test/test_charger.c)
target_link_libraries(test_charger app_logic unity)
add_test(NAME charger COMMAND test_charger)
```

The important line is the comment. If `app_logic` needs the vendor HAL to link, the boundary
has leaked and you should fix that before writing more tests.

In CI:

```yaml
test:
  script:
    - ceedling test:all gcov:all
    - cppcheck --enable=all --error-exitcode=1 src/
    - grep -rn "stm32\|HAL_" src/app/ && exit 1 || true   # layer check
```

## A review checklist

Practical questions for reviewing firmware structure. Not everything needs a "yes" — but every
"no" should be a deliberate choice:

**Structure**

- [ ] Can I state each module's responsibility in one sentence with no "and"?
- [ ] Does application code include any vendor header?
- [ ] Are dependencies passed in, or reached out for?
- [ ] Is there exactly one composition root?

**State**

- [ ] Is state machine logic separate from its effects?
- [ ] Are transitions explicit and named, never `state++`?
- [ ] Does every waiting state have a timeout?
- [ ] Are transitions traced somewhere I can read after a field failure?

**Concurrency**

- [ ] Do ISRs only post to queues?
- [ ] Is shared state owned by one task, or protected by one documented mechanism?
- [ ] Does every lock have a timeout and a handled failure path?

**Testability**

- [ ] Do the tests build and run on the host?
- [ ] Is time injected rather than read from `HAL_GetTick()` in logic?
- [ ] Can I test the error paths, not just the happy path?

**Hygiene**

- [ ] Are magic numbers named, with units?
- [ ] Are return values checked, or explicitly discarded with `(void)`?
- [ ] Does any `#ifdef` appear in application logic?

## Series recap

1. SOLID translated to firmware, layering, and opaque pointers.
2. State machines four ways, and how to make them exhaustively testable.
3. Interfaces and dependency injection in C; fakes over mocks; the composition root.
4. Observer, command queues and strategy — decoupling producers from consumers.
5. What C++ adds at zero runtime cost, and what to avoid.
6. The test pyramid, faking time, the seven anti-patterns, and a review checklist.

The thread through all six: **structure is what you buy with indirection, and you should buy
exactly as much as the project needs.** A 500-line project needs none of this. A 50,000-line
product with three variants and a safety requirement needs most of it. The skill is knowing
which one you are working on — and noticing when it changes.
