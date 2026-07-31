---
lesson: 3
lang: vi
title: "Phát hiện cổ điển, và vì sao nó vẫn thắng"
description: "Contour và các mô tả hình dạng dùng để phân loại, so khớp mẫu cùng điểm yếu chí mạng của nó, cascade Haar và HOG, và marker ArUco — những công cụ chạy 3 ms trên một nhân ARM."
duration: "16 phút"
tags: ["OpenCV", "Contour", "Phát hiện"]
---

## Lập luận về chi phí

YOLOv8-nano trên Raspberry Pi 4 chạy khoảng 4 FPS, cần 6 MB trọng số, một runtime, và một bộ
dữ liệu bạn phải tự dựng và gán nhãn. Một bộ phát hiện chi tiết dựa trên contour trên cùng
board đó chạy 200 FPS, cần 40 dòng code, và giải thích được cho khách hàng trong một câu.

Mạng nơ-ron thắng khi thế giới lộn xộn: nền tuỳ ý, ánh sáng không biết trước, vật thể không mô
tả được bằng hình học. Thị giác cổ điển thắng khi bạn kiểm soát được hiện trường — và trong
công nghiệp, robot hay đo lường, bạn thường kiểm soát được. Biết ranh giới nằm ở đâu tiết kiệm
được nhiều tháng.

## Contour: từ mặt nạ ra vật thể

```cpp
std::vector<std::vector<cv::Point>> contours;
cv::findContours(bin, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);
```

Hai đối số mang toàn bộ ý nghĩa:

- `RETR_EXTERNAL` chỉ trả về đường biên ngoài — lựa chọn thông thường, và là lựa chọn nhanh.
  `RETR_CCOMP` và `RETR_TREE` còn cho bạn lỗ và cấu trúc lồng nhau, thứ bạn cần khi phải phân
  biệt "một vòng đệm" với "một đĩa đặc".
- `CHAIN_APPROX_SIMPLE` gộp các đoạn thẳng về hai đầu mút. Đường viền hình chữ nhật 1000 pixel
  còn 4 điểm thay vì 1000.

`findContours` trong OpenCV 4 không còn sửa đổi ảnh đầu vào, nhưng vẫn đòi một ảnh một kênh 8
bit, trong đó khác 0 nghĩa là tiền cảnh.

## Mô tả một hình dạng bằng năm con số

Contour thô vô dụng cho tới khi bạn đo nó. Đây là những mô tả mang phần lớn khả năng phân biệt
trong thực tế:

```cpp
for (const auto& c : contours) {
    double area  = cv::contourArea(c);
    if (area < 200) continue;                       // LOẠI nhiễu TRƯỚC, luôn luôn

    double perim = cv::arcLength(c, true);
    cv::Rect  box = cv::boundingRect(c);
    cv::RotatedRect rr = cv::minAreaRect(c);

    double circularity = 4 * CV_PI * area / (perim * perim);   // 1.0 = tròn hoàn hảo
    double aspect      = double(box.width) / box.height;
    double extent      = area / (box.width * double(box.height));
    double solidity    = area / cv::contourArea(hullOf(c));    // 1.0 = lồi
}
```

Mỗi đại lượng tốt cho việc gì:

| Mô tả | Giá trị với… | Phân biệt |
|---|---|---|
| `area` | mọi thứ | nhiễu với vật thể; phân loại theo cỡ |
| `circularity` | 1.0 tròn, 0.78 vuông, thấp với sao biển | chi tiết tròn với chi tiết có góc |
| `aspect` | rộng/cao của hộp thẳng đứng | con vít với vòng đệm |
| `extent` | lấp bao nhiêu phần hộp bao | chữ thập và chữ L với khối đặc |
| `solidity` | diện tích / diện tích bao lồi | bánh răng và lược với đĩa đặc |

Lưu ý `aspect` lấy từ `boundingRect` phụ thuộc vào hướng — xoay hình chữ nhật là nó đổi. Dùng
`minAreaRect().size` khi vật thể có thể tới ở góc bất kỳ; nó cho bạn tỉ lệ của chính *vật thể*
cộng thêm góc xoay miễn phí.

Xấp xỉ đa giác phân loại trực tiếp các hình có cạnh thẳng:

```cpp
std::vector<cv::Point> approx;
cv::approxPolyDP(c, approx, 0.02 * cv::arcLength(c, true), true);
switch (approx.size()) {
    case 3: /* tam giác */ break;
    case 4: /* vuông hoặc chữ nhật — kiểm tra tỉ lệ */ break;
    default: if (circularity > 0.8) { /* hình tròn */ } break;
}
```

Epsilon — `0.02 * chu vi` — là dung sai. Quá nhỏ thì một cạnh nhiễu thành đa giác mười hai
cạnh; quá lớn thì hình chữ nhật co lại thành tam giác. Hai phần trăm là mặc định tốt cho mặt
nạ sạch.

## Mô-men đáng biết

```cpp
cv::Moments m = cv::moments(c);
cv::Point2f centre(m.m10 / m.m00, m.m01 / m.m00);
```

Trọng tâm, chính xác dưới mức pixel và rẻ hơn mọi cách khác cho ra một vị trí. `m.m00` bằng
diện tích, nên hãy đề phòng chia cho 0. `cv::matchShapes()` so sánh hai contour bằng mô-men
Hu, bất biến với tỉ lệ, phép quay và phép lật — một bộ phân loại một dòng thực sự hữu ích khi
bạn có hình mẫu tham chiếu.

## So khớp mẫu, và điểm yếu chí mạng của nó

```cpp
cv::matchTemplate(scene, templ, result, cv::TM_CCOEFF_NORMED);
double maxVal; cv::Point maxLoc;
cv::minMaxLoc(result, nullptr, &maxVal, nullptr, &maxLoc);
if (maxVal > 0.8) { /* tìm thấy tại maxLoc */ }
```

`TM_CCOEFF_NORMED` là phương pháp nên dùng — có chuẩn hoá, nên điểm số gần như so sánh được
giữa các ảnh, và nó chịu được thay đổi độ sáng đồng đều.

Điểm yếu: so khớp mẫu **không bất biến với phép quay hay tỉ lệ.** Xoay vật thể mười độ là điểm
số sụp đổ. Nếu vật thể có thể xoay, bạn hoặc phải so khớp một chồng mẫu đã xoay (chi phí nhân
lên) hoặc phải dùng thứ khác. Nó là công cụ đúng cho bài toán cố định hướng: một logo trên
nhãn, một biểu tượng trên màn hình đã biết, một điểm chuẩn trong đồ gá.

Ghi chú tốc độ: chi phí xấp xỉ *diện tích cảnh × diện tích mẫu*. Hãy tìm bên trong một ROI mà
bạn đã biết là hợp lý, và so khớp trên tầng kim tự tháp nửa độ phân giải trước rồi mới tinh
chỉnh.

## Cascade: Haar và HOG

```cpp
cv::CascadeClassifier face("haarcascade_frontalface_default.xml");
std::vector<cv::Rect> faces;
face.detectMultiScale(gray, faces, 1.1, 4, 0, cv::Size(60, 60));
```

Các tham số là toàn bộ câu chuyện:

- `scaleFactor` 1.1 — cửa sổ tìm kiếm nở bao nhiêu mỗi tầng kim tự tháp. 1.05 kỹ hơn và chậm
  hơn nhiều; 1.3 nhanh và bỏ sót.
- `minNeighbors` 4 — cần bao nhiêu lần trúng chồng lấn để giữ một phát hiện. Tăng lên để diệt
  báo động giả, giảm xuống nếu đang bỏ sót vật thật.
- `minSize` — hãy đặt nó. Không có nó bạn quét cả những tỉ lệ nhỏ vô lý và trả giá cho việc đó.

Cascade Haar nhanh, đi kèm sẵn OpenCV, và thực sự dùng được cho mặt người chính diện cùng một
số ít vật thể đã huấn luyện. Chúng hỏng khi có phép quay hoặc góc nghiêng, và tỉ lệ báo động
giả trên nền nhiều hoạ tiết là có thật. HOG cộng SVM tuyến tính là cùng ý tưởng với đặc trưng
tốt hơn; `cv::HOGDescriptor` với bộ phát hiện người mặc định là chuẩn so sánh kinh điển cho
người đi bộ.

Hãy coi cả hai đúng bản chất: các bộ phát hiện thời 2005, chi phí gần như bằng không. Khi
chúng chạy được, chúng tiết kiệm cho bạn một GPU.

## ArUco: khi bạn được phép thay đổi thế giới

Nếu bạn có thể dán một marker lên vật thể, hãy làm. Không gì khác cho bạn nhiều đến vậy với
chi phí ít đến vậy:

```cpp
auto dict = cv::aruco::getPredefinedDictionary(cv::aruco::DICT_4X4_50);
cv::aruco::ArucoDetector det(dict);

std::vector<int> ids;
std::vector<std::vector<cv::Point2f>> corners;
det.detectMarkers(frame, corners, ids);
```

Với mỗi marker bạn nhận được: một định danh, bốn góc chính xác dưới mức pixel, và — khi đã có
hiệu chuẩn từ bài 4 — tư thế đầy đủ 6 bậc tự do. Việc phát hiện tốn vài mili-giây và gần như
không bao giờ báo động giả, vì từ điển có khả năng sửa lỗi.

Cánh tay robot, xe AGV vào trạm, đăng ký toạ độ camera với vùng làm việc, dữ liệu chuẩn để
đánh giá một hệ thống khác: marker là câu trả lời thường xuyên hơn người ta tưởng, và phản đối
với nó hầu như luôn mang tính thẩm mỹ chứ không phải kỹ thuật.

## Một bộ phát hiện cổ điển hoàn chỉnh

Đếm và phân loại chi tiết tròn trên băng chuyền, từ đầu đến cuối:

```cpp
cv::cvtColor(frame, gray, cv::COLOR_BGR2GRAY);
cv::GaussianBlur(gray, blur, {5,5}, 1.5);
cv::threshold(blur, bin, 0, 255, cv::THRESH_BINARY_INV | cv::THRESH_OTSU);
cv::morphologyEx(bin, bin, cv::MORPH_OPEN, k);

std::vector<std::vector<cv::Point>> cs;
cv::findContours(bin, cs, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);

int good = 0, bad = 0;
for (const auto& c : cs) {
    double a = cv::contourArea(c);
    if (a < 500 || a > 50000) continue;                 // không phải chi tiết

    double circ = 4 * CV_PI * a / std::pow(cv::arcLength(c, true), 2);
    cv::Point2f ctr; float r;
    cv::minEnclosingCircle(c, ctr, r);

    bool ok = circ > 0.85 && r > 18.0f && r < 24.0f;     // tròn, và đúng cỡ
    (ok ? good : bad)++;
    cv::circle(frame, ctr, int(r), ok ? cv::Scalar(0,200,0) : cv::Scalar(0,0,220), 2);
}
```

Khoảng 3 ms mỗi khung ở 720p trên một nhân ARM, với các ngưỡng bạn giải thích được cho người
phải ký duyệt cỗ máy. Tính chất cuối cùng ấy đáng giá hơn vẻ ngoài của nó.

## Ranh giới nằm ở đâu

Hãy dùng thị giác cổ điển khi hiện trường được kiểm soát, vật thể mô tả được bằng hình học hay
màu sắc, và bạn cần nó chạy trên một CPU nhỏ. Hãy dùng mạng nơ-ron khi nền tuỳ ý, khi lớp vật
thể đa dạng về thị giác, hoặc khi bộ luật sẽ cần năm mươi hằng số tinh chỉnh. Nhiều hệ thống
đã triển khai dùng cả hai: một tầng cổ điển rẻ tiền để tìm vùng ứng viên, mạng nơ-ron chỉ chạy
trên những mảnh sống sót.

## Tự kiểm tra

1. `RETR_EXTERNAL` vứt bỏ cái gì, và khi nào bạn cần đúng cái nó vứt?
2. Hai mô tả nào tách được vòng đệm khỏi đĩa đặc cùng đường kính?
3. Vì sao so khớp mẫu hỏng với vật thể bị xoay, và bạn sẽ làm gì thay thế?
4. Tăng `minNeighbors` là đánh đổi cái gì lấy cái gì?

## Tiếp theo

Mọi thứ tới giờ đều tính bằng pixel. Bài 4 đưa bạn tới milimét: mô hình pinhole, ma trận nội
tại và méo ống kính, chạy hiệu chuẩn bàn cờ cho đúng cách, homography để có góc nhìn từ trên
xuống, và solvePnP để lấy tư thế.
