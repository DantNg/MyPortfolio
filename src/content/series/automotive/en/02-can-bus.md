---
lesson: 2
lang: en
title: "CAN and CAN FD, Down to the Bit"
description: "Frame layout, how arbitration guarantees the most important message wins without losing any, reading a DBC file, and getting hands-on with SocketCAN."
duration: "17 min"
tags: ["Automotive", "CAN", "CAN FD"]
---

## The idea behind CAN

CAN was designed by Bosch in 1986 to replace point-to-point wiring, and the design decisions
still make sense today:

- **No addresses.** A frame carries an **identifier that describes the content**, not the
  recipient. `0x0C9` might mean "engine RPM". Every ECU on the bus receives every frame and
  filters for the ones it cares about.
- **Multi-master.** Any node may transmit whenever the bus is idle.
- **Non-destructive arbitration.** When two nodes start at once, one wins and the other backs
  off — and *no frame is lost or corrupted*. This is the clever part.
- **Two wires, differential.** CAN_H and CAN_L, twisted pair, 120 Ω terminator at each end.
  Robust against the electrical noise of an engine bay.

That content-addressed model has a real consequence for design: adding a new listener
requires **no change** to the sender. Adding a new sender requires updating the network
design document, because bus load and IDs are a shared budget.

## The frame

![CAN frame and arbitration](/MyPortfolio/images/automotive/can-frame.svg)

A standard data frame:

| Field | Bits | Meaning |
| --- | --- | --- |
| SOF | 1 | start of frame, dominant |
| **Identifier** | 11 | priority and content |
| RTR | 1 | remote transmission request (essentially unused today) |
| Control (IDE, r0, DLC) | 6 | DLC = number of data bytes |
| **Data** | 0–64 | the payload |
| CRC | 15 + delimiter | error detection |
| ACK | 2 | any receiver that got it correctly pulls this dominant |
| EOF + IFS | 10 | end of frame and inter-frame space |

Extended frames use a 29-bit identifier and are common in J1939 (trucks) and in diagnostics.

The **ACK slot** deserves a note: the transmitter sends it recessive, and *any* node that
received the frame correctly overwrites it dominant. So a transmitter alone on a bus with no
other nodes gets no ACK, retransmits, and eventually goes error-passive. If you ever see a
single node on a bench "not transmitting", that is usually why — you need a second node, or
a terminator and loopback mode.

## Arbitration — the elegant part

The bus is wired-AND: a `0` bit is **dominant**, a `1` bit is **recessive**. If any node
transmits 0, the bus reads 0.

Every transmitter listens to the bus while it sends. The rule:

> If I send a recessive bit and read back a dominant one, another node with a higher-priority
> ID is transmitting. I stop immediately and become a receiver.

Two nodes start together:

```
Node A (ID 0x100):  0 0 1 0 0 0 0 0 0 0 0
Node B (ID 0x1A0):  0 0 1 1  ← sends 1, reads 0, loses, stops
Bus:                0 0 1 0 0 0 0 0 0 0 0
```

Node A never notices anything happened and completes its frame normally. Node B retries as
soon as the bus is idle. **Nothing is lost, no bandwidth is wasted on collisions**, and the
lower the numeric ID, the higher the priority.

This is why network designers assign IDs carefully: `0x0C9` for a 10 ms engine torque message,
`0x6xx` for a 1000 ms diagnostic status. The ID *is* the priority, and it cannot be changed
later without renegotiating the whole network design.

The consequence for real-time analysis: a low-priority frame can be delayed by any number of
higher-priority frames. Worst-case latency for ID `x` is calculated from the arrival rate of
every ID below `x`, and CAN network design tools do exactly this analysis. Bus load above
about **40–50%** makes low-priority latency start to explode.

## CAN FD

CAN FD (Flexible Data-rate, 2012) keeps arbitration identical but changes the data phase:

| | CAN 2.0 | CAN FD |
| --- | --- | --- |
| Payload | 8 bytes | up to 64 bytes |
| Arbitration rate | up to 1 Mbit/s | same |
| Data phase rate | same as arbitration | up to 8 Mbit/s |
| CRC | 15-bit | 17 or 21-bit |

The trick: arbitration still happens at the slow rate, because it depends on every node
seeing the bit within one bit time across the whole bus. Once arbitration is won, only two
nodes matter — sender and receivers — so the bit rate can jump for the data phase.

Practically: **8× more data per frame with roughly the same overhead**, which is why every
new design uses it. A 64-byte frame also removes the multi-frame segmentation that made
8-byte CAN so awkward for anything structured.

## DBC files — the map of the network

A frame is 8 raw bytes. What turns it into `EngineSpeed = 2150 rpm` is a **DBC file**, the
OEM-owned database of every message and signal.

```
BO_ 201 ENGINE_DATA: 8 ECM
 SG_ EngineSpeed : 0|16@1+ (0.25,0) [0|16383.75] "rpm" DASH,ABS
 SG_ CoolantTemp : 16|8@1+ (1,-40) [-40|215] "degC" DASH
 SG_ ThrottlePos : 24|8@1+ (0.4,0) [0|100] "%" DASH
```

Reading the signal line `0|16@1+ (0.25,0)`:

- `0|16` — starts at bit 0, is 16 bits long
- `@1` — little-endian (Intel). `@0` would be big-endian (Motorola)
- `+` — unsigned. `-` would be signed
- `(0.25,0)` — **factor and offset**: `physical = raw × 0.25 + 0`
- `[0|16383.75]` — valid range
- `"rpm"` — unit
- `DASH,ABS` — which ECUs receive it

So a raw value of `8600` means `8600 × 0.25 = 2150 rpm`. That factor/offset scheme is how
CAN packs physical quantities into few bits: temperature as one byte with offset −40 covers
−40 °C to 215 °C in 1 °C steps.

Decoding one in Python:

```python
import cantools, can

db = cantools.database.load_file('powertrain.dbc')
bus = can.interface.Bus('vcan0', bustype='socketcan')

for msg in bus:
    try:
        decoded = db.decode_message(msg.arbitration_id, msg.data)
        print(f"{db.get_message_by_frame_id(msg.arbitration_id).name}: {decoded}")
    except KeyError:
        pass        # an ID not in this DBC
```

And encoding one:

```python
message = db.get_message_by_name('ENGINE_DATA')
data = message.encode({'EngineSpeed': 2150, 'CoolantTemp': 90, 'ThrottlePos': 35.2})
bus.send(can.Message(arbitration_id=message.frame_id, data=data, is_extended_id=False))
```

## Hands-on with SocketCAN

Linux treats CAN as a network interface, which makes the tooling excellent:

```bash
# virtual bus — no hardware
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan && sudo ip link set up vcan0

# real adapter at 500 kbit/s
sudo ip link set can0 type can bitrate 500000
sudo ip link set up can0

# CAN FD: 500k arbitration, 2M data
sudo ip link set can0 type can bitrate 500000 dbitrate 2000000 fd on
sudo ip link set up can0
```

The tools you will use daily:

```bash
candump vcan0                     # everything
candump vcan0,123:7FF             # only ID 0x123
candump -td vcan0                 # with delta timestamps  ← spotting jitter
candump -l vcan0                  # log to a file

cansend vcan0 123#DEADBEEF        # 4 data bytes
cansend vcan0 123##1DEADBEEF...   # CAN FD frame

cangen vcan0 -g 10 -I 123 -L 8    # generate traffic every 10 ms
canplayer -I candump.log          # replay a captured log  ← invaluable
canbusload vcan0@500000           # bus utilization
```

`canplayer` is worth highlighting: capture a bus trace from a real vehicle once, then replay
it at your desk forever. Most ECU development happens against replayed traces rather than a
car.

## Writing to CAN from C

SocketCAN uses ordinary sockets:

```c
#include <linux/can.h>
#include <linux/can/raw.h>
#include <net/if.h>
#include <sys/ioctl.h>
#include <sys/socket.h>

int can_open(const char *ifname)
{
    int s = socket(PF_CAN, SOCK_RAW, CAN_RAW);
    if (s < 0) return -1;

    struct ifreq ifr;
    strncpy(ifr.ifr_name, ifname, IFNAMSIZ - 1);
    ioctl(s, SIOCGIFINDEX, &ifr);

    struct sockaddr_can addr = {
        .can_family  = AF_CAN,
        .can_ifindex = ifr.ifr_ifindex,
    };
    if (bind(s, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        close(s);
        return -1;
    }
    return s;
}

int can_send_rpm(int s, uint16_t rpm)
{
    struct can_frame f = { .can_id = 0x201, .can_dlc = 8 };
    uint16_t raw = (uint16_t)(rpm / 0.25);      /* apply the DBC factor */
    f.data[0] = raw & 0xFF;                     /* little-endian */
    f.data[1] = raw >> 8;

    return write(s, &f, sizeof(f)) == sizeof(f) ? 0 : -1;
}
```

Hardware filtering, which matters on a busy bus, is one `setsockopt`:

```c
struct can_filter filters[2] = {
    { .can_id = 0x201, .can_mask = CAN_SFF_MASK },
    { .can_id = 0x300, .can_mask = 0x700 },      /* 0x300–0x3FF */
};
setsockopt(s, SOL_CAN_RAW, CAN_RAW_FILTER, filters, sizeof(filters));
```

On an MCU, the same filtering happens in the CAN peripheral's acceptance filters, and getting
it right is what keeps a small ECU from drowning in interrupts on a 60% loaded bus.

## Error handling

CAN has genuinely good error handling built into the silicon. Each node keeps two counters:

- **Error-active** (normal) — signals errors and keeps participating.
- **Error-passive** (TEC > 127) — still transmits, but stops signalling errors aggressively.
- **Bus-off** (TEC > 255) — removes itself from the bus entirely.

**Bus-off is the one to know.** A node that goes bus-off is silent until software resets the
controller. Causes: wrong bitrate, missing termination, a shorted transceiver, or being the
only node on the bus. Watch for it:

```bash
ip -details -statistics link show can0
# look for: bus-off, error counters, restart-ms
sudo ip link set can0 type can restart-ms 100    # automatic recovery
```

Half of "the CAN bus does not work" turns out to be termination: 120 Ω at each *end* of the
bus, giving 60 Ω measured across the pair with power off. Measure it before debugging code.

## Check yourself

1. Why does CAN arbitration not waste bandwidth on collisions?
2. A frame has ID `0x300`, another `0x180`. Which wins, and what happens to the loser?
3. In `0|16@1+ (0.1,-40)`, what physical value does raw `1000` represent?
4. Why does CAN FD keep the arbitration phase at the slow bitrate?

<details>
<summary>Answer to 3</summary>

`1000 × 0.1 + (−40) = 100 − 40 = 60`, in whatever unit the signal declares.
</details>

## Next

Lesson 3: diagnostics. UDS services, DTCs, the seed-and-key security handshake, and how a
workshop tool talks to an ECU you wrote.
