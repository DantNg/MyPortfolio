---
lesson: 1
lang: vi
title: "Một tấm ảnh chỉ là bộ nhớ"
description: "cv::Mat thực chất là gì, vì sao step quan trọng hơn width, khác nhau giữa bản sao và khung nhìn, và thay đổi một dòng đưa bộ lọc từ 148 ms xuống 6 ms."
duration: "14 phút"
tags: ["OpenCV", "Mat", "Hiệu năng"]
---

## Vì sao bắt đầu từ đây

Phần lớn hướng dẫn OpenCV mở đầu bằng `imread` rồi một lệnh blur. Cách đó ổn cho tới ngày
pipeline của bạn phải chạy 30 FPS trên một board giá tám đô, và khi ấy mỗi dòng lệnh tiện lợi
kia biến thành một con số trong ngân sách mà bạn không có.

Gần như mọi chương trình OpenCV chậm mà tôi được nhờ xem đều chậm vì cùng một lý do: người
viết không biết `Mat` đang làm gì với bộ nhớ. Nên ta bắt đầu từ bộ nhớ.

## Mat là một header cộng một con trỏ

```cpp
cv::Mat img = cv::imread("frame.png", cv::IMREAD_COLOR);
```

`img` là một struct nhỏ — vài chục byte trên stack — chứa `rows`, `cols`, `step`, một từ
`flags` mã hoá kiểu dữ liệu, và `data`, con trỏ tới vùng pixel nằm đâu đó trên heap. Bản thân
pixel **không** nằm trong `Mat`. Chỉ riêng sự thật đó giải thích hầu hết những hành vi gây bất
ngờ mà người ta gặp phải.

```cpp
cv::Mat a = cv::imread("frame.png");
cv::Mat b = a;              // sao chép HEADER. Cả hai trỏ vào cùng vùng pixel.
b.at<cv::Vec3b>(0,0) = {0,0,0};
// a.at<Vec3b>(0,0) giờ cũng đen.

cv::Mat c = a.clone();      // sao chép PIXEL. Độc lập.
```

`Mat` đếm tham chiếu, nên vùng đệm pixel còn sống cho tới khi header cuối cùng trỏ vào nó biến
mất. Phép gán là O(1) và miễn phí; `clone()` là O(rộng × cao × số kênh), tức khoảng 6 MB cho
một khung màu 1080p.

![Cách một Mat nằm trong bộ nhớ](/MyPortfolio/images/opencv/mat-memory.svg)

## Theo hàng, xen kẽ kênh, và có đệm

Ba tính chất của bố cục, xếp theo thứ tự chúng sẽ gây phiền cho bạn:

**Theo hàng (row-major).** Pixel `(y, x)` nằm ở `data + y*step + x*elemSize()`. Các hàng liền
nhau; các cột thì không. Duyệt xuống theo cột chạm vào một cache line mới ở mỗi lần truy cập.

**Xen kẽ kênh (interleaved).** Ảnh ba kênh không phải là ba mặt phẳng. Nó là
`B G R B G R B G R…`. Khi bạn xin "kênh xanh dương", OpenCV phải nhặt từng byte thứ ba —
`cv::split()` không miễn phí, nó là một lượt quét toàn ảnh.

**Có đệm (padded).** `step` là số byte từ đầu hàng này tới đầu hàng kế, và nó *không* phải lúc
nào cũng bằng `cols * elemSize()`. Bộ cấp phát đệm thêm cho canh biên, còn mọi ROI bạn cắt ra
đều mang `step` của ảnh cha. Đoạn code giả định `step == cols*3` chạy đúng trên laptop của bạn
và tạo ra những vệt chéo trên thiết bị đích.

```cpp
cv::Mat m(480, 641, CV_8UC3);
std::cout << m.cols * m.elemSize() << "\n";   // 1923
std::cout << m.step << "\n";                  // 1924 hoặc 1932, tuỳ bộ cấp phát
std::cout << m.isContinuous() << "\n";        // có thể false
```

Hãy kiểm tra `isContinuous()` trước khi coi vùng đệm là một mảng phẳng. Nếu đúng, bạn được
phép duyệt `m.data` từ `0` tới `total()*elemSize()` trong một vòng lặp duy nhất, và điều đó
nhanh hơn vòng lặp lồng nhau một cách đo được.

## Bốn cách chạm vào pixel, xếp hạng

Dưới đây là cùng một phép toán — đường cong độ sáng kiểu gamma trên khung BGR 1920×1080 —
viết theo bốn cách. Số liệu đo trên Raspberry Pi 4, một nhân, OpenCV 4.9, `-O2`.

```cpp
// 1) at<>() — kiểm tra biên ở bản debug, một phép nhân mỗi lần truy cập. 148 ms
for (int y = 0; y < img.rows; ++y)
  for (int x = 0; x < img.cols; ++x)
    for (int c = 0; c < 3; ++c)
      img.at<cv::Vec3b>(y,x)[c] = lut[img.at<cv::Vec3b>(y,x)[c]];
```

```cpp
// 2) ptr<>() theo hàng — một phép tính con trỏ mỗi hàng. 39 ms
for (int y = 0; y < img.rows; ++y) {
  uchar* p = img.ptr<uchar>(y);
  for (int i = 0; i < img.cols * 3; ++i)
    p[i] = lut[p[i]];
}
```

```cpp
// 3) vòng lặp phẳng khi liên tục — 31 ms
if (img.isContinuous()) {
  uchar* p = img.data;
  const size_t n = img.total() * img.channels();
  for (size_t i = 0; i < n; ++i) p[i] = lut[p[i]];
}
```

```cpp
// 4) để thư viện làm — cv::LUT dùng SIMD và đa luồng. 6 ms
cv::Mat table(1, 256, CV_8U, lut);
cv::LUT(img, table, img);
```

Hai mươi lăm lần, từ cùng một thuật toán. Không có gì trong phép toán thay đổi — chỉ có số
lần CPU phải tính địa chỉ trên mỗi pixel, và việc nó có dùng được NEON hay không.

**Quy tắc rút ra:** nếu có một hàm OpenCV làm đúng việc vòng lặp của bạn đang làm, hãy dùng
nó. Cài đặt trong thư viện đã được vector hoá, thường được song song hoá, và do những người
có profiler trong tay tinh chỉnh. Chỉ tự viết vòng lặp khi không hàm nào vừa, và khi đó hãy
viết bằng `ptr<>()`.

## ROI: phép cắt miễn phí

```cpp
cv::Mat roi = img(cv::Rect(100, 50, 320, 240));
```

Dòng này không cấp phát gì cả. `roi` là một header mới trỏ vào giữa vùng đệm của `img`, với
`roi.step == img.step`. Ghi qua `roi` là ghi vào `img`. Đây là tối ưu rẻ nhất trong thị giác
máy tính: nếu bạn chỉ quan tâm một vùng, chỉ xử lý vùng đó.

```cpp
// xử lý dải 320x240 thay vì khung 1920x1080: ít hơn 24 lần công việc
cv::Mat band = frame(cv::Rect(0, 420, 1920, 240));
cv::cvtColor(band, gray, cv::COLOR_BGR2GRAY);
```

Hai điều cần nhớ. Thứ nhất, gọi `roi.clone()` khi bạn cần nó sống lâu hơn ảnh cha hoặc cần nó
liên tục. Thứ hai, một hàm cấp phát lại đầu ra (đa số đều vậy, khi kích thước hoặc kiểu không
khớp) sẽ âm thầm tách ROI ra thay vì ghi vào ảnh cha — nên hãy truyền một `Mat` đầu ra đúng
kích thước, đúng kiểu khi bạn thật sự muốn ghi tại chỗ.

## Kiểu dữ liệu, và thông báo lỗi bạn sẽ gặp nhiều nhất

`CV_8UC3` đọc là: 8 bit, Unsigned, 3 Channels. Cả họ:

| Kiểu | Byte/px/kênh | Miền giá trị | Dùng cho |
|---|---|---|---|
| `CV_8U` | 1 | 0…255 | khung hình camera, mặt nạ |
| `CV_8S` | 1 | −128…127 | hiếm |
| `CV_16U` | 2 | 0…65535 | bản đồ độ sâu, cảm biến thô |
| `CV_32F` | 4 | số thực | tính toán trung gian, optical flow |
| `CV_64F` | 8 | double | ma trận hiệu chuẩn |

`(-215:Assertion failed) src.type() == dst.type()` nghĩa là bạn đưa cho một hàm hai ảnh khác
kiểu. Nguyên nhân thường gặp là phép toán số học: `a - b` trên hai ảnh `CV_8U` bị chặn ở 0,
nên người ta chuyển sang `CV_32F`, tính xong rồi quên chuyển ngược lại trước lời gọi kế tiếp.
`img.convertTo(out, CV_32F, 1.0/255.0)` vừa đổi kiểu vừa co giãn trong một lượt.

Ngoài ra: **số học `CV_8U` bị chặn chứ không tràn vòng.** `200 + 100` là `255`, không phải
`44`. Đây thường là điều bạn muốn, và nó ngược với C thuần.

## Cấp phát sẵn trước vòng lặp

Mỗi `cv::Mat` được hàm trả về theo giá trị bên trong vòng lặp khung hình là một lần cấp phát
tiềm tàng. Các hàm OpenCV tái dùng vùng đệm đầu ra nếu nó đã đúng kích thước và kiểu, nên hãy
đưa chúng ra ngoài:

```cpp
cv::Mat gray, blurred, edges;         // NGOÀI vòng lặp

while (cap.read(frame)) {
    cv::cvtColor(frame, gray, cv::COLOR_BGR2GRAY);   // tái dùng gray từ khung 2
    cv::GaussianBlur(gray, blurred, {5,5}, 1.5);
    cv::Canny(blurred, edges, 60, 180);
}
```

Khai báo bên trong vòng lặp, cùng đoạn code đó cấp phát rồi giải phóng khoảng 3 MB mỗi khung.
Ở 30 FPS là 90 MB/s lưu lượng malloc chẳng làm gì cả. Trên desktop bạn sẽ không nhận ra; trên
board có heap nhỏ bạn sẽ gặp phân mảnh, và cuối cùng là một cú khựng.

## Một thói quen đáng tạo

Hãy in kích thước của mọi thứ trong lần đầu viết một pipeline:

```cpp
std::cout << "gray: " << gray.size() << " type=" << gray.type()
          << " step=" << gray.step << " cont=" << gray.isContinuous() << "\n";
```

Một nửa số lỗi OpenCV là sai kích thước hoặc sai kiểu ở hai tầng phía trên chỗ ngoại lệ được
ném ra. Ba mươi giây in ra hơn hẳn một tiếng ngồi đoán.

## Tự kiểm tra

1. `cv::Mat b = a;` sao chép cái gì, và không sao chép cái gì?
2. Vì sao `step` có thể lớn hơn `cols * elemSize()`, và khi nào điều đó quan trọng?
3. Vì sao `at<Vec3b>()` trong vòng lặp lồng nhau chậm hơn `ptr<uchar>()` nhiều đến vậy?
4. Cắt một ROI cấp phát bao nhiêu bộ nhớ?

## Tiếp theo

Khi pixel chỉ còn là bộ nhớ, chuỗi tiền xử lý thôi là một câu thần chú. Bài sau: chuyển không
gian màu, bốn kiểu làm mờ và khi nào dùng kiểu nào, phân ngưỡng gồm cả Otsu và thích nghi, và
hình thái học — với câu trả lời rõ ràng cho việc mỗi bước thực sự *để làm gì*.
