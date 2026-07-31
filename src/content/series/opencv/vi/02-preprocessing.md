---
lesson: 2
lang: vi
title: "Chuỗi tiền xử lý"
description: "Chuyển không gian màu, bốn kiểu làm mờ và khi nào kiểu nào đúng, Otsu so với phân ngưỡng thích nghi, và các phép hình thái học dọn sạch một mặt nạ — kèm lý do cho từng bước."
duration: "16 phút"
tags: ["OpenCV", "Lọc ảnh", "Phân ngưỡng"]
---

## Tiền xử lý là việc giảm dữ liệu

Một khung màu 1080p là 6,2 MB số. Câu hỏi mà chương trình của bạn thực sự muốn trả lời thường
chỉ dài một dòng: *có chi tiết nào trên băng chuyền không, và ở đâu?* Tiền xử lý là cái phễu
nối hai đầu đó — mỗi tầng vứt bỏ thông tin không giúp ích, để tầng sau có ít thứ phải nhìn
hơn.

Cách nhìn ấy cho bạn một phép thử cho từng bước: **bước này đã bỏ đi cái gì, và tôi có cần cái
đó không?** Nếu không trả lời được, bước đó không thuộc về pipeline của bạn.

![Chuỗi tiền xử lý, từng tầng một](/MyPortfolio/images/opencv/preprocessing-chain.svg)

## Ảnh xám, và khi nào màu chính là tín hiệu

```cpp
cv::cvtColor(bgr, gray, cv::COLOR_BGR2GRAY);
```

Phép này vứt hai phần ba dữ liệu và thường là đúng, vì hình dạng và biên vẫn còn nguyên trong
độ sáng. Trọng số không đều nhau — `0.299R + 0.587G + 0.114B`, khớp với độ nhạy của mắt người
— nên một vật đỏ tươi và một mảng xám trung tính có thể hội tụ về cùng một giá trị.

Nếu màu *chính là* tín hiệu, đừng dùng BGR cho việc đó. Hãy dùng HSV:

```cpp
cv::cvtColor(bgr, hsv, cv::COLOR_BGR2HSV);
cv::inRange(hsv, cv::Scalar(35, 80, 60), cv::Scalar(85, 255, 255), mask);  // xanh lá
```

Lý do là sự tách bạch: trong BGR, "màu xanh lá" là một vùng chéo trong khối lập phương 3 chiều
và nó dịch chuyển mỗi khi ánh sáng đổi. Trong HSV, sắc màu gần như độc lập với độ sáng, nên
một ngưỡng trên H sống sót qua một đám mây trôi ngang. Miền H của OpenCV là **0…179**, không
phải 0…360 — nó phải nhét vừa một byte. Màu đỏ vắt qua đầu miền, nên đỏ cần hai lời gọi
`inRange` rồi OR lại.

Với bất cứ việc gì liên quan tới khoảng cách màu theo cảm nhận, `COLOR_BGR2Lab` còn tốt hơn:
khoảng cách Euclid trong Lab xấp xỉ mức độ hai màu *trông* khác nhau.

## Bốn kiểu làm mờ

Làm mờ không phải một phép toán duy nhất. Chọn nhầm kiểu là lý do phổ biến nhất khiến một
pipeline hoặc chậm, hoặc sai một cách kín đáo.

```cpp
cv::blur(src, dst, {5,5});                        // hộp: trung bình cửa sổ
cv::GaussianBlur(src, dst, {5,5}, 1.5);           // trọng số theo khoảng cách
cv::medianBlur(src, dst, 5);                      // giá trị trung vị trong cửa sổ
cv::bilateralFilter(src, dst, 9, 75, 75);         // làm mờ nhưng giữ biên
```

| Bộ lọc | Chi phí | Diệt | Giữ | Dùng khi |
|---|---|---|---|---|
| Hộp | thấp nhất | nhiễu chung | không gì | bạn thật sự chỉ cần tốc độ |
| Gauss | thấp | nhiễu cảm biến | biên, hơi mềm | mặc định trước biên/ngưỡng |
| Trung vị | vừa | nhiễu muối tiêu, pixel chết | biên rất sắc | điểm ảnh hỏng, mặt nạ nhị phân |
| Song phương | rất cao | nhiễu trong vùng phẳng | biên chính xác | nhiếp ảnh, không phải thời gian thực |

Hai lưu ý thực dụng. Kích thước nhân Gauss phải lẻ; truyền `0` cho kích thước và chỉ đưa sigma
sẽ để OpenCV tự chọn kích thước tương ứng, và đó thường là điều bạn muốn. Còn lọc song phương
ở 1080p trên Pi tốn cỡ 400 ms mỗi khung — nó là một bộ lọc đẹp và nó không thuộc về vòng lặp
khung hình.

Luôn làm mờ trước khi phân ngưỡng hoặc dò biên. Cả hai đều khuếch đại thành phần tần số cao,
mà nhiễu chính là thành phần tần số cao.

## Phân ngưỡng: ba mức thích nghi

**Cố định** dùng được khi bạn làm chủ ánh sáng — một buồng kiểm tra kín, một nguồn sáng nền.

```cpp
cv::threshold(gray, bin, 127, 255, cv::THRESH_BINARY);
```

**Otsu** chọn giá trị giúp bạn, bằng cách tìm ngưỡng cực tiểu hoá phương sai bên trong hai
nhóm kết quả. Nó giả định histogram có hai đỉnh — vật sáng trên nền tối, hoặc ngược lại. Khi
giả định đó đúng thì nó tuyệt vời và miễn phí.

```cpp
double t = cv::threshold(gray, bin, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
// giá trị được chọn trả về; hãy ghi log — t nhảy loạn nghĩa là ánh sáng đang trôi
```

**Thích nghi** tính một ngưỡng cho từng lân cận, đúng thứ bạn cần khi chiếu sáng không đều —
một tài liệu bị đèn hắt từ một phía, một băng chuyền có bóng đổ vắt ngang.

```cpp
cv::adaptiveThreshold(gray, bin, 255,
                      cv::ADAPTIVE_THRESH_GAUSSIAN_C,
                      cv::THRESH_BINARY,
                      31,    // kích thước khối: LẺ, và lớn hơn chi tiết cần giữ
                      5);    // hằng số trừ khỏi trung bình cục bộ
```

Kích thước khối là tham số người ta hay đặt sai. Nó phải lớn hơn hẳn nét chữ hoặc chi tiết bạn
muốn giữ, nếu không thuật toán coi *bên trong* vật thể là nền cục bộ của chính nó và khoét
rỗng nó. Hãy bắt đầu ở khoảng ba lần bề rộng chi tiết rồi tinh chỉnh.

Nếu độ dốc ánh sáng mượt, có một cách chữa rẻ hơn phân ngưỡng thích nghi: ước lượng nền bằng
một phép làm mờ rất lớn rồi trừ đi.

```cpp
cv::Mat bg;
cv::GaussianBlur(gray, bg, {0,0}, 51);      // chỉ còn phần chiếu sáng nền
cv::Mat flat = gray - bg + 128;              // đã san phẳng, ngưỡng cố định lại dùng được
```

## Hình thái học: dọn sạch một mặt nạ nhị phân

Đầu ra của phép phân ngưỡng chẳng bao giờ sạch. Hình thái học sửa hai kiểu hỏng.

```cpp
cv::Mat k = cv::getStructuringElement(cv::MORPH_ELLIPSE, {5,5});

cv::morphologyEx(bin, bin, cv::MORPH_OPEN,  k);   // co rồi giãn: xoá đốm nhiễu
cv::morphologyEx(bin, bin, cv::MORPH_CLOSE, k);   // giãn rồi co: lấp lỗ thủng
```

- **Open** xoá mọi thứ nhỏ hơn nhân. Đây là bộ diệt đốm nhiễu của bạn.
- **Close** lấp khe hở nhỏ hơn nhân. Đây là cách chữa "vật thể của tôi bị thủng một lỗ".
- **Erode** thuần làm co vùng trắng, **dilate** làm nở ra. Dùng dilate để nối lại một đường
  biên bị đứt vì vệt chói.

*Hình dạng* nhân quan trọng hơn người ta tưởng. `MORPH_RECT` kéo mọi thứ về phía hình vuông;
`MORPH_ELLIPSE` là lựa chọn mặc định trung thực cho vật thể thật. Với chữ hoặc dây dẫn, một
nhân bất đẳng hướng — chẳng hạn `{15,1}` — sẽ nối các ký tự trên cùng một dòng mà không hàn
dính hai dòng khác nhau lại.

Open rồi close, đúng thứ tự đó, là cặp dọn dẹp chuẩn: diệt nhiễu trước để phép close không hàn
nhiễu vào vật thể.

## Biên: Canny, giải thích hai ngưỡng

```cpp
cv::Canny(blurred, edges, 60, 180);
```

Canny tính gradient, làm mảnh đáp ứng thành đường sống một pixel, rồi áp dụng *trễ ngưỡng*:
pixel trên ngưỡng cao là biên; pixel nằm giữa ngưỡng thấp và cao chỉ là biên nếu nó nối vào
một biên. Đó là lý do có hai con số và vì sao tỉ lệ quan trọng hơn giá trị tuyệt đối — 1:2 tới
1:3 là lời khuyên thông dụng.

Một điểm khởi đầu thích nghi theo ảnh chứ không theo tấm hình thử của bạn:

```cpp
cv::Scalar m = cv::mean(gray);
double hi = 1.33 * m[0], lo = 0.66 * m[0];
cv::Canny(blurred, edges, lo, hi);
```

Nếu biên trông như nhiễu hạt, bạn làm mờ chưa đủ. Nếu đường viền vật thể đứt thành từng vạch,
hãy hạ ngưỡng *thấp* xuống, hoặc giãn kết quả thêm một pixel.

## Ghép chuỗi lại

```cpp
cv::Mat gray, blur, bin, k = cv::getStructuringElement(cv::MORPH_ELLIPSE, {5,5});

cv::cvtColor(frame, gray, cv::COLOR_BGR2GRAY);          // 3 kênh -> 1 kênh
cv::GaussianBlur(gray, blur, {5,5}, 1.5);               // bỏ nhiễu cảm biến
cv::threshold(blur, bin, 0, 255,
              cv::THRESH_BINARY | cv::THRESH_OTSU);     // 256 mức -> 2
cv::morphologyEx(bin, bin, cv::MORPH_OPEN,  k);         // bỏ đốm
cv::morphologyEx(bin, bin, cv::MORPH_CLOSE, k);         // lấp lỗ
```

Năm tầng, từ 6,2 MB xuống một mặt nạ một bit mỗi pixel sạch sẽ, khoảng 4 ms ở 1080p trên
laptop. Mỗi tầng có một mục đích phát biểu được. Nếu bạn không phát biểu được mục đích cho một
dòng trong pipeline của mình, hãy xoá nó đi và xem có gì hỏng không — nhiều lần đến bất ngờ,
chẳng gì hỏng cả.

## Gỡ lỗi bằng cách nhìn, không phải bằng cách đoán

```cpp
cv::imshow("1 gray", gray);
cv::imshow("2 blur", blur);
cv::imshow("3 bin",  bin);
cv::imshow("4 clean", cleaned);
cv::waitKey(0);
```

Bốn cửa sổ, và tầng nào làm thông tin biến mất sẽ lộ ra ngay lập tức. Khi không có màn hình —
trên board chạy headless — hãy ghi ra file thay thế:

```cpp
cv::imwrite("/tmp/stage3_bin.png", bin);
```

Gần như mọi báo cáo "bộ phát hiện không chạy" mà tôi từng truy đều hoá ra đã lộ rõ ở tầng 2
hoặc 3 ngay khi có người chịu nhìn vào.

## Tự kiểm tra

1. Vì sao HSV tốt hơn BGR khi phân ngưỡng theo màu, và miền hue của OpenCV là bao nhiêu?
2. Khi nào bạn chọn trung vị thay vì Gauss?
3. Điều gì hỏng nếu kích thước khối của phân ngưỡng thích nghi nhỏ hơn vật thể của bạn?
4. Vì sao open trước close mà không phải ngược lại?

## Tiếp theo

Giờ bạn đã có một mặt nạ nhị phân sạch. Bài 3 biến nó thành quyết định: contour và các mô tả
hình dạng dùng để phân loại chúng, so khớp mẫu, và những bộ phát hiện cổ điển — Haar, HOG,
ArUco — vẫn thắng mạng nơ-ron khi ngân sách của bạn là một nhân ARM duy nhất.
