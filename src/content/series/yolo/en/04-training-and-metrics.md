---
lesson: 4
lang: en
title: "Training, and Reading the Metrics Honestly"
description: "The arguments that actually matter, what each loss curve is telling you, reading the confusion matrix and PR curve, the overfitting signals that appear before mAP moves, and when to stop."
duration: "16 min"
tags: ["YOLO", "Training", "Metrics"]
---

## The training run

```python
from ultralytics import YOLO

model = YOLO("yolov8n.pt")        # pretrained weights, not yolov8n.yaml
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

Note `yolov8n.pt`, not `yolov8n.yaml`. The `.pt` starts from COCO weights; the `.yaml` starts
from random initialisation and needs an order of magnitude more data to reach the same place.
Transfer learning is not optional for a normal-sized dataset.

**Name your runs.** `v1_baseline`, `v2_more_data`, `v3_imgsz1280`. Six weeks in you will be
comparing eleven runs and `train`, `train2`, `train11` will tell you nothing.

## The arguments that matter

| Argument | Default | When to change |
|---|---|---|
| `epochs` | 100 | 100 is a reasonable start; `patience` will stop you early anyway |
| `imgsz` | 640 | **Raise to 1280 for small objects.** Biggest accuracy lever you have |
| `batch` | 16 | As large as VRAM allows; `batch=-1` auto-sizes to ~60% VRAM |
| `patience` | 100 | **Set it to 25.** Stops when val mAP has not improved in 25 epochs |
| `lr0` | 0.01 | Leave it. Lower to 0.001 only if loss is unstable |
| `optimizer` | auto | Leave it |
| `freeze` | None | `freeze=10` freezes the backbone — for very small datasets |
| `cache` | False | `cache=True` (RAM) or `'disk'` if data loading is your bottleneck |
| `close_mosaic` | 10 | Leave it |
| `rect` | False | `True` for consistently non-square inputs, saves padding compute |

`imgsz` deserves the emphasis. If your objects are 20–40 pixels across at 640, they are near
the limit of what the stride-8 head can represent. Going to 1280 often gains more mAP than
going up two model sizes, at less inference cost.

## What each loss curve means

Three losses, and they say different things:

- **`box_loss`** — how well the predicted boxes align with ground truth. Falls fast early,
  then slowly. If it plateaus high, your boxes are the problem: inconsistent annotation
  tightness, or objects too small for the input resolution.
- **`cls_loss`** — classification. If this stays high while `box_loss` is fine, the model
  finds objects but confuses their classes: your class boundary is ambiguous, or two classes
  are genuinely too similar.
- **`dfl_loss`** — distribution focal loss, refining the box edges. Watch it, but it is
  rarely the thing you act on.

![Reading the training curves](/MyPortfolio/images/yolo/training-curves.svg)

The shapes and their diagnosis:

**Both train and val loss falling, val flattening.** Normal, healthy. Let it run.

**Train falling, val *rising*.** Overfitting. It usually starts 20–40 epochs before mAP
visibly drops, so this is your early warning. Fixes in order: more data, stronger
augmentation, a smaller model, `freeze`.

**Both flat and high from the start.** Something is broken, not undertrained. Check that
labels are being found (the run header prints how many), check `data.yaml` paths, check that
your class ids match `names`.

**Loss going to NaN.** Learning rate too high, or corrupt labels — a zero-width box will do
it. Validate the labels, then lower `lr0`.

**Val loss noisy, jumping around.** Batch too small, or a validation set too small to be
stable. Below ~200 val images, mAP has several points of noise and you cannot compare runs
reliably.

## mAP going up is not the same as the model getting better

The single number hides everything you need. After every run, open `results.png` and the
generated plots, and read four things:

**Per-class AP.** Printed at the end of validation. This is where you find that the model is
at 0.91 on `person` and 0.22 on `helmet`, while the headline mAP of 0.57 looked acceptable.
The rare class problem is invisible in the average.

**The confusion matrix** (`confusion_matrix_normalized.png`). Read the last row and column,
which are the `background` entries — they are the informative ones:

- High values in the **background column** → false negatives. The model is missing real
  objects. More data, lower confidence threshold, higher resolution.
- High values in the **background row** → false positives. The model detects things that are
  not there. Add negative images.
- Off-diagonal between two classes → genuine class confusion. Check your annotation guideline
  and whether those classes should be merged.

**The PR curve** (`PR_curve.png`). This is what tells you where to set your confidence
threshold, as in lesson 1. A curve that drops off a cliff at recall 0.7 means there is a
group of objects the model simply never finds, no matter the threshold — go find out which
ones.

**Actual predictions.** `val_batch0_pred.jpg` next to `val_batch0_labels.jpg`. Look at them.
Every time. Numbers tell you that something is wrong; images tell you what.

## The validation trap

```python
metrics = model.val()               # uses the val split from data.yaml
print(metrics.box.map, metrics.box.map50)
print(metrics.box.maps)             # per class
```

Your validation set has been shaping every decision you made — early stopping, which run to
keep, which threshold. It is no longer an unbiased estimate of anything.

```python
metrics = model.val(data="dataset/data.yaml", split="test")
```

Run the test set **once**, at the end, and report that number. If it is much worse than
validation, you have tuned to the validation set — which usually means the val set is too
small or too similar to train.

## Iterating like an engineer

Change one thing per run and write down what happened:

```
v1  yolov8n, 640, 800 imgs        mAP50-95 0.412   baseline
v2  + 400 imgs from evening       mAP50-95 0.468   biggest single gain
v3  v2 + imgsz 1280               mAP50-95 0.501   small objects, worth 2x latency
v4  v3 + yolov8s                  mAP50-95 0.514   +0.013 for 2x params — not worth it
v5  v3 + fixed helmet annotations mAP50-95 0.552   relabelled 300 imgs. Best return.
```

That log is the actual deliverable of a training phase. It answers "what should we do next"
with evidence, and it stops you from re-running an experiment you already tried in March.

Notice the pattern in it, because it is the usual one: **data changes beat architecture
changes.** v2 and v5 — more data and better labels — gave more than v4's doubled model.

## When to stop

Stop when the marginal cost of the next improvement exceeds its value. Concretely:

- The test-set number meets the requirement you wrote down before you started. (You did write
  one down. "As accurate as possible" is not a requirement, it is an open-ended budget.)
- The remaining errors are cases a human also finds ambiguous. Go look at the failures — when
  they are genuinely hard frames, more training will not fix them.
- Two consecutive experiments gained under a point. You are in the flat part of the curve.

And the reverse: if you are five runs in and still under half your target, stop tuning
hyperparameters. Something structural is wrong — usually the data, occasionally the framing
of the problem.

## Reproducibility

```python
model.train(..., seed=0, deterministic=True)
```

Slower, and worth it while you are comparing runs — otherwise a 0.01 mAP difference between
two configurations might be pure seed variance. Also save, with every model you keep:
`data.yaml`, the dataset commit or hash, the full training arguments (Ultralytics writes
`args.yaml` for you), and the metrics. In six months someone will ask why the model changed,
and "we retrained it" is not an answer.

## Check yourself

1. Why start from `.pt` rather than `.yaml`?
2. `cls_loss` stays high while `box_loss` converges — what does that suggest?
3. What do the background row and background column of the confusion matrix mean?
4. Why is your validation mAP no longer an unbiased estimate by the end of a project?

## Next

You have a trained `.pt` file, which cannot run on your target. Lesson 5 is export: ONNX and
its opset traps, TensorRT and TFLite, INT8 quantisation and calibration, and how to verify
that the exported model still does what the original did.
