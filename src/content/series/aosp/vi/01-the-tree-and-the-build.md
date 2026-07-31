---
lesson: 1
lang: vi
title: "Cây mã nguồn và hệ thống build"
description: "repo và manifest thực sự làm gì, cách di chuyển trong 200 GB mã nguồn, Soong so với Make, lunch thực sự thiết lập cái gì, và cuối cùng out/ cho ra những gì."
duration: "16 phút"
tags: ["AOSP", "Soong", "Build"]
---

## Bạn đang bước vào cái gì

AOSP nặng khoảng 200 GB sau khi checkout, 400 GB sau khi build, và lần build đầy đủ đầu tiên
mất một tới bốn giờ trên một máy khá. Nó chứa khoảng 2500 kho git. Không có phiên bản nào của
việc này là nhỏ cả.

Nếu bạn tới từ mảng firmware, điều cần điều chỉnh trong đầu là: **AOSP không phải một dự án,
nó là một bản phân phối.** Nó gần với một distro Linux hơn là gần một ứng dụng — một nhân, một
libc, một runtime, vài nghìn gói, và một hệ thống build lắp chúng thành các ảnh phân vùng.
Không ai hiểu hết toàn bộ. Bạn cần hiểu những phần bạn động vào và biết cách tìm phần còn lại.

## repo và manifest

`repo` là một lớp bọc Python trên git, quản lý 2500 kho đó như một khối thống nhất.

```bash
mkdir aosp && cd aosp
repo init -u https://android.googlesource.com/platform/manifest -b android-15.0.0_r1
repo sync -c -j8 --no-tags --no-clone-bundle
```

- `-b` là nhánh hoặc tag. **Luôn ghim một cái.** Sync `main` cho bạn bất cứ thứ gì vừa được
  đẩy lên sáng hôm đó, không phải nền tảng bạn muốn dựng sản phẩm lên.
- `-c` chỉ lấy nhánh hiện tại. Không có nó bạn lấy toàn bộ lịch sử của 2500 kho.
- `-j8` là số việc song song. Nhiều hơn không phải lúc nào cũng nhanh hơn; bạn sẽ bị giới hạn
  bởi mạng.

Manifest là một file XML duy nhất liệt kê mọi kho và vị trí của nó trong cây:

```xml
<project path="frameworks/base" name="platform/frameworks/base" />
<project path="system/core"     name="platform/system/core" />
```

Đây là cơ chế bạn sẽ dùng cho phần cứng của mình. Một manifest cục bộ ở
`.repo/local_manifests/my_device.xml` thêm các kho của bạn vào lần sync mà không phải sửa
manifest của Google:

```xml
<manifest>
  <project path="device/acme/board1" name="acme/board1" remote="acme" revision="main" />
  <remove-project name="platform/packages/apps/Browser2" />
</manifest>
```

`repo sync` sau đó sẽ kéo cây thiết bị của bạn về cùng với mọi thứ khác. Mọi hãng phần cứng và
mọi bản ROM tuỳ biến đều làm như vậy.

Các lệnh hữu ích hằng ngày:

```bash
repo status                          # tôi đã sửa gì, trên tất cả các kho
repo forall -c 'git checkout .'      # chạy một lệnh trong mọi kho
repo start mywork platform/frameworks/base    # tạo nhánh trong một kho
repo diff                            # diff gộp
```

## Di chuyển trong 200 GB

Những thư mục bạn thực sự dành thời gian ở đó:

| Đường dẫn | Có gì trong đó |
|---|---|
| `frameworks/base/` | framework Java, `system_server`, hầu hết dịch vụ hệ thống |
| `frameworks/native/` | dịch vụ native — SurfaceFlinger, libbinder, input |
| `system/core/` | init, logd, libcutils, adb — tầng đáy của userspace |
| `hardware/interfaces/` | định nghĩa HAL bằng AIDL/HIDL |
| `hardware/<vendor>/` | cài đặt HAL của hãng |
| `device/<vendor>/<board>/` | **cấu hình board của bạn — nơi bạn làm việc** |
| `packages/apps/` | ứng dụng đi kèm: Settings, Launcher, Camera |
| `build/soong/`, `build/make/` | chính hệ thống build |
| `external/` | mã của bên thứ ba — libpng, sqlite, khoảng 1000 thứ nữa |
| `out/` | mọi thứ được sinh ra. Đừng sửa; xoá thoải mái |

**Hãy học cách tìm, đừng học cách duyệt.** Cây quá lớn để đọc. Ba công cụ, theo thứ tự tần
suất bạn sẽ cần:

```bash
# ripgrep: nhanh nhất, đáng cài
rg "startService" frameworks/base/services/

# các trợ thủ có sẵn sau khi chạy envsetup.sh
cgrep  "binder_thread_read"     # chỉ C/C++
jgrep  "PackageManagerService"  # chỉ Java
mgrep  "TARGET_BOARD"           # chỉ file build
godir  ActivityManagerService   # nhảy tới file theo tên
```

Và để đọc chứ không phải grep, hãy dùng trang tra cứu mã nguồn — `cs.android.com` — nó liên
kết chéo định nghĩa và nơi gọi trên toàn cây. Nó nhanh hơn mọi chỉ mục IDE cục bộ với một mã
nguồn cỡ này.

## Soong, Make và hai loại file

AOSP đã chuyển từ Make sang **Soong**, thứ đọc các file `Android.bp`. File Blueprint mang tính
khai báo — không có điều kiện, không vòng lặp, không shell:

```
cc_binary {
    name: "my_service",
    srcs: ["main.cpp", "service.cpp"],
    shared_libs: ["libbinder", "libutils", "liblog"],
    static_libs: ["libmystuff"],
    init_rc: ["my_service.rc"],
    vendor: true,              // cài vào /vendor, không phải /system
    cflags: ["-Wall", "-Werror"],
}
```

Các loại module thường gặp:

- `cc_binary`, `cc_library_shared`, `cc_library_static`, `cc_test` — mã native
- `java_library`, `android_app` — Java/Kotlin
- `aidl_interface` — sinh stub client và server từ file `.aidl` (bài 5)
- `prebuilt_etc` — đặt một file cấu hình vào ảnh

Các phần cũ trong cây vẫn dùng `Android.mk`, tức Make, và Make thì cho phép điều kiện. Mã mới
nên dùng `.bp`. Khi bạn cần logic mà Blueprint không diễn đạt được, lối thoát là một `genrule`
hoặc một phần mở rộng viết bằng Go, chứ không phải quay lại Make.

Cấu hình sản phẩm vẫn dựa trên Makefile, nằm trong `device/<vendor>/<board>/`:

```makefile
# device.mk
PRODUCT_PACKAGES += my_service MyApp
PRODUCT_COPY_FILES += device/acme/board1/init.board1.rc:$(TARGET_COPY_OUT_VENDOR)/etc/init/init.board1.rc
PRODUCT_PROPERTY_OVERRIDES += ro.acme.variant=pro
```

**`PRODUCT_PACKAGES` là dòng khiến ai cũng vấp.** Một module có thể build hoàn hảo mà vẫn
không xuất hiện trên thiết bị, vì không có gì yêu cầu cài nó. Nếu file nhị phân của bạn không
có trong ảnh, hãy kiểm tra dòng này trước — đó là câu trả lời nhiều hơn là không.

![Build AOSP, từ mã nguồn tới các ảnh phân vùng](/MyPortfolio/images/aosp/build-system.svg)

## lunch, và nó thực sự thiết lập cái gì

```bash
source build/envsetup.sh
lunch aosp_arm64-trunk_staging-userdebug
```

Tên đích đó có ba phần:

- **`aosp_arm64`** — sản phẩm. Cấu hình thiết bị nào, gói nào, kiến trúc nào.
- **`trunk_staging`** — cấu hình phát hành (AOSP mới). Những cờ tính năng nào đang bật.
- **`userdebug`** — biến thể, và là phần quan trọng hằng ngày:

| Biến thể | Root qua adb | Gỡ lỗi được | Dùng cho |
|---|---|---|---|
| `eng` | có | mọi thứ | giai đoạn bring-up đầu |
| `userdebug` | có (`adb root`) | hầu hết | **phát triển và QA** |
| `user` | không | không | bản xuất xưởng |

Chín mươi phần trăm việc phát triển diễn ra trên `userdebug`. Trên bản `user`, `adb root` thất
bại, nhiều đầu ra `dumpsys` bị cắt bớt, và SELinux ở chế độ enforcing không có đường lùi
permissive — chính vì thế bạn phải kiểm thử trên `user` trước khi xuất xưởng. Có khá nhiều lỗi
chỉ tồn tại ở đó.

`envsetup.sh` còn cho bạn những lệnh sẽ dùng liên tục:

```bash
m                      # build tất cả
m my_service           # build một module
mm                     # build các module trong thư mục hiện tại
mmm path/to/dir        # build các module trong thư mục đó
croot                  # về gốc cây mã nguồn
hmm                    # liệt kê tất cả những lệnh này
```

## Bản thân việc build

```bash
m -j$(nproc)
```

Kati chuyển đổi các Makefile, Soong đọc các Blueprint, cả hai sinh ra file Ninja; Ninja mới
làm việc thực sự. Đó là lý do những phút đầu của một lần build in ra "Starting Kati" và
"Starting Soong" trước khi có gì được biên dịch — đó là phần metabuild, và nó chạy lại mỗi khi
một file build thay đổi.

Con số thực tế: **build đầu 1–4 giờ; build tăng dần một module, 1–3 phút.** Phần lớn thời gian
tăng dần đó là metabuild, không phải phần biên dịch của bạn.

Tăng tốc, theo thứ tự lợi ích:

```bash
export USE_CCACHE=1                     # ccache: lợi lớn khi build lại
export CCACHE_DIR=/mnt/big/ccache
ccache -M 100G

m -j$(nproc)                            # khớp số nhân của bạn
```

Một ổ NVMe và 64 GB RAM quan trọng hơn số nhân CPU; build AOSP nghiêng nặng về I/O và bộ nhớ.
16 GB sẽ vật vã và có thể khiến trình liên kết bị OOM.

## Kết quả ra là gì

```
out/target/product/<board>/
    system.img          framework Android và ứng dụng hệ thống
    vendor.img          HAL của bạn, driver của bạn, cấu hình board
    boot.img            nhân + ramdisk
    vbmeta.img          siêu dữ liệu verified boot
    userdata.img        phân vùng người dùng rỗng
    ramdisk.img
    system/             nội dung system.img đã giải nén — tiện để grep
    obj/                sản phẩm trung gian
    symbols/            nhị phân chưa strip, cần để giải mã crash
```

Hai điều đáng biết về `out/`:

**`out/target/product/<board>/system/` duyệt được.** Khi muốn biết file của bạn có thực sự
được cài không và cài ở đâu, hãy nhìn vào đó thay vì mount một ảnh phân vùng.

**`out/target/product/<board>/symbols/` là thứ giúp bạn đọc được tombstone.** Nhị phân trên
thiết bị đã bị strip; những cái này thì không. Hãy giữ thư mục `symbols/` cho mọi bản build
bạn nạp vào máy, nếu không báo cáo crash từ bản đó sẽ không đọc được. Điều này làm khổ những
người dọn sạch cây mã nguồn sau khi xuất xưởng.

## Khi build thất bại

Các kiểu thất bại, theo thứ tự bạn sẽ gặp:

**Hết bộ nhớ khi liên kết.** Giảm `-j`, thêm swap. `m -j4` trên máy 16 GB.

**"module not found" cho thứ rõ ràng có tồn tại.** Soong lưu cache tên module. `m clean`
thường là quá tay; `rm -rf out/soong` rồi build lại nhanh hơn và thường là đủ.

**Thiếu phụ thuộc trong `Android.bp`.** Lỗi nêu tên một ký hiệu, không phải tên thư viện. Hãy
tìm module nào xuất ký hiệu đó — `cs.android.com` hoặc `rg` tên hàm trong các file `Android.bp`
gần đó — rồi thêm vào `shared_libs`.

**SELinux từ chối lúc khởi động, khiến thiết bị không lên được.** Bài 5. Gần như luôn là
nguyên nhân khi một dịch vụ mới không chạy.

**File của bạn không có trên thiết bị.** `PRODUCT_PACKAGES`. Lại là nó.

Và lời khuyên chung: hãy đọc lỗi *đầu tiên*, không phải lỗi cuối. Ninja chạy song song và phần
đuôi đầu ra thường là nhiễu không liên quan từ các việc khác bị huỷ.

## Tự kiểm tra

1. Manifest cục bộ cho bạn làm được điều gì mà sửa manifest chính không làm được?
2. Vì sao một module build thành công mà vẫn vắng mặt trong ảnh thiết bị?
3. Khác biệt thực tế giữa `userdebug` và `user` là gì, và vì sao phải kiểm thử cả hai?
4. Trong `out/target/product/<board>/symbols/` có gì và vì sao phải giữ nó?

## Tiếp theo

Bạn đã build được một ảnh. Bài 2 đi theo những gì xảy ra khi thiết bị bật lên: bootloader,
nhân, init cùng ngôn ngữ `.rc` của nó, Zygote, `system_server`, và cách tìm ra thiết bị của
bạn chết ở giai đoạn nào.
