---
lesson: 1
lang: en
title: "What a Detector Actually Outputs"
description: "The raw tensor a YOLO model produces, how to decode it by hand, why IoU and NMS decide half your results, and what mAP@50-95 is really measuring."
duration: "15 min"
tags: ["YOLO", "NMS", "mAP"]
---

## The tensor, before anyone prettifies it

`model(img)` returning a tidy list of boxes hides the thing you most need to understand. A
YOLOv8 model given a 640×640 image produces a single tensor of shape:

```
(1, 84, 8400)
```

- **8400** — the number of candidate predictions. It is `80² + 40² + 20²`: three detection
  heads at strides 8, 16 and 32. Every one of those cells predicts a box, always, whether or
  not anything is there.
- **84** — 4 box values + 80 class scores, for a COCO model. On your own 3-class dataset it
  would be 7.
- The 4 box values are `cx, cy, w, h` in **pixels of the network input**, not of your
  original image, and not normalised.

Two things follow immediately. First, the model does not decide what is an object — it emits
8400 guesses and the *post-processing* decides. Second, if your boxes come out in the wrong
place, the bug is almost always in the coordinate transform between network input and
original image, not in the model.

![From raw tensor to final boxes](/MyPortfolio/images/yolo/detector-output.svg)

## Decoding it by hand, once

Do this once and you will never again be confused by a deployment that produces boxes in the
top-left corner.

```python
import numpy as np

out = raw[0].T                        # (8400, 84)
boxes_xywh = out[:, :4]               # cx, cy, w, h  in 640-space
class_scores = out[:, 4:]             # (8400, 80)

conf = class_scores.max(axis=1)
cls  = class_scores.argmax(axis=1)

keep = conf > 0.25                    # confidence threshold
boxes_xywh, conf, cls = boxes_xywh[keep], conf[keep], cls[keep]

# xywh (centre) -> xyxy (corners)
xy = boxes_xywh[:, :2]; wh = boxes_xywh[:, 2:]
boxes = np.concatenate([xy - wh / 2, xy + wh / 2], axis=1)

keep = nms(boxes, conf, iou_threshold=0.45)
boxes, conf, cls = boxes[keep], conf[keep], cls[keep]

boxes = undo_letterbox(boxes, orig_shape, (640, 640))   # back to original pixels
```

**Note what is not there.** YOLOv8 and later have no separate "objectness" score — the class
score *is* the confidence. YOLOv5 does have one, and its output is `(1, 25200, 85)` with the
extra column being objectness, which you must multiply by the class score. Mixing the two
conventions up is the single most common cause of a working model producing garbage after
export.

## Letterboxing, and the off-by-a-strip bug

The network wants 640×640; your camera gives 1920×1080. Squashing it distorts every object,
so the standard is *letterbox*: scale to fit, pad the rest with grey.

```
1920x1080  --scale 0.333-->  640x360  --pad 140 top+bottom-->  640x640
```

Which means undoing it is not just a multiply:

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

Forget the padding subtraction and every box is offset vertically by 140 pixels. It looks
like a broken model; it is four lines of arithmetic.

## IoU: one number, used everywhere

```python
def iou(a, b):
    x1 = max(a[0], b[0]); y1 = max(a[1], b[1])
    x2 = min(a[2], b[2]); y2 = min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = area(a) + area(b) - inter
    return inter / union if union > 0 else 0.0
```

Intersection over union: 1.0 for identical boxes, 0.0 for disjoint ones. It appears in three
different roles and it is worth keeping them separate in your head:

1. **In NMS**, to decide whether two predictions are the same object.
2. **In evaluation**, to decide whether a prediction matches a ground-truth box.
3. **In tracking**, to associate detections across frames (as in the OpenCV series).

A useful intuition: **IoU 0.5 is a sloppy-looking box.** Two boxes of the same size offset by
a third of their width already score about 0.5. When people say a detector is "accurate at
IoU 0.5", they mean *roughly* in the right place.

## NMS, and the threshold that costs you real detections

The model emits many overlapping boxes for the same object. Non-maximum suppression keeps the
best and deletes its neighbours:

```python
def nms(boxes, scores, iou_threshold=0.45):
    order = scores.argsort()[::-1]
    keep = []
    while len(order):
        i = order[0]; keep.append(i)
        rest = order[1:]
        ious = np.array([iou(boxes[i], boxes[j]) for j in rest])
        order = rest[ious < iou_threshold]      # drop everything too similar
    return keep
```

Sort by score, take the best, throw away everything overlapping it, repeat.

**The threshold is a real trade-off, not a magic constant.** At 0.45, two genuinely
overlapping objects — a person standing in front of another person — will have one of them
deleted. Raise it to 0.7 and crowded scenes work better while duplicate boxes start
appearing on single objects.

Two things everyone should know:

- **NMS must be class-wise.** A dog standing in front of a car must not suppress the car.
  Every real implementation offsets the boxes by `class_id * 10000` before running a single
  NMS pass, which achieves the same thing cheaply.
- **NMS costs time.** It is O(n²) in the surviving boxes, and it runs on the CPU even when
  the model runs on a GPU. A low confidence threshold that leaves 900 candidates can make NMS
  cost more than inference. Filter by confidence *first* — that one line is often the
  cheapest speedup in the whole pipeline.

Soft-NMS decays neighbours' scores instead of deleting them, which helps in crowds at some
cost in speed. Worth knowing it exists; rarely worth the complexity.

## Confidence: what the number means and does not

The confidence is the model's calibrated-ish estimate that this box is that class. It is
**not** a probability in any rigorous sense, and it is not comparable between models or even
between training runs of the same model.

Which is why the right way to choose it is empirical:

- **0.25** is the usual default and is deliberately permissive.
- Higher for anything where a false positive is expensive — an automatic reject arm, an
  alarm to a human.
- Lower where a miss is expensive and a human reviews the output — medical triage,
  security review.

Plot precision and recall against confidence on *your* validation set and pick the point that
matches the cost of your two error types. This is a business decision that people keep making
by copying a number from a tutorial.

## mAP, decoded

The metric everyone quotes and few can define. Building it up:

For one class, at one IoU threshold: sort every prediction by confidence, walk down the list,
mark each as a true positive (matches an unmatched ground-truth box at ≥ threshold IoU) or a
false positive. That traces a precision–recall curve. **Average precision** is the area under
it.

- **mAP@50** — AP at IoU 0.5, averaged over classes. Lenient about box placement.
- **mAP@50-95** — the average of AP at IoU 0.50, 0.55, … 0.95. This is the COCO metric and
  the one worth caring about, because it rewards boxes that are actually *tight*.

A model at mAP@50 = 0.85 and mAP@50-95 = 0.52 is finding the right objects and drawing sloppy
boxes around them. Whether that matters depends entirely on what you do next: for counting
people it is fine, for measuring a part's dimensions it is useless.

Note that **mAP is averaged over classes, unweighted.** One rare class that the model fails
at drags the whole number down as much as your most important class. Always look at per-class
AP, not just the headline. The single number exists to rank leaderboard entries; you are not
on a leaderboard.

## Sanity checks before you trust anything

```python
print(raw.shape)                        # know your layout before decoding
print(boxes[:5], conf[:5], cls[:5])     # boxes inside the image? conf in 0..1?
print(f"{len(boxes)} after NMS from {keep_count} candidates")
```

And draw the boxes. Every time. Ninety percent of "the model is broken" turns out to be a
coordinate transform, and one `cv2.imshow` shows it instantly.

## Check yourself

1. What are the two numbers in a `(1, 84, 8400)` output, and where does 8400 come from?
2. Why does forgetting letterbox padding shift boxes rather than scale them?
3. What does raising the NMS IoU threshold from 0.45 to 0.7 improve, and what does it break?
4. What does a large gap between mAP@50 and mAP@50-95 tell you?

## Next

Now that you know what comes out, lesson 2 answers what goes in: which YOLO version to
choose, what the n/s/m/l/x sizes actually cost, the alternatives worth considering, and the
licence question that has cost companies real money.
