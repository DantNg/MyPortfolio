---
lesson: 3
lang: en
title: "Permissions, Users and sudo"
description: "Decoding `ls -l`, what chmod numbers mean, why `chmod 777` is almost never the answer, and the group membership that fixes serial-port access forever."
duration: "14 min"
tags: ["Linux", "Permissions", "sudo"]
---

## Why this lesson matters more than it sounds

`Permission denied` is the single most common wall a Windows developer hits on Linux. The
instinctive fix found on forums — `sudo chmod 777` — works, and it is almost always wrong.
Ten minutes here saves you from a machine full of world-writable files and a serial port
that needs `sudo` every single time.

## Reading `ls -l`

![Reading ls -l](/MyPortfolio/images/linux/permissions.svg)

```
-rwxr-x---  1 dat dialout  8.2K Jul 29 20:14 flash.sh
```

Ten characters, then owner, then group. Break the ten apart as **1 + 3 + 3 + 3**:

| Position | Meaning |
| --- | --- |
| 1 | type: `-` file, `d` directory, `l` symlink, `c` char device, `b` block device |
| 2–4 | what the **owner** may do |
| 5–7 | what the **group** may do |
| 8–10 | what **everyone else** may do |

And each triple is `r` read, `w` write, `x` execute — a dash means "not allowed".

So `-rwxr-x---` reads: a regular file; `dat` can read, write and run it; members of the
`dialout` group can read and run it; nobody else can do anything.

## The numbers

Each letter has a weight: **r = 4, w = 2, x = 1**. Add them per triple:

| Symbolic | Number | Typical use |
| --- | --- | --- |
| `rwx` | 7 | scripts and programs, for their owner |
| `rw-` | 6 | normal data files |
| `r-x` | 5 | read and run, no editing |
| `r--` | 4 | read only |

So the common ones are:

```bash
chmod 644 config.txt    # rw-r--r--  owner edits, everyone reads
chmod 755 build.sh      # rwxr-xr-x  owner edits, everyone runs
chmod 600 id_ed25519    # rw-------  private key: only you, ever
chmod 700 ~/.ssh        # rwx------  same for the directory
```

The symbolic form is often clearer for small changes:

```bash
chmod +x deploy.sh          # make executable (for everyone who can read it)
chmod u+w notes.md          # give the owner write
chmod go-rwx secrets.env    # take everything away from group and others
chmod -R u+w src/           # recursive
```

## `x` on a directory means something else

This trips up everyone once. On a **directory**:

- `r` — you may *list* its contents (`ls`)
- `w` — you may create and delete entries inside it
- `x` — you may *enter* it and access things inside by name (`cd`, or opening a file within)

So a directory with `r` but no `x` lets you see filenames but not read the files. A
directory with `x` but no `r` lets you open `dir/known_name.txt` but not discover what is
in there. That is exactly how `~/.ssh` with mode `700` protects your keys.

## Why `chmod 777` is a bad reflex

`777` means every user on the system can read, write and execute it. On a build server or
a shared board that is a real vulnerability. But the practical problem is simpler: it
usually does not fix your actual issue, it just hides it.

When something is denied, ask *which* of the three is wrong:

```bash
ls -l /dev/ttyUSB0
# crw-rw---- 1 root dialout 188, 0 Jul 29 20:31 /dev/ttyUSB0
```

Owner is `root`, group is `dialout`, group has `rw`. You are not root, so the fix is not
about permissions bits at all — **it is about group membership**.

## The fix you will need on every new machine

```bash
groups                              # which groups am I in?
sudo usermod -aG dialout $USER      # add myself to dialout
# log out and back in — group membership is set at login
groups                              # dialout should now be listed
```

After that, `screen /dev/ttyUSB0 115200`, `esptool.py`, `openocd` and `st-flash` all work
without `sudo`, forever, on that machine.

The `-a` in `-aG` means *append*. Leave it out and you replace all of the user's groups
with just that one — a genuinely bad afternoon. Groups worth knowing for embedded work:

| Group | Grants |
| --- | --- |
| `dialout` | serial ports (`/dev/ttyUSB*`, `/dev/ttyACM*`) |
| `plugdev` | hot-pluggable USB devices (many debug probes) |
| `i2c` | `/dev/i2c-*` |
| `gpio` | GPIO character devices on Raspberry Pi OS |
| `docker` | the Docker daemon (note: effectively root-equivalent) |

## Ownership

```bash
sudo chown dat file.txt          # change owner
sudo chown dat:dialout file.txt  # owner and group
sudo chgrp dialout file.txt      # group only
sudo chown -R dat:dat ~/project  # recursive — fixes files created by sudo
```

That last one is the cleanup after you accidentally ran a build with `sudo` and now own
nothing in your own project directory.

## sudo, root, and the shell that is not

`root` (UID 0) bypasses all permission checks. You do not log in as root; you borrow its
powers per command:

```bash
sudo apt install gcc         # run one command as root
sudo -i                      # a root shell (leave quickly)
sudo -u pi ./script.sh       # run as a different, non-root user
```

Two behaviors that surprise people:

**Redirection happens in *your* shell, not in sudo's:**

```bash
sudo echo "x" > /etc/protected    # FAILS — the shell opens the file, not sudo
echo "x" | sudo tee /etc/protected     # works
sudo sh -c 'echo "x" > /etc/protected' # also works
```

**`sudo` has its own `PATH` and environment.** A program that runs for you may be "not
found" under `sudo`, and `sudo make install` may not see the variables you exported. Use
`sudo -E` to preserve your environment when that matters.

Configuration lives in `/etc/sudoers` and is edited only with `visudo`, which validates
before saving — a syntax error in that file can lock you out of root entirely.

## Users and files, quickly

```bash
whoami           # current user
id               # UID, GID and all groups
id -u            # numeric user id — 0 means root
cat /etc/passwd  # all accounts (the password hashes are in /etc/shadow)
cat /etc/group   # all groups and their members
```

On a fresh embedded image you often create a service account with no login shell:

```bash
sudo useradd -r -s /usr/sbin/nologin sensord
sudo chown -R sensord:sensord /var/lib/sensord
```

Running a daemon as its own unprivileged user is the cheapest security win available, and
lesson 6 shows how to wire that into systemd.

## umask — why new files are 644

New files do not appear with `777` masked by your `umask`, typically `022`:

```bash
umask            # 0022
touch new.txt
ls -l new.txt    # -rw-r--r--  (666 minus 022)
```

Directories start from `777`, so `777 - 022 = 755`. Executables are `644` at creation
because the shell refuses to guess that you meant a program — hence `chmod +x` after
writing a script.

## Practice

1. Make a script executable by you only, not by anyone else.
2. Find out which group owns `/dev/ttyACM0` and whether you are in it.
3. Fix a `~/.ssh` directory whose permissions are `755` (SSH will refuse to use it).
4. Append a line to a root-owned file without `sudo -i`.

<details>
<summary>Answers</summary>

```bash
chmod 700 script.sh
ls -l /dev/ttyACM0 ; groups
chmod 700 ~/.ssh && chmod 600 ~/.ssh/id_*
echo "PermitRootLogin no" | sudo tee -a /etc/ssh/sshd_config
```
</details>

## Next

Lesson 4: processes — what is running, what is eating your CPU, how to stop it politely,
and what happens between the shell and your program.
