---
lesson: 7
lang: vi
title: "Gỡ lỗi một hệ Linux không phải do bạn viết"
description: "Phương pháp theo tầng: chọn công cụ khớp với tầng đang nghi ngờ. Log, strace, /proc, tài nguyên hệ thống và mạng — cùng thứ tự nên thử."
duration: "16 phút"
tags: ["Linux", "Gỡ lỗi", "strace"]
---

## Xác định tầng trước đã

Sai lầm là vớ ngay công cụ ưa thích. Phương pháp đúng là: xác định *tầng nào* đang bị nghi
ngờ, rồi dùng công cụ sống ở tầng đó.

![Chọn công cụ theo tầng](/MyPortfolio/images/linux/debugging.svg)

Hãy hỏi lần lượt:

1. Hệ thống có khoẻ không? (đĩa, bộ nhớ, tải)
2. Dịch vụ có chạy không? Nó nói gì?
3. Nó hỏng chính xác ở đâu — syscall nào, file nào, quyền nào?
4. Kernel có kêu ca gì về phần cứng không?
5. Có phải thật ra là do mạng?

## Bước 0 — kiểm tra sức khoẻ trong sáu mươi giây

Chạy trước mọi thứ khác. Tốn một phút và loại được một nửa số nguyên nhân:

```bash
uptime                 # load average so với số nhân
free -h                # bộ nhớ hay swap đã cạn chưa?
df -h                  # phân vùng nào đầy 100% không?
df -i                  # hết INODE chưa? (rất nhiều file nhỏ)
systemctl --failed     # unit nào đang hỏng
dmesg -T | tail -30    # gần đây kernel nói gì
```

**Đĩa đầy** là nguyên nhân phổ biến nhất của "tự nhiên hỏng hết". Log ngừng ghi, cơ sở dữ
liệu từ chối ghi, build thất bại với lỗi khó hiểu. `df -h` phát hiện trong một giây.

Nếu `/` đã đầy:

```bash
du -h --max-depth=1 / 2>/dev/null | sort -h | tail
sudo journalctl --vacuum-size=100M
sudo apt clean
```

**`df -i`** bắt được biến thể ranh mãnh: còn thừa dung lượng, nhưng hết sạch inode, vì thứ
gì đó đã tạo ra hàng triệu file tí hon.

## Tầng 1 — log

```bash
journalctl -u myapp -f            # bám theo dịch vụ này
journalctl -b -p err              # lỗi kể từ lần khởi động này
journalctl -b -1 -p err           # lỗi ở lần khởi động trước
journalctl --since "1 hour ago"
tail -f /var/log/syslog           # hệ thống cũ không có journald
```

Đọc log cho giỏi cũng là một kỹ năng:

- Bắt đầu từ lỗi **đầu tiên**, không phải lỗi cuối. Các lỗi sau thường chỉ là hệ quả.
- Ghi lại mốc thời gian và đối chiếu: giây đó còn chuyện gì xảy ra nữa?
- Dùng `grep -C 5` quanh chỗ lỗi để có ngữ cảnh, chứ không chỉ mỗi dòng lỗi.

## Tầng 2 — strace, ngay tại ranh giới syscall

Khi chương trình hỏng mà thông báo của nó vô dụng, `strace` cho bạn thấy chính xác nó đã
xin kernel cái gì và nhận lại được gì:

```bash
strace ./myapp                       # mọi thứ (rất ồn)
strace -f ./myapp                    # theo cả tiến trình con
strace -e trace=openat,read ./myapp  # chỉ các syscall này
strace -p 3187                       # gắn vào tiến trình đang chạy
strace -T ./myapp                    # thời gian tiêu tốn ở mỗi lời gọi
strace -o trace.log ./myapp          # ghi ra file
```

Thứ cần tìm là những lời gọi trả về `-1`:

```
openat(AT_FDCWD, "/etc/myapp.conf", O_RDONLY) = -1 ENOENT (No such file or directory)
openat(AT_FDCWD, "/dev/i2c-1", O_RDWR)       = -1 EACCES (Permission denied)
connect(3, {sa_family=AF_INET, sin_port=htons(1883)...}) = -1 ECONNREFUSED
```

Mỗi dòng trả lời một câu hỏi mà thông báo lỗi của chương trình đã che mất: nó tìm file cấu
hình *ở chỗ đó*; bạn không thuộc nhóm `i2c`; chẳng có ai đang nghe ở cổng 1883.

Lọc bớt để đọc được:

```bash
strace -f -e trace=file ./myapp 2>&1 | grep -v ENOENT   # thao tác file, bớt nhiễu
strace -f -e trace=network ./myapp
ltrace ./myapp                                          # theo dõi lời gọi thư viện
```

`strace` chạy chậm — nó dừng tiến trình ở mỗi syscall — nên đừng bao giờ để nó bật trên
dịch vụ nhạy cảm hiệu năng trong môi trường thật.

## Tầng 3 — /proc cho một tiến trình đang chạy

```bash
ls -l /proc/3187/fd           # mọi file và socket đang mở
cat /proc/3187/status         # số luồng, bộ nhớ, UID, tín hiệu bị chặn
cat /proc/3187/cmdline | tr '\0' ' '   # dòng lệnh chính xác
cat /proc/3187/environ | tr '\0' '\n'  # biến môi trường của nó
cat /proc/3187/limits         # ulimit — giới hạn số file descriptor nằm ở đây
ls -l /proc/3187/cwd          # thư mục làm việc hiện tại
sudo cat /proc/3187/stack     # stack trong kernel: nó kẹt ở đâu nếu STAT là D
```

`ls -l /proc/PID/fd | wc -l` tăng đều theo giờ nghĩa là rò rỉ file descriptor, và kết cục
là `EMFILE: too many open files`. Giới hạn nằm ở `/proc/PID/limits`, và với một dịch vụ thì
bạn nâng nó bằng `LimitNOFILE=` trong unit file.

## Tầng 4 — kernel và phần cứng

```bash
dmesg -w                     # bám theo thông điệp kernel trực tiếp
dmesg -T | grep -i error
dmesg | grep -i "usb\|i2c\|spi\|mmc"
lsusb                        # thiết bị USB
lsusb -t                     # ... dạng cây kèm driver
lspci                        # thiết bị PCI
lsmod                        # module kernel đã nạp
lsblk                        # thiết bị khối và phân vùng
i2cdetect -y 1               # quét bus I²C (gói i2c-tools)
```

Cách làm tiết kiệm thời gian nhất: mở `dmesg -w` ở một cửa sổ, rồi mới cắm thiết bị vào.
Mọi việc kernel làm với nó hiện ra ngay lập tức — nhận diện, gắn driver, hoặc lỗi giải thích
vì sao không được.

```
[ 8821.104] usb 1-1.3: new full-speed USB device number 7 using dwc_otg
[ 8821.245] ch341 1-1.3:1.0: ch341-uart converter detected
[ 8821.248] usb 1-1.3: ch341-uart converter now attached to ttyUSB0
```

Đó là một chuỗi khoẻ mạnh. Nếu nó dừng ngay sau dòng đầu, khả năng do nguồn hoặc cáp cao
hơn hẳn khả năng do phần mềm.

## Tầng 5 — mạng

```bash
ip a                          # giao diện và địa chỉ (thay cho ifconfig)
ip r                          # bảng định tuyến — có default route không?
ping -c3 192.168.1.1          # gateway có trả lời không?
ping -c3 8.8.8.8              # ra Internet bằng IP được không?
ping -c3 google.com           # ... và DNS có chạy không? (khác câu trên đấy!)
ss -tulpn                     # ai đang nghe, và tiến trình nào
curl -v http://board:8080/    # toàn bộ request/response, kèm header
traceroute 8.8.8.8
```

Hãy thử đúng thứ tự đó. Nếu `ping 8.8.8.8` được mà `ping google.com` không được, vấn đề là
DNS (`/etc/resolv.conf`) chứ không phải kết nối — phân biệt được điều này tiết kiệm hàng giờ.

`ss -tulpn` là bản hiện đại của `netstat`: `-t` TCP, `-u` UDP, `-l` đang nghe, `-p` tiến
trình, `-n` dạng số.

## Hiệu năng

```bash
htop                          # nhìn tổng quan tương tác
iostat -x 2                   # mức dùng từng đĩa; %util gần 100 là nghẽn I/O
vmstat 2                      # CPU, bộ nhớ, swap, I/O theo thời gian
iotop                         # tiến trình nào đang đọc/ghi đĩa
pidstat -p 3187 1             # CPU/bộ nhớ của riêng một tiến trình theo thời gian
```

Hãy đọc bốn con số của `vmstat` cùng nhau: `wa` (chờ I/O) cao mà `us` (CPU người dùng) thấp
nghĩa là bạn đang chờ ổ lưu trữ, không phải đang tính toán. `si`/`so` cao nghĩa là đang
swap — trên thiết bị nhúng dùng thẻ SD, điều đó gần như là treo máy.

## Tìm xem đĩa đang chứa gì

```bash
du -sh */ | sort -h                       # thư mục nào nặng nhất ở đây
du -h --max-depth=2 /var | sort -h | tail # đào sâu dần
ncdu /                                    # tương tác, nếu có cài
find / -size +100M -type f 2>/dev/null    # file lớn ở bất cứ đâu
lsof | grep deleted                       # file đã xoá nhưng vẫn bị giữ mở  <- ranh
```

Cái cuối giải thích hiện tượng kinh điển "tôi xoá log rồi mà đĩa vẫn đầy": một tiến trình
vẫn giữ file đó mở, nên dung lượng chưa được trả lại cho tới khi nó khởi động lại.

## Một ca chẩn đoán thật

*"Dịch vụ cảm biến ngừng ghi log sau vài giờ."*

```bash
systemctl status sensord             # đang chạy, nhưng đã restart 14 lần
journalctl -u sensord -p err | head  # "too many open files"
cat /proc/$(pgrep sensord)/limits | grep files   # Max open files: 1024
ls -l /proc/$(pgrep sensord)/fd | wc -l          # 1019 và đang tăng
ls -l /proc/$(pgrep sensord)/fd | tail           # tất cả đều trỏ tới /dev/i2c-1
```

Chẩn đoán xong trong bốn lệnh: code mở thiết bị I²C ở mỗi lần đọc mà không bao giờ đóng.
Cách sửa là thêm một `close()` trong ứng dụng — không phải nâng `LimitNOFILE`, vì làm thế
chỉ trì hoãn cú sập.

## Bài tập

1. Tìm tiến trình đang giữ mở một file đã bị xoá.
2. Dùng `strace` để phát hiện chương trình đang tìm file cấu hình nào mà không thấy.
3. Xác định một hệ thống "chạy chậm" là do CPU, do I/O hay do swap.
4. Xác định một sự cố mạng là do kết nối hay do DNS.

## Bài tiếp theo

Bài cuối: cross-compile cho board, điều khiển GPIO và I²C từ user space, cùng bức tranh về
toolchain và công cụ dựng image (Buildroot và Yocto) đủ sâu để biết bạn cần cái nào.
