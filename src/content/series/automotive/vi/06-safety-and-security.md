---
lesson: 6
lang: vi
title: "An toàn chức năng và an ninh mạng"
description: "ISO 26262 và ASIL đến từ đâu, nó đòi hỏi gì ở code của bạn, MISRA C trong thực tế, và ISO/SAE 21434 đã thay đổi thứ bạn được phép xuất xưởng ra sao."
duration: "16 phút"
tags: ["Ô tô", "ISO 26262", "ASIL", "An ninh mạng"]
---

## An toàn nói về chiếc xe, không phải về code

Điều đầu tiên cần thấm: **ISO 26262 không chứng nhận phần mềm.** Nó chứng nhận rằng một *quy
trình phát triển* đã được tuân thủ sao cho rủi ro còn lại của *item* — chức năng trên xe — là
chấp nhận được. Không tồn tại thứ gọi là "code ASIL D" đứng riêng. Chỉ có chức năng ASIL D,
được hiện thực bằng code phát triển dưới các yêu cầu quy trình mức ASIL D.

Sự phân biệt đó giải thích vì sao rất nhiều công việc ô tô là làm tài liệu. Bằng chứng *chính
là* sản phẩm bàn giao.

## ASIL đến từ đâu

![Xác định ASIL](/MyPortfolio/images/automotive/asil.svg)

Mỗi mối nguy được phân tích trong một **HARA (Hazard Analysis and Risk Assessment)** theo ba
trục:

- **S — Severity (mức nghiêm trọng)**: S0 không thương tích, S3 đe doạ tính mạng.
- **E — Exposure (mức phơi nhiễm)**: E0 cực kỳ hiếm, E4 xảy ra trong hầu hết tình huống lái.
- **C — Controllability (khả năng kiểm soát)**: C0 nói chung kiểm soát được, C3 tài xế không
  thể xoay xở.

Tổ hợp lại cho ra QM (chỉ quản lý chất lượng) hoặc ASIL A tới D.

Ví dụ cụ thể: *tự nhiên phanh gấp hết cỡ ở tốc độ cao tốc.* Mức nghiêm trọng cao (S3 — va chạm
từ phía sau ở tốc độ cao), phơi nhiễm cao (E4 — chạy cao tốc là chuyện thường ngày), khả năng
kiểm soát thấp (C3 — tài xế không thể ghi đè). Kết quả rơi vào **ASIL D**.

Đối lại: *đèn nội thất bị hỏng.* S0, và nó không bao giờ ra khỏi mức QM.

Hai cơ chế đáng biết vì chúng xuất hiện trong dự án thật:

- **Phân rã ASIL (decomposition)** — một yêu cầu ASIL D có thể tách thành hai phần tử ASIL
  B(D) độc lập, nếu bạn chứng minh được tính độc lập thật sự. Đây là cách các đội làm cho
  ASIL D trở nên kham nổi, và chứng minh tính độc lập mới là phần khó.
- **Freedom from interference** — nếu code QM và code ASIL C dùng chung một MCU, bạn phải
  chứng minh code QM không thể làm hỏng code an toàn. Phân vùng bộ nhớ (MPU), bảo vệ thời
  gian (ngân sách thực thi) và đường truyền thông tách biệt là những lập luận chuẩn.

## ASIL thực sự đòi hỏi gì ở code

Tiêu chuẩn dịch ra thành các ràng buộc kỹ thuật cụ thể:

**Truy vết, cả hai chiều.** Mọi yêu cầu đều truy được tới thiết kế, code và kiểm thử; mọi
dòng code đều truy ngược được về một yêu cầu. Công cụ như Polarion hay DOORS sinh ra để làm
việc này, và câu "vì sao có hàm này" phải có câu trả lời thành văn.

**Hướng dẫn viết code — MISRA C.** Bắt buộc ở mọi mức ASIL. Nói kỹ hơn bên dưới.

**Độ phủ cấu trúc**, và mức yêu cầu tăng theo ASIL:

| ASIL | Độ phủ yêu cầu |
| --- | --- |
| A | câu lệnh |
| B | câu lệnh + nhánh |
| C | câu lệnh + nhánh |
| D | câu lệnh + nhánh + **MC/DC** |

MC/DC (Modified Condition/Decision Coverage) nghĩa là mọi điều kiện con trong một biểu thức
logic đều phải được chứng minh là ảnh hưởng độc lập tới kết quả. Trên thực tế nó đẩy bạn tới
việc viết điều kiện đơn giản, vì một chuỗi `&&` bốn vế cần năm ca kiểm thử mới thoả MC/DC.

**Cơ chế an toàn nằm trong thiết kế**, không phải gắn thêm về sau:

- Watchdog — cả window watchdog lẫn một cái bên ngoài với ASIL D.
- Checksum hoặc CRC cho dữ liệu liên quan an toàn trong RAM và trong thông điệp.
- Tính toán dư thừa rồi so sánh với các giá trị quan trọng.
- Kiểm tra tính hợp lý — số đo cảm biến này có khả dĩ về mặt vật lý so với số trước không?
- Trạng thái an toàn được định nghĩa rõ, cùng một **khoảng thời gian chịu lỗi (FTTI)** thành
  văn: hệ thống được phép ở trạng thái lỗi bao lâu trước khi phải vào trạng thái an toàn.

**Công cụ đã được qualify.** Trình biên dịch của bạn phải được qualify hoặc đầu ra của nó
phải được kiểm chứng, vì lỗi trình biên dịch là lỗi hệ thống. Đó là lý do các dự án ô tô dùng
một phiên bản trình biên dịch cố định suốt nhiều năm thay vì nâng cấp.

## MISRA C trong thực tế

MISRA C:2012 có 143 quy tắc và 16 chỉ dẫn, phân loại thành *bắt buộc*, *yêu cầu*, hoặc *khuyến
nghị*. Những cái bạn cảm nhận hằng ngày:

```c
/* Rule 8.4 — một định nghĩa phải có khai báo nhìn thấy được */
extern void motor_stop(void);        /* trong header */
void motor_stop(void) { ... }

/* Rule 10.x — không chuyển kiểu ngầm giữa các kiểu thiết yếu */
uint8_t a = 200u;
uint8_t b = 100u;
uint16_t sum = (uint16_t)a + (uint16_t)b;    /* tường minh, không thăng kiểu lặng lẽ */

/* Rule 14.4 — biểu thức điều khiển phải mang bản chất boolean */
if (ptr != NULL) { ... }             /* không viết: if (ptr) */
if (count != 0u) { ... }             /* không viết: if (count) */

/* Rule 15.5 — nên có một điểm thoát duy nhất (khuyến nghị, thường bị bắt buộc) */
static int process(int x)
{
    int result = -1;
    if (x > 0) {
        result = x * 2;
    }
    return result;                   /* một lệnh return */
}

/* Rule 17.7 — giá trị trả về của hàm khác void phải được dùng */
(void)memcpy(dst, src, n);           /* bỏ đi một cách tường minh */

/* Rule 21.3 — không cấp phát động */
/* malloc, calloc, realloc, free đều bị cấm. Chỉ cấp phát tĩnh. */
```

Hai nhận xét thành thật sau khi sống chung với nó:

- **Phần lớn quy tắc thật sự ngăn được lỗi.** Chỉ riêng nhóm quy tắc về chuyển kiểu ngầm đã
  bắt được cả một lớp lỗi thăng kiểu số nguyên.
- **Một số quy tắc gây vướng**, và đó là lý do có **quy trình deviation**. Một deviation được
  ghi rõ, được review, được phê duyệt là phần bình thường của quy trình — không phải thất bại.
  Thứ không chấp nhận được là lặng lẽ tắt một quy tắc đi.

Việc thực thi do công cụ đảm nhiệm: **Polyspace**, **LDRA**, **PC-lint Plus**, **Coverity**,
hoặc **Cppcheck** kèm addon MISRA để học. Hãy chạy nó trong CI, đừng để tới cuối dự án.

## An ninh mạng — ISO/SAE 21434

An toàn hỏi "nếu nó hỏng thì sao?" An ninh hỏi "nếu có kẻ cố tình phá thì sao?" ISO/SAE 21434
(2021) biến câu hỏi thứ hai thành bắt buộc, và UNECE R155 biến một **CSMS (Cyber Security
Management System)** được chứng nhận thành điều kiện để được phê duyệt kiểu loại ở EU, Nhật
và Hàn Quốc. **Không có nó thì không bán được xe.**

Sự song song với ISO 26262 là có chủ ý:

| An toàn (26262) | An ninh (21434) |
| --- | --- |
| HARA | TARA (Threat Analysis and Risk Assessment) |
| ASIL A–D | CAL 1–4 (Cybersecurity Assurance Level) |
| Mục tiêu an toàn | Mục tiêu an ninh |
| Safety case | Cybersecurity case |

Một **TARA** làm ngược từ tài sản: xác định thứ gì đáng để tấn công (bus CAN, kho khoá, kênh
OTA), liệt kê mối đe doạ, chấm điểm tác động và mức khả thi của tấn công, rồi quyết định biện
pháp kiểm soát.

Điều đó có nghĩa cụ thể gì với code bạn viết:

**Secure boot.** Mỗi giai đoạn kiểm chứng chữ ký của giai đoạn kế tiếp trước khi chạy nó, neo
vào một gốc tin cậy bất biến nằm trong ROM. Không thương lượng được với bất cứ thứ gì cập
nhật được.

**Xác thực thông điệp.** Seed-and-key của UDS không phải an ninh. Tính toàn vẹn thật sự trên
bus dùng **SecOC (Secure Onboard Communication)**, thứ gắn thêm một MAC bị cắt ngắn và một
giá trị tươi mới vào các khung liên quan an toàn:

```
[ dữ liệu tín hiệu thường ][ bộ đếm tươi mới ][ CMAC cắt ngắn ]
```

Giá trị tươi mới chính là thứ đánh bại tấn công phát lại — lý do việc chỉ ghi lại rồi phát lại
một khung "mở khoá cửa" không còn ăn thua.

**Lưu khoá trong HSM.** Các MCU ô tô hiện đại (AURIX, S32, RH850) có module bảo mật phần cứng:
một nhân riêng với bộ nhớ riêng giữ khoá mà nhân ứng dụng dùng được nhưng không bao giờ đọc
được.

**Chẩn đoán an toàn.** `0x27` SecurityAccess đang được thay bằng `0x29` **Authentication**
(UDS 2020), dùng PKI dựa trên chứng thư số thay vì một thuật toán bí mật dùng chung.

**Một quy trình vá lỗi.** Theo R155 bạn phải có khả năng phản ứng với một lỗ hổng được công bố
trong suốt vòng đời chiếc xe — đó là lý do năng lực OTA trở thành yêu cầu tuân thủ, chứ không
chỉ là một tính năng.

## Chỗ hai bên xung đột nhau

An toàn và an ninh thực sự kéo ngược nhau, và giả vờ như không phải vậy sẽ dẫn tới thiết kế tồi:

- **An toàn muốn tính tất định; an ninh muốn mật mã.** Một phép CMAC tốn thời gian, và thời
  gian đó phải nằm gọn trong FTTI.
- **An toàn muốn fail-safe; an ninh muốn fail-secure.** Với hệ thống phanh, hỏng theo hướng
  nhả ra là an toàn nhưng không an ninh. Bên nào thắng là một quyết định thành văn, và nó bắt
  buộc phải thành văn.
- **An toàn muốn quan sát được; an ninh muốn khép kín.** Cổng debug giúp bạn chẩn đoán lỗi
  ngoài thực địa cũng chính là bề mặt tấn công.

Cách giải quyết luôn là một quyết định được ghi lại trong một bản phân tích, kèm lý do có
người ký. Đây mới là thứ các kỹ sư ô tô kỳ cựu thực sự dành thời gian cho.

## Làm việc dưới các tiêu chuẩn này hằng ngày

Những gì thay đổi trong thực tế, so với nhúng dân dụng:

1. **Yêu cầu luôn có trước.** Code không gắn với yêu cầu nào sẽ bị bác khi review.
2. **Review là chính thức và có ghi chép.** Ai review, khi nào, tìm ra gì, đóng lại ra sao.
3. **Phân tích tĩnh là một cổng chặn, không phải lời gợi ý.** Build hỏng khi có vi phạm MISRA
   mới.
4. **Kiểm thử truy vết tới yêu cầu.** "Nó chạy được" không phải bằng chứng; "yêu cầu SYS-142
   được kiểm chứng bởi ca kiểm thử TC-0891" mới là.
5. **Thay đổi thì đắt.** Một dòng sửa trong module ASIL D kéo theo phân tích tác động, review
   lại, kiểm thử lại và cập nhật tài liệu. Đó là lý do các ước lượng nhìn khổng lồ với người
   từ mảng web sang, và cũng là lý do chúng thường đúng.

Không điều nào ở đây làm bạn viết code chậm đi. Nó làm cho *hệ thống* chậm thay đổi, một cách
có chủ ý, bởi vì kiểu hỏng ở đây là một đợt triệu hồi hoặc tệ hơn thế.

## Tóm tắt cả series

1. ECU, OEM/Tier 1, kiến trúc theo miền và theo vùng, cùng bốn nền tảng phần mềm.
2. CAN và CAN FD tới từng bit: phân xử, file DBC, SocketCAN.
3. Chẩn đoán UDS: phiên, dịch vụ, seed-and-key, vòng đời DTC, nạp firmware.
4. AUTOSAR Classic: các tầng, SWC, RTE, và phát triển dựa trên cấu hình.
5. AUTOSAR Adaptive: dịch vụ, SOME/IP, `ara::com`, và VHAL của Android Automotive.
6. ISO 26262 và ISO/SAE 21434: ASIL đến từ đâu và đòi hỏi những gì.

Đi tiếp thế nào tuỳ vào phía bạn rơi vào. Với Classic, hãy học một công cụ cấu hình cho đến
nơi — Vector DaVinci hoặc EB tresos — vì đó chính là công việc. Với Adaptive, hãy quen tay với
C++ hiện đại và dựng một thứ gì đó trên vsomeip. Dù theo hướng nào, một adapter USB-CAN giá rẻ
cùng một cuối tuần với `can-utils` sẽ dạy bạn nhiều hơn bất kỳ khoá học nào.
