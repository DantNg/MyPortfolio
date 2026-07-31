---
lesson: 5
lang: vi
title: "Chuyển động và bám vật"
description: "Sai khác khung hình so với MOG2, optical flow thưa và dày, các tracker có sẵn cùng chi phí của từng loại, và một bộ lọc Kalman giữ định danh vật thể sống qua lần bị che khuất."
duration: "16 phút"
tags: ["OpenCV", "Bám vật", "Optical Flow"]
---

## Phát hiện thì đắt; bám vật thì rẻ

Chạy bộ phát hiện trên mọi khung hình là thiết kế hiển nhiên và thường là thiết kế sai. Phát
hiện trả lời "trong ảnh này có gì", một câu hỏi khó. Bám vật trả lời "cái tôi đã tìm thấy giờ
dịch đi đâu", câu hỏi dễ hơn nhiều vì bạn có tiên nghiệm — vật thể ở *đây* 33 mili-giây trước
và vật thể không dịch chuyển tức thời.

Khuôn mẫu mở rộng được: **phát hiện mỗi N khung, bám vật ở giữa.** Một bộ phát hiện 4 FPS cộng
một tracker 200 FPS cho bạn hệ thống hành xử như 30 FPS. Gần như mọi hệ thị giác đã triển khai
đều dựng theo cách này.

## Sai khác khung hình: tín hiệu chuyển động rẻ nhất

```cpp
cv::absdiff(prevGray, gray, diff);
cv::threshold(diff, motion, 25, 255, cv::THRESH_BINARY);
cv::morphologyEx(motion, motion, cv::MORPH_OPEN, k);
prevGray = gray.clone();
```

Bốn dòng, dưới một mili-giây, và nó thực sự trả lời được "có gì vừa động đậy không" trên
camera cố định. Hạn chế cũng đơn giản không kém: vật đứng yên biến mất, vật có màu đồng nhất
chỉ lộ mép trước và mép sau, và mọi thay đổi ánh sáng đều là chuyển động.

## MOG2: mô hình nền biết thích nghi

```cpp
auto bg = cv::createBackgroundSubtractorMOG2(500,    // lịch sử, tính bằng khung
                                             16,     // ngưỡng phương sai
                                             true);  // phát hiện bóng đổ
bg->apply(frame, fgMask);
```

MOG2 mô hình hoá mỗi pixel bằng một hỗn hợp Gauss, nên nó chịu được những thứ sai khác khung
hình không chịu nổi: một cành cây đung đưa, một màn hình nhấp nháy, ánh sáng ban ngày thay đổi
từ từ. Nó cho bạn cả vật thể chứ không chỉ đường biên, và nó gán nhãn bóng đổ là xám (127) chứ
không phải tiền cảnh, nên `threshold(fgMask, fgMask, 200, 255, THRESH_BINARY)` loại bỏ chúng.

Ba tham số quan trọng ngoài thực địa:

- **history** — nền thích nghi nhanh cỡ nào. Quá ngắn thì vật thể dừng lại sẽ tan vào nền; quá
  dài thì nó chẳng bao giờ quên cái thùng ai đó dời đi từ một tiếng trước.
- **learningRate** trong `apply(frame, mask, rate)` — truyền `0` để đóng băng mô hình (hữu ích
  khi có thứ gì đó đỗ hợp lệ trong khung hình) hoặc một giá trị lớn để học lại thật nhanh sau
  một thay đổi ánh sáng.
- **phát hiện bóng đổ** tốn khoảng 15% và gần như luôn đáng giá khi làm ngoài trời.

KNN (`createBackgroundSubtractorKNN`) là lựa chọn thay thế; nó xử lý tốc độ khung hình thấp tốt
hơn và tốn hơn một chút. Hãy thử cả hai trên đoạn video của bạn — hai mươi phút so sánh hơn
một cuộc tranh luận.

Không cái nào sống sót với camera bị dịch chuyển. Nếu camera treo trên cột giữa gió, hãy ổn
định ảnh trước, hoặc dùng optical flow thay thế.

## Optical flow thưa: bám theo điểm

Lucas–Kanade bám các điểm cụ thể từ khung này sang khung kế.

```cpp
std::vector<cv::Point2f> p0, p1;
cv::goodFeaturesToTrack(prevGray, p0, 200, 0.01, 10);   // góc thì bám được

std::vector<uchar> status; std::vector<float> err;
cv::calcOpticalFlowPyrLK(prevGray, gray, p0, p1, status, err,
                         cv::Size(21,21), 3);

for (size_t i = 0; i < p1.size(); ++i)
    if (status[i]) cv::line(vis, p0[i], p1[i], {0,255,0}, 2);
```

Nhanh — vài trăm điểm trong một hai mili-giây — và chính xác tới phần lẻ pixel. Hai điều cần
thấm:

**Nó chỉ bám được góc.** Một điểm giữa bức tường trống không có diện mạo cục bộ riêng biệt,
nên thuật toán không thể nói nó đã đi đâu. Đây là bài toán khẩu độ, và đó là lý do
`goodFeaturesToTrack` tồn tại.

**Số tầng kim tự tháp là giới hạn tốc độ.** Tầng 3 với cửa sổ 21×21 xử lý được chuyển động vài
chục pixel giữa hai khung. Nhanh hơn thế thì các điểm đơn giản là mất. Hãy tăng số tầng cho
chuyển động nhanh, hoặc thu ảnh ở tốc độ khung hình cao hơn.

Luôn lọc theo `status`, và hãy phát hiện lại đặc trưng định kỳ — bạn mất 5–10% mỗi khung vì
che khuất và trôi, nên một tracker không bao giờ gieo lại điểm sẽ cạn điểm sau vài giây.

## Optical flow dày: một vector cho mỗi pixel

```cpp
cv::calcOpticalFlowFarneback(prevGray, gray, flow,
                             0.5, 3, 15, 3, 5, 1.2, 0);
// flow là CV_32FC2: flow.at<Point2f>(y,x) là độ dịch chuyển của pixel đó

cv::Mat mag, ang, parts[2];
cv::split(flow, parts);
cv::cartToPolar(parts[0], parts[1], mag, ang);
```

Mỗi pixel nhận một vector chuyển động, đúng thứ bạn cần cho dòng đám đông, chuyển động chất
lỏng, hoặc phân vùng hiện trường theo cách các vật di chuyển. Nó tốn 30–80 ms ở VGA trên CPU
laptop, nên không phải công cụ cho vòng lặp khung hình trên phần cứng nhúng.
`cv::DISOpticalFlow` nhanh hơn vài lần với chất lượng tương đương và giờ là lựa chọn mặc định
tốt hơn.

## Các tracker có sẵn

```cpp
cv::Ptr<cv::Tracker> tracker = cv::TrackerCSRT::create();
tracker->init(frame, cv::Rect(x, y, w, h));

while (cap.read(frame)) {
    cv::Rect box;
    if (tracker->update(frame, box))
        cv::rectangle(frame, box, {0,255,0}, 2);
    else
        redetect();                 // LUÔN LUÔN phải có nhánh này
}
```

| Tracker | Tốc độ (720p, laptop) | Theo tỉ lệ | Ghi chú |
|---|---|---|---|
| `TrackerMIL` | ~25 FPS | không | bền, chậm, không báo thất bại |
| `TrackerKCF` | ~170 FPS | không | mặc định thực dụng |
| `TrackerCSRT` | ~25 FPS | có | chính xác nhất, xử lý được vật không chữ nhật |
| `TrackerNano` | ~60 FPS | có | mạng nơ-ron nhỏ, cần file mô hình |

KCF cho tốc độ, CSRT cho độ chính xác, và đó là phần lớn quyết định. Tất cả đều trôi và tất cả
đều hỏng sớm muộn; giá trị trả về của `update` là tín hiệu để chạy lại bộ phát hiện. Một
tracker không có đường phát hiện lại sẽ vui vẻ bám theo một mảng giấy dán tường suốt mười
phút.

Lưu ý các tracker của OpenCV là đơn vật thể. Bám nhiều vật nghĩa là một tracker cho mỗi vật
cộng một bước liên kết — chính là phần tiếp theo.

## Kalman: dự đoán xuyên qua lần che khuất

Một tracker mất mục tiêu bốn khung hình không nên mất *định danh* của nó. Một bộ lọc Kalman
vận tốc không đổi cho bạn ước lượng vị trí ngay cả khi không có phép đo nào.

```cpp
cv::KalmanFilter kf(4, 2, 0);          // trạng thái: x, y, vx, vy | đo: x, y
kf.transitionMatrix = (cv::Mat_<float>(4,4) <<
    1,0,1,0,
    0,1,0,1,
    0,0,1,0,
    0,0,0,1);
cv::setIdentity(kf.measurementMatrix);
cv::setIdentity(kf.processNoiseCov,     cv::Scalar::all(1e-2));
cv::setIdentity(kf.measurementNoiseCov, cv::Scalar::all(1e-1));

// mỗi khung:
cv::Mat pred = kf.predict();
if (haveDetection) {
    cv::Mat meas = (cv::Mat_<float>(2,1) << det.x, det.y);
    kf.correct(meas);                  // phép đo kéo ước lượng về
}
// dù có hay không, dùng pred (hoặc kf.statePost) làm vị trí
```

Hai ma trận hiệp phương sai nhiễu là toàn bộ phần tinh chỉnh thực sự. `processNoiseCov` là mức
bạn tin vật thể có thể đổi vận tốc; `measurementNoiseCov` là mức bạn nghi ngờ bộ phát hiện của
mình. Tăng cái đầu cho vật di chuyển thất thường, tăng cái sau khi bộ phát hiện rung và đầu ra
sẽ mượt đi.

## Ghép lại: phát hiện, bám, liên kết

Vòng lặp đa vật thể tiêu chuẩn, cũng là bộ xương của SORT và mọi thứ kế thừa từ nó:

```cpp
for (auto& t : tracks) t.predict();                        // 1. mỗi vật đáng lẽ ở đâu?

if (frameNo % 10 == 0) {
    auto dets = detector.run(frame);                       // 2. đắt, thỉnh thoảng mới chạy

    // 3. liên kết: ghép phát hiện với track theo IoU, tham lam hoặc bằng Hungarian
    for (auto& d : dets) {
        Track* best = nullptr; double bestIoU = 0.3;
        for (auto& t : tracks) {
            double i = iou(d.box, t.predictedBox());
            if (i > bestIoU) { bestIoU = i; best = &t; }
        }
        if (best) best->correct(d);                        // ghép được
        else      tracks.push_back(Track(d, nextId++));    // vật mới
    }
}

// 4. cho nghỉ những track lâu không ghép được
std::erase_if(tracks, [](const Track& t){ return t.missed > 30; });
```

Bốn bước: dự đoán, phát hiện, liên kết, cho nghỉ. Mọi thứ khác trong bám nhiều vật đều là tinh
chỉnh bước liên kết — độ đo khoảng cách tốt hơn, vector đặc trưng diện mạo, một phép gán
Hungarian đàng hoàng thay cho cách tham lam.

`missed > 30` ở 30 FPS nghĩa là vật thể giữ định danh qua một giây bị che. Con số đó là quyết
định sản phẩm, không phải quyết định kỹ thuật: quá nhỏ thì người đi bộ nhận ID mới mỗi lần đi
sau cây cột; quá lớn thì hai người khác nhau thừa hưởng chung một ID.

## Tự kiểm tra

1. Vì sao sai khác khung hình bỏ sót vật đứng yên còn MOG2 (trong một lúc) thì không?
2. Bài toán khẩu độ là gì, và `goodFeaturesToTrack` né nó bằng cách nào?
3. Khi nào bạn chọn KCF thay vì CSRT?
4. Tăng `measurementNoiseCov` tác động thế nào lên đầu ra?

## Tiếp theo

Bài cuối là bài quyết định liệu tất cả những thứ trên có triển khai được hay không: đo xem
thời gian khung hình thực sự đi đâu, chi phí thu ảnh và chuyển màu mà người ta hay quên, chia
luồng pipeline cho đúng, và những quyết định về độ phân giải và phần cứng giữ được tốc độ
khung hình trên một board thật.
