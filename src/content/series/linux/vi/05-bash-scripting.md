---
lesson: 5
lang: vi
title: "Viết script bash không phản chủ"
description: "Biến, rẽ nhánh, vòng lặp và hàm — cùng dòng strict mode, quy tắc đặt nháy, và mã thoát giúp script chạy tự động một cách an toàn."
duration: "18 phút"
tags: ["Linux", "Bash", "Tự động hoá"]
---

## Khi nào một script đáng viết

Quy tắc tôi dùng: đến lần thứ ba gõ cùng một chuỗi lệnh thì hãy ghi nó lại. Một quy trình
nạp firmware rồi kiểm tra, một thủ tục thu thập log, một bản build phát hành — những thứ đó
xứng đáng với ba chục dòng bash và không bao giờ xứng đáng với một chương trình "thật".

## Giải phẫu một script an toàn

![Giải phẫu script bash](/MyPortfolio/images/linux/bash-script.svg)

```bash
#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-/dev/ttyUSB0}"
FIRMWARE="${2:-build/firmware.bin}"

if [[ ! -e "$PORT" ]]; then
    echo "Khong thay cong: $PORT" >&2
    exit 1
fi

esptool.py --port "$PORT" write_flash 0x0 "$FIRMWARE"
echo "Da nap $FIRMWARE vao $PORT"
```

Cho phép chạy rồi chạy:

```bash
chmod +x flash.sh
./flash.sh /dev/ttyUSB1
```

Giờ tới bốn phần quan trọng.

### 1. Dòng shebang

`#!/usr/bin/env bash` ở dòng 1 báo cho kernel biết dùng trình thông dịch nào. Dùng `env`
thay vì ghi cứng `/bin/bash` giúp script chạy được trên hệ thống mà bash nằm ở chỗ khác.

Nếu bạn viết `#!/bin/sh`, bạn nhận POSIX shell chứ không phải bash — `[[ ]]`, mảng và
`${var,,}` sẽ hỏng hết. Trên Debian và Ubuntu, `/bin/sh` là `dash`, một ngôn ngữ khác thật
sự. Hãy chọn một cái và nhất quán.

### 2. Strict mode

```bash
set -euo pipefail
```

- **`-e`** — thoát ngay khi có lệnh nào thất bại. Không có nó, một lệnh `cd` hỏng sẽ kéo
  theo `rm -rf *` chạy ở sai thư mục.
- **`-u`** — báo lỗi khi dùng biến chưa định nghĩa. Bắt được lỗi gõ nhầm: `$FIRMWRE` thành
  lỗi thay vì thành chuỗi rỗng.
- **`-o pipefail`** — pipeline thất bại nếu *bất kỳ* khâu nào hỏng, chứ không chỉ khâu cuối.
  Không có nó, `make | tee log` vẫn báo thành công dù `make` đã lỗi.

Thêm tạm `set -x` để in ra từng lệnh khi chạy — cách gỡ lỗi script nhanh nhất.

### 3. Luôn bọc biến trong nháy kép

```bash
FILE="bao cao.txt"

rm $FILE      # chạy thành: rm bao cao.txt   -> hai file, sai cả hai
rm "$FILE"    # chạy thành: rm "bao cao.txt" -> đúng
```

Quy tắc rất đơn giản: **bọc nháy kép cho mọi lần dùng biến, trừ khi có lý do cụ thể để
không.** Chỉ riêng thói quen này đã chặn phần lớn lỗi script.

### 4. Mã thoát

`exit 0` là thành công; khác đi là thất bại. Hãy in lỗi ra stderr bằng `>&2`, để bên gọi
tách được thông báo chẩn đoán khỏi kết quả thật.

## Biến

```bash
NAME="board-01"                 # không có dấu cách quanh dấu =
COUNT=5
FILES=$(ls *.bin)               # hứng kết quả của một lệnh
TODAY=$(date +%Y-%m-%d)

echo "$NAME"                    # dùng với $
echo "${NAME}_backup"           # thêm ngoặc nhọn khi dính liền ký tự khác
echo "Co ${#FILES} ky tu"       # độ dài
```

Giá trị mặc định và giá trị bắt buộc:

```bash
PORT="${1:-/dev/ttyUSB0}"       # dùng $1, hoặc mặc định nếu chưa đặt/rỗng
: "${API_KEY:?can co API_KEY}"  # dừng kèm thông báo nếu chưa đặt
```

Biến môi trường và biến shell:

```bash
LOCAL_VAR="chi o day"             # chỉ trong shell này
export SHARED_VAR="ca con nua"    # tiến trình con thừa hưởng
env | sort                        # mọi thứ đang được export
```

`export` là lý do `PATH`, `CC` và `CROSS_COMPILE` đến được các công cụ bạn gọi.

## Rẽ nhánh

```bash
if [[ -f "$CONFIG" ]]; then
    source "$CONFIG"
elif [[ -f /etc/defaults.conf ]]; then
    source /etc/defaults.conf
else
    echo "khong tim thay cau hinh" >&2
    exit 1
fi
```

Những phép kiểm tra bạn thật sự dùng:

| Phép thử | Đúng khi |
| --- | --- |
| `-e path` | tồn tại (file, thư mục, thiết bị, bất cứ gì) |
| `-f path` | là file thường |
| `-d path` | là thư mục |
| `-r` / `-w` / `-x` | đọc được / ghi được / chạy được |
| `-z "$s"` / `-n "$s"` | chuỗi rỗng / không rỗng |
| `"$a" == "$b"` | chuỗi bằng nhau (`!=` cho khác nhau) |
| `$a -eq $b` | số bằng nhau — còn `-ne -lt -le -gt -ge` |

Trong bash hãy dùng `[[ ]]`, đừng dùng `[ ]` kiểu cũ. Nó xử lý biến rỗng và dấu cách không
bọc nháy an toàn hơn nhiều, lại hỗ trợ `&&`, `||` và so khớp mẫu:

```bash
if [[ "$FILE" == *.bin && -s "$FILE" ]]; then
    echo "mot file nhi phan khong rong"
fi
```

Bạn cũng kiểm tra thẳng kết quả của lệnh được, thường gọn hơn:

```bash
if ping -c1 -W1 192.168.1.20 &>/dev/null; then
    echo "board dang song"
fi

command -v arm-none-eabi-gcc >/dev/null || { echo "thieu toolchain" >&2; exit 1; }
```

## Vòng lặp

```bash
for f in *.log; do
    gzip "$f"
done

for i in {1..5}; do
    echo "lan thu $i"
done

for dev in /dev/ttyUSB*; do
    [[ -e "$dev" ]] || continue        # không khớp gì thì mẫu giữ nguyên dạng chữ
    echo "tim thay $dev"
done

while read -r line; do
    echo "LOG: $line"
done < app.log

while ! ping -c1 -W1 "$BOARD" &>/dev/null; do
    echo "dang cho board..."
    sleep 2
done
```

Mẫu cuối — hỏi liên tục tới khi thiết bị trả lời — là xương sống của mọi script triển khai
tôi từng viết cho board có khởi động lại.

Đọc file theo từng dòng: luôn dùng `while read -r`, đừng dùng `for line in $(cat file)`.
Bản `for` tách theo mọi dấu cách chứ không chỉ theo dòng.

## Hàm

```bash
log() {
    echo "[$(date +%H:%M:%S)] $*"
}

require_tool() {
    local tool="$1"                       # local: không rò ra ngoài
    if ! command -v "$tool" >/dev/null; then
        echo "thieu cong cu: $tool" >&2
        return 1
    fi
}

require_tool esptool.py || exit 1
log "bat dau nap firmware"
```

`$1`, `$2`… là các tham số, `$*` là tất cả, `$#` là số lượng. Luôn khai báo biến bên trong
hàm bằng `local`, nếu không chúng là biến toàn cục và sẽ đụng nhau.

## Dọn dẹp bằng trap

```bash
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT      # chạy khi thoát bình thường VÀ khi lỗi VÀ khi Ctrl+C

work_in "$TMPDIR"
```

`trap ... EXIT` là destructor của shell, và là cách đúng để bảo đảm thư mục tạm, image đã
mount và dịch vụ đã dừng đều được dọn sạch ngay cả khi script chết giữa chừng.

## Một script hoàn chỉnh, sát thực tế

Thu thập thông tin chẩn đoán từ board qua SSH — loại việc bạn viết một lần rồi dùng nhiều
năm:

```bash
#!/usr/bin/env bash
set -euo pipefail

BOARD="${1:?cach dung: collect.sh <user@host> [thu_muc_ra]}"
OUTDIR="${2:-diag-$(date +%Y%m%d-%H%M%S)}"

log() { echo "[$(date +%H:%M:%S)] $*"; }

mkdir -p "$OUTDIR"
trap 'log "that bai — ket qua mot phan o $OUTDIR"' ERR

log "kiem tra ket noi"
if ! ssh -o ConnectTimeout=5 "$BOARD" true; then
    echo "khong ket noi duoc toi $BOARD" >&2
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
    log "dang lay $name"
    ssh "$BOARD" "${CMDS[$name]}" > "$OUTDIR/$name.txt" 2>&1 || \
        log "  (canh bao: $name that bai)"
done

log "lay journal"
ssh "$BOARD" "journalctl -b --no-pager" > "$OUTDIR/journal.txt" 2>&1 || true

tar czf "$OUTDIR.tar.gz" "$OUTDIR"
log "xong: $OUTDIR.tar.gz ($(du -h "$OUTDIR.tar.gz" | cut -f1))"
```

Chú ý `|| true` ở phần journal: một image tối giản thiếu `journalctl` thì không nên làm hỏng
cả đợt thu thập, mà với `set -e` thì nó sẽ hỏng thật.

## Gỡ lỗi script

```bash
bash -n script.sh      # kiểm tra cú pháp mà không chạy
bash -x script.sh      # in ra từng lệnh khi thực thi
set -x ; ...; set +x   # chỉ theo dõi một đoạn
shellcheck script.sh   # trình lint bắt lỗi thật — nên cài
```

`shellcheck` là khoản đầu tư đáng giá nhất ở đây. Nó chỉ ra biến chưa bọc nháy, `cat` thừa,
toán tử so sánh sai và cả trăm thứ khác, kèm giải thích cho từng lỗi.

## Bài tập

1. Script nhận một thư mục và in ra năm file lớn nhất trong đó.
2. Script chờ `/dev/ttyUSB0` xuất hiện rồi mở màn hình serial.
3. Script sao lưu: nén một thư mục thành file có kèm thời gian, rồi xoá các bản nén cũ hơn
   7 ngày.

<details>
<summary>Gợi ý cho bài 3</summary>

```bash
#!/usr/bin/env bash
set -euo pipefail
SRC="${1:?cach dung: backup.sh <thu_muc>}"
DEST="${2:-$HOME/backups}"
mkdir -p "$DEST"
tar czf "$DEST/$(basename "$SRC")-$(date +%Y%m%d).tar.gz" -C "$(dirname "$SRC")" "$(basename "$SRC")"
find "$DEST" -name "*.tar.gz" -mtime +7 -delete
```
</details>

## Bài tiếp theo

Bài 6: làm việc từ xa — khoá SSH, truyền file, và biến chương trình của bạn thành một dịch
vụ systemd tự chạy lúc khởi động và tự bật lại khi crash.
