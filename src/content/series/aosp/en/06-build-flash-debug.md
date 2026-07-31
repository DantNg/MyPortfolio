---
lesson: 6
lang: en
title: "The Build, Flash and Debug Loop"
description: "Turning a two-hour cycle into a one-minute one: incremental builds, adb sync and remount, reading logcat and dumpsys properly, Perfetto, symbolising tombstones, and debugging native code on device."
duration: "17 min"
tags: ["AOSP", "Debugging", "adb"]
---

## The loop is the job

You will change one file thousands of times. If each iteration costs a full build and a full
flash, that is fifteen minutes per change and your day contains about thirty attempts. Get it
to one minute and it contains four hundred.

This lesson is a collection of the specific techniques that make that difference. None is
individually clever; together they are the difference between platform work being pleasant
and being miserable.

## Build only what changed

```bash
source build/envsetup.sh
lunch aosp_arm64-trunk_staging-userdebug

m my_service              # one module by name
mm                        # all modules in the current directory
mmm frameworks/base/services/core    # modules in a given directory
```

Two flags worth knowing:

```bash
m -j$(nproc) my_service                  # match your cores
m --skip-soong-tests my_service          # skip test targets
```

Most of the time in a small incremental build is the **metabuild** — Kati and Soong
regenerating Ninja files. That runs whenever a build file changes, and there is no way around
it except not touching build files. Editing only `.cpp` and `.java` keeps you on the fast
path.

## Push instead of flashing

Full flash is for partition layout changes, kernel changes, and anything in the boot chain.
For everything else, push:

```bash
adb root
adb remount               # make /system and /vendor writable
adb push $OUT/vendor/bin/devicestatusd /vendor/bin/
adb shell stop devicestatusd && adb shell start devicestatusd
```

`adb remount` needs `adb root`, which needs a `userdebug` or `eng` build, and on devices with
verified boot you also need `adb disable-verity` once followed by a reboot.

Better than pushing files individually:

```bash
adb sync                  # syncs everything in $OUT that differs. Takes seconds.
adb sync vendor           # just /vendor
```

`adb sync` compares and copies only what changed. For framework work:

```bash
m services                # build framework services jar
adb sync system
adb shell stop && adb shell start          # restart the framework, not the device
```

`stop` / `start` restarts `system_server` and everything above it in about ten seconds.
Compare that to a two-minute reboot, and it is the single highest-return trick in this
lesson.

For an app:

```bash
m MyApp && adb install -r $OUT/system/app/MyApp/MyApp.apk
```

When to actually flash:

```bash
adb reboot bootloader
fastboot flashall -w              # -w wipes userdata
fastboot flash vendor $OUT/vendor.img    # or just one partition
```

## logcat, properly

```bash
adb logcat -b all                        # main + system + crash + events + kernel
adb logcat -s MyTag:D                    # only this tag, debug and above
adb logcat *:E                           # errors and above, everything
adb logcat --pid=$(adb shell pidof devicestatusd)
adb logcat -b crash                      # just crashes
adb logcat -v threadtime,color           # timestamps + tid, coloured
adb logcat -c                            # clear, before reproducing a bug
adb logcat -d > log.txt                  # dump and exit
```

The buffers are worth knowing individually: `main` for apps, `system` for the framework,
`crash` for crashes, `events` for structured system events (this is where `boot_progress` and
ANR records live), and `kernel` for dmesg.

Two habits:

```bash
adb logcat -c && adb logcat -b all > bug.txt      # clear, reproduce, capture
```

and, in your own code, one consistent tag per component:

```cpp
#define LOG_TAG "DeviceStatus"
#include <log/log.h>
ALOGI("temperature=%d", temp);
ALOGE("failed to read: %s", strerror(errno));
```

## dumpsys

Every system service implements a dump method. This is Android's introspection interface and
it is chronically underused.

```bash
adb shell dumpsys                    # everything. Enormous. Redirect it.
adb shell dumpsys -l                 # list services you can dump

adb shell dumpsys activity activities     # activity stack
adb shell dumpsys window windows          # window layout, focus, z-order
adb shell dumpsys package com.example     # permissions, signatures, components
adb shell dumpsys battery                 # and: set level 50, unplug, reset
adb shell dumpsys meminfo <pid>           # detailed memory breakdown
adb shell dumpsys gfxinfo <pkg> framestats  # per-frame render timings
adb shell dumpsys SurfaceFlinger          # layers, composition, refresh
```

Implement it for your own service. Ten minutes of work, and it turns your service from opaque
to inspectable for everyone who touches it later:

```cpp
binder_status_t dump(int fd, const char** /*args*/, uint32_t /*n*/) override {
    dprintf(fd, "DeviceStatus:\n");
    dprintf(fd, "  temperature: %d\n", readTemp());
    dprintf(fd, "  fan: %d%%\n", mFanPercent);
    dprintf(fd, "  listeners: %zu\n", mListeners.size());
    dprintf(fd, "  errors since boot: %d\n", mErrorCount);
    return STATUS_OK;
}
```

## Crashes and tombstones

A native crash writes a tombstone:

```bash
adb shell ls /data/tombstones/
adb shell cat /data/tombstones/tombstone_00
adb logcat -b crash
```

The output is raw addresses. To make it readable:

```bash
export ANDROID_PRODUCT_OUT=$OUT
development/scripts/stack < tombstone_00
```

`stack` resolves addresses to file and line using `out/target/product/<board>/symbols/` —
which is why lesson 1 said to keep that directory for every build you flash. Without matching
symbols, a tombstone is a list of hex numbers.

Reading one:

```
signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0
```

- **SIGSEGV / addr 0x0** — null pointer dereference.
- **SIGSEGV / a small address** — offset from a null pointer, usually a member access on a
  null `this`.
- **SIGABRT** — an assertion, a `CHECK` failure, or an uncaught C++ exception. The abort
  message line right above the backtrace usually names it exactly.
- **SIGBUS** — misalignment or a truncated mmap.

For Java, an ANR writes `/data/anr/traces.txt` with a full thread dump of every process. The
first thread listed for the ANRing process is the one that was stuck; follow what it is
blocked on.

## Tracing with Perfetto

When something is slow rather than broken, tracing is the tool.

```bash
adb shell perfetto -o /data/misc/perfetto-traces/trace \
    -t 10s sched freq idle am wm gfx view binder_driver

adb pull /data/misc/perfetto-traces/trace
# open at ui.perfetto.dev
```

The `binder_driver` category is the one this series has been building towards. It shows every
transaction as a slice with its duration and both endpoints, so "the UI froze for 400 ms"
becomes "the UI thread was blocked in a Binder call to `PackageManagerService` for 380 ms",
which is an actionable statement.

Add your own trace points:

```cpp
#define ATRACE_TAG ATRACE_TAG_HAL
#include <utils/Trace.h>

void DeviceStatus::readSensors() {
    ATRACE_CALL();                       // scoped, named after the function
    ATRACE_BEGIN("i2c_read");
    // ...
    ATRACE_END();
}
```

```java
Trace.beginSection("loadConfig");
try { loadConfig(); } finally { Trace.endSection(); }
```

## Debugging native code on device

```bash
# attach lldb through adb
adb forward tcp:5039 tcp:5039
adb shell lldb-server platform --listen "*:5039" --server &
lldb
(lldb) platform select remote-android
(lldb) platform connect connect://localhost:5039
(lldb) attach --pid $(adb shell pidof devicestatusd)
```

Requires a `userdebug` build and matching symbols. In practice most platform debugging is
done with logs and traces rather than a debugger — the code is highly concurrent and stopping
one process often changes the behaviour you are chasing — but for a reproducible crash in
your own service, a debugger is still the fastest route.

Lighter-weight tools you will use more often:

```bash
adb shell debuggerd -b <pid>          # native backtrace of every thread, no debugger
adb shell kill -3 <pid>               # Java thread dump for a JVM process
adb shell strace -p <pid> -f          # syscalls, if strace is in your build
adb shell simpleperf record -p <pid> -g --duration 10   # sampling profiler
```

`debuggerd -b` deserves the emphasis: a full native backtrace of a live process, no setup, no
debugger, no stopping the process. For "what is this thing doing right now" it is the first
command to reach for.

## A working setup

```bash
# ~/.bashrc
export USE_CCACHE=1
export CCACHE_DIR=/mnt/fast/ccache

aosp() {
    cd ~/aosp && source build/envsetup.sh && lunch aosp_arm64-trunk_staging-userdebug
}

# build, push, restart, watch — the whole loop in one command
reload() {
    m "$1" && adb root && adb remount && adb sync vendor \
        && adb shell stop "$1" && adb shell start "$1" \
        && adb logcat -c && adb logcat -s "$1"
}
```

Anything you type more than five times a day belongs in a function like that. The point is
not the keystrokes — it is that a short loop changes how you work. When trying something
costs ten seconds you experiment; when it costs fifteen minutes you theorise, and theorising
is much less accurate.

## Where this leaves you

Six lessons: the tree and its build system, the boot chain, the Treble boundary and how to
write a HAL, Binder deeply enough to debug it, a complete system service including the
SELinux policy that gates it, and a development loop short enough to work in.

That is the layer below the app — the part with no tutorials, where the documentation is the
source, and where knowing *where to look* is most of the skill. The tree is enormous, and it
is also just C++, Java and build files written by people solving the same kinds of problems
you are.

## Check yourself

1. Why does `adb shell stop && adb shell start` beat a reboot for framework work?
2. What does `adb sync` do that `adb push` does not?
3. Why is `out/.../symbols/` necessary to read a tombstone?
4. What does the `binder_driver` Perfetto category let you see that logcat cannot?
