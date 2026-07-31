---
lesson: 3
lang: en
title: "Treble, and Writing a HAL"
description: "Why /vendor and /system are separate, what VNDK actually restricts, HIDL versus AIDL and why AIDL won, the VINTF manifest and compatibility matrix, and a HAL written end to end."
duration: "17 min"
tags: ["AOSP", "Treble", "HAL", "AIDL"]
---

## The problem Treble solved

Before Android 8, a framework upgrade meant recompiling every vendor blob against the new
framework, because vendor code linked directly against framework libraries. That is why
Android updates took eighteen months to reach devices, and why most never got them.

**Project Treble draws a hard binary interface between `/system` and `/vendor`.** Above the
line, Google's framework. Below it, the silicon vendor's HALs and drivers. They talk only
through versioned, stable interfaces. Upgrade the framework, keep the vendor image, and the
device still works.

For you as an engineer, Treble is a set of constraints you will run into constantly, and they
make much more sense once you know what they are protecting.

![The Treble boundary](/MyPortfolio/images/aosp/treble.svg)

## What the boundary actually enforces

**Partitions.** `/system` is framework, `/vendor` is silicon-specific, `/odm` is
ODM/board-specific, `/product` is product customisation. Your HAL goes in `/vendor`. The
`vendor: true` line in `Android.bp` is what puts it there.

**VNDK.** Vendor processes may not link against arbitrary system libraries. They get the
VNDK — a fixed, versioned set (`libbase`, `libcutils`, `libutils`, `liblog`, and so on) —
plus their own. Link against something outside it and the build fails with an error about
`vendor_available`.

```
cc_library_shared {
    name: "libmyvendorstuff",
    vendor: true,                    // /vendor only
    // or:
    vendor_available: true,          // built twice, for both sides
    shared_libs: ["libbase", "liblog"],   // must be VNDK or vendor libs
}
```

The rule that trips people up: **there are two copies of a `vendor_available` library on the
device**, one in `/system/lib64` and one in `/vendor/lib64`, and they may be different
versions. They do not share state. A singleton in such a library is a singleton *per side*,
which produces bugs that look impossible until you know this.

**Namespaces.** The linker enforces the above at runtime. `library "libfoo.so" not found` in
logcat, for a library that visibly exists on the device, is almost always a namespace
violation rather than a missing file.

## HIDL, and why AIDL replaced it

HIDL arrived with Treble in Android 8 as the stable HAL IPC language. It worked, and it was a
second interface definition language to learn, with its own toolchain, its own generated
code, and its own quirks — while AIDL already existed for framework IPC.

From Android 11, **AIDL gained a stable variant** and became the recommended way to write
HALs. Since Android 13 new HALs must be AIDL. HIDL is frozen and deprecated.

Practically: **write AIDL for anything new**, and expect to read HIDL in existing vendor
trees for years. The concepts map closely, so knowing one gets you most of the way to the
other.

| | HIDL | Stable AIDL |
|---|---|---|
| Files | `.hal` | `.aidl` |
| Versioning | new package directory | `frozen` API dumps in `aidl_api/` |
| Languages | C++, Java | C++, Java, Rust, NDK backend |
| Status | deprecated | current |

## Writing a HAL interface

The interface definition, in `hardware/interfaces/acme/led/aidl/android/hardware/acme/led/`:

```java
package android.hardware.acme.led;

@VintfStability
interface ILedControl {
    void setBrightness(int id, int brightness);
    int  getBrightness(int id);
    int[] getSupportedLeds();
    void registerCallback(ILedCallback cb);
}
```

`@VintfStability` is what makes it a HAL interface rather than an internal one: it enforces
that the interface is versioned, frozen when released, and declared in VINTF. Leave it off
and the interface is fine for use inside one partition but cannot cross the Treble boundary.

The build rule:

```
aidl_interface {
    name: "android.hardware.acme.led",
    vendor_available: true,
    srcs: ["android/hardware/acme/led/*.aidl"],
    stability: "vintf",
    owner: "acme",
    backend: {
        cpp:  { enabled: false },     // use ndk for vendor code
        ndk:  { enabled: true },
        java: { enabled: true },
    },
    versions_with_info: [
        { version: "1", imports: [] },
    ],
}
```

Two things to note. **Use the `ndk` backend for vendor code**, not `cpp` — the NDK backend
links against `libbinder_ndk`, which is the stable ABI; the `cpp` backend uses `libbinder`,
which is not, and is therefore system-side only.

And **`versions_with_info`** is the versioning mechanism. `m android.hardware.acme.led-freeze-api`
writes an immutable API dump into `aidl_api/`. After freezing, any incompatible change fails
the build — which is the entire point, and will feel obstructive right up until it saves you
from breaking a shipped device.

## Implementing it

```cpp
#include <aidl/android/hardware/acme/led/BnLedControl.h>
#include <android-base/file.h>

using aidl::android::hardware::acme::led::BnLedControl;

class LedControl : public BnLedControl {
public:
    ndk::ScopedAStatus setBrightness(int32_t id, int32_t brightness) override {
        if (id < 0 || id >= kLedCount)
            return ndk::ScopedAStatus::fromExceptionCode(EX_ILLEGAL_ARGUMENT);

        std::string path = "/sys/class/leds/led" + std::to_string(id) + "/brightness";
        if (!android::base::WriteStringToFile(std::to_string(brightness), path))
            return ndk::ScopedAStatus::fromServiceSpecificError(kErrorHardware);

        return ndk::ScopedAStatus::ok();
    }
    // ...
};

int main() {
    ABinderProcess_setThreadPoolMaxThreadCount(4);

    auto svc = ndk::SharedRefBase::make<LedControl>();
    const std::string name = std::string(LedControl::descriptor) + "/default";

    binder_status_t s = AServiceManager_addService(svc->asBinder().get(), name.c_str());
    CHECK_EQ(s, STATUS_OK);

    ABinderProcess_joinThreadPool();
    return EXIT_FAILURE;                  // joinThreadPool never returns
}
```

The instance name — `android.hardware.acme.led.ILedControl/default` — is the string clients
look up. `default` is the convention for a single instance; use distinct names when you have
several.

## VINTF: declaring and requiring

Two XML files enforce that framework and vendor agree.

**The vendor manifest** — what this device provides, in `device/acme/board1/manifest.xml`:

```xml
<manifest version="1.0" type="device">
  <hal format="aidl">
    <name>android.hardware.acme.led</name>
    <version>1</version>
    <interface>
      <name>ILedControl</name>
      <instance>default</instance>
    </interface>
  </hal>
</manifest>
```

**The framework compatibility matrix** — what the framework requires. If a HAL is marked
`optional="false"` in the matrix and missing from the manifest, **the build fails**. That is
deliberate: it stops a device shipping without a mandatory HAL and discovering it at runtime.

Checking on a device:

```bash
adb shell vintf                        # dump both, and the compatibility check
adb shell lshal                        # every registered HAL, and its clients
adb shell lshal debug android.hardware.acme.led.ILedControl/default
```

`lshal` is the first thing to run when a client cannot find your HAL. If the service is not
listed, the problem is that it did not start (lesson 2: `getprop | grep init.svc`) or that
`addService` failed. If it is listed but the client still fails, the problem is SELinux
(lesson 5).

## Wiring it into the build

```
# Android.bp
cc_binary {
    name: "android.hardware.acme.led-service",
    relative_install_path: "hw",
    vendor: true,
    init_rc: ["android.hardware.acme.led-service.rc"],
    vintf_fragments: ["android.hardware.acme.led-service.xml"],
    srcs: ["service.cpp", "LedControl.cpp"],
    shared_libs: [
        "libbase", "liblog", "libbinder_ndk",
        "android.hardware.acme.led-V1-ndk",
    ],
}
```

```
# .rc file
service vendor.acme.led /vendor/bin/hw/android.hardware.acme.led-service
    class hal
    user system
    group system
    seclabel u:r:hal_acme_led_default:s0
```

```makefile
# device.mk
PRODUCT_PACKAGES += android.hardware.acme.led-service
```

`vintf_fragments` is the modern way to declare the HAL — the fragment is merged into the
device manifest at build time, so the declaration lives next to the code that implements it
rather than in a central file everyone edits.

## Calling it from the framework

```java
import android.hardware.acme.led.ILedControl;

IBinder b = ServiceManager.waitForDeclaredService(
        "android.hardware.acme.led.ILedControl/default");
ILedControl led = ILedControl.Stub.asInterface(b);
led.setBrightness(0, 128);
```

`waitForDeclaredService` blocks until the service appears, which avoids the race where your
framework code starts before the HAL. `getService` returns null in that window and a
surprising amount of bring-up debugging is caused by using it.

Note that framework code calling a vendor HAL directly is only permitted for HALs the
framework knows about. Your own HAL will normally be called by your own system service —
which is lesson 5.

## Check yourself

1. What does the VNDK restrict, and what error do you see when you violate it?
2. Why must vendor code use the NDK backend of AIDL rather than the C++ backend?
3. What does freezing an AIDL interface prevent, and where does the dump live?
4. Your client cannot find your HAL. What are the three things to check, in order?

## Next

Everything here rides on Binder, and so far it has been a black box. Lesson 4 opens it: the
kernel driver, Parcels, the one-copy transaction, servicemanager, the thread pool and its
limits, death recipients, and how to debug a Binder problem instead of guessing at one.
