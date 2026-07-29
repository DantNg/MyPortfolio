---
lesson: 4
lang: en
title: "Processes, Jobs and Signals"
description: "What is running and why, fork/exec, foreground vs background, the signals behind Ctrl+C, and how to find the process holding your serial port."
duration: "15 min"
tags: ["Linux", "Processes", "Signals"]
---

## Everything is a process

![Processes, fork, exec, signals](/MyPortfolio/images/linux/processes.svg)

A process is a running program with its own memory, its own file descriptors, and a
number: the **PID**. Every process except the first has a parent, forming a tree that
starts at PID 1 — `systemd` on most systems, or whatever `init` your embedded image uses.

Your shell is a process. The command you just ran was its child. When you close the
terminal, its children usually go with it — which is exactly why long jobs need `nohup` or
`tmux`, later in this lesson.

## What is running

```bash
ps aux                 # every process on the system
ps -ef                 # the same, different formatting
ps aux | grep python   # only the ones you care about
pgrep -a sensord       # PIDs matching a name, with the command line
pstree -p              # the tree, with PIDs
```

Reading `ps aux` output:

```
USER  PID  %CPU %MEM    VSZ   RSS TTY   STAT START  TIME COMMAND
dat  2044   0.1  0.4  21504  8320 pts/0 Ss   20:14  0:01 -bash
dat  3187  98.3  2.1 512000 43008 pts/0 R+   20:31  1:12 ./sensord
```

- **VSZ** — virtual memory reserved. Usually large and mostly meaningless.
- **RSS** — resident memory: actual RAM in use. This is the number you care about.
- **STAT** — `R` running, `S` sleeping (normal, waiting for something), `D` uninterruptible
  sleep (stuck in a driver — a bad sign), `Z` zombie, `T` stopped.

A process at 98% CPU with STAT `R` is busy-looping. A process in `D` for more than a moment
usually means a disk or a device driver is not answering.

## Watching live

```bash
top          # everywhere, always installed
htop         # nicer: colors, mouse, tree view, F9 to kill
```

In `htop`, `F5` toggles tree view and `F6` sorts. The three things worth checking in the
first five seconds: which process tops the CPU column, whether the memory bar is near full,
and what **load average** says.

Load average is three numbers (1, 5, 15 minutes) counting runnable + uninterruptible
processes. Compare against your core count:

```bash
nproc          # how many cores
uptime         # ... load average: 3.42, 2.10, 1.05
```

On a 4-core board, `3.42` is busy but fine. On a single-core board it means everything is
queuing.

## fork and exec — what actually happens

When you type `./sensord`, the shell does two things:

1. **`fork()`** — makes a near-identical copy of itself, a new process.
2. **`exec()`** — that copy replaces its own program image with `sensord`.

The shell then **waits** for the child and collects its exit status:

```bash
./sensord
echo $?       # 0 = success; anything else is a failure code
```

Two consequences that matter in practice:

- A child inherits the environment, the working directory, and open file descriptors from
  its parent. That is why `export` (lesson 5) affects programs you launch afterwards, and
  why redirection set up by the shell survives into your program.
- A **zombie** is a finished child whose parent never collected the status. It holds no
  memory, only a PID slot. Many zombies mean a buggy parent, not a memory leak.

## Foreground, background, jobs

```bash
./long_build              # foreground: your terminal is blocked
./long_build &            # background: shell returns immediately
jobs                      # what is running in this shell
fg %1                     # bring job 1 to the foreground
bg %1                     # resume a stopped job in the background
```

The workflow you will use constantly:

```
Ctrl+Z          suspend the running program (SIGTSTP)
bg              let it continue in the background
                ... do something else ...
fg              bring it back
```

Background jobs still die when the shell exits. To survive a disconnect:

```bash
nohup ./long_build > build.log 2>&1 &     # immune to hangup
```

Better, on a remote board, use a terminal multiplexer:

```bash
tmux new -s build       # start a named session
# Ctrl+B then D         detach — everything keeps running
tmux attach -t build    # come back later, even from a different machine
tmux ls                 # list sessions
```

`tmux` (or `screen`) is what makes SSH work over unreliable links: your build does not care
that your laptop went to sleep.

## Signals

Signals are the standard way to talk to a running process.

| Signal | Number | Sent by | Meaning |
| --- | --- | --- | --- |
| `SIGINT` | 2 | `Ctrl+C` | please stop — the program can clean up |
| `SIGTSTP` | 20 | `Ctrl+Z` | suspend |
| `SIGTERM` | 15 | `kill PID` | please exit — the polite default |
| `SIGKILL` | 9 | `kill -9 PID` | die now — the kernel removes it, no cleanup |
| `SIGHUP` | 1 | terminal closed | reload config, by convention, for daemons |

```bash
kill 3187          # SIGTERM — try this first
kill -9 3187       # SIGKILL — only after TERM failed
killall sensord    # by name
pkill -f "python.*logger"   # by full command line pattern
```

> Reaching for `-9` first is a bad habit. `SIGKILL` cannot be caught, so the program never
> flushes its buffers, never closes files cleanly, never releases hardware. On a device
> that is writing to flash, that is how you get a corrupt file.

In your own C programs you catch the polite one:

```c
#include <signal.h>

static volatile sig_atomic_t running = 1;
static void on_term(int sig) { running = 0; }

int main(void)
{
    signal(SIGINT,  on_term);
    signal(SIGTERM, on_term);

    while (running) {
        do_work();
    }

    close_hardware();      /* now this actually runs */
    return 0;
}
```

That eight-line pattern is the difference between a daemon that can be restarted safely and
one that corrupts state on every deploy.

## Finding who holds a resource

The embedded classic: "cannot open /dev/ttyUSB0: Device or resource busy."

```bash
sudo lsof /dev/ttyUSB0        # which process has this file open
sudo fuser -v /dev/ttyUSB0    # same question, different tool
sudo lsof -i :8080            # who is listening on port 8080
sudo ss -tulpn | grep 8080    # the modern netstat
```

Nine times out of ten it is a `screen`, `minicom`, or a previous run of your own flasher
that you forgot to close.

## Priorities

```bash
nice -n 10 ./big_build        # start with lower priority (nice = kinder to others)
renice -n 5 -p 3187           # change priority of a running process
```

Values range from `-20` (highest priority) to `19` (lowest). Only root can go negative. On
a build server, `nice -n 19 make -j$(nproc)` keeps the machine usable while it compiles.

## Reading /proc

Everything `ps` shows comes from `/proc`. You can read it directly, which is priceless when
debugging a device:

```bash
cat /proc/3187/status      # state, threads, memory, UID
cat /proc/3187/cmdline     # exact command line (NUL-separated)
ls -l /proc/3187/fd        # every open file descriptor, as symlinks
cat /proc/3187/maps        # memory mappings, including loaded libraries
cat /proc/cpuinfo          # CPU model, cores, features
cat /proc/meminfo          # detailed memory
cat /proc/interrupts       # interrupt counts per IRQ  <- great for driver work
```

`ls -l /proc/PID/fd` answers "what files does this thing actually have open right now",
which is often the fastest route to a descriptor leak.

## Practice

1. Start a long-running command, suspend it, resume it in the background, then bring it
   back to the foreground.
2. Find the PID of the process using the most memory.
3. Find out which process is holding your serial port and stop it politely.
4. Launch a build that survives closing the SSH session.

<details>
<summary>Answers</summary>

```bash
sleep 300      # then Ctrl+Z, then: bg, then: fg
ps aux --sort=-%mem | head -2
sudo lsof /dev/ttyUSB0 && kill <PID>
tmux new -s build   # or: nohup make > build.log 2>&1 &
```
</details>

## Next

Lesson 5: bash scripting — variables, conditionals, loops, and the four lines at the top of
every script that stop it from doing something catastrophic when a command fails.
