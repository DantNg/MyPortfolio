---
lesson: 4
lang: vi
title: "AUTOSAR Classic — các tầng, SWC và RTE"
description: "Các tầng thực sự để làm gì, viết một SWC mà không cần biết phần cứng, vì sao cấu hình ARXML lớn hơn code, và cách đọc một dự án thật."
duration: "16 phút"
tags: ["Ô tô", "AUTOSAR", "RTE"]
---

## Vấn đề AUTOSAR giải quyết

Trước AUTOSAR, một OEM mua bộ điều khiển thân xe từ Bosch thì nhận luôn cấu trúc phần mềm của
Bosch, và năm sau mua đúng chức năng đó từ Continental nghĩa là làm lại từ đầu. Logic ứng
dụng bị hàn chết vào một vi điều khiển cụ thể, một driver CAN cụ thể, một nhà cung cấp cụ thể.

**AUTOSAR (2003) chuẩn hoá các tầng và giao diện giữa chúng**, để logic ứng dụng quyết định
kính cửa lên xuống thế nào có thể tái sử dụng qua nhiều nhà cung cấp, nhiều dòng chip và
nhiều chương trình xe.

Cái giá là mọi thứ trở thành một bài toán cấu hình. Sự đánh đổi đó — cấu hình khổng lồ để đổi
lấy tính khả chuyển thực sự — là điều cần hiểu về AUTOSAR trước mọi thứ khác.

## Các tầng

![Các tầng AUTOSAR Classic](/MyPortfolio/images/automotive/autosar-layers.svg)

Đọc từ trên xuống:

**Application Layer** — logic của bạn, đóng gói thành **Software Component (SWC)**. Một SWC
hoàn toàn không biết mình chạy trên MCU nào và không hề `#include` header nào của hãng chip.

**RTE (Runtime Environment)** — code được sinh tự động, nối các SWC với nhau và với phần mềm
cơ sở. Đây chính là tầng làm cho tính khả chuyển thành hiện thực: SWC gọi `Rte_Write_...` và
RTE quyết định lời gọi đó trở thành một phép ghi biến cục bộ, một thông điệp tới SWC khác trên
cùng ECU, hay một khung CAN sang một ECU hoàn toàn khác.

**BSW (Basic Software)**, bản thân nó gồm ba tầng con:

- **Services** — hệ điều hành, ngăn xếp truyền thông (Com, PduR, CanTp), chẩn đoán (Dcm cho
  UDS, Dem cho DTC), bộ nhớ không mất dữ liệu (NvM), watchdog, mật mã.
- **ECU Abstraction** — CanIf, EthIf, MemIf, IoHwAb. Che đi chuyện một ngoại vi nằm bên trong
  MCU hay là con chip ngoài nối qua SPI.
- **MCAL (Microcontroller Abstraction Layer)** — Can, Spi, Adc, Pwm, Gpt, Fls. Do hãng chip
  cung cấp. **Đây là tầng duy nhất chạm vào thanh ghi.**

**Complex Device Driver (CDD)** là lối thoát hiểm: một cách hợp lệ để đi tắt qua các tầng cho
thứ có yêu cầu định thời mà ngăn xếp chuẩn không đáp ứng nổi — ví dụ điều khiển phun xăng
trực tiếp. Dự án nào cũng có vài cái, và kiến trúc sư nào cũng muốn ít đi.

## Một SWC trông như thế nào

SWC có các **cổng (port)**. Cổng *sender-receiver* chuyển dữ liệu; cổng *client-server* gọi
một thao tác. Code ứng dụng chỉ nhìn thấy các hàm `Rte_` được sinh ra:

```c
/* SWC DoorControl — cả file không có chút kiến thức phần cứng nào */
#include "Rte_DoorControl.h"

/* Một runnable — RTE gọi nó, bạn không bao giờ tự gọi */
FUNC(void, DoorControl_CODE) DoorControl_MainFunction(void)
{
    uint8 switch_state;
    uint8 vehicle_speed;

    /* đọc từ cổng nhận */
    if (Rte_Read_WindowSwitch_State(&switch_state) != RTE_E_OK) {
        return;
    }
    (void)Rte_Read_VehicleSpeed_Value(&vehicle_speed);

    /* phần chính sách thật sự — phần duy nhất thú vị */
    if (switch_state == SWITCH_UP && vehicle_speed < 20u) {
        Rte_Write_MotorCmd_Direction(MOTOR_UP);
    } else {
        Rte_Write_MotorCmd_Direction(MOTOR_STOP);
    }
}
```

Mọi thứ về việc `VehicleSpeed` *đến từ đâu* — một khung CAN từ ECU của ABS, hay một SWC khác
trên cùng ECU này — đều nằm ở cấu hình, không nằm trong file này. Chuyển SWC sang một ECU
khác thì thay đổi 0 dòng C.

RTE cũng cung cấp cả phần định thời. Một runnable được kích hoạt bởi một **RTEEvent**:

| Sự kiện | Ý nghĩa |
| --- | --- |
| `TimingEvent` | định kỳ — mỗi 10 ms |
| `DataReceivedEvent` | khi một tín hiệu tới |
| `OperationInvokedEvent` | khi client gọi cổng server của bạn |
| `InitEvent` | một lần lúc khởi động |
| `ModeSwitchEvent` | khi ECU đổi chế độ |

Bạn không viết scheduler, không viết task, không viết vòng lặp. Bạn khai báo "runnable này
chạy mỗi 10 ms" trong cấu hình, và bộ sinh RTE tạo ra task của OS để gọi nó.

## Hệ điều hành

AUTOSAR OS bắt nguồn từ **OSEK/VDX** và cố tình hạn chế hơn FreeRTOS:

- **Task được định nghĩa tĩnh.** Không bao giờ tạo lúc chạy.
- **Basic task** chạy tới khi kết thúc; **extended task** được phép chờ sự kiện.
- **Alarm và schedule table** kích hoạt task từ các bộ đếm, cho tính tất định theo thời gian.
- **Bảo vệ**: phân vùng bộ nhớ giữa các OS-Application, cộng với bảo vệ thời gian có thể giết
  một task vượt quá ngân sách của nó.

Điểm cuối mới là điều quan trọng với an toàn. Theo ISO 26262, một chức năng ASIL D phải có
**freedom from interference** trước code QM dùng chung MCU — và AUTOSAR OS cung cấp điều đó
bằng phân vùng có MPU chống lưng cùng ngân sách thực thi, chứ không phải bằng việc review code.

```c
TASK(Task_10ms)
{
    DoorControl_MainFunction();
    LightControl_MainFunction();
    TerminateTask();            /* bắt buộc — basic task phải kết thúc */
}
```

Quên `TerminateTask()` là lỗi AUTOSAR OS kinh điển, và nó thường biểu hiện bằng việc một hook
bảo vệ nổ ra chứ không phải một cú treo dễ thấy.

## Ngăn xếp truyền thông

Theo dấu một tín hiệu CAN từ dây dẫn tới SWC của bạn:

```
Bộ điều khiển CAN
  → Can (MCAL)              driver, xử lý ngắt
  → CanIf                   đối tượng phần cứng nào ứng với PDU nào
  → PduR (PDU Router)       định tuyến tới Com, CanTp (chẩn đoán), hoặc đường gateway
  → Com                     bóc tín hiệu ra khỏi PDU, áp bộ lọc và giám sát thời hạn
  → RTE                     ghi vào cổng của bạn
  → SWC của bạn
```

Mỗi tầng đều là cấu hình, không phải viết code. **Com** là nơi có những hành vi thú vị:

- **Đóng gói tín hiệu** — vị trí bit, thứ tự byte, dấu, giá trị khởi tạo.
- **Chế độ truyền** — theo chu kỳ, khi thay đổi, hoặc cả hai.
- **Giám sát thời hạn** — nếu một tín hiệu không tới trong N ms, thay bằng giá trị đã định và
  báo cho ứng dụng. Đây là cách chiếc xe vẫn hoạt động khi một ECU rơi khỏi bus.
- **Bit cập nhật** — phân biệt "giá trị bằng 0" với "không có giá trị mới nào tới".

Một phần lớn của "làm AUTOSAR" là chỉnh cấu hình Com khớp với thiết kế mạng của OEM, thứ tới
tay bạn dưới dạng một file ARXML.

## ARXML — nơi dự án thực sự tồn tại

Mọi thứ ở trên đều được mô tả bằng **ARXML** (AUTOSAR XML). Một dự án ECU cỡ vừa có thể có
50 MB ARXML, so với vài trăm kilobyte code C viết tay.

```xml
<SENDER-RECEIVER-INTERFACE>
  <SHORT-NAME>VehicleSpeed</SHORT-NAME>
  <DATA-ELEMENTS>
    <VARIABLE-DATA-PROTOTYPE>
      <SHORT-NAME>Value</SHORT-NAME>
      <TYPE-TREF DEST="IMPLEMENTATION-DATA-TYPE">/DataTypes/uint8</TYPE-TREF>
    </VARIABLE-DATA-PROTOTYPE>
  </DATA-ELEMENTS>
</SENDER-RECEIVER-INTERFACE>
```

Không ai gõ thứ đó bằng tay. Bạn dùng công cụ cấu hình — **Vector DaVinci**, **ETAS ISOLAR**,
**EB tresos** — và nó sinh ra RTE cùng cấu hình BSW từ những cú bấm chuột của bạn.

Ba hệ quả nên thấm sớm:

1. **Build gồm một bước sinh code rồi mới biên dịch.** Đổi một cổng thì phải sinh lại RTE rồi
   biên dịch lại. Quên sinh lại sẽ cho ra lỗi liên kết trông rất bí ẩn cho tới khi bạn quen
   nhịp.
2. **ARXML nằm trong quản lý phiên bản và merge rất tệ.** Hai kỹ sư cùng sửa một cấu hình là
   vấn đề phối hợp có thật. Phần lớn đội chia cấu hình theo trách nhiệm và merge rất cẩn thận.
3. **Giấy phép công cụ là một khoản chi phí và một nút thắt của dự án.** Đây là khác biệt thật
   so với công việc nhúng mã nguồn mở.

## Ngăn xếp chẩn đoán

Hai module BSW hiện thực bài 3 giúp bạn:

**Dcm (Diagnostic Communication Manager)** lo UDS: phiên làm việc, truy cập bảo mật, bộ điều
phối dịch vụ, định thời. Bạn cấu hình xem có những dịch vụ và DID nào, rồi cung cấp callback:

```c
Std_ReturnType Dcm_ReadVIN(uint8 *data, uint16 length)
{
    (void)memcpy(data, vin_string, 17u);
    return E_OK;
}
```

**Dem (Diagnostic Event Manager)** lo DTC: chống dội, vòng đời pending/confirmed, freeze
frame, lưu vào NvM, tự lành. Bộ giám sát của bạn chỉ việc báo đạt hay không đạt:

```c
/* bộ giám sát quyết định; Dem sở hữu vòng đời */
if (sensor_voltage > 4.9f) {
    Dem_SetEventStatus(DemConf_DemEventParameter_SensorShortToBattery,
                       DEM_EVENT_STATUS_FAILED);
} else {
    Dem_SetEventStatus(DemConf_DemEventParameter_SensorShortToBattery,
                       DEM_EVENT_STATUS_PASSED);
}
```

Mọi thứ còn lại — bao nhiêu lần lỗi thì xác nhận, freeze frame chứa gì, khi nào tự lành — đều
là cấu hình. Sự tách bạch đó là thiết kế thực sự tốt: bộ giám sát hiểu vật lý, còn Dem hiểu
tiêu chuẩn.

## Đọc một dự án AUTOSAR xa lạ

Thứ tự thực dụng cho tuần đầu tiên của bạn:

1. **Tìm ECU Extract** — file ARXML mô tả vai trò của ECU này trong mạng. Nó cho biết tín hiệu
   nào tới và tín hiệu nào bạn phải gửi.
2. **Liệt kê các SWC và runnable của chúng.** Công cụ hiển thị sơ đồ thành phần; đó mới là kiến
   trúc thật.
3. **Mở cấu hình OS.** Các task, chu kỳ của chúng, và runnable nào nằm trong task nào sẽ cho
   bạn biết thiết kế định thời.
4. **Tìm các CDD.** Đó là nơi tiêu chuẩn không vừa, nghĩa là nơi có những vấn đề thú vị.
5. **Chỉ sau đó mới đọc code C.** Tới lúc đó nó sẽ có nghĩa.

## Những hạn chế thật lòng

AUTOSAR Classic thực sự tốt ở đúng thứ nó nhắm tới — điều khiển liên quan an toàn, cấu hình
tĩnh, chạy trên vi điều khiển. Nó không hợp với những thứ khác:

- **Không có hành vi động.** Mọi thứ cố định lúc build. Bạn không thêm được một dịch vụ lúc
  chạy, mà đó lại chính là điều một chiếc xe định nghĩa bằng phần mềm mong muốn.
- **Đơn vị cập nhật là cả ECU.** Không hề có khái niệm cập nhật riêng một ứng dụng.
- **Nặng với ECU nhỏ.** Riêng ngăn xếp đã có thể hơn 100 kB flash.
- **Chi phí công cụ dốc**, cả về tiền lẫn thời gian học.

Chính những giới hạn đó là lý do AUTOSAR **Adaptive** ra đời, và đó là bài 5.

## Tự kiểm tra

1. Tầng nào được phép chạm thanh ghi phần cứng, và vì sao điều đó quan trọng?
2. RTE làm gì để một SWC khả chuyển được giữa các ECU?
3. Vì sao basic task phải gọi `TerminateTask()`?
4. Ai sở hữu logic chống dội DTC — code giám sát của bạn hay Dem?

## Bài tiếp theo

Bài 5: AUTOSAR Adaptive và kiến trúc hướng dịch vụ. SOME/IP, `ara::com`, và chiếc xe định
nghĩa bằng phần mềm thực sự thay đổi mô hình lập trình như thế nào.
