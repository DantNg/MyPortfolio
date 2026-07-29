---
lesson: 8
lang: en
title: "Embedded Linux — Cross-Compiling and Talking to Hardware"
description: "Building for a board you are not sitting at, driving GPIO/I²C/PWM/UART from user space, and choosing between Buildroot, Yocto and a plain distro image."
duration: "20 min"
tags: ["Linux", "Cross-compile", "GPIO", "Yocto"]
---

## Where this lesson lands

Everything so far applies to any Linux. This one is the part that matters if you build
devices: your development machine is x86_64, your product is ARM, and the interesting
peripherals are exposed as files.

## Cross-compiling

![Cross-compiling](/MyPortfolio/images/linux/cross-compile.svg)

Compiling *on* a Raspberry Pi works but is slow, and on a smaller board it is not possible
at all. So you build on the fast machine and produce ARM binaries.

Install a toolchain:

```bash
# 32-bit ARM with hardware float (Pi 2/3 in 32-bit mode, most i.MX6, STM32MP1)
sudo apt install gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf

# 64-bit ARM (Pi 3/4/5 in 64-bit, most modern SoCs)
sudo apt install gcc-aarch64-linux-gnu g++-aarch64-linux-gnu
```

The prefix encodes the target: `arm-linux-gnueabihf-` is *architecture - OS - ABI*. Vendor
toolchains from ST, NXP or Yocto follow the same pattern.

Build and verify:

```bash
arm-linux-gnueabihf-gcc -O2 -o sensord sensord.c

file sensord
# sensord: ELF 32-bit LSB executable, ARM, EABI5, dynamically linked...
```

`file` is your first check. If it says `x86-64`, you used the wrong compiler.

With a Makefile, the conventional variables do the work:

```makefile
CROSS_COMPILE ?= arm-linux-gnueabihf-
CC  := $(CROSS_COMPILE)gcc
CFLAGS := -O2 -Wall -Wextra

sensord: sensord.c
	$(CC) $(CFLAGS) -o $@ $<
```

```bash
make                                 # host build, for testing logic locally
make CROSS_COMPILE=aarch64-linux-gnu-  # target build
```

With CMake, use a toolchain file:

```cmake
# arm.cmake
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_C_COMPILER   arm-linux-gnueabihf-gcc)
set(CMAKE_CXX_COMPILER arm-linux-gnueabihf-g++)
set(CMAKE_SYSROOT /opt/sysroots/armhf)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
```

```bash
cmake -B build -DCMAKE_TOOLCHAIN_FILE=arm.cmake
cmake --build build -j$(nproc)
```

### The sysroot

The compiler can generate ARM instructions on its own, but the **linker** needs the target's
libraries and headers. That collection is the sysroot. Without it you get errors about
missing `libssl` or headers that exist on your host but in the wrong architecture.

Getting one:

- Yocto and Buildroot produce an SDK that includes it (`. /opt/poky/.../environment-setup-...`)
- Or copy from a running board: `rsync -avz board:/usr/include board:/usr/lib ./sysroot/`

Then check what the binary will actually need at runtime:

```bash
arm-linux-gnueabihf-readelf -d sensord | grep NEEDED
# 0x00000001 (NEEDED)  Shared library: [libssl.so.3]
```

If the board does not have `libssl.so.3`, deploy it or link statically:

```bash
arm-linux-gnueabihf-gcc -static -o sensord sensord.c   # bigger, no dependencies
```

Static linking is a legitimate choice on a small device — one file, no version drift.

## Hardware from user space

The board exposes peripherals as files, so a normal C program with `open`/`ioctl`/`read`
drives them. No kernel module needed.

### GPIO — use the character device

The old `/sys/class/gpio` sysfs interface is deprecated. The current one is
`/dev/gpiochipN`, usually driven through `libgpiod`:

```bash
sudo apt install gpiod libgpiod-dev

gpiodetect                    # list controllers
gpioinfo gpiochip0            # every line, its name and consumer
gpioset gpiochip0 17=1        # drive line 17 high
gpioget gpiochip0 27          # read line 27
gpiomon gpiochip0 27          # wait for and print edge events
```

In C:

```c
#include <gpiod.h>

int main(void)
{
    struct gpiod_chip *chip = gpiod_chip_open("/dev/gpiochip0");
    struct gpiod_line *led  = gpiod_chip_get_line(chip, 17);

    gpiod_line_request_output(led, "blink", 0);

    for (int i = 0; i < 10; i++) {
        gpiod_line_set_value(led, i % 2);
        usleep(500000);
    }

    gpiod_chip_close(chip);   /* releases the line */
    return 0;
}
```

```bash
arm-linux-gnueabihf-gcc -o blink blink.c -lgpiod
```

> User-space GPIO is not real-time. Scheduling jitter is tens of microseconds to
> milliseconds. For precise timing you need a kernel driver, a PWM peripheral, or an MCU
> alongside the SoC. Knowing that boundary is a large part of embedded Linux design.

### I²C

```bash
sudo apt install i2c-tools
i2cdetect -l                 # available buses
i2cdetect -y 1               # scan bus 1 — addresses that respond
i2cget -y 1 0x68 0x75        # read one register (MPU-6050 WHO_AM_I)
i2cset -y 1 0x68 0x6B 0x00   # write one register
```

In C, the pattern for almost every sensor:

```c
#include <fcntl.h>
#include <unistd.h>
#include <linux/i2c-dev.h>
#include <sys/ioctl.h>

int fd = open("/dev/i2c-1", O_RDWR);
if (fd < 0) { perror("open i2c"); return 1; }

if (ioctl(fd, I2C_SLAVE, 0x68) < 0) { perror("select device"); return 1; }

uint8_t reg = 0x75;
write(fd, &reg, 1);            /* set the register pointer */

uint8_t who = 0;
read(fd, &who, 1);             /* read it back */
printf("WHO_AM_I = 0x%02X\n", who);

close(fd);
```

That is the whole API. Every I²C sensor driver you write in user space is this, plus the
register map from the datasheet.

### PWM, ADC, temperature — sysfs

```bash
# PWM
cd /sys/class/pwm/pwmchip0
echo 0 > export
echo 1000000 > pwm0/period       # 1 ms => 1 kHz, in nanoseconds
echo 500000  > pwm0/duty_cycle   # 50%
echo 1       > pwm0/enable

# ADC (industrial I/O)
cat /sys/bus/iio/devices/iio:device0/in_voltage0_raw

# CPU temperature
cat /sys/class/thermal/thermal_zone0/temp
```

All of it is `echo` and `cat`, which means it is `write()` and `read()` from C, which means
a shell script is a perfectly good prototype before you write the real program.

### UART

```c
#include <termios.h>

int fd = open("/dev/ttyS0", O_RDWR | O_NOCTTY);

struct termios tty;
tcgetattr(fd, &tty);
cfsetospeed(&tty, B115200);
cfsetispeed(&tty, B115200);

tty.c_cflag = (tty.c_cflag & ~CSIZE) | CS8;   /* 8 data bits          */
tty.c_cflag &= ~PARENB;                       /* no parity            */
tty.c_cflag &= ~CSTOPB;                       /* 1 stop bit           */
tty.c_cflag |= CLOCAL | CREAD;
tty.c_lflag = 0;                              /* raw, not line-based  */
tty.c_oflag = 0;
tty.c_cc[VMIN]  = 0;
tty.c_cc[VTIME] = 10;                         /* 1 s read timeout     */

tcsetattr(fd, TCSANOW, &tty);

write(fd, "AT\r\n", 4);
char buf[128];
int n = read(fd, buf, sizeof(buf));
```

The line that catches people is `tty.c_lflag = 0`. Leave the defaults and the port is in
*canonical* mode: `read()` blocks until a newline arrives, which never happens with binary
protocols.

## Device tree, in one page

On ARM there is no enumeration like PCI — the kernel cannot discover that an I²C sensor
exists. The **device tree** is a data file that tells it:

```dts
&i2c1 {
    status = "okay";
    clock-frequency = <400000>;

    mpu6050@68 {
        compatible = "invensense,mpu6050";
        reg = <0x68>;
        interrupt-parent = <&gpio1>;
        interrupts = <17 IRQ_TYPE_EDGE_RISING>;
    };
};
```

- `compatible` is the string the kernel matches against driver tables — get it from the
  driver's source or its `Documentation/devicetree/bindings/` entry.
- `reg` is the address on the bus.
- `status = "okay"` enables a node that the SoC's base `.dtsi` defined but left disabled.

Compile and check:

```bash
dtc -I dts -O dtb -o overlay.dtbo overlay.dts     # compile
dtc -I fs -O dts /sys/firmware/devicetree/base    # dump what is CURRENTLY loaded
```

On Raspberry Pi you rarely edit the full tree — you add an overlay line to
`/boot/config.txt` (`dtoverlay=i2c-sensor,mpu6050`) and reboot.

## Building an image: distro vs Buildroot vs Yocto

| | Distro image (Pi OS, Armbian) | Buildroot | Yocto |
| --- | --- | --- | --- |
| Setup time | minutes | hours | days |
| Image size | 1–4 GB | 5–50 MB | 30–200 MB |
| Boot time | 20–40 s | 2–5 s | 5–15 s |
| Package manager | yes | no (rebuild the image) | optional |
| Learning curve | none | moderate | steep |
| Best for | prototypes, low volume | fixed-function products | product families, long support |

The honest guidance:

- **Prototyping, or shipping tens of units?** Use Raspberry Pi OS or Armbian. Time to
  market beats 200 MB of unused packages.
- **A single fixed-function product, small team?** Buildroot. One `make menuconfig`, a
  reproducible image, a boot time you can measure in seconds.
- **A family of products, or a decade of maintenance and licence compliance?** Yocto. It is
  genuinely complicated, and the layer model plus the SDK generation pay for themselves at
  that scale.

A minimal Buildroot flow, to show it is not scary:

```bash
git clone https://git.buildroot.net/buildroot
cd buildroot
make raspberrypi4_64_defconfig
make menuconfig          # add your packages, set the toolchain
make -j$(nproc)          # produces output/images/sdcard.img
```

Your own application becomes a package in `package/myapp/` with a `.mk` file, and it is
then built into every image automatically.

## Deployment in practice

```bash
# 1. build
make CROSS_COMPILE=aarch64-linux-gnu-

# 2. verify the architecture before wasting a trip
file sensord

# 3. copy
rsync -avz sensord board:/tmp/

# 4. install and restart, in one SSH round trip
ssh board 'sudo install -m755 /tmp/sensord /usr/local/bin/ && sudo systemctl restart sensord'

# 5. watch it come up
ssh board 'journalctl -u sensord -f'
```

Five lines, and it uses something from every lesson in this series: cross-compilation,
`rsync`, permissions via `install -m755`, systemd, and journald.

## Series recap

1. Kernel, distro, shell; the syscall boundary; one filesystem tree.
2. Navigation, files, `find`/`grep`, pipes and redirection.
3. Permissions, groups, ownership, `sudo` — and why not `chmod 777`.
4. Processes, jobs, signals, `/proc`.
5. Bash scripting with strict mode, quoting, and `trap`.
6. SSH keys, `rsync`, systemd services and `journalctl`.
7. Debugging by layer: logs, `strace`, `/proc`, kernel, network.
8. Cross-compiling, user-space hardware access, device tree, image builders.

That is a working foundation. The next thing worth learning depends on where you are going:
kernel module development if you need real-time or a custom peripheral, Yocto if you are
shipping a product line, or containers if your target is closer to a server than a device.
