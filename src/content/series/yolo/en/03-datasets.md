---
lesson: 3
lang: en
title: "The Dataset Decides Everything"
description: "YOLO's label format, splits that do not leak, how many images you actually need, class imbalance, the annotation mistakes that silently cap your accuracy, and which augmentations are safe."
duration: "16 min"
tags: ["YOLO", "Dataset", "Annotation"]
---

## Where the accuracy actually comes from

Going from `yolov8n` to `yolov8m` might buy you 8 mAP. Fixing a dataset where 15% of the
boxes are wrong buys you more, and costs a week rather than a permanent 4× in inference time.

Almost every detector that underperforms in production does so because of its data, and
almost every team's first instinct is to try a bigger model. This lesson is the higher-value
one.

## The label format

One `.txt` per image, same basename, one line per object:

```
<class_id> <cx> <cy> <w> <h>
```

All four coordinates **normalised to 0…1** and relative to image size, with `cx, cy` being
the box *centre*, not its corner.

```
0 0.512 0.634 0.180 0.290
2 0.221 0.400 0.075 0.140
```

An image with no objects gets an **empty file**, not a missing one. Those are your negative
examples and they matter — see below.

The directory layout Ultralytics expects:

```
dataset/
  images/train/  img001.jpg …
  images/val/    img201.jpg …
  labels/train/  img001.txt …
  labels/val/    img201.txt …
  data.yaml
```

```yaml
path: /abs/path/to/dataset
train: images/train
val: images/val
names:
  0: person
  1: helmet
  2: vest
```

The loader finds labels by replacing `/images/` with `/labels/` in the path. If your training
starts and reports "0 labels found", that string substitution is what failed — usually a
directory called `image` or `Images`.

## Splits, and the leak that inflates every number

```
train  70%    what the model learns from
val    20%    what you tune against
test   10%    touched once, at the end
```

The rule that matters: **split by source, not by frame.** If you extracted 3000 frames from
30 videos and split randomly, frames 41 and 42 of the same video — near-identical images —
land on opposite sides of the split. Your validation mAP will read 0.94 and the model will
fail in the field, because you measured memorisation.

```python
# WRONG
random.shuffle(all_frames); train = all_frames[:2100]

# RIGHT
random.shuffle(video_ids)
train_videos, val_videos = video_ids[:21], video_ids[21:27]
train = [f for f in all_frames if f.video in train_videos]
```

Same reasoning for any other correlated group: the same physical object, the same day, the
same camera position, the same lighting session. If your deployment will see a *new* one of
something, that something must be split on.

And keep the test set genuinely untouched. Once you have tuned against a set, it reports
optimistically forever.

![Splitting by source, not by frame](/MyPortfolio/images/yolo/dataset-splits.svg)

## How many images

Honest working numbers for a fine-tune from COCO weights:

| Situation | Images per class |
|---|---|
| Absolute minimum to see it work | 150 |
| Usable prototype | 500 |
| Production, controlled scene | 1 500 |
| Production, varied conditions | 5 000+ |

But the count is the less important half. **Variation is the other half**, and it is what
people underinvest in:

- Every lighting condition the device will see — including the bad ones. Dawn, fluorescent,
  backlit, headlights.
- Every angle and distance.
- Occlusion. Objects half behind other objects, at the edge of frame, cut off.
- Motion blur, if the real thing moves.
- The actual camera and lens you will deploy. A dataset shot on a phone and deployed on a
  wide-angle security camera has a domain gap you cannot train away.

A thousand images from one afternoon in good light is a worse dataset than three hundred
spanning a week of real conditions. When you cannot collect variety, you can sometimes buy
some of it back with augmentation — but only some.

## The annotation errors that cap your accuracy

These are the ones I see repeatedly, in order of damage:

**Inconsistent tightness.** One annotator boxes the person including their shadow, another
boxes only the body. The model learns the average and is confidently sloppy. Write down the
rule — *"box the visible extent of the object, excluding shadow"* — and put it in a document
with example images before anyone labels a single frame.

**Missing objects.** A small object in the background that nobody labelled is being actively
taught to the model as *background*. This is worse than not having the image at all, because
it produces a model that suppresses exactly the case you missed. Missing labels are the most
damaging error type, and the hardest to notice.

**Class confusion at the boundary.** Where does "truck" end and "van" begin? Decide, write it
down, and show examples. Otherwise annotators drift, and the model learns the drift.

**Occlusion policy.** Do you label the amodal extent (where the object would be if you could
see through the obstruction) or only the visible part? Both are defensible. Mixing them is
not.

**Coordinate bugs.** Boxes outside 0…1, zero-area boxes, `x1 > x2`. Validate mechanically:

```python
for line in open(label_file):
    c, cx, cy, w, h = line.split()
    assert 0 <= float(cx) <= 1 and 0 <= float(cy) <= 1
    assert 0 < float(w) <= 1 and 0 < float(h) <= 1
```

**Look at your labels.** Render 100 random images with their boxes drawn and page through
them. It takes twenty minutes and it always finds something. Do it after the first 200 images
are labelled, not after all 5000.

## Class imbalance

A dataset with 5000 `person` and 80 `helmet` will produce a model that barely detects
helmets, and a mAP number that looks fine because it averages over classes.

What actually helps, in order:

1. **Collect more of the rare class.** Boring, and the only real fix.
2. **Oversample the images containing it** — list them multiple times in the training set.
   Crude, effective.
3. **Copy-paste augmentation** — paste rare-class instances into other images. Surprisingly
   effective for small rigid objects.
4. **Reconsider the class split.** If two rare classes are visually similar and you rarely
   need to distinguish them, merge them.

What does not help: class weights in the loss. They exist and they rarely move the number
much for detection.

## Negative images

Include images with no objects at all — about 10% of your set. Specifically, images
containing the things your model will *falsely* detect: an empty conveyor, a shop mannequin
if you detect people, a picture of a car on a poster.

Those are the false positives you will otherwise spend a week trying to threshold away, and a
few hundred negatives fix them properly.

## Augmentation: what is safe and what is not

Ultralytics augments by default. The relevant defaults, and when to change them:

```yaml
hsv_h: 0.015      # hue shift    — DANGEROUS if colour is your signal
hsv_s: 0.7        # saturation
hsv_v: 0.4        # brightness   — keep, real lighting varies
degrees: 0.0      # rotation     — raise for aerial/microscopy
translate: 0.1
scale: 0.5        # zoom         — the highest-value one
shear: 0.0
flipud: 0.0       # vertical flip — usually wrong
fliplr: 0.5       # horizontal flip — usually right
mosaic: 1.0       # 4 images combined — strong, helps small objects
mixup: 0.0
```

The judgement calls:

- **`fliplr`** is right for most things and wrong for anything chiral. Text, road signs, and
  "left hand vs right hand" classes break under a horizontal flip.
- **`flipud`** is wrong for ground-level cameras (people are not upside down) and right for
  aerial or microscope imagery.
- **`hsv_h`** must be near zero if you are classifying by colour — a red and a green part
  will be augmented into each other.
- **`degrees`** should be 0 for a fixed camera and up to 180 for imagery with no canonical
  orientation.
- **`mosaic`** is strong and helps small-object performance. Ultralytics disables it for the
  last 10 epochs (`close_mosaic: 10`) because training entirely on mosaics leaves a gap
  against real single images.

The principle: **augment along the axes your deployment will actually vary, and not along the
ones it will not.** Augmentation that produces images your camera can never see costs
capacity for nothing.

## Before you press train

- [ ] Labels visually inspected — at least 100 random images with boxes drawn.
- [ ] Split by source, verified: no two frames from one video across the boundary.
- [ ] Class counts printed. The rarest class has enough to learn from.
- [ ] Empty-label files exist for negative images.
- [ ] All coordinates validated in 0…1.
- [ ] Images taken with the deployment camera, in deployment lighting.
- [ ] An annotation guideline document exists, with pictures.
- [ ] Test set separated and untouched.

Every one of those is cheaper now than after a training run.

## Check yourself

1. Why does a random frame-level split inflate validation mAP?
2. Why is a missing label worse than a missing image?
3. When must you set `hsv_h` to zero?
4. What are negative images for, and roughly what fraction of the set?

## Next

Lesson 4 is training: the arguments that matter, how to read loss curves and the confusion
matrix honestly, the difference between mAP going up and your model getting better, and the
overfitting signals that show up long before the number moves.
