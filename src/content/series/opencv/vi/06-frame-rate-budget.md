---
lesson: 6
lang: vi
title: "Giữ tốc độ khung hình trên phần cứng thật"
description: "Đo xem các mili-giây đi đâu, chi phí thu ảnh và chuyển màu không ai đếm, chia luồng pipeline để thu ảnh và xử lý chồng lấn, và các cờ biên dịch tăng gấp đôi tốc độ miễn phí."
duration: "17 phút"
tags: ["OpenCV", "Hiệu năng", "Nhúng"]
---

## Bắt đầu bằng một ngân sách, không phải bằng một phép tối ưu

30 FPS nghĩa là **33,3 ms cho mỗi khung, cho tất cả mọi thứ**: thu ảnh, chuyển không gian màu,
thuật toán của bạn, vẽ, mã hoá, và mọi việc hệ điều hành làm lúc bạn không để ý. Hãy viết ngân
sách ra giấy trước khi viết code.

```
thu ảnh + giải mã       6 ms
thu nhỏ về 640x360      1 ms
tiền xử lý              4 ms
phát hiện              12 ms
bám vật + logic         2 ms
vẽ + hiển thị           3 ms
                       -----
                       28 ms   -> còn 5 ms dự phòng. Đó là thiết kế lành mạnh.
```

Một pipeline không có dự phòng thì không chạy 30 FPS; nó chạy 30 FPS cho tới khi có thứ khác
trên board thức dậy.

## Đo trước khi đoán

```cpp
struct Stage {
    const char* name; double total = 0; int n = 0;
    void add(double ms) { total += ms; ++n; }
    double avg() const { return n ? total / n : 0; }
};

int64 t0 = cv::getTickCount();
cv::cvtColor(frame, gray, cv::COLOR_BGR2GRAY);
double ms = (cv::getTickCount() - t0) * 1000.0 / cv::getTickFrequency();
stages[CVT].add(ms);
```

Hãy in bảng đó mỗi một trăm khung. Thêm nó mất mười lăm phút và chưa một lần nào nó nói đúng
điều tôi dự đoán. Tầng người ta đoán sai nhiều nhất là khâu thu ảnh.

Hai cái bẫy khi đo, đáng tránh:

**Báo cáo phân vị, không chỉ trung bình.** Một pipeline có trung bình 20 ms và phân vị 99 là
60 ms thì bị rớt khung, và trung bình sẽ chẳng bao giờ nói cho bạn biết. Hãy giữ giá trị lớn
nhất và p99.

**Khởi động trước.** Vài khung đầu trả giá cho cấp phát lười, khởi tạo ngữ cảnh OpenCL và cache
nguội. Hãy bỏ ba mươi khung đầu.

## Những chi phí không ai đếm

**Thu ảnh.** `cap.read()` chặn cho tới khi camera giao khung hình. Với camera 30 FPS nó trả về
sau mỗi 33 ms bất kể bạn làm gì, nên nếu xử lý của bạn tốn 20 ms thì vòng lặp ngây thơ tốn 53
ms mỗi khung và chạy 19 FPS — trong khi cả camera lẫn CPU đều ngồi không một nửa thời gian.
Đây là lý do phổ biến nhất khiến tốc độ khung hình thấp không giải thích được.

**Giải mã MJPEG.** Đa số camera USB giao MJPEG, và mỗi khung là một lần giải mã JPEG: khoảng 8
ms ở 1080p trên nhân ARM, trước khi code của bạn chạy. Hãy yêu cầu độ phân giải thấp hơn thay
vì thu 1080p rồi thu nhỏ.

```cpp
cap.set(cv::CAP_PROP_FRAME_WIDTH,  640);
cap.set(cv::CAP_PROP_FRAME_HEIGHT, 360);
cap.set(cv::CAP_PROP_FOURCC, cv::VideoWriter::fourcc('M','J','P','G'));
cap.set(cv::CAP_PROP_BUFFERSIZE, 1);       // đừng đưa tôi khung hình cũ
cap.set(cv::CAP_PROP_FPS, 30);

// rồi KIỂM CHỨNG — camera lặng lẽ bỏ qua thứ nó không làm được
std::cout << cap.get(cv::CAP_PROP_FRAME_WIDTH) << "x"
          << cap.get(cv::CAP_PROP_FRAME_HEIGHT) << " @"
          << cap.get(cv::CAP_PROP_FPS) << "\n";
```

`CAP_PROP_BUFFERSIZE` đáng được nhấn mạnh. Với hàng đợi mặc định, một bên tiêu thụ chậm sẽ xử
lý những khung hình đã cũ vài trăm mili-giây — đầu ra trông như trễ so với thực tế vì nó trễ
thật.

**Hiển thị.** `cv::imshow` cộng `cv::waitKey(1)` tốn 3–8 ms, và qua kết nối X từ xa thì tốn
hơn nhiều. Hãy triển khai không màn hình, hoặc chỉ vẽ mỗi năm khung một lần.

## Độ phân giải là đòn bẩy lớn nhất bạn có

Chi phí tỉ lệ với số pixel, nên giảm nửa mỗi chiều là còn một phần tư công việc:

| Độ phân giải | Số pixel | Chi phí tương đối |
|---|---|---|
| 1920×1080 | 2,07 M | 1,00 |
| 1280×720 | 0,92 M | 0,44 |
| 640×360 | 0,23 M | 0,11 |
| 320×180 | 0,06 M | 0,03 |

Rẻ hơn chín lần khi đi từ 1080p xuống 360p. Câu hỏi không bao giờ là "nhỏ hơn thì tệ hơn phải
không" — mà là "kích thước nhỏ nhất mà thứ tôi cần nhìn vẫn còn ở đó là bao nhiêu". Hãy tìm
kích thước pixel tối thiểu của vật thể bằng thực nghiệm rồi làm việc ở tỉ lệ đó.

Phiên bản tốt nhất của ý tưởng này là pipeline hai tầng: **tìm ở độ phân giải thấp, đo ở độ
phân giải đầy đủ.**

```cpp
cv::resize(frame, small, {}, 0.25, 0.25, cv::INTER_AREA);
auto candidates = findRegions(small);                 // rẻ hơn 16 lần

for (auto r : candidates) {
    cv::Rect full(r.x*4, r.y*4, r.width*4, r.height*4);
    measurePrecisely(frame(full));                    // chỉ những phần đáng quan tâm
}
```

Dùng `INTER_AREA` khi thu nhỏ — nó lấy trung bình nên không gây răng cưa. Thu nhỏ bằng
`INTER_LINEAR` vứt thông tin theo cách khiến chi tiết nhỏ chập chờn giữa các khung.

## Chia luồng cho pipeline

Thu ảnh thì chặn; xử lý thì không nhất thiết phải chờ nó. Hãy đưa khâu thu ảnh sang luồng
riêng với một khung hình bàn giao và cả hai chạy đồng thời:

```cpp
std::mutex m; cv::Mat shared; std::atomic<bool> running{true}; bool fresh = false;

std::thread grabber([&]{
    cv::Mat f;
    while (running) {
        cap.read(f);                              // chặn ở đây, không ở luồng chính
        std::lock_guard<std::mutex> lk(m);
        f.copyTo(shared);
        fresh = true;                             // cố ý bỏ khung hình cũ
    }
});

while (running) {
    cv::Mat work;
    { std::lock_guard<std::mutex> lk(m); if (!fresh) continue; shared.copyTo(work); fresh = false; }
    process(work);
}
```

Ví dụ 20 ms công việc ở trên đi từ 19 FPS lên đủ 30. Chú ý quyết định thiết kế nằm ở
`fresh = true`: nó **bỏ** khung hình thay vì xếp hàng. Với hệ thống thời gian thực thì đó là
đúng — một khung bạn không kịp xử lý có giá trị thấp hơn khung kế tiếp. Với phân tích từ file
ghi sẵn thì đó là sai; ở đó hãy dùng hàng đợi có giới hạn.

![Pipeline thu ảnh và xử lý chia luồng](/MyPortfolio/images/opencv/pipeline-threading.svg)

## Để OpenCV dùng được phần cứng

**Kiểm tra xem bạn thực sự có gì.** Gói `opencv-python` và hầu hết gói của bản phân phối được
build cho tính khả chuyển, không phải cho CPU của bạn:

```cpp
std::cout << cv::getBuildInformation();        // NEON? OpenCL? TBB? IPP?
std::cout << cv::getNumThreads() << " luồng\n";
```

Một bản build có NEON và một backend song song thường **nhanh hơn hai đến bốn lần** trên cùng
board so với gói mặc định, mà không đổi một dòng code. Trên Pi hay Jetson, build OpenCV từ mã
nguồn với `-DENABLE_NEON=ON -DWITH_TBB=ON -DCMAKE_BUILD_TYPE=Release` là một buổi chiều mua
được nhiều hơn cả một tuần tối ưu bằng tay.

**Số luồng.** `cv::setNumThreads(n)` điều khiển mức song song nội bộ của OpenCV. Trên board 4
nhân mà bạn đã chạy luồng của riêng mình, để OpenCV sinh thêm bốn luồng nữa là quá tải CPU và
làm mọi thứ chậm đi. Hãy đặt nó có chủ đích — thường `setNumThreads(2)` đi cùng một luồng thu
ảnh sẽ thắng cấu hình mặc định.

**UMat / OpenCL** đẩy công việc sang GPU tích hợp mà gần như không đổi code:

```cpp
cv::UMat gpuFrame, gpuGray;
frame.copyTo(gpuFrame);
cv::cvtColor(gpuFrame, gpuGray, cv::COLOR_BGR2GRAY);
```

Đáng thử, đáng đo, và không miễn phí: mỗi lần chuyển `Mat`↔`UMat` là một lần sao chép. Một
phép toán chạy trên GPU kẹp giữa các tầng chạy trên CPU thì chậm hơn là làm hết trên CPU. Hãy
giữ toàn bộ chuỗi trong `UMat` hoặc không dùng nó chút nào.

## Thắng lợi về thuật toán hơn hẳn vi tối ưu

Xếp đại khái theo mức lợi thu về:

1. **Xử lý ít pixel hơn** — ROI, thu nhỏ, bỏ qua phần trời.
2. **Xử lý ít khung hơn** — phát hiện mỗi N khung và bám vật ở giữa, như bài 5.
3. **Thoát sớm** — kiểm tra tiêu chí rẻ trước. `if (area < 200) continue;` đặt trước mọi thứ
   đắt tiền.
4. **Tính trước** — bản đồ khử méo, phần tử cấu trúc, LUT, khởi động mạng. Bất cứ thứ gì không
   đổi theo khung hình đều thuộc về bên ngoài vòng lặp.
5. **Tái dùng vùng đệm** — đưa mọi `Mat` ra ngoài vòng lặp, như bài 1.

Chỉ sau cả năm điều đó mới đáng nghĩ tới intrinsic SIMD, và tới lúc ấy bạn thường không cần
nữa.

## Danh sách kiểm tra trước khi triển khai

- Thời gian khung hình p99 nằm trong ngân sách, trên board đích, ở nhiệt độ môi trường thực
  tế. Việc hạ xung vì nhiệt trên một chiếc Pi trong hộp kín là có thật và nó đến sau hai mươi
  phút.
- Pipeline suy giảm hợp lý khi không theo kịp — bỏ khung, chứ không xếp hàng thành độ trễ tăng
  dần.
- `CAP_PROP_BUFFERSIZE` bằng 1, và bạn đã kiểm chứng độ phân giải cùng FPS thực sự thoả thuận
  được chứ không phải giả định.
- Mọi lần cấp phát đều nằm ngoài vòng lặp khung hình; RSS phẳng suốt một giờ chạy.
- Có xử lý khi camera rớt kết nối. Camera USB có rớt thật, và `cap.read()` trả về false mãi
  mãi không phải là crash, nên chẳng có gì tự khởi động lại trừ khi bạn viết ra.
- File hiệu chuẩn, file mô hình và các ngưỡng đều có phiên bản và được ghi log lúc khởi động —
  bạn của tương lai sẽ bị hỏi vì sao các con số thay đổi.

## Đi tiếp từ đây

Giờ bạn đã có trọn con đường: pixel trong bộ nhớ, một chuỗi tiền xử lý có lý do cho từng bước,
các bộ phát hiện cổ điển, hiệu chuẩn để ra đơn vị thật, chuyển động và bám vật, cùng một ngân
sách tốc độ khung hình bạn bảo vệ được. Chừng đó bao phủ một phần lớn công việc thị giác máy
thực sự được triển khai.

Khi hiện trường thôi kiểm soát được — nền tuỳ ý, vật thể đa dạng về thị giác, bộ luật cần tới
năm mươi hằng số tinh chỉnh — đó là ranh giới nơi một bộ phát hiện học được xứng đáng với chi
phí của nó. Series YOLO bắt đầu đúng từ chỗ đó, và mọi điều trong bài này về ngân sách, thu
ảnh và chia luồng vẫn áp dụng nguyên vẹn.

## Tự kiểm tra

1. Vì sao một thuật toán 20 ms trên camera 30 FPS lại cho ra 19 FPS, và cách chữa là gì?
2. `CAP_PROP_BUFFERSIZE = 1` ngăn chặn điều gì?
3. Vì sao `INTER_AREA` là lựa chọn đúng khi thu nhỏ?
4. Khi nào chuyển một tầng sang `UMat` lại làm pipeline chậm đi?
