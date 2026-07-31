---
lesson: 2
lang: vi
title: "Chọn phiên bản, và câu chuyện giấy phép"
description: "Giữa YOLOv5, v8 và v11 thực sự đổi gì, các cỡ n/s/m/l/x tốn bao nhiêu về độ trễ và độ chính xác, khi nào một bộ phát hiện không phải YOLO là câu trả lời tốt hơn, và vấn đề AGPL không ai nhắc tới cho tới lúc bộ phận pháp lý lên tiếng."
duration: "14 phút"
tags: ["YOLO", "Chọn mô hình", "Giấy phép"]
---

## Vòng xoay phiên bản, gói trong một đoạn

YOLOv1 tới v4 đến từ nhóm tác giả gốc. v5 đến từ Ultralytics, viết bằng PyTorch, và thắng nhờ
dễ dùng chứ không nhờ đột phá. v6 (Meituan), v7 (nhóm tác giả v4) và v9 là các nhánh nghiên
cứu. v8 và v11 lại là Ultralytics, và thay đổi thật sự của v8 nằm ở kiến trúc: **dự đoán không
dùng anchor với đầu tách rời**, nghĩa là không phải tinh chỉnh hộp anchor và tensor đầu ra sạch
hơn. v10 loại bỏ hẳn NMS khỏi pipeline bằng cách huấn luyện mô hình chỉ phát ra một hộp cho
mỗi vật thể.

Bạn không cần phần lịch sử này. Bạn cần biết rằng chênh lệch độ chính xác giữa các phiên bản
gần đây chỉ vài điểm mAP, và **những khác biệt thực sự quyết định dự án của bạn là công cụ, khả
năng export và giấy phép.**

## Các cỡ tốn bao nhiêu

YOLOv8 trên COCO, đầu vào 640×640:

| Mô hình | Tham số | mAP@50-95 | GPU T4 | Jetson Orin Nano | Pi 4 CPU |
|---|---|---|---|---|---|
| v8n | 3,2 M | 37,3 | 1,5 ms | 8 ms | 240 ms |
| v8s | 11,2 M | 44,9 | 2,7 ms | 15 ms | 620 ms |
| v8m | 25,9 M | 50,2 | 5,9 ms | 33 ms | 1,6 s |
| v8l | 43,7 M | 52,9 | 9,1 ms | 55 ms | — |
| v8x | 68,2 M | 53,9 | 14,4 ms | 88 ms | — |

Hãy đọc bảng đó như một đường cong có khuỷu. **Từ n lên s: +7,6 mAP đổi lấy 1,8 lần thời
gian.** Từ l lên x: +1,0 mAP đổi lấy 1,6 lần thời gian. Gần như không ai nên chạy cỡ x trên
thiết bị biên; hai điểm mAP cuối cùng tốn nhiều hơn phần chúng mang lại, và bạn sẽ được nhiều
hơn nếu đi sửa bộ dữ liệu.

Hai điều cần đính chính:

- **Đây là số liệu COCO, trên 80 lớp.** Bài toán 3 lớp của bạn dễ hơn nhiều. Một mô hình nano
  tinh chỉnh trên bộ dữ liệu chuyên dụng tốt thường xuyên vượt qua con số COCO của một mô hình
  lớn, trên đúng tác vụ đó.
- **Kích thước đầu vào quan trọng ngang kích thước mô hình.** v8n ở 320×320 nhanh gấp khoảng
  bốn lần so với 640×640 và mất cỡ 6 mAP. Nếu vật thể của bạn chiếm phần lớn khung hình, đó là
  đánh đổi tốt hơn nhiều so với hạ xuống mô hình nhỏ hơn.

## Chọn thế nào cho đúng

Hãy đi ngược từ mục tiêu triển khai, đừng đi xuôi từ bảng xếp hạng.

**Bắt đầu ở nano.** Luôn luôn. Huấn luyện nó, đo trên tập validation của bạn, và chỉ đi lên
nếu nó thực sự không đủ chính xác. Một nửa số dự án khởi đầu với `yolov8m` lẽ ra đã triển khai
được với `yolov8n` ở tốc độ khung hình gấp bốn.

**Rồi kiểm tra ngân sách độ trễ** — toàn bộ ngân sách, như trong series OpenCV: thu ảnh, tiền
xử lý, suy luận, NMS, và phần logic của bạn. Suy luận thường chiếm 60–70%, không phải 100%.

**Rồi xem xét vật thể.** Nếu thứ bạn phát hiện nhỏ trong khung hình — dưới khoảng 30 px — bạn
cần độ phân giải đầu vào, không phải tham số. Một v8n ở 1280 thắng v8m ở 640 với vật thể nhỏ,
và thường còn nhanh hơn.

Định hướng thô theo mục tiêu:

- **Jetson Orin / GPU khá** — v8s hoặc v8m ở 640. Bạn có dư chỗ.
- **Jetson Nano, RK3588, Coral** — v8n ở 416 hoặc 640, INT8. Đây là trường hợp biên phổ biến.
- **Raspberry Pi, ARM thường** — v8n ở 320, INT8, và hãy thành thật cân nhắc lại xem cách tiếp
  cận cổ điển trong series OpenCV có giải được bài toán của bạn với 2% lượng tính toán không.
- **Vi điều khiển** — không phải YOLO. Hãy tìm một mô hình siêu nhỏ chuyên dụng hoặc thị giác
  cổ điển.

## Vấn đề giấy phép

Điều này đã khiến nhiều công ty mất tiền thật và gần như không bao giờ được nhắc trong các
hướng dẫn.

**YOLOv5, v8 và v11 của Ultralytics dùng AGPL-3.0.** Điều khoản mạng của AGPL nghĩa là nếu
phần mềm của bạn được dùng qua mạng — một dịch vụ web, một thiết bị gọi về máy chủ, một API —
bạn phải cung cấp toàn bộ mã nguồn tương ứng của ứng dụng theo AGPL. Không chỉ mô hình. Cả ứng
dụng của bạn.

Các lựa chọn của bạn:

1. **Mua giấy phép thương mại của Ultralytics.** Đơn giản, định giá theo công ty, và là câu
   trả lời thông thường cho một sản phẩm thương mại.
2. **Dùng bộ phát hiện có giấy phép dễ chịu.** YOLOX (Apache 2.0), NanoDet (Apache 2.0), các
   biến thể RT-DETR, hoặc kho mô hình của MMDetection. Hơi mất công hơn, không rủi ro giấy
   phép.
3. **Xác nhận rằng AGPL thực sự ổn với bạn.** Công cụ nội bộ không có người dùng bên ngoài qua
   mạng, hoặc một dự án mã nguồn mở thật sự.

Điều **không** có tác dụng là giả định phổ biến rằng "chúng tôi chỉ dùng trọng số, không dùng
mã nguồn". Bạn có dùng mã nguồn — để huấn luyện, để export, và thường là để suy luận. Hãy kiểm
tra việc này ở đầu dự án, chứ không phải khi đợt rà soát pháp lý ập tới hai tuần trước ngày ra
mắt.

## Các lựa chọn thay thế đáng biết

| Mô hình | Giấy phép | Điểm mạnh | Dùng khi |
|---|---|---|---|
| **YOLOX** | Apache 2.0 | không anchor, độ chính xác gần v8 | bạn cần giấy phép dễ chịu |
| **NanoDet-Plus** | Apache 2.0 | ~1 M tham số, làm cho ARM | mục tiêu CPU rất nhỏ |
| **MobileNet-SSD** | Apache 2.0 | cũ, có mặt khắp nơi, nhỏ | phần cứng có kho mô hình NPU cố định |
| **RT-DETR** | Apache 2.0 | transformer, không cần NMS | triển khai GPU, cảnh đông đúc |
| **YOLO-NAS** | hỗn hợp — hãy đọc kỹ | lượng tử hoá INT8 rất tốt | bạn định chạy INT8 trên GPU |

Và điều cần kiểm tra trước tất cả những cái trên: **runtime của phần cứng đích thực sự hỗ trợ
gì?** Coral Edge TPU cần TFLite INT8 toàn phần với tập toán tử được hỗ trợ. NPU của Rockchip
cần chuyển đổi RKNN. Hailo cần trình biên dịch riêng. Mô hình chuyển đổi sạch cho bộ tăng tốc
của bạn thắng mô hình cao hơn hai điểm mà không chuyển đổi được. Hãy tìm danh sách mô hình được
hỗ trợ của nhà cung cấp *trước khi* chọn, đừng để sau.

## Cứ dùng mô hình đã huấn luyện sẵn, nếu được

Trước khi huấn luyện bất cứ thứ gì, hãy kiểm tra xem các lớp COCO có bao phủ nhu cầu của bạn
không. 80 lớp đó bao gồm người, ô tô, xe tải, xe buýt, xe đạp, chó, mèo, chai, ghế, laptop,
điện thoại, và nhiều nữa.

```python
from ultralytics import YOLO
model = YOLO("yolov8n.pt")
results = model("street.jpg", classes=[0, 2, 7])   # chỉ người, ô tô, xe tải
```

Nếu bạn cần người và phương tiện, thế là xong — không bộ dữ liệu, không huấn luyện, không ngân
sách gán nhãn. Lọc xuống đúng các lớp cần thiết còn giúp NMS nhanh hơn. Một số lượng dự án
đáng ngạc nhiên đã bỏ ba tuần dựng bộ dữ liệu cho việc mà mô hình huấn luyện sẵn đã làm được.

Hãy tinh chỉnh khi vật thể của bạn không có trong COCO, khi chúng khác thường về thị giác (chi
tiết công nghiệp, ảnh y tế, ảnh chụp từ trên cao), hoặc khi mô hình sẵn yếu một cách đo được
trên chính đoạn phim *của bạn*. Hãy đo điều đó trước — chạy mô hình sẵn trên 200 khung hình
thật của bạn và đếm lỗi bằng tay. Việc đó mất một buổi chiều và nó quyết định cả tháng sau.

## Quyết định, rút gọn

1. Mô hình COCO có sẵn làm được không? → triển khai luôn.
2. Cần tinh chỉnh? → bắt đầu với `yolov8n`, ở kích thước đầu vào của mục tiêu.
3. Đã đủ chính xác trên tập validation chưa? → dừng lại. Đừng lên cỡ lớn hơn theo thói quen.
4. Chưa đủ chính xác? → **thêm/cải thiện dữ liệu trước khi tăng mô hình.** Gần như luôn là
   thắng lợi lớn hơn.
5. Sản phẩm thương mại? → giải quyết giấy phép ngay bây giờ.
6. Có bộ tăng tốc cụ thể? → kiểm tra danh sách mô hình nó hỗ trợ trước khi cam kết.

## Tự kiểm tra

1. Vì sao bước từ v8n lên v8s thường đáng còn từ l lên x thường không?
2. Khi nào độ phân giải đầu vào là đòn bẩy tốt hơn kích thước mô hình?
3. Điều khoản mạng của AGPL đòi hỏi gì, và ảnh hưởng tới ai?
4. Bạn nên kiểm tra điều gì về bộ tăng tốc đích trước khi chọn mô hình?

## Tiếp theo

Bạn đã chọn được mô hình. Bài 3 là phần quyết định nó có chạy được hay không: dựng bộ dữ liệu.
Định dạng nhãn, cách chia tập không bị rò rỉ, mất cân bằng lớp, những lỗi gán nhãn âm thầm
chặn trần độ chính xác, và bạn thực sự cần bao nhiêu ảnh.
