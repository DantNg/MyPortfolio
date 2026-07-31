---
lesson: 5
lang: en
title: "Motion and Tracking"
description: "Frame differencing versus MOG2, sparse and dense optical flow, the built-in trackers and what each costs, and a Kalman filter that keeps an object's identity alive through an occlusion."
duration: "16 min"
tags: ["OpenCV", "Tracking", "Optical Flow"]
---

## Detection is expensive; tracking is cheap

Running a detector on every frame is the obvious design and usually the wrong one. Detection
answers "what is in this image", which is hard. Tracking answers "where did the thing I
already found move to", which is much easier because you have a prior — the object was
*here* 33 milliseconds ago and objects do not teleport.

The pattern that scales: **detect every N frames, track in between.** A detector at 4 FPS
plus a tracker at 200 FPS gives you a system that behaves like 30 FPS. Almost every shipped
vision system is built this way.

## Frame differencing: the cheapest motion signal

```cpp
cv::absdiff(prevGray, gray, diff);
cv::threshold(diff, motion, 25, 255, cv::THRESH_BINARY);
cv::morphologyEx(motion, motion, cv::MORPH_OPEN, k);
prevGray = gray.clone();
```

Four lines, under a millisecond, and it genuinely works for "did anything move" on a fixed
camera. The limitations are equally simple: a stopped object disappears, a uniformly coloured
object shows only its leading and trailing edges, and every lighting change is motion.

## MOG2: a background model that adapts

```cpp
auto bg = cv::createBackgroundSubtractorMOG2(500,    // history, in frames
                                             16,     // variance threshold
                                             true);  // detect shadows
bg->apply(frame, fgMask);
```

MOG2 models each pixel as a mixture of Gaussians, so it copes with things frame differencing
cannot: a swaying branch, a flickering display, a gradual change in daylight. It gives you
whole objects rather than edges, and it labels shadows as grey (127) rather than foreground,
so `threshold(fgMask, fgMask, 200, 255, THRESH_BINARY)` removes them.

Three parameters that matter in the field:

- **history** — how fast the background adapts. Too short and an object that pauses melts
  into the background; too long and it never forgets the box someone moved an hour ago.
- **learningRate** in `apply(frame, mask, rate)` — pass `0` to freeze the model (useful while
  something is legitimately parked in view) or a large value to re-learn quickly after a
  lighting change.
- **shadow detection** costs about 15% and is almost always worth it outdoors.

KNN (`createBackgroundSubtractorKNN`) is the alternative; it handles low frame rates better
and costs a little more. Try both on your footage — twenty minutes of comparison beats an
argument.

Neither one survives a camera that moves. If the camera is on a mast in the wind, stabilise
first or use flow instead.

## Sparse optical flow: track points

Lucas–Kanade tracks specific points from one frame to the next.

```cpp
std::vector<cv::Point2f> p0, p1;
cv::goodFeaturesToTrack(prevGray, p0, 200, 0.01, 10);   // corners are trackable

std::vector<uchar> status; std::vector<float> err;
cv::calcOpticalFlowPyrLK(prevGray, gray, p0, p1, status, err,
                         cv::Size(21,21), 3);

for (size_t i = 0; i < p1.size(); ++i)
    if (status[i]) cv::line(vis, p0[i], p1[i], {0,255,0}, 2);
```

Fast — a few hundred points in a millisecond or two — and accurate to a fraction of a pixel.
Two things to internalise:

**It only tracks corners.** A point in the middle of a blank wall has no unique local
appearance, so the algorithm cannot say where it went. This is the aperture problem, and it
is why `goodFeaturesToTrack` exists.

**The pyramid level is the speed limit.** Level 3 with a 21×21 window handles motion of a few
tens of pixels between frames. Faster motion than that and the points are simply lost. Raise
the level count for fast motion, or capture at a higher frame rate.

Always filter by `status`, and re-detect features periodically — you lose 5–10% per frame to
occlusion and drift, so a tracker that never re-seeds runs out of points in a couple of
seconds.

## Dense optical flow: a vector per pixel

```cpp
cv::calcOpticalFlowFarneback(prevGray, gray, flow,
                             0.5, 3, 15, 3, 5, 1.2, 0);
// flow is CV_32FC2: flow.at<Point2f>(y,x) is that pixel's displacement

cv::Mat mag, ang, parts[2];
cv::split(flow, parts);
cv::cartToPolar(parts[0], parts[1], mag, ang);
```

Every pixel gets a motion vector, which is what you want for crowd flow, fluid motion, or
segmenting a scene by how things move. It costs 30–80 ms at VGA on a laptop CPU, so it is not
a frame-loop tool on embedded hardware. `cv::DISOpticalFlow` is several times faster with
comparable quality and is the better default now.

## The built-in trackers

```cpp
cv::Ptr<cv::Tracker> tracker = cv::TrackerCSRT::create();
tracker->init(frame, cv::Rect(x, y, w, h));

while (cap.read(frame)) {
    cv::Rect box;
    if (tracker->update(frame, box))
        cv::rectangle(frame, box, {0,255,0}, 2);
    else
        redetect();                 // ALWAYS have this branch
}
```

| Tracker | Speed (720p, laptop) | Handles scale | Notes |
|---|---|---|---|
| `TrackerMIL` | ~25 FPS | no | robust, slow, no failure report |
| `TrackerKCF` | ~170 FPS | no | the pragmatic default |
| `TrackerCSRT` | ~25 FPS | yes | most accurate, handles non-rectangular objects |
| `TrackerNano` | ~60 FPS | yes | small NN, needs the model files |

KCF for speed, CSRT for accuracy, and that is most of the decision. All of them drift and
all of them eventually fail; the `update` return value is your signal to re-run the detector.
A tracker without a re-detection path will happily follow a patch of wallpaper for ten
minutes.

Note that OpenCV's trackers are single-object. Multi-object tracking means one tracker per
object plus an association step — which is the next section.

## Kalman: predicting through an occlusion

A tracker that loses its target for four frames should not lose its *identity*. A constant-
velocity Kalman filter gives you a position estimate while there is no measurement at all.

```cpp
cv::KalmanFilter kf(4, 2, 0);          // state: x, y, vx, vy | measured: x, y
kf.transitionMatrix = (cv::Mat_<float>(4,4) <<
    1,0,1,0,
    0,1,0,1,
    0,0,1,0,
    0,0,0,1);
cv::setIdentity(kf.measurementMatrix);
cv::setIdentity(kf.processNoiseCov,     cv::Scalar::all(1e-2));
cv::setIdentity(kf.measurementNoiseCov, cv::Scalar::all(1e-1));

// every frame:
cv::Mat pred = kf.predict();
if (haveDetection) {
    cv::Mat meas = (cv::Mat_<float>(2,1) << det.x, det.y);
    kf.correct(meas);                  // measurement pulls the estimate back
}
// use pred (or kf.statePost) as the position either way
```

The two noise covariances are the only real tuning. `processNoiseCov` is how much you believe
the object can change velocity; `measurementNoiseCov` is how much you distrust your detector.
Raise the first for erratic objects, raise the second for a jittery detector and the output
smooths out.

## Putting it together: detect, track, associate

The standard multi-object loop, which is the skeleton of SORT and everything descended from
it:

```cpp
for (auto& t : tracks) t.predict();                        // 1. where should each be?

if (frameNo % 10 == 0) {
    auto dets = detector.run(frame);                       // 2. expensive, occasionally

    // 3. associate: match detections to tracks by IoU, greedily or with Hungarian
    for (auto& d : dets) {
        Track* best = nullptr; double bestIoU = 0.3;
        for (auto& t : tracks) {
            double i = iou(d.box, t.predictedBox());
            if (i > bestIoU) { bestIoU = i; best = &t; }
        }
        if (best) best->correct(d);                        // matched
        else      tracks.push_back(Track(d, nextId++));    // new object
    }
}

// 4. retire tracks that have gone unmatched too long
std::erase_if(tracks, [](const Track& t){ return t.missed > 30; });
```

Four steps: predict, detect, associate, retire. Everything else in multi-object tracking is a
refinement of the association step — better distance metrics, appearance embeddings, a proper
Hungarian assignment instead of a greedy one.

`missed > 30` at 30 FPS means an object keeps its ID through a one-second occlusion. That
number is a product decision, not a technical one: too small and people get a new ID every
time they walk behind a pillar; too large and two different people inherit the same ID.

## Check yourself

1. Why does frame differencing miss a stationary object, and MOG2 (for a while) not?
2. What is the aperture problem, and how does `goodFeaturesToTrack` sidestep it?
3. When would you pick KCF over CSRT?
4. What does raising `measurementNoiseCov` do to the output?

## Next

The final lesson is the one that decides whether any of this ships: measuring where your
frame time actually goes, capture and colour-conversion costs people forget, threading the
pipeline properly, and the resolution and hardware decisions that hold a frame rate on a
real board.
