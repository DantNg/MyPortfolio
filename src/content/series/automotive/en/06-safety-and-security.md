---
lesson: 6
lang: en
title: "Functional Safety and Cybersecurity"
description: "ISO 26262 and where ASIL comes from, what it actually demands of your code, MISRA C in practice, and how ISO/SAE 21434 changed what you are allowed to ship."
duration: "16 min"
tags: ["Automotive", "ISO 26262", "ASIL", "Cybersecurity"]
---

## Safety is about the vehicle, not the code

The first thing to internalize: **ISO 26262 does not certify software.** It certifies that a
*development process* was followed such that the residual risk of the *item* — the vehicle
function — is acceptable. There is no such thing as "ASIL D code" in isolation. There is an
ASIL D function, implemented by code developed under ASIL D process requirements.

That distinction explains why so much automotive work is documentation. The evidence *is*
the deliverable.

## Where ASIL comes from

![ASIL determination](/MyPortfolio/images/automotive/asil.svg)

Every hazard gets analysed in a **HARA (Hazard Analysis and Risk Assessment)** along three
axes:

- **S — Severity**: S0 no injuries, S3 life-threatening.
- **E — Exposure**: E0 incredibly unlikely, E4 happens in most driving situations.
- **C — Controllability**: C0 controllable in general, C3 uncontrollable by the driver.

The combination gives QM (quality management only) or ASIL A through D.

Worked example: *unintended full braking at highway speed.* Severity is high (S3 — a rear-end
collision at speed), exposure is high (E4 — highway driving is routine), controllability is
low (C3 — the driver cannot override it). That lands on **ASIL D**.

Contrast: *interior ambient lighting fails.* S0, and it never leaves QM.

Two mechanisms are worth knowing because they show up in real projects:

- **ASIL decomposition** — an ASIL D requirement can be split into two independent ASIL B(D)
  elements, if you can demonstrate genuine independence. This is how teams make ASIL D
  affordable, and proving independence is the hard part.
- **Freedom from interference** — if QM and ASIL C code share an MCU, you must show the QM
  code cannot corrupt the safety code. Memory partitioning (MPU), timing protection
  (execution budgets), and separate communication paths are the standard arguments.

## What ASIL actually demands of your code

The standard translates into concrete engineering constraints:

**Traceability, both directions.** Every requirement traces to design, code, and tests; every
line of code traces back to a requirement. Tools like Polarion or DOORS exist for this, and
"why does this function exist" must have a documented answer.

**Coding guidelines — MISRA C.** Mandatory at every ASIL. More on it below.

**Structural coverage**, and the required level rises with ASIL:

| ASIL | Required coverage |
| --- | --- |
| A | statement |
| B | statement + branch |
| C | statement + branch |
| D | statement + branch + **MC/DC** |

MC/DC (Modified Condition/Decision Coverage) means every sub-condition in a boolean
expression must be shown to independently affect the outcome. In practice it pushes you to
write simple conditions, because a four-term `&&` chain needs five test cases to satisfy
MC/DC.

**Safety mechanisms in the design**, not bolted on:

- Watchdogs — both a window watchdog and an external one for ASIL D.
- Checksums or CRCs on safety-relevant data in RAM and in messages.
- Redundant computation and comparison for critical values.
- Plausibility checks — is this sensor reading physically possible given the last one?
- Defined safe states, and a documented **fault tolerant time interval** (FTTI): how long the
  system may be in a faulty state before reaching the safe state.

**Qualified tools.** Your compiler must be qualified or its output verified, because a
compiler bug is a systematic fault. This is why automotive projects use specific, pinned
compiler versions for years rather than upgrading.

## MISRA C in practice

MISRA C:2012 has 143 rules and 16 directives, classified as *mandatory*, *required*, or
*advisory*. The ones you feel daily:

```c
/* Rule 8.4 — a definition needs a visible declaration */
extern void motor_stop(void);        /* in the header */
void motor_stop(void) { ... }

/* Rule 10.x — no implicit type conversions between essential types */
uint8_t a = 200u;
uint8_t b = 100u;
uint16_t sum = (uint16_t)a + (uint16_t)b;    /* explicit, no silent promotion */

/* Rule 14.4 — controlling expressions must be essentially boolean */
if (ptr != NULL) { ... }             /* not: if (ptr) */
if (count != 0u) { ... }             /* not: if (count) */

/* Rule 15.5 — a single point of exit is preferred (advisory, often enforced) */
static int process(int x)
{
    int result = -1;
    if (x > 0) {
        result = x * 2;
    }
    return result;                   /* one return */
}

/* Rule 17.7 — the return value of a non-void function must be used */
(void)memcpy(dst, src, n);           /* explicit discard */

/* Rule 21.3 — no dynamic memory */
/* malloc, calloc, realloc, free are forbidden. Static allocation only. */
```

Two honest observations after living with it:

- **Most rules genuinely prevent bugs.** The implicit-conversion rules alone catch a real
  class of integer-promotion defects.
- **Some fight you**, and that is what the **deviation process** is for. A documented,
  reviewed, approved deviation is a normal part of the workflow — not a failure. What is not
  acceptable is silently disabling a rule.

Enforcement is by tool: **Polyspace**, **LDRA**, **PC-lint Plus**, **Coverity**, or
**Cppcheck** with the MISRA addon for learning. Run it in CI, not at the end.

## Cybersecurity — ISO/SAE 21434

Safety asks "what if it breaks?" Security asks "what if someone breaks it on purpose?"
ISO/SAE 21434 (2021) made the second question mandatory, and UNECE R155 made a certified
**CSMS (Cyber Security Management System)** a condition of type approval in the EU, Japan
and Korea. **You cannot sell a car without it.**

The parallel to ISO 26262 is deliberate:

| Safety (26262) | Security (21434) |
| --- | --- |
| HARA | TARA (Threat Analysis and Risk Assessment) |
| ASIL A–D | CAL 1–4 (Cybersecurity Assurance Level) |
| Safety goals | Cybersecurity goals |
| Safety case | Cybersecurity case |

A **TARA** works backwards from assets: identify what is worth attacking (the CAN bus, the
key storage, the OTA channel), enumerate threats, rate impact and attack feasibility, and
decide on controls.

What it means concretely for the code you write:

**Secure boot.** Each stage verifies the signature of the next before executing it, anchored
in an immutable root of trust in ROM. Non-negotiable for anything that can be updated.

**Message authentication.** UDS seed-and-key is not security. Real integrity on the bus uses
**SecOC (Secure Onboard Communication)**, which appends a truncated MAC and a freshness value
to safety-relevant frames:

```
[ normal signal data ][ freshness counter ][ truncated CMAC ]
```

The freshness value is what defeats replay attacks — the reason simply recording and
retransmitting a "unlock doors" frame stops working.

**Key storage in an HSM.** Modern automotive MCUs (AURIX, S32, RH850) have a hardware security
module: a separate core with its own memory holding keys that the application core can use but
never read.

**Secure diagnostics.** `0x27` SecurityAccess is being replaced by `0x29`
**Authentication** (UDS 2020), which uses certificate-based PKI rather than a shared secret
algorithm.

**A patch process.** Under R155 you must be able to respond to a disclosed vulnerability
during the whole vehicle lifetime — which is why OTA capability became a compliance
requirement, not just a feature.

## Where they conflict

Safety and security genuinely pull against each other, and pretending otherwise leads to bad
designs:

- **Safety wants determinism; security wants cryptography.** A CMAC costs time, and that time
  must fit inside the FTTI.
- **Safety wants a fail-safe state; security wants fail-secure.** For a brake system, failing
  open is safe and insecure. Which wins is a documented decision, and it must be documented.
- **Safety wants observability; security wants opacity.** A debug port that helps you
  diagnose a field failure is also an attack surface.

The resolution is always a decision recorded in an analysis, with a rationale someone signed.
This is what senior automotive engineers actually spend their time on.

## Working under these standards day to day

What changes in practice, compared to consumer embedded:

1. **Requirements come first, always.** Code without a linked requirement will be rejected in
   review.
2. **Reviews are formal and recorded.** Who reviewed, when, what was found, how it was closed.
3. **Static analysis is a gate, not a suggestion.** The build fails on new MISRA violations.
4. **Tests trace to requirements.** "It works" is not evidence; "requirement SYS-142 is
   verified by test TC-0891" is.
5. **Change is expensive.** A one-line fix in an ASIL D module triggers impact analysis,
   re-review, re-test, and a documentation update. This is why estimates look enormous to
   people arriving from web development, and why they are usually correct.

None of this makes you slower at writing code. It makes the *system* slower to change, on
purpose, because the failure mode is a recall or worse.

## Series recap

1. ECUs, OEM/Tier 1, domain vs zonal architecture, and the four software platforms.
2. CAN and CAN FD to the bit: arbitration, DBC files, SocketCAN.
3. UDS diagnostics: sessions, services, seed-and-key, DTC lifecycle, flashing.
4. AUTOSAR Classic: layers, SWCs, the RTE, and configuration-driven development.
5. AUTOSAR Adaptive: services, SOME/IP, `ara::com`, and Android Automotive's VHAL.
6. ISO 26262 and ISO/SAE 21434: where ASIL comes from and what it demands.

Where to go next depends on the side you land on. For Classic, learn a configuration tool
properly — Vector DaVinci or EB tresos — because that is what the job is. For Adaptive, get
comfortable with modern C++ and build something against vsomeip. Either way, an inexpensive
USB-CAN adapter and a weekend with `can-utils` will teach you more than any course.
