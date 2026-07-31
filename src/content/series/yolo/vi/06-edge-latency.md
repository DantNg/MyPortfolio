---
lesson: 6
lang: vi
title: "Đạt ngân sách độ trễ trên thiết bị biên"
description: "Đo độ trễ sao cho con số có ý nghĩa, thời gian đi đâu ngoài phần suy luận, gộp lô và chia tầng, cùng những con số trung thực cho Jetson, Coral, Rockchip và ARM thường."
duration: "16 phút"
tags: ["YOLO", "Thiết bị biên", "Độ trễ"]
---

## Con số trên tờ thông số không phải con số của bạn

"YOLOv8n chạy 8 ms trên Orin Nano" là con số suy luận, đo với đầu vào đã nằm sẵn trên thiết bị,
trong một vòng lặp, không có gì khác chạy cùng. Hệ thống của bạn còn phải thu một khung hình,
letterbox nó, chuẩn hoá nó, chép sang bộ tăng tốc, chép kết quả về, chạy NMS, và làm bất cứ
điều gì ứng dụng của bạn cần làm.

Một phân rã thực tế cho pipeline 30 FPS trên Jetson Orin Nano:

```
thu ảnh (CSI, zero-copy)     2 ms
letterbox + chuẩn hoá        4 ms      <- thường là bất ngờ
chép host -> device          1 ms
suy luận (TensorRT INT8)     8 ms
chép device -> host          1 ms
NMS (CPU)                    3 ms      <- tăng nhanh khi ngưỡng conf thấp
bám vật + ứng dụng           4 ms
                            ------
                            23 ms      -> trần 43 FPS, 30 FPS kèm dự phòng
```

Suy luận chiếm 35%. Chỉ tối ưu phần suy luận là tối ưu một phần ba vấn đề của bạn.

## Đo sao cho con số có ý nghĩa

```python
import time, numpy as np

for _ in range(30):                       # khởi động: cấp phát, ngữ cảnh CUDA, tự dò kernel
    model(dummy)

lat = []
for img in test_images:
    t0 = time.perf_counter()
    out = model(img)
    if torch.cuda.is_available(): torch.cuda.synchronize()   # nếu không, con số là giả
    lat.append((time.perf_counter() - t0) * 1000)

lat = np.array(lat)
print(f"trung bình {lat.mean():.1f}  p50 {np.percentile(lat,50):.1f} "
      f"p95 {np.percentile(lat,95):.1f}  p99 {np.percentile(lat,99):.1f}  max {lat.max():.1f}")
```

Ba quy tắc:

**Khởi động trước.** Lần suy luận đầu tiên trả giá cho cấp phát lười, khởi tạo ngữ cảnh CUDA và
việc TensorRT tự dò kernel. Nó có thể gấp 50 lần thời gian ổn định. Hãy bỏ ít nhất 30 lần đầu.

**Đồng bộ hoá.** Lời gọi GPU là bất đồng bộ. Không có `cuda.synchronize()` thì bạn đang đo thời
gian *xếp hàng* công việc, một con số nhỏ đẹp và hoàn toàn hư cấu.

**Báo cáo phân vị.** p99 là 60 ms so với trung bình 20 ms nghĩa là cứ một trăm khung có một
khung trễ — và với hệ thời gian thực thì đó mới là con số quan trọng. Giá trị trung bình che
giấu đúng cái hành vi bạn đang cố ngăn chặn.

Và hãy đo **trên thiết bị đích, trong vỏ hộp, khi đã nóng máy**. Jetson hay Pi trong hộp kín sẽ
hạ xung sau mười lăm hai mươi phút. Hãy đo trong một giờ, không phải một phút.

```bash
sudo tegrastats            # Jetson: xung nhịp, nhiệt độ, công suất
vcgencmd measure_temp      # Pi
```

## Thời gian thực sự đi đâu ngoài phần suy luận

**Tiền xử lý.** Letterbox và chuẩn hoá một khung 1080p bằng NumPy tốn 8–15 ms trên CPU ARM —
có thể nhiều hơn cả phần suy luận. Cách chữa, theo thứ tự lợi ích:

```python
# 1. Thu nhỏ trên GPU nếu có, hoặc bằng ISP nếu camera có sẵn.
# 2. Yêu cầu camera cho đúng kích thước bạn muốn, để không còn gì phải thu nhỏ.
# 3. Gộp phần chuẩn hoá vào đồ thị mô hình lúc export.
# 4. cv2.dnn.blobFromImage làm resize+chuẩn hoá+chuyển trục trong một lượt tối ưu:
blob = cv2.dnn.blobFromImage(img, 1/255.0, (640,640), swapRB=True, crop=False)
```

**NMS.** O(n²) theo số ứng viên còn sống, trên CPU. Ở `conf=0.05` bạn có thể có 900 ứng viên và
NMS tốn 20 ms; ở `conf=0.25` bạn có 40 và nó tốn 2 ms. **Hãy lọc theo độ tin cậy trước NMS**,
luôn luôn. Một dòng duy nhất này thường là thắng lợi dễ dàng lớn nhất trong cả pipeline.

**Sao chép bộ nhớ.** Mọi lần chuyển host↔device đều tốn. Hãy dùng bộ nhớ ghim, và trên Jetson
dùng bộ nhớ hợp nhất để tránh hẳn phép chép. Với camera CSI, đường thu ảnh zero-copy
(`nvarguscamerasrc` vào bộ đệm NVMM) bỏ được vài mili-giây mà bạn vốn không nhận ra là có.

**Python.** Chi phí thông dịch mỗi khung là 1–3 ms thuần vòng lặp. Không sao ở 10 FPS, đáng kể
ở 60. Con đường thông thường là Python để phát triển và C++ cho vòng lặp triển khai.

## Gộp lô, và khi nào nó là sai lầm

Gộp lô phân bổ chi phí cố định ra nhiều khung, nên thông lượng cải thiện:

| Lô | Tổng độ trễ | Mỗi khung | Thông lượng |
|---|---|---|---|
| 1 | 8 ms | 8 ms | 125 FPS |
| 4 | 22 ms | 5,5 ms | 182 FPS |
| 8 | 40 ms | 5 ms | 200 FPS |

Nhưng **độ trễ của khung đầu tiên trong lô lại tệ đi**, vì nó phải chờ những khung còn lại tới.
Ở 30 FPS, lô 8 nghĩa là khung đầu chờ 233 ms trước khi việc xử lý kịp bắt đầu.

- **Nhiều luồng camera** → gộp lô theo camera. Trường hợp lý tưởng: các khung vốn đã tồn tại
  đồng thời.
- **Xử lý ngoại tuyến video ghi sẵn** → gộp lô lớn hết mức bộ nhớ cho phép.
- **Một camera trực tiếp, cần phản hồi thời gian thực** → lô bằng 1. Phần thông lượng thu được
  không đáng với độ trễ phải trả.

## Chia tầng chạy song song

Thu ảnh, suy luận và hậu xử lý dùng các phần cứng khác nhau. Hãy cho chúng chồng lấn, đúng như
bài chia luồng trong series OpenCV:

```
không chia:  [thu][tiền][suy][hậu]  [thu][tiền][suy][hậu]      23 ms/khung
có chia:     [thu][tiền][suy][hậu]
                  [thu][tiền][suy][hậu]
                       [thu][tiền][suy][hậu]                    ~9 ms/khung
```

Thông lượng trở thành tầng chậm nhất thay vì tổng của mọi tầng. Độ trễ trên mỗi khung không
cải thiện — nó còn tệ đi chút ít — nên đây là kỹ thuật cho thông lượng, và bạn nên biết yêu cầu
của mình thực chất nói về cái nào trong hai cái đó.

Hãy dùng hàng đợi có giới hạn cỡ 1–2 giữa các tầng và **bỏ khung khi đầy**. Một hàng đợi không
giới hạn trong pipeline thời gian thực biến một thiếu hụt thông lượng nhỏ thành độ trễ tăng dần
vô hạn, và hệ thống trông vẫn ổn khi thử trên bàn rồi không dùng được sau mười phút.

## Bỏ bớt khung: đòn bẩy lớn nhất

Từ series OpenCV, và nó áp dụng nguyên vẹn ở đây: phát hiện mỗi N khung, bám vật ở giữa.

```python
if frame_no % 5 == 0:
    detections = model(frame)          # 23 ms
    tracker.update(detections)
else:
    tracker.predict()                  # 0,5 ms
```

Chi phí hiệu dụng mỗi khung: `(23 + 4×0,5) / 5 = 5 ms`. Rẻ hơn năm lần, và với vật thể di
chuyển ở tốc độ thông thường thì đầu ra không phân biệt được. Không gì khác trong bài này cho
lại nhiều đến vậy với ít công đến vậy.

Cái phải đánh đổi là độ trễ tới lần phát hiện *đầu tiên* của một vật thể mới — tối đa N khung.
Với một người đi vào khung hình ở 30 FPS và N=5, đó là 167 ms. Thường không đáng kể; với một
khoá liên động an toàn thì đáng.

## Con số trung thực theo nền tảng

YOLOv8n, 640×640, INT8 nơi nào hỗ trợ, chỉ tính phần suy luận:

| Nền tảng | Độ trễ | FPS | Ghi chú |
|---|---|---|---|
| RTX 4090 + TensorRT | 0,9 ms | 1100 | không phải mục tiêu triển khai của bạn |
| Jetson Orin Nano + TensorRT | 8 ms | 125 | lựa chọn biên thoải mái |
| Jetson Nano (đời cũ) + TensorRT | 45 ms | 22 | hết vòng đời, vẫn có mặt khắp nơi |
| NPU RK3588 (RKNN) | 25 ms | 40 | đáng tiền, công cụ hơi khó chịu |
| Coral Edge TPU | 15 ms | 65 | chỉ INT8, tập toán tử hạn chế |
| Raspberry Pi 5, ONNX INT8 | 95 ms | 10 | dùng được nếu bỏ bớt khung |
| Raspberry Pi 4, ONNX INT8 | 240 ms | 4 | phát hiện mỗi 10 khung + bám vật |
| Intel N100, OpenVINO | 22 ms | 45 | bị đánh giá thấp so với giá tiền |

Hãy đọc các số này như định hướng trong phạm vi sai số hai lần, không phải như một đặc tả.
Trạng thái nhiệt, băng thông bộ nhớ, những thứ khác đang chạy trên board, và các toán tử cụ thể
trong mô hình của bạn đều làm chúng dịch chuyển. **Hãy đo trên board của bạn.**

## Khi vẫn không đạt được ngân sách

Xếp theo mức lợi thường thu về:

1. **Bỏ bớt khung và bám vật.** 3–10×.
2. **Hạ độ phân giải đầu vào.** 640 → 416 rẻ hơn 2,4 lần. Hãy kiểm tra chi phí độ chính xác
   trên *vật thể của bạn*; thường là nhỏ.
3. **INT8**, nếu bạn còn ở FP32/FP16. 2–3×.
4. **Mô hình nhỏ hơn.** v8s → v8n là 2×.
5. **ROI.** Nếu vật thể chỉ xuất hiện ở một phần khung hình, hãy cắt trước khi suy luận. Miễn
   phí.
6. **NPU của hãng.** 5–10× so với CPU, đổi lại một bộ công cụ và công sức chuyển đổi.
7. **Một cách phát biểu bài toán khác.** Bạn có thật sự cần 30 FPS, hay chỉ vì ai đó nói
   "video" rồi mọi người mặc định như vậy? Nhiều hệ kiểm tra và đếm chạy tốt ở 5 FPS, và điều
   đó thay đổi ngân sách phần cứng cả một bậc.

Điều số 7 là điều không ai hỏi và nó đã cứu nhiều dự án hơn sáu điều còn lại cộng lại.

## Danh sách kiểm tra khi lên sản xuất

- [ ] Độ trễ p99 đo trên thiết bị đích, trong vỏ hộp, sau một giờ.
- [ ] Pipeline bỏ khung khi quá tải chứ không xếp hàng thành độ trễ tăng dần.
- [ ] Mô hình, tên lớp, các ngưỡng và tham số tiền xử lý được đánh phiên bản cùng nhau.
- [ ] Ngưỡng tin cậy và ngưỡng NMS đặt theo đường cong PR, không chép từ hướng dẫn trên mạng.
- [ ] Có xử lý sự cố: camera rớt kết nối, bộ tăng tốc lỗi, thiếu file mô hình.
- [ ] Bộ nhớ phẳng qua 24 giờ chạy. Vòng lặp phát hiện rất dễ rò rỉ.
- [ ] Có cách chụp và lưu lại những khung hình mô hình làm sai — đó là bộ dữ liệu kế tiếp của
      bạn.

Mục cuối cùng quan trọng hơn vẻ ngoài của nó. Sản phẩm giá trị nhất mà một bộ phát hiện đang
chạy tạo ra chính là dòng những thất bại của chính nó, và một hệ thống vứt chúng đi thì chỉ có
thể cải thiện bằng cách đoán mò.

## Chỗ này để lại cho bạn những gì

Sáu bài: mô hình trả ra cái gì và giải mã thế nào, chọn mô hình nào và theo giấy phép nào, một
bộ dữ liệu không phá hoại bạn, huấn luyện đọc được một cách trung thực, một bản export đã kiểm
chứng, và một ngân sách độ trễ đo trên phần cứng thật.

Không phần nào trong đó là công việc mô hình hoá thường được viết bài, và tất cả chúng mới là
thứ quyết định một bộ phát hiện có chạy được ngoài thực địa hay không. Nếu bạn muốn tầng bên
dưới — thu ảnh, chia luồng, ngân sách tốc độ khung hình, và những kỹ thuật cổ điển thường khiến
mạng nơ-ron trở nên không cần thiết — series OpenCV bao phủ đúng phần đó.

## Tự kiểm tra

1. Vì sao phải gọi `cuda.synchronize()` trước khi dừng đồng hồ?
2. Khi nào gộp lô có hại, và khi nào nó có lợi?
3. Vì sao lọc theo độ tin cậy trước NMS lại quan trọng đến thế?
4. Phát hiện mỗi 5 khung thay vì mỗi khung phải đánh đổi điều gì?
