---
lesson: 4
lang: vi
title: "Hiệu chuẩn và đo bằng milimét"
description: "Mô hình pinhole, ma trận nội tại và hệ số méo thực sự nghĩa là gì, cách chạy hiệu chuẩn bàn cờ không cho ra rác, homography cho góc nhìn từ trên xuống, và solvePnP để lấy tư thế."
duration: "17 phút"
tags: ["OpenCV", "Hiệu chuẩn", "Hình học"]
---

## Pixel không phải là đơn vị đo chiều dài

"Chi tiết rộng 84 pixel" không phải là một phép đo. Nó phụ thuộc vào khoảng cách, vào tiêu cự
ống kính, vào vị trí chi tiết trong khung hình, và vào độ méo của ống kính. Để đổi pixel sang
milimét bạn cần một mô hình camera, và để có mô hình bạn cần hiệu chuẩn.

Đây là bài người ta hay bỏ qua, và là lý do rất nhiều phép đo bằng thị giác máy sai lặng lẽ ba
phần trăm.

![Mô hình pinhole và hiệu chuẩn](/MyPortfolio/images/opencv/pinhole-calibration.svg)

## Mô hình pinhole trong một phương trình

Một điểm 3 chiều trong hệ toạ độ camera chiếu lên ảnh theo:

```
s · [u v 1]ᵀ  =  K · [R | t] · [X Y Z 1]ᵀ
```

`[R|t]` là phần **ngoại tại** — camera nằm ở đâu so với thế giới. `K` là ma trận **nội tại**,
thuộc tính của chính camera:

```
      ⎡ fx   0   cx ⎤
K  =  ⎢  0  fy   cy ⎥
      ⎣  0   0    1 ⎦
```

- `fx`, `fy` — tiêu cự **tính bằng pixel**. Không phải milimét.
  `fx = F_mm · rộng_px / cảm_biến_mm`. Trên cảm biến hiện đại có pixel vuông thì `fx ≈ fy`;
  chênh lệch quá một hai phần trăm nghĩa là hiệu chuẩn sai hoặc ảnh đã bị co giãn không đều.
- `cx`, `cy` — điểm chính, nơi trục quang cắt cảm biến. Gần tâm ảnh nhưng hiếm khi đúng tâm.

**Mọi thứ co giãn theo độ phân giải.** Hiệu chuẩn ở 1920×1080 rồi chạy ở 640×360 thì cả bốn
con số đó phải nhân với 1/3. Hãy lưu độ phân giải hiệu chuẩn cùng với ma trận; đây là lỗi hiệu
chuẩn phổ biến nhất.

## Méo ống kính

Ống kính thật làm cong đường thẳng. OpenCV mô hình hoá bằng năm hệ số, `(k1, k2, p1, p2, k3)`:
ba số hạng xuyên tâm — cái bụng phình hoặc lõm bạn thấy trên ống góc rộng — và hai số hạng
tiếp tuyến cho trường hợp cảm biến không hoàn toàn song song với ống kính.

```cpp
cv::undistort(src, dst, K, dist);
```

Với luồng video, đừng gọi `undistort` mỗi khung. Hãy tính bản đồ một lần:

```cpp
cv::Mat map1, map2;
cv::initUndistortRectifyMap(K, dist, cv::Mat(), K, size, CV_16SC2, map1, map2);
// mỗi khung:
cv::remap(frame, undistorted, map1, map2, cv::INTER_LINEAR);
```

Nhanh hơn khoảng bốn lần, vì phần đắt là tính xem mỗi pixel đầu ra lấy từ đâu, và phần đó
chẳng bao giờ đổi.

Còn tốt hơn nữa, cho nhiều bài toán: đừng khử méo cả tấm ảnh. Chỉ khử méo vài *điểm* bạn đã
đo, bằng `cv::undistortPoints()`. Nắn sáu triệu pixel để sửa toạ độ bốn góc là việc thừa.

## Chạy một lần hiệu chuẩn thực sự tốt

```cpp
cv::Size boardSize(9, 6);          // số góc TRONG, không phải số ô
const float square_mm = 25.0f;

std::vector<cv::Point3f> objp;
for (int i = 0; i < boardSize.height; ++i)
  for (int j = 0; j < boardSize.width; ++j)
    objp.emplace_back(j * square_mm, i * square_mm, 0.f);

std::vector<std::vector<cv::Point3f>> objectPoints;
std::vector<std::vector<cv::Point2f>> imagePoints;

for (const auto& img : calibrationImages) {
    std::vector<cv::Point2f> corners;
    bool found = cv::findChessboardCorners(img, boardSize, corners,
                    cv::CALIB_CB_ADAPTIVE_THRESH | cv::CALIB_CB_NORMALIZE_IMAGE);
    if (!found) continue;

    cv::cornerSubPix(gray, corners, {11,11}, {-1,-1},
        {cv::TermCriteria::EPS + cv::TermCriteria::MAX_ITER, 30, 0.001});

    imagePoints.push_back(corners);
    objectPoints.push_back(objp);
}

cv::Mat K, dist;
std::vector<cv::Mat> rvecs, tvecs;
double rms = cv::calibrateCamera(objectPoints, imagePoints, imageSize,
                                 K, dist, rvecs, tvecs);
```

Lời gọi `cornerSubPix` không phải tuỳ chọn. Góc lấy theo số nguyên cho ra một hiệu chuẩn trông
có vẻ hợp lý và đo thì sai.

**Thứ phân biệt hiệu chuẩn tốt với hiệu chuẩn vô dụng là bộ ảnh, không phải đoạn code:**

- **20 đến 30 góc chụp**, không phải năm. Dưới khoảng mười lăm thì các tham số bị thiếu ràng
  buộc.
- **Phủ kín khung hình trên cả bộ ảnh.** Nhất là các góc và mép — méo nằm ở đó, và một bộ ảnh
  chỉ chụp ở giữa thì không nhìn thấy `k1` chút nào.
- **Nghiêng bảng.** Các góc chụp nghiêng 30–45° theo nhiều hướng chính là thứ tách được `fx`
  khỏi `Z`. Một bộ ảnh chụp thẳng góc gần như suy biến và sẽ cho ra một tiêu cự sai một cách
  tự tin.
- **In phẳng và kiểm tra.** Bàn cờ dán lên tấm bìa hơi vênh sẽ đưa sai số hệ thống vào mọi thứ
  phía sau. Hãy dùng kính hoặc tấm nhôm composite, hoặc chấp nhận sai số.
- **Cho bảng lấp đầy khung hình**, đừng dùng bảng nhỏ chụp từ xa.

Hãy đánh giá kết quả bằng sai số tái chiếu `rms`, tính bằng pixel. **Dưới 0,5 là tốt, dưới 1,0
là dùng được, trên 1,5 nghĩa là có gì đó sai** — thường là bảng bị nhận nhầm hoặc target bị
cong. Cũng nên kiểm tra sai số từng góc chụp, loại bỏ những ảnh tệ nhất rồi hiệu chuẩn lại.

Với ống mắt cá — bất cứ thứ gì quá khoảng 120° — hãy dùng `cv::fisheye::calibrate`. Mô hình
chuẩn không biểu diễn nổi mức méo đó và sẽ khớp ra số vô nghĩa.

## Milimét trên pixel, một cách trung thực

Với camera đã hiệu chuẩn nhìn vuông góc vào một mặt phẳng cách `Z` đã biết:

```
mm_trên_px = Z_mm / fx
```

Nên một chi tiết trải 84 px ở `Z = 500 mm` với `fx = 1400` đo được
`84 × 500 / 1400 = 30,0 mm`.

Mọi chữ trong câu đó đều gánh trọng lượng. **Vuông góc**: nghiêng camera 5° là bạn đưa vào một
độ dốc tỉ lệ trải ngang khung hình. **Khoảng cách đã biết**: một camera đơn không đo được `Z`;
bạn phải cố định nó bằng cơ khí, hoặc đo nó, hoặc đặt một vật tham chiếu đã biết kích thước
vào hiện trường. **Đã khử méo**: ở rìa một ống góc rộng, méo chưa sửa lên tới vài phần trăm.

Nếu cần đo ở nhiều độ sâu khác nhau, bạn cần camera thứ hai, một cảm biến độ sâu, hoặc một vật
đã biết kích thước nằm trong đúng mặt phẳng cần đo.

## Homography: góc nhìn từ trên xuống

Khi mọi thứ đáng quan tâm nằm trên một mặt phẳng, homography ánh xạ ảnh về mặt phẳng đó — sửa
hoàn toàn phối cảnh.

```cpp
std::vector<cv::Point2f> src = {  /* bốn góc trong ảnh */ };
std::vector<cv::Point2f> dst = { {0,0}, {400,0}, {400,300}, {0,300} };  // mm × 1 px/mm

cv::Mat H = cv::getPerspectiveTransform(src, dst);
cv::warpPerspective(frame, topDown, H, cv::Size(400, 300));
```

Giờ một pixel đúng bằng một milimét, ở mọi chỗ trong ảnh đầu ra, và bạn đo được bằng thước.
Máy quét tài liệu, lớp phủ đồ hoạ trên sân bóng và hệ kiểm tra băng chuyền đều chạy như vậy.

Với nhiều hơn bốn cặp điểm tương ứng, hãy dùng `cv::findHomography(src, dst, cv::RANSAC, 3.0)`
— RANSAC loại bỏ các cặp ghép sai thay vì trung bình chúng vào một đáp án sai.

Và lần nữa: hãy áp `H` lên *điểm* khi bạn chỉ cần thế. `cv::perspectiveTransform` trên bốn
điểm gần như không tốn gì; nắn cả khung hình tốn hàng mili-giây.

## Tư thế với solvePnP

Cho một camera đã hiệu chuẩn và bốn điểm trở lên biết trước vị trí 3 chiều, bạn nhận được tư
thế 6 bậc tự do đầy đủ của vật thể:

```cpp
cv::Mat rvec, tvec;
cv::solvePnP(objectPoints3d, imagePoints2d, K, dist, rvec, tvec);

cv::Mat R;  cv::Rodrigues(rvec, R);        // vector quay -> ma trận 3x3
double distance_mm = cv::norm(tvec);
```

`tvec` là vị trí vật thể trong hệ toạ độ camera, theo đúng đơn vị bạn dùng cho
`objectPoints3d` — dùng milimét thì nhận về milimét. `rvec` là vector quay Rodrigues;
`cv::Rodrigues` đổi nó thành ma trận.

Kết hợp với ArUco ở bài 3, đây là một pipeline tư thế hoàn chỉnh trong khoảng mười lăm dòng,
và đó chính là bản chất của hầu hết hệ AR dựa trên marker cùng các hệ đăng ký toạ độ robot.
Hãy dùng `cv::SOLVEPNP_IPPE_SQUARE` cho marker vuông phẳng — nó nhanh hơn và điều kiện số tốt
hơn phương pháp lặp mặc định.

## Lưu lại hiệu chuẩn

```cpp
cv::FileStorage fs("calib.yml", cv::FileStorage::WRITE);
fs << "image_width" << imageSize.width << "image_height" << imageSize.height;
fs << "K" << K << "dist" << dist << "rms" << rms
   << "date" << currentDateString();
```

Hãy lưu độ phân giải và ngày tháng cùng với nó. Hiệu chuẩn là thuộc tính của một cụm
camera–ống kính cụ thể: nó sống sót qua lần khởi động lại, và nó không sống sót khi có người
chỉnh lại nét, va vào camera, hay thay bằng một module "y hệt" từ lô sau. Hãy hiệu chuẩn lại
sau mọi can thiệp cơ khí, và giữ RMS trong log để bạn nhận ra sự trôi.

## Tự kiểm tra

1. Vì sao phải co giãn `K` khi đổi độ phân giải thu ảnh?
2. Bộ ảnh hiệu chuẩn chụp toàn thẳng góc sai ở chỗ nào?
3. Khi nào `undistortPoints` tốt hơn `undistort`?
4. Ngoài `fx`, bạn cần gì nữa để đổi một bề rộng tính bằng pixel sang milimét?

## Tiếp theo

Xong phần hình học tĩnh. Bài 5 thêm chiều thời gian: trừ nền, sai khác khung hình, optical
flow cả thưa lẫn dày, các tracker có sẵn, và một bộ lọc Kalman giữ cho định danh vật thể sống
qua một lần bị che khuất.
