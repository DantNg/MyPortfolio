---
lesson: 3
lang: en
title: "Classical Detection, and Why It Still Wins"
description: "Contours and the shape descriptors that classify them, template matching and its one fatal weakness, Haar and HOG cascades, and ArUco markers — the tools that run in 3 ms on one ARM core."
duration: "16 min"
tags: ["OpenCV", "Contours", "Detection"]
---

## The cost argument

A YOLOv8-nano on a Raspberry Pi 4 runs at roughly 4 FPS, needs 6 MB of weights, a runtime,
and a dataset you have to build and label. A contour-based part detector on the same board
runs at 200 FPS, needs 40 lines of code, and can be explained to a customer in one sentence.

Neural networks win when the world is messy: arbitrary backgrounds, unknown lighting, objects
you cannot describe geometrically. Classical vision wins when you control the scene — and in
industrial, robotics and instrumentation work, you usually do. Knowing where the line is
saves months.

## Contours: from mask to objects

```cpp
std::vector<std::vector<cv::Point>> contours;
cv::findContours(bin, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);
```

Two arguments carry the meaning:

- `RETR_EXTERNAL` returns only outer boundaries — the usual choice, and the fast one.
  `RETR_CCOMP` and `RETR_TREE` also give you holes and nesting, which you need when "a ring"
  and "a disc" must be distinguished.
- `CHAIN_APPROX_SIMPLE` collapses straight runs to their endpoints. A 1000-pixel rectangle
  outline becomes 4 points instead of 1000.

`findContours` in OpenCV 4 no longer modifies its input, but it still expects a
single-channel 8-bit image where non-zero means foreground.

## Describing a shape with five numbers

Raw contours are useless until you measure them. These are the descriptors that carry most of
the discriminating power in practice:

```cpp
for (const auto& c : contours) {
    double area  = cv::contourArea(c);
    if (area < 200) continue;                       // reject noise FIRST, always

    double perim = cv::arcLength(c, true);
    cv::Rect  box = cv::boundingRect(c);
    cv::RotatedRect rr = cv::minAreaRect(c);

    double circularity = 4 * CV_PI * area / (perim * perim);   // 1.0 = perfect circle
    double aspect      = double(box.width) / box.height;
    double extent      = area / (box.width * double(box.height));
    double solidity    = area / cv::contourArea(hullOf(c));    // 1.0 = convex
}
```

What each one is good for:

| Descriptor | Value for… | Separates |
|---|---|---|
| `area` | everything | noise from objects; size grading |
| `circularity` | 1.0 circle, 0.78 square, low for a starfish | round parts from angular ones |
| `aspect` | width/height of the upright box | screws from washers |
| `extent` | how much of its box it fills | crosses and Ls from blocks |
| `solidity` | area / convex hull area | gears and combs from solid discs |

Note that `aspect` from `boundingRect` is orientation-dependent — a rotated rectangle changes
it. Use `minAreaRect().size` when the object can arrive at any angle; that gives you the
aspect ratio of the *object*, plus its angle for free.

Polygon approximation classifies straight-edged shapes directly:

```cpp
std::vector<cv::Point> approx;
cv::approxPolyDP(c, approx, 0.02 * cv::arcLength(c, true), true);
switch (approx.size()) {
    case 3: /* triangle */ break;
    case 4: /* square or rectangle — check aspect */ break;
    default: if (circularity > 0.8) { /* circle */ } break;
}
```

The epsilon — `0.02 * perimeter` — is the tolerance. Too small and a noisy edge becomes a
dodecagon; too large and a rectangle collapses to a triangle. Two percent is a good default
for clean masks.

## The moment worth knowing

```cpp
cv::Moments m = cv::moments(c);
cv::Point2f centre(m.m10 / m.m00, m.m01 / m.m00);
```

The centroid, sub-pixel accurate and cheaper than anything else that gives you a position.
`m.m00` equals the area, so guard against zero. `cv::matchShapes()` compares two contours
using Hu moments, which are invariant to scale, rotation and reflection — a genuinely useful
one-line classifier when you have a reference shape.

## Template matching, and its fatal flaw

```cpp
cv::matchTemplate(scene, templ, result, cv::TM_CCOEFF_NORMED);
double maxVal; cv::Point maxLoc;
cv::minMaxLoc(result, nullptr, &maxVal, nullptr, &maxLoc);
if (maxVal > 0.8) { /* found at maxLoc */ }
```

`TM_CCOEFF_NORMED` is the method to use — normalised, so the score is roughly comparable
between images, and it tolerates uniform brightness change.

The flaw: template matching **is not invariant to rotation or scale.** Rotate the object by
ten degrees and the score collapses. If the object can rotate, you either match a stack of
rotated templates (cost multiplies) or use something else. It is the right tool for
fixed-orientation problems: a logo on a label, an icon on a known screen, a fiducial in a
jig.

Speed note: cost is roughly *scene area × template area*. Search inside an ROI you already
know is plausible, and match on a half-resolution pyramid level first, then refine.

## Cascades: Haar and HOG

```cpp
cv::CascadeClassifier face("haarcascade_frontalface_default.xml");
std::vector<cv::Rect> faces;
face.detectMultiScale(gray, faces, 1.1, 4, 0, cv::Size(60, 60));
```

The parameters are the whole story:

- `scaleFactor` 1.1 — how much the search window grows per pyramid level. 1.05 is more
  thorough and much slower; 1.3 is fast and misses things.
- `minNeighbors` 4 — how many overlapping hits are required to keep a detection. Raise it to
  kill false positives, lower it if you are missing real ones.
- `minSize` — set it. Without it you search absurdly small scales and pay for the privilege.

Haar cascades are fast, ship with OpenCV, and are genuinely usable for frontal faces and a
handful of other trained objects. They fail on rotation and profile views, and the false
positive rate on textured backgrounds is real. HOG plus a linear SVM is the same idea with a
better feature; `cv::HOGDescriptor` with the default people detector is the classic
pedestrian baseline.

Treat both as what they are: 2005-era detectors that cost almost nothing. When they work,
they save you a GPU.

## ArUco: when you are allowed to change the world

If you can put a marker on the object, do it. Nothing else gives you this much for this
little:

```cpp
auto dict = cv::aruco::getPredefinedDictionary(cv::aruco::DICT_4X4_50);
cv::aruco::ArucoDetector det(dict);

std::vector<int> ids;
std::vector<std::vector<cv::Point2f>> corners;
det.detectMarkers(frame, corners, ids);
```

You get, per marker: an identity, four corners with sub-pixel accuracy, and — once you have
the calibration from lesson 4 — full 6-DoF pose. Detection is a few milliseconds and
essentially never produces a false positive, because the dictionary is error-correcting.

Robot arms, AGV docking, camera-to-workspace registration, ground truth for evaluating
something else: markers are the answer more often than people expect, and the objection is
almost always aesthetic rather than technical.

## A complete classical detector

Counting and grading circular parts on a belt, end to end:

```cpp
cv::cvtColor(frame, gray, cv::COLOR_BGR2GRAY);
cv::GaussianBlur(gray, blur, {5,5}, 1.5);
cv::threshold(blur, bin, 0, 255, cv::THRESH_BINARY_INV | cv::THRESH_OTSU);
cv::morphologyEx(bin, bin, cv::MORPH_OPEN, k);

std::vector<std::vector<cv::Point>> cs;
cv::findContours(bin, cs, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);

int good = 0, bad = 0;
for (const auto& c : cs) {
    double a = cv::contourArea(c);
    if (a < 500 || a > 50000) continue;                 // not a part at all

    double circ = 4 * CV_PI * a / std::pow(cv::arcLength(c, true), 2);
    cv::Point2f ctr; float r;
    cv::minEnclosingCircle(c, ctr, r);

    bool ok = circ > 0.85 && r > 18.0f && r < 24.0f;     // round, and the right size
    (ok ? good : bad)++;
    cv::circle(frame, ctr, int(r), ok ? cv::Scalar(0,200,0) : cv::Scalar(0,0,220), 2);
}
```

About 3 ms per frame at 720p on one ARM core, with thresholds you can explain to the person
who has to sign off on the machine. That last property is worth more than it sounds.

## Where the line is

Reach for classical vision when the scene is controlled, the object is describable by
geometry or colour, and you need it on a small CPU. Reach for a network when the background
is arbitrary, the object class is visually diverse, or the rules would need fifty tuned
constants. Many shipped systems use both: a cheap classical stage to find candidate regions,
a network only on the crops that survive.

## Check yourself

1. What does `RETR_EXTERNAL` throw away, and when do you need what it discards?
2. Which two descriptors would separate a washer from a solid disc of the same diameter?
3. Why does template matching fail on a rotated object, and what would you do instead?
4. What does raising `minNeighbors` trade for what?

## Next

Everything so far has been in pixels. Lesson 4 gets you to millimetres: the pinhole model,
intrinsics and distortion, running a chessboard calibration properly, homography for a
top-down view, and solvePnP for pose.
