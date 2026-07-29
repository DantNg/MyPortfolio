---
lesson: 3
lang: en
title: "Diagnostics — UDS, DTCs and Flashing"
description: "How a workshop tool talks to your ECU: sessions, the services that matter, seed-and-key security, DTC lifecycle, and the transport that carries it all."
duration: "16 min"
tags: ["Automotive", "UDS", "Diagnostics"]
---

## Why diagnostics is a first-class requirement

Every ECU in a car must answer a workshop tool. It has to report which software version it
runs, what has gone wrong, and accept a firmware update — through the OBD connector, from a
tool made by a company that has never seen your source code.

That is standardized as **UDS (Unified Diagnostic Services), ISO 14229**. It is
request/response, the ECU is the server, the tool is the client, and roughly 20% of the
code in a production ECU exists to serve it.

Do not confuse it with **OBD-II (ISO 15031)**, which is the legally mandated, emissions-only
subset every car must expose to any generic scanner. UDS is the full manufacturer protocol;
OBD-II is the small public one.

## The transport underneath

UDS is a protocol, not a bus. On CAN it rides on **ISO-TP (ISO 15765-2)**, which solves the
obvious problem: a diagnostic response can be hundreds of bytes, and a CAN frame carries 8.

ISO-TP segments it:

| Frame type | First byte | Meaning |
| --- | --- | --- |
| Single Frame | `0x` | the whole message fits, `x` = length |
| First Frame | `1x xx` | start of a long message, 12-bit total length |
| Consecutive Frame | `2x` | continuation, `x` = sequence number 0–15 |
| Flow Control | `3x` | receiver says continue/wait, with block size and separation time |

A 20-byte response looks like:

```
ECU  → 10 14 62 F1 90 57 56 57      First Frame: 0x014 = 20 bytes total
Tool → 30 00 00                     Flow Control: go ahead, no delay
ECU  → 21 5A 5A 5A 31 4B 5A 41      Consecutive Frame 1
ECU  → 22 4D 36 39 31 32 33 34      Consecutive Frame 2
```

Two CAN IDs form a diagnostic channel: one for tool→ECU (physical request, e.g. `0x7E0`) and
one for ECU→tool (response, `0x7E8`). There is also a functional/broadcast ID (`0x7DF`) that
addresses every ECU at once.

On Linux you get all of this for free:

```bash
sudo modprobe can-isotp
isotpsend -s 7E0 -d 7E8 can0 <<< "22 F1 90"
isotprecv -s 7E8 -d 7E0 can0
```

## Sessions

An ECU boots into the **default session**, where it will answer harmless read requests.
Anything that changes state requires moving to another session first:

| Session | ID | What it unlocks |
| --- | --- | --- |
| Default | `0x01` | reads, basic identification |
| Programming | `0x02` | flashing — usually via the bootloader |
| Extended | `0x03` | actuator tests, writing configuration, clearing DTCs |
| Safety system | `0x04` | safety-relevant routines |

```
Tool → 10 03            DiagnosticSessionControl, extended
ECU  → 50 03 00 32 01 F4
```

The response carries two timing parameters: `P2 = 0x0032` (50 ms — answer within this) and
`P2* = 0x01F4 × 10 ms` (5000 ms — the extended limit after a "response pending").

Non-default sessions time out. If the tool goes quiet for **S3 = 5 seconds**, the ECU falls
back to default and drops security access. That is why tools send `3E 00` (TesterPresent)
periodically — it is a keep-alive and nothing more:

```
Tool → 3E 80           TesterPresent, suppressPosRsp bit set (no reply wanted)
```

That `0x80` bit is worth knowing generally: setting the high bit of the sub-function means
"do it, but do not reply", which halves the bus traffic for keep-alives.

## The services worth memorizing

![UDS session](/MyPortfolio/images/automotive/uds-diagnostics.svg)

| SID | Name | Used for |
| --- | --- | --- |
| `0x10` | DiagnosticSessionControl | change session |
| `0x11` | ECUReset | reboot the ECU |
| `0x14` | ClearDiagnosticInformation | clear DTCs |
| `0x19` | ReadDTCInformation | read fault codes |
| `0x22` | ReadDataByIdentifier | read a value — the most used service |
| `0x2E` | WriteDataByIdentifier | write a value |
| `0x27` | SecurityAccess | seed-and-key unlock |
| `0x28` | CommunicationControl | silence normal CAN traffic during flashing |
| `0x2F` | InputOutputControlByIdentifier | force an actuator |
| `0x31` | RoutineControl | run a built-in routine (self-test, erase memory) |
| `0x34`–`0x37` | RequestDownload / TransferData / TransferExit | flashing |
| `0x3E` | TesterPresent | keep the session alive |

**Positive responses are `SID + 0x40`.** Request `0x22`, get `0x62`. Once you know that, raw
CAN traces become readable.

**Negative responses are always three bytes:** `7F <SID> <NRC>`.

| NRC | Meaning | What it usually indicates |
| --- | --- | --- |
| `0x11` | serviceNotSupported | wrong service for this ECU |
| `0x12` | subFunctionNotSupported | wrong sub-function |
| `0x13` | incorrectMessageLength | your request is malformed |
| `0x22` | conditionsNotCorrect | e.g. engine running, vehicle moving |
| `0x31` | requestOutOfRange | unknown identifier, or value out of range |
| `0x33` | securityAccessDenied | you did not do `0x27` first |
| `0x35` | invalidKey | your key calculation is wrong |
| `0x78` | requestCorrectlyReceived-ResponsePending | "working on it, wait for P2*" |

`0x78` is the one that trips up client implementations: it is not a failure. The ECU sends it
when an operation (like erasing flash) takes longer than P2, and the tool must keep waiting
until the real response arrives.

## ReadDataByIdentifier

The workhorse. A 16-bit DID names a value:

```
Tool → 22 F1 90                              read VIN
ECU  → 62 F1 90 57 56 57 5A 5A 5A 31 4B ...  "WVWZZZ1K..."
```

Standardized DIDs worth knowing:

| DID | Content |
| --- | --- |
| `F186` | active diagnostic session |
| `F187` | manufacturer spare part number |
| `F189` | software version |
| `F18C` | ECU serial number |
| `F190` | VIN |
| `F195` | software fingerprint |

Everything from `0x0100` to `0xEFFF` is manufacturer-specific and defined in the OEM's
diagnostic specification.

On the ECU side, implementing this well means a table rather than a `switch`:

```c
typedef struct {
    uint16_t did;
    uint8_t  len;
    uint8_t  min_session;                       /* session required */
    bool     needs_security;
    int    (*read)(uint8_t *out, uint8_t len);
} did_entry_t;

static const did_entry_t did_table[] = {
    { 0xF190, 17, SESSION_DEFAULT,  false, read_vin      },
    { 0xF189,  4, SESSION_DEFAULT,  false, read_sw_ver   },
    { 0x0100,  2, SESSION_EXTENDED, false, read_temp     },
    { 0x0200,  8, SESSION_EXTENDED, true,  read_cal_data },
};
```

That table is also what your test team will ask for, and what the OEM will review. Building
it as data rather than code makes both conversations shorter.

## Seed and key

Anything that can change vehicle behavior is behind `0x27`:

```
Tool → 27 01                      request seed, level 1
ECU  → 67 01 A3 5F 21 0C          here is a random seed
Tool → 27 02 <computed key>       here is the key
ECU  → 67 02                      unlocked
```

The algorithm turning seed into key is an OEM secret, delivered to suppliers as a DLL or a
signed library. It is usually not strong cryptography — historically a fixed transformation
with a secret constant — which is exactly why UDS security access is **not** a security
mechanism in the modern sense, and why ISO/SAE 21434 (lesson 6) pushed the industry toward
proper authentication for anything that matters.

On the ECU side, two things are mandatory: a **delay timer after failed attempts** (typically
10 seconds after three failures) and a rule that security drops on session change or S3
timeout. Both are usually explicitly tested during homologation.

## DTCs — the fault memory

A **Diagnostic Trouble Code** is a 3-byte identifier plus a status byte. `P0128` decodes as:

- `P` — powertrain (`C` chassis, `B` body, `U` network)
- `0` — generic SAE code (`1` = manufacturer-specific)
- `128` — the specific fault

The status byte is where the real information is:

| Bit | Name | Meaning |
| --- | --- | --- |
| 0 | testFailed | failing right now |
| 1 | testFailedThisOperationCycle | failed during this drive cycle |
| 2 | pendingDTC | failed once, not yet confirmed |
| 3 | **confirmedDTC** | failed enough times to be stored — this is the one that matters |
| 4 | testNotCompletedSinceLastClear | |
| 5 | testFailedSinceLastClear | |
| 6 | testNotCompletedThisOperationCycle | |
| 7 | warningIndicatorRequested | the dashboard lamp is on |

The lifecycle a fault goes through is a design decision, not an accident:

1. **Detected** — the monitor fails. Sets `testFailed`.
2. **Debounced** — must fail N times or for T seconds. A loose connector that blips once must
   not light the check-engine lamp.
3. **Pending** — failed but not confirmed.
4. **Confirmed** — failed on a second drive cycle, stored in NVM with a **freeze frame**
   (a snapshot of vehicle conditions when it occurred).
5. **Healing** — passes for 40 consecutive drive cycles, then self-clears.

Reading them:

```
Tool → 19 02 08          report DTCs with status mask 0x08 (confirmed)
ECU  → 59 02 FF P0 12 8 2F ...
```

Sub-function `0x02` (by status mask) and `0x04` (snapshot/freeze frame) are the two you will
use.

## Flashing

The reprogramming sequence, which every ECU must implement:

```
10 02                    enter programming session (usually jumps to the bootloader)
27 01 / 27 02            security access
28 03 01                 CommunicationControl: stop normal TX/RX — quiet the bus
31 01 FF 00              RoutineControl: erase memory
34 00 44 <addr> <size>   RequestDownload
36 01 <data...>          TransferData, block 1
36 02 <data...>          TransferData, block 2   ... repeat
37                       RequestTransferExit
31 01 FF 01              RoutineControl: check programming dependencies (CRC/signature)
11 01                    ECUReset
```

Two details that matter in the field:

- **The bootloader must survive a failed flash.** Power loss during `0x36` is normal, not
  exceptional. The standard design is an A/B partition scheme or a bootloader in write-protected
  flash that can always be re-entered.
- **`0x28 CommunicationControl` exists because flashing floods the bus.** Normal periodic
  messages are silenced during programming, which also means the rest of the car sees the ECU
  disappear — and every other ECU must handle that gracefully rather than raising its own
  DTCs.

## Trying it without a car

```bash
pip install udsoncan can-isotp
```

```python
import isotp, udsoncan
from udsoncan.connections import PythonIsoTpConnection
from udsoncan.client import Client
import udsoncan.services as svc

conn = PythonIsoTpConnection(
    isotp.socket(), address=isotp.Address(rxid=0x7E8, txid=0x7E0))

with Client(conn, request_timeout=2) as client:
    client.change_session(svc.DiagnosticSessionControl.Session.extendedDiagnosticSession)
    resp = client.read_data_by_identifier(0xF190)
    print("VIN:", resp.service_data.values[0xF190])

    dtcs = client.get_dtc_by_status_mask(0x08)
    for dtc in dtcs.service_data.dtcs:
        print(f"{dtc.id:06X} status={dtc.status.get_byte_as_int():02X}")
```

Point it at `vcan0` with a small Python ECU simulator on the other end, and you can develop a
complete diagnostic stack on a laptop.

## Check yourself

1. What is the positive response SID for a `0x22` request?
2. What does NRC `0x78` mean, and why must a client not treat it as a failure?
3. Why does a tool send `3E 00` every few seconds?
4. What is the difference between a pending and a confirmed DTC?

## Next

Lesson 4: AUTOSAR Classic. What the layers are for, what an SWC and the RTE actually do, and
why the configuration is bigger than the code.
