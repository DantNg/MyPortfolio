---
lesson: 5
lang: en
title: "Export and Quantisation"
description: "ONNX and the opset traps, TensorRT and TFLite, what INT8 quantisation actually does to your weights, how to calibrate it properly, and how to verify the exported model still matches."
duration: "16 min"
tags: ["YOLO", "ONNX", "Quantisation"]
---

## Why you cannot ship the .pt

A `.pt` file needs PyTorch, which needs about 2 GB of dependencies and does not exist for
most embedded targets. It also runs the Python-side pre- and post-processing that made
training convenient, and none of that is fast.

Export converts the model to a runtime your target actually has. It is also where a
surprising number of projects lose accuracy quietly, so the second half of this lesson is
about verifying that you did not.

## ONNX: the lingua franca

```python
model.export(format="onnx",
             imgsz=640,
             opset=12,        # 12 is broadly supported; newer is not better
             simplify=True,   # fuses ops, removes dead branches
             dynamic=False,   # fixed shapes are faster and more portable
             nms=False)       # keep NMS out of the graph — see below
```

Four decisions in there, and each has bitten someone:

**`opset`.** Higher is not better. TensorRT, OpenVINO and every NPU vendor's converter
support a *subset*, and opset 17 exports have failed on runtimes that handle 12 fine. Start at
12, raise only if an op you need is missing.

**`dynamic`.** Dynamic batch and shape are convenient and cost you graph-level optimisation.
For an edge device processing one frame at a time, fix the shape.

**`simplify`.** Runs `onnx-simplifier`, folding constants and removing the branches only used
during training. Almost always a straight win; occasionally it is what makes a converter
accept the graph at all.

**`nms`.** Embedding NMS in the graph makes the exported model self-contained, which is
convenient. It also means a fixed maximum detection count, an op that many accelerators do
not support, and no way to change the threshold without re-exporting. For edge deployment,
export without NMS and run it in your own code — you already know how from lesson 1.

Then verify the export before you go further:

```python
import onnx, onnxruntime as ort
onnx.checker.check_model(onnx.load("best.onnx"))

s = ort.InferenceSession("best.onnx")
print(s.get_inputs()[0].name, s.get_inputs()[0].shape)
print(s.get_outputs()[0].name, s.get_outputs()[0].shape)   # (1, 84, 8400)?
```

## The runtimes, and who they are for

| Format | Target | Speedup vs PyTorch CPU | Note |
|---|---|---|---|
| **ONNX Runtime** | anything | 2–3× | the portable default |
| **TensorRT** | NVIDIA / Jetson | 3–8× | build the engine *on the target device* |
| **TFLite** | ARM, mobile, Coral | 2–4× | Coral requires full INT8 |
| **OpenVINO** | Intel CPU/iGPU | 2–4× | very good on Atom-class CPUs |
| **NCNN** | ARM mobile | 2–4× | tiny binary, no dependencies |
| **RKNN / Hailo / vendor** | that vendor's NPU | 10×+ | vendor toolchain, vendor op support |

The one that trips people up is **TensorRT**. An engine file is built for a specific GPU
architecture, TensorRT version and CUDA version. An engine built on your workstation's RTX
4090 will not load on a Jetson Orin. Build on the target, or in a container matching the
target's JetPack version, and treat the engine as a build artefact rather than something you
commit.

## What quantisation actually does

FP32 weights become INT8: 4 bytes to 1. For each tensor (or each channel), a scale and a zero
point map the float range onto −128…127:

```
q = round(x / scale) + zero_point
x ≈ (q - zero_point) * scale
```

Three things you get, and one you pay:

- **4× smaller.** 24 MB → 6 MB, which matters on flash-constrained devices.
- **2–4× faster**, because integer SIMD is wider and the memory traffic is a quarter.
- **Lower power**, which on a battery device can be the whole reason.
- **You pay accuracy** — typically 1–3% relative mAP, occasionally much more if done badly.

FP16 is the easy middle: 2× smaller, nearly free on any hardware with FP16 support, and the
accuracy loss is usually in the third decimal place. **If your hardware does FP16 well, start
there** and only go to INT8 if you still need the speed.

## Calibration: the part that decides whether INT8 works

Post-training quantisation needs to know the range of activations at every layer, which it
learns by running real images through the model.

```python
model.export(format="engine", int8=True,
             data="dataset/data.yaml",     # calibration images come from here
             batch=8)
```

Or explicitly, with ONNX Runtime:

```python
from onnxruntime.quantization import quantize_static, CalibrationDataReader

class Reader(CalibrationDataReader):
    def __init__(self, images):
        self.it = iter([{"images": preprocess(p)} for p in images])
    def get_next(self):
        return next(self.it, None)

quantize_static("best.onnx", "best_int8.onnx", Reader(calib_images))
```

**The calibration set is the whole game:**

- **100 to 500 images.** More does not help; fewer is unstable.
- **From your real deployment distribution.** Not COCO, not the training set's easiest
  images. If the device works at night, calibration images must include night.
- **Covering the full range of conditions.** If calibration never sees a bright overexposed
  frame, the ranges are wrong for one and activations saturate.
- **Do not calibrate on the test set.** It stops being a test set.

A bad calibration set is the usual explanation for "INT8 destroyed my accuracy". Ten percent
mAP loss is not normal — it means the ranges are wrong, not that INT8 is unsuitable.

**Per-channel** quantisation (a scale per output channel rather than per tensor) recovers most
of the remaining loss and is supported almost everywhere. Use it if the option exists.

## The verification step nobody does

Export is a silent-failure operation. It is entirely possible to produce a model that loads,
runs, emits plausible-looking boxes, and is 12 mAP worse. So verify twice.

**1. Numerical agreement on one image.**

```python
torch_out = torch_model(x).cpu().numpy()
onnx_out  = session.run(None, {"images": x.numpy()})[0]

diff = np.abs(torch_out - onnx_out).max()
print("max abs diff:", diff)
# FP32 export: expect < 1e-4. FP16: < 1e-2. Larger means something is wrong.
```

**2. Full mAP on the validation set, through the exported model.**

```python
onnx_model = YOLO("best.onnx")
print(onnx_model.val(data="dataset/data.yaml").box.map)
```

Compare against the `.pt` number:

| Export | Expected mAP@50-95 change |
|---|---|
| ONNX FP32 | 0.000 — identical, or your export is wrong |
| FP16 | −0.001 to −0.005 |
| INT8, good calibration | −0.005 to −0.020 |
| INT8, bad calibration | −0.05 or worse — fix the calibration set |

Any FP32 export that is not numerically identical has a real bug — usually a preprocessing
mismatch: wrong normalisation, BGR versus RGB, or a different letterbox fill value. Check
those three first.

## The preprocessing mismatch, specifically

This is the most common export bug and it deserves its own section, because the symptom —
"accuracy dropped after export" — points nowhere useful.

Training-time preprocessing in Ultralytics is: BGR → RGB, letterbox to 640 with fill value
114, `/255.0`, HWC → CHW, add batch dim, contiguous float32. Your deployment code must do
**exactly** that.

```python
def preprocess(img_bgr, size=640):
    img, r, (dw, dh) = letterbox(img_bgr, size, fill=114)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = img.transpose(2, 0, 1)[None]          # HWC -> CHW -> NCHW
    return np.ascontiguousarray(img, dtype=np.float32) / 255.0
```

Get the channel order wrong and the model still detects things — just fewer, and worse. It
never crashes, which is exactly why it survives to production.

## The export checklist

- [ ] `imgsz` at export matches what you deploy at.
- [ ] Deployment preprocessing byte-for-byte matches training: RGB, /255, letterbox fill 114.
- [ ] FP32 export verified numerically identical to `.pt`.
- [ ] Quantised model validated on the full val set, not on three images.
- [ ] Calibration images from the real deployment distribution, 100–500 of them.
- [ ] TensorRT engines built on the target device, treated as build artefacts.
- [ ] Class names exported alongside the model — the graph only has indices.
- [ ] Model file versioned and its training run recorded.

## Check yourself

1. Why is opset 12 often a better choice than opset 17?
2. Why should NMS usually stay out of the exported graph for edge deployment?
3. What does a calibration set need to contain, and how large should it be?
4. An FP32 ONNX export scores 3 mAP lower than the `.pt`. Where do you look first?

## Next

The final lesson: making the number on the datasheet match the number on your device.
Measuring latency properly, where the time actually goes outside inference, batching and
pipelining, and the specific numbers for Jetson, Coral and plain ARM.
