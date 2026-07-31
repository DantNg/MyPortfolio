---
lesson: 4
lang: vi
title: "Binder, đủ sâu để gỡ lỗi"
description: "Driver trong nhân, Parcel thực chất là gì, giao dịch một lần sao chép, servicemanager, thread pool 16 luồng và vùng đệm 1 MB rồi sẽ phá hỏng thứ gì đó, death recipient, và cách đọc trạng thái binder."
duration: "17 phút"
tags: ["AOSP", "Binder", "IPC"]
---

## Mọi thứ đều là Binder

Một ứng dụng gọi `getSystemService`, một dịch vụ hệ thống gọi một HAL, `dumpsys`, một intent,
một truy vấn content provider — tất cả đều là giao dịch Binder. Một thiết bị tầm trung thực
hiện hàng chục nghìn giao dịch mỗi giây. Khi Android có cảm giác chậm, rất thường là nó đang
chờ một lời gọi Binder.

Android chọn Binder thay vì pipe, socket và IPC System V vì bốn lý do tới nay vẫn đúng: một
lần sao chép bộ nhớ thay vì hai, định danh người gọi theo từng lời gọi (`getCallingUid()`),
quản lý vòng đời xuyên tiến trình, và một mô hình thread pool ánh xạ lời gọi từ xa lên một
luồng thật mà bạn không phải tự viết.

![Một giao dịch binder](/MyPortfolio/images/aosp/binder-flow.svg)

## Đường đi của một lời gọi

```
client                    nhân                       server
  |                         |                           |
  proxy.setBrightness(0,128)|                           |
  |-- ghi một Parcel ------>|                           |
  |   ioctl(BINDER_WRITE_READ)                          |
  |                         |-- sao chép MỘT lần vào -->|
  |                         |   vùng đệm đã ánh xạ      |
  |                         |   của server              |
  |   (client bị chặn)      |                    onTransact(code, data, reply)
  |                         |                           |  ...làm việc
  |<-- Parcel trả lời ------|<--------------------------|
  |                         |                           |
```

**Một lần sao chép** là mẹo trung tâm của thiết kế. `/dev/binder` ánh xạ một vùng đệm nhận vào
mọi tiến trình; driver sao chép thẳng từ không gian người dùng của bên gửi sang vùng đệm đã
ánh xạ của bên nhận. Một socket sẽ sao chép hai lần — người dùng sang nhân, nhân sang người
dùng.

**Client bị chặn.** Một lời gọi Binder đồng bộ chặn luồng gọi cho tới khi có trả lời. Trên
luồng chính của một ứng dụng, đó là giao diện đóng băng, và đây là nguồn gốc của một phần lớn
các ANR. Hãy đánh dấu phương thức là `oneway` khi bạn không cần trả lời:

```java
interface ILedCallback {
    oneway void onBrightnessChanged(int id, int brightness);
}
```

`oneway` trả về ngay, giao việc bất đồng bộ, và có hạn mức vùng đệm riêng nhỏ hơn. Hãy dùng nó
cho callback và thông báo; đừng bao giờ dùng cho thứ mà bạn cần kết quả.

## Parcel

Parcel là một vùng đệm byte phẳng, có thứ tự. Không phải lược đồ, không phải định dạng tự mô
tả — chỉ là các giá trị được ghi theo thứ tự mà bên đọc phải biết chính xác.

```cpp
// được sinh tự động cho bạn, nhưng đây là những gì nó làm
data.writeInterfaceToken(ILedControl::descriptor);
data.writeInt32(id);
data.writeInt32(brightness);
remote()->transact(SET_BRIGHTNESS, data, &reply);
reply.readInt32(&result);
```

Ba hệ quả:

**Thứ tự là hợp đồng.** Ghi hai số nguyên, đọc hai số nguyên, đúng thứ tự đó. Sai lệch không
ném ngoại lệ; nó lặng lẽ đọc vùng nhớ kế bên như một kiểu khác. Đây chính là lý do bạn dùng
stub AIDL được sinh ra thay vì tự viết giao dịch bằng tay.

**`writeInterfaceToken` là một kiểm tra an ninh.** Nó đóng dấu mô tả giao diện để server từ
chối được một Parcel nhắm tới giao diện khác. Mã Binder viết tay bỏ qua nó là một lớp lỗ hổng
bảo mật có thật.

**Đối tượng Binder có thể đóng gói vào Parcel.** Ghi một `IBinder` vào Parcel là truyền một
*tham chiếu* qua ranh giới tiến trình; nhân dịch handle giúp bạn. Đó là cách callback hoạt
động, và nó là một khả năng thực sự khác thường với một cơ chế IPC. Bộ mô tả file cũng đi theo
cách tương tự.

## servicemanager

Sổ đăng ký tên, bản thân nó cũng là một dịch vụ Binder, ở handle nổi tiếng số 0.

```cpp
// server
AServiceManager_addService(binder, "android.hardware.acme.led.ILedControl/default");

// client
AServiceManager_waitForService("android.hardware.acme.led.ILedControl/default");
```

```bash
adb shell service list                 # mọi dịch vụ đã đăng ký
adb shell service check power          # dịch vụ đó có không
adb shell dumpsys activity             # nói chuyện với một dịch vụ
```

Việc đăng ký do SELinux kiểm soát: một dịch vụ thiếu chính sách để đăng ký sẽ thất bại ở
`addService` và client sẽ không thấy gì. Các dòng từ chối `add_service` trong logcat là một
kiểu thất bại bring-up phổ biến — bài 5.

Hãy ưu tiên `waitForService` hơn `getService`. Cái sau trả về null khi dịch vụ chưa đăng ký,
và một nửa số lỗi "dịch vụ null lúc khởi động" chính là cuộc đua này.

## Thread pool, và con số 16

```cpp
ABinderProcess_setThreadPoolMaxThreadCount(4);
ABinderProcess_startThreadPool();
ABinderProcess_joinThreadPool();
```

Mỗi tiến trình server Binder có một pool luồng nhận các giao dịch đến. Mặc định của nền tảng
là **15 cộng luồng chính = 16**.

Đây là giới hạn cứng với hệ quả thực tế. Nếu mười sáu giao dịch đang chạy và cả mười sáu luồng
đều bận, người gọi thứ mười bảy **bị chặn cho tới khi có luồng rảnh**. Nếu các phương thức của
dịch vụ bạn làm việc chậm — I/O file, gọi mạng, chờ phần cứng — bạn có thể làm cạn pool, và
mọi client của dịch vụ đó khựng lại. Nhìn từ phía client, việc này trông như cả hệ thống treo
một cách bí ẩn.

Hai quy tắc rút ra:

- **Phương thức Binder phải nhanh.** Hãy giao việc chậm cho luồng worker của bạn rồi trả về.
- **Đừng gọi ngược về client khi đang giữ khoá.** Lời gọi Binder có thể tái nhập: A gọi B, B
  gọi ngược vào A trên một luồng khác, và nếu A đang giữ khoá mà luồng đầu tiên cần thì bạn có
  deadlock. Đây là deadlock Binder kinh điển và nó rất khó chịu khi chẩn đoán.

Hãy đặt kích thước pool có chủ đích. Một HAL phục vụ một client không cần 15 luồng; một dịch
vụ hệ thống bận rộn thì có thể cần.

## Vùng đệm 1 MB

Mỗi tiến trình có **một vùng đệm Binder 1 MB, dùng chung cho mọi giao dịch của nó**. Không
phải mỗi lời gọi — mỗi tiến trình.

```
android.os.TransactionTooLargeException: data parcel size 1359872 bytes
```

Giới hạn thực tế thấp hơn 1 MB khá nhiều, vì các giao dịch đồng thời chia nhau không gian đó.
Một Parcel 500 KB có thể thành công khi hệ thống rảnh và thất bại khi tải cao, khiến đây thành
một lỗi chập chờn tuyệt vời.

Nên làm gì thay vì gửi dữ liệu lớn:

- **Phân trang.** Trả về 50 mục kèm con trỏ, không phải 5000.
- **Gửi một bộ mô tả file.** `ParcelFileDescriptor` truyền một fd, không phải các byte. Đây là
  câu trả lời đúng cho ảnh, vùng đệm và file, và nó rất rẻ.
- **Dùng bộ nhớ chia sẻ.** `ashmem` / `MemoryFile` cho vùng đệm lớn.
- **Cẩn thận với `Bundle`.** Một Bundle chứa Bitmap là cách phổ biến để vô tình chạm giới hạn
  này.

Cũng lưu ý giao dịch `oneway` chỉ được một phần nhỏ vùng đệm, nên dồn dập lời gọi bất đồng bộ
có thể thất bại trong khi lời gọi đồng bộ vẫn chạy.

## Death recipient

Một client giữ proxy tới dịch vụ đã chết sẽ thất bại ở mọi lời gọi, mãi mãi.

```cpp
static void onDied(void* cookie) {
    LOG(ERROR) << "led HAL đã chết; sẽ kết nối lại";
    reinterpret_cast<MyClass*>(cookie)->reconnect();
}

AIBinder_DeathRecipient* r = AIBinder_DeathRecipient_new(onDied);
AIBinder_linkToDeath(binder.get(), r, this);
```

```java
binder.linkToDeath(() -> { Log.e(TAG, "dịch vụ đã chết"); reconnect(); }, 0);
```

Hãy liên kết death recipient cho **mọi** tham chiếu từ xa sống lâu. Dịch vụ có bị giết — bởi
lmkd khi thiếu bộ nhớ, bởi một lần crash, bởi một bản cập nhật — và client không nhận ra sẽ
hỏng vĩnh viễn cho tới khi được khởi động lại. Đây là thiếu sót rất phổ biến trong mã của các
hãng và nó tạo ra kiểu lỗi "chạy tốt cho tới lúc không".

Trường hợp đối xứng cũng quan trọng: một server giữ callback từ các client đã chết sẽ rò rỉ
chúng. `RemoteCallbackList` xử lý việc này ở phía Java bằng cách tự huỷ đăng ký khi client
chết; ở phía native, bạn phải tự làm.

## Định danh và quyền

Mỗi giao dịch đến đều mang theo định danh của người gọi:

```cpp
uid_t uid = AIBinder_getCallingUid();
pid_t pid = AIBinder_getCallingPid();
```

```java
int uid = Binder.getCallingUid();
mContext.enforceCallingPermission(android.Manifest.permission.MY_PERM, "setBrightness");
```

Đây là nền móng của mô hình quyền trong Android — việc kiểm tra diễn ra ở *server*, trong tiến
trình sở hữu tài nguyên, dùng một định danh do nhân cung cấp mà người gọi không giả mạo được.

Điểm tinh tế ai cũng gặp: **bên trong chính tiến trình của bạn, `getCallingUid()` trả về uid
của chính bạn**, vì không có giao dịch nào cả. Và khi dịch vụ của bạn gọi sang dịch vụ khác
thay mặt cho một client, bạn phải quyết định dùng định danh của ai:

```java
long token = Binder.clearCallingIdentity();     // hành động với tư cách CHÍNH MÌNH
try {
    otherService.doPrivilegedThing();
} finally {
    Binder.restoreCallingIdentity(token);       // LUÔN đặt trong finally
}
```

Quên khôi phục là để luồng đó chạy với định danh sai cho mọi lời gọi nó phục vụ sau đó — một
lỗi leo thang đặc quyền thật sự, và là lý do khuôn mẫu này luôn được viết kèm `try/finally`.

## Gỡ lỗi Binder

```bash
# ai đã đăng ký
adb shell service list
adb shell lshal

# trạng thái binder theo tiến trình: luồng, giao dịch đang chờ, node chết
adb shell cat /sys/kernel/debug/binder/stats
adb shell cat /sys/kernel/debug/binder/transactions
adb shell cat /sys/kernel/debug/binder/proc/<pid>

# cái gì đang bị chặn ngay lúc này
adb shell debuggerd -b <pid>       # backtrace native của mọi luồng
adb shell kill -3 <system_server_pid>  # kết xuất luồng Java -> /data/anr/traces.txt
```

Hai triệu chứng và chỗ cần nhìn:

**"Mọi thứ đều chậm."** Hãy tìm một dịch vụ có thread pool đã cạn. Trong
`/sys/kernel/debug/binder/transactions` bạn sẽ thấy các giao dịch xếp hàng nhắm vào một tiến
trình. Chỗ cần sửa nằm ở dịch vụ đó, không phải ở phía người gọi.

**Treo.** Hãy kết xuất luồng của cả hai tiến trình. Một deadlock Binder hiện ra dưới dạng
luồng A nằm trong `IPCThreadState::waitForResponse` và, ở tiến trình kia, một luồng bị chặn
bởi khoá do một luồng đang nằm trong lời gọi Binder nắm giữ. Nhìn thấy hình dạng đó một lần là
bạn nhận ra ngay từ lần sau.

Về theo vết, Perfetto có một track Binder hiển thị mọi giao dịch kèm thời lượng và cả hai đầu.
Với câu hỏi "vì sao cái này mất 300 ms", nó hơn hẳn mọi lệnh phía trên.

## Tự kiểm tra

1. Vì sao Binder chỉ sao chép một lần trong khi socket sao chép hai lần?
2. Điều gì xảy ra với người gọi đồng thời thứ mười bảy tới một dịch vụ có pool mặc định?
3. Vì sao một Parcel 500 KB lúc chạy được lúc không?
4. `clearCallingIdentity` làm gì và vì sao phải ghép cặp trong `finally`?

## Tiếp theo

Giờ bạn đã có đủ mọi mảnh ghép để thêm thứ của riêng mình. Bài 5 dựng một dịch vụ hệ thống
hoàn chỉnh: giao diện AIDL, cài đặt native, nối vào init, chính sách SELinux sẽ là trở ngại
chính của bạn, và một API phía framework cho client.
