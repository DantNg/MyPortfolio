---
lesson: 6
lang: en
title: "Hitting a Latency Budget on the Edge"
description: "Measuring latency so the number means something, where the time goes outside inference, pipelining and batching, and honest figures for Jetson, Coral, Rockchip and plain ARM."
duration: "16 min"
tags: ["YOLO", "Edge", "Latency"]
---

## The number on the datasheet is not your number

"YOLOv8n runs at 8 ms on Orin Nano" is an inference figure, measured with the input already
on the device, in a loop, with nothing else running. Your system also has to capture a frame,
letterbox it, normalise it, copy it to the accelerator, copy the output back, run NMS, and do
whatever your application does.

A realistic breakdown for a 30 FPS pipeline on a Jetson Orin Nano:

```
capture (CSI, zero-copy)     2 ms
letterbox + normalise        4 ms      <- often the surprise
host -> device copy          1 ms
inference (TensorRT INT8)    8 ms
device -> host copy          1 ms
NMS (CPU)                    3 ms      <- grows fast with a low conf threshold
tracking + application       4 ms
                            ------
                            23 ms      -> 43 FPS ceiling, 30 FPS with headroom
```

Inference is 35% of it. Optimising only inference optimises a third of your problem.

## Measuring so the number means something

```python
import time, numpy as np

for _ in range(30):                       # warm-up: allocation, CUDA context, autotune
    model(dummy)

lat = []
for img in test_images:
    t0 = time.perf_counter()
    out = model(img)
    if torch.cuda.is_available(): torch.cuda.synchronize()   # or the number is a lie
    lat.append((time.perf_counter() - t0) * 1000)

lat = np.array(lat)
print(f"mean {lat.mean():.1f}  p50 {np.percentile(lat,50):.1f} "
      f"p95 {np.percentile(lat,95):.1f}  p99 {np.percentile(lat,99):.1f}  max {lat.max():.1f}")
```

Three rules:

**Warm up.** The first inference pays for lazy allocation, CUDA context creation and TensorRT
kernel autotuning. It can be 50× the steady-state time. Discard at least 30.

**Synchronise.** GPU calls are asynchronous. Without `cuda.synchronize()` you are timing how
long it took to *queue* the work, which is a wonderfully small and completely fictional
number.

**Report percentiles.** A p99 of 60 ms against a mean of 20 ms means one frame in a hundred
is late — which for a real-time system is the number that matters. Means hide exactly the
behaviour you are trying to prevent.

And measure **on the target, in the enclosure, warm**. A Jetson or Pi in a sealed box
throttles after fifteen or twenty minutes. Benchmark for an hour, not for a minute.

```bash
sudo tegrastats            # Jetson: clocks, temperature, power
vcgencmd measure_temp      # Pi
```

## Where the time actually goes outside inference

**Preprocessing.** Letterboxing and normalising a 1080p frame in NumPy costs 8–15 ms on an
ARM CPU — potentially more than your inference. Fixes, in order of return:

```python
# 1. Resize on the GPU if you have one, or with the ISP if the camera has one.
# 2. Ask the camera for the size you want, so there is nothing to resize.
# 3. Fuse the normalisation into the model graph at export time.
# 4. cv2.dnn.blobFromImage does resize+normalise+transpose in one optimised pass:
blob = cv2.dnn.blobFromImage(img, 1/255.0, (640,640), swapRB=True, crop=False)
```

**NMS.** O(n²) in surviving candidates, on the CPU. At `conf=0.05` you may have 900
candidates and NMS costs 20 ms; at `conf=0.25` you have 40 and it costs 2 ms. **Filter by
confidence before NMS**, always. This single line is often the largest easy win in the whole
pipeline.

**Memory copies.** Every host↔device transfer costs. Use pinned memory, and on Jetson use
unified memory to avoid the copy entirely. On a CSI camera, a zero-copy capture path
(`nvarguscamerasrc` into NVMM buffers) removes several milliseconds you would otherwise
never notice were there.

**Python.** The interpreter overhead per frame is 1–3 ms of pure loop cost. Fine at 10 FPS,
significant at 60. The usual path is Python for development and C++ for the shipped loop.

## Batching, and when it is a mistake

Batching amortises fixed overhead across frames, so throughput improves:

| Batch | Total latency | Per-frame | Throughput |
|---|---|---|---|
| 1 | 8 ms | 8 ms | 125 FPS |
| 4 | 22 ms | 5.5 ms | 182 FPS |
| 8 | 40 ms | 5 ms | 200 FPS |

But **latency for the first frame in a batch gets worse**, because it waits for the rest to
arrive. At 30 FPS, a batch of 8 means the first frame waits 233 ms before processing even
starts.

- **Multiple camera streams** → batch across cameras. Ideal case: the frames already exist
  simultaneously.
- **Offline processing of recorded video** → batch as large as memory allows.
- **One live camera, real-time response** → batch size 1. The throughput gain is not worth
  the latency.

## Pipelining

Capture, inference and post-processing use different hardware. Overlap them, exactly as in
the OpenCV series' threading lesson:

```
without:  [cap][pre][inf][post]  [cap][pre][inf][post]      23 ms/frame
with:     [cap][pre][inf][post]
               [cap][pre][inf][post]
                    [cap][pre][inf][post]                    ~9 ms/frame
```

Throughput becomes the slowest stage rather than the sum of all stages. Latency per frame
does not improve — it slightly worsens — so this is a throughput technique, and you should
know which of the two your requirement is actually about.

Use bounded queues of size 1–2 between stages and **drop frames when full**. An unbounded
queue in a real-time pipeline converts a small throughput deficit into an ever-growing lag,
and the system looks fine on a bench test and unusable after ten minutes.

## Skip frames: the biggest lever of all

From the OpenCV series, and it applies unchanged here: detect every Nth frame, track in
between.

```python
if frame_no % 5 == 0:
    detections = model(frame)          # 23 ms
    tracker.update(detections)
else:
    tracker.predict()                  # 0.5 ms
```

Effective cost per frame: `(23 + 4×0.5) / 5 = 5 ms`. Five times cheaper, and for objects
moving at ordinary speeds the output is indistinguishable. Nothing else in this lesson
returns as much for as little.

The trade is latency to *first* detection of a new object — up to N frames. For a person
walking into view at 30 FPS with N=5, that is 167 ms. Usually irrelevant; for a safety
interlock, not.

## Honest numbers by platform

YOLOv8n, 640×640, INT8 where supported, inference only:

| Platform | Latency | FPS | Notes |
|---|---|---|---|
| RTX 4090 + TensorRT | 0.9 ms | 1100 | not your deployment target |
| Jetson Orin Nano + TensorRT | 8 ms | 125 | the comfortable edge choice |
| Jetson Nano (old) + TensorRT | 45 ms | 22 | end of life, still everywhere |
| RK3588 NPU (RKNN) | 25 ms | 40 | good value, awkward toolchain |
| Coral Edge TPU | 15 ms | 65 | INT8 only, restricted op set |
| Raspberry Pi 5, ONNX INT8 | 95 ms | 10 | usable with frame skipping |
| Raspberry Pi 4, ONNX INT8 | 240 ms | 4 | detect every 10th frame + track |
| Intel N100, OpenVINO | 22 ms | 45 | underrated for the price |

Read these as within-a-factor-of-two guidance, not a specification. Thermal state, memory
bandwidth, what else runs on the board, and the specific ops in your model all move them.
**Measure on your board.**

## When you still cannot hit the budget

In order of how much they typically return:

1. **Skip frames and track.** 3–10×.
2. **Lower input resolution.** 640 → 416 is 2.4× cheaper. Check the accuracy cost on *your*
   objects; often it is small.
3. **INT8**, if you are still on FP32/FP16. 2–3×.
4. **Smaller model.** v8s → v8n is 2×.
5. **ROI.** If objects only appear in part of the frame, crop before inference. Free.
6. **Vendor NPU.** 5–10× over CPU, at the cost of a toolchain and a conversion effort.
7. **A different problem statement.** Do you need 30 FPS, or did someone say "video" and
   everyone assumed? Many inspection and counting systems are fine at 5 FPS, and that changes
   the hardware budget by an order of magnitude.

Number 7 is the one nobody asks and it has saved more projects than the other six.

## Production checklist

- [ ] p99 latency measured on the target, in the enclosure, after an hour.
- [ ] Pipeline drops frames under load rather than queueing them into a growing lag.
- [ ] Model, class names, thresholds and preprocessing parameters are versioned together.
- [ ] Confidence and NMS thresholds set from the PR curve, not copied from a tutorial.
- [ ] Failure handling: camera disconnect, accelerator fault, model file missing.
- [ ] Memory flat over a 24-hour run. Detection loops leak easily.
- [ ] A way to capture and store the frames the model got wrong — that is your next dataset.

That last one matters more than it looks. The single most valuable artefact a deployed
detector produces is a stream of its own failures, and a system that throws them away can
only be improved by guessing.

## Where this leaves you

Six lessons: what the model outputs and how to decode it, which model to pick and under what
licence, a dataset that does not sabotage you, training you can read honestly, an export you
have verified, and a latency budget measured on real hardware.

None of that is the modelling work that gets written about, and all of it is what decides
whether a detector works in the field. If you want the layer underneath — capture, threading,
frame-rate budgets, and the classical techniques that often make the network unnecessary —
the OpenCV series covers exactly that ground.

## Check yourself

1. Why must you call `cuda.synchronize()` before stopping the timer?
2. When does batching hurt, and when does it help?
3. Why does filtering by confidence before NMS matter so much?
4. What is the trade-off in detecting every 5th frame instead of every frame?
