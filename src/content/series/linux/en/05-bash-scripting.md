---
lesson: 5
lang: en
title: "Bash Scripting That Does Not Betray You"
description: "Variables, conditionals, loops and functions — plus the strict-mode header, the quoting rule, and the exit codes that make a script safe to run unattended."
duration: "18 min"
tags: ["Linux", "Bash", "Automation"]
---

## When a script earns its keep

The rule I use: the third time you type the same sequence of commands, write it down. A
flash-and-verify sequence, a log collection routine, a release build — these are worth
thirty lines of bash and never worth a "real" program.

## The anatomy of a safe script

![Anatomy of a bash script](/MyPortfolio/images/linux/bash-script.svg)

```bash
#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-/dev/ttyUSB0}"
FIRMWARE="${2:-build/firmware.bin}"

if [[ ! -e "$PORT" ]]; then
    echo "Port not found: $PORT" >&2
    exit 1
fi

esptool.py --port "$PORT" write_flash 0x0 "$FIRMWARE"
echo "Flashed $FIRMWARE to $PORT"
```

Make it runnable and run it:

```bash
chmod +x flash.sh
./flash.sh /dev/ttyUSB1
```

Now the four parts that matter.

### 1. The shebang

`#!/usr/bin/env bash` on line 1 tells the kernel which interpreter to use. Using `env`
rather than a hard-coded `/bin/bash` makes it work on systems where bash lives elsewhere.

If you write `#!/bin/sh`, you get POSIX shell, not bash — `[[ ]]`, arrays, and `${var,,}`
will all fail. On Debian and Ubuntu `/bin/sh` is `dash`, which is a genuinely different
language. Pick one and mean it.

### 2. Strict mode

```bash
set -euo pipefail
```

- **`-e`** — exit immediately if any command fails. Without it, a failed `cd` is followed
  by an `rm -rf *` in the wrong directory.
- **`-u`** — error on undefined variables. Catches typos: `$FIRMWRE` becomes an error
  instead of an empty string.
- **`-o pipefail`** — a pipeline fails if *any* stage fails, not just the last one. Without
  it, `make | tee log` reports success even when `make` failed.

Add `set -x` temporarily to print each command as it runs — the fastest way to debug a
script.

### 3. Always quote your variables

```bash
FILE="my report.txt"

rm $FILE      # runs: rm my report.txt   -> two files, both wrong
rm "$FILE"    # runs: rm "my report.txt" -> correct
```

The rule is simple: **quote every variable expansion unless you have a specific reason not
to.** This one habit prevents most script bugs.

### 4. Exit codes

`exit 0` means success; anything else is failure. Report errors on stderr with `>&2`, so
that a caller can separate your diagnostics from your output.

## Variables

```bash
NAME="board-01"                 # no spaces around =
COUNT=5
FILES=$(ls *.bin)               # capture command output
TODAY=$(date +%Y-%m-%d)

echo "$NAME"                    # use with $
echo "${NAME}_backup"           # braces when it touches other characters
echo "Found ${#FILES} chars"    # length
```

Defaults and required values:

```bash
PORT="${1:-/dev/ttyUSB0}"       # use $1, or the default if unset/empty
: "${API_KEY:?API_KEY is required}"   # abort with a message if unset
```

Environment vs shell variables:

```bash
LOCAL_VAR="only here"           # this shell only
export SHARED_VAR="children too"  # inherited by processes you launch
env | sort                      # everything currently exported
```

`export` is why `PATH`, `CC`, and `CROSS_COMPILE` reach the tools you invoke.

## Conditionals

```bash
if [[ -f "$CONFIG" ]]; then
    source "$CONFIG"
elif [[ -f /etc/defaults.conf ]]; then
    source /etc/defaults.conf
else
    echo "no config found" >&2
    exit 1
fi
```

The tests you will actually use:

| Test | True when |
| --- | --- |
| `-e path` | it exists (file, dir, device, anything) |
| `-f path` | it is a regular file |
| `-d path` | it is a directory |
| `-r` / `-w` / `-x` | readable / writable / executable |
| `-z "$s"` / `-n "$s"` | string is empty / not empty |
| `"$a" == "$b"` | strings equal (`!=` for not) |
| `$a -eq $b` | numbers equal — `-ne -lt -le -gt -ge` for the rest |

Use `[[ ]]` in bash, not the older `[ ]`. It handles empty variables and unquoted spaces
far more safely, and supports `&&`, `||` and pattern matching:

```bash
if [[ "$FILE" == *.bin && -s "$FILE" ]]; then
    echo "a non-empty binary"
fi
```

You can also test commands directly, which is often cleaner:

```bash
if ping -c1 -W1 192.168.1.20 &>/dev/null; then
    echo "board is up"
fi

command -v arm-none-eabi-gcc >/dev/null || { echo "toolchain missing" >&2; exit 1; }
```

## Loops

```bash
for f in *.log; do
    gzip "$f"
done

for i in {1..5}; do
    echo "attempt $i"
done

for dev in /dev/ttyUSB*; do
    [[ -e "$dev" ]] || continue        # the glob stays literal if nothing matches
    echo "found $dev"
done

while read -r line; do
    echo "LOG: $line"
done < app.log

while ! ping -c1 -W1 "$BOARD" &>/dev/null; do
    echo "waiting for board..."
    sleep 2
done
```

That last pattern — poll until the device answers — is the backbone of every deployment
script I have written for a board that reboots.

Reading a file line by line: always use `while read -r`, never `for line in $(cat file)`.
The `for` version splits on every space, not just newlines.

## Functions

```bash
log() {
    echo "[$(date +%H:%M:%S)] $*"
}

require_tool() {
    local tool="$1"                       # local: does not leak out
    if ! command -v "$tool" >/dev/null; then
        echo "missing tool: $tool" >&2
        return 1
    fi
}

require_tool esptool.py || exit 1
log "starting flash"
```

`$1`, `$2`… are the arguments, `$*` is all of them, `$#` is the count. Always declare
function-internal variables `local`, otherwise they are global and will collide.

## Cleaning up with trap

```bash
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT      # runs on normal exit AND on error AND on Ctrl+C

work_in "$TMPDIR"
```

`trap ... EXIT` is the shell's equivalent of a destructor, and it is the correct way to
guarantee that temporary directories, mounted images and stopped services get cleaned up
even when the script fails halfway.

## A complete, realistic script

Collect diagnostics from a board over SSH — the kind of thing you write once and use for
years:

```bash
#!/usr/bin/env bash
set -euo pipefail

BOARD="${1:?usage: collect.sh <user@host> [outdir]}"
OUTDIR="${2:-diag-$(date +%Y%m%d-%H%M%S)}"

log() { echo "[$(date +%H:%M:%S)] $*"; }

mkdir -p "$OUTDIR"
trap 'log "failed — partial results in $OUTDIR"' ERR

log "checking reachability"
if ! ssh -o ConnectTimeout=5 "$BOARD" true; then
    echo "cannot reach $BOARD" >&2
    exit 1
fi

declare -A CMDS=(
    [uname]="uname -a"
    [uptime]="uptime"
    [memory]="free -h"
    [disk]="df -h"
    [processes]="ps aux --sort=-%cpu"
    [dmesg]="dmesg | tail -200"
    [services]="systemctl --failed"
    [network]="ip a; ip r"
)

for name in "${!CMDS[@]}"; do
    log "collecting $name"
    ssh "$BOARD" "${CMDS[$name]}" > "$OUTDIR/$name.txt" 2>&1 || \
        log "  (warning: $name failed)"
done

log "fetching journal"
ssh "$BOARD" "journalctl -b --no-pager" > "$OUTDIR/journal.txt" 2>&1 || true

tar czf "$OUTDIR.tar.gz" "$OUTDIR"
log "done: $OUTDIR.tar.gz ($(du -h "$OUTDIR.tar.gz" | cut -f1))"
```

Note `|| true` on the journal: a missing `journalctl` on a minimal image should not abort
the whole collection, and with `set -e` it otherwise would.

## Debugging scripts

```bash
bash -n script.sh      # syntax check without running
bash -x script.sh      # trace every command as it executes
set -x ; ...; set +x   # trace only a section
shellcheck script.sh   # a linter that catches real bugs — install it
```

`shellcheck` is the single best investment here. It flags unquoted variables, useless
`cat`, wrong test operators, and about a hundred other things, with an explanation for each.

## Practice

1. A script that takes a directory and prints the five largest files in it.
2. A script that waits for `/dev/ttyUSB0` to appear, then opens a serial monitor.
3. A backup script that tars a directory with a timestamped name and deletes archives
   older than 7 days.

<details>
<summary>Sketch of #3</summary>

```bash
#!/usr/bin/env bash
set -euo pipefail
SRC="${1:?usage: backup.sh <dir>}"
DEST="${2:-$HOME/backups}"
mkdir -p "$DEST"
tar czf "$DEST/$(basename "$SRC")-$(date +%Y%m%d).tar.gz" -C "$(dirname "$SRC")" "$(basename "$SRC")"
find "$DEST" -name "*.tar.gz" -mtime +7 -delete
```
</details>

## Next

Lesson 6: working remotely — SSH keys, file transfer, and turning your program into a
systemd service that starts at boot and restarts when it crashes.
