---
lesson: 2
lang: vi
title: "Luồng khởi động, từ đầu đến cuối"
description: "Từ bootloader tới nhân tới init tới Zygote tới system_server, ngôn ngữ .rc thực sự làm gì, vì sao Zygote fork thay vì khởi động mới, và cách tìm ra thiết bị chết ở giai đoạn nào."
duration: "16 phút"
tags: ["AOSP", "init", "Khởi động"]
---

## Vì sao đây là thứ hữu ích nhất cần biết

Một thiết bị không khởi động được gần như không cho bạn thông tin nào, trừ khi bạn biết lẽ ra
điều gì phải xảy ra. Hãy học thuộc chuỗi này và mọi thất bại bring-up trở thành "nó chết giữa
giai đoạn 4 và giai đoạn 5", một phát biểu gỡ lỗi được.

Cả chuỗi, kèm thời gian đại khái trên một thiết bị tầm trung:

```
Boot ROM         → mask ROM của SoC, xác minh bootloader          ~10 ms
Bootloader       → U-Boot / LK / ABL, nạp boot.img                ~500 ms
Nhân             → driver, mount, bàn giao cho init               ~2 s
init (chặng 1)   → mount /system, /vendor, chuyển root            ~200 ms
init (chặng 2)   → phân tích file .rc, khởi động dịch vụ          ~1 s
Zygote           → nạp trước lớp và tài nguyên                    ~2 s
system_server    → khởi động ~80 dịch vụ hệ thống                 ~4 s
SystemUI / Home  → khung hình đầu tiên lên màn hình               ~2 s
                                                                  -------
                                                                  ~12 s
```

![Chuỗi khởi động Android](/MyPortfolio/images/aosp/boot-flow.svg)

## Bootloader và boot.img

Bootloader xác minh và nạp `boot.img`, thứ chứa nhân và ramdisk. Trên thiết bị có **AVB
(Android Verified Boot)**, nó kiểm tra chữ ký dựa vào `vbmeta.img` trước, và không khớp là
dừng khởi động — đó là lý do một `system.img` bị sửa tay tạo ra thiết bị không lên được cho
tới khi bạn tắt xác minh hoặc ký lại.

Thiết bị hiện đại dùng **phân vùng A/B**: hai bản sao đầy đủ của hệ thống, nên một bản OTA ghi
vào khe không hoạt động rồi khởi động lại vào đó. Nếu nó không tự đánh dấu thành công,
bootloader quay về khe cũ. Rất tốt cho cập nhật ngoài thực địa, và là nguồn gây bối rối trong
lúc phát triển khi bạn nạp khe A còn thiết bị khởi động khe B.

```bash
fastboot getvar current-slot
fastboot set_active a
```

## Từ nhân tới init

Nhân làm những gì mọi nhân Linux làm — dựng driver, mount ramdisk ban đầu — rồi thực thi
`/init` với PID 1. init của Android không phải systemd, không phải SysV. Nó là một PID 1
chuyên dụng đọc các file `.rc`.

**init chặng một** chạy từ ramdisk. Việc của nó nhỏ gọn: mount `/system`, `/vendor` và `/odm`
(theo fstab trong cây thiết bị), thiết lập dm-verity, rồi `switch_root` vào `/system` và tự
thực thi lại thành chặng hai.

**init chặng hai** phân tích tất cả file `.rc`, đặt các thuộc tính, tạo dịch vụ property, và
khởi động các dịch vụ.

```bash
# các file .rc đến từ đâu, theo thứ tự phân tích
/system/etc/init/hw/init.rc          # file chính
/system/etc/init/*.rc                # dịch vụ framework
/vendor/etc/init/*.rc                # HAL và dịch vụ của bạn
/odm/etc/init/*.rc
```

Chú ý bố cục hiện đại: dịch vụ không còn nối thêm vào một file lớn nữa. **File `.rc` của dịch
vụ nằm cạnh file nhị phân của nó và được cài cùng với nó**, thông qua `init_rc:` trong
`Android.bp`. Đây là cơ chế bạn sẽ dùng ở bài 5.

## Ngôn ngữ .rc

Hai cấu trúc, và gần như chỉ có thế.

**Action** — chạy lệnh khi một trigger kích hoạt:

```
on early-init
    mkdir /mnt 0775 root system

on boot
    chown system system /sys/class/leds/red/brightness
    write /proc/sys/kernel/sched_latency_ns 10000000

on property:sys.boot_completed=1
    start my_late_service
```

Trigger là các giai đoạn khởi động (`early-init`, `init`, `late-init`, `post-fs`,
`post-fs-data`, `boot`) hoặc thay đổi thuộc tính. `post-fs-data` là mốc quan trọng cho mọi
thứ cần `/data` — trước nó, `/data` chưa được mount, và một dịch vụ ghi vào đó sẽ thất bại một
cách khó hiểu.

**Service** — tiến trình chạy dài do init quản lý:

```
service my_service /vendor/bin/my_service
    class main
    user system
    group system inet
    capabilities NET_ADMIN
    priority -10
    oneshot                   # không khởi động lại khi nó thoát
    disabled                  # không tự khởi động
    seclabel u:r:my_service:s0
```

Những tuỳ chọn quan trọng nhất:

- **`class`** — dịch vụ khởi động theo thứ tự lớp, và `start class_main` khởi động cả nhóm.
- **`user` / `group`** — đừng bao giờ dùng `root` trừ khi bạn biện minh được. Đây là tuyến
  phòng thủ đầu tiên và người rà soát sẽ hỏi.
- **`disabled`** — khởi động tường minh sau bằng `start my_service`, hoặc từ một trigger thuộc
  tính.
- **`oneshot`** — không có nó, init khởi động lại tiến trình mỗi lần nó thoát. Một dịch vụ hay
  crash mà không có `oneshot` tạo ra vòng lặp khởi động lại vô hạn, và sau đủ số lần init sẽ
  khởi động lại máy vào recovery. Đó chính là lỗi "máy tôi bị bootloop".

## Thuộc tính

Kho khoá–giá trị toàn cục của Android, mọi thứ đọc được và là trung tâm của cách nền tảng được
cấu hình:

```bash
getprop ro.build.version.sdk        # ro.* = chỉ đọc, đặt một lần lúc khởi động
getprop | grep vendor.acme          # mọi thứ khớp mẫu
setprop debug.my.feature 1          # persist.* sống sót qua khởi động lại
```

Tiền tố mang ý nghĩa: `ro.` bất biến sau khi khởi động, `persist.` được ghi vào
`/data/property` và sống sót qua reboot, `debug.` theo quy ước dành cho phát triển, `vendor.`
là không gian tên cho phân vùng vendor. SELinux kiểm soát ai được đặt cái gì — một `setprop`
bị từ chối thất bại trong im lặng, điều đáng nhớ khi một thuộc tính nhất định không chịu đổi.

## Zygote: vì sao fork thay vì exec

```
service zygote /system/bin/app_process64 -Xzygote /system/bin --zygote --start-system-server
    class main
    priority -20
    socket zygote stream 660 root system
```

Zygote khởi động runtime ART một lần, nạp trước khoảng 2000 lớp framework cùng kho tài nguyên
dùng chung, rồi **ngồi chờ trên một socket**. Mỗi lần mở ứng dụng là một lệnh `fork()` từ
Zygote.

Lý do là bộ nhớ. Sau khi fork, cha và con dùng chung mọi lớp và tài nguyên đã nạp trước thông
qua copy-on-write. Năm mươi ứng dụng đang chạy dùng chung một bản framework thay vì giữ năm
mươi bản. Khởi động mỗi ứng dụng bằng một runtime mới sẽ tốn hàng trăm megabyte và cộng thêm
hàng trăm mili-giây cho mỗi lần mở.

Hai hệ quả bạn sẽ gặp trong thực tế:

- **Bất cứ thứ gì Zygote nạp trước đều có mặt trong mọi tiến trình.** Thêm một lớp vào danh
  sách nạp trước là tốn bộ nhớ ở tất cả chúng; đó là lý do danh sách đó được canh gác.
- **Zygote crash là khởi động lại toàn bộ framework** — mọi ứng dụng chết và thiết bị trông
  như khởi động lại mà thực ra không. Đây là "soft reboot" hay "framework restart", và nhận ra
  nó giúp bạn khỏi đi truy một lỗi nhân không hề tồn tại.

## system_server

Lần fork đầu tiên của Zygote là `system_server`, và đó là nơi Android thực sự sống: khoảng tám
mươi dịch vụ trong một tiến trình, khởi động theo thứ tự cố định trong `SystemServer.java`.

```
Bootstrap:  ActivityManagerService, PowerManagerService, PackageManagerService,
            DisplayManagerService
Core:       BatteryService, UsageStatsService
Other:      WindowManagerService, InputManagerService, ConnectivityService,
            AudioService, CameraService, và ~70 dịch vụ nữa
```

Hai sự thật đáng thấm:

**Chúng nằm trong một tiến trình.** Một ngoại lệ chí mạng ở bất kỳ dịch vụ nào cũng giết
`system_server`, tức giết framework, tức khởi động lại mọi thứ. Đó là lý do mã dịch vụ hệ
thống phòng thủ tới mức trông có vẻ hoang tưởng.

**Thứ tự là một đồ thị phụ thuộc.** Một dịch vụ chạm vào `PackageManagerService` trước khi nó
tồn tại sẽ nhận về null. Khi bạn thêm dịch vụ của mình (bài 5), đặt nó ở đâu trong danh sách
đó là một quyết định thật sự.

Bước cuối: `ActivityManagerService.systemReady()` đặt `sys.boot_completed=1`, khởi chạy
activity Home, và phát broadcast `BOOT_COMPLETED`.

## Tìm ra nó chết ở đâu

Kỹ năng gỡ lỗi hữu ích nhất trong cả series này.

**Hãy có một cổng console.** Một cổng UART đáng với mọi công sức đi dây — nó cho thấy đầu ra
của bootloader và nhân mà `adb` không bao giờ chạm tới được, vì `adb` cần một ngăn xếp USB đã
khởi động xong.

**Rồi đi xuống theo chuỗi:**

```bash
# 1. Bootloader có thấy thiết bị không?
fastboot devices

# 2. Thông điệp nhân — có panic không, mount có hỏng không?
adb shell dmesg | tail -50
cat /proc/last_kmsg              # hoặc /sys/fs/pstore/console-ramoops sau một lần crash

# 3. init có khởi động dịch vụ của bạn không?
adb shell getprop | grep init.svc     # mọi dịch vụ và trạng thái của nó
# running / stopped / restarting  — "restarting" nghĩa là nó cứ crash

# 4. Chuyện gì xảy ra ở userspace?
adb logcat -b all
adb logcat -b crash                   # chỉ các lần crash

# 5. Mỗi giai đoạn mất bao lâu?
adb shell dmesg | grep -i "boot_progress"
```

`getprop | grep init.svc` là lệnh đơn nhanh nhất cho câu hỏi "vì sao thứ của tôi không chạy".
Nó liệt kê mọi dịch vụ init biết và trạng thái hiện tại, và `restarting` nói ngay rằng tiến
trình đang crash chứ không phải chưa từng được khởi động.

Riêng về thời gian khởi động:

```bash
adb logcat -b events | grep boot_progress
# boot_progress_start, _preload_start, _system_run, _pms_ready, _enable_screen
```

Khoảng cách giữa hai mốc liên tiếp chính là giai đoạn đang chậm. Đó là cách công việc tối ưu
thời gian khởi động thực sự bắt đầu — chứ không phải bằng cách đoán xem nên hoãn dịch vụ nào.

## Tự kiểm tra

1. init chặng một làm gì mà chặng hai không làm?
2. Vì sao một dịch vụ không có `oneshot` có nguy cơ làm thiết bị bootloop?
3. Vì sao Zygote fork thay vì khởi động một runtime mới cho mỗi ứng dụng?
4. Lệnh đơn nào cho bạn biết init đã khởi động dịch vụ của bạn chưa và nó có đang crash không?

## Tiếp theo

Bạn đã thấy `/vendor` xuất hiện nhiều lần. Bài 3 giải thích vì sao nó tồn tại: Project Treble,
sự tách vendor khỏi system, VNDK, và bước chuyển từ HIDL sang AIDL định hình cách viết HAL
ngày nay.
