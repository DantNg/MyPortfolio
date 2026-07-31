---
lesson: 5
lang: vi
title: "Thêm dịch vụ hệ thống của riêng bạn"
description: "Một dịch vụ native hoàn chỉnh: giao diện AIDL, phần cài đặt, nối vào init, chính sách SELinux sẽ chặn bạn ba lần, một lớp manager phía framework, và phép kiểm tra quyền thuộc về phía server."
duration: "18 phút"
tags: ["AOSP", "SELinux", "AIDL"]
---

## Chúng ta sẽ dựng cái gì

Một dịch vụ trạng thái thiết bị: thứ sống trên nền tảng, đọc phần cứng riêng của board, và
phơi nó ra cho ứng dụng qua một API Android trông bình thường. Đây là hình dạng của phần lớn
công việc nền tảng thực tế — một ODM thêm một tính năng mà Android không có framework sẵn.

Bảy mảnh, và phải có đủ cả bảy thì mới chạy:

```
1. Giao diện AIDL          hợp đồng
2. Cài đặt native          phần mã
3. Android.bp              cách build
4. init .rc                cách khởi động
5. Chính sách SELinux      quyền được tồn tại       <- chỗ bạn sẽ tốn thời gian
6. Manager framework       thứ ứng dụng gọi
7. Quyền                   ai được phép
```

## 1. Giao diện

`frameworks/base/core/java/com/acme/devicestatus/IDeviceStatus.aidl` — hoặc, với một dịch vụ
hoàn toàn phía vendor, nằm trong thư mục thiết bị của bạn:

```java
package com.acme.devicestatus;

interface IDeviceStatus {
    int    getBoardTemperature();
    String getSerialNumber();
    void   setFanSpeed(int percent);
    void   registerListener(IDeviceStatusListener listener);
}
```

```
aidl_interface {
    name: "com.acme.devicestatus",
    unstable: false,
    srcs: ["com/acme/devicestatus/*.aidl"],
    backend: {
        java: { enabled: true, platform_apis: true },
        ndk:  { enabled: true },
    },
}
```

## 2. Phần cài đặt

```cpp
#include <aidl/com/acme/devicestatus/BnDeviceStatus.h>
#include <android-base/file.h>
#include <android-base/logging.h>
#include <private/android_filesystem_config.h>

using aidl::com::acme::devicestatus::BnDeviceStatus;

class DeviceStatus : public BnDeviceStatus {
public:
    ndk::ScopedAStatus getBoardTemperature(int32_t* out) override {
        std::string s;
        if (!android::base::ReadFileToString(
                "/sys/class/thermal/thermal_zone0/temp", &s))
            return ndk::ScopedAStatus::fromServiceSpecificError(kErrIo);
        *out = std::stoi(s) / 1000;
        return ndk::ScopedAStatus::ok();
    }

    ndk::ScopedAStatus setFanSpeed(int32_t percent) override {
        // Kiểm tra ở SERVER. Đừng bao giờ tin rằng client đã kiểm tra.
        uid_t uid = AIBinder_getCallingUid();
        if (uid != AID_SYSTEM && uid != AID_ROOT)
            return ndk::ScopedAStatus::fromExceptionCode(EX_SECURITY);

        if (percent < 0 || percent > 100)
            return ndk::ScopedAStatus::fromExceptionCode(EX_ILLEGAL_ARGUMENT);

        return android::base::WriteStringToFile(std::to_string(percent),
                                                "/sys/class/hwmon/hwmon0/pwm1")
            ? ndk::ScopedAStatus::ok()
            : ndk::ScopedAStatus::fromServiceSpecificError(kErrIo);
    }
};

int main() {
    ABinderProcess_setThreadPoolMaxThreadCount(4);

    auto svc = ndk::SharedRefBase::make<DeviceStatus>();
    binder_status_t st = AServiceManager_addService(
            svc->asBinder().get(), "com.acme.devicestatus.IDeviceStatus/default");
    if (st != STATUS_OK) {
        LOG(FATAL) << "addService thất bại: " << st;   // gần như luôn là SELinux
    }

    ABinderProcess_joinThreadPool();
    return EXIT_FAILURE;
}
```

Hãy chú ý vị trí đặt phép kiểm tra quyền. **Nó nằm ở server**, dùng một định danh mà người gọi
không giả mạo được. Kiểm tra trong lớp manager phía client là tiện lợi, không phải ranh giới an
ninh — ai cũng có thể gọi thẳng vào giao diện Binder.

## 3 và 4. Build và khởi động

```
cc_binary {
    name: "devicestatusd",
    srcs: ["main.cpp", "DeviceStatus.cpp"],
    shared_libs: ["libbase", "liblog", "libbinder_ndk", "com.acme.devicestatus-ndk"],
    init_rc: ["devicestatusd.rc"],
    vendor: true,
    cflags: ["-Wall", "-Werror"],
}
```

```
service devicestatusd /vendor/bin/devicestatusd
    class main
    user system
    group system
    seclabel u:r:devicestatusd:s0
```

```makefile
# device.mk
PRODUCT_PACKAGES += devicestatusd
```

Ba file, và quên file thứ ba nghĩa là một nhị phân build hoàn hảo mà không có trên thiết bị.

## 5. SELinux, nơi thời gian thực sự trôi đi

Android chạy SELinux ở chế độ **enforcing**. Dịch vụ của bạn sẽ bị từ chối theo mặc định, ba
lần riêng biệt, và mỗi lần từ chối trông như một lỗi khác nhau.

Chính sách đặt trong `device/acme/board1/sepolicy/`.

**Khai báo domain** — `devicestatusd.te`:

```
type devicestatusd, domain;
type devicestatusd_exec, exec_type, vendor_file_type, file_type;

# init khởi động nó, và nó chuyển sang domain riêng
init_daemon_domain(devicestatusd)

# nó được đăng ký với servicemanager
add_service(devicestatusd, devicestatus_service)

# nó được dùng binder
binder_use(devicestatusd)

# nó được đọc sysfs nhiệt
allow devicestatusd sysfs_thermal:file r_file_perms;
allow devicestatusd sysfs_hwmon:file rw_file_perms;
```

**Gán nhãn cho file nhị phân** — `file_contexts`:

```
/vendor/bin/devicestatusd    u:object_r:devicestatusd_exec:s0
```

**Khai báo tên dịch vụ** — `service.te` và `service_contexts`:

```
type devicestatus_service, service_manager_type;
```

```
com.acme.devicestatus.IDeviceStatus/default    u:object_r:devicestatus_service:s0
```

**Cho phép client tìm thấy nó** — trong `system_app.te` hoặc bất cứ đâu client của bạn sống:

```
allow system_app devicestatus_service:service_manager find;
```

**Và trỏ hệ thống build vào chính sách của bạn** — `BoardConfig.mk`:

```makefile
BOARD_VENDOR_SEPOLICY_DIRS += device/acme/board1/sepolicy
```

### Quy trình thực sự hiệu quả

Đừng viết chính sách bằng cách đoán. Hãy chạy nó, thu thập các lần từ chối, rồi sinh ra luật.

```bash
# 1. tạm chuyển permissive, để thu THẤT CẢ các lần từ chối chứ không chỉ lần đầu
adb shell setenforce 0

# 2. cho dịch vụ của bạn hoạt động
adb shell am start ...

# 3. đọc các lần từ chối
adb shell dmesg | grep avc
adb logcat | grep avc

# 4. sinh luật ứng viên
adb shell dmesg | grep avc > denials.txt
audit2allow -i denials.txt

# 5. quay lại enforcing và kiểm chứng
adb shell setenforce 1
```

Một dòng từ chối đọc như sau:

```
avc: denied { read } for pid=1234 comm="devicestatusd"
     name="temp" dev="sysfs" ino=12345
     scontext=u:r:devicestatusd:s0
     tcontext=u:object_r:sysfs:s0 tclass=file permissive=0
```

- `scontext` — ai bị từ chối (dịch vụ của bạn)
- `tcontext` — họ chạm vào cái gì (một file sysfs chưa được gán nhãn)
- `tclass` + `{ read }` — thao tác nào

**Hai cảnh báo về `audit2allow`.** Nó cho bạn điểm khởi đầu, không phải câu trả lời — nó sẽ vui
vẻ đề xuất những luật rộng như `allow devicestatusd sysfs:file rw_file_perms`, thứ cấp quyền
truy cập toàn bộ sysfs. Hãy thu hẹp về đúng kiểu cụ thể. Và khi đích là `sysfs` chung chung,
cách sửa đúng thường là **gán nhãn cho chính file đó** trong `genfs_contexts` chứ không phải
mở rộng quyền:

```
genfscon sysfs /devices/virtual/thermal/thermal_zone0/temp u:object_r:sysfs_thermal:s0
```

Cuối cùng: `setenforce 0` là công cụ phát triển. Hãy kiểm thử sản phẩm hoàn chỉnh trên bản
build `user` với SELinux ở chế độ enforcing, vì đó là thứ xuất xưởng và những lỗi chỉ xuất
hiện khi enforcing là có thật.

## 6. Phía framework

Ứng dụng không nên gọi thẳng giao diện Binder. Hãy bọc nó lại:

```java
package android.acme;

@SystemService(Context.DEVICE_STATUS_SERVICE)
public class DeviceStatusManager {
    private final IDeviceStatus mService;

    public int getBoardTemperature() {
        try {
            return mService.getBoardTemperature();
        } catch (RemoteException e) {
            throw e.rethrowFromSystemServer();
        }
    }

    @RequiresPermission(android.Manifest.permission.MANAGE_DEVICE_STATUS)
    public void setFanSpeed(int percent) {
        try {
            mService.setFanSpeed(percent);
        } catch (RemoteException e) {
            throw e.rethrowFromSystemServer();
        }
    }
}
```

Đăng ký nó trong `SystemServiceRegistry.java`:

```java
registerService(Context.DEVICE_STATUS_SERVICE, DeviceStatusManager.class,
    new CachedServiceFetcher<DeviceStatusManager>() {
        @Override
        public DeviceStatusManager createService(ContextImpl ctx) {
            IBinder b = ServiceManager.getServiceOrThrow(Context.DEVICE_STATUS_SERVICE);
            return new DeviceStatusManager(ctx, IDeviceStatus.Stub.asInterface(b));
        }
    });
```

`rethrowFromSystemServer()` là quy ước của nền tảng: nếu system server đã chết thì ứng dụng
cũng nên chết theo, thay vì tiếp tục chạy với một hình dung sai lệch về thế giới.

## 7. Quyền

`frameworks/base/core/res/AndroidManifest.xml`:

```xml
<permission android:name="android.permission.MANAGE_DEVICE_STATUS"
            android:protectionLevel="signature|privileged" />
```

`signature|privileged` nghĩa là chỉ ứng dụng ký bằng khoá nền tảng, hoặc ứng dụng đặc quyền
nằm trong `/system/priv-app`, mới được giữ quyền này. Với một tính năng nền tảng điều khiển
phần cứng thì đó là mức đúng — `dangerous` sẽ đưa nó ra trước mặt người dùng dưới dạng hộp
thoại xin quyền lúc chạy, điều không phù hợp với thứ mà không ứng dụng thường nào nên có.

Ứng dụng đặc quyền còn cần một mục trong `/etc/permissions/privapp-permissions-*.xml`, nếu
không thiết bị sẽ từ chối khởi động kèm lỗi "privapp permissions violation" — một trải nghiệm
đầu tiên gây giật mình, và là một lưới an toàn có chủ đích.

## Khi nó không chạy

Theo thứ tự sau, vì thứ tự này tiết kiệm nhiều thời gian nhất:

```bash
# file nhị phân có trên thiết bị không?
adb shell ls -lZ /vendor/bin/devicestatusd    # -Z hiển thị cả nhãn SELinux

# init đã khởi động nó chưa? nó có đang crash lặp không?
adb shell getprop | grep init.svc.devicestatusd

# nó đã đăng ký chưa?
adb shell service list | grep devicestatus

# SELinux đang nói gì?
adb shell dmesg | grep avc | grep devicestatus

# nó ghi log gì?
adb logcat -s devicestatusd
```

Chín trên mười lần câu trả lời nằm trong một trong năm lệnh đó, và nguyên nhân đơn lẻ phổ biến
nhất là SELinux — hoặc dịch vụ không đăng ký được, hoặc client không tìm thấy nó.

## Tự kiểm tra

1. Vì sao phép kiểm tra quyền phải nằm trong dịch vụ chứ không phải trong lớp manager?
2. Bốn thành phần SELinux riêng biệt mà một dịch vụ mới cần là gì?
3. Vì sao gán nhãn cho một file sysfs cụ thể tốt hơn thứ `audit2allow` đề xuất?
4. `rethrowFromSystemServer` diễn đạt điều gì?

## Tiếp theo

Bài cuối là vòng lặp hằng ngày: build tăng dần mất một phút thay vì hai giờ, `adb sync` và
remount, đọc logcat và dumpsys cho đúng, Perfetto, giải mã tombstone, và gỡ lỗi mã native trên
thiết bị.
