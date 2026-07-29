---
lesson: 4
lang: vi
title: "Tiến trình, job và tín hiệu"
description: "Cái gì đang chạy và vì sao, fork/exec, chạy nền và chạy nổi, các tín hiệu đứng sau Ctrl+C, và cách tìm ra tiến trình đang giữ cổng serial của bạn."
duration: "15 phút"
tags: ["Linux", "Tiến trình", "Tín hiệu"]
---

## Mọi thứ đều là tiến trình

![Tiến trình, fork, exec, tín hiệu](/MyPortfolio/images/linux/processes.svg)

Tiến trình là một chương trình đang chạy, có vùng nhớ riêng, bộ mô tả file riêng, và một
con số: **PID**. Mọi tiến trình trừ cái đầu tiên đều có cha, tạo thành một cái cây bắt đầu
từ PID 1 — `systemd` trên đa số hệ thống, hoặc bất kỳ `init` nào image nhúng của bạn dùng.

Shell của bạn là một tiến trình. Lệnh bạn vừa chạy là con của nó. Khi bạn đóng terminal,
các con thường đi theo — và đó chính là lý do các việc chạy lâu cần `nohup` hoặc `tmux`,
sẽ nói ở cuối bài.

## Cái gì đang chạy

```bash
ps aux                 # mọi tiến trình trên hệ thống
ps -ef                 # y hệt, định dạng khác
ps aux | grep python   # chỉ những cái bạn quan tâm
pgrep -a sensord       # PID khớp tên, kèm dòng lệnh
pstree -p              # cái cây, kèm PID
```

Đọc kết quả `ps aux`:

```
USER  PID  %CPU %MEM    VSZ   RSS TTY   STAT START  TIME COMMAND
dat  2044   0.1  0.4  21504  8320 pts/0 Ss   20:14  0:01 -bash
dat  3187  98.3  2.1 512000 43008 pts/0 R+   20:31  1:12 ./sensord
```

- **VSZ** — bộ nhớ ảo đã đặt chỗ. Thường rất lớn và phần lớn vô nghĩa.
- **RSS** — bộ nhớ thường trú: RAM thật đang dùng. Đây mới là con số đáng quan tâm.
- **STAT** — `R` đang chạy, `S` đang ngủ (bình thường, chờ gì đó), `D` ngủ không ngắt được
  (kẹt trong driver — dấu hiệu xấu), `Z` zombie, `T` bị dừng.

Tiến trình 98% CPU với STAT `R` đang quay vòng bận. Tiến trình ở `D` quá một khoảnh khắc
thường có nghĩa đĩa hoặc driver thiết bị không trả lời.

## Quan sát trực tiếp

```bash
top          # ở đâu cũng có sẵn
htop         # dễ nhìn hơn: màu, chuột, xem cây, F9 để kill
```

Trong `htop`, `F5` bật/tắt chế độ cây và `F6` để sắp xếp. Ba thứ đáng nhìn trong năm giây
đầu: tiến trình nào đứng đầu cột CPU, thanh bộ nhớ đã gần đầy chưa, và **load average**
đang nói gì.

Load average là ba con số (1, 5, 15 phút) đếm số tiến trình sẵn sàng chạy + đang ngủ không
ngắt được. Hãy so với số nhân:

```bash
nproc          # có bao nhiêu nhân
uptime         # ... load average: 3.42, 2.10, 1.05
```

Trên board 4 nhân, `3.42` là bận nhưng ổn. Trên board một nhân, nó có nghĩa mọi thứ đang
xếp hàng.

## fork và exec — thực ra chuyện gì xảy ra

Khi bạn gõ `./sensord`, shell làm hai việc:

1. **`fork()`** — tạo một bản sao gần như y hệt chính nó, thành tiến trình mới.
2. **`exec()`** — bản sao đó thay ảnh chương trình của mình bằng `sensord`.

Rồi shell **chờ** đứa con và thu lấy mã thoát:

```bash
./sensord
echo $?       # 0 = thành công; khác đi là mã lỗi
```

Hai hệ quả có ý nghĩa thực tế:

- Con thừa hưởng môi trường, thư mục làm việc và các file descriptor đang mở từ cha. Đó là
  lý do `export` (bài 5) ảnh hưởng tới chương trình bạn chạy sau đó, và lý do việc chuyển
  hướng do shell thiết lập vẫn còn hiệu lực bên trong chương trình của bạn.
- **Zombie** là đứa con đã kết thúc mà cha chưa thu mã thoát. Nó không giữ bộ nhớ, chỉ giữ
  một ô PID. Nhiều zombie nghĩa là chương trình cha có lỗi, không phải rò rỉ bộ nhớ.

## Chạy nổi, chạy nền, job

```bash
./long_build              # chạy nổi: terminal bị chiếm
./long_build &            # chạy nền: shell trả quyền lại ngay
jobs                      # đang có gì chạy trong shell này
fg %1                     # đưa job 1 lên chạy nổi
bg %1                     # cho job đang dừng chạy tiếp ở nền
```

Quy trình bạn sẽ dùng liên tục:

```
Ctrl+Z          tạm dừng chương trình đang chạy (SIGTSTP)
bg              cho nó chạy tiếp ở nền
                ... làm việc khác ...
fg              gọi nó trở lại
```

Job chạy nền vẫn chết khi shell thoát. Để sống sót qua lần mất kết nối:

```bash
nohup ./long_build > build.log 2>&1 &     # miễn nhiễm với tín hiệu hangup
```

Tốt hơn, khi làm trên board từ xa, hãy dùng trình quản lý terminal:

```bash
tmux new -s build       # tạo phiên có tên
# Ctrl+B rồi D          tách ra — mọi thứ vẫn chạy
tmux attach -t build    # quay lại sau, kể cả từ máy khác
tmux ls                 # liệt kê các phiên
```

`tmux` (hoặc `screen`) là thứ khiến SSH dùng được qua đường truyền chập chờn: bản build
chẳng quan tâm laptop của bạn vừa ngủ đông.

## Tín hiệu

Tín hiệu là cách chuẩn để nói chuyện với một tiến trình đang chạy.

| Tín hiệu | Số | Gửi bởi | Ý nghĩa |
| --- | --- | --- | --- |
| `SIGINT` | 2 | `Ctrl+C` | xin hãy dừng — chương trình còn kịp dọn dẹp |
| `SIGTSTP` | 20 | `Ctrl+Z` | tạm dừng |
| `SIGTERM` | 15 | `kill PID` | xin hãy thoát — mặc định lịch sự |
| `SIGKILL` | 9 | `kill -9 PID` | chết ngay — kernel gỡ bỏ, không dọn dẹp gì |
| `SIGHUP` | 1 | terminal đóng | theo quy ước, daemon dùng để nạp lại cấu hình |

```bash
kill 3187          # SIGTERM — thử cái này trước
kill -9 3187       # SIGKILL — chỉ khi TERM đã thất bại
killall sensord    # theo tên
pkill -f "python.*logger"   # theo mẫu của cả dòng lệnh
```

> Vớ ngay `-9` là thói quen xấu. `SIGKILL` không bắt được, nên chương trình không kịp xả
> buffer, không đóng file tử tế, không nhả phần cứng. Trên thiết bị đang ghi vào flash, đó
> chính là cách bạn có một file hỏng.

Trong chương trình C của bạn, hãy bắt cái lịch sự:

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

    close_hardware();      /* giờ đoạn này mới thực sự chạy */
    return 0;
}
```

Tám dòng đó là khác biệt giữa một daemon khởi động lại an toàn và một daemon làm hỏng dữ
liệu mỗi lần triển khai.

## Tìm xem ai đang giữ tài nguyên

Bài kinh điển của dân nhúng: "cannot open /dev/ttyUSB0: Device or resource busy."

```bash
sudo lsof /dev/ttyUSB0        # tiến trình nào đang mở file này
sudo fuser -v /dev/ttyUSB0    # cùng câu hỏi, công cụ khác
sudo lsof -i :8080            # ai đang nghe ở cổng 8080
sudo ss -tulpn | grep 8080    # bản hiện đại của netstat
```

Mười lần thì chín lần đó là một cửa sổ `screen`, `minicom`, hoặc lần chạy trước của chính
công cụ nạp firmware mà bạn quên đóng.

## Độ ưu tiên

```bash
nice -n 10 ./big_build        # chạy với ưu tiên thấp hơn (nice = nhường người khác)
renice -n 5 -p 3187           # đổi ưu tiên của tiến trình đang chạy
```

Giá trị từ `-20` (ưu tiên cao nhất) tới `19` (thấp nhất). Chỉ root mới đặt được số âm. Trên
máy build, `nice -n 19 make -j$(nproc)` giữ cho máy vẫn dùng được trong lúc biên dịch.

## Đọc /proc

Mọi thứ `ps` hiển thị đều lấy từ `/proc`. Bạn đọc thẳng được, và điều đó vô giá khi gỡ lỗi
thiết bị:

```bash
cat /proc/3187/status      # trạng thái, số luồng, bộ nhớ, UID
cat /proc/3187/cmdline     # dòng lệnh chính xác (ngăn cách bằng ký tự NUL)
ls -l /proc/3187/fd        # mọi file descriptor đang mở, dưới dạng symlink
cat /proc/3187/maps        # ánh xạ bộ nhớ, kể cả thư viện đã nạp
cat /proc/cpuinfo          # model CPU, số nhân, tính năng
cat /proc/meminfo          # bộ nhớ chi tiết
cat /proc/interrupts       # số lần ngắt theo từng IRQ  <- rất hợp khi làm driver
```

`ls -l /proc/PID/fd` trả lời câu "ngay lúc này nó đang mở những file nào", thường là đường
nhanh nhất tới một chỗ rò rỉ file descriptor.

## Bài tập

1. Chạy một lệnh lâu, tạm dừng nó, cho chạy tiếp ở nền, rồi gọi trở lại chạy nổi.
2. Tìm PID của tiến trình đang dùng nhiều bộ nhớ nhất.
3. Tìm tiến trình đang giữ cổng serial của bạn và dừng nó một cách lịch sự.
4. Chạy một bản build sống sót qua việc đóng phiên SSH.

<details>
<summary>Đáp án</summary>

```bash
sleep 300      # rồi Ctrl+Z, rồi: bg, rồi: fg
ps aux --sort=-%mem | head -2
sudo lsof /dev/ttyUSB0 && kill <PID>
tmux new -s build   # hoặc: nohup make > build.log 2>&1 &
```
</details>

## Bài tiếp theo

Bài 5: viết script bash — biến, rẽ nhánh, vòng lặp, và bốn dòng đầu file giúp script không
làm điều thảm hoạ khi một lệnh nào đó thất bại.
