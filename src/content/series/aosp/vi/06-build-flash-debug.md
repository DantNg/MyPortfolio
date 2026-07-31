---
lesson: 6
lang: vi
title: "Vòng lặp build, nạp và gỡ lỗi"
description: "Biến chu kỳ hai giờ thành một phút: build tăng dần, adb sync và remount, đọc logcat và dumpsys cho đúng, Perfetto, giải mã tombstone, và gỡ lỗi mã native trên thiết bị."
duration: "17 phút"
tags: ["AOSP", "Gỡ lỗi", "adb"]
---

## Vòng lặp chính là công việc

Bạn sẽ sửa một file hàng nghìn lần. Nếu mỗi vòng lặp tốn một lần build đầy đủ và một lần nạp
đầy đủ, đó là mười lăm phút cho mỗi thay đổi và một ngày của bạn chứa khoảng ba mươi lần thử.
Đưa nó về một phút và ngày đó chứa bốn trăm lần.

Bài này là tập hợp những kỹ thuật cụ thể tạo ra khác biệt đó. Không cái nào riêng lẻ là thông
minh; gộp lại chúng là khác biệt giữa việc làm nền tảng dễ chịu và việc làm nền tảng khổ sở.

## Chỉ build phần thay đổi

```bash
source build/envsetup.sh
lunch aosp_arm64-trunk_staging-userdebug

m my_service              # một module theo tên
mm                        # mọi module trong thư mục hiện tại
mmm frameworks/base/services/core    # module trong thư mục chỉ định
```

Hai cờ đáng biết:

```bash
m -j$(nproc) my_service                  # khớp số nhân của bạn
m --skip-soong-tests my_service          # bỏ qua các đích kiểm thử
```

Phần lớn thời gian trong một lần build tăng dần nhỏ là **metabuild** — Kati và Soong sinh lại
các file Ninja. Nó chạy mỗi khi một file build thay đổi, và không có cách nào né trừ việc đừng
đụng vào file build. Chỉ sửa `.cpp` và `.java` giúp bạn ở lại đường nhanh.

## Đẩy file thay vì nạp lại toàn bộ

Nạp toàn bộ dành cho thay đổi bố cục phân vùng, thay đổi nhân, và bất cứ thứ gì trong chuỗi
khởi động. Với mọi thứ còn lại, hãy đẩy file:

```bash
adb root
adb remount               # cho phép ghi vào /system và /vendor
adb push $OUT/vendor/bin/devicestatusd /vendor/bin/
adb shell stop devicestatusd && adb shell start devicestatusd
```

`adb remount` cần `adb root`, thứ cần bản build `userdebug` hoặc `eng`, và trên thiết bị có
verified boot bạn còn cần chạy `adb disable-verity` một lần rồi khởi động lại.

Tốt hơn là đẩy từng file:

```bash
adb sync                  # đồng bộ mọi thứ khác biệt trong $OUT. Mất vài giây.
adb sync vendor           # chỉ /vendor
```

`adb sync` so sánh và chỉ chép phần thay đổi. Với việc làm framework:

```bash
m services                # build jar dịch vụ framework
adb sync system
adb shell stop && adb shell start          # khởi động lại framework, không phải máy
```

`stop` / `start` khởi động lại `system_server` và mọi thứ phía trên nó trong khoảng mười giây.
So với hai phút khởi động lại máy, đó là mẹo cho lợi ích cao nhất trong bài này.

Với một ứng dụng:

```bash
m MyApp && adb install -r $OUT/system/app/MyApp/MyApp.apk
```

Khi nào mới thật sự cần nạp lại toàn bộ:

```bash
adb reboot bootloader
fastboot flashall -w              # -w xoá userdata
fastboot flash vendor $OUT/vendor.img    # hoặc chỉ một phân vùng
```

## logcat, cho đúng cách

```bash
adb logcat -b all                        # main + system + crash + events + kernel
adb logcat -s MyTag:D                    # chỉ tag này, mức debug trở lên
adb logcat *:E                           # lỗi trở lên, mọi thứ
adb logcat --pid=$(adb shell pidof devicestatusd)
adb logcat -b crash                      # chỉ các lần crash
adb logcat -v threadtime,color           # dấu thời gian + tid, có màu
adb logcat -c                            # xoá sạch, trước khi tái hiện lỗi
adb logcat -d > log.txt                  # kết xuất rồi thoát
```

Các bộ đệm đáng biết riêng rẽ: `main` cho ứng dụng, `system` cho framework, `crash` cho các
lần crash, `events` cho sự kiện hệ thống có cấu trúc (đây là nơi `boot_progress` và bản ghi
ANR nằm), và `kernel` cho dmesg.

Hai thói quen:

```bash
adb logcat -c && adb logcat -b all > bug.txt      # xoá, tái hiện, thu thập
```

và, trong mã của chính bạn, một tag nhất quán cho mỗi thành phần:

```cpp
#define LOG_TAG "DeviceStatus"
#include <log/log.h>
ALOGI("nhiet do=%d", temp);
ALOGE("doc that bai: %s", strerror(errno));
```

## dumpsys

Mọi dịch vụ hệ thống đều cài đặt một phương thức dump. Đây là giao diện tự soi của Android và
nó bị dùng ít hơn hẳn mức đáng có.

```bash
adb shell dumpsys                    # tất cả. Khổng lồ. Hãy chuyển hướng ra file.
adb shell dumpsys -l                 # liệt kê các dịch vụ dump được

adb shell dumpsys activity activities     # ngăn xếp activity
adb shell dumpsys window windows          # bố cục cửa sổ, tiêu điểm, thứ tự z
adb shell dumpsys package com.example     # quyền, chữ ký, thành phần
adb shell dumpsys battery                 # và: set level 50, unplug, reset
adb shell dumpsys meminfo <pid>           # phân tích bộ nhớ chi tiết
adb shell dumpsys gfxinfo <pkg> framestats  # thời gian dựng hình từng khung
adb shell dumpsys SurfaceFlinger          # lớp, ghép hình, tần số làm tươi
```

Hãy cài đặt nó cho dịch vụ của chính bạn. Mười phút làm việc, và nó biến dịch vụ của bạn từ
mờ đục thành soi được, cho mọi người chạm vào nó sau này:

```cpp
binder_status_t dump(int fd, const char** /*args*/, uint32_t /*n*/) override {
    dprintf(fd, "DeviceStatus:\n");
    dprintf(fd, "  temperature: %d\n", readTemp());
    dprintf(fd, "  fan: %d%%\n", mFanPercent);
    dprintf(fd, "  listeners: %zu\n", mListeners.size());
    dprintf(fd, "  errors since boot: %d\n", mErrorCount);
    return STATUS_OK;
}
```

## Crash và tombstone

Một lần crash native sẽ ghi ra một tombstone:

```bash
adb shell ls /data/tombstones/
adb shell cat /data/tombstones/tombstone_00
adb logcat -b crash
```

Đầu ra là các địa chỉ thô. Để đọc được:

```bash
export ANDROID_PRODUCT_OUT=$OUT
development/scripts/stack < tombstone_00
```

`stack` phân giải địa chỉ thành file và số dòng bằng `out/target/product/<board>/symbols/` —
đó là lý do bài 1 dặn phải giữ thư mục đó cho mọi bản build bạn nạp. Không có symbol khớp,
tombstone chỉ là một danh sách số hex.

Đọc một tombstone:

```
signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0
```

- **SIGSEGV / addr 0x0** — truy cập con trỏ null.
- **SIGSEGV / địa chỉ nhỏ** — độ lệch tính từ con trỏ null, thường là truy cập thành viên trên
  một `this` bằng null.
- **SIGABRT** — một assertion, một `CHECK` thất bại, hoặc một ngoại lệ C++ không bắt. Dòng
  thông báo abort ngay trên backtrace thường nêu chính xác nguyên nhân.
- **SIGBUS** — lệch canh biên hoặc một vùng mmap bị cắt cụt.

Với Java, một ANR ghi ra `/data/anr/traces.txt` kèm kết xuất luồng đầy đủ của mọi tiến trình.
Luồng đầu tiên được liệt kê của tiến trình bị ANR chính là luồng bị kẹt; hãy đi theo thứ nó
đang bị chặn bởi.

## Theo vết với Perfetto

Khi có gì đó chậm chứ không phải hỏng, theo vết là công cụ đúng.

```bash
adb shell perfetto -o /data/misc/perfetto-traces/trace \
    -t 10s sched freq idle am wm gfx view binder_driver

adb pull /data/misc/perfetto-traces/trace
# mở tại ui.perfetto.dev
```

Danh mục `binder_driver` chính là thứ cả series này hướng tới. Nó hiển thị mọi giao dịch dưới
dạng một lát cắt kèm thời lượng và cả hai đầu, nên "giao diện đơ 400 ms" trở thành "luồng giao
diện bị chặn trong một lời gọi Binder tới `PackageManagerService` suốt 380 ms", một phát biểu
hành động được.

Hãy thêm điểm theo vết của riêng bạn:

```cpp
#define ATRACE_TAG ATRACE_TAG_HAL
#include <utils/Trace.h>

void DeviceStatus::readSensors() {
    ATRACE_CALL();                       // theo phạm vi, đặt tên theo hàm
    ATRACE_BEGIN("i2c_read");
    // ...
    ATRACE_END();
}
```

```java
Trace.beginSection("loadConfig");
try { loadConfig(); } finally { Trace.endSection(); }
```

## Gỡ lỗi mã native trên thiết bị

```bash
# gắn lldb qua adb
adb forward tcp:5039 tcp:5039
adb shell lldb-server platform --listen "*:5039" --server &
lldb
(lldb) platform select remote-android
(lldb) platform connect connect://localhost:5039
(lldb) attach --pid $(adb shell pidof devicestatusd)
```

Cần bản build `userdebug` và symbol khớp. Thực tế phần lớn việc gỡ lỗi nền tảng được làm bằng
log và trace hơn là bằng trình gỡ lỗi — mã chạy song song rất nhiều và việc dừng một tiến
trình thường làm thay đổi chính hành vi bạn đang truy — nhưng với một lần crash tái hiện được
trong dịch vụ của bạn, trình gỡ lỗi vẫn là đường nhanh nhất.

Những công cụ nhẹ hơn mà bạn sẽ dùng thường xuyên hơn:

```bash
adb shell debuggerd -b <pid>          # backtrace native mọi luồng, không cần trình gỡ lỗi
adb shell kill -3 <pid>               # kết xuất luồng Java cho tiến trình JVM
adb shell strace -p <pid> -f          # lời gọi hệ thống, nếu strace có trong bản build
adb shell simpleperf record -p <pid> -g --duration 10   # profiler lấy mẫu
```

`debuggerd -b` đáng được nhấn mạnh: backtrace native đầy đủ của một tiến trình đang chạy,
không cần cài đặt gì, không cần trình gỡ lỗi, không phải dừng tiến trình. Với câu hỏi "cái này
đang làm gì ngay lúc này" thì đó là lệnh đầu tiên nên với tới.

## Một thiết lập làm việc

```bash
# ~/.bashrc
export USE_CCACHE=1
export CCACHE_DIR=/mnt/fast/ccache

aosp() {
    cd ~/aosp && source build/envsetup.sh && lunch aosp_arm64-trunk_staging-userdebug
}

# build, đẩy, khởi động lại, theo dõi — cả vòng lặp trong một lệnh
reload() {
    m "$1" && adb root && adb remount && adb sync vendor \
        && adb shell stop "$1" && adb shell start "$1" \
        && adb logcat -c && adb logcat -s "$1"
}
```

Bất cứ thứ gì bạn gõ hơn năm lần một ngày đều thuộc về một hàm như thế. Vấn đề không phải là
số phím bấm — mà là một vòng lặp ngắn thay đổi cách bạn làm việc. Khi thử một thứ tốn mười
giây, bạn thí nghiệm; khi nó tốn mười lăm phút, bạn suy đoán, và suy đoán thì kém chính xác
hơn nhiều.

## Chỗ này để lại cho bạn những gì

Sáu bài: cây mã nguồn và hệ thống build của nó, chuỗi khởi động, ranh giới Treble và cách viết
một HAL, Binder đủ sâu để gỡ lỗi, một dịch vụ hệ thống hoàn chỉnh kèm chính sách SELinux canh
cổng nó, và một vòng lặp phát triển đủ ngắn để làm việc được.

Đó là tầng bên dưới ứng dụng — phần không có hướng dẫn nào, nơi tài liệu chính là mã nguồn, và
nơi biết *chỗ để nhìn* đã là phần lớn kỹ năng. Cây mã nguồn thì khổng lồ, và nó cũng chỉ là
C++, Java và file build do những con người đang giải những loại bài toán giống bạn viết ra.

## Tự kiểm tra

1. Vì sao `adb shell stop && adb shell start` hơn hẳn khởi động lại máy khi làm framework?
2. `adb sync` làm được điều gì mà `adb push` không?
3. Vì sao cần `out/.../symbols/` để đọc một tombstone?
4. Danh mục `binder_driver` của Perfetto cho bạn thấy điều gì mà logcat không thể?
