---
lesson: 6
lang: en
title: "Working Remotely — SSH, Files, and systemd Services"
description: "Key-based SSH that never asks for a password, moving files with scp and rsync, and turning your program into a service that starts at boot and restarts on crash."
duration: "17 min"
tags: ["Linux", "SSH", "systemd"]
---

## The remote-first reality

Embedded Linux work happens on a board with no keyboard and no monitor. You edit on your
laptop, build on your laptop, and everything reaches the target over the network. This
lesson is that workflow.

![SSH and systemd](/MyPortfolio/images/linux/systemd-ssh.svg)

## SSH, properly configured once

```bash
ssh pi@192.168.1.20                # password prompt, every time
```

Stop doing that. Generate a key pair, put the public half on the board, and never type the
password again:

```bash
# on YOUR machine, once ever
ssh-keygen -t ed25519 -C "dat@laptop"
# press Enter for the default path; use a passphrase if the laptop is portable

# push the public key to the board
ssh-copy-id pi@192.168.1.20

# now
ssh pi@192.168.1.20                # straight in
```

What happened: `~/.ssh/id_ed25519` (private, stays on your laptop forever) and
`~/.ssh/id_ed25519.pub` (public, safe to copy anywhere). `ssh-copy-id` appended the public
half to `~/.ssh/authorized_keys` on the board.

If it does not work, permissions are the usual cause — SSH refuses keys that others can
read:

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub ~/.ssh/authorized_keys
```

## ~/.ssh/config — the file that saves the most typing

```
Host board
    HostName 192.168.1.20
    User pi
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 30

Host build
    HostName build.internal.company
    User dat
    ForwardAgent yes

Host *
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

Now `ssh board` is the whole command — and `scp file board:` and `rsync ... board:` use the
same alias.

`ServerAliveInterval` is what stops your session from silently freezing on a flaky Wi-Fi
link.

## Running things without a shell

```bash
ssh board 'uname -a'                       # one command, then disconnect
ssh board 'systemctl status sensord'
ssh board 'journalctl -u sensord -n 50' > board.log     # output lands locally
ssh board 'tail -f /var/log/app.log'       # follow a remote log live
cat local_script.sh | ssh board 'bash -s'  # run a local script remotely
```

That last one is genuinely useful: no need to copy the script first.

## Moving files

**`scp`** for one-off copies:

```bash
scp firmware.bin board:/tmp/               # up
scp board:/var/log/app.log ./              # down
scp -r ./config board:/etc/myapp/          # a directory
```

**`rsync`** for anything you will do more than once. It transfers only differences, which
on a slow link is the difference between seconds and minutes:

```bash
rsync -avz --progress build/ board:/opt/app/
rsync -avz --delete src/ board:/opt/app/src/    # mirror exactly, removing extras
rsync -avz --exclude '*.o' --exclude '.git' ./ board:/home/pi/project/
```

Flags: `-a` archive (recursive, preserves permissions and timestamps), `-v` verbose,
`-z` compress in transit.

> The trailing slash matters. `rsync src/ dest/` copies the *contents* of `src`;
> `rsync src dest/` copies the *directory* `src` into `dest`. This catches everyone once.

## Port forwarding

Your board runs a web dashboard on port 8080, but only listens on localhost:

```bash
ssh -L 8080:localhost:8080 board
# now open http://localhost:8080 in your laptop's browser
```

The reverse, when the board must reach a service on your laptop:

```bash
ssh -R 9000:localhost:9000 board
```

This is how you debug a device behind a NAT without opening any firewall ports.

## systemd — making your program a service

Running `./sensord &` over SSH means the program dies with the session and never comes back
after a reboot. A **unit file** fixes both:

```ini
# /etc/systemd/system/sensord.service
[Unit]
Description=Sensor logging daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/sensord --config /etc/sensord.conf
Restart=always
RestartSec=5
User=sensord
Group=sensord
WorkingDirectory=/var/lib/sensord

# hardening — cheap and worth it
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/sensord

[Install]
WantedBy=multi-user.target
```

Install and control it:

```bash
sudo systemctl daemon-reload           # after any unit file change
sudo systemctl enable --now sensord    # start now AND at every boot
systemctl status sensord               # is it alive? last few log lines
sudo systemctl restart sensord
sudo systemctl stop sensord
sudo systemctl disable sensord         # stop starting at boot
```

The fields that matter most:

- **`Restart=always`** with **`RestartSec=5`** — the single biggest reliability win on a
  device you cannot physically reach. If your program dies, it is back in five seconds.
- **`After=`/`Wants=`** — ordering. A service that needs the network must wait for it, or
  it will fail at boot and succeed when you test it manually, which is a maddening bug.
- **`User=`** — do not run as root. Create a service account (lesson 3).
- **`Type=simple`** for a program that stays in the foreground; **`Type=notify`** if it
  uses sd_notify; **`Type=oneshot`** with `RemainAfterExit=yes` for setup tasks.

## Logs — journalctl

If your program writes to stdout, systemd captures it. No log file plumbing needed:

```bash
journalctl -u sensord              # everything from this unit
journalctl -u sensord -f           # follow live  <- the one you will use
journalctl -u sensord -n 100       # last 100 lines
journalctl -u sensord --since "10 min ago"
journalctl -u sensord -p err       # errors and worse only
journalctl -b                      # everything since this boot
journalctl -b -1                   # the PREVIOUS boot — why did it reboot?
journalctl -k                      # kernel messages (same as dmesg)
journalctl --disk-usage
sudo journalctl --vacuum-size=100M # cap it on a small SD card
```

`journalctl -b -1 -p err` is the first command to run on a board that rebooted unexpectedly.

## Timers instead of cron

systemd timers replace cron and log properly:

```ini
# /etc/systemd/system/backup.service
[Service]
Type=oneshot
ExecStart=/usr/local/bin/backup.sh
```

```ini
# /etc/systemd/system/backup.timer
[Unit]
Description=Nightly backup

[Timer]
OnCalendar=daily
Persistent=true          # run on next boot if the machine was off

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl enable --now backup.timer
systemctl list-timers            # what runs next, and when
```

`Persistent=true` is why timers beat cron on devices that are not always on.

## When a service will not start

Work through this order:

```bash
systemctl status sensord           # 1. the error is usually right here
journalctl -u sensord -n 50        # 2. the full output
sudo systemd-analyze verify /etc/systemd/system/sensord.service   # 3. syntax
sudo -u sensord /usr/local/bin/sensord   # 4. run it by hand as that user
```

Step 4 catches the most common cause: it works as you, and fails as the service user
because of a permission or a `PATH` difference.

## Practice

1. Set up key-based SSH to a board or VM and add a `~/.ssh/config` entry for it.
2. Mirror a local build directory to the target with rsync, excluding object files.
3. Write a unit file for a script that logs the CPU temperature every minute, and confirm
   it restarts after you kill it.

## Next

Lesson 7: debugging — reading logs, `strace`, `/proc`, and the standard tools for figuring
out whether the problem is your program, the kernel, the disk, or the network.
