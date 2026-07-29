---
lesson: 2
lang: vi
title: "Dòng lệnh bạn thật sự sẽ dùng"
description: "Di chuyển, thao tác file, tìm kiếm, và toán tử pipe — cách hai chục công cụ nhỏ ghép lại thành đúng công cụ bạn cần."
duration: "18 phút"
tags: ["Linux", "Shell", "Dòng lệnh"]
---

## Canh bạc của Unix

Windows cho bạn một chương trình to cho mỗi công việc. Unix đặt cược vào hướng ngược lại:
thật nhiều chương trình tí hon, mỗi cái làm đúng một việc, cộng với cách nối chúng lại.
`grep` chỉ lọc dòng. `sort` chỉ sắp xếp. `wc` chỉ đếm. Đứng riêng chẳng cái nào ấn tượng;
nối lại với nhau, chúng thay thế cả phần mềm mà lẽ ra bạn phải tự viết.

Bài này là từ vựng. Phần sau là ngữ pháp.

## Di chuyển

```bash
pwd                    # tôi đang ở đâu
cd /var/log            # đường dẫn tuyệt đối
cd ..                  # lùi một cấp
cd ~/projects          # ~ là thư mục nhà
cd -                   # quay lại thư mục vừa rời (rất hữu ích)
cd                     # không tham số: về thẳng nhà
```

Liệt kê:

```bash
ls                     # chỉ tên
ls -l                  # chi tiết: quyền, chủ, kích thước, ngày
ls -lh                 # kích thước dạng 4.0K / 2.3M thay vì byte
ls -la                 # kể cả file ẩn (.bashrc, .git, ...)
ls -lt                 # sắp theo thời gian sửa, mới nhất trước
ls -ltr                # ... đảo lại, mới nhất nằm cuối, ngay sát dấu nhắc
```

`ls -ltr` là lệnh dân quen tay gõ không cần nghĩ — sau khi build xong, file bạn vừa tạo
nằm ở dòng cuối cùng.

**Tab completion không phải tuỳ chọn.** Gõ ba chữ rồi bấm Tab. Bấm hai lần để liệt kê các
ứng viên. Nó chặn hầu hết lỗi gõ nhầm và dạy bạn biết có những gì ở đó.

## Xem nội dung file

```bash
cat config.txt           # đổ hết ra màn hình (chỉ với file ngắn)
less big.log             # lật từng trang: space, b, /tìm, q để thoát
head -20 data.csv        # 20 dòng đầu
tail -20 data.csv        # 20 dòng cuối
tail -f /var/log/syslog  # bám theo: in dòng mới ngay khi có  <- rất quan trọng
wc -l data.csv           # đếm số dòng
file firmware.bin        # thực ra đây là loại file gì?
```

`tail -f` là cách bạn theo dõi log thiết bị trong lúc tái hiện lỗi. `Ctrl+C` để dừng.

## Tạo, sao chép, xoá

```bash
mkdir build                 # một thư mục
mkdir -p a/b/c              # tạo cả chuỗi, không báo lỗi nếu đã có
touch notes.md              # tạo file rỗng / cập nhật thời gian

cp fw.bin fw.bin.bak        # sao chép
cp -r src/ backup/          # -r cho thư mục
mv old.txt new.txt          # đổi tên
mv report.pdf ~/docs/       # di chuyển

rm temp.log                 # xoá một file
rm -r build/                # xoá cả cây thư mục
rm -rf build/               # ... không hỏi han gì. Cẩn thận.
```

> Không có thùng rác. `rm` là vĩnh viễn, và `rm -rf` nhầm đường dẫn đã kết liễu vài sự
> nghiệp. Hai thói quen phòng thân: đừng bao giờ để biến ngay sau `rm -rf`
> (`rm -rf "$DIR"/` thành `rm -rf /` khi `DIR` rỗng), và chạy `ls` lên đúng đường dẫn đó
> trước để xác nhận nó đúng là thứ bạn nghĩ.

## Tìm kiếm

Hai công cụ khác nhau mà người mới hay lẫn:

**`find` tìm file theo tên hoặc thuộc tính:**

```bash
find . -name "*.log"                 # theo tên, đệ quy từ đây
find . -name "*.c" -newer Makefile   # file C sửa sau Makefile
find /var/log -size +10M             # lớn hơn 10 MB
find . -type d -name build           # thư mục tên build
find . -name "*.o" -delete           # tìm rồi xoá luôn
```

**`grep` tìm chữ *bên trong* file:**

```bash
grep "error" app.log                 # các dòng khớp
grep -i "error" app.log              # không phân biệt hoa thường
grep -r "TODO" src/                  # đệ quy cả cây thư mục
grep -n "malloc" main.c              # hiện số dòng
grep -v "DEBUG" app.log              # đảo ngược: các dòng KHÔNG khớp
grep -C 3 "panic" kernel.log         # 3 dòng ngữ cảnh quanh mỗi kết quả
```

`grep -rn "ten_ham" .` là cách bạn dò đường trong một codebase C xa lạ khi chưa kịp dựng
IDE. Nó nhanh hơn bạn tưởng.

## Pipe — lý do thật sự của shell

![Pipe và chuyển hướng](/MyPortfolio/images/linux/pipeline.svg)

Mỗi chương trình có ba kênh: **stdin** (đầu vào), **stdout** (kết quả bình thường), và
**stderr** (lỗi). Dấu `|` nối stdout của chương trình này vào stdin của chương trình kia.

Hãy đọc từ trái sang phải:

```bash
dmesg | grep -i usb | tail -20
```

"In log kernel → chỉ giữ dòng có chữ USB → cho tôi xem 20 dòng cuối." Ba công cụ, một câu
trả lời cụ thể, không phải viết script nào.

Vài chuỗi khác bạn sẽ dùng đi dùng lại thật:

```bash
# tiến trình nào đang ngốn bộ nhớ
ps aux | sort -k4 -nr | head -10

# mỗi IP đã gọi vào server bao nhiêu lần
awk '{print $1}' access.log | sort | uniq -c | sort -nr | head

# mọi mã lỗi khác nhau trong một log
grep -o "E[0-9]\{4\}" app.log | sort -u

# thư mục con nào nặng nhất, to nhất ở cuối
du -sh */ | sort -h
```

Cụm `sort | uniq -c | sort -nr` — đếm số lần xuất hiện, nhiều nhất lên trước — giải quyết
một tỉ lệ đáng ngạc nhiên các bài toán thực tế. Lưu ý `uniq` chỉ gộp các dòng trùng *liền
kề*, nên trước nó luôn phải có `sort`.

## Chuyển hướng

```bash
make > build.log              # stdout vào file (ghi đè)
make >> build.log             # nối thêm thay vì ghi đè
make 2> errors.log            # chỉ stderr
make > all.log 2>&1           # gộp cả hai vào một file
make 2>/dev/null              # vứt lỗi đi
./app < input.txt             # lấy file làm stdin
make | tee build.log          # vừa hiện màn hình VỪA lưu ra file
```

`tee` là thứ người ta hay quên. Khi build mất bốn phút, bạn vừa muốn nhìn nó chạy, vừa
muốn giữ lại kết quả.

`/dev/null` là hố đen của hệ thống: viết gì vào đó cũng biến mất.

## Ký tự đại diện (wildcard)

Shell khai triển chúng *trước khi* lệnh chạy:

```bash
ls *.c              # mọi file kết thúc bằng .c
ls test_?.log       # ? khớp đúng một ký tự
ls fw_[0-9].bin     # một lớp ký tự
cp src/*.{c,h} backup/    # khai triển ngoặc nhọn: *.c và *.h
```

Vì việc khai triển xảy ra ở shell, `rm *` và `rm "*"` khác nhau hoàn toàn — cái đầu xoá
sạch, cái sau đi tìm một file tên đúng là `*`.

## Nối lệnh

```bash
cd build && make && ./app     # lệnh sau chỉ chạy nếu lệnh trước thành công
make || echo "build that bai" # chỉ chạy nếu lệnh trước THẤT BẠI
make ; ls                     # chạy bất kể thế nào
```

`&&` là cách viết một dòng lệnh an toàn: hỏng ở đâu thì dừng ở đó. Mọi lệnh đều trả về mã
thoát — `0` là thành công — và bạn xem được nó:

```bash
make
echo $?        # 0 = ổn, khác 0 = có lỗi
```

## Lịch sử và phím tắt

```bash
history               # mọi thứ bạn đã gõ
!!                    # lặp lại lệnh vừa rồi
sudo !!               # lặp lại nó kèm sudo  <- kinh điển
!542                  # chạy lại mục số 542 trong lịch sử
```

Những phím đáng học ngay hôm nay:

| Phím | Tác dụng |
| --- | --- |
| `Ctrl+R` | tìm trong lịch sử khi đang gõ — cú tăng tốc lớn nhất |
| `Ctrl+A` / `Ctrl+E` | nhảy về đầu / cuối dòng |
| `Ctrl+U` / `Ctrl+K` | xoá về đầu / cuối dòng |
| `Ctrl+W` | xoá từ phía trước |
| `Ctrl+C` | huỷ lệnh đang chạy |
| `Ctrl+L` | xoá màn hình |

## Trình soạn thảo, mức tối thiểu

Sớm muộn bạn sẽ phải sửa một file cấu hình trên máy chỉ có `vi`. Mức tối thiểu để thoát ra
còn nguyên vẹn:

```
i          vào chế độ chèn, gõ bình thường
Esc        quay lại chế độ lệnh
:w         lưu
:q         thoát
:wq        lưu rồi thoát
:q!        thoát, bỏ hết thay đổi
```

`nano` dễ chịu hơn nếu có (phím tắt in ngay dưới đáy: `^O` ghi ra, `^X` thoát). Trên image
nhúng tối giản thì thường chỉ có `vi`.

## Bài tập

Làm trong một thư mục nháp. Tất cả đều trả lời được bằng những thứ ở trên:

1. Tìm mười file lớn nhất dưới `/var/log`.
2. Đếm xem cây mã nguồn có bao nhiêu file `.c`, tính cả thư mục con.
3. Hiện mọi dòng `dmesg` có chữ "i2c" kèm hai dòng ngữ cảnh.
4. Lưu cả kết quả lẫn lỗi của một lần build vào một file mà vẫn xem trực tiếp được.
5. Liệt kê file sửa trong một ngày qua, mới nhất nằm dưới cùng.

<details>
<summary>Đáp án</summary>

```bash
find /var/log -type f -exec du -h {} + | sort -h | tail -10
find . -name "*.c" | wc -l
dmesg | grep -C 2 -i i2c
make 2>&1 | tee build.log
find . -mtime -1 -type f -exec ls -ltr {} +
```
</details>

## Bài tiếp theo

Bài 3: phân quyền, người dùng và `sudo` — vì sao `Permission denied` xảy ra và cách sửa
đúng (thường không phải là `chmod 777`).
