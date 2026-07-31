---
lesson: 3
lang: vi
title: "Treble, và viết một HAL"
description: "Vì sao /vendor và /system tách rời, VNDK thực sự hạn chế điều gì, HIDL so với AIDL và vì sao AIDL thắng, manifest VINTF cùng ma trận tương thích, và một HAL viết trọn vẹn."
duration: "17 phút"
tags: ["AOSP", "Treble", "HAL", "AIDL"]
---

## Bài toán mà Treble đã giải

Trước Android 8, nâng cấp framework nghĩa là biên dịch lại mọi blob của hãng phần cứng theo
framework mới, vì mã của hãng liên kết trực tiếp với thư viện framework. Đó là lý do bản cập
nhật Android mất mười tám tháng mới tới được thiết bị, và vì sao hầu hết máy chẳng bao giờ
nhận được.

**Project Treble vạch một ranh giới nhị phân cứng giữa `/system` và `/vendor`.** Phía trên
ranh giới là framework của Google. Phía dưới là HAL và driver của hãng chip. Chúng chỉ nói
chuyện qua các giao diện ổn định, có phiên bản. Nâng cấp framework, giữ nguyên ảnh vendor, và
thiết bị vẫn chạy.

Với bạn với tư cách kỹ sư, Treble là một tập ràng buộc bạn sẽ đụng vào liên tục, và chúng hợp
lý hơn nhiều khi bạn biết chúng đang bảo vệ điều gì.

![Ranh giới Treble](/MyPortfolio/images/aosp/treble.svg)

## Ranh giới đó thực sự áp đặt gì

**Phân vùng.** `/system` là framework, `/vendor` là phần riêng của silicon, `/odm` là phần
riêng của ODM/board, `/product` là tuỳ biến sản phẩm. HAL của bạn nằm ở `/vendor`. Dòng
`vendor: true` trong `Android.bp` là thứ đưa nó tới đó.

**VNDK.** Tiến trình vendor không được liên kết với thư viện hệ thống tuỳ ý. Chúng có VNDK —
một tập cố định, có phiên bản (`libbase`, `libcutils`, `libutils`, `liblog`, v.v.) — cộng thêm
thư viện của chính chúng. Liên kết với thứ ngoài tập đó thì build thất bại kèm lỗi về
`vendor_available`.

```
cc_library_shared {
    name: "libmyvendorstuff",
    vendor: true,                    // chỉ /vendor
    // hoặc:
    vendor_available: true,          // build hai lần, cho cả hai phía
    shared_libs: ["libbase", "liblog"],   // phải là VNDK hoặc thư viện vendor
}
```

Quy tắc khiến người ta vấp: **có hai bản của một thư viện `vendor_available` trên thiết bị**,
một ở `/system/lib64` và một ở `/vendor/lib64`, và chúng có thể khác phiên bản. Chúng không
chia sẻ trạng thái. Một singleton trong thư viện như vậy là singleton *cho mỗi phía*, tạo ra
những lỗi trông như bất khả thi cho tới khi bạn biết điều này.

**Không gian tên.** Trình liên kết áp đặt điều trên tại thời điểm chạy. Dòng
`library "libfoo.so" not found` trong logcat, với một thư viện rõ ràng có tồn tại trên thiết
bị, gần như luôn là vi phạm không gian tên chứ không phải file bị thiếu.

## HIDL, và vì sao AIDL thay thế nó

HIDL xuất hiện cùng Treble ở Android 8 với vai trò ngôn ngữ IPC ổn định cho HAL. Nó chạy được,
và nó là ngôn ngữ định nghĩa giao diện thứ hai phải học, với bộ công cụ riêng, mã sinh riêng
và những điều kỳ quặc riêng — trong khi AIDL vốn đã tồn tại cho IPC của framework.

Từ Android 11, **AIDL có thêm biến thể ổn định** và trở thành cách được khuyến nghị để viết
HAL. Từ Android 13, HAL mới bắt buộc dùng AIDL. HIDL bị đóng băng và không còn được khuyến
khích.

Thực tế: **viết AIDL cho mọi thứ mới**, và hãy chuẩn bị đọc HIDL trong các cây mã nguồn vendor
hiện có thêm nhiều năm nữa. Các khái niệm ánh xạ khá sát nhau, nên biết một cái là đi được
phần lớn quãng đường tới cái kia.

| | HIDL | AIDL ổn định |
|---|---|---|
| File | `.hal` | `.aidl` |
| Đánh phiên bản | thư mục gói mới | bản kết xuất API `frozen` trong `aidl_api/` |
| Ngôn ngữ | C++, Java | C++, Java, Rust, backend NDK |
| Trạng thái | không khuyến khích | hiện hành |

## Viết một giao diện HAL

Định nghĩa giao diện, trong
`hardware/interfaces/acme/led/aidl/android/hardware/acme/led/`:

```java
package android.hardware.acme.led;

@VintfStability
interface ILedControl {
    void setBrightness(int id, int brightness);
    int  getBrightness(int id);
    int[] getSupportedLeds();
    void registerCallback(ILedCallback cb);
}
```

`@VintfStability` là thứ biến nó thành giao diện HAL chứ không phải giao diện nội bộ: nó buộc
giao diện phải có phiên bản, bị đóng băng khi phát hành, và được khai báo trong VINTF. Bỏ nó
đi thì giao diện vẫn dùng được bên trong một phân vùng nhưng không vượt qua ranh giới Treble
được.

Quy tắc build:

```
aidl_interface {
    name: "android.hardware.acme.led",
    vendor_available: true,
    srcs: ["android/hardware/acme/led/*.aidl"],
    stability: "vintf",
    owner: "acme",
    backend: {
        cpp:  { enabled: false },     // mã vendor dùng ndk
        ndk:  { enabled: true },
        java: { enabled: true },
    },
    versions_with_info: [
        { version: "1", imports: [] },
    ],
}
```

Hai điều cần lưu ý. **Mã vendor phải dùng backend `ndk`**, không phải `cpp` — backend NDK liên
kết với `libbinder_ndk`, thứ có ABI ổn định; backend `cpp` dùng `libbinder`, thứ không ổn
định, nên chỉ dùng được ở phía hệ thống.

Và **`versions_with_info`** là cơ chế đánh phiên bản. Lệnh
`m android.hardware.acme.led-freeze-api` ghi một bản kết xuất API bất biến vào `aidl_api/`.
Sau khi đóng băng, mọi thay đổi không tương thích sẽ làm build thất bại — đó chính là mục
đích, và nó sẽ khiến bạn thấy vướng víu cho tới đúng lúc nó cứu bạn khỏi làm hỏng một thiết bị
đã xuất xưởng.

## Cài đặt nó

```cpp
#include <aidl/android/hardware/acme/led/BnLedControl.h>
#include <android-base/file.h>

using aidl::android::hardware::acme::led::BnLedControl;

class LedControl : public BnLedControl {
public:
    ndk::ScopedAStatus setBrightness(int32_t id, int32_t brightness) override {
        if (id < 0 || id >= kLedCount)
            return ndk::ScopedAStatus::fromExceptionCode(EX_ILLEGAL_ARGUMENT);

        std::string path = "/sys/class/leds/led" + std::to_string(id) + "/brightness";
        if (!android::base::WriteStringToFile(std::to_string(brightness), path))
            return ndk::ScopedAStatus::fromServiceSpecificError(kErrorHardware);

        return ndk::ScopedAStatus::ok();
    }
    // ...
};

int main() {
    ABinderProcess_setThreadPoolMaxThreadCount(4);

    auto svc = ndk::SharedRefBase::make<LedControl>();
    const std::string name = std::string(LedControl::descriptor) + "/default";

    binder_status_t s = AServiceManager_addService(svc->asBinder().get(), name.c_str());
    CHECK_EQ(s, STATUS_OK);

    ABinderProcess_joinThreadPool();
    return EXIT_FAILURE;                  // joinThreadPool không bao giờ trả về
}
```

Tên thể hiện — `android.hardware.acme.led.ILedControl/default` — là chuỗi mà client tra cứu.
`default` là quy ước cho một thể hiện duy nhất; hãy dùng tên riêng khi bạn có nhiều thể hiện.

## VINTF: khai báo và yêu cầu

Hai file XML đảm bảo framework và vendor thống nhất với nhau.

**Manifest của vendor** — thiết bị này cung cấp gì, trong `device/acme/board1/manifest.xml`:

```xml
<manifest version="1.0" type="device">
  <hal format="aidl">
    <name>android.hardware.acme.led</name>
    <version>1</version>
    <interface>
      <name>ILedControl</name>
      <instance>default</instance>
    </interface>
  </hal>
</manifest>
```

**Ma trận tương thích của framework** — framework yêu cầu gì. Nếu một HAL được đánh dấu
`optional="false"` trong ma trận mà lại thiếu trong manifest, **build sẽ thất bại**. Đó là chủ
ý: nó ngăn một thiết bị xuất xưởng mà thiếu HAL bắt buộc rồi mới phát hiện lúc chạy.

Kiểm tra trên thiết bị:

```bash
adb shell vintf                        # kết xuất cả hai, cùng kết quả kiểm tra tương thích
adb shell lshal                        # mọi HAL đã đăng ký, và client của chúng
adb shell lshal debug android.hardware.acme.led.ILedControl/default
```

`lshal` là thứ đầu tiên nên chạy khi một client không tìm thấy HAL của bạn. Nếu dịch vụ không
có trong danh sách, vấn đề là nó chưa khởi động (bài 2: `getprop | grep init.svc`) hoặc
`addService` thất bại. Nếu nó có trong danh sách mà client vẫn hỏng, vấn đề là SELinux (bài 5).

## Nối nó vào hệ thống build

```
# Android.bp
cc_binary {
    name: "android.hardware.acme.led-service",
    relative_install_path: "hw",
    vendor: true,
    init_rc: ["android.hardware.acme.led-service.rc"],
    vintf_fragments: ["android.hardware.acme.led-service.xml"],
    srcs: ["service.cpp", "LedControl.cpp"],
    shared_libs: [
        "libbase", "liblog", "libbinder_ndk",
        "android.hardware.acme.led-V1-ndk",
    ],
}
```

```
# file .rc
service vendor.acme.led /vendor/bin/hw/android.hardware.acme.led-service
    class hal
    user system
    group system
    seclabel u:r:hal_acme_led_default:s0
```

```makefile
# device.mk
PRODUCT_PACKAGES += android.hardware.acme.led-service
```

`vintf_fragments` là cách hiện đại để khai báo HAL — mảnh khai báo được gộp vào manifest thiết
bị lúc build, nên khai báo nằm cạnh chính đoạn mã cài đặt nó thay vì nằm trong một file trung
tâm mà ai cũng phải sửa.

## Gọi nó từ framework

```java
import android.hardware.acme.led.ILedControl;

IBinder b = ServiceManager.waitForDeclaredService(
        "android.hardware.acme.led.ILedControl/default");
ILedControl led = ILedControl.Stub.asInterface(b);
led.setBrightness(0, 128);
```

`waitForDeclaredService` chặn cho tới khi dịch vụ xuất hiện, tránh được cuộc đua khi mã
framework của bạn khởi động trước HAL. `getService` trả về null trong khoảng đó và một lượng
đáng ngạc nhiên công sức gỡ lỗi bring-up là do dùng nó gây ra.

Lưu ý mã framework gọi thẳng một HAL vendor chỉ được phép với những HAL mà framework biết tới.
HAL của riêng bạn thông thường sẽ được gọi bởi dịch vụ hệ thống của riêng bạn — đó là bài 5.

## Tự kiểm tra

1. VNDK hạn chế điều gì, và bạn thấy lỗi gì khi vi phạm nó?
2. Vì sao mã vendor phải dùng backend NDK của AIDL chứ không phải backend C++?
3. Đóng băng một giao diện AIDL ngăn chặn điều gì, và bản kết xuất nằm ở đâu?
4. Client của bạn không tìm thấy HAL. Ba thứ cần kiểm tra, theo thứ tự, là gì?

## Tiếp theo

Mọi thứ ở đây đều chạy trên Binder, và tới giờ nó vẫn là một hộp đen. Bài 4 mở nó ra: driver
trong nhân, Parcel, giao dịch một lần sao chép, servicemanager, thread pool cùng giới hạn của
nó, death recipient, và cách gỡ lỗi Binder thay vì đoán mò về nó.
