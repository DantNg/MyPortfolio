---
lesson: 4
lang: vi
title: "Huấn luyện, và đọc chỉ số một cách trung thực"
description: "Những tham số thực sự quan trọng, mỗi đường cong mất mát đang nói điều gì, đọc ma trận nhầm lẫn và đường cong PR, các dấu hiệu quá khớp xuất hiện trước khi mAP nhúc nhích, và khi nào nên dừng."
duration: "16 phút"
tags: ["YOLO", "Huấn luyện", "Chỉ số"]
---

## Lần chạy huấn luyện

```python
from ultralytics import YOLO

model = YOLO("yolov8n.pt")        # trọng số huấn luyện sẵn, không phải yolov8n.yaml
model.train(
    data="dataset/data.yaml",
    epochs=100,
    imgsz=640,
    batch=16,
    patience=25,
    device=0,
    project="runs", name="v1_baseline",
)
```

Chú ý `yolov8n.pt`, không phải `yolov8n.yaml`. File `.pt` bắt đầu từ trọng số COCO; file
`.yaml` bắt đầu từ khởi tạo ngẫu nhiên và cần lượng dữ liệu lớn hơn một bậc để tới cùng chỗ.
Học chuyển giao không phải tuỳ chọn với một bộ dữ liệu cỡ thường.

**Hãy đặt tên cho các lần chạy.** `v1_baseline`, `v2_more_data`, `v3_imgsz1280`. Sáu tuần sau
bạn sẽ so sánh mười một lần chạy và `train`, `train2`, `train11` chẳng nói lên điều gì.

## Những tham số quan trọng

| Tham số | Mặc định | Khi nào đổi |
|---|---|---|
| `epochs` | 100 | 100 là khởi đầu hợp lý; `patience` dù sao cũng sẽ dừng sớm |
| `imgsz` | 640 | **Nâng lên 1280 cho vật thể nhỏ.** Đòn bẩy độ chính xác lớn nhất |
| `batch` | 16 | Lớn nhất mà VRAM cho phép; `batch=-1` tự chọn cỡ ~60% VRAM |
| `patience` | 100 | **Đặt về 25.** Dừng khi mAP val không cải thiện trong 25 epoch |
| `lr0` | 0.01 | Cứ để nguyên. Hạ về 0.001 chỉ khi mất mát bất ổn |
| `optimizer` | auto | Để nguyên |
| `freeze` | None | `freeze=10` đóng băng backbone — cho bộ dữ liệu rất nhỏ |
| `cache` | False | `cache=True` (RAM) hoặc `'disk'` nếu nạp dữ liệu là nút cổ chai |
| `close_mosaic` | 10 | Để nguyên |
| `rect` | False | `True` cho đầu vào không vuông đồng nhất, tiết kiệm phần đệm |

`imgsz` đáng được nhấn mạnh. Nếu vật thể của bạn rộng 20–40 pixel ở kích thước 640, chúng nằm
gần giới hạn mà đầu ở bước nhảy 8 biểu diễn được. Lên 1280 thường được nhiều mAP hơn là lên hai
bậc kích thước mô hình, với chi phí suy luận thấp hơn.

## Mỗi đường cong mất mát nghĩa là gì

Ba hàm mất mát, và chúng nói những điều khác nhau:

- **`box_loss`** — hộp dự đoán khớp với nhãn chuẩn tới đâu. Giảm nhanh lúc đầu rồi chậm dần.
  Nếu nó chững ở mức cao, vấn đề nằm ở hộp: gán nhãn không nhất quán về độ ôm sát, hoặc vật
  thể quá nhỏ so với độ phân giải đầu vào.
- **`cls_loss`** — phân loại. Nếu nó ở mức cao trong khi `box_loss` ổn, mô hình tìm được vật
  thể nhưng nhầm lớp của chúng: ranh giới lớp của bạn mơ hồ, hoặc hai lớp thực sự quá giống
  nhau.
- **`dfl_loss`** — distribution focal loss, tinh chỉnh mép hộp. Hãy để mắt tới nó, nhưng nó
  hiếm khi là thứ bạn hành động dựa vào.

![Đọc các đường cong huấn luyện](/MyPortfolio/images/yolo/training-curves.svg)

Các dạng đường cong và chẩn đoán:

**Cả train lẫn val cùng giảm, val bắt đầu phẳng.** Bình thường, lành mạnh. Cứ để chạy.

**Train giảm, val *tăng*.** Quá khớp. Nó thường bắt đầu 20–40 epoch trước khi mAP tụt thấy
được, nên đây là cảnh báo sớm của bạn. Cách chữa theo thứ tự: thêm dữ liệu, tăng cường mạnh
hơn, mô hình nhỏ hơn, `freeze`.

**Cả hai cùng phẳng và cao ngay từ đầu.** Có gì đó hỏng, không phải huấn luyện chưa đủ. Kiểm
tra xem nhãn có được tìm thấy không (phần đầu bản ghi in ra số lượng), kiểm tra đường dẫn trong
`data.yaml`, kiểm tra id lớp có khớp với `names` không.

**Mất mát thành NaN.** Learning rate quá cao, hoặc nhãn hỏng — một hộp bề rộng bằng 0 là đủ
gây ra. Hãy kiểm tra nhãn, rồi hạ `lr0`.

**Mất mát val nhiễu, nhảy loạn.** Batch quá nhỏ, hoặc tập validation quá nhỏ để ổn định. Dưới
khoảng 200 ảnh val, mAP có vài điểm nhiễu và bạn không so sánh các lần chạy một cách tin cậy
được.

## mAP tăng không đồng nghĩa mô hình tốt lên

Con số duy nhất che giấu mọi thứ bạn cần. Sau mỗi lần chạy, hãy mở `results.png` cùng các biểu
đồ được sinh ra, và đọc bốn thứ:

**AP theo từng lớp.** In ra ở cuối bước validation. Đây là nơi bạn phát hiện mô hình đạt 0,91
trên `person` và 0,22 trên `helmet`, trong khi con số mAP tiêu đề 0,57 trông có vẻ chấp nhận
được. Vấn đề lớp hiếm vô hình trong giá trị trung bình.

**Ma trận nhầm lẫn** (`confusion_matrix_normalized.png`). Hãy đọc hàng và cột cuối, tức các mục
`background` — đó là phần cung cấp thông tin:

- Giá trị cao ở **cột background** → âm tính giả. Mô hình bỏ sót vật thể thật. Thêm dữ liệu, hạ
  ngưỡng tin cậy, tăng độ phân giải.
- Giá trị cao ở **hàng background** → dương tính giả. Mô hình phát hiện những thứ không có. Hãy
  thêm ảnh âm.
- Giá trị ngoài đường chéo giữa hai lớp → nhầm lẫn lớp thật sự. Kiểm tra hướng dẫn gán nhãn và
  xem hai lớp đó có nên gộp lại không.

**Đường cong PR** (`PR_curve.png`). Đây là thứ cho bạn biết đặt ngưỡng tin cậy ở đâu, như ở bài
1. Một đường cong rơi dựng đứng ở recall 0,7 nghĩa là có một nhóm vật thể mà mô hình đơn giản
không bao giờ tìm ra, bất kể ngưỡng nào — hãy đi tìm xem chúng là những vật nào.

**Dự đoán thật.** `val_batch0_pred.jpg` đặt cạnh `val_batch0_labels.jpg`. Hãy nhìn chúng. Lần
nào cũng vậy. Con số cho bạn biết có gì đó sai; hình ảnh cho bạn biết sai cái gì.

## Cái bẫy validation

```python
metrics = model.val()               # dùng tập val khai báo trong data.yaml
print(metrics.box.map, metrics.box.map50)
print(metrics.box.maps)             # theo từng lớp
```

Tập validation của bạn đã định hình mọi quyết định bạn đưa ra — dừng sớm, giữ lần chạy nào, đặt
ngưỡng nào. Nó không còn là ước lượng không thiên lệch của bất cứ điều gì.

```python
metrics = model.val(data="dataset/data.yaml", split="test")
```

Hãy chạy tập test **một lần**, ở cuối, và báo cáo con số đó. Nếu nó tệ hơn nhiều so với
validation, bạn đã tinh chỉnh theo tập validation — thường nghĩa là tập val quá nhỏ hoặc quá
giống tập train.

## Lặp như một kỹ sư

Mỗi lần chạy đổi một thứ, và ghi lại điều đã xảy ra:

```
v1  yolov8n, 640, 800 ảnh          mAP50-95 0.412   nền
v2  + 400 ảnh chụp buổi tối        mAP50-95 0.468   mức tăng đơn lẻ lớn nhất
v3  v2 + imgsz 1280                mAP50-95 0.501   vật thể nhỏ, đáng đổi 2x độ trễ
v4  v3 + yolov8s                   mAP50-95 0.514   +0.013 cho 2x tham số — không đáng
v5  v3 + sửa nhãn helmet           mAP50-95 0.552   gán nhãn lại 300 ảnh. Lợi nhất.
```

Nhật ký đó chính là sản phẩm thực sự của một giai đoạn huấn luyện. Nó trả lời "tiếp theo nên
làm gì" bằng bằng chứng, và nó ngăn bạn chạy lại một thí nghiệm đã làm hồi tháng Ba.

Hãy để ý khuôn mẫu trong đó, vì nó là khuôn mẫu thường gặp: **thay đổi dữ liệu thắng thay đổi
kiến trúc.** v2 và v5 — thêm dữ liệu và nhãn tốt hơn — cho nhiều hơn cả việc v4 nhân đôi mô
hình.

## Khi nào dừng

Dừng khi chi phí biên của cải thiện kế tiếp vượt quá giá trị của nó. Cụ thể:

- Con số trên tập test đạt yêu cầu bạn đã viết ra trước khi bắt đầu. (Bạn *có* viết ra chứ.
  "Chính xác nhất có thể" không phải yêu cầu, đó là một ngân sách mở.)
- Những lỗi còn lại là các ca mà con người cũng thấy mơ hồ. Hãy đi xem các trường hợp thất bại
  — khi chúng thực sự là khung hình khó, huấn luyện thêm cũng không chữa được.
- Hai thí nghiệm liên tiếp tăng dưới một điểm. Bạn đang ở phần phẳng của đường cong.

Và chiều ngược lại: nếu bạn đã chạy năm lần mà vẫn dưới một nửa mục tiêu, hãy ngừng tinh chỉnh
siêu tham số. Có gì đó sai về mặt cấu trúc — thường là dữ liệu, đôi khi là cách đặt bài toán.

## Khả năng lặp lại

```python
model.train(..., seed=0, deterministic=True)
```

Chậm hơn, và đáng giá trong lúc bạn đang so sánh các lần chạy — nếu không thì chênh lệch 0,01
mAP giữa hai cấu hình có thể chỉ là biến thiên do hạt giống ngẫu nhiên. Ngoài ra, với mỗi mô
hình bạn giữ lại, hãy lưu: `data.yaml`, commit hoặc mã băm của bộ dữ liệu, toàn bộ tham số huấn
luyện (Ultralytics tự ghi `args.yaml` cho bạn), và các chỉ số. Sáu tháng sau sẽ có người hỏi vì
sao mô hình thay đổi, và "chúng tôi huấn luyện lại" không phải một câu trả lời.

## Tự kiểm tra

1. Vì sao nên bắt đầu từ `.pt` chứ không phải `.yaml`?
2. `cls_loss` giữ ở mức cao trong khi `box_loss` hội tụ — điều đó gợi ý gì?
3. Hàng background và cột background của ma trận nhầm lẫn nghĩa là gì?
4. Vì sao tới cuối dự án, mAP validation của bạn không còn là ước lượng không thiên lệch?

## Tiếp theo

Bạn đã có file `.pt` đã huấn luyện, thứ không chạy được trên thiết bị đích. Bài 5 là export:
ONNX cùng các cái bẫy opset, TensorRT và TFLite, lượng tử hoá INT8 và hiệu chỉnh, và cách kiểm
chứng rằng mô hình sau export vẫn làm đúng như bản gốc.
