---
lesson: 1
lang: en
title: "What Linux Actually Is — Kernel, Shell, Distro"
description: "The words people use interchangeably and shouldn't, the user-space/kernel boundary that explains everything else, and the single filesystem tree that replaces C:\\ and D:\\."
duration: "12 min"
tags: ["Linux", "Kernel", "Filesystem"]
---

## Getting the words right

People say "Linux" for four different things, and mixing them up makes documentation
confusing. Precisely:

- **The kernel** — one program, about 30 million lines of C, that owns the hardware. It
  schedules processes, manages memory, and talks to drivers. That is *literally* Linux.
- **The distribution (distro)** — the kernel plus everything else you need: a shell,
  coreutils, a package manager, an init system. Ubuntu, Debian, Fedora, Alpine, Yocto.
- **The shell** — the program that reads what you type and runs it. Usually `bash`,
  sometimes `zsh` or `sh`. It is not the OS; it is an app like any other.
- **The terminal** — the window the shell runs inside. On a headless board there is no
  terminal at all, just a serial line or SSH.

When embedded people say "we run Linux", they mean: a kernel built for their SoC, plus a
minimal root filesystem produced by Buildroot or Yocto — often with no distro at all.

## The one boundary that explains everything

![Linux architecture](/MyPortfolio/images/linux/architecture.svg)

Everything in Linux is either **user space** or **kernel space**, and the only door
between them is the **syscall**.

Your program cannot touch a GPIO pin, a disk sector, or a network card directly. It asks
the kernel to do it, through calls like `open()`, `read()`, `write()`, `ioctl()`. The C
library (`glibc` or `musl`) wraps those in the friendlier functions you already know —
`printf()` is a formatting layer that ends in a `write()` syscall.

This is why:

- A crashing program cannot take the system down; it only dies in its own address space.
- Reading a sensor from user space means opening a *file* (`/dev/i2c-1`), not poking a
  register.
- `strace` (lesson 7) is so powerful — it sits exactly on that boundary and prints every
  request your program makes to the kernel.

Coming from MCU firmware, this is the biggest mental shift: **you no longer own the
machine.** You ask for things.

## Everything is a file

Linux exposes almost every resource as something you can `open`, `read` and `write`:

| You want | You open |
| --- | --- |
| A USB serial adapter | `/dev/ttyUSB0` |
| An I²C bus | `/dev/i2c-1` |
| A GPIO controller | `/dev/gpiochip0` |
| CPU temperature | `/sys/class/thermal/thermal_zone0/temp` |
| A running process's memory map | `/proc/1234/maps` |
| Random bytes | `/dev/urandom` |

That is not a metaphor. This really works:

```bash
cat /sys/class/thermal/thermal_zone0/temp     # 48312  => 48.3 °C
echo 1 > /sys/class/leds/led0/brightness      # turn an LED on
```

Once you internalize this, half of "embedded Linux" turns into file I/O you already know
how to write in C.

## One tree, no drive letters

![Filesystem hierarchy](/MyPortfolio/images/linux/filesystem.svg)

There is no `C:` and no `D:`. There is `/`, and everything else hangs off it. A USB stick
does not become a new letter — it gets **mounted** into an existing directory:

```bash
sudo mount /dev/sda1 /mnt/usb
ls /mnt/usb          # the stick's contents now appear here
sudo umount /mnt/usb
```

The directories worth memorizing on day one:

- **`/etc`** — configuration. All plain text. This is where you change how the system
  behaves, and where you look when it behaves badly.
- **`/var/log`** — logs. First stop when something failed.
- **`/home/you`**, written `~` — your files. The only place you can write without `sudo`.
- **`/dev`** — devices.
- **`/proc`** and **`/sys`** — not real files at all. The kernel generates them on the fly
  so you can read its state with `cat`.
- **`/usr/bin`, `/bin`** — installed programs.
- **`/tmp`** — scratch space, usually wiped on reboot.

Paths starting with `/` are **absolute** (from the root). Anything else is **relative** to
where you are now. `.` is here, `..` is one level up, `~` is your home.

## Case matters, spaces hurt

Two Windows habits that will bite you within an hour:

```bash
ls Makefile      # exists
ls makefile      # No such file or directory  -- different file!
```

And spaces separate arguments, so a filename containing one must be quoted:

```bash
cd my project      # tries to cd into "my", fails
cd "my project"    # correct
cd my\ project     # also correct
```

This is why Linux people name things `sensor_log_2026.txt` and not `Sensor Log 2026.txt`.

## Where to run all this

You need a Linux you can type into. In order of how little effort they take:

**WSL2 (Windows).** Real kernel, integrates with your Windows files, no reboot:

```powershell
wsl --install -d Ubuntu
```

Good for everything in lessons 1–7. Its hardware access is limited, so a real board is
better for lesson 8.

**A virtual machine.** VirtualBox or VMware with Ubuntu Desktop. Slower, but a complete
system including USB passthrough.

**A Raspberry Pi or any dev board.** The most useful option if you are here for embedded
work — you get the real hardware interfaces from lesson 8, and you learn to work over SSH
from the start.

**A cloud VM.** Fine for lessons 1–7, useless for hardware.

## Your first five commands

Open a terminal and run these in order. Read every output before moving on:

```bash
whoami          # which user am I?
pwd             # where am I? (print working directory)
ls -la          # what is here? (-l long, -a including hidden dotfiles)
uname -a        # what kernel and architecture is this?
cat /etc/os-release   # which distribution and version?
```

`uname -a` matters more than it looks. Its output tells you the architecture — `x86_64`,
`aarch64`, `armv7l` — and that decides which binaries and which toolchain you need. When
you cross-compile in lesson 8, this is the number you check against.

## Getting help without leaving the terminal

```bash
man ls          # the full manual. q to quit, / to search
ls --help       # the short version, usually enough
type cd         # is it a program, a builtin, or an alias?
which gcc       # where does this program actually live?
apropos serial  # search manual pages by keyword
```

`man` pages have sections; `man 2 write` is the *syscall* `write`, while `man 1 write` is
an unrelated user command. Section 2 (syscalls) and section 3 (library functions) are the
two you will use most as a C developer.

## Check yourself

1. What is the difference between the kernel, a distro, and the shell?
2. Where does a program go when it needs to read a file from disk?
3. Where would you look first if a service failed to start?
4. What does `/proc` contain, and where is it stored on disk?
5. Why does `ls Makefile` succeed while `ls makefile` fails?

## Next

Lesson 2 is the command line proper: moving around, manipulating files, and the pipe
operator that turns twenty small tools into one custom tool.
