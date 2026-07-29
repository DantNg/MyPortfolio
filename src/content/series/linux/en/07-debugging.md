---
lesson: 7
lang: en
title: "Debugging a Linux System You Did Not Write"
description: "A layered method: pick the tool that matches the layer. Logs, strace, /proc, resource limits and network checks — and the order to try them in."
duration: "16 min"
tags: ["Linux", "Debugging", "strace"]
---

## Pick the layer first

The mistake is reaching for a favorite tool. The method is: decide *which layer* is
suspect, then use the tool that lives there.

![Choosing the tool for the layer](/MyPortfolio/images/linux/debugging.svg)

Ask, in order:

1. Is the system healthy at all? (disk, memory, load)
2. Is the service running? What does it say?
3. Where exactly does it fail — which syscall, which file, which permission?
4. Is the kernel complaining about the hardware?
5. Is it actually the network?

## Step 0 — the sixty-second health check

Run this before anything else. It costs a minute and eliminates half of all causes:

```bash
uptime                 # load average vs core count
free -h                # is memory or swap exhausted?
df -h                  # is any filesystem 100% full?
df -i                  # are we out of INODES? (many small files)
systemctl --failed     # which units are broken
dmesg -T | tail -30    # what did the kernel say recently
```

**A full disk** is the single most common cause of "everything suddenly broke". Logs stop,
databases refuse writes, builds fail with confusing errors. `df -h` finds it in one second.

If `/` is full:

```bash
du -h --max-depth=1 / 2>/dev/null | sort -h | tail
sudo journalctl --vacuum-size=100M
sudo apt clean
```

**`df -i`** catches the sneaky variant: plenty of space, zero free inodes, because
something created millions of tiny files.

## Layer 1 — logs

```bash
journalctl -u myapp -f            # follow this service
journalctl -b -p err              # errors since boot
journalctl -b -1 -p err           # errors from the previous boot
journalctl --since "1 hour ago"
tail -f /var/log/syslog           # older systems without journald
```

Reading logs well is a skill:

- Start at the **first** error, not the last. Later errors are usually consequences.
- Note the timestamp and correlate: what else happened in that second?
- `grep -C 5` around the error to get context, not just the line.

## Layer 2 — strace, the syscall boundary

When a program fails and its message is useless, `strace` shows you exactly what it asked
the kernel for and what it got back:

```bash
strace ./myapp                       # everything (very noisy)
strace -f ./myapp                    # follow forked children too
strace -e trace=openat,read ./myapp  # only these syscalls
strace -p 3187                       # attach to a running process
strace -T ./myapp                    # time spent in each call
strace -o trace.log ./myapp          # write to a file
```

The pattern to look for is a call returning `-1`:

```
openat(AT_FDCWD, "/etc/myapp.conf", O_RDONLY) = -1 ENOENT (No such file or directory)
openat(AT_FDCWD, "/dev/i2c-1", O_RDWR)       = -1 EACCES (Permission denied)
connect(3, {sa_family=AF_INET, sin_port=htons(1883)...}) = -1 ECONNREFUSED
```

Each line answers a different question that the program's own error message hid: it is
looking for the config *there*; you are not in the `i2c` group; nothing is listening on
1883.

Filtering to the interesting subset makes it readable:

```bash
strace -f -e trace=file ./myapp 2>&1 | grep -v ENOENT   # file ops, minus the noise
strace -f -e trace=network ./myapp
ltrace ./myapp                                          # library calls instead
```

`strace` is slow — it stops the process on every syscall — so never leave it on a
performance-sensitive service in production.

## Layer 3 — /proc for a running process

```bash
ls -l /proc/3187/fd           # every open file and socket
cat /proc/3187/status         # threads, memory, UID, signals blocked
cat /proc/3187/cmdline | tr '\0' ' '   # exact command line
cat /proc/3187/environ | tr '\0' '\n'  # its environment variables
cat /proc/3187/limits         # ulimits — the file-descriptor cap lives here
ls -l /proc/3187/cwd          # its current directory
sudo cat /proc/3187/stack     # kernel stack: where it is stuck if STAT is D
```

`ls -l /proc/PID/fd | wc -l` growing steadily over hours is a file-descriptor leak, and it
ends in `EMFILE: too many open files`. The cap is in `/proc/PID/limits`, and for a service
you raise it with `LimitNOFILE=` in the unit file.

## Layer 4 — kernel and hardware

```bash
dmesg -w                     # follow kernel messages live
dmesg -T | grep -i error
dmesg | grep -i "usb\|i2c\|spi\|mmc"
lsusb                        # USB devices
lsusb -t                     # ... as a tree with drivers
lspci                        # PCI devices
lsmod                        # loaded kernel modules
lsblk                        # block devices and partitions
i2cdetect -y 1               # scan an I²C bus (i2c-tools)
```

The workflow that saves the most time: run `dmesg -w` in one terminal, then plug the device
in. Everything the kernel does about it appears immediately — enumeration, driver binding,
or the error explaining why it did not.

```
[ 8821.104] usb 1-1.3: new full-speed USB device number 7 using dwc_otg
[ 8821.245] ch341 1-1.3:1.0: ch341-uart converter detected
[ 8821.248] usb 1-1.3: ch341-uart converter now attached to ttyUSB0
```

That is a healthy sequence. If it ends after the first line, it is a power or cable problem
far more often than a software one.

## Layer 5 — network

```bash
ip a                          # interfaces and addresses (replaces ifconfig)
ip r                          # routing table — is there a default route?
ping -c3 192.168.1.1          # is the gateway reachable?
ping -c3 8.8.8.8              # is the internet reachable by IP?
ping -c3 google.com           # ... and does DNS work? (differs from the above!)
ss -tulpn                     # what is listening, and which process
curl -v http://board:8080/    # full request/response, headers included
traceroute 8.8.8.8
```

Test in that order. If `ping 8.8.8.8` works but `ping google.com` does not, the problem is
DNS (`/etc/resolv.conf`), not connectivity — a distinction that saves hours.

`ss -tulpn` is the modern `netstat`: `-t` TCP, `-u` UDP, `-l` listening, `-p` process,
`-n` numeric.

## Performance

```bash
htop                          # interactive overview
iostat -x 2                   # per-disk utilization; %util near 100 means I/O bound
vmstat 2                      # CPU, memory, swap, I/O over time
iotop                         # which process is doing the disk I/O
pidstat -p 3187 1             # per-process CPU/memory over time
```

Read the four numbers in `vmstat` together: high `wa` (I/O wait) with low `us` (user CPU)
means you are waiting on storage, not computing. High `si`/`so` means swapping — on an
embedded device with an SD card, that is effectively a hang.

## Finding what is on disk

```bash
du -sh */ | sort -h                       # biggest directories here
du -h --max-depth=2 /var | sort -h | tail # drill down
ncdu /                                    # interactive, if installed
find / -size +100M -type f 2>/dev/null    # big files anywhere
lsof | grep deleted                       # deleted files still held open  <- sneaky
```

That last one explains the classic "I deleted the log but the disk is still full": a
process still holds the file open, so the space is not freed until it is restarted.

## A worked diagnosis

*"The sensor service stops logging after a few hours."*

```bash
systemctl status sensord             # active, but restarted 14 times
journalctl -u sensord -p err | head  # "too many open files"
cat /proc/$(pgrep sensord)/limits | grep files   # Max open files: 1024
ls -l /proc/$(pgrep sensord)/fd | wc -l          # 1019 and climbing
ls -l /proc/$(pgrep sensord)/fd | tail           # all pointing at /dev/i2c-1
```

Diagnosis in four commands: the code opens the I²C device on each read and never closes it.
The fix is one `close()` in the application — not a bigger `LimitNOFILE`, which would only
delay the crash.

## Practice

1. Find which process is holding a deleted file open.
2. Use `strace` to discover which config file a program looks for and fails to find.
3. Determine whether a "slow" system is CPU-bound, I/O-bound, or swapping.
4. Confirm whether a network failure is connectivity or DNS.

## Next

The final lesson: cross-compiling for a board, driving GPIO and I²C from user space, and
the toolchain and image-building landscape (Buildroot and Yocto) in enough depth to know
which one you need.
