---
lesson: 4
lang: en
title: "AUTOSAR Classic — Layers, SWCs and the RTE"
description: "What the layers are actually for, how an SWC gets written without knowing about hardware, why ARXML configuration dwarfs the code, and how to read a real project."
duration: "16 min"
tags: ["Automotive", "AUTOSAR", "RTE"]
---

## The problem AUTOSAR solves

Before AUTOSAR, an OEM buying a body controller from Bosch got Bosch's software structure,
and buying the same function from Continental next year meant starting over. Application
logic was welded to a specific microcontroller, a specific CAN driver, a specific supplier.

**AUTOSAR (2003) standardizes the layers and the interfaces between them**, so the
application logic that decides how a window lifts can be reused across suppliers, chips and
vehicle programs.

The cost is that everything becomes a configuration exercise. That trade — enormous
configuration for genuine portability — is the thing to understand about AUTOSAR before
anything else.

## The layers

![AUTOSAR Classic layers](/MyPortfolio/images/automotive/autosar-layers.svg)

Reading top to bottom:

**Application Layer** — your logic, packaged as **Software Components (SWCs)**. An SWC has
no idea what MCU it runs on and contains no `#include` of any vendor header.

**RTE (Runtime Environment)** — generated code that connects SWCs to each other and to the
basic software. This is the layer that makes portability real: an SWC calls `Rte_Write_...`
and the RTE decides whether that becomes a local variable write, a message to another SWC on
this ECU, or a CAN frame to a different ECU entirely.

**BSW (Basic Software)**, itself three sublayers:

- **Services** — the OS, communication stack (Com, PduR, CanTp), diagnostics (Dcm for UDS,
  Dem for DTCs), non-volatile memory (NvM), watchdog, crypto.
- **ECU Abstraction** — CanIf, EthIf, MemIf, IoHwAb. Hides whether a peripheral is inside the
  MCU or an external chip on SPI.
- **MCAL (Microcontroller Abstraction Layer)** — Can, Spi, Adc, Pwm, Gpt, Fls. Supplied by
  the chip vendor. **This is the only layer that touches registers.**

**Complex Device Drivers (CDD)** are the escape hatch: a sanctioned way to bypass the layers
for something with timing the standard stack cannot meet — direct injection control, for
instance. Every project has a few, and every architect wants fewer.

## What an SWC looks like

An SWC has **ports**. A *sender-receiver* port moves data; a *client-server* port calls an
operation. The application code sees only generated `Rte_` functions:

```c
/* DoorControl SWC — no hardware knowledge anywhere in this file */
#include "Rte_DoorControl.h"

/* A runnable — the RTE calls this, you never call it yourself */
FUNC(void, DoorControl_CODE) DoorControl_MainFunction(void)
{
    uint8 switch_state;
    uint8 vehicle_speed;

    /* read from a receiver port */
    if (Rte_Read_WindowSwitch_State(&switch_state) != RTE_E_OK) {
        return;
    }
    (void)Rte_Read_VehicleSpeed_Value(&vehicle_speed);

    /* the actual policy — the only interesting part */
    if (switch_state == SWITCH_UP && vehicle_speed < 20u) {
        Rte_Write_MotorCmd_Direction(MOTOR_UP);
    } else {
        Rte_Write_MotorCmd_Direction(MOTOR_STOP);
    }
}
```

Everything about *where* `VehicleSpeed` comes from — a CAN frame from the ABS ECU, or another
SWC on this same ECU — lives in configuration, not in this file. Moving the SWC to a different
ECU changes zero lines of C.

The RTE also provides the timing. A runnable is triggered by a **RTEEvent**:

| Event | Meaning |
| --- | --- |
| `TimingEvent` | periodic — every 10 ms |
| `DataReceivedEvent` | when a signal arrives |
| `OperationInvokedEvent` | when a client calls your server port |
| `InitEvent` | once at startup |
| `ModeSwitchEvent` | on an ECU mode change |

You do not write a scheduler, a task, or a loop. You declare "this runnable runs every 10 ms"
in the configuration, and the RTE generator produces the OS task that calls it.

## The OS

AUTOSAR OS is derived from **OSEK/VDX** and is deliberately more restrictive than FreeRTOS:

- **Tasks are statically defined.** No creation at runtime, ever.
- **Basic tasks** run to completion; **extended tasks** may wait on events.
- **Alarms and schedule tables** trigger tasks from counters, giving time-triggered
  determinism.
- **Protection**: memory partitioning between OS-Applications, plus timing protection that
  can kill a task that overruns its budget.

That last point is the one that matters for safety. Under ISO 26262, an ASIL D function must
have **freedom from interference** from QM code sharing the same MCU — and AUTOSAR OS
provides it through MPU-backed partitions and execution budgets, not through code review.

```c
TASK(Task_10ms)
{
    DoorControl_MainFunction();
    LightControl_MainFunction();
    TerminateTask();            /* mandatory — a basic task must terminate */
}
```

Forgetting `TerminateTask()` is the classic AUTOSAR OS bug, and it usually manifests as a
protection hook firing rather than an obvious hang.

## The communication stack

Following a CAN signal from the wire to your SWC:

```
CAN controller
  → Can (MCAL)              driver, interrupt handling
  → CanIf                   which hardware object maps to which PDU
  → PduR (PDU Router)       routes to Com, CanTp (diagnostics), or a gateway path
  → Com                     unpacks signals from the PDU, applies filters and timeouts
  → RTE                     writes into your port
  → your SWC
```

Each layer is configured, not coded. **Com** is where the interesting behavior lives:

- **Signal packing** — bit position, byte order, sign, initial value.
- **Transmission modes** — cyclic, on-change, or both.
- **Deadline monitoring** — if a signal does not arrive within N ms, substitute a defined
  value and notify the application. This is how a car keeps working when an ECU falls off
  the bus.
- **Update bits** — distinguish "the value is 0" from "no new value arrived".

A large part of "AUTOSAR development" is getting Com configuration to match the OEM's network
design, which arrives as an ARXML file.

## ARXML — where the project actually lives

Everything above is described in **ARXML** (AUTOSAR XML). A mid-size ECU project might have
50 MB of it, against a few hundred kilobytes of hand-written C.

```xml
<SENDER-RECEIVER-INTERFACE>
  <SHORT-NAME>VehicleSpeed</SHORT-NAME>
  <DATA-ELEMENTS>
    <VARIABLE-DATA-PROTOTYPE>
      <SHORT-NAME>Value</SHORT-NAME>
      <TYPE-TREF DEST="IMPLEMENTATION-DATA-TYPE">/DataTypes/uint8</TYPE-TREF>
    </VARIABLE-DATA-PROTOTYPE>
  </DATA-ELEMENTS>
</SENDER-RECEIVER-INTERFACE>
```

Nobody writes that by hand. You use a configuration tool — **Vector DaVinci**, **ETAS ISOLAR**,
**EB tresos** — and it generates the RTE and the BSW configuration from your clicks.

Three consequences worth internalizing early:

1. **The build is a generation step, then a compile.** Change a port, regenerate the RTE,
   recompile. Forgetting to regenerate produces link errors that look mysterious until you
   learn the rhythm.
2. **ARXML is in version control and it merges badly.** Two engineers editing the same
   configuration is a real coordination problem. Most teams split configuration by
   responsibility and merge carefully.
3. **The tool licence is a project cost and a bottleneck.** This is a real difference from
   open-source embedded work.

## The diagnostic stack

Two BSW modules implement lesson 3 for you:

**Dcm (Diagnostic Communication Manager)** handles UDS: sessions, security access, the
service dispatcher, timing. You configure which services and DIDs exist and provide callbacks:

```c
Std_ReturnType Dcm_ReadVIN(uint8 *data, uint16 length)
{
    (void)memcpy(data, vin_string, 17u);
    return E_OK;
}
```

**Dem (Diagnostic Event Manager)** handles DTCs: debouncing, the pending/confirmed lifecycle,
freeze frames, storage in NvM, aging. Your monitor just reports a pass or a fail:

```c
/* the monitor decides; Dem owns the lifecycle */
if (sensor_voltage > 4.9f) {
    Dem_SetEventStatus(DemConf_DemEventParameter_SensorShortToBattery,
                       DEM_EVENT_STATUS_FAILED);
} else {
    Dem_SetEventStatus(DemConf_DemEventParameter_SensorShortToBattery,
                       DEM_EVENT_STATUS_PASSED);
}
```

Everything else — how many failures before confirmation, what goes in the freeze frame, when
it heals — is configuration. That separation is genuinely good design: the monitor knows
physics, Dem knows the standard.

## Reading an unfamiliar AUTOSAR project

A practical order for your first week:

1. **Find the ECU Extract** — the ARXML describing this ECU's role in the network. It tells
   you which signals arrive and which you must send.
2. **List the SWCs and their runnables.** The tool shows a component diagram; this is the
   real architecture.
3. **Open the OS configuration.** Tasks, their periods, and which runnables map into which
   task tells you the timing design.
4. **Find the CDDs.** They are where the standard did not fit, which means they are where
   the interesting problems are.
5. **Only then read the C.** By that point it will make sense.

## Honest limitations

AUTOSAR Classic is genuinely good at what it targets — statically configured, safety-relevant
control on microcontrollers. It is a poor fit for anything else:

- **No dynamic behavior.** Everything is fixed at build time. You cannot add a service at
  runtime, which is exactly what a software-defined vehicle wants.
- **Update granularity is the whole ECU.** There is no concept of updating one application.
- **Heavy for small ECUs.** The stack alone can be 100 kB+ of flash.
- **Steep tooling cost**, both in money and in learning time.

Those limits are precisely why AUTOSAR **Adaptive** exists, which is lesson 5.

## Check yourself

1. Which layer is allowed to touch hardware registers, and why does that matter?
2. What does the RTE do that makes an SWC portable between ECUs?
3. Why must a basic task call `TerminateTask()`?
4. Who owns the DTC debounce logic — your monitor code or Dem?

## Next

Lesson 5: AUTOSAR Adaptive and service-oriented architecture. SOME/IP, `ara::com`, and how
the software-defined vehicle actually changes the programming model.
