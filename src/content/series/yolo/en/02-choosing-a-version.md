---
lesson: 2
lang: en
title: "Choosing a Version, and the Licence Question"
description: "What actually changed between YOLOv5, v8 and v11, what n/s/m/l/x cost in latency and accuracy, when a non-YOLO detector is the better answer, and the AGPL problem nobody mentions until legal does."
duration: "14 min"
tags: ["YOLO", "Model Selection", "Licensing"]
---

## The version churn, in one paragraph

YOLOv1 through v4 came from the original authors. v5 came from Ultralytics, in PyTorch, and
won on usability rather than novelty. v6 (Meituan), v7 (the v4 authors) and v9 are research
lines. v8 and v11 are Ultralytics again, and v8's real change was architectural: **anchor-free
prediction with a decoupled head**, meaning no anchor box tuning and a cleaner output tensor.
v10 removed NMS from the pipeline entirely by training the model to emit one box per object.

You do not need this history. You need to know that the accuracy differences between recent
versions are a couple of mAP points, and **the differences that will actually decide your
project are tooling, export support and licence.**

## What the sizes cost

For YOLOv8 on COCO, 640×640 input:

| Model | Params | mAP@50-95 | T4 GPU | Jetson Orin Nano | Pi 4 CPU |
|---|---|---|---|---|---|
| v8n | 3.2 M | 37.3 | 1.5 ms | 8 ms | 240 ms |
| v8s | 11.2 M | 44.9 | 2.7 ms | 15 ms | 620 ms |
| v8m | 25.9 M | 50.2 | 5.9 ms | 33 ms | 1.6 s |
| v8l | 43.7 M | 52.9 | 9.1 ms | 55 ms | — |
| v8x | 68.2 M | 53.9 | 14.4 ms | 88 ms | — |

Read that table as a curve with a knee. **From n to s: +7.6 mAP for 1.8× the time.** From l
to x: +1.0 mAP for 1.6× the time. Almost nobody should be running x on an edge device; the
last two points of mAP cost more than they return, and you would get more by fixing your
dataset.

Two corrections people need:

- **These are COCO numbers, on 80 classes.** Your 3-class problem is far easier. A nano model
  fine-tuned on a good single-purpose dataset routinely beats a large model's COCO figure on
  that specific task.
- **Input size matters as much as model size.** v8n at 320×320 is roughly four times faster
  than at 640×640 and loses perhaps 6 mAP. If your objects are large in frame, that is a
  much better trade than dropping to a smaller model.

## How to actually choose

Work backwards from the deployment target, not forwards from the leaderboard.

**Start at nano.** Always. Train it, measure it on your validation set, and only move up if
it is genuinely not accurate enough. Half the projects that start with `yolov8m` would have
shipped with `yolov8n` at four times the frame rate.

**Then check your latency budget** — the whole budget, as in the OpenCV series: capture,
preprocessing, inference, NMS, and your logic. Inference is usually 60–70% of it, not 100%.

**Then check the objects.** If the things you detect are small in frame — under about 30 px —
you need input resolution, not parameters. A v8n at 1280 beats a v8m at 640 for small objects
and is often faster too.

Rough guidance by target:

- **Jetson Orin / decent GPU** — v8s or v8m at 640. You have room.
- **Jetson Nano, RK3588, Coral** — v8n at 416 or 640, INT8. This is the mainstream edge case.
- **Raspberry Pi, plain ARM** — v8n at 320, INT8, and honestly reconsider whether the OpenCV
  series' classical approach solves your problem for 2% of the compute.
- **Microcontroller** — not YOLO. Look at a purpose-built tiny model or classical vision.

## The licence problem

This one has cost companies real money and is almost never mentioned in tutorials.

**Ultralytics YOLOv5, v8 and v11 are AGPL-3.0.** The AGPL's network clause means that if your
software is used over a network — a web service, a device that phones home, an API — you must
offer the complete corresponding source of your application under AGPL. Not just the model.
Your application.

Your options:

1. **Buy the Ultralytics commercial licence.** Straightforward, priced per company, and the
   normal answer for a commercial product.
2. **Use a permissively licensed detector.** YOLOX (Apache 2.0), NanoDet (Apache 2.0),
   RT-DETR variants, or MMDetection's model zoo. Slightly more work, no licence risk.
3. **Verify that AGPL is genuinely fine for you.** Internal-only tooling with no external
   network users, or a genuinely open-source project.

What does **not** work is the widespread assumption that "we only use the weights, not the
code". You use the code — for training, export, and usually inference. Check this at the
start of a project, not when the legal review lands two weeks before launch.

## The alternatives worth knowing

| Model | Licence | Strength | Use when |
|---|---|---|---|
| **YOLOX** | Apache 2.0 | anchor-free, close to v8 accuracy | you need a permissive licence |
| **NanoDet-Plus** | Apache 2.0 | ~1 M params, built for ARM | very small CPU targets |
| **MobileNet-SSD** | Apache 2.0 | ancient, ubiquitous, tiny | hardware with a fixed NPU model zoo |
| **RT-DETR** | Apache 2.0 | transformer, no NMS | GPU deployment, crowded scenes |
| **YOLO-NAS** | mixed — read it | strong INT8 quantisation behaviour | you are going INT8 on a GPU |

And the thing to check before any of them: **what does your target hardware's runtime
actually support?** A Coral Edge TPU needs full INT8 TFLite with a supported op set. Rockchip
NPUs need RKNN conversion. Hailo needs its own compiler. The model that converts cleanly for
your accelerator beats the model that scores two points higher and does not convert. Find
the vendor's supported-model list *before* you choose, not after.

## Just use a pretrained model, if you can

Before training anything, check whether the COCO classes cover you. The 80 classes include
person, car, truck, bus, bicycle, dog, cat, bottle, chair, laptop, cell phone, and more.

```python
from ultralytics import YOLO
model = YOLO("yolov8n.pt")
results = model("street.jpg", classes=[0, 2, 7])   # person, car, truck only
```

If you need people and vehicles, you are done — no dataset, no training, no labelling budget.
Filtering to the classes you want also speeds up NMS. A surprising number of projects spend
three weeks building a dataset for something a pretrained model already does.

Fine-tune when your objects are not in COCO, when they are visually unusual (industrial
parts, medical images, aerial views), or when the pretrained model is measurably weak on
*your* footage. Measure that first — run the pretrained model on 200 of your real frames and
count the errors by hand. It takes an afternoon and it decides the next month.

## The decision, compressed

1. Can a pretrained COCO model do it? → ship it.
2. Need to fine-tune? → start with `yolov8n`, on your target input size.
3. Is it accurate enough on your validation set? → stop. Do not go bigger out of habit.
4. Not accurate enough? → **more/better data before a bigger model.** Almost always the
   bigger win.
5. Commercial product? → resolve the licence now.
6. Specific accelerator? → check its supported-model list before committing.

## Check yourself

1. Why is the jump from v8n to v8s usually worth it and l to x usually not?
2. When is input resolution the better lever than model size?
3. What does the AGPL network clause require, and who does it affect?
4. What should you check about your target accelerator before picking a model?

## Next

You have picked a model. Lesson 3 is the part that decides whether it works: building a
dataset. Label format, splits that do not leak, class imbalance, the annotation errors that
silently cap your accuracy, and how many images you actually need.
