---
lesson: 5
lang: en
title: "AUTOSAR Adaptive, SOME/IP and the Software-Defined Vehicle"
description: "Why signals gave way to services, how SOME/IP discovery works, what ara::com code looks like, and where Android Automotive fits in the stack."
duration: "15 min"
tags: ["Automotive", "AUTOSAR Adaptive", "SOME/IP"]
---

## Signals versus services

Classic AUTOSAR is **signal-oriented**. The network design decides that CAN ID `0x201` is
sent every 10 ms and contains `VehicleSpeed` at bit 0. Every receiver is configured at build
time to expect exactly that. It is deterministic, analysable, and completely rigid.

Adaptive is **service-oriented**. A provider offers a service — "vehicle speed, subscribe if
you want it" — and consumers find it at runtime and subscribe. Nothing about the consumer
is baked into the provider.

| | Signal-oriented (Classic) | Service-oriented (Adaptive) |
| --- | --- | --- |
| Binding | build time | runtime discovery |
| Data flow | broadcast, always sent | subscribe; sent to subscribers |
| Adding a consumer | reconfigure the network | just subscribe |
| Adding a provider | reconfigure the network | just offer |
| Determinism | high, analysable | lower, harder to bound |
| Typical transport | CAN | Ethernet |

The shift is driven by the same thing as zonal architecture: features are becoming software,
and software you can add over the air cannot have its consumers hardcoded at build time.

## SOME/IP

**SOME/IP** (Scalable service-Oriented MiddlewarE over IP) is the automotive middleware
protocol that carries this. Three mechanisms:

**1. Request/response** — a remote procedure call:

```
Client → Server:  [Service 0x1234][Method 0x0001][Request ID][payload]
Server → Client:  [Service 0x1234][Method 0x0001][Request ID][return]
```

**2. Events** — publish/subscribe, the workhorse for sensor data:

```
Client → Server:  SubscribeEventgroup
Server → Client:  SubscribeEventgroupAck
Server → Client:  Event(speed = 52)      ... repeatedly, as it changes
```

**3. Fields** — a value with a getter, a setter and a change notification. Convenient for
configuration-like state.

The header is compact and fixed:

| Field | Bytes | Purpose |
| --- | --- | --- |
| Service ID | 2 | which service |
| Method/Event ID | 2 | which operation |
| Length | 4 | payload length |
| Client ID + Session ID | 4 | request correlation |
| Protocol/Interface version | 2 | compatibility |
| Message type | 1 | REQUEST, RESPONSE, NOTIFICATION, ERROR |
| Return code | 1 | E_OK, E_NOT_OK, … |

## Service discovery

**SOME/IP-SD** is what makes runtime binding work. It runs over UDP multicast:

```
Server → multicast:  OfferService(0x1234, instance 1, TTL 3s)
Client → Server:     SubscribeEventgroup(0x1234, eventgroup 1)
Server → Client:     SubscribeEventgroupAck
Server → Client:     ... events flow ...
Server → multicast:  StopOfferService     (or the TTL simply expires)
```

A client that starts first sends `FindService` and waits; a server that starts first offers
repeatedly. The TTL matters: if the provider dies, subscriptions expire and consumers find
out, instead of silently receiving nothing forever.

This is the mechanism that makes an over-the-air feature install possible. A new application
offers a new service, existing consumers discover it, and no other ECU was reconfigured.

## ara::com — what the code looks like

AUTOSAR Adaptive standardizes a C++ API. Given a service description in ARXML, the toolchain
generates proxy and skeleton classes.

**Provider (skeleton):**

```cpp
#include "ara/com/speed_service_skeleton.h"

class SpeedServiceImpl : public SpeedServiceSkeleton {
public:
    explicit SpeedServiceImpl(ara::com::InstanceIdentifier id)
        : SpeedServiceSkeleton(id) {}

    /* a method the client can call */
    ara::core::Future<GetMaxSpeedOutput> GetMaxSpeed() override {
        ara::core::Promise<GetMaxSpeedOutput> promise;
        promise.set_value({ .maxSpeed = 180u });
        return promise.get_future();
    }
};

int main() {
    ara::core::Initialize();

    SpeedServiceImpl service{ ara::com::InstanceIdentifier{"1"} };
    service.OfferService();

    while (running) {
        auto speed = read_speed_sensor();
        service.CurrentSpeed.Update(speed);   /* notify every subscriber */
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    service.StopOfferService();
    ara::core::Deinitialize();
}
```

**Consumer (proxy):**

```cpp
#include "ara/com/speed_service_proxy.h"

int main() {
    ara::core::Initialize();

    auto handles = SpeedServiceProxy::FindService(
            ara::com::InstanceIdentifier::Any);

    if (handles.Value().empty()) { return 1; }

    SpeedServiceProxy proxy{ handles.Value()[0] };

    proxy.CurrentSpeed.SetReceiveHandler([&proxy]() {
        proxy.CurrentSpeed.GetNewSamples([](auto sample) {
            std::cout << "speed: " << *sample << '\n';
        });
    });
    proxy.CurrentSpeed.Subscribe(/*maxSampleCount=*/ 5);

    /* a method call returns a future */
    auto future = proxy.GetMaxSpeed();
    std::cout << "max: " << future.get().maxSpeed << '\n';
}
```

If you have written modern C++ with futures and callbacks, this is familiar. That is the
point: Adaptive deliberately looks like general systems programming, because the people it
needs to hire come from there.

## The rest of the Adaptive platform

Beyond `ara::com`, the functional clusters you will meet:

| Cluster | Provides |
| --- | --- |
| `ara::exec` | Execution Management — starts applications, manages machine states |
| `ara::com` | Communication Management — the API above |
| `ara::diag` | Diagnostics — UDS, on POSIX this time |
| `ara::per` | Persistency — key/value and file storage with redundancy |
| `ara::log` | Logging and tracing, DLT-compatible |
| `ara::crypto` | Cryptography and key storage |
| `ara::iam` | Identity and Access Management |
| `ara::ucm` | Update and Configuration Management — **OTA** |

`ara::ucm` is arguably the reason Adaptive exists. It defines how a software package is
transferred, verified, activated, and rolled back if the activation fails — the machinery a
software-defined vehicle needs.

The platform runs on a **POSIX** OS (a PSE51 subset): Linux with PREEMPT_RT, or QNX for
safety-certified work. That immediately gives you dynamic memory, threads, filesystems, and
processes — everything Classic deliberately forbids, with all the analysability that costs.

## Where Android Automotive fits

Android Automotive OS is a third platform, and it sits above the others rather than beside
them. It runs the infotainment experience and reaches the vehicle through the **Vehicle HAL
(VHAL)**:

```
Android app (Kotlin/Java)
  → Car API  (CarPropertyManager)
  → CarService  (system service)
  → Vehicle HAL  (HIDL/AIDL interface)     ← the boundary you implement
  → your native middleware  (C++)
  → SOME/IP or CAN
  → the rest of the car
```

VHAL exposes vehicle state as **properties**, each with a standard ID, and your job as a
middleware developer is usually to implement that HAL on top of whatever the vehicle networks
actually speak:

```cpp
/* simplified VHAL get */
StatusCode VehicleHal::get(const VehiclePropValue& requested,
                           VehiclePropValuePtr* outValue) {
    switch (requested.prop) {
    case toInt(VehicleProperty::PERF_VEHICLE_SPEED):
        (*outValue)->value.floatValues[0] = someip_client_->getSpeed();
        return StatusCode::OK;

    case toInt(VehicleProperty::HVAC_TEMPERATURE_SET):
        (*outValue)->value.floatValues[0] = hvac_->targetTemp(requested.areaId);
        return StatusCode::OK;

    default:
        return StatusCode::INVALID_ARG;
    }
}
```

This is exactly the kind of work that sits between Android and the vehicle networks, and it
is where a lot of automotive middleware jobs actually are: C++ on the Android side of the
boundary, IPC, and a protocol stack underneath.

## Classic and Adaptive together

They are not competitors; a real vehicle uses both:

```
        HPC (SoC, Linux/QNX)
        ┌────────────────────────────────┐
        │  ADAS fusion  │  Vehicle apps  │   ← Adaptive, C++, SOME/IP
        │  ara::com · ara::ucm · ara::diag│
        └────────────┬───────────────────┘
                     │ Automotive Ethernet
        ┌────────────┴───────────────────┐
        │  Zone controllers               │   ← Classic, C, deterministic
        │  AUTOSAR Classic · CAN/LIN      │
        └────────────┬───────────────────┘
                     │ CAN FD / LIN
              sensors and actuators
```

The rule of thumb: **safety-critical, hard real-time, cheap MCU → Classic. Compute-heavy,
updatable, service-oriented → Adaptive.** A brake controller will be Classic for a long time
yet.

## Trying SOME/IP without a vehicle

Two open-source stacks let you experiment on a laptop:

```bash
# vsomeip — the reference implementation, from Genivi/COVESA
git clone https://github.com/COVESA/vsomeip
cd vsomeip && mkdir build && cd build
cmake .. && make -j$(nproc) && sudo make install
```

**CommonAPI C++** sits on top and generates proxies from Franca IDL, which is close to the
`ara::com` experience. Running a provider and a consumer as two processes on `localhost`,
with Wireshark decoding SOME/IP, teaches the discovery flow faster than any document.

Wireshark has a built-in SOME/IP dissector — capture on `lo`, filter `someip`, and you can
watch `OfferService` and `SubscribeEventgroup` go past.

## Check yourself

1. What is the practical difference between a signal and a service when you add a new
   consumer?
2. What does the TTL in `OfferService` protect against?
3. Which functional cluster handles over-the-air updates?
4. In an Android Automotive stack, what sits between `CarService` and the vehicle network?

## Next

The final lesson: functional safety and cybersecurity. ISO 26262, what ASIL means for the
code you write, and how ISO/SAE 21434 changed what you are allowed to ship.
