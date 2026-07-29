---
lesson: 5
lang: vi
title: "AUTOSAR Adaptive, SOME/IP và chiếc xe định nghĩa bằng phần mềm"
description: "Vì sao tín hiệu nhường chỗ cho dịch vụ, cơ chế khám phá của SOME/IP, code ara::com trông ra sao, và Android Automotive nằm ở đâu trong ngăn xếp."
duration: "15 phút"
tags: ["Ô tô", "AUTOSAR Adaptive", "SOME/IP"]
---

## Tín hiệu và dịch vụ

AUTOSAR Classic **hướng tín hiệu**. Thiết kế mạng quy định rằng CAN ID `0x201` được gửi mỗi
10 ms và chứa `VehicleSpeed` tại bit 0. Mọi bên nhận đều được cấu hình lúc build để chờ đúng
điều đó. Nó tất định, phân tích được, và hoàn toàn cứng nhắc.

Adaptive **hướng dịch vụ**. Một bên cung cấp chào ra một dịch vụ — "tốc độ xe đây, ai cần thì
đăng ký" — và bên tiêu thụ tìm thấy nó lúc chạy rồi đăng ký. Không có gì về bên tiêu thụ được
nướng cứng vào bên cung cấp.

| | Hướng tín hiệu (Classic) | Hướng dịch vụ (Adaptive) |
| --- | --- | --- |
| Gắn kết | lúc build | khám phá lúc chạy |
| Luồng dữ liệu | quảng bá, luôn gửi | đăng ký; chỉ gửi cho người đăng ký |
| Thêm bên tiêu thụ | cấu hình lại mạng | chỉ cần đăng ký |
| Thêm bên cung cấp | cấu hình lại mạng | chỉ cần chào dịch vụ |
| Tính tất định | cao, phân tích được | thấp hơn, khó chặn trên |
| Vận chuyển điển hình | CAN | Ethernet |

Cú chuyển này được thúc đẩy bởi cùng một thứ với kiến trúc zonal: tính năng đang trở thành
phần mềm, và phần mềm cài thêm được qua mạng thì không thể có danh sách người tiêu thụ ghi
cứng từ lúc build.

## SOME/IP

**SOME/IP** (Scalable service-Oriented MiddlewarE over IP) là giao thức middleware ô tô mang
mô hình này. Ba cơ chế:

**1. Hỏi/đáp** — một lời gọi thủ tục từ xa:

```
Client → Server:  [Service 0x1234][Method 0x0001][Request ID][payload]
Server → Client:  [Service 0x1234][Method 0x0001][Request ID][kết quả]
```

**2. Event** — xuất bản/đăng ký, chủ lực cho dữ liệu cảm biến:

```
Client → Server:  SubscribeEventgroup
Server → Client:  SubscribeEventgroupAck
Server → Client:  Event(speed = 52)      ... lặp lại mỗi khi thay đổi
```

**3. Field** — một giá trị có getter, setter và thông báo khi thay đổi. Tiện cho các trạng
thái mang tính cấu hình.

Header gọn và cố định:

| Trường | Byte | Công dụng |
| --- | --- | --- |
| Service ID | 2 | dịch vụ nào |
| Method/Event ID | 2 | thao tác nào |
| Length | 4 | độ dài phần tải |
| Client ID + Session ID | 4 | khớp yêu cầu với phản hồi |
| Protocol/Interface version | 2 | tương thích |
| Message type | 1 | REQUEST, RESPONSE, NOTIFICATION, ERROR |
| Return code | 1 | E_OK, E_NOT_OK, … |

## Khám phá dịch vụ

**SOME/IP-SD** là thứ làm cho việc gắn kết lúc chạy hoạt động. Nó chạy trên UDP multicast:

```
Server → multicast:  OfferService(0x1234, instance 1, TTL 3s)
Client → Server:     SubscribeEventgroup(0x1234, eventgroup 1)
Server → Client:     SubscribeEventgroupAck
Server → Client:     ... event tuôn về ...
Server → multicast:  StopOfferService     (hoặc đơn giản là TTL hết hạn)
```

Client khởi động trước sẽ gửi `FindService` rồi chờ; server khởi động trước thì chào dịch vụ
lặp lại. TTL rất quan trọng: nếu bên cung cấp chết, đăng ký hết hạn và bên tiêu thụ biết được,
thay vì cứ im lặng chẳng nhận gì mãi mãi.

Đây chính là cơ chế khiến việc cài thêm tính năng qua mạng trở nên khả thi. Một ứng dụng mới
chào ra dịch vụ mới, các bên tiêu thụ sẵn có khám phá ra nó, và không ECU nào khác phải cấu
hình lại.

## ara::com — code trông thế nào

AUTOSAR Adaptive chuẩn hoá một API C++. Từ mô tả dịch vụ trong ARXML, bộ công cụ sinh ra các
lớp proxy và skeleton.

**Bên cung cấp (skeleton):**

```cpp
#include "ara/com/speed_service_skeleton.h"

class SpeedServiceImpl : public SpeedServiceSkeleton {
public:
    explicit SpeedServiceImpl(ara::com::InstanceIdentifier id)
        : SpeedServiceSkeleton(id) {}

    /* một method mà client gọi được */
    ara::core::Future<GetMaxSpeedOutput> GetMaxSpeed() override {
        ara::core::Promise<GetMaxSpeedOutput> promise;
        promise.set_value({ .maxSpeed = 180u });
        return promise.get_future();
    }
};

int main() {
    ara::core::Initialize();

    SpeedServiceImpl service{ ara::com::InstanceIdentifier{"1"} };
    service.OfferService();

    while (running) {
        auto speed = read_speed_sensor();
        service.CurrentSpeed.Update(speed);   /* báo cho mọi người đăng ký */
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    service.StopOfferService();
    ara::core::Deinitialize();
}
```

**Bên tiêu thụ (proxy):**

```cpp
#include "ara/com/speed_service_proxy.h"

int main() {
    ara::core::Initialize();

    auto handles = SpeedServiceProxy::FindService(
            ara::com::InstanceIdentifier::Any);

    if (handles.Value().empty()) { return 1; }

    SpeedServiceProxy proxy{ handles.Value()[0] };

    proxy.CurrentSpeed.SetReceiveHandler([&proxy]() {
        proxy.CurrentSpeed.GetNewSamples([](auto sample) {
            std::cout << "speed: " << *sample << '\n';
        });
    });
    proxy.CurrentSpeed.Subscribe(/*maxSampleCount=*/ 5);

    /* gọi method thì nhận về một future */
    auto future = proxy.GetMaxSpeed();
    std::cout << "max: " << future.get().maxSpeed << '\n';
}
```

Nếu bạn từng viết C++ hiện đại với future và callback thì đoạn này quen thuộc. Đó chính là
chủ ý: Adaptive cố tình trông giống lập trình hệ thống thông thường, vì những người mà nó cần
tuyển đến từ chỗ đó.

## Phần còn lại của nền tảng Adaptive

Ngoài `ara::com`, những cụm chức năng bạn sẽ gặp:

| Cụm | Cung cấp |
| --- | --- |
| `ara::exec` | Execution Management — khởi động ứng dụng, quản lý trạng thái máy |
| `ara::com` | Communication Management — API ở trên |
| `ara::diag` | Chẩn đoán — UDS, lần này trên POSIX |
| `ara::per` | Persistency — lưu trữ khoá/giá trị và file, có dự phòng |
| `ara::log` | Ghi log và truy vết, tương thích DLT |
| `ara::crypto` | Mật mã và lưu trữ khoá |
| `ara::iam` | Quản lý danh tính và quyền truy cập |
| `ara::ucm` | Update and Configuration Management — **OTA** |

`ara::ucm` có thể nói là lý do tồn tại của Adaptive. Nó định nghĩa cách một gói phần mềm được
truyền, kiểm chứng, kích hoạt, và quay lui nếu kích hoạt thất bại — đúng bộ máy mà một chiếc
xe định nghĩa bằng phần mềm cần có.

Nền tảng chạy trên hệ điều hành **POSIX** (tập con PSE51): Linux có PREEMPT_RT, hoặc QNX cho
công việc cần chứng nhận an toàn. Điều đó lập tức cho bạn cấp phát động, luồng, hệ thống file
và tiến trình — mọi thứ mà Classic cố tình cấm, kèm theo cái giá về khả năng phân tích.

## Android Automotive nằm ở đâu

Android Automotive OS là nền tảng thứ ba, và nó nằm *bên trên* những cái kia chứ không phải
bên cạnh. Nó chạy trải nghiệm infotainment và với tới chiếc xe qua **Vehicle HAL (VHAL)**:

```
Ứng dụng Android (Kotlin/Java)
  → Car API  (CarPropertyManager)
  → CarService  (dịch vụ hệ thống)
  → Vehicle HAL  (giao diện HIDL/AIDL)     ← ranh giới bạn hiện thực
  → middleware native của bạn  (C++)
  → SOME/IP hoặc CAN
  → phần còn lại của chiếc xe
```

VHAL phơi trạng thái xe ra dưới dạng **property**, mỗi cái một ID chuẩn, và việc của bạn với
tư cách lập trình viên middleware thường là hiện thực cái HAL đó trên nền những gì mạng trên
xe thực sự nói:

```cpp
/* bản rút gọn của một hàm get trong VHAL */
StatusCode VehicleHal::get(const VehiclePropValue& requested,
                           VehiclePropValuePtr* outValue) {
    switch (requested.prop) {
    case toInt(VehicleProperty::PERF_VEHICLE_SPEED):
        (*outValue)->value.floatValues[0] = someip_client_->getSpeed();
        return StatusCode::OK;

    case toInt(VehicleProperty::HVAC_TEMPERATURE_SET):
        (*outValue)->value.floatValues[0] = hvac_->targetTemp(requested.areaId);
        return StatusCode::OK;

    default:
        return StatusCode::INVALID_ARG;
    }
}
```

Đây đúng là loại công việc nằm giữa Android và các mạng trên xe, và cũng là nơi thực sự có
nhiều vị trí middleware ô tô: C++ ở phía Android của ranh giới, IPC, và một ngăn xếp giao thức
bên dưới.

## Classic và Adaptive đi cùng nhau

Chúng không cạnh tranh; một chiếc xe thật dùng cả hai:

```
        HPC (SoC, Linux/QNX)
        ┌────────────────────────────────┐
        │  Hợp nhất ADAS │ Ứng dụng xe   │   ← Adaptive, C++, SOME/IP
        │  ara::com · ara::ucm · ara::diag│
        └────────────┬───────────────────┘
                     │ Automotive Ethernet
        ┌────────────┴───────────────────┐
        │  Bộ điều khiển vùng             │   ← Classic, C, tất định
        │  AUTOSAR Classic · CAN/LIN      │
        └────────────┬───────────────────┘
                     │ CAN FD / LIN
              cảm biến và cơ cấu chấp hành
```

Quy tắc ngón tay cái: **liên quan an toàn, thời gian thực khắt khe, MCU rẻ → Classic. Nặng
tính toán, cần cập nhật, hướng dịch vụ → Adaptive.** Bộ điều khiển phanh sẽ còn là Classic
trong một thời gian dài nữa.

## Thử SOME/IP mà không cần xe

Hai ngăn xếp mã nguồn mở cho bạn thí nghiệm ngay trên laptop:

```bash
# vsomeip — bản hiện thực tham chiếu, từ Genivi/COVESA
git clone https://github.com/COVESA/vsomeip
cd vsomeip && mkdir build && cd build
cmake .. && make -j$(nproc) && sudo make install
```

**CommonAPI C++** nằm bên trên và sinh proxy từ Franca IDL, khá gần với trải nghiệm
`ara::com`. Chạy một bên cung cấp và một bên tiêu thụ như hai tiến trình trên `localhost`,
kèm Wireshark giải mã SOME/IP, sẽ dạy bạn luồng khám phá nhanh hơn mọi tài liệu.

Wireshark có sẵn bộ giải mã SOME/IP — bắt gói trên `lo`, lọc `someip`, và bạn xem được
`OfferService` với `SubscribeEventgroup` chạy qua.

## Tự kiểm tra

1. Khác biệt thực tế giữa tín hiệu và dịch vụ là gì khi bạn thêm một bên tiêu thụ mới?
2. TTL trong `OfferService` phòng ngừa điều gì?
3. Cụm chức năng nào lo cập nhật qua mạng?
4. Trong ngăn xếp Android Automotive, cái gì nằm giữa `CarService` và mạng trên xe?

## Bài tiếp theo

Bài cuối: an toàn chức năng và an ninh mạng. ISO 26262, ASIL nghĩa là gì với code bạn viết,
và ISO/SAE 21434 đã thay đổi thứ bạn được phép xuất xưởng ra sao.
