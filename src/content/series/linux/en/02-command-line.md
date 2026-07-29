---
lesson: 2
lang: en
title: "The Command Line You Will Actually Use"
description: "Navigation, file manipulation, finding things, and the pipe operator — how twenty small tools compose into exactly the tool you need."
duration: "18 min"
tags: ["Linux", "Shell", "CLI"]
---

## The Unix bet

Windows gives you one big program per job. Unix bet on the opposite: many tiny programs
that each do one thing, plus a way to connect them. `grep` only filters lines. `sort` only
sorts. `wc` only counts. None of them is impressive alone; chained together they replace
software you would otherwise write.

This lesson is the vocabulary. The next section is the grammar.

## Moving around

```bash
pwd                    # where am I
cd /var/log            # absolute path
cd ..                  # up one level
cd ~/projects          # ~ is your home directory
cd -                   # back to the previous directory (very useful)
cd                     # with no argument: go home
```

Listing:

```bash
ls                     # names only
ls -l                  # long: permissions, owner, size, date
ls -lh                 # sizes as 4.0K / 2.3M instead of bytes
ls -la                 # include hidden files (.bashrc, .git, ...)
ls -lt                 # sort by modification time, newest first
ls -ltr                # ... reversed, so newest is at the bottom near your prompt
```

`ls -ltr` is the one experienced people type without thinking — after a build, the file
you just produced is the last line.

**Tab completion is not optional.** Type three letters and press Tab. Press it twice to
list the candidates. It prevents most typos and teaches you what exists.

## Looking at files

```bash
cat config.txt           # dump the whole thing (short files only)
less big.log             # page through it: space, b, /search, q to quit
head -20 data.csv        # first 20 lines
tail -20 data.csv        # last 20 lines
tail -f /var/log/syslog  # follow: print new lines as they arrive  <- essential
wc -l data.csv           # count lines
file firmware.bin        # what kind of file is this actually?
```

`tail -f` is how you watch a device log while you reproduce a bug. `Ctrl+C` stops it.

## Creating, copying, deleting

```bash
mkdir build                 # one directory
mkdir -p a/b/c              # create the whole chain, no error if it exists
touch notes.md              # create empty / update timestamp

cp fw.bin fw.bin.bak        # copy
cp -r src/ backup/          # -r for directories
mv old.txt new.txt          # rename
mv report.pdf ~/docs/       # move

rm temp.log                 # delete a file
rm -r build/                # delete a directory tree
rm -rf build/               # ... without asking. Careful.
```

> There is no recycle bin. `rm` is permanent, and `rm -rf` on the wrong path has ended
> careers. Two habits that prevent it: never put a variable directly after `rm -rf`
> (`rm -rf "$DIR"/` becomes `rm -rf /` when `DIR` is empty), and run `ls` on the same path
> first to confirm it is what you think it is.

## Finding things

Two different tools that beginners confuse:

**`find` searches for files by name or property:**

```bash
find . -name "*.log"                 # by name, recursively from here
find . -name "*.c" -newer Makefile   # C files modified after Makefile
find /var/log -size +10M             # bigger than 10 MB
find . -type d -name build           # directories called build
find . -name "*.o" -delete           # find and delete
```

**`grep` searches *inside* files for text:**

```bash
grep "error" app.log                 # matching lines
grep -i "error" app.log              # case-insensitive
grep -r "TODO" src/                  # recursive through a tree
grep -n "malloc" main.c              # show line numbers
grep -v "DEBUG" app.log              # invert: lines NOT matching
grep -C 3 "panic" kernel.log         # 3 lines of context around each hit
```

`grep -rn "symbol" .` is how you navigate an unfamiliar C codebase before you have an IDE
set up. It is faster than you expect.

## Pipes — the actual point of the shell

![Pipes and redirection](/MyPortfolio/images/linux/pipeline.svg)

Every program has three channels: **stdin** (input), **stdout** (normal output), and
**stderr** (errors). The pipe `|` connects one program's stdout to the next one's stdin.

Read this left to right:

```bash
dmesg | grep -i usb | tail -20
```

"Print kernel messages → keep only lines mentioning USB → show me the last 20." Three
tools, one specific answer, no script written.

More that you will genuinely reuse:

```bash
# which processes are eating memory
ps aux | sort -k4 -nr | head -10

# how many times each IP hit the server
awk '{print $1}' access.log | sort | uniq -c | sort -nr | head

# every unique error code in a log
grep -o "E[0-9]\{4\}" app.log | sort -u

# how big is each subdirectory, largest last
du -sh */ | sort -h
```

The `sort | uniq -c | sort -nr` idiom — count occurrences, most frequent first — solves a
surprising share of real problems. Note that `uniq` only collapses *adjacent* duplicates,
which is why it is always preceded by `sort`.

## Redirection

```bash
make > build.log              # stdout to a file (overwrite)
make >> build.log             # append instead
make 2> errors.log            # stderr only
make > all.log 2>&1           # both into one file
make 2>/dev/null              # discard errors
./app < input.txt             # feed a file as stdin
make | tee build.log          # show on screen AND save to file
```

`tee` is the one people forget. When a build takes four minutes, you want to watch it *and*
keep the output.

`/dev/null` is the system's black hole: anything written there vanishes.

## Wildcards

The shell expands these *before* the command runs:

```bash
ls *.c              # every file ending in .c
ls test_?.log       # ? matches exactly one character
ls fw_[0-9].bin     # a character class
cp src/*.{c,h} backup/    # brace expansion: *.c and *.h
```

Since expansion happens in the shell, `rm *` and `rm "*"` do very different things — the
first deletes everything, the second looks for a file literally named `*`.

## Chaining commands

```bash
cd build && make && ./app     # each runs only if the previous succeeded
make || echo "build failed"   # run only if the previous FAILED
make ; ls                     # run regardless
```

`&&` is how you write a safe one-liner: nothing downstream runs after a failure. Every
command sets an exit status — `0` means success — and you can inspect it:

```bash
make
echo $?        # 0 = fine, anything else = failure
```

## History and editing

```bash
history               # everything you have typed
!!                    # repeat the last command
sudo !!               # repeat it with sudo  <- the classic
!542                  # run entry 542 from history
```

Keys worth learning today:

| Key | Effect |
| --- | --- |
| `Ctrl+R` | search history as you type — the biggest single speedup |
| `Ctrl+A` / `Ctrl+E` | jump to start / end of line |
| `Ctrl+U` / `Ctrl+K` | delete to start / end of line |
| `Ctrl+W` | delete the previous word |
| `Ctrl+C` | abort the running command |
| `Ctrl+L` | clear the screen |

## An editor, minimally

You will eventually have to edit a config on a machine that only has `vi`. The absolute
minimum to escape it alive:

```
i          switch to insert mode, type normally
Esc        back to command mode
:w         save
:q         quit
:wq        save and quit
:q!        quit, discarding changes
```

`nano` is friendlier if it exists (shortcuts are printed at the bottom: `^O` write out,
`^X` exit). On minimal embedded images, only `vi` is there.

## Practice

Do these in a scratch directory. They are all answerable with what is above:

1. Find the ten largest files under `/var/log`.
2. Count how many `.c` files exist in a source tree, recursively.
3. Show every line of `dmesg` mentioning "i2c" together with two lines of context.
4. Save a build's output and errors to one file while still watching it live.
5. List files modified in the last day, newest at the bottom.

<details>
<summary>Answers</summary>

```bash
find /var/log -type f -exec du -h {} + | sort -h | tail -10
find . -name "*.c" | wc -l
dmesg | grep -C 2 -i i2c
make 2>&1 | tee build.log
find . -mtime -1 -type f -exec ls -ltr {} +
```
</details>

## Next

Lesson 3: permissions, users and `sudo` — why `Permission denied` happens and what the
right fix is (it is usually not `chmod 777`).
