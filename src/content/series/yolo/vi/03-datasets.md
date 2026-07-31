---
lesson: 3
lang: vi
title: "Bộ dữ liệu quyết định tất cả"
description: "Định dạng nhãn của YOLO, cách chia tập không rò rỉ, bạn thực sự cần bao nhiêu ảnh, mất cân bằng lớp, những lỗi gán nhãn âm thầm chặn trần độ chính xác, và phép tăng cường nào là an toàn."
duration: "16 phút"
tags: ["YOLO", "Bộ dữ liệu", "Gán nhãn"]
---

## Độ chính xác thực sự đến từ đâu

Đi từ `yolov8n` lên `yolov8m` có thể mua cho bạn 8 mAP. Sửa một bộ dữ liệu có 15% số hộp sai
mua được nhiều hơn thế, và tốn một tuần thay vì tăng vĩnh viễn 4 lần thời gian suy luận.

Gần như mọi bộ phát hiện chạy dưới kỳ vọng khi triển khai đều do dữ liệu, và bản năng đầu tiên
của gần như mọi đội là thử một mô hình lớn hơn. Bài này là bài có giá trị cao hơn.

## Định dạng nhãn

Một file `.txt` cho mỗi ảnh, cùng tên gốc, mỗi vật thể một dòng:

```
<class_id> <cx> <cy> <w> <h>
```

Cả bốn toạ độ đều **chuẩn hoá về 0…1** theo kích thước ảnh, và `cx, cy` là *tâm* hộp, không
phải góc.

```
0 0.512 0.634 0.180 0.290
2 0.221 0.400 0.075 0.140
```

Ảnh không có vật thể nào thì có một **file rỗng**, không phải file thiếu. Đó là các mẫu âm của
bạn và chúng quan trọng — xem phần dưới.

Bố cục thư mục mà Ultralytics mong đợi:

```
dataset/
  images/train/  img001.jpg …
  images/val/    img201.jpg …
  labels/train/  img001.txt …
  labels/val/    img201.txt …
  data.yaml
```

```yaml
path: /duong/dan/tuyet/doi/dataset
train: images/train
val: images/val
names:
  0: person
  1: helmet
  2: vest
```

Bộ nạp tìm nhãn bằng cách thay `/images/` bằng `/labels/` trong đường dẫn. Nếu huấn luyện khởi
động và báo "0 labels found", chính phép thay chuỗi đó đã thất bại — thường vì thư mục tên là
`image` hay `Images`.

## Chia tập, và cái rò rỉ thổi phồng mọi con số

```
train  70%    thứ mô hình học từ đó
val    20%    thứ bạn tinh chỉnh dựa vào
test   10%    chạm vào đúng một lần, ở cuối
```

Quy tắc quan trọng: **chia theo nguồn, không phải theo khung hình.** Nếu bạn trích 3000 khung
từ 30 video rồi chia ngẫu nhiên, khung 41 và 42 của cùng một video — hai ảnh gần như giống hệt
— rơi về hai phía của ranh giới. mAP validation của bạn sẽ đọc là 0,94 và mô hình sẽ hỏng
ngoài thực địa, vì bạn đã đo khả năng học thuộc lòng.

```python
# SAI
random.shuffle(all_frames); train = all_frames[:2100]

# ĐÚNG
random.shuffle(video_ids)
train_videos, val_videos = video_ids[:21], video_ids[21:27]
train = [f for f in all_frames if f.video in train_videos]
```

Lập luận đó áp dụng cho mọi nhóm tương quan khác: cùng một vật thể vật lý, cùng một ngày, cùng
một vị trí camera, cùng một buổi chụp cùng ánh sáng. Nếu bản triển khai sẽ gặp một cái *mới*
của thứ gì đó, thì phải chia theo đúng thứ đó.

Và hãy giữ tập test thật sự nguyên vẹn. Một khi bạn đã tinh chỉnh dựa vào một tập, nó báo cáo
lạc quan mãi mãi.

![Chia theo nguồn, không theo khung hình](/MyPortfolio/images/yolo/dataset-splits.svg)

## Cần bao nhiêu ảnh

Con số làm việc trung thực cho một lần tinh chỉnh từ trọng số COCO:

| Tình huống | Ảnh mỗi lớp |
|---|---|
| Tối thiểu tuyệt đối để thấy nó chạy | 150 |
| Nguyên mẫu dùng được | 500 |
| Sản xuất, hiện trường kiểm soát được | 1 500 |
| Sản xuất, điều kiện đa dạng | 5 000+ |

Nhưng số lượng là nửa ít quan trọng hơn. **Sự đa dạng là nửa còn lại**, và đó là chỗ người ta
đầu tư thiếu:

- Mọi điều kiện ánh sáng thiết bị sẽ gặp — kể cả những điều kiện tệ. Rạng đông, đèn huỳnh
  quang, ngược sáng, đèn pha xe.
- Mọi góc và mọi khoảng cách.
- Che khuất. Vật thể bị vật khác che một nửa, nằm ở mép khung hình, bị cắt cụt.
- Nhoè do chuyển động, nếu vật thật có di chuyển.
- Đúng camera và ống kính bạn sẽ triển khai. Bộ dữ liệu chụp bằng điện thoại rồi triển khai
  trên camera an ninh góc rộng có một khoảng cách miền mà bạn không huấn luyện để xoá đi được.

Một nghìn ảnh chụp trong một buổi chiều nắng đẹp là bộ dữ liệu tệ hơn ba trăm ảnh trải qua một
tuần điều kiện thực. Khi không thu thập được đa dạng, đôi khi bạn mua lại được một phần bằng
tăng cường dữ liệu — nhưng chỉ một phần.

## Những lỗi gán nhãn chặn trần độ chính xác

Đây là những lỗi tôi gặp đi gặp lại, xếp theo mức thiệt hại:

**Độ ôm sát không nhất quán.** Một người gán nhãn khoanh cả bóng đổ của người trong ảnh, người
khác chỉ khoanh phần thân. Mô hình học lấy trung bình và trở nên cẩu thả một cách tự tin. Hãy
viết quy tắc ra — *"khoanh phần nhìn thấy được của vật thể, không tính bóng đổ"* — và đưa nó
vào một tài liệu có ảnh ví dụ trước khi bất kỳ ai gán nhãn khung hình đầu tiên.

**Bỏ sót vật thể.** Một vật nhỏ ở nền mà không ai gán nhãn đang được dạy tích cực cho mô hình
rằng đó là *nền*. Việc này tệ hơn cả không có tấm ảnh đó, vì nó tạo ra mô hình triệt tiêu đúng
trường hợp bạn bỏ sót. Nhãn thiếu là loại lỗi gây hại nhất, và khó nhận ra nhất.

**Nhầm lẫn lớp ở ranh giới.** "Xe tải" kết thúc ở đâu và "xe van" bắt đầu ở đâu? Hãy quyết
định, viết ra, và đưa ví dụ. Nếu không người gán nhãn sẽ trôi dạt, và mô hình học đúng sự trôi
dạt đó.

**Chính sách với vật bị che.** Bạn gán nhãn phần mở rộng suy đoán (vật thể sẽ nằm đâu nếu nhìn
xuyên được vật che) hay chỉ phần nhìn thấy? Cả hai đều bảo vệ được. Trộn lẫn hai cách thì
không.

**Lỗi toạ độ.** Hộp nằm ngoài 0…1, hộp diện tích bằng 0, `x1 > x2`. Hãy kiểm tra bằng máy:

```python
for line in open(label_file):
    c, cx, cy, w, h = line.split()
    assert 0 <= float(cx) <= 1 and 0 <= float(cy) <= 1
    assert 0 < float(w) <= 1 and 0 < float(h) <= 1
```

**Hãy nhìn nhãn của bạn.** Vẽ 100 ảnh ngẫu nhiên kèm hộp rồi lật qua từng cái. Việc đó mất hai
mươi phút và lần nào cũng tìm ra thứ gì đó. Hãy làm sau khi 200 ảnh đầu được gán nhãn, đừng
đợi tới khi xong cả 5000.

## Mất cân bằng lớp

Bộ dữ liệu có 5000 `person` và 80 `helmet` sẽ cho ra mô hình gần như không phát hiện được mũ
bảo hộ, kèm một con số mAP trông ổn vì nó lấy trung bình trên các lớp.

Những cách thực sự giúp ích, theo thứ tự:

1. **Thu thập thêm ảnh cho lớp hiếm.** Nhàm chán, và là cách chữa thật sự duy nhất.
2. **Lấy mẫu lặp các ảnh chứa nó** — liệt kê chúng nhiều lần trong tập huấn luyện. Thô sơ, hiệu
   quả.
3. **Tăng cường kiểu copy-paste** — dán thể hiện của lớp hiếm vào các ảnh khác. Hiệu quả đến
   bất ngờ với vật nhỏ và cứng.
4. **Xem lại cách chia lớp.** Nếu hai lớp hiếm trông giống nhau và bạn hiếm khi cần phân biệt,
   hãy gộp chúng.

Thứ không giúp ích: trọng số lớp trong hàm mất mát. Chúng tồn tại và hiếm khi làm con số nhúc
nhích nhiều với bài toán phát hiện.

## Ảnh âm

Hãy đưa vào những ảnh hoàn toàn không có vật thể — khoảng 10% tập dữ liệu. Cụ thể là những ảnh
chứa thứ mà mô hình của bạn sẽ phát hiện *nhầm*: một băng chuyền trống, một ma-nơ-canh nếu bạn
phát hiện người, một tấm áp phích in hình ô tô.

Đó chính là những dương tính giả mà nếu không có chúng bạn sẽ mất một tuần loay hoay chỉnh
ngưỡng, và vài trăm ảnh âm chữa được tận gốc.

## Tăng cường dữ liệu: cái gì an toàn, cái gì không

Ultralytics tăng cường theo mặc định. Các mặc định đáng quan tâm, và khi nào nên đổi:

```yaml
hsv_h: 0.015      # dịch sắc màu  — NGUY HIỂM nếu màu là tín hiệu của bạn
hsv_s: 0.7        # độ bão hoà
hsv_v: 0.4        # độ sáng       — nên giữ, ánh sáng thật vốn thay đổi
degrees: 0.0      # xoay          — tăng lên với ảnh trên cao / hiển vi
translate: 0.1
scale: 0.5        # phóng to thu nhỏ — cái giá trị nhất
shear: 0.0
flipud: 0.0       # lật dọc       — thường là sai
fliplr: 0.5       # lật ngang     — thường là đúng
mosaic: 1.0       # ghép 4 ảnh    — mạnh, giúp ích với vật thể nhỏ
mixup: 0.0
```

Những chỗ cần cân nhắc:

- **`fliplr`** đúng với đa số thứ và sai với bất cứ thứ gì có tính thuận nghịch. Chữ viết,
  biển báo giao thông, và các lớp kiểu "tay trái với tay phải" đều hỏng khi lật ngang.
- **`flipud`** sai với camera đặt ngang tầm mặt đất (người ta không lộn ngược) và đúng với ảnh
  chụp từ trên cao hoặc ảnh hiển vi.
- **`hsv_h`** phải gần 0 nếu bạn phân loại theo màu — một chi tiết đỏ và một chi tiết xanh sẽ
  bị tăng cường thành nhau.
- **`degrees`** nên bằng 0 với camera cố định và có thể lên tới 180 với ảnh không có hướng
  chuẩn.
- **`mosaic`** mạnh và giúp ích cho vật thể nhỏ. Ultralytics tắt nó ở 10 epoch cuối
  (`close_mosaic: 10`) vì huấn luyện hoàn toàn trên ảnh ghép để lại khoảng cách so với ảnh đơn
  thật.

Nguyên tắc: **tăng cường dọc theo các trục mà bản triển khai của bạn thực sự thay đổi, và
không dọc theo các trục nó không thay đổi.** Phép tăng cường sinh ra những tấm ảnh camera của
bạn không bao giờ thấy được thì tiêu tốn dung lượng mô hình mà chẳng đổi lại gì.

## Trước khi bấm nút train

- [ ] Nhãn đã được kiểm tra bằng mắt — ít nhất 100 ảnh ngẫu nhiên có vẽ hộp.
- [ ] Chia theo nguồn, đã kiểm chứng: không có hai khung của cùng một video nằm hai bên ranh
      giới.
- [ ] Đã in số lượng theo lớp. Lớp hiếm nhất có đủ mẫu để học.
- [ ] File nhãn rỗng tồn tại cho các ảnh âm.
- [ ] Mọi toạ độ đã được kiểm tra nằm trong 0…1.
- [ ] Ảnh chụp bằng camera triển khai, trong ánh sáng triển khai.
- [ ] Có tài liệu hướng dẫn gán nhãn, kèm hình ảnh.
- [ ] Tập test đã tách riêng và chưa động tới.

Mỗi mục trong đó đều rẻ hơn bây giờ so với sau một lần chạy huấn luyện.

## Tự kiểm tra

1. Vì sao chia ngẫu nhiên ở mức khung hình lại thổi phồng mAP validation?
2. Vì sao một nhãn bị thiếu tệ hơn một tấm ảnh bị thiếu?
3. Khi nào bạn phải đặt `hsv_h` bằng 0?
4. Ảnh âm dùng để làm gì, và nên chiếm khoảng bao nhiêu phần tập dữ liệu?

## Tiếp theo

Bài 4 là huấn luyện: những tham số thực sự quan trọng, cách đọc đường cong mất mát và ma trận
nhầm lẫn một cách trung thực, khác biệt giữa mAP tăng và mô hình tốt lên, và những dấu hiệu
quá khớp xuất hiện từ rất lâu trước khi con số nhúc nhích.
