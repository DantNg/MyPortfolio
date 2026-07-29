---
lesson: 1
lang: vi
title: "Linux thực sự là gì — Kernel, Shell, Distro"
description: "Những từ hay bị dùng lẫn lộn, ranh giới user space / kernel space giải thích mọi thứ còn lại, và cái cây thư mục duy nhất thay cho ổ C: và D:."
duration: "12 phút"
tags: ["Linux", "Kernel", "Hệ thống file"]
---

## Gọi cho đúng tên

Người ta dùng chữ "Linux" cho bốn thứ khác nhau, và lẫn lộn chúng khiến tài liệu trở nên
khó hiểu. Nói chính xác:

- **Kernel (nhân)** — một chương trình, khoảng 30 triệu dòng C, nắm toàn quyền phần cứng.
  Nó lập lịch tiến trình, quản lý bộ nhớ, nói chuyện với driver. Đó *đúng nghĩa đen* mới
  là Linux.
- **Bản phân phối (distro)** — kernel cộng mọi thứ khác bạn cần: shell, coreutils, trình
  quản lý gói, hệ thống init. Ubuntu, Debian, Fedora, Alpine, Yocto.
- **Shell** — chương trình đọc thứ bạn gõ rồi chạy nó. Thường là `bash`, đôi khi `zsh` hay
  `sh`. Nó không phải hệ điều hành; nó chỉ là một ứng dụng như mọi ứng dụng khác.
- **Terminal** — cửa sổ mà shell chạy bên trong. Trên board không màn hình thì chẳng có
  terminal nào cả, chỉ có cổng serial hoặc SSH.

Khi dân nhúng nói "bọn tôi chạy Linux", ý là: một kernel build riêng cho SoC của họ, cộng
với một root filesystem tối giản do Buildroot hay Yocto tạo ra — thường không có distro nào.

## Ranh giới giải thích mọi thứ

![Kiến trúc Linux](/MyPortfolio/images/linux/architecture.svg)

Mọi thứ trong Linux đều thuộc **user space** hoặc **kernel space**, và cánh cửa duy nhất
giữa hai bên là **syscall**.

Chương trình của bạn không thể chạm trực tiếp vào chân GPIO, một sector đĩa hay card mạng.
Nó *nhờ* kernel làm hộ, qua các lời gọi như `open()`, `read()`, `write()`, `ioctl()`. Thư
viện C (`glibc` hoặc `musl`) bọc chúng lại thành những hàm thân thiện mà bạn đã biết —
`printf()` chỉ là lớp định dạng, cuối cùng vẫn kết thúc ở syscall `write()`.

Vì vậy mà:

- Một chương trình crash không kéo cả hệ thống sập; nó chỉ chết trong không gian địa chỉ
  của chính nó.
- Đọc cảm biến từ user space nghĩa là mở một *file* (`/dev/i2c-1`), chứ không phải chọc
  thẳng vào thanh ghi.
- `strace` (bài 7) mạnh đến thế — nó nằm đúng trên ranh giới đó và in ra mọi yêu cầu
  chương trình của bạn gửi cho kernel.

Với người quen firmware MCU, đây là cú chuyển tư duy lớn nhất: **bạn không còn sở hữu cái
máy nữa.** Bạn đi xin.

## Mọi thứ đều là file

Linux phơi bày gần như mọi tài nguyên dưới dạng thứ bạn có thể `open`, `read`, `write`:

| Bạn muốn | Bạn mở |
| --- | --- |
| Cổng USB-serial | `/dev/ttyUSB0` |
| Bus I²C | `/dev/i2c-1` |
| Bộ điều khiển GPIO | `/dev/gpiochip0` |
| Nhiệt độ CPU | `/sys/class/thermal/thermal_zone0/temp` |
| Bản đồ bộ nhớ của một tiến trình | `/proc/1234/maps` |
| Byte ngẫu nhiên | `/dev/urandom` |

Đây không phải phép ẩn dụ. Đoạn này chạy thật:

```bash
cat /sys/class/thermal/thermal_zone0/temp     # 48312  => 48,3 °C
echo 1 > /sys/class/leds/led0/brightness      # bật một con LED
```

Khi đã thấm điều này, một nửa của "embedded Linux" hoá ra chỉ là thao tác file mà bạn vốn
đã biết viết bằng C.

## Một cái cây, không có ký tự ổ đĩa

![Cây thư mục Linux](/MyPortfolio/images/linux/filesystem.svg)

Không có `C:`, cũng chẳng có `D:`. Chỉ có `/`, và mọi thứ khác treo vào đó. Cắm USB vào
không sinh ra ký tự ổ mới — nó được **mount** vào một thư mục có sẵn:

```bash
sudo mount /dev/sda1 /mnt/usb
ls /mnt/usb          # nội dung USB xuất hiện ngay tại đây
sudo umount /mnt/usb
```

Những thư mục đáng thuộc ngay ngày đầu:

- **`/etc`** — cấu hình. Toàn văn bản thuần. Đây là nơi bạn đổi cách hệ thống hoạt động,
  và cũng là nơi cần soi khi nó hoạt động sai.
- **`/var/log`** — log. Chỗ dừng đầu tiên khi có gì đó hỏng.
- **`/home/tên_bạn`**, viết tắt `~` — file của bạn. Nơi duy nhất bạn ghi được mà không cần
  `sudo`.
- **`/dev`** — thiết bị.
- **`/proc`** và **`/sys`** — không phải file thật. Kernel sinh chúng ra ngay lúc bạn đọc,
  để bạn xem trạng thái hệ thống bằng `cat`.
- **`/usr/bin`, `/bin`** — chương trình đã cài.
- **`/tmp`** — chỗ để tạm, thường bị xoá sau khi khởi động lại.

Đường dẫn bắt đầu bằng `/` là **tuyệt đối** (tính từ gốc). Còn lại là **tương đối** so với
chỗ bạn đang đứng. `.` là ở đây, `..` là lùi một cấp, `~` là thư mục nhà.

## Phân biệt hoa thường, và dấu cách gây đau

Hai thói quen từ Windows sẽ hành bạn trong vòng một giờ:

```bash
ls Makefile      # có
ls makefile      # No such file or directory  -- file khác hẳn!
```

Và dấu cách dùng để tách tham số, nên tên file có dấu cách phải bọc trong nháy:

```bash
cd my project      # cố cd vào "my", thất bại
cd "my project"    # đúng
cd my\ project     # cũng đúng
```

Đó là lý do dân Linux đặt tên `sensor_log_2026.txt` chứ không phải `Sensor Log 2026.txt`.

## Chạy những thứ này ở đâu

Bạn cần một bản Linux gõ lệnh được. Xếp theo mức công sức bỏ ra, ít trước:

**WSL2 (Windows).** Kernel thật, dùng chung file với Windows, không cần khởi động lại:

```powershell
wsl --install -d Ubuntu
```

Dùng tốt cho toàn bộ bài 1–7. Khả năng truy cập phần cứng hạn chế, nên bài 8 sẽ hay hơn
nếu có board thật.

**Máy ảo.** VirtualBox hoặc VMware với Ubuntu Desktop. Chậm hơn, nhưng là hệ thống đầy đủ,
kể cả chuyển tiếp USB.

**Raspberry Pi hoặc một board bất kỳ.** Lựa chọn hữu ích nhất nếu bạn đến đây vì công việc
nhúng — bạn có giao tiếp phần cứng thật ở bài 8, và quen làm việc qua SSH ngay từ đầu.

**Máy ảo trên cloud.** Ổn cho bài 1–7, vô dụng với phần cứng.

## Năm lệnh đầu tiên

Mở terminal và chạy lần lượt. Hãy đọc kỹ kết quả trước khi sang lệnh tiếp theo:

```bash
whoami          # tôi đang là user nào?
pwd             # tôi đang đứng ở đâu? (print working directory)
ls -la          # ở đây có gì? (-l chi tiết, -a kể cả file ẩn bắt đầu bằng dấu chấm)
uname -a        # kernel và kiến trúc gì?
cat /etc/os-release   # bản phân phối và phiên bản nào?
```

`uname -a` quan trọng hơn vẻ ngoài. Kết quả cho biết kiến trúc — `x86_64`, `aarch64`,
`armv7l` — và điều đó quyết định bạn cần nhị phân nào, toolchain nào. Khi cross-compile ở
bài 8, đây chính là thứ bạn phải đối chiếu.

## Tra cứu mà không cần rời terminal

```bash
man ls          # tài liệu đầy đủ. q để thoát, / để tìm
ls --help       # bản ngắn, thường là đủ
type cd         # nó là chương trình, lệnh dựng sẵn, hay alias?
which gcc       # chương trình này thực ra nằm ở đâu?
apropos serial  # tìm trang man theo từ khoá
```

Trang `man` có nhiều mục; `man 2 write` là *syscall* `write`, còn `man 1 write` là một lệnh
người dùng chẳng liên quan. Mục 2 (syscall) và mục 3 (hàm thư viện) là hai mục bạn dùng
nhiều nhất với tư cách lập trình viên C.

## Tự kiểm tra

1. Kernel, distro và shell khác nhau chỗ nào?
2. Một chương trình phải đi qua đâu khi cần đọc file từ đĩa?
3. Bạn soi chỗ nào đầu tiên khi một dịch vụ không khởi động được?
4. `/proc` chứa gì, và nó nằm ở đâu trên đĩa?
5. Vì sao `ls Makefile` chạy được còn `ls makefile` thì báo lỗi?

## Bài tiếp theo

Bài 2 đi vào dòng lệnh thật sự: di chuyển, thao tác file, và toán tử pipe biến hai chục
công cụ nhỏ thành một công cụ riêng của bạn.
