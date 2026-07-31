---
lesson: 1
lang: en
title: "The Tree and the Build System"
description: "What repo and the manifest actually do, how to navigate 200 GB of source, Soong versus Make, what lunch really sets, and what comes out of out/ at the end."
duration: "16 min"
tags: ["AOSP", "Soong", "Build"]
---

## What you are actually getting into

AOSP is roughly 200 GB checked out, 400 GB after a build, and the first full build takes
one to four hours on a decent machine. It contains about 2500 git repositories. There is no
version of this that is small.

If you come from firmware, the mental adjustment is this: **AOSP is not a project, it is a
distribution.** It is closer to a Linux distro than to an application — a kernel, a libc, a
runtime, a few thousand packages, and a build system that assembles them into partition
images. Nobody understands all of it. You need to understand the parts you touch and how to
find the rest.

## repo and the manifest

`repo` is a Python wrapper over git that manages those 2500 repositories as one unit.

```bash
mkdir aosp && cd aosp
repo init -u https://android.googlesource.com/platform/manifest -b android-15.0.0_r1
repo sync -c -j8 --no-tags --no-clone-bundle
```

- `-b` is the branch or tag. **Always pin one.** Syncing `main` gets you whatever landed that
  morning, which is not what you want to base a product on.
- `-c` fetches only the current branch. Without it you fetch all history for 2500 repos.
- `-j8` is parallel jobs. More is not always faster; you will be network-bound.

The manifest is a single XML file listing every repository and where it goes in the tree:

```xml
<project path="frameworks/base" name="platform/frameworks/base" />
<project path="system/core"     name="platform/system/core" />
```

This is the mechanism you will use for your own hardware. A local manifest at
`.repo/local_manifests/my_device.xml` adds your repositories to the sync without modifying
Google's:

```xml
<manifest>
  <project path="device/acme/board1" name="acme/board1" remote="acme" revision="main" />
  <remove-project name="platform/packages/apps/Browser2" />
</manifest>
```

`repo sync` after that pulls your device tree in alongside everything else. This is how every
vendor and every custom ROM does it.

Useful daily commands:

```bash
repo status                          # what have I modified, across all repos
repo forall -c 'git checkout .'      # run a command in every repository
repo start mywork platform/frameworks/base    # branch in one repo
repo diff                            # combined diff
```

## Navigating 200 GB

The directories you will actually spend time in:

| Path | What lives there |
|---|---|
| `frameworks/base/` | the Java framework, `system_server`, most system services |
| `frameworks/native/` | native services — SurfaceFlinger, libbinder, input |
| `system/core/` | init, logd, libcutils, adb — the very bottom of userspace |
| `hardware/interfaces/` | AIDL/HIDL HAL definitions |
| `hardware/<vendor>/` | vendor HAL implementations |
| `device/<vendor>/<board>/` | **your board's configuration — where you work** |
| `packages/apps/` | bundled apps: Settings, Launcher, Camera |
| `build/soong/`, `build/make/` | the build system itself |
| `external/` | third-party code — libpng, sqlite, ~1000 more |
| `out/` | everything generated. Never edit; delete freely |

**Learn to search, not to browse.** The tree is too large to read. Three tools, in order of
how often you will want them:

```bash
# ripgrep: fastest, worth installing
rg "startService" frameworks/base/services/

# built-in helpers, available after envsetup.sh
cgrep  "binder_thread_read"     # C/C++ only
jgrep  "PackageManagerService"  # Java only
mgrep  "TARGET_BOARD"           # build files only
godir  ActivityManagerService   # jump to a file by name
```

And for reading rather than grepping, use a code search site — `cs.android.com` — which
cross-references definitions and callers across the whole tree. It is faster than any local
IDE index for a codebase this size.

## Soong, Make and the two file types

AOSP has moved from Make to **Soong**, which reads `Android.bp` files. Blueprint files are
declarative — no conditionals, no loops, no shell:

```
cc_binary {
    name: "my_service",
    srcs: ["main.cpp", "service.cpp"],
    shared_libs: ["libbinder", "libutils", "liblog"],
    static_libs: ["libmystuff"],
    init_rc: ["my_service.rc"],
    vendor: true,              // installs to /vendor, not /system
    cflags: ["-Wall", "-Werror"],
}
```

Common module types:

- `cc_binary`, `cc_library_shared`, `cc_library_static`, `cc_test` — native code
- `java_library`, `android_app` — Java/Kotlin
- `aidl_interface` — generates client and server stubs from `.aidl` (lesson 5)
- `prebuilt_etc` — drop a config file into the image

Older parts of the tree still use `Android.mk`, which is Make and does allow conditionals.
New code should be `.bp`. When you need logic that Blueprint cannot express, the escape hatch
is a `genrule` or a Go extension, not a return to Make.

Product configuration remains Makefile-based, in `device/<vendor>/<board>/`:

```makefile
# device.mk
PRODUCT_PACKAGES += my_service MyApp
PRODUCT_COPY_FILES += device/acme/board1/init.board1.rc:$(TARGET_COPY_OUT_VENDOR)/etc/init/init.board1.rc
PRODUCT_PROPERTY_OVERRIDES += ro.acme.variant=pro
```

**`PRODUCT_PACKAGES` is the line that catches everyone.** A module can build perfectly and
still not appear on the device, because nothing asked for it to be installed. If your binary
is not in the image, check this first — it is the answer more often than not.

![The AOSP build, from source to images](/MyPortfolio/images/aosp/build-system.svg)

## lunch, and what it actually sets

```bash
source build/envsetup.sh
lunch aosp_arm64-trunk_staging-userdebug
```

That target name has three parts:

- **`aosp_arm64`** — the product. Which device configuration, which packages, which
  architecture.
- **`trunk_staging`** — the release configuration (newer AOSP). Which feature flags are on.
- **`userdebug`** — the variant, and the one that matters day to day:

| Variant | Root via adb | Debuggable | Use for |
|---|---|---|---|
| `eng` | yes | everything | early bring-up |
| `userdebug` | yes (`adb root`) | most things | **development and QA** |
| `user` | no | no | what ships |

Ninety percent of development happens on `userdebug`. On a `user` build, `adb root` fails,
many `dumpsys` outputs are trimmed, and SELinux is enforcing with no permissive fallback —
which is exactly why you must test on `user` before shipping. Plenty of bugs exist only
there.

`envsetup.sh` also gives you the commands you will use constantly:

```bash
m                      # build everything
m my_service           # build one module
mm                     # build modules in the current directory
mmm path/to/dir        # build modules in that directory
croot                  # cd to the top of the tree
hmm                    # list all of these
```

## The build itself

```bash
m -j$(nproc)
```

Kati converts the Makefiles, Soong reads the Blueprints, and both emit Ninja files; Ninja
does the actual work. This is why the first minutes of a build print "Starting Kati" and
"Starting Soong" before anything compiles — that is the metabuild, and it re-runs whenever a
build file changes.

Practical numbers: **first build 1–4 hours; incremental build of one module, 1–3 minutes.**
Most of that incremental time is the metabuild, not your compile.

Speeding it up, in order of return:

```bash
export USE_CCACHE=1                     # ccache: large win on rebuilds
export CCACHE_DIR=/mnt/big/ccache
ccache -M 100G

m -j$(nproc)                            # match your core count
```

An NVMe SSD and 64 GB of RAM matter more than CPU cores; AOSP builds are heavily I/O and
memory bound. 16 GB will thrash and may OOM the linker.

## What comes out

```
out/target/product/<board>/
    system.img          the Android framework and system apps
    vendor.img          your HALs, your drivers, board configuration
    boot.img            kernel + ramdisk
    vbmeta.img          verified boot metadata
    userdata.img        empty user partition
    ramdisk.img
    system/             the unpacked contents of system.img — useful for grepping
    obj/                intermediates
    symbols/            unstripped binaries, needed to symbolise crashes
```

Two things worth knowing about `out/`:

**`out/target/product/<board>/system/` is browsable.** When you want to know whether your
file actually got installed and where, look there rather than mounting an image.

**`out/target/product/<board>/symbols/` is how you read a tombstone.** The binaries on the
device are stripped; these are not. Keep the `symbols/` directory for every build you flash,
or crash reports from that build become unreadable. This bites people who clean their tree
after shipping.

## When the build fails

The failure modes, in the order you will meet them:

**Out of memory during linking.** Reduce `-j`, add swap. `m -j4` on a 16 GB machine.

**"module not found" for something that exists.** Soong caches module names. `m clean` is
usually overkill; `rm -rf out/soong` and rebuild is faster and normally enough.

**Missing dependency in `Android.bp`.** The error names a symbol, not a library. Find which
module exports it — `cs.android.com` or `rg` for the function name in `Android.bp` files
nearby — and add it to `shared_libs`.

**SELinux denials at boot, so the device never comes up.** Lesson 5. It is almost always this
when a new service does not start.

**Your file is not on the device.** `PRODUCT_PACKAGES`. Again.

And the general advice: read the *first* error, not the last. Ninja runs in parallel and the
tail of the output is often unrelated noise from other jobs that were cancelled.

## Check yourself

1. What does a local manifest let you do that editing the main manifest does not?
2. Why can a module build successfully and still be absent from the device image?
3. What is the practical difference between `userdebug` and `user`, and why test both?
4. What is in `out/target/product/<board>/symbols/` and why must you keep it?

## Next

You can build an image. Lesson 2 follows what happens when the device turns on: bootloader,
kernel, init and its `.rc` language, Zygote, `system_server`, and how to find out which stage
your device died in.
