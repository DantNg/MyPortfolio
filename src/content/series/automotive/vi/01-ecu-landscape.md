---
lesson: 1
lang: vi
title: "Một chiếc xe được tổ chức thế nào — ECU, miền chức năng, và vì sao tất cả đang thay đổi"
description: "Bộ từ vựng không ai chịu giải thích: ECU, OEM, Tier 1, kiến trúc theo miền và theo vùng, và phần mềm bạn viết thực ra nằm ở đâu."
duration: "13 phút"
tags: ["Ô tô", "ECU", "Kiến trúc"]
---

## Trước hết là từ vựng

Ngành ô tô có ngôn ngữ riêng, và không ai dừng lại để dạy nó. Đây là mức tối thiểu:

- **ECU** — Electronic Control Unit, bộ điều khiển điện tử. Bất kỳ máy tính nào trên xe. Một
  chiếc xe hiện đại có 60 tới 150 cái, từ con 8-bit điều khiển gương chiếu hậu tới SoC đa
  nhân chạy cụm đồng hồ.
- **OEM** — hãng xe: Toyota, VW, Hyundai, Ford. Họ thiết kế chiếc xe và đặc tả mọi thứ.
- **Tier 1** — nhà cung cấp bán nguyên bộ ECU cho OEM: Bosch, Continental, Denso, Aptiv,
  LG, Harman. Nếu bạn viết phần mềm ô tô, nhiều khả năng bạn đang làm ở đây.
- **Tier 2** — cung cấp linh kiện cho Tier 1: hãng chip, hãng bán ngăn xếp phần mềm
  (Vector, ETAS, Elektrobit).
- **Kiến trúc E/E** — Electrical/Electronic. Bản đồ tổng thể xem ECU nào làm gì và nối với
  nhau ra sao.
- **SOP** — Start of Production, ngày bắt đầu sản xuất. Mọi kế hoạch đều đếm ngược về mốc này.
- **Homologation** — chứng nhận rằng chiếc xe đủ điều kiện bán ở một thị trường.

Mối quan hệ định hình công việc hằng ngày: **OEM viết đặc tả, Tier 1 hiện thực.** Yêu cầu
đến với bạn dưới dạng tài liệu, giao diện bị cố định bởi thiết kế mạng của OEM, và câu hỏi
"đổi cái API này được không?" thường có nghĩa là một change request đi xuyên qua ranh giới
hai công ty.

## Kiến trúc theo miền — cách làm xưa nay

![Kiến trúc E/E](/MyPortfolio/images/automotive/ecu-architecture.svg)

Suốt ba mươi năm, xe được tổ chức theo **miền chức năng**:

| Miền | Làm gì | Ràng buộc điển hình |
| --- | --- | --- |
| Powertrain | động cơ, hộp số, quản lý pin | hard real-time, ASIL C/D |
| Chassis | phanh, lái, treo, ESP | hard real-time, ASIL D |
| Body | cửa, kính, đèn, điều hoà, ghế | soft real-time, chủ yếu QM/ASIL A |
| Infotainment | radio, dẫn đường, màn hình | không thời gian thực, QM |
| ADAS | camera, radar, lidar, hợp nhất cảm biến | tính toán nặng, ASIL B/D |

Mỗi chức năng có một hộp riêng, một vi điều khiển riêng, một nhà cung cấp riêng. Thêm tính
năng nghĩa là thêm một ECU. Kết quả là chiếc xe có hơn 100 máy tính và tới 5 km dây, nặng
50–70 kg — một trong những bộ phận nặng và đắt nhất của chiếc xe.

Các mạng nối chúng lại:

| Bus | Tốc độ | Dùng cho |
| --- | --- | --- |
| **LIN** | 20 kbit/s | rẻ, một master: công tắc kính, mô tơ ghế, cảm biến mưa |
| **CAN** | tới 1 Mbit/s | chủ lực: powertrain, body, mọi thứ |
| **CAN FD** | tới 8 Mbit/s ở pha dữ liệu | bản thay thế hiện đại của CAN, tải 64 byte |
| **FlexRay** | 10 Mbit/s | kích hoạt theo thời gian, tất định: x-by-wire, chassis. Đắt, đang lụi |
| **MOST** | 150 Mbit/s | vòng media cho infotainment. Coi như đã lỗi thời |
| **Automotive Ethernet** | 100 Mbit/s – 10 Gbit/s | camera, ADAS, xương sống. Tương lai |

Một ECU **gateway** đứng ở giữa và định tuyến giữa các mạng, bởi vì bus CAN của powertrain và
mạng infotainment không được phép nói chuyện tự do với nhau — vì cả lý do định thời lẫn lý do
an ninh.

## Kiến trúc zonal — hướng đang đi tới

Mô hình theo miền đổ vỡ vì ba lý do:

1. **Dây dẫn.** Kéo một sợi dây riêng từ bộ điều khiển thân xe trung tâm tới từng bóng đèn
   và từng công tắc tạo ra hàng cây số dây. Nặng, đắt, và là nút thắt trong sản xuất.
2. **Tính năng bây giờ là phần mềm.** Thêm ga tự động thích ứng lẽ ra không cần thêm hộp
   mới, nhưng với kiến trúc theo miền thì thường là có.
3. **Cập nhật.** Đẩy một bản cập nhật qua mạng tới 120 ECU từ 40 nhà cung cấp, mỗi cái một
   bootloader và một quy trình kiểm định riêng, là điều gần như bất khả thi.

Câu trả lời của **zonal**: gom ECU theo **vị trí vật lý** thay vì theo chức năng. Một bộ điều
khiển vùng ở góc trước bên trái lo mọi cảm biến và cơ cấu chấp hành gần đó — đèn pha, cửa,
gương, cảm biến môi trường — bất kể chúng thuộc miền chức năng nào. Các vùng nối tới một
hoặc vài **máy tính hiệu năng cao (HPC)** qua Automotive Ethernet, và logic ứng dụng thật
chạy ở đó.

Điều đó có nghĩa gì với bạn, người viết code:

- **Bộ điều khiển vùng** là công việc nhúng kinh điển: AUTOSAR Classic, một vi điều khiển,
  CAN/LIN ở một phía và Ethernet ở phía kia. Tất định, liên quan an toàn, viết bằng C.
- **HPC** gần với lập trình hệ thống trên Linux hơn: SoC đa nhân chạy Linux hoặc QNX,
  AUTOSAR Adaptive, giao tiếp hướng dịch vụ, C++14/17, container, OTA.

Ngành đang thiếu người hiểu được cả hai phía. Chính khoảng trống đó là lý do series này nói
cả về CAN *và* SOME/IP.

## Phần mềm thực ra chạy ở đâu

Bốn thế giới phần mềm khác biệt cùng sống trong một chiếc xe hiện đại, và nhầm lẫn chúng là
lỗi phỏng vấn phổ biến:

| Nền tảng | Chạy trên | Hệ điều hành | Ngôn ngữ | Ví dụ |
| --- | --- | --- | --- | --- |
| **AUTOSAR Classic** | MCU (AURIX, S32) | RTOS nền OSEK | C | điều khiển động cơ, thân xe, bộ điều khiển vùng |
| **AUTOSAR Adaptive** | SoC (đa nhân) | Linux/QNX (POSIX) | C++14+ | hợp nhất cảm biến ADAS, máy tính xe |
| **Android Automotive OS** | SoC | Android | Java/Kotlin/C++ | infotainment, màn hình tài xế chạm vào |
| **Bare metal / RTOS khác** | MCU nhỏ | FreeRTOS, tự viết | C | cảm biến, cơ cấu chấp hành đơn giản |

Lưu ý **Android Automotive OS** không phải Android Auto. Android Auto chiếu điện thoại của
bạn lên màn hình xe. Còn Android Automotive OS *chính là* hệ điều hành của xe cho phần
infotainment, chạy trực tiếp trên xe, với HAL riêng phơi ra tốc độ, điều hoà và vị trí cần số
qua Vehicle HAL. Middleware nối HAL đó với các mạng trên xe là một mảng lớn và đang phát
triển của phần mềm ô tô.

## Phần mềm ô tô khác ở chỗ nào

So với nhúng dân dụng, có năm điều thay đổi:

**1. Vòng đời dài và cố định.** Một chương trình chạy ba tới năm năm từ ý tưởng tới SOP. Yêu
cầu đóng băng từ sớm. Code bạn viết năm 2026 xuất xưởng năm 2029 và phải được hỗ trợ tới
năm 2044.

**2. An toàn là một quy trình, không phải một tính năng.** ISO 26262 (bài 6) chi phối *cách*
bạn phát triển, chứ không chỉ *cái* bạn phát triển. Truy vết từ yêu cầu tới code tới kiểm thử
là bắt buộc, và phải kiểm toán được.

**3. Không thể vá đại được.** Một bản cập nhật ngoài thực địa có thể đồng nghĩa với một đợt
triệu hồi tốn hàng triệu đô. Đó là lý do khối lượng kiểm định lớn không tương xứng với kích
thước code, và cũng là lý do năng lực OTA là ưu tiên chiến lược của các OEM.

**4. Mọi thứ đều được đặc tả.** Bố cục thông điệp đến từ file DBC hoặc ARXML do OEM sở hữu.
Mã định danh chẩn đoán đến từ một bản đặc tả. Ngay cả thời gian khởi động cũng là một yêu cầu
— thường là "phản hồi CAN trong vòng 100 ms kể từ khi đánh thức".

**5. Công cụ là hàng thương mại và rất đắt.** Vector CANoe, ETAS INCA, dSPACE, Lauterbach.
Hãy chuẩn bị tinh thần với khoá cứng bản quyền và chi phí theo đầu người vượt xa mọi thứ
trong lập trình web. Vẫn có các lựa chọn mã nguồn mở để học, và series này dùng chúng.

## Chuẩn bị để thực sự thử nghiệm

Bạn không cần ô tô. Trên Linux:

```bash
sudo apt install can-utils

# một giao diện CAN ảo — không cần phần cứng nào cả
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan
sudo ip link set up vcan0

# gửi và xem
cansend vcan0 123#DEADBEEF
candump vcan0
```

Đó là một bus CAN chạy được sau bốn lệnh, và mọi thứ trong bài 2 đều chạy trên nó. Với một
adapter USB-CAN (Kvaser, PEAK, hoặc một cái CANable giá rẻ), đúng những lệnh đó nói chuyện
với bus thật, chỉ đổi `vcan0` thành `can0`.

Cài thêm những thứ này khi tới bài 2 và bài 3:

```bash
pip install cantools python-can udsoncan
```

`cantools` đọc file DBC và giải mã tín hiệu; `udsoncan` nói giao thức chẩn đoán. Cùng với
`can-utils`, chúng bao phủ phần lớn những gì một công cụ thương mại làm, ở mức đủ để học.

## Tự kiểm tra

1. OEM và Tier 1 khác nhau thế nào, và bên nào thường viết yêu cầu?
2. Vì sao kiến trúc zonal làm giảm khối lượng dây dẫn?
3. Bạn nghĩ bộ điều khiển phanh dùng nền tảng nào, còn đầu máy infotainment dùng nền tảng nào?
4. Android Auto và Android Automotive OS khác nhau ra sao?

## Bài tiếp theo

Bài 2 đi xuống tới từng bit: CAN và CAN FD, cơ chế phân xử bảo đảm thông điệp quan trọng nhất
luôn thắng, và cách đọc một file DBC.
