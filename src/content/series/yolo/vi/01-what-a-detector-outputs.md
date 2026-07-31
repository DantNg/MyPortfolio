---
lesson: 1
lang: vi
title: "Bộ phát hiện thực sự trả ra cái gì"
description: "Tensor thô mà một mô hình YOLO sinh ra, cách tự tay giải mã nó, vì sao IoU và NMS quyết định một nửa kết quả của bạn, và mAP@50-95 thực sự đo cái gì."
duration: "15 phút"
tags: ["YOLO", "NMS", "mAP"]
---

## Tensor, trước khi có người làm đẹp nó

`model(img)` trả về một danh sách hộp gọn gàng đã che đi đúng thứ bạn cần hiểu nhất. Một mô
hình YOLOv8 nhận ảnh 640×640 sinh ra một tensor duy nhất có dạng:

```
(1, 84, 8400)
```

- **8400** — số dự đoán ứng viên. Nó bằng `80² + 40² + 20²`: ba đầu phát hiện ở bước nhảy 8,
  16 và 32. Mỗi ô trong số đó luôn dự đoán một hộp, bất kể ở đó có gì hay không.
- **84** — 4 giá trị hộp + 80 điểm lớp, với mô hình COCO. Trên bộ dữ liệu 3 lớp của bạn thì
  con số này là 7.
- 4 giá trị hộp là `cx, cy, w, h` tính bằng **pixel của đầu vào mạng**, không phải của ảnh
  gốc, và không được chuẩn hoá.

Hai điều rút ra ngay. Thứ nhất, mô hình không quyết định cái gì là vật thể — nó phát ra 8400
phỏng đoán và *hậu xử lý* mới quyết định. Thứ hai, nếu hộp của bạn ra sai chỗ, lỗi gần như
luôn nằm ở phép biến đổi toạ độ giữa đầu vào mạng và ảnh gốc, chứ không phải ở mô hình.

![Từ tensor thô tới hộp cuối cùng](/MyPortfolio/images/yolo/detector-output.svg)

## Tự tay giải mã, một lần

Làm việc này một lần rồi bạn sẽ không bao giờ còn bối rối trước một bản triển khai cho ra
hộp nằm dồn ở góc trên bên trái.

```python
import numpy as np

out = raw[0].T                        # (8400, 84)
boxes_xywh = out[:, :4]               # cx, cy, w, h  trong không gian 640
class_scores = out[:, 4:]             # (8400, 80)

conf = class_scores.max(axis=1)
cls  = class_scores.argmax(axis=1)

keep = conf > 0.25                    # ngưỡng tin cậy
boxes_xywh, conf, cls = boxes_xywh[keep], conf[keep], cls[keep]

# xywh (tâm) -> xyxy (góc)
xy = boxes_xywh[:, :2]; wh = boxes_xywh[:, 2:]
boxes = np.concatenate([xy - wh / 2, xy + wh / 2], axis=1)

keep = nms(boxes, conf, iou_threshold=0.45)
boxes, conf, cls = boxes[keep], conf[keep], cls[keep]

boxes = undo_letterbox(boxes, orig_shape, (640, 640))   # về lại pixel ảnh gốc
```

**Hãy để ý thứ KHÔNG có ở đây.** YOLOv8 trở đi không có điểm "objectness" riêng — điểm lớp
*chính là* độ tin cậy. YOLOv5 thì có, và đầu ra của nó là `(1, 25200, 85)` với cột thừa là
objectness mà bạn phải nhân với điểm lớp. Lẫn lộn hai quy ước này là nguyên nhân phổ biến nhất
khiến một mô hình đang chạy tốt cho ra rác sau khi export.

## Letterbox, và lỗi lệch một dải

Mạng muốn 640×640; camera của bạn cho 1920×1080. Bóp méo tỉ lệ làm biến dạng mọi vật thể, nên
chuẩn mực là *letterbox*: co cho vừa, phần còn lại đệm màu xám.

```
1920x1080  --co 0.333-->  640x360  --đệm 140 trên+dưới-->  640x640
```

Nghĩa là gỡ nó ra không chỉ là một phép nhân:

```python
def undo_letterbox(boxes, orig_shape, net_shape=(640, 640)):
    oh, ow = orig_shape
    r = min(net_shape[0] / oh, net_shape[1] / ow)
    pad_x = (net_shape[1] - ow * r) / 2
    pad_y = (net_shape[0] - oh * r) / 2
    boxes[:, [0, 2]] = (boxes[:, [0, 2]] - pad_x) / r
    boxes[:, [1, 3]] = (boxes[:, [1, 3]] - pad_y) / r
    return boxes
```

Quên trừ phần đệm là mọi hộp lệch dọc 140 pixel. Nó trông như mô hình hỏng; thực ra là bốn
dòng số học.

## IoU: một con số, dùng khắp nơi

```python
def iou(a, b):
    x1 = max(a[0], b[0]); y1 = max(a[1], b[1])
    x2 = min(a[2], b[2]); y2 = min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = area(a) + area(b) - inter
    return inter / union if union > 0 else 0.0
```

Giao trên hợp: 1.0 với hai hộp trùng khít, 0.0 với hai hộp rời nhau. Nó xuất hiện trong ba vai
trò khác nhau và đáng để tách bạch trong đầu:

1. **Trong NMS**, để quyết định hai dự đoán có phải cùng một vật thể không.
2. **Trong đánh giá**, để quyết định một dự đoán có khớp với hộp nhãn chuẩn không.
3. **Trong bám vật**, để liên kết phát hiện qua các khung hình (như trong series OpenCV).

Một trực giác hữu ích: **IoU 0.5 là một cái hộp trông khá cẩu thả.** Hai hộp cùng kích thước
lệch nhau một phần ba bề rộng đã đạt khoảng 0.5 rồi. Khi người ta nói một bộ phát hiện "chính
xác ở IoU 0.5", họ muốn nói nó nằm *đại khái* đúng chỗ.

## NMS, và cái ngưỡng khiến bạn mất phát hiện thật

Mô hình phát ra nhiều hộp chồng lấn cho cùng một vật thể. Non-maximum suppression giữ hộp tốt
nhất và xoá các hộp lân cận:

```python
def nms(boxes, scores, iou_threshold=0.45):
    order = scores.argsort()[::-1]
    keep = []
    while len(order):
        i = order[0]; keep.append(i)
        rest = order[1:]
        ious = np.array([iou(boxes[i], boxes[j]) for j in rest])
        order = rest[ious < iou_threshold]      # bỏ mọi thứ quá giống
    return keep
```

Sắp theo điểm, lấy cái tốt nhất, vứt mọi thứ chồng lấn với nó, lặp lại.

**Ngưỡng này là một đánh đổi thật, không phải hằng số thần kỳ.** Ở 0.45, hai vật thể chồng
nhau thật sự — một người đứng trước một người khác — sẽ bị xoá mất một. Nâng lên 0.7 thì cảnh
đông người chạy tốt hơn, đổi lại hộp trùng bắt đầu xuất hiện trên một vật thể đơn lẻ.

Hai điều ai cũng nên biết:

- **NMS phải làm theo từng lớp.** Một con chó đứng trước một chiếc xe không được phép triệt
  tiêu chiếc xe. Mọi cài đặt thực tế đều dịch hộp đi `class_id * 10000` trước khi chạy một
  lượt NMS duy nhất, đạt hiệu quả tương đương với chi phí rẻ.
- **NMS tốn thời gian.** Nó là O(n²) theo số hộp còn sống, và nó chạy trên CPU ngay cả khi mô
  hình chạy trên GPU. Một ngưỡng tin cậy thấp để lại 900 ứng viên có thể khiến NMS tốn hơn cả
  suy luận. Hãy lọc theo độ tin cậy *trước* — một dòng đó thường là phép tăng tốc rẻ nhất
  trong cả pipeline.

Soft-NMS làm suy giảm điểm của hàng xóm thay vì xoá chúng, giúp ích trong đám đông với chi phí
tốc độ. Đáng biết là nó tồn tại; hiếm khi đáng với độ phức tạp thêm vào.

## Độ tin cậy: con số đó nghĩa là gì và không nghĩa là gì

Độ tin cậy là ước lượng tạm hiệu chỉnh của mô hình rằng hộp này thuộc lớp kia. Nó **không**
phải xác suất theo nghĩa chặt chẽ, và nó không so sánh được giữa các mô hình hay thậm chí giữa
các lần huấn luyện của cùng một mô hình.

Vì vậy cách chọn đúng là bằng thực nghiệm:

- **0.25** là mặc định thông dụng và cố ý dễ dãi.
- Cao hơn cho mọi tình huống mà báo động giả tốn kém — một cánh tay loại bỏ tự động, một cảnh
  báo gửi tới người trực.
- Thấp hơn khi bỏ sót là tốn kém và có người rà lại đầu ra — phân loại y tế, rà soát an ninh.

Hãy vẽ precision và recall theo độ tin cậy trên tập validation *của bạn* rồi chọn điểm khớp
với chi phí của hai loại lỗi. Đây là quyết định kinh doanh mà người ta cứ đưa ra bằng cách
chép một con số từ hướng dẫn trên mạng.

## mAP, giải mã

Chỉ số ai cũng trích dẫn và ít người định nghĩa được. Dựng dần:

Với một lớp, ở một ngưỡng IoU: sắp mọi dự đoán theo độ tin cậy, đi dọc danh sách, đánh dấu
từng cái là dương tính thật (khớp với một hộp nhãn chưa được ghép ở IoU ≥ ngưỡng) hoặc dương
tính giả. Việc đó vạch ra một đường cong precision–recall. **Average precision** là diện tích
dưới đường cong đó.

- **mAP@50** — AP ở IoU 0.5, trung bình trên các lớp. Dễ dãi với vị trí hộp.
- **mAP@50-95** — trung bình của AP ở IoU 0.50, 0.55, … 0.95. Đây là chỉ số COCO và là chỉ số
  đáng quan tâm, vì nó tưởng thưởng những hộp thực sự *ôm sát*.

Một mô hình có mAP@50 = 0.85 và mAP@50-95 = 0.52 đang tìm đúng vật thể và vẽ hộp cẩu thả quanh
chúng. Điều đó có quan trọng hay không phụ thuộc hoàn toàn vào việc bạn làm gì tiếp: để đếm
người thì ổn, để đo kích thước một chi tiết thì vô dụng.

Lưu ý **mAP lấy trung bình trên các lớp, không có trọng số.** Một lớp hiếm mà mô hình làm tệ
kéo cả con số xuống ngang bằng lớp quan trọng nhất của bạn. Hãy luôn xem AP theo từng lớp,
không chỉ con số tiêu đề. Con số duy nhất tồn tại để xếp hạng các mục trên bảng thi đấu; bạn
thì không ở trên bảng thi đấu nào cả.

## Kiểm tra tỉnh táo trước khi tin bất cứ điều gì

```python
print(raw.shape)                        # biết bố cục trước khi giải mã
print(boxes[:5], conf[:5], cls[:5])     # hộp có nằm trong ảnh? conf có trong 0..1?
print(f"{len(boxes)} sau NMS từ {keep_count} ứng viên")
```

Và hãy vẽ hộp ra. Lần nào cũng vậy. Chín mươi phần trăm các ca "mô hình hỏng" hoá ra là phép
biến đổi toạ độ, và một lệnh `cv2.imshow` cho thấy điều đó ngay lập tức.

## Tự kiểm tra

1. Hai con số trong đầu ra `(1, 84, 8400)` là gì, và 8400 từ đâu ra?
2. Vì sao quên phần đệm letterbox làm hộp bị *dịch* chứ không phải *co giãn*?
3. Nâng ngưỡng IoU của NMS từ 0.45 lên 0.7 cải thiện điều gì, và phá vỡ điều gì?
4. Khoảng cách lớn giữa mAP@50 và mAP@50-95 nói lên điều gì?

## Tiếp theo

Giờ bạn đã biết cái gì đi ra, bài 2 trả lời cái gì đi vào: chọn phiên bản YOLO nào, các cỡ
n/s/m/l/x thực sự tốn bao nhiêu, những lựa chọn thay thế đáng cân nhắc, và câu hỏi giấy phép
đã khiến nhiều công ty mất tiền thật.
