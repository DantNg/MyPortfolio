---
lesson: 6
lang: vi
title: "Làm việc từ xa — SSH, truyền file và dịch vụ systemd"
description: "SSH dùng khoá, không bao giờ hỏi mật khẩu; chuyển file bằng scp và rsync; và biến chương trình của bạn thành dịch vụ tự chạy lúc khởi động, tự bật lại khi crash."
duration: "17 phút"
tags: ["Linux", "SSH", "systemd"]
---

## Thực tế: mọi thứ đều từ xa

Công việc embedded Linux diễn ra trên một board không bàn phím, không màn hình. Bạn soạn
code trên laptop, build trên laptop, và mọi thứ đến được target qua mạng. Bài này chính là
quy trình đó.

![SSH và systemd](/MyPortfolio/images/linux/systemd-ssh.svg)

## Cấu hình SSH một lần cho xong

```bash
ssh pi@192.168.1.20                # hỏi mật khẩu, lần nào cũng hỏi
```

Đừng làm vậy nữa. Tạo cặp khoá, đưa nửa công khai lên board, và không bao giờ gõ mật khẩu
nữa:

```bash
# trên MÁY CỦA BẠN, làm một lần duy nhất
ssh-keygen -t ed25519 -C "dat@laptop"
# Enter để lấy đường dẫn mặc định; nên đặt passphrase nếu là laptop hay mang đi

# đẩy khoá công khai lên board
ssh-copy-id pi@192.168.1.20

# giờ thì
ssh pi@192.168.1.20                # vào thẳng
```

Chuyện vừa xảy ra: `~/.ssh/id_ed25519` (khoá riêng, ở lại laptop mãi mãi) và
`~/.ssh/id_ed25519.pub` (khoá công khai, chép đi đâu cũng an toàn). `ssh-copy-id` đã nối
nửa công khai vào `~/.ssh/authorized_keys` trên board.

Nếu chưa chạy, thủ phạm quen thuộc là phân quyền — SSH từ chối khoá mà người khác đọc được:

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub ~/.ssh/authorized_keys
```

## ~/.ssh/config — file tiết kiệm nhiều thao tác gõ nhất

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

Giờ `ssh board` là toàn bộ câu lệnh — và `scp file board:` hay `rsync ... board:` cũng dùng
chung bí danh đó.

`ServerAliveInterval` là thứ giữ cho phiên của bạn không lặng lẽ treo trên đường Wi-Fi chập
chờn.

## Chạy lệnh mà không cần mở shell

```bash
ssh board 'uname -a'                       # một lệnh rồi ngắt kết nối
ssh board 'systemctl status sensord'
ssh board 'journalctl -u sensord -n 50' > board.log     # kết quả rơi về máy bạn
ssh board 'tail -f /var/log/app.log'       # theo dõi log từ xa theo thời gian thực
cat local_script.sh | ssh board 'bash -s'  # chạy script cục bộ trên máy từ xa
```

Cái cuối thực sự hữu ích: không cần copy script lên trước.

## Chuyển file

**`scp`** cho những lần chép lẻ:

```bash
scp firmware.bin board:/tmp/               # đẩy lên
scp board:/var/log/app.log ./              # kéo về
scp -r ./config board:/etc/myapp/          # cả thư mục
```

**`rsync`** cho mọi thứ bạn làm nhiều hơn một lần. Nó chỉ truyền phần khác biệt, và trên
đường truyền chậm thì đó là khác biệt giữa vài giây và vài phút:

```bash
rsync -avz --progress build/ board:/opt/app/
rsync -avz --delete src/ board:/opt/app/src/    # đồng bộ y hệt, xoá cả file thừa
rsync -avz --exclude '*.o' --exclude '.git' ./ board:/home/pi/project/
```

Cờ: `-a` archive (đệ quy, giữ quyền và thời gian), `-v` chi tiết, `-z` nén khi truyền.

> Dấu gạch chéo cuối rất quan trọng. `rsync src/ dest/` chép *nội dung* của `src`; còn
> `rsync src dest/` chép *thư mục* `src` vào trong `dest`. Ai cũng vấp chỗ này một lần.

## Chuyển tiếp cổng (port forwarding)

Board của bạn chạy web dashboard ở cổng 8080 nhưng chỉ nghe trên localhost:

```bash
ssh -L 8080:localhost:8080 board
# giờ mở http://localhost:8080 bằng trình duyệt trên laptop
```

Chiều ngược lại, khi board cần với tới dịch vụ trên laptop của bạn:

```bash
ssh -R 9000:localhost:9000 board
```

Đây là cách gỡ lỗi một thiết bị nằm sau NAT mà không phải mở cổng tường lửa nào.

## systemd — biến chương trình thành dịch vụ

Chạy `./sensord &` qua SSH nghĩa là chương trình chết theo phiên và không bao giờ quay lại
sau khi khởi động lại máy. Một **unit file** giải quyết cả hai:

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

# siết bảo mật — rẻ mà đáng
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/sensord

[Install]
WantedBy=multi-user.target
```

Cài đặt và điều khiển:

```bash
sudo systemctl daemon-reload           # sau mỗi lần sửa unit file
sudo systemctl enable --now sensord    # chạy ngay VÀ chạy mỗi lần khởi động
systemctl status sensord               # còn sống không? kèm vài dòng log cuối
sudo systemctl restart sensord
sudo systemctl stop sensord
sudo systemctl disable sensord         # thôi không tự chạy lúc khởi động
```

Những trường quan trọng nhất:

- **`Restart=always`** cùng **`RestartSec=5`** — khoản lợi về độ tin cậy lớn nhất trên
  thiết bị bạn không sờ tới được. Chương trình chết thì năm giây sau nó quay lại.
- **`After=`/`Wants=`** — thứ tự khởi động. Dịch vụ cần mạng phải chờ mạng, nếu không nó sẽ
  hỏng lúc boot nhưng chạy ngon khi bạn thử tay — một loại lỗi phát điên.
- **`User=`** — đừng chạy bằng root. Hãy tạo tài khoản dịch vụ (bài 3).
- **`Type=simple`** cho chương trình chạy nổi liên tục; **`Type=notify`** nếu nó dùng
  sd_notify; **`Type=oneshot`** kèm `RemainAfterExit=yes` cho các tác vụ thiết lập.

## Log — journalctl

Nếu chương trình của bạn in ra stdout, systemd tự hứng. Không cần dựng đường ống log nào:

```bash
journalctl -u sensord              # mọi thứ của unit này
journalctl -u sensord -f           # theo dõi trực tiếp  <- cái bạn sẽ dùng
journalctl -u sensord -n 100       # 100 dòng cuối
journalctl -u sensord --since "10 min ago"
journalctl -u sensord -p err       # chỉ lỗi trở lên
journalctl -b                      # mọi thứ từ lần khởi động này
journalctl -b -1                   # lần khởi động TRƯỚC — vì sao nó reboot?
journalctl -k                      # thông điệp kernel (giống dmesg)
journalctl --disk-usage
sudo journalctl --vacuum-size=100M # giới hạn lại trên thẻ SD nhỏ
```

`journalctl -b -1 -p err` là lệnh đầu tiên nên chạy trên board vừa khởi động lại bất thường.

## Timer thay cho cron

Timer của systemd thay thế cron và ghi log tử tế:

```ini
# /etc/systemd/system/backup.service
[Service]
Type=oneshot
ExecStart=/usr/local/bin/backup.sh
```

```ini
# /etc/systemd/system/backup.timer
[Unit]
Description=Sao luu hang dem

[Timer]
OnCalendar=daily
Persistent=true          # chạy bù ở lần khởi động sau nếu máy đang tắt

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl enable --now backup.timer
systemctl list-timers            # cái gì chạy tiếp theo, lúc nào
```

`Persistent=true` là lý do timer hơn cron trên thiết bị không chạy 24/7.

## Khi một dịch vụ không chịu khởi động

Hãy đi theo đúng thứ tự này:

```bash
systemctl status sensord           # 1. lỗi thường nằm ngay đây
journalctl -u sensord -n 50        # 2. toàn bộ output
sudo systemd-analyze verify /etc/systemd/system/sensord.service   # 3. cú pháp
sudo -u sensord /usr/local/bin/sensord   # 4. chạy tay dưới đúng user đó
```

Bước 4 bắt được nguyên nhân phổ biến nhất: chạy bằng tài khoản của bạn thì được, chạy bằng
tài khoản dịch vụ thì hỏng, vì khác quyền hoặc khác `PATH`.

## Bài tập

1. Thiết lập SSH bằng khoá tới một board hoặc máy ảo, và thêm một mục vào `~/.ssh/config`.
2. Đồng bộ thư mục build cục bộ sang target bằng rsync, loại trừ các file object.
3. Viết unit file cho một script ghi nhiệt độ CPU mỗi phút, rồi kiểm chứng nó tự chạy lại
   sau khi bạn kill.

## Bài tiếp theo

Bài 7: gỡ lỗi — đọc log, `strace`, `/proc`, và bộ công cụ chuẩn để xác định vấn đề nằm ở
chương trình của bạn, ở kernel, ở đĩa hay ở mạng.
