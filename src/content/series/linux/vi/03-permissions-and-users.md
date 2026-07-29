---
lesson: 3
lang: vi
title: "Phân quyền, người dùng và sudo"
description: "Đọc hiểu `ls -l`, con số của chmod nghĩa là gì, vì sao `chmod 777` gần như không bao giờ là câu trả lời, và việc thêm nhóm giúp mở cổng serial một lần cho mãi mãi."
duration: "14 phút"
tags: ["Linux", "Phân quyền", "sudo"]
---

## Vì sao bài này quan trọng hơn vẻ ngoài

`Permission denied` là bức tường phổ biến nhất mà lập trình viên quen Windows đâm vào khi
sang Linux. Cách sửa theo bản năng tìm thấy trên diễn đàn — `sudo chmod 777` — chạy được,
và gần như luôn sai. Mười phút ở đây cứu bạn khỏi một cái máy đầy file ai cũng ghi được và
một cổng serial lần nào cũng đòi `sudo`.

## Đọc `ls -l`

![Đọc ls -l](/MyPortfolio/images/linux/permissions.svg)

```
-rwxr-x---  1 dat dialout  8.2K Jul 29 20:14 flash.sh
```

Mười ký tự, rồi tới chủ sở hữu, rồi tới nhóm. Tách mười ký tự thành **1 + 3 + 3 + 3**:

| Vị trí | Ý nghĩa |
| --- | --- |
| 1 | loại: `-` file, `d` thư mục, `l` symlink, `c` thiết bị ký tự, `b` thiết bị khối |
| 2–4 | **chủ sở hữu** được làm gì |
| 5–7 | **nhóm** được làm gì |
| 8–10 | **những người còn lại** được làm gì |

Và mỗi bộ ba là `r` đọc, `w` ghi, `x` thực thi — dấu gạch nghĩa là "không được phép".

Vậy `-rwxr-x---` đọc là: một file thường; `dat` được đọc, ghi và chạy; thành viên nhóm
`dialout` được đọc và chạy; không ai khác làm được gì.

## Những con số

Mỗi chữ có trọng số: **r = 4, w = 2, x = 1**. Cộng lại theo từng bộ ba:

| Ký hiệu | Số | Dùng khi nào |
| --- | --- | --- |
| `rwx` | 7 | script và chương trình, cho chủ của nó |
| `rw-` | 6 | file dữ liệu thông thường |
| `r-x` | 5 | đọc và chạy, không sửa |
| `r--` | 4 | chỉ đọc |

Nên những bộ hay gặp là:

```bash
chmod 644 config.txt    # rw-r--r--  chủ sửa, ai cũng đọc được
chmod 755 build.sh      # rwxr-xr-x  chủ sửa, ai cũng chạy được
chmod 600 id_ed25519    # rw-------  khoá riêng: chỉ mình bạn, mãi mãi
chmod 700 ~/.ssh        # rwx------  tương tự cho thư mục
```

Dạng ký hiệu thường rõ ràng hơn khi chỉ sửa một chút:

```bash
chmod +x deploy.sh          # cho phép chạy (với mọi ai đọc được nó)
chmod u+w notes.md          # cho chủ quyền ghi
chmod go-rwx secrets.env    # tước sạch quyền của nhóm và người ngoài
chmod -R u+w src/           # đệ quy
```

## `x` trên thư mục lại mang nghĩa khác

Ai cũng vấp chỗ này đúng một lần. Với **thư mục**:

- `r` — được *liệt kê* nội dung (`ls`)
- `w` — được tạo và xoá mục bên trong
- `x` — được *bước vào* và truy cập thứ bên trong theo tên (`cd`, hoặc mở một file trong đó)

Nên thư mục có `r` mà không có `x` cho bạn thấy tên file nhưng không đọc được file. Thư mục
có `x` mà không có `r` cho bạn mở `dir/ten_da_biet.txt` nhưng không khám phá được bên trong
có gì. Đó chính xác là cách `~/.ssh` với mode `700` bảo vệ khoá của bạn.

## Vì sao `chmod 777` là phản xạ tồi

`777` nghĩa là mọi người dùng trên hệ thống đều đọc, ghi và chạy được. Trên máy build hay
board dùng chung, đó là lỗ hổng thật. Nhưng vấn đề thực tế còn đơn giản hơn: nó thường
không sửa được đúng lỗi của bạn, chỉ che nó đi.

Khi bị từ chối, hãy hỏi *cái nào* trong ba nhóm đang sai:

```bash
ls -l /dev/ttyUSB0
# crw-rw---- 1 root dialout 188, 0 Jul 29 20:31 /dev/ttyUSB0
```

Chủ là `root`, nhóm là `dialout`, nhóm có `rw`. Bạn không phải root, nên cách sửa chẳng
liên quan gì tới bit phân quyền — **nó nằm ở việc bạn thuộc nhóm nào**.

## Thao tác cần làm trên mọi máy mới

```bash
groups                              # tôi đang ở những nhóm nào?
sudo usermod -aG dialout $USER      # thêm mình vào dialout
# đăng xuất rồi đăng nhập lại — nhóm chỉ được nạp lúc đăng nhập
groups                              # dialout phải xuất hiện
```

Sau đó `screen /dev/ttyUSB0 115200`, `esptool.py`, `openocd` và `st-flash` đều chạy được mà
không cần `sudo`, mãi mãi, trên máy đó.

Chữ `-a` trong `-aG` nghĩa là *thêm vào*. Bỏ nó đi là bạn thay toàn bộ nhóm của người dùng
bằng đúng một nhóm — một buổi chiều thực sự tồi tệ. Các nhóm đáng biết khi làm nhúng:

| Nhóm | Cho quyền |
| --- | --- |
| `dialout` | cổng serial (`/dev/ttyUSB*`, `/dev/ttyACM*`) |
| `plugdev` | thiết bị USB cắm nóng (nhiều mạch debug) |
| `i2c` | `/dev/i2c-*` |
| `gpio` | thiết bị GPIO trên Raspberry Pi OS |
| `docker` | daemon Docker (lưu ý: tương đương quyền root) |

## Quyền sở hữu

```bash
sudo chown dat file.txt          # đổi chủ
sudo chown dat:dialout file.txt  # đổi cả chủ và nhóm
sudo chgrp dialout file.txt      # chỉ đổi nhóm
sudo chown -R dat:dat ~/project  # đệ quy — cứu các file do sudo tạo ra
```

Lệnh cuối là màn dọn dẹp sau khi bạn lỡ build bằng `sudo` và giờ không sở hữu gì trong
chính thư mục dự án của mình.

## sudo, root, và cái shell không phải root

`root` (UID 0) bỏ qua mọi kiểm tra quyền. Bạn không đăng nhập bằng root; bạn mượn quyền
của nó theo từng lệnh:

```bash
sudo apt install gcc         # chạy một lệnh với quyền root
sudo -i                      # một shell root (nên rời đi sớm)
sudo -u pi ./script.sh       # chạy dưới danh nghĩa người dùng khác, không phải root
```

Hai hành vi hay làm người ta bất ngờ:

**Chuyển hướng xảy ra ở shell của *bạn*, không phải trong sudo:**

```bash
sudo echo "x" > /etc/protected    # HỎNG — shell mở file chứ không phải sudo
echo "x" | sudo tee /etc/protected     # chạy được
sudo sh -c 'echo "x" > /etc/protected' # cũng chạy được
```

**`sudo` có `PATH` và môi trường riêng.** Một chương trình bạn chạy được có thể "not found"
khi qua `sudo`, và `sudo make install` có thể không thấy biến bạn vừa export. Dùng `sudo -E`
để giữ môi trường khi việc đó quan trọng.

Cấu hình nằm ở `/etc/sudoers` và chỉ được sửa bằng `visudo`, công cụ kiểm tra cú pháp trước
khi lưu — một lỗi cú pháp trong file đó có thể khoá bạn khỏi quyền root hoàn toàn.

## Người dùng và file, tóm gọn

```bash
whoami           # user hiện tại
id               # UID, GID và mọi nhóm
id -u            # id số của user — 0 là root
cat /etc/passwd  # mọi tài khoản (hash mật khẩu nằm ở /etc/shadow)
cat /etc/group   # mọi nhóm và thành viên
```

Trên một image nhúng mới, bạn thường tạo tài khoản dịch vụ không có shell đăng nhập:

```bash
sudo useradd -r -s /usr/sbin/nologin sensord
sudo chown -R sensord:sensord /var/lib/sensord
```

Chạy daemon dưới một user không đặc quyền riêng của nó là khoản lợi bảo mật rẻ nhất bạn có
thể có, và bài 6 sẽ chỉ cách nối nó vào systemd.

## umask — vì sao file mới là 644

File mới không sinh ra với `777`, mà bị `umask` che bớt, thường là `022`:

```bash
umask            # 0022
touch new.txt
ls -l new.txt    # -rw-r--r--  (666 trừ 022)
```

Thư mục xuất phát từ `777`, nên `777 - 022 = 755`. File thực thi lúc tạo ra là `644` vì
shell từ chối đoán rằng bạn định viết một chương trình — nên mới có bước `chmod +x` sau khi
viết script.

## Bài tập

1. Cho phép chỉ mình bạn chạy được một script, người khác thì không.
2. Xem nhóm nào sở hữu `/dev/ttyACM0` và bạn có thuộc nhóm đó không.
3. Sửa thư mục `~/.ssh` đang để quyền `755` (SSH sẽ từ chối dùng nó).
4. Nối thêm một dòng vào file thuộc root mà không cần `sudo -i`.

<details>
<summary>Đáp án</summary>

```bash
chmod 700 script.sh
ls -l /dev/ttyACM0 ; groups
chmod 700 ~/.ssh && chmod 600 ~/.ssh/id_*
echo "PermitRootLogin no" | sudo tee -a /etc/ssh/sshd_config
```
</details>

## Bài tiếp theo

Bài 4: tiến trình — cái gì đang chạy, cái gì ngốn CPU, cách dừng nó cho tử tế, và chuyện
gì xảy ra giữa shell và chương trình của bạn.
