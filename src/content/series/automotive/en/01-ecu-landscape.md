---
lesson: 1
lang: en
title: "How a Car Is Organized — ECUs, Domains, and Why It Is All Changing"
description: "The vocabulary nobody explains: ECU, OEM, Tier 1, domain vs zonal architecture, and where the software you write actually sits."
duration: "13 min"
tags: ["Automotive", "ECU", "Architecture"]
---

## The vocabulary, first

Automotive has its own language, and nobody stops to teach it. Here is the minimum:

- **ECU** — Electronic Control Unit. Any computer in the car. A modern vehicle has 60 to
  150 of them, ranging from an 8-bit part controlling a door mirror to a multi-core SoC
  running the instrument cluster.
- **OEM** — the carmaker: Toyota, VW, Hyundai, Ford. They design the vehicle and specify
  everything.
- **Tier 1** — a supplier that sells complete ECUs to the OEM: Bosch, Continental, Denso,
  Aptiv, LG, Harman. If you write automotive software, you probably work here.
- **Tier 2** — supplies components to Tier 1: chip vendors, software stack vendors
  (Vector, ETAS, Elektrobit).
- **E/E architecture** — Electrical/Electronic architecture. The overall map of which ECU
  does what and how they are wired.
- **SOP** — Start of Production. The date everything is planned backwards from.
- **Homologation** — the certification that a vehicle is legal to sell in a market.

The relationship that shapes daily work: **the OEM writes a specification, the Tier 1
implements it.** Your requirements arrive as documents, your interfaces are fixed by the
OEM's network design, and "can we change this API?" usually means a change request that
crosses a company boundary.

## Domain architecture — how it has been

![E/E architecture](/MyPortfolio/images/automotive/ecu-architecture.svg)

For thirty years, cars were organized by **function domain**:

| Domain | What it does | Typical constraints |
| --- | --- | --- |
| Powertrain | engine, transmission, battery management | hard real-time, ASIL C/D |
| Chassis | braking, steering, suspension, ESP | hard real-time, ASIL D |
| Body | doors, windows, lights, HVAC, seats | soft real-time, mostly QM/ASIL A |
| Infotainment | radio, navigation, screens | not real-time, QM |
| ADAS | camera, radar, lidar, sensor fusion | high compute, ASIL B/D |

Each function got its own box, its own microcontroller, its own supplier. Adding a feature
meant adding an ECU. The result is a car with over 100 computers and up to 5 km of wiring
harness, weighing 50–70 kg — one of the heaviest and most expensive single parts of a
vehicle.

The networks connecting them:

| Bus | Speed | Used for |
| --- | --- | --- |
| **LIN** | 20 kbit/s | cheap, single-master: window switches, seat motors, rain sensors |
| **CAN** | up to 1 Mbit/s | the workhorse: powertrain, body, everything |
| **CAN FD** | up to 8 Mbit/s data phase | modern replacement for CAN, 64-byte payloads |
| **FlexRay** | 10 Mbit/s | time-triggered, deterministic: x-by-wire, chassis. Expensive, fading |
| **MOST** | 150 Mbit/s | infotainment media rings. Effectively obsolete |
| **Automotive Ethernet** | 100 Mbit/s – 10 Gbit/s | cameras, ADAS, backbone. The future |

A **gateway** ECU sits in the middle and routes between them, because the powertrain CAN bus
and the infotainment network must not be able to talk to each other freely — for both
timing and security reasons.

## Zonal architecture — where it is going

The domain model broke down for three reasons:

1. **Wiring.** Running a dedicated wire from a central body controller to every lamp and
   switch produces kilometres of harness. It is heavy, expensive, and a manufacturing
   bottleneck.
2. **Features are software now.** Adding adaptive cruise control should not require a new
   box, but in a domain architecture it often does.
3. **Updates.** Shipping an over-the-air update to 120 ECUs from 40 suppliers, each with its
   own bootloader and validation, is close to impossible.

The **zonal** answer: group ECUs by **physical location** rather than function. A zone
controller in the front-left corner handles every sensor and actuator near it — headlight,
door, mirror, ambient sensor — regardless of which functional domain they belong to. Zones
connect to one or a few **high-performance computers (HPCs)** over Automotive Ethernet, and
the actual application logic runs there.

What that means for you as a developer:

- **Zone controllers** are classic embedded work: AUTOSAR Classic, a microcontroller,
  CAN/LIN on one side and Ethernet on the other. Deterministic, safety-relevant, C.
- **HPCs** are closer to Linux systems programming: multi-core SoCs running Linux or QNX,
  AUTOSAR Adaptive, service-oriented communication, C++14/17, containers, OTA.

The industry is short of people who understand both sides. That gap is the reason this
series covers CAN *and* SOME/IP.

## Where software actually runs

Four distinct software worlds live in a modern car, and confusing them is a common
interview mistake:

| Platform | Runs on | OS | Language | Example |
| --- | --- | --- | --- | --- |
| **AUTOSAR Classic** | MCU (AURIX, S32) | OSEK-based RTOS | C | engine control, body control, zone controller |
| **AUTOSAR Adaptive** | SoC (multi-core) | Linux/QNX (POSIX) | C++14+ | ADAS fusion, vehicle computer |
| **Android Automotive OS** | SoC | Android | Java/Kotlin/C++ | infotainment, the screen the driver touches |
| **Bare metal / other RTOS** | small MCU | FreeRTOS, custom | C | sensors, simple actuators |

Note that **Android Automotive OS** is not Android Auto. Android Auto projects your phone
onto the car's screen. Android Automotive OS *is* the car's operating system for
infotainment, running natively, with the vehicle's own HAL exposing speed, HVAC, and gear
position through the Vehicle HAL. Middleware that bridges that HAL to the vehicle networks
is a large and growing area of automotive software work.

## What makes automotive software different

Coming from consumer embedded, five things change:

**1. Timelines are long and fixed.** A program runs three to five years from concept to SOP.
Requirements freeze early. The software you write in 2026 ships in 2029 and must be
supported until 2044.

**2. Safety is a process, not a feature.** ISO 26262 (lesson 6) governs how you develop, not
just what you develop. Traceability from requirement to code to test is mandatory, and
auditable.

**3. You cannot just patch it.** A field update may mean a recall costing millions. This is
why validation is disproportionate to the code size, and why OTA capability is such a
strategic priority for OEMs.

**4. Everything is specified.** Message layouts come from a DBC or ARXML file the OEM owns.
Diagnostic identifiers come from a spec. Even the boot time is a requirement — typically
"CAN response within 100 ms of wake-up".

**5. The tooling is commercial and expensive.** Vector CANoe, ETAS INCA, dSPACE, Lauterbach.
Expect licence dongles and per-seat costs that dwarf anything in web development. There are
open-source equivalents for learning, and this series uses them.

## Setting up to actually try things

You do not need a car. On Linux:

```bash
sudo apt install can-utils

# a virtual CAN interface — no hardware at all
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan
sudo ip link set up vcan0

# send and watch
cansend vcan0 123#DEADBEEF
candump vcan0
```

That is a working CAN bus in four commands, and everything in lesson 2 runs on it. With a
USB-CAN adapter (a Kvaser, PEAK, or an inexpensive CANable) the same commands talk to a real
bus, `can0` instead of `vcan0`.

Add these when you get to lessons 2 and 3:

```bash
pip install cantools python-can udsoncan
```

`cantools` reads DBC files and decodes signals; `udsoncan` speaks diagnostics. Together with
`can-utils` they cover most of what a commercial tool does for learning purposes.

## Check yourself

1. What is the difference between an OEM and a Tier 1, and which one usually writes the
   requirements?
2. Why does zonal architecture reduce wiring harness weight?
3. Which platform would you expect a brake controller to use, and which would an
   infotainment head unit use?
4. What is the difference between Android Auto and Android Automotive OS?

## Next

Lesson 2 goes down to the bits: CAN and CAN FD, how arbitration guarantees the most
important message always wins, and how to read a DBC file.
