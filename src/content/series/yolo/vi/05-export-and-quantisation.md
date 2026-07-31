---
lesson: 5
lang: vi
title: "Export và lượng tử hoá"
description: "ONNX cùng các cái bẫy opset, TensorRT và TFLite, lượng tử hoá INT8 thực sự làm gì với trọng số của bạn, cách hiệu chỉnh cho đúng, và cách kiểm chứng mô hình sau export vẫn khớp."
duration: "16 phút"
tags: ["YOLO", "ONNX", "Lượng tử hoá"]
---

## Vì sao bạn không thể triển khai file .pt

Một file `.pt` cần PyTorch, thứ kéo theo khoảng 2 GB phụ thuộc và không tồn tại trên hầu hết
thiết bị nhúng. Nó cũng chạy phần tiền và hậu xử lý phía Python vốn tiện lợi khi huấn luyện, và
chẳng phần nào trong đó nhanh cả.

Export chuyển mô hình sang một runtime mà thiết bị đích thực sự có. Đây cũng là chỗ nhiều dự án
âm thầm mất độ chính xác, nên nửa sau của bài này nói về việc kiểm chứng rằng bạn đã không mất.

## ONNX: ngôn ngữ chung

```python
model.export(format="onnx",
             imgsz=640,
             opset=12,        # 12 được hỗ trợ rộng rãi; mới hơn không có nghĩa là tốt hơn
             simplify=True,   # gộp toán tử, bỏ nhánh chết
             dynamic=False,   # hình dạng cố định thì nhanh hơn và khả chuyển hơn
             nms=False)       # giữ NMS ngoài đồ thị — xem bên dưới
```

Bốn quyết định nằm trong đó, và mỗi cái đều đã làm ai đó khốn khổ:

**`opset`.** Cao hơn không phải tốt hơn. TensorRT, OpenVINO và trình chuyển đổi của mọi hãng
NPU chỉ hỗ trợ một *tập con*, và các bản export opset 17 đã từng thất bại trên runtime xử lý
opset 12 hoàn toàn ổn. Hãy bắt đầu ở 12, chỉ nâng lên khi thiếu một toán tử bạn cần.

**`dynamic`.** Batch và hình dạng động thì tiện và khiến bạn mất phần tối ưu ở mức đồ thị. Với
thiết bị biên xử lý từng khung một, hãy cố định hình dạng.

**`simplify`.** Chạy `onnx-simplifier`, gấp hằng số và loại các nhánh chỉ dùng khi huấn luyện.
Gần như luôn có lợi; đôi khi chính nó là thứ khiến trình chuyển đổi chấp nhận được đồ thị.

**`nms`.** Nhúng NMS vào đồ thị khiến mô hình xuất ra tự chứa, điều đó tiện. Nó cũng đồng nghĩa
số phát hiện tối đa cố định, một toán tử mà nhiều bộ tăng tốc không hỗ trợ, và không có cách
đổi ngưỡng nếu không export lại. Với triển khai biên, hãy export không kèm NMS và chạy nó trong
mã của bạn — bạn đã biết cách từ bài 1.

Rồi kiểm chứng bản export trước khi đi tiếp:

```python
import onnx, onnxruntime as ort
onnx.checker.check_model(onnx.load("best.onnx"))

s = ort.InferenceSession("best.onnx")
print(s.get_inputs()[0].name, s.get_inputs()[0].shape)
print(s.get_outputs()[0].name, s.get_outputs()[0].shape)   # (1, 84, 8400)?
```

## Các runtime, và chúng dành cho ai

| Định dạng | Mục tiêu | Nhanh hơn PyTorch CPU | Ghi chú |
|---|---|---|---|
| **ONNX Runtime** | mọi thứ | 2–3× | mặc định khả chuyển |
| **TensorRT** | NVIDIA / Jetson | 3–8× | build engine *ngay trên thiết bị đích* |
| **TFLite** | ARM, di động, Coral | 2–4× | Coral yêu cầu INT8 toàn phần |
| **OpenVINO** | CPU/iGPU Intel | 2–4× | rất tốt trên CPU dòng Atom |
| **NCNN** | ARM di động | 2–4× | nhị phân nhỏ, không phụ thuộc |
| **RKNN / Hailo / hãng** | NPU của hãng đó | 10×+ | công cụ của hãng, toán tử của hãng |

Thứ hay làm người ta vấp là **TensorRT**. File engine được build cho một kiến trúc GPU, một
phiên bản TensorRT và một phiên bản CUDA cụ thể. Engine build trên chiếc RTX 4090 ở máy trạm sẽ
không nạp được trên Jetson Orin. Hãy build trên thiết bị đích, hoặc trong container khớp phiên
bản JetPack của thiết bị, và coi engine là sản phẩm build chứ không phải thứ để commit.

## Lượng tử hoá thực sự làm gì

Trọng số FP32 thành INT8: từ 4 byte xuống 1. Với mỗi tensor (hoặc mỗi kênh), một hệ số tỉ lệ và
một điểm không ánh xạ khoảng giá trị thực về −128…127:

```
q = round(x / scale) + zero_point
x ≈ (q - zero_point) * scale
```

Ba thứ bạn được, và một thứ bạn phải trả:

- **Nhỏ hơn 4 lần.** 24 MB → 6 MB, điều này quan trọng trên thiết bị hạn chế flash.
- **Nhanh hơn 2–4 lần**, vì SIMD số nguyên rộng hơn và lưu lượng bộ nhớ chỉ còn một phần tư.
- **Tốn ít điện hơn**, thứ trên thiết bị chạy pin có thể là toàn bộ lý do.
- **Bạn trả bằng độ chính xác** — thường 1–3% mAP tương đối, đôi khi nhiều hơn hẳn nếu làm ẩu.

FP16 là mức trung gian dễ chịu: nhỏ hơn 2 lần, gần như miễn phí trên mọi phần cứng hỗ trợ FP16,
và mất mát độ chính xác thường ở chữ số thập phân thứ ba. **Nếu phần cứng của bạn chạy FP16
tốt, hãy bắt đầu từ đó** và chỉ chuyển sang INT8 nếu vẫn cần thêm tốc độ.

## Hiệu chỉnh: phần quyết định INT8 có chạy được không

Lượng tử hoá sau huấn luyện cần biết khoảng giá trị kích hoạt ở mọi lớp, và nó học điều đó bằng
cách chạy ảnh thật qua mô hình.

```python
model.export(format="engine", int8=True,
             data="dataset/data.yaml",     # ảnh hiệu chỉnh lấy từ đây
             batch=8)
```

Hoặc tường minh, với ONNX Runtime:

```python
from onnxruntime.quantization import quantize_static, CalibrationDataReader

class Reader(CalibrationDataReader):
    def __init__(self, images):
        self.it = iter([{"images": preprocess(p)} for p in images])
    def get_next(self):
        return next(self.it, None)

quantize_static("best.onnx", "best_int8.onnx", Reader(calib_images))
```

**Tập hiệu chỉnh là toàn bộ vấn đề:**

- **100 tới 500 ảnh.** Nhiều hơn không giúp gì; ít hơn thì bất ổn.
- **Lấy từ phân bố triển khai thật của bạn.** Không phải COCO, không phải những ảnh dễ nhất
  trong tập train. Nếu thiết bị làm việc ban đêm, ảnh hiệu chỉnh phải có ảnh ban đêm.
- **Phủ hết dải điều kiện.** Nếu quá trình hiệu chỉnh chưa từng thấy một khung hình cháy sáng,
  các khoảng giá trị sẽ sai với khung đó và kích hoạt bị bão hoà.
- **Đừng hiệu chỉnh trên tập test.** Nó sẽ thôi là tập test.

Tập hiệu chỉnh tệ là lời giải thích thông thường cho câu "INT8 phá nát độ chính xác của tôi".
Mất mười phần trăm mAP không phải chuyện bình thường — nó nghĩa là các khoảng giá trị sai, chứ
không phải INT8 không phù hợp.

Lượng tử hoá **theo kênh** (một hệ số tỉ lệ cho mỗi kênh đầu ra thay vì cho cả tensor) lấy lại
phần lớn mất mát còn lại và được hỗ trợ gần như ở mọi nơi. Hãy dùng nếu có tuỳ chọn đó.

## Bước kiểm chứng không ai làm

Export là thao tác thất bại trong im lặng. Hoàn toàn có thể tạo ra một mô hình nạp được, chạy
được, phát ra những cái hộp trông có vẻ hợp lý, và tệ hơn 12 mAP. Nên hãy kiểm chứng hai lần.

**1. Khớp về số trên một tấm ảnh.**

```python
torch_out = torch_model(x).cpu().numpy()
onnx_out  = session.run(None, {"images": x.numpy()})[0]

diff = np.abs(torch_out - onnx_out).max()
print("sai khác tuyệt đối lớn nhất:", diff)
# Export FP32: kỳ vọng < 1e-4. FP16: < 1e-2. Lớn hơn nghĩa là có gì đó sai.
```

**2. mAP đầy đủ trên tập validation, chạy qua mô hình đã export.**

```python
onnx_model = YOLO("best.onnx")
print(onnx_model.val(data="dataset/data.yaml").box.map)
```

So với con số của bản `.pt`:

| Bản export | Thay đổi mAP@50-95 kỳ vọng |
|---|---|
| ONNX FP32 | 0,000 — giống hệt, nếu không thì bản export sai |
| FP16 | −0,001 tới −0,005 |
| INT8, hiệu chỉnh tốt | −0,005 tới −0,020 |
| INT8, hiệu chỉnh tệ | −0,05 hoặc tệ hơn — hãy sửa tập hiệu chỉnh |

Bất kỳ bản export FP32 nào không khớp về số đều có lỗi thật — thường là lệch tiền xử lý: chuẩn
hoá sai, BGR nhầm RGB, hoặc giá trị đệm letterbox khác. Hãy kiểm tra ba thứ đó trước.

## Cụ thể về lệch tiền xử lý

Đây là lỗi export phổ biến nhất và nó xứng đáng có mục riêng, vì triệu chứng — "độ chính xác
tụt sau khi export" — không chỉ tới đâu hữu ích cả.

Tiền xử lý lúc huấn luyện trong Ultralytics là: BGR → RGB, letterbox về 640 với giá trị đệm
114, `/255.0`, HWC → CHW, thêm chiều batch, float32 liền mạch. Mã triển khai của bạn phải làm
**chính xác** như vậy.

```python
def preprocess(img_bgr, size=640):
    img, r, (dw, dh) = letterbox(img_bgr, size, fill=114)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = img.transpose(2, 0, 1)[None]          # HWC -> CHW -> NCHW
    return np.ascontiguousarray(img, dtype=np.float32) / 255.0
```

Sai thứ tự kênh thì mô hình vẫn phát hiện được — chỉ là ít hơn, và tệ hơn. Nó không bao giờ
crash, và đó chính là lý do nó sống sót tới lúc lên sản xuất.

## Danh sách kiểm tra khi export

- [ ] `imgsz` lúc export khớp với kích thước bạn triển khai.
- [ ] Tiền xử lý lúc triển khai khớp từng byte với lúc huấn luyện: RGB, /255, đệm letterbox
      114.
- [ ] Bản export FP32 đã kiểm chứng khớp về số với `.pt`.
- [ ] Mô hình lượng tử hoá đã đánh giá trên toàn tập val, không phải trên ba tấm ảnh.
- [ ] Ảnh hiệu chỉnh lấy từ phân bố triển khai thật, 100–500 tấm.
- [ ] Engine TensorRT build trên thiết bị đích, coi như sản phẩm build.
- [ ] Tên lớp được xuất kèm mô hình — đồ thị chỉ có chỉ số.
- [ ] File mô hình có phiên bản và ghi lại lần chạy huấn luyện tương ứng.

## Tự kiểm tra

1. Vì sao opset 12 thường là lựa chọn tốt hơn opset 17?
2. Vì sao NMS thường nên nằm ngoài đồ thị export khi triển khai biên?
3. Tập hiệu chỉnh cần chứa gì, và nên lớn cỡ nào?
4. Một bản export ONNX FP32 thấp hơn `.pt` 3 mAP. Bạn tìm ở đâu trước?

## Tiếp theo

Bài cuối: làm cho con số trên tờ thông số khớp với con số trên thiết bị của bạn. Đo độ trễ cho
đúng, thời gian thực sự đi đâu ngoài phần suy luận, gộp lô và chia tầng, cùng những con số cụ
thể cho Jetson, Coral và ARM thường.
