---
lesson: 2
lang: en
title: "The Boot Flow, End to End"
description: "Bootloader to kernel to init to Zygote to system_server, what the .rc language actually does, why Zygote forks instead of starting fresh, and how to find which stage your device died in."
duration: "16 min"
tags: ["AOSP", "init", "Boot"]
---

## Why this is the most useful thing to know

A device that does not boot gives you almost no information unless you know what should have
happened. Learn the sequence and every bring-up failure becomes "it died between stage 4 and
stage 5", which is a debuggable statement.

The whole chain, with rough timings on a mid-range device:

```
Boot ROM         → SoC mask ROM, verifies the bootloader        ~10 ms
Bootloader       → U-Boot / LK / ABL, loads boot.img            ~500 ms
Kernel           → drivers, mounts, hands over to init          ~2 s
init (1st stage) → mounts /system, /vendor, switches root       ~200 ms
init (2nd stage) → parses .rc files, starts services            ~1 s
Zygote           → preloads classes and resources               ~2 s
system_server    → starts ~80 system services                   ~4 s
SystemUI / Home  → first frame on screen                        ~2 s
                                                                -------
                                                                ~12 s
```

![The Android boot sequence](/MyPortfolio/images/aosp/boot-flow.svg)

## Bootloader and boot.img

The bootloader verifies and loads `boot.img`, which contains the kernel and the ramdisk. On
devices with **AVB (Android Verified Boot)** it checks signatures against `vbmeta.img` first,
and a mismatch stops the boot — this is why a hand-modified `system.img` produces a device
that will not start until you disable verification or re-sign.

Modern devices use **A/B partitions**: two complete copies of the system, so an OTA writes
the inactive slot and reboots into it. If it fails to mark itself successful, the bootloader
falls back to the old slot. Excellent for field updates, and a source of confusion during
development when you flash slot A and the device boots slot B.

```bash
fastboot getvar current-slot
fastboot set_active a
```

## Kernel to init

The kernel does what any Linux kernel does — brings up drivers, mounts the initial ramdisk —
and then executes `/init` as PID 1. Android's init is not systemd, not SysV. It is a
purpose-built PID 1 that reads `.rc` files.

**First stage init** runs from the ramdisk. Its job is small: mount `/system`, `/vendor` and
`/odm` (from the fstab in the device tree), set up dm-verity, then `switch_root` into
`/system` and re-execute itself as second stage.

**Second stage init** parses all the `.rc` files, sets properties, creates the property
service, and starts services.

```bash
# where the .rc files come from, in parse order
/system/etc/init/hw/init.rc          # the main one
/system/etc/init/*.rc                # framework services
/vendor/etc/init/*.rc                # your HALs and services
/odm/etc/init/*.rc
```

Note the modern layout: services no longer append to one big file. **Your service's `.rc`
sits next to your binary and is installed with it**, via `init_rc:` in `Android.bp`. This is
the mechanism you will use in lesson 5.

## The .rc language

Two constructs, and that is nearly all of it.

**Actions** — run commands when a trigger fires:

```
on early-init
    mkdir /mnt 0775 root system

on boot
    chown system system /sys/class/leds/red/brightness
    write /proc/sys/kernel/sched_latency_ns 10000000

on property:sys.boot_completed=1
    start my_late_service
```

Triggers are boot stages (`early-init`, `init`, `late-init`, `post-fs`, `post-fs-data`,
`boot`) or property changes. `post-fs-data` is the important one for anything that needs
`/data` — before it, `/data` is not mounted, and a service that writes there will fail
mysteriously.

**Services** — long-running processes init manages:

```
service my_service /vendor/bin/my_service
    class main
    user system
    group system inet
    capabilities NET_ADMIN
    priority -10
    oneshot                   # do not restart when it exits
    disabled                  # do not start automatically
    seclabel u:r:my_service:s0
```

The options that matter most:

- **`class`** — services start in class order, and `start class_main` starts the group.
- **`user` / `group`** — never `root` unless you can justify it. This is your first line of
  defence and reviewers will ask.
- **`disabled`** — start it explicitly later with `start my_service`, or from a property
  trigger.
- **`oneshot`** — without it, init restarts the process every time it exits. A crashing
  service without `oneshot` produces an infinite restart loop, and after enough of them init
  reboots the device into recovery. That is the "my device bootloops" bug.

## Properties

Android's global key–value store, readable by everything and central to how the platform is
configured:

```bash
getprop ro.build.version.sdk        # ro.* = read-only, set once at boot
getprop | grep vendor.acme          # everything matching
setprop debug.my.feature 1          # persist.* survives reboot
```

Prefixes carry meaning: `ro.` is immutable after boot, `persist.` is written to
`/data/property` and survives reboots, `debug.` is conventionally for development,
`vendor.` is namespaced for the vendor partition. SELinux controls who may set what — a
denied `setprop` fails silently, which is worth remembering when a property refuses to
change.

## Zygote: why fork instead of exec

```
service zygote /system/bin/app_process64 -Xzygote /system/bin --zygote --start-system-server
    class main
    priority -20
    socket zygote stream 660 root system
```

Zygote starts the ART runtime once, preloads about 2000 framework classes and the shared
resource pool, and then **sits waiting on a socket**. Every app launch is a `fork()` of
Zygote.

The reason is memory. After the fork, parent and child share every preloaded class and
resource through copy-on-write. Fifty running apps share one copy of the framework rather
than holding fifty. Starting each app with a fresh runtime would cost hundreds of megabytes
and add hundreds of milliseconds to every launch.

Two consequences you will meet in practice:

- **Anything preloaded by Zygote is in every process.** Adding a class to the preload list
  costs memory in all of them; this is why the list is guarded.
- **A Zygote crash restarts the entire framework** — every app dies and the device appears to
  reboot without actually rebooting. This is a "soft reboot" or "framework restart", and
  recognising it saves you from chasing a kernel bug that is not there.

## system_server

Zygote's first fork is `system_server`, and it is where Android actually lives: about eighty
services in one process, started in a fixed order in `SystemServer.java`.

```
Bootstrap:  ActivityManagerService, PowerManagerService, PackageManagerService,
            DisplayManagerService
Core:       BatteryService, UsageStatsService
Other:      WindowManagerService, InputManagerService, ConnectivityService,
            AudioService, CameraService, ~70 more
```

Two facts worth internalising:

**They are in one process.** A fatal exception in any of them kills `system_server`, which
kills the framework, which restarts everything. This is why system service code is defensive
to a degree that looks paranoid.

**The order is a dependency graph.** A service that touches `PackageManagerService` before it
exists gets a null. When you add your own service (lesson 5), where you put it in that list
is a real decision.

The final step: `ActivityManagerService.systemReady()` sets `sys.boot_completed=1`, launches
the Home activity, and broadcasts `BOOT_COMPLETED`.

## Finding where it died

The single most useful debugging skill in this series.

**Get a console.** A UART is worth whatever it costs to wire up — it shows bootloader and
kernel output that `adb` can never reach, because `adb` requires a booted USB stack.

**Then work down the chain:**

```bash
# 1. Does the bootloader see the device?
fastboot devices

# 2. Kernel messages — did it panic, did mounting fail?
adb shell dmesg | tail -50
cat /proc/last_kmsg              # or /sys/fs/pstore/console-ramoops after a crash

# 3. Did init start your services?
adb shell getprop | grep init.svc     # every service and its state
# running / stopped / restarting  — "restarting" means it keeps crashing

# 4. What happened in userspace?
adb logcat -b all
adb logcat -b crash                   # just the crashes

# 5. How long did each stage take?
adb shell dmesg | grep -i "boot_progress"
```

`getprop | grep init.svc` is the fastest single command for "why is my thing not running". It
lists every service init knows about and its current state, and `restarting` immediately
tells you the process is crashing rather than never being started.

For boot time specifically:

```bash
adb logcat -b events | grep boot_progress
# boot_progress_start, _preload_start, _system_run, _pms_ready, _enable_screen
```

The gap between two consecutive markers is the stage that is slow. That is how boot-time
optimisation work actually starts — not by guessing which service to defer.

## Check yourself

1. What does first-stage init do that second-stage does not?
2. Why does a service without `oneshot` risk bootlooping the device?
3. Why does Zygote fork rather than starting a new runtime per app?
4. Which single command tells you whether init started your service and whether it is
   crashing?

## Next

You have seen `/vendor` appear repeatedly. Lesson 3 explains why it exists: Project Treble,
the vendor/system split, VNDK, and the HIDL-to-AIDL transition that defines how HALs are
written today.
