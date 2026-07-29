---
lesson: 8
lang: vi
title: "Embedded Linux — cross-compile và nói chuyện với phần cứng"
description: "Build cho board mà bạn không ngồi trước mặt, điều khiển GPIO/I²C/PWM/UART từ user space, và chọn giữa Buildroot, Yocto hay một image distro có sẵn."
duration: "20 phút"
tags: ["Linux", "Cross-compile", "GPIO", "Yocto"]
---

## Bài này nằm ở đâu

Mọi thứ từ đầu tới giờ đúng với mọi bản Linux. Bài này là phần có ý nghĩa nếu bạn làm ra
thiết bị: máy phát triển của bạn là x86_64, sản phẩm của bạn là ARM, và những ngoại vi thú
vị đều lộ ra dưới dạng file.

## Cross-compile

![Cross-compile](/MyPortfolio/images/linux/cross-compile.svg)

Biên dịch *ngay trên* Raspberry Pi thì được nhưng chậm, còn trên board nhỏ hơn thì không
thể. Vậy nên bạn build trên máy mạnh và tạo ra nhị phân ARM.

Cài toolchain:

```bash
# ARM 32-bit có dấu phẩy động phần cứng (Pi 2/3 chế độ 32-bit, đa số i.MX6, STM32MP1)
sudo apt install gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf

# ARM 64-bit (Pi 3/4/5 chế độ 64-bit, đa số SoC hiện đại)
sudo apt install gcc-aarch64-linux-gnu g++-aarch64-linux-gnu
```

Tiền tố mã hoá đích đến: `arm-linux-gnueabihf-` là *kiến trúc - hệ điều hành - ABI*.
Toolchain của ST, NXP hay Yocto cũng theo đúng khuôn mẫu này.

Build và kiểm chứng:

```bash
arm-linux-gnueabihf-gcc -O2 -o sensord sensord.c

file sensord
# sensord: ELF 32-bit LSB executable, ARM, EABI5, dynamically linked...
```

`file` là bước kiểm tra đầu tiên. Nếu nó nói `x86-64`, bạn đã dùng nhầm trình biên dịch.

Với Makefile, các biến quy ước lo phần còn lại:

```makefile
CROSS_COMPILE ?= arm-linux-gnueabihf-
CC  := $(CROSS_COMPILE)gcc
CFLAGS := -O2 -Wall -Wextra

sensord: sensord.c
	$(CC) $(CFLAGS) -o $@ $<
```

```bash
make                                 # build cho host, để thử logic tại chỗ
make CROSS_COMPILE=aarch64-linux-gnu-  # build cho target
```

Với CMake, dùng file toolchain:

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

### Sysroot

Trình biên dịch tự sinh được lệnh ARM, nhưng **linker** cần thư viện và header của target.
Tập hợp đó gọi là sysroot. Thiếu nó, bạn sẽ gặp lỗi thiếu `libssl` hoặc thiếu header — dù
máy bạn có, nhưng sai kiến trúc.

Lấy sysroot ở đâu:

- Yocto và Buildroot sinh ra SDK có sẵn nó (`. /opt/poky/.../environment-setup-...`)
- Hoặc chép từ board đang chạy: `rsync -avz board:/usr/include board:/usr/lib ./sysroot/`

Rồi kiểm tra xem nhị phân sẽ cần gì lúc chạy:

```bash
arm-linux-gnueabihf-readelf -d sensord | grep NEEDED
# 0x00000001 (NEEDED)  Shared library: [libssl.so.3]
```

Nếu board không có `libssl.so.3`, hãy mang nó theo hoặc link tĩnh:

```bash
arm-linux-gnueabihf-gcc -static -o sensord sensord.c   # to hơn, không phụ thuộc gì
```

Link tĩnh là lựa chọn chính đáng trên thiết bị nhỏ — một file duy nhất, không lệch phiên bản.

## Phần cứng từ user space

Board phơi ngoại vi ra dưới dạng file, nên một chương trình C bình thường với
`open`/`ioctl`/`read` là điều khiển được. Không cần viết module kernel.

### GPIO — dùng character device

Giao diện sysfs cũ `/sys/class/gpio` đã bị khai tử. Cái hiện hành là `/dev/gpiochipN`,
thường dùng qua `libgpiod`:

```bash
sudo apt install gpiod libgpiod-dev

gpiodetect                    # liệt kê các bộ điều khiển
gpioinfo gpiochip0            # từng đường, tên và ai đang dùng
gpioset gpiochip0 17=1        # kéo đường 17 lên mức cao
gpioget gpiochip0 27          # đọc đường 27
gpiomon gpiochip0 27          # chờ và in ra các sự kiện sườn tín hiệu
```

Bằng C:

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

    gpiod_chip_close(chip);   /* nhả đường tín hiệu */
    return 0;
}
```

```bash
arm-linux-gnueabihf-gcc -o blink blink.c -lgpiod
```

> GPIO ở user space không phải thời gian thực. Sai số do lập lịch dao động từ hàng chục
> micro-giây tới mili-giây. Cần định thời chính xác thì phải viết driver kernel, dùng ngoại
> vi PWM, hoặc gắn thêm một MCU bên cạnh SoC. Biết rõ ranh giới đó là một phần lớn của việc
> thiết kế hệ embedded Linux.

### I²C

```bash
sudo apt install i2c-tools
i2cdetect -l                 # các bus hiện có
i2cdetect -y 1               # quét bus 1 — địa chỉ nào trả lời
i2cget -y 1 0x68 0x75        # đọc một thanh ghi (MPU-6050 WHO_AM_I)
i2cset -y 1 0x68 0x6B 0x00   # ghi một thanh ghi
```

Trong C, đây là khuôn mẫu cho gần như mọi cảm biến:

```c
#include <fcntl.h>
#include <unistd.h>
#include <linux/i2c-dev.h>
#include <sys/ioctl.h>

int fd = open("/dev/i2c-1", O_RDWR);
if (fd < 0) { perror("open i2c"); return 1; }

if (ioctl(fd, I2C_SLAVE, 0x68) < 0) { perror("chon thiet bi"); return 1; }

uint8_t reg = 0x75;
write(fd, &reg, 1);            /* đặt con trỏ thanh ghi */

uint8_t who = 0;
read(fd, &who, 1);             /* đọc lại */
printf("WHO_AM_I = 0x%02X\n", who);

close(fd);
```

Đó là toàn bộ API. Mọi driver cảm biến I²C bạn viết ở user space đều là đoạn này, cộng với
bảng thanh ghi trong datasheet.

### PWM, ADC, nhiệt độ — qua sysfs

```bash
# PWM
cd /sys/class/pwm/pwmchip0
echo 0 > export
echo 1000000 > pwm0/period       # 1 ms => 1 kHz, đơn vị nano-giây
echo 500000  > pwm0/duty_cycle   # 50%
echo 1       > pwm0/enable

# ADC (industrial I/O)
cat /sys/bus/iio/devices/iio:device0/in_voltage0_raw

# nhiệt độ CPU
cat /sys/class/thermal/thermal_zone0/temp
```

Tất cả chỉ là `echo` và `cat`, tức là `write()` và `read()` từ C, tức là một script shell là
bản mẫu hoàn toàn ổn trước khi bạn viết chương trình thật.

### UART

```c
#include <termios.h>

int fd = open("/dev/ttyS0", O_RDWR | O_NOCTTY);

struct termios tty;
tcgetattr(fd, &tty);
cfsetospeed(&tty, B115200);
cfsetispeed(&tty, B115200);

tty.c_cflag = (tty.c_cflag & ~CSIZE) | CS8;   /* 8 bit dữ liệu        */
tty.c_cflag &= ~PARENB;                       /* không parity         */
tty.c_cflag &= ~CSTOPB;                       /* 1 stop bit           */
tty.c_cflag |= CLOCAL | CREAD;
tty.c_lflag = 0;                              /* chế độ thô, không theo dòng */
tty.c_oflag = 0;
tty.c_cc[VMIN]  = 0;
tty.c_cc[VTIME] = 10;                         /* timeout đọc 1 giây   */

tcsetattr(fd, TCSANOW, &tty);

write(fd, "AT\r\n", 4);
char buf[128];
int n = read(fd, buf, sizeof(buf));
```

Dòng khiến người ta vấp là `tty.c_lflag = 0`. Giữ nguyên mặc định thì cổng ở chế độ *canonical*:
`read()` chặn cho tới khi có ký tự xuống dòng — điều không bao giờ xảy ra với giao thức nhị
phân.

## Device tree, gói trong một trang

Trên ARM không có cơ chế tự dò như PCI — kernel không thể tự biết có một cảm biến I²C ở đó.
**Device tree** là file dữ liệu nói cho nó biết:

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

- `compatible` là chuỗi kernel dùng để khớp với bảng driver — lấy nó từ mã nguồn driver
  hoặc mục tương ứng trong `Documentation/devicetree/bindings/`.
- `reg` là địa chỉ trên bus.
- `status = "okay"` bật một node mà file `.dtsi` gốc của SoC đã khai báo nhưng để tắt.

Biên dịch và kiểm tra:

```bash
dtc -I dts -O dtb -o overlay.dtbo overlay.dts     # biên dịch
dtc -I fs -O dts /sys/firmware/devicetree/base    # đổ ra cây ĐANG được nạp
```

Trên Raspberry Pi bạn hiếm khi sửa cả cây — chỉ thêm một dòng overlay vào `/boot/config.txt`
(`dtoverlay=i2c-sensor,mpu6050`) rồi khởi động lại.

## Dựng image: distro, Buildroot hay Yocto

| | Image distro (Pi OS, Armbian) | Buildroot | Yocto |
| --- | --- | --- | --- |
| Thời gian dựng | vài phút | vài giờ | vài ngày |
| Kích thước image | 1–4 GB | 5–50 MB | 30–200 MB |
| Thời gian boot | 20–40 s | 2–5 s | 5–15 s |
| Trình quản lý gói | có | không (build lại image) | tuỳ chọn |
| Độ dốc học tập | không | vừa | dốc |
| Hợp với | bản mẫu, số lượng ít | sản phẩm chức năng cố định | dòng sản phẩm, hỗ trợ dài hạn |

Lời khuyên thật lòng:

- **Làm bản mẫu, hoặc xuất xưởng vài chục thiết bị?** Dùng Raspberry Pi OS hoặc Armbian.
  Ra thị trường sớm đáng giá hơn 200 MB gói không dùng tới.
- **Một sản phẩm chức năng cố định, đội nhỏ?** Buildroot. Một lần `make menuconfig`, một
  image tái lập được, thời gian boot đo bằng giây.
- **Một dòng sản phẩm, hoặc cả thập kỷ bảo trì và tuân thủ giấy phép?** Yocto. Nó phức tạp
  thật, nhưng mô hình layer cộng khả năng sinh SDK sẽ đáng giá ở quy mô đó.

Một luồng Buildroot tối giản, để thấy nó không đáng sợ:

```bash
git clone https://git.buildroot.net/buildroot
cd buildroot
make raspberrypi4_64_defconfig
make menuconfig          # thêm gói của bạn, chọn toolchain
make -j$(nproc)          # sinh ra output/images/sdcard.img
```

Ứng dụng của bạn trở thành một package trong `package/myapp/` kèm file `.mk`, và từ đó nó
được build vào mọi image một cách tự động.

## Triển khai trong thực tế

```bash
# 1. build
make CROSS_COMPILE=aarch64-linux-gnu-

# 2. kiểm tra kiến trúc trước khi mất công đi lại
file sensord

# 3. chép sang
rsync -avz sensord board:/tmp/

# 4. cài và khởi động lại, trong một lần SSH
ssh board 'sudo install -m755 /tmp/sensord /usr/local/bin/ && sudo systemctl restart sensord'

# 5. xem nó dựng dậy
ssh board 'journalctl -u sensord -f'
```

Năm dòng, và dùng tới thứ gì đó từ mọi bài trong series: cross-compile, `rsync`, phân quyền
qua `install -m755`, systemd, và journald.

## Tóm tắt cả series

1. Kernel, distro, shell; ranh giới syscall; một cây thư mục duy nhất.
2. Di chuyển, thao tác file, `find`/`grep`, pipe và chuyển hướng.
3. Phân quyền, nhóm, quyền sở hữu, `sudo` — và vì sao không nên `chmod 777`.
4. Tiến trình, job, tín hiệu, `/proc`.
5. Viết script bash với strict mode, quy tắc nháy kép, và `trap`.
6. Khoá SSH, `rsync`, dịch vụ systemd và `journalctl`.
7. Gỡ lỗi theo tầng: log, `strace`, `/proc`, kernel, mạng.
8. Cross-compile, truy cập phần cứng từ user space, device tree, công cụ dựng image.

Đó là một nền tảng dùng được. Thứ đáng học tiếp phụ thuộc vào hướng bạn đi: viết module
kernel nếu cần thời gian thực hoặc ngoại vi riêng, Yocto nếu bạn xuất xưởng cả dòng sản
phẩm, hoặc container nếu đích đến của bạn gần với server hơn là thiết bị.
