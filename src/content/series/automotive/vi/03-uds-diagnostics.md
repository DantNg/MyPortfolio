---
lesson: 3
lang: vi
title: "Chẩn đoán — UDS, DTC và nạp firmware"
description: "Máy chẩn đoán ở xưởng nói chuyện với ECU của bạn thế nào: phiên làm việc, các dịch vụ quan trọng, bắt tay seed-and-key, vòng đời DTC, và tầng vận chuyển bên dưới."
duration: "16 phút"
tags: ["Ô tô", "UDS", "Chẩn đoán"]
---

## Vì sao chẩn đoán là yêu cầu hạng nhất

Mọi ECU trên xe đều phải trả lời được máy chẩn đoán ở xưởng. Nó phải báo mình đang chạy phiên
bản phần mềm nào, có gì hỏng, và phải chấp nhận được một bản cập nhật firmware — qua cổng
OBD, từ một công cụ của hãng chưa bao giờ nhìn thấy mã nguồn của bạn.

Điều đó được chuẩn hoá thành **UDS (Unified Diagnostic Services), ISO 14229**. Nó theo mô
hình hỏi/đáp, ECU là server, công cụ là client, và khoảng 20% lượng code trong một ECU thương
mại tồn tại để phục vụ nó.

Đừng nhầm với **OBD-II (ISO 15031)** — tập con bắt buộc theo luật, chỉ về khí thải, mà mọi xe
phải phơi ra cho máy quét phổ thông bất kỳ. UDS là giao thức đầy đủ của hãng; OBD-II là phần
công khai nhỏ bé.

## Tầng vận chuyển bên dưới

UDS là giao thức, không phải bus. Trên CAN nó chạy trên **ISO-TP (ISO 15765-2)**, thứ giải
quyết vấn đề hiển nhiên: một phản hồi chẩn đoán có thể dài hàng trăm byte, còn khung CAN chỉ
chứa được 8.

ISO-TP chia nhỏ nó ra:

| Loại khung | Byte đầu | Ý nghĩa |
| --- | --- | --- |
| Single Frame | `0x` | cả thông điệp vừa đủ, `x` = độ dài |
| First Frame | `1x xx` | mở đầu thông điệp dài, tổng độ dài 12 bit |
| Consecutive Frame | `2x` | phần tiếp theo, `x` = số thứ tự 0–15 |
| Flow Control | `3x` | bên nhận nói tiếp/chờ, kèm kích thước khối và khoảng cách |

Một phản hồi 20 byte trông như sau:

```
ECU  → 10 14 62 F1 90 57 56 57      First Frame: 0x014 = tổng 20 byte
Tool → 30 00 00                     Flow Control: cứ gửi tiếp, không cần chờ
ECU  → 21 5A 5A 5A 31 4B 5A 41      Consecutive Frame 1
ECU  → 22 4D 36 39 31 32 33 34      Consecutive Frame 2
```

Hai ID CAN tạo thành một kênh chẩn đoán: một cho công cụ→ECU (yêu cầu vật lý, ví dụ `0x7E0`)
và một cho ECU→công cụ (phản hồi, `0x7E8`). Còn có một ID chức năng/quảng bá (`0x7DF`) gọi
tới mọi ECU cùng lúc.

Trên Linux bạn có sẵn tất cả:

```bash
sudo modprobe can-isotp
isotpsend -s 7E0 -d 7E8 can0 <<< "22 F1 90"
isotprecv -s 7E8 -d 7E0 can0
```

## Phiên làm việc (session)

ECU khởi động vào **phiên mặc định**, nơi nó chỉ trả lời các yêu cầu đọc vô hại. Bất cứ điều
gì làm thay đổi trạng thái đều phải chuyển sang phiên khác trước:

| Phiên | ID | Mở khoá điều gì |
| --- | --- | --- |
| Default | `0x01` | đọc, nhận diện cơ bản |
| Programming | `0x02` | nạp firmware — thường qua bootloader |
| Extended | `0x03` | kiểm tra cơ cấu chấp hành, ghi cấu hình, xoá DTC |
| Safety system | `0x04` | các thủ tục liên quan an toàn |

```
Tool → 10 03            DiagnosticSessionControl, phiên extended
ECU  → 50 03 00 32 01 F4
```

Phản hồi mang theo hai tham số định thời: `P2 = 0x0032` (50 ms — phải trả lời trong khoảng
này) và `P2* = 0x01F4 × 10 ms` (5000 ms — giới hạn nới rộng sau khi đã báo "đang xử lý").

Phiên khác mặc định sẽ hết hạn. Nếu công cụ im lặng quá **S3 = 5 giây**, ECU tụt về mặc định
và huỷ quyền truy cập bảo mật. Đó là lý do công cụ gửi `3E 00` (TesterPresent) định kỳ — nó
chỉ là tín hiệu giữ nhịp, không hơn:

```
Tool → 3E 80           TesterPresent, bật bit suppressPosRsp (không cần trả lời)
```

Bit `0x80` đó đáng biết một cách tổng quát: bật bit cao của sub-function nghĩa là "cứ làm,
nhưng đừng trả lời", giúp giảm một nửa lưu lượng bus cho các gói giữ nhịp.

## Những dịch vụ đáng thuộc lòng

![Một phiên UDS](/MyPortfolio/images/automotive/uds-diagnostics.svg)

| SID | Tên | Dùng để |
| --- | --- | --- |
| `0x10` | DiagnosticSessionControl | đổi phiên |
| `0x11` | ECUReset | khởi động lại ECU |
| `0x14` | ClearDiagnosticInformation | xoá DTC |
| `0x19` | ReadDTCInformation | đọc mã lỗi |
| `0x22` | ReadDataByIdentifier | đọc một giá trị — dịch vụ dùng nhiều nhất |
| `0x2E` | WriteDataByIdentifier | ghi một giá trị |
| `0x27` | SecurityAccess | mở khoá bằng seed-and-key |
| `0x28` | CommunicationControl | tắt lưu lượng CAN thông thường khi nạp firmware |
| `0x2F` | InputOutputControlByIdentifier | ép một cơ cấu chấp hành |
| `0x31` | RoutineControl | chạy một thủ tục dựng sẵn (tự kiểm tra, xoá bộ nhớ) |
| `0x34`–`0x37` | RequestDownload / TransferData / TransferExit | nạp firmware |
| `0x3E` | TesterPresent | giữ phiên sống |

**Phản hồi dương là `SID + 0x40`.** Yêu cầu `0x22` thì nhận về `0x62`. Biết điều đó rồi thì
các bản ghi CAN thô đọc được ngay.

**Phản hồi âm luôn dài ba byte:** `7F <SID> <NRC>`.

| NRC | Ý nghĩa | Thường báo hiệu điều gì |
| --- | --- | --- |
| `0x11` | serviceNotSupported | sai dịch vụ với ECU này |
| `0x12` | subFunctionNotSupported | sai sub-function |
| `0x13` | incorrectMessageLength | yêu cầu của bạn sai định dạng |
| `0x22` | conditionsNotCorrect | ví dụ động cơ đang chạy, xe đang di chuyển |
| `0x31` | requestOutOfRange | định danh không biết, hoặc giá trị ngoài dải |
| `0x33` | securityAccessDenied | bạn chưa làm `0x27` trước |
| `0x35` | invalidKey | phép tính key của bạn sai |
| `0x78` | requestCorrectlyReceived-ResponsePending | "đang làm, chờ tới P2*" |

`0x78` là thứ hay làm hỏng các bản hiện thực phía client: nó không phải lỗi. ECU gửi nó khi
một thao tác (như xoá flash) mất lâu hơn P2, và công cụ phải tiếp tục chờ cho tới khi phản
hồi thật tới.

## ReadDataByIdentifier

Con ngựa thồ. Một DID 16 bit đặt tên cho một giá trị:

```
Tool → 22 F1 90                              đọc VIN
ECU  → 62 F1 90 57 56 57 5A 5A 5A 31 4B ...  "WVWZZZ1K..."
```

Các DID chuẩn đáng biết:

| DID | Nội dung |
| --- | --- |
| `F186` | phiên chẩn đoán đang hoạt động |
| `F187` | mã phụ tùng của hãng |
| `F189` | phiên bản phần mềm |
| `F18C` | số sê-ri ECU |
| `F190` | VIN |
| `F195` | dấu vân tay phần mềm |

Toàn bộ dải từ `0x0100` tới `0xEFFF` là của riêng hãng và được định nghĩa trong bản đặc tả
chẩn đoán của OEM.

Về phía ECU, hiện thực tốt nghĩa là dùng một bảng thay vì một `switch`:

```c
typedef struct {
    uint16_t did;
    uint8_t  len;
    uint8_t  min_session;                       /* phiên tối thiểu cần có */
    bool     needs_security;
    int    (*read)(uint8_t *out, uint8_t len);
} did_entry_t;

static const did_entry_t did_table[] = {
    { 0xF190, 17, SESSION_DEFAULT,  false, read_vin      },
    { 0xF189,  4, SESSION_DEFAULT,  false, read_sw_ver   },
    { 0x0100,  2, SESSION_EXTENDED, false, read_temp     },
    { 0x0200,  8, SESSION_EXTENDED, true,  read_cal_data },
};
```

Chính cái bảng đó cũng là thứ đội kiểm thử sẽ hỏi xin, và là thứ OEM sẽ đem ra rà soát. Xây
nó dưới dạng dữ liệu thay vì code làm cả hai cuộc trao đổi ngắn lại.

## Seed và key

Mọi thứ có thể thay đổi hành vi của xe đều nằm sau `0x27`:

```
Tool → 27 01                      xin seed, mức 1
ECU  → 67 01 A3 5F 21 0C          đây là seed ngẫu nhiên
Tool → 27 02 <key đã tính>        đây là key
ECU  → 67 02                      đã mở khoá
```

Thuật toán biến seed thành key là bí mật của OEM, giao cho nhà cung cấp dưới dạng một DLL
hoặc thư viện đã ký. Nó thường không phải mật mã mạnh — trong lịch sử chỉ là một phép biến
đổi cố định với hằng số bí mật — và đó chính xác là lý do quyền truy cập bảo mật của UDS
**không** phải cơ chế an ninh theo nghĩa hiện đại, cũng là lý do ISO/SAE 21434 (bài 6) đẩy
ngành sang xác thực đàng hoàng cho những thứ thật sự quan trọng.

Về phía ECU, hai điều là bắt buộc: một **bộ đếm trễ sau các lần thử sai** (thường 10 giây sau
ba lần sai) và quy tắc rằng quyền bảo mật mất đi khi đổi phiên hoặc khi hết hạn S3. Cả hai
thường được kiểm thử tường minh trong quá trình chứng nhận.

## DTC — bộ nhớ lỗi

**Diagnostic Trouble Code** là một định danh 3 byte cộng một byte trạng thái. `P0128` giải mã
thành:

- `P` — powertrain (`C` chassis, `B` body, `U` mạng)
- `0` — mã chung theo SAE (`1` = riêng của hãng)
- `128` — lỗi cụ thể

Thông tin thật nằm ở byte trạng thái:

| Bit | Tên | Ý nghĩa |
| --- | --- | --- |
| 0 | testFailed | đang lỗi ngay lúc này |
| 1 | testFailedThisOperationCycle | đã lỗi trong chu kỳ lái này |
| 2 | pendingDTC | lỗi một lần, chưa được xác nhận |
| 3 | **confirmedDTC** | đã lỗi đủ số lần để được lưu — đây mới là cái quan trọng |
| 4 | testNotCompletedSinceLastClear | |
| 5 | testFailedSinceLastClear | |
| 6 | testNotCompletedThisOperationCycle | |
| 7 | warningIndicatorRequested | đèn báo trên táp-lô đang sáng |

Vòng đời một lỗi là một quyết định thiết kế, không phải chuyện ngẫu nhiên:

1. **Phát hiện** — bộ giám sát báo lỗi. Bật `testFailed`.
2. **Chống dội** — phải lỗi N lần hoặc lỗi liên tục T giây. Một giắc cắm lỏng chớp một cái
   thì không được phép làm sáng đèn check-engine.
3. **Pending** — đã lỗi nhưng chưa xác nhận.
4. **Confirmed** — lỗi lại ở chu kỳ lái thứ hai, được lưu vào NVM kèm **freeze frame** (bản
   chụp điều kiện xe tại thời điểm xảy ra).
5. **Tự lành** — vượt qua 40 chu kỳ lái liên tiếp thì tự xoá.

Đọc chúng:

```
Tool → 19 02 08          báo cáo DTC với mặt nạ trạng thái 0x08 (đã xác nhận)
ECU  → 59 02 FF P0 12 8 2F ...
```

Sub-function `0x02` (theo mặt nạ trạng thái) và `0x04` (snapshot/freeze frame) là hai cái bạn
sẽ dùng.

## Nạp firmware

Trình tự lập trình lại, mà mọi ECU đều phải hiện thực:

```
10 02                    vào phiên programming (thường nhảy sang bootloader)
27 01 / 27 02            truy cập bảo mật
28 03 01                 CommunicationControl: dừng TX/RX thông thường — làm im bus
31 01 FF 00              RoutineControl: xoá bộ nhớ
34 00 44 <addr> <size>   RequestDownload
36 01 <data...>          TransferData, khối 1
36 02 <data...>          TransferData, khối 2   ... lặp lại
37                       RequestTransferExit
31 01 FF 01              RoutineControl: kiểm tra ràng buộc lập trình (CRC/chữ ký)
11 01                    ECUReset
```

Hai chi tiết quan trọng ngoài thực địa:

- **Bootloader phải sống sót qua một lần nạp thất bại.** Mất điện giữa `0x36` là chuyện bình
  thường, không phải ngoại lệ. Thiết kế chuẩn là sơ đồ hai phân vùng A/B, hoặc một bootloader
  nằm trong vùng flash chống ghi và luôn quay vào được.
- **`0x28 CommunicationControl` tồn tại vì việc nạp làm ngập bus.** Các thông điệp định kỳ
  thông thường bị tắt trong lúc lập trình, đồng nghĩa phần còn lại của xe thấy ECU đó biến
  mất — và mọi ECU khác phải xử lý êm chuyện đó thay vì tự nổi DTC của riêng mình.

## Thử mà không cần ô tô

```bash
pip install udsoncan can-isotp
```

```python
import isotp, udsoncan
from udsoncan.connections import PythonIsoTpConnection
from udsoncan.client import Client
import udsoncan.services as svc

conn = PythonIsoTpConnection(
    isotp.socket(), address=isotp.Address(rxid=0x7E8, txid=0x7E0))

with Client(conn, request_timeout=2) as client:
    client.change_session(svc.DiagnosticSessionControl.Session.extendedDiagnosticSession)
    resp = client.read_data_by_identifier(0xF190)
    print("VIN:", resp.service_data.values[0xF190])

    dtcs = client.get_dtc_by_status_mask(0x08)
    for dtc in dtcs.service_data.dtcs:
        print(f"{dtc.id:06X} status={dtc.status.get_byte_as_int():02X}")
```

Trỏ nó vào `vcan0` với một chương trình Python giả lập ECU ở đầu kia, và bạn phát triển được
cả một ngăn xếp chẩn đoán hoàn chỉnh ngay trên laptop.

## Tự kiểm tra

1. SID của phản hồi dương cho yêu cầu `0x22` là gì?
2. NRC `0x78` nghĩa là gì, và vì sao client không được coi nó là lỗi?
3. Vì sao công cụ gửi `3E 00` vài giây một lần?
4. DTC pending và DTC confirmed khác nhau thế nào?

## Bài tiếp theo

Bài 4: AUTOSAR Classic. Các tầng dùng để làm gì, SWC và RTE thực sự làm gì, và vì sao phần
cấu hình lại lớn hơn phần code.
