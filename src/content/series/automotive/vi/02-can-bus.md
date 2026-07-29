---
lesson: 2
lang: vi
title: "CAN và CAN FD, tới từng bit"
description: "Bố cục khung, cơ chế phân xử bảo đảm thông điệp quan trọng nhất luôn thắng mà không mất khung nào, cách đọc file DBC, và thực hành với SocketCAN."
duration: "17 phút"
tags: ["Ô tô", "CAN", "CAN FD"]
---

## Ý tưởng đứng sau CAN

CAN do Bosch thiết kế năm 1986 để thay cho việc đi dây điểm–điểm, và các quyết định thiết kế
của nó tới nay vẫn hợp lý:

- **Không có địa chỉ.** Một khung mang **định danh mô tả NỘI DUNG**, không phải người nhận.
  `0x0C9` có thể nghĩa là "vòng tua động cơ". Mọi ECU trên bus đều nhận mọi khung và tự lọc
  cái mình quan tâm.
- **Đa chủ.** Bất kỳ node nào cũng được phát khi bus rảnh.
- **Phân xử không phá huỷ.** Khi hai node cùng bắt đầu, một bên thắng và bên kia lùi lại — và
  *không khung nào bị mất hay hỏng*. Đây là phần thông minh.
- **Hai dây, vi sai.** CAN_H và CAN_L, xoắn đôi, điện trở đầu cuối 120 Ω ở hai đầu. Rất bền
  trước nhiễu điện trong khoang máy.

Mô hình định địa chỉ theo nội dung đó có hệ quả thật cho thiết kế: thêm một bên nghe mới thì
**không cần đổi gì** ở bên gửi. Thêm một bên gửi mới thì phải cập nhật tài liệu thiết kế
mạng, vì tải bus và dải ID là ngân sách dùng chung.

## Khung dữ liệu

![Khung CAN và phân xử](/MyPortfolio/images/automotive/can-frame.svg)

Một khung dữ liệu chuẩn:

| Trường | Bit | Ý nghĩa |
| --- | --- | --- |
| SOF | 1 | bắt đầu khung, mức trội |
| **Identifier** | 11 | ưu tiên và nội dung |
| RTR | 1 | yêu cầu truyền từ xa (ngày nay gần như không dùng) |
| Control (IDE, r0, DLC) | 6 | DLC = số byte dữ liệu |
| **Data** | 0–64 | phần tải |
| CRC | 15 + delimiter | phát hiện lỗi |
| ACK | 2 | mọi bên nhận đúng đều kéo bit này xuống mức trội |
| EOF + IFS | 10 | kết thúc khung và khoảng nghỉ giữa khung |

Khung mở rộng dùng định danh 29 bit, phổ biến trong J1939 (xe tải) và trong chẩn đoán.

Ô **ACK** đáng được ghi chú: bên phát gửi nó ở mức lặn, và *bất kỳ* node nào nhận đúng khung
sẽ ghi đè xuống mức trội. Vậy nên một bên phát đứng một mình trên bus không có node nào khác
sẽ không nhận được ACK, phát lại, và cuối cùng rơi vào error-passive. Nếu bạn từng thấy một
node trên bàn thử "không chịu phát", thường là vì lý do đó — bạn cần node thứ hai, hoặc điện
trở đầu cuối và chế độ loopback.

## Phân xử — phần tinh tế

Bus là wired-AND: bit `0` là **trội (dominant)**, bit `1` là **lặn (recessive)**. Chỉ cần một
node phát 0, bus đọc ra 0.

Mọi bên phát đều nghe bus trong lúc gửi. Luật:

> Nếu tôi gửi bit lặn mà đọc lại thấy bit trội, tức là có node khác với ID ưu tiên cao hơn
> đang phát. Tôi dừng ngay và chuyển sang làm bên nhận.

Hai node cùng bắt đầu:

```
Node A (ID 0x100):  0 0 1 0 0 0 0 0 0 0 0
Node B (ID 0x1A0):  0 0 1 1  ← gửi 1, đọc ra 0, thua, dừng
Bus:                0 0 1 0 0 0 0 0 0 0 0
```

Node A hoàn toàn không nhận ra có chuyện gì xảy ra và hoàn tất khung của mình bình thường.
Node B thử lại ngay khi bus rảnh. **Không mất gì, không tốn băng thông cho va chạm**, và số
ID càng nhỏ thì ưu tiên càng cao.

Đó là lý do người thiết kế mạng gán ID rất cẩn thận: `0x0C9` cho thông điệp mô-men động cơ
chu kỳ 10 ms, `0x6xx` cho trạng thái chẩn đoán chu kỳ 1000 ms. ID *chính là* ưu tiên, và
không thể đổi về sau nếu không đàm phán lại toàn bộ thiết kế mạng.

Hệ quả cho phân tích thời gian thực: một khung ưu tiên thấp có thể bị trì hoãn bởi bất kỳ số
lượng khung ưu tiên cao nào. Độ trễ xấu nhất của ID `x` được tính từ tần suất xuất hiện của
mọi ID nhỏ hơn `x`, và công cụ thiết kế mạng CAN làm đúng phép phân tích đó. Tải bus vượt
khoảng **40–50%** là lúc độ trễ của các khung ưu tiên thấp bắt đầu bùng nổ.

## CAN FD

CAN FD (Flexible Data-rate, 2012) giữ nguyên phần phân xử nhưng thay đổi pha dữ liệu:

| | CAN 2.0 | CAN FD |
| --- | --- | --- |
| Tải | 8 byte | tới 64 byte |
| Tốc độ pha phân xử | tới 1 Mbit/s | như cũ |
| Tốc độ pha dữ liệu | bằng pha phân xử | tới 8 Mbit/s |
| CRC | 15 bit | 17 hoặc 21 bit |

Mẹo nằm ở chỗ: phân xử vẫn diễn ra ở tốc độ chậm, vì nó phụ thuộc vào việc mọi node đều thấy
được bit trong vòng một thời gian bit trên toàn bộ chiều dài bus. Khi đã thắng phân xử, chỉ
còn bên gửi và bên nhận là quan trọng, nên tốc độ bit có thể nhảy vọt cho pha dữ liệu.

Thực tế: **nhiều dữ liệu hơn 8 lần mỗi khung với chi phí quản lý gần như không đổi**, đó là
lý do mọi thiết kế mới đều dùng nó. Khung 64 byte cũng loại bỏ việc phải chia nhỏ nhiều
khung — thứ khiến CAN 8 byte rất vụng về với dữ liệu có cấu trúc.

## File DBC — tấm bản đồ của mạng

Một khung chỉ là 8 byte thô. Thứ biến nó thành `EngineSpeed = 2150 rpm` là một **file DBC**,
cơ sở dữ liệu do OEM sở hữu, mô tả mọi thông điệp và tín hiệu.

```
BO_ 201 ENGINE_DATA: 8 ECM
 SG_ EngineSpeed : 0|16@1+ (0.25,0) [0|16383.75] "rpm" DASH,ABS
 SG_ CoolantTemp : 16|8@1+ (1,-40) [-40|215] "degC" DASH
 SG_ ThrottlePos : 24|8@1+ (0.4,0) [0|100] "%" DASH
```

Đọc dòng tín hiệu `0|16@1+ (0.25,0)`:

- `0|16` — bắt đầu ở bit 0, dài 16 bit
- `@1` — little-endian (Intel). `@0` sẽ là big-endian (Motorola)
- `+` — không dấu. `-` sẽ là có dấu
- `(0.25,0)` — **hệ số và độ lệch**: `giá_trị_vật_lý = giá_trị_thô × 0,25 + 0`
- `[0|16383.75]` — dải hợp lệ
- `"rpm"` — đơn vị
- `DASH,ABS` — những ECU nào nhận nó

Vậy giá trị thô `8600` nghĩa là `8600 × 0,25 = 2150 rpm`. Cơ chế hệ số/độ lệch đó là cách CAN
nhồi đại lượng vật lý vào ít bit: nhiệt độ chỉ cần một byte với độ lệch −40 là phủ được từ
−40 °C tới 215 °C, bước 1 °C.

Giải mã bằng Python:

```python
import cantools, can

db = cantools.database.load_file('powertrain.dbc')
bus = can.interface.Bus('vcan0', bustype='socketcan')

for msg in bus:
    try:
        decoded = db.decode_message(msg.arbitration_id, msg.data)
        print(f"{db.get_message_by_frame_id(msg.arbitration_id).name}: {decoded}")
    except KeyError:
        pass        # ID không có trong DBC này
```

Và mã hoá:

```python
message = db.get_message_by_name('ENGINE_DATA')
data = message.encode({'EngineSpeed': 2150, 'CoolantTemp': 90, 'ThrottlePos': 35.2})
bus.send(can.Message(arbitration_id=message.frame_id, data=data, is_extended_id=False))
```

## Thực hành với SocketCAN

Linux coi CAN như một giao diện mạng, nên bộ công cụ rất tốt:

```bash
# bus ảo — không cần phần cứng
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan && sudo ip link set up vcan0

# adapter thật ở 500 kbit/s
sudo ip link set can0 type can bitrate 500000
sudo ip link set up can0

# CAN FD: phân xử 500k, dữ liệu 2M
sudo ip link set can0 type can bitrate 500000 dbitrate 2000000 fd on
sudo ip link set up can0
```

Những công cụ bạn dùng hằng ngày:

```bash
candump vcan0                     # tất cả
candump vcan0,123:7FF             # chỉ ID 0x123
candump -td vcan0                 # kèm mốc thời gian chênh lệch  ← soi jitter
candump -l vcan0                  # ghi ra file

cansend vcan0 123#DEADBEEF        # 4 byte dữ liệu
cansend vcan0 123##1DEADBEEF...   # khung CAN FD

cangen vcan0 -g 10 -I 123 -L 8    # sinh lưu lượng mỗi 10 ms
canplayer -I candump.log          # phát lại một bản ghi  ← vô giá
canbusload vcan0@500000           # mức sử dụng bus
```

`canplayer` rất đáng nhấn mạnh: bắt một bản ghi bus từ xe thật một lần, rồi phát lại ngay
trên bàn làm việc mãi mãi. Phần lớn công việc phát triển ECU diễn ra với bản ghi phát lại chứ
không phải với xe thật.

## Ghi lên CAN từ C

SocketCAN dùng socket thông thường:

```c
#include <linux/can.h>
#include <linux/can/raw.h>
#include <net/if.h>
#include <sys/ioctl.h>
#include <sys/socket.h>

int can_open(const char *ifname)
{
    int s = socket(PF_CAN, SOCK_RAW, CAN_RAW);
    if (s < 0) return -1;

    struct ifreq ifr;
    strncpy(ifr.ifr_name, ifname, IFNAMSIZ - 1);
    ioctl(s, SIOCGIFINDEX, &ifr);

    struct sockaddr_can addr = {
        .can_family  = AF_CAN,
        .can_ifindex = ifr.ifr_ifindex,
    };
    if (bind(s, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        close(s);
        return -1;
    }
    return s;
}

int can_send_rpm(int s, uint16_t rpm)
{
    struct can_frame f = { .can_id = 0x201, .can_dlc = 8 };
    uint16_t raw = (uint16_t)(rpm / 0.25);      /* áp hệ số của DBC */
    f.data[0] = raw & 0xFF;                     /* little-endian */
    f.data[1] = raw >> 8;

    return write(s, &f, sizeof(f)) == sizeof(f) ? 0 : -1;
}
```

Lọc bằng phần cứng — thứ rất quan trọng trên bus bận — chỉ là một lần `setsockopt`:

```c
struct can_filter filters[2] = {
    { .can_id = 0x201, .can_mask = CAN_SFF_MASK },
    { .can_id = 0x300, .can_mask = 0x700 },      /* 0x300–0x3FF */
};
setsockopt(s, SOL_CAN_RAW, CAN_RAW_FILTER, filters, sizeof(filters));
```

Trên MCU, việc lọc tương tự diễn ra trong bộ lọc chấp nhận của ngoại vi CAN, và làm đúng phần
đó là thứ giữ cho một ECU nhỏ không chết ngộp trong ngắt khi bus tải 60%.

## Xử lý lỗi

CAN có cơ chế xử lý lỗi thực sự tốt, nằm sẵn trong silicon. Mỗi node giữ hai bộ đếm:

- **Error-active** (bình thường) — báo lỗi và vẫn tham gia đầy đủ.
- **Error-passive** (TEC > 127) — vẫn phát, nhưng thôi báo lỗi một cách quyết liệt.
- **Bus-off** (TEC > 255) — tự gỡ mình hoàn toàn khỏi bus.

**Bus-off là trạng thái cần biết.** Một node vào bus-off sẽ im lặng cho tới khi phần mềm
reset bộ điều khiển. Nguyên nhân: sai tốc độ bit, thiếu điện trở đầu cuối, transceiver bị
chập, hoặc là node duy nhất trên bus. Hãy theo dõi nó:

```bash
ip -details -statistics link show can0
# tìm: bus-off, các bộ đếm lỗi, restart-ms
sudo ip link set can0 type can restart-ms 100    # tự động phục hồi
```

Một nửa số ca "bus CAN không chạy" hoá ra là do điện trở đầu cuối: 120 Ω ở mỗi *đầu* bus, đo
ngang cặp dây khi đã tắt nguồn phải ra 60 Ω. Hãy đo trước khi ngồi gỡ code.

## Tự kiểm tra

1. Vì sao phân xử của CAN không lãng phí băng thông cho va chạm?
2. Một khung có ID `0x300`, khung khác `0x180`. Cái nào thắng, và cái thua thì sao?
3. Với `0|16@1+ (0.1,-40)`, giá trị thô `1000` tương ứng giá trị vật lý nào?
4. Vì sao CAN FD giữ pha phân xử ở tốc độ bit chậm?

<details>
<summary>Đáp án câu 3</summary>

`1000 × 0,1 + (−40) = 100 − 40 = 60`, theo đơn vị mà tín hiệu khai báo.
</details>

## Bài tiếp theo

Bài 3: chẩn đoán. Các dịch vụ UDS, mã lỗi DTC, bắt tay bảo mật seed-and-key, và cách một máy
chẩn đoán ở xưởng nói chuyện với chiếc ECU do bạn viết.
