---
lesson: 5
lang: en
title: "Adding Your Own System Service"
description: "A complete native service: AIDL interface, implementation, init wiring, the SELinux policy that will block you three times, a framework manager class, and the permission check that belongs in the server."
duration: "18 min"
tags: ["AOSP", "SELinux", "AIDL"]
---

## What we are building

A device-status service: something that lives on the platform, reads board-specific hardware,
and exposes it to apps through a normal-looking Android API. It is the shape of most real
platform work — an ODM adding a feature that Android does not have a framework for.

Seven pieces, and they must all be present or it does not work:

```
1. AIDL interface          the contract
2. Native implementation   the code
3. Android.bp              how it builds
4. init .rc                how it starts
5. SELinux policy          permission to exist         <- where you will spend the time
6. Framework manager       what apps call
7. Permission              who is allowed
```

## 1. The interface

`frameworks/base/core/java/com/acme/devicestatus/IDeviceStatus.aidl` — or, for a fully
vendor-side service, under your own device directory:

```java
package com.acme.devicestatus;

interface IDeviceStatus {
    int    getBoardTemperature();
    String getSerialNumber();
    void   setFanSpeed(int percent);
    void   registerListener(IDeviceStatusListener listener);
}
```

```
aidl_interface {
    name: "com.acme.devicestatus",
    unstable: false,
    srcs: ["com/acme/devicestatus/*.aidl"],
    backend: {
        java: { enabled: true, platform_apis: true },
        ndk:  { enabled: true },
    },
}
```

## 2. The implementation

```cpp
#include <aidl/com/acme/devicestatus/BnDeviceStatus.h>
#include <android-base/file.h>
#include <android-base/logging.h>
#include <private/android_filesystem_config.h>

using aidl::com::acme::devicestatus::BnDeviceStatus;

class DeviceStatus : public BnDeviceStatus {
public:
    ndk::ScopedAStatus getBoardTemperature(int32_t* out) override {
        std::string s;
        if (!android::base::ReadFileToString(
                "/sys/class/thermal/thermal_zone0/temp", &s))
            return ndk::ScopedAStatus::fromServiceSpecificError(kErrIo);
        *out = std::stoi(s) / 1000;
        return ndk::ScopedAStatus::ok();
    }

    ndk::ScopedAStatus setFanSpeed(int32_t percent) override {
        // Enforce in the SERVER. Never trust the client to have checked.
        uid_t uid = AIBinder_getCallingUid();
        if (uid != AID_SYSTEM && uid != AID_ROOT)
            return ndk::ScopedAStatus::fromExceptionCode(EX_SECURITY);

        if (percent < 0 || percent > 100)
            return ndk::ScopedAStatus::fromExceptionCode(EX_ILLEGAL_ARGUMENT);

        return android::base::WriteStringToFile(std::to_string(percent),
                                                "/sys/class/hwmon/hwmon0/pwm1")
            ? ndk::ScopedAStatus::ok()
            : ndk::ScopedAStatus::fromServiceSpecificError(kErrIo);
    }
};

int main() {
    ABinderProcess_setThreadPoolMaxThreadCount(4);

    auto svc = ndk::SharedRefBase::make<DeviceStatus>();
    binder_status_t st = AServiceManager_addService(
            svc->asBinder().get(), "com.acme.devicestatus.IDeviceStatus/default");
    if (st != STATUS_OK) {
        LOG(FATAL) << "addService failed: " << st;   // almost always SELinux
    }

    ABinderProcess_joinThreadPool();
    return EXIT_FAILURE;
}
```

Note the permission check placement. **It is in the server**, using an identity the caller
cannot forge. A check in the client-side manager class is a convenience, not a security
boundary — anyone can call the Binder interface directly.

## 3 and 4. Build and start

```
cc_binary {
    name: "devicestatusd",
    srcs: ["main.cpp", "DeviceStatus.cpp"],
    shared_libs: ["libbase", "liblog", "libbinder_ndk", "com.acme.devicestatus-ndk"],
    init_rc: ["devicestatusd.rc"],
    vendor: true,
    cflags: ["-Wall", "-Werror"],
}
```

```
service devicestatusd /vendor/bin/devicestatusd
    class main
    user system
    group system
    seclabel u:r:devicestatusd:s0
```

```makefile
# device.mk
PRODUCT_PACKAGES += devicestatusd
```

Three files, and forgetting the third means a binary that builds perfectly and is not on the
device.

## 5. SELinux, where the time actually goes

Android runs SELinux in **enforcing** mode. Your service will be denied by default, three
separate times, and each denial looks like a different bug.

Policy goes in `device/acme/board1/sepolicy/`.

**Declare the domain** — `devicestatusd.te`:

```
type devicestatusd, domain;
type devicestatusd_exec, exec_type, vendor_file_type, file_type;

# init starts it, and it transitions into its own domain
init_daemon_domain(devicestatusd)

# it may register with servicemanager
add_service(devicestatusd, devicestatus_service)

# it may use binder at all
binder_use(devicestatusd)

# it may read thermal sysfs
allow devicestatusd sysfs_thermal:file r_file_perms;
allow devicestatusd sysfs_hwmon:file rw_file_perms;
```

**Label the binary** — `file_contexts`:

```
/vendor/bin/devicestatusd    u:object_r:devicestatusd_exec:s0
```

**Declare the service name** — `service.te` and `service_contexts`:

```
type devicestatus_service, service_manager_type;
```

```
com.acme.devicestatus.IDeviceStatus/default    u:object_r:devicestatus_service:s0
```

**Allow clients to find it** — in `system_app.te` or wherever your client lives:

```
allow system_app devicestatus_service:service_manager find;
```

**And point the build at your policy** — `BoardConfig.mk`:

```makefile
BOARD_VENDOR_SEPOLICY_DIRS += device/acme/board1/sepolicy
```

### The workflow that actually works

Do not write policy by guessing. Run it, collect the denials, generate the rules.

```bash
# 1. temporarily permissive, to collect ALL denials rather than the first
adb shell setenforce 0

# 2. exercise your service
adb shell am start ...

# 3. read the denials
adb shell dmesg | grep avc
adb logcat | grep avc

# 4. generate candidate rules
adb shell dmesg | grep avc > denials.txt
audit2allow -i denials.txt

# 5. back to enforcing and verify
adb shell setenforce 1
```

A denial reads:

```
avc: denied { read } for pid=1234 comm="devicestatusd"
     name="temp" dev="sysfs" ino=12345
     scontext=u:r:devicestatusd:s0
     tcontext=u:object_r:sysfs:s0 tclass=file permissive=0
```

- `scontext` — who was denied (your service)
- `tcontext` — what they touched (an unlabelled sysfs file)
- `tclass` + `{ read }` — the operation

**Two warnings about `audit2allow`.** It gives you a starting point, not an answer — it will
happily suggest broad rules like `allow devicestatusd sysfs:file rw_file_perms` that grant
access to all of sysfs. Narrow it to the specific type. And when the target is generic
`sysfs`, the right fix is usually to **label the specific file** in `genfs_contexts` rather
than to widen access:

```
genfscon sysfs /devices/virtual/thermal/thermal_zone0/temp u:object_r:sysfs_thermal:s0
```

Finally: `setenforce 0` is a development tool. Test the finished product on a `user` build
with SELinux enforcing, because that is what ships and permissive-only bugs are real.

## 6. The framework side

Apps should not call Binder interfaces directly. Wrap it:

```java
package android.acme;

@SystemService(Context.DEVICE_STATUS_SERVICE)
public class DeviceStatusManager {
    private final IDeviceStatus mService;

    public int getBoardTemperature() {
        try {
            return mService.getBoardTemperature();
        } catch (RemoteException e) {
            throw e.rethrowFromSystemServer();
        }
    }

    @RequiresPermission(android.Manifest.permission.MANAGE_DEVICE_STATUS)
    public void setFanSpeed(int percent) {
        try {
            mService.setFanSpeed(percent);
        } catch (RemoteException e) {
            throw e.rethrowFromSystemServer();
        }
    }
}
```

Register it in `SystemServiceRegistry.java`:

```java
registerService(Context.DEVICE_STATUS_SERVICE, DeviceStatusManager.class,
    new CachedServiceFetcher<DeviceStatusManager>() {
        @Override
        public DeviceStatusManager createService(ContextImpl ctx) {
            IBinder b = ServiceManager.getServiceOrThrow(Context.DEVICE_STATUS_SERVICE);
            return new DeviceStatusManager(ctx, IDeviceStatus.Stub.asInterface(b));
        }
    });
```

`rethrowFromSystemServer()` is the platform convention: if the system server died, the app
should die too rather than continue with a broken world view.

## 7. The permission

`frameworks/base/core/res/AndroidManifest.xml`:

```xml
<permission android:name="android.permission.MANAGE_DEVICE_STATUS"
            android:protectionLevel="signature|privileged" />
```

`signature|privileged` means only apps signed with the platform key, or privileged apps in
`/system/priv-app`, may hold it. For a platform feature that controls hardware, that is the
right level — `dangerous` would put it in front of the user as a runtime prompt, which is
wrong for something no ordinary app should ever have.

Privileged apps also need an entry in `/etc/permissions/privapp-permissions-*.xml`, or the
device refuses to boot with a "privapp permissions violation" — a startling first encounter,
and a deliberate safety net.

## When it does not work

In order, because this ordering saves the most time:

```bash
# is the binary on the device?
adb shell ls -lZ /vendor/bin/devicestatusd    # -Z shows the SELinux label too

# did init start it? is it crash-looping?
adb shell getprop | grep init.svc.devicestatusd

# did it register?
adb shell service list | grep devicestatus

# what is SELinux saying?
adb shell dmesg | grep avc | grep devicestatus

# what did it log?
adb logcat -s devicestatusd
```

Nine times out of ten the answer is in one of those five commands, and the most common single
cause is SELinux — either the service could not register, or the client could not find it.

## Check yourself

1. Why must the permission check live in the service and not in the manager class?
2. What are the four separate SELinux artefacts a new service needs?
3. Why is labelling a specific sysfs file better than what `audit2allow` suggests?
4. What does `rethrowFromSystemServer` express?

## Next

The last lesson is the daily loop: incremental builds that take one minute instead of two
hours, `adb sync` and remount, reading logcat and dumpsys properly, Perfetto, symbolising
tombstones, and debugging native code on a device.
