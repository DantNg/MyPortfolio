---
lesson: 4
lang: en
title: "Calibration and Measuring in Millimetres"
description: "The pinhole model, what the intrinsic matrix and distortion coefficients actually mean, how to run a chessboard calibration that is not garbage, homography for a top-down view, and solvePnP for pose."
duration: "17 min"
tags: ["OpenCV", "Calibration", "Geometry"]
---

## Pixels are not a unit of length

"The part is 84 pixels wide" is not a measurement. It depends on distance, on lens focal
length, on where in the frame the part sits, and on lens distortion. To turn pixels into
millimetres you need a model of the camera, and to get the model you need calibration.

This lesson is the one people skip, and it is the reason so many vision measurements are
quietly wrong by three percent.

![The pinhole model and calibration](/MyPortfolio/images/opencv/pinhole-calibration.svg)

## The pinhole model in one equation

A 3-D point in camera coordinates projects to the image as:

```
s · [u v 1]ᵀ  =  K · [R | t] · [X Y Z 1]ᵀ
```

`[R|t]` is the **extrinsic** part — where the camera is relative to the world. `K` is the
**intrinsic** matrix, the camera's own properties:

```
      ⎡ fx   0   cx ⎤
K  =  ⎢  0  fy   cy ⎥
      ⎣  0   0    1 ⎦
```

- `fx`, `fy` — focal length **in pixels**. Not millimetres. `fx = F_mm · width_px / sensor_mm`.
  On a modern square-pixel sensor `fx ≈ fy`; a difference of more than a percent or two means
  your calibration is off or the image was resized non-uniformly.
- `cx`, `cy` — the principal point, where the optical axis hits the sensor. Close to the image
  centre but rarely exactly at it.

**Everything scales with resolution.** Calibrate at 1920×1080 and run at 640×360 and every
one of those four numbers must be multiplied by 1/3. Store the calibration resolution
alongside the matrix; this is the single most common calibration bug.

## Distortion

Real lenses bend straight lines. OpenCV models it with five coefficients,
`(k1, k2, p1, p2, k3)`: three radial terms — the barrel or pincushion you can see on a
wide-angle lens — and two tangential terms for a sensor not perfectly parallel to the lens.

```cpp
cv::undistort(src, dst, K, dist);
```

For a video stream, do not call `undistort` per frame. Compute the maps once:

```cpp
cv::Mat map1, map2;
cv::initUndistortRectifyMap(K, dist, cv::Mat(), K, size, CV_16SC2, map1, map2);
// per frame:
cv::remap(frame, undistorted, map1, map2, cv::INTER_LINEAR);
```

Roughly four times faster, because the expensive part is computing where each output pixel
comes from, and that never changes.

Better still, for many jobs: do not undistort the image at all. Undistort only the handful of
*points* you measured, with `cv::undistortPoints()`. Warping six megapixels to correct four
corner coordinates is wasted work.

## Running a calibration that is actually good

```cpp
cv::Size boardSize(9, 6);          // INNER corners, not squares
const float square_mm = 25.0f;

std::vector<cv::Point3f> objp;
for (int i = 0; i < boardSize.height; ++i)
  for (int j = 0; j < boardSize.width; ++j)
    objp.emplace_back(j * square_mm, i * square_mm, 0.f);

std::vector<std::vector<cv::Point3f>> objectPoints;
std::vector<std::vector<cv::Point2f>> imagePoints;

for (const auto& img : calibrationImages) {
    std::vector<cv::Point2f> corners;
    bool found = cv::findChessboardCorners(img, boardSize, corners,
                    cv::CALIB_CB_ADAPTIVE_THRESH | cv::CALIB_CB_NORMALIZE_IMAGE);
    if (!found) continue;

    cv::cornerSubPix(gray, corners, {11,11}, {-1,-1},
        {cv::TermCriteria::EPS + cv::TermCriteria::MAX_ITER, 30, 0.001});

    imagePoints.push_back(corners);
    objectPoints.push_back(objp);
}

cv::Mat K, dist;
std::vector<cv::Mat> rvecs, tvecs;
double rms = cv::calibrateCamera(objectPoints, imagePoints, imageSize,
                                 K, dist, rvecs, tvecs);
```

The `cornerSubPix` call is not optional. Integer corners give you a calibration that looks
plausible and measures badly.

**What separates a good calibration from a useless one is the image set, not the code:**

- **20 to 30 views**, not five. Below about fifteen the parameters are under-constrained.
- **Fill the frame across the set.** Corners and edges especially — that is where distortion
  lives, and a set shot only in the middle cannot see `k1` at all.
- **Tilt the board.** Views at 30–45° in several directions are what separate `fx` from `Z`.
  A set of front-parallel views is nearly degenerate and will produce a confidently wrong
  focal length.
- **Print it flat and check.** A chessboard taped to a slightly bowed sheet of card puts a
  systematic error into everything downstream. Glass or aluminium composite, or accept the
  error.
- **Fill the frame with the board**, not a small board far away.

Judge the result by `rms` reprojection error, in pixels. **Under 0.5 is good, under 1.0 is
usable, above 1.5 means something is wrong** — usually a mis-detected board or a bent target.
Also check per-view error and throw out the worst offenders, then recalibrate.

For fisheye lenses — anything past about 120° — use `cv::fisheye::calibrate` instead. The
standard model cannot represent that much distortion and will fit nonsense.

## Millimetres per pixel, honestly

With a calibrated camera looking perpendicularly at a plane a known distance `Z` away:

```
mm_per_px = Z_mm / fx
```

So a part spanning 84 px at `Z = 500 mm` with `fx = 1400` measures
`84 × 500 / 1400 = 30.0 mm`.

Every word in that sentence is load-bearing. **Perpendicular**: tilt the camera 5° and you
introduce a scale gradient across the frame. **Known distance**: a monocular camera cannot
measure `Z`; you must fix it mechanically, or measure it, or put a known-size reference in the
scene. **Undistorted**: at the edge of a wide lens, uncorrected distortion is several percent.

If you need to measure at multiple depths, you need a second camera, a depth sensor, or a
known object in the plane you are measuring.

## Homography: the top-down view

When everything of interest lies on one plane, a homography maps the image to that plane —
correcting perspective completely.

```cpp
std::vector<cv::Point2f> src = {  /* four corners in the image */ };
std::vector<cv::Point2f> dst = { {0,0}, {400,0}, {400,300}, {0,300} };  // mm × 1 px/mm

cv::Mat H = cv::getPerspectiveTransform(src, dst);
cv::warpPerspective(frame, topDown, H, cv::Size(400, 300));
```

Now one pixel is exactly one millimetre, everywhere in the output, and you can measure with a
ruler. This is how document scanners, sports-field overlays and belt-inspection rigs work.

With more than four correspondences, use `cv::findHomography(src, dst, cv::RANSAC, 3.0)` —
RANSAC discards the mismatched pairs instead of averaging them into a wrong answer.

And again: apply `H` to *points* when that is all you need. `cv::perspectiveTransform` on a
vector of four points costs nothing; warping the whole frame costs milliseconds.

## Pose with solvePnP

Given a calibrated camera and four or more points whose 3-D positions you know, you get the
full 6-DoF pose of the object:

```cpp
cv::Mat rvec, tvec;
cv::solvePnP(objectPoints3d, imagePoints2d, K, dist, rvec, tvec);

cv::Mat R;  cv::Rodrigues(rvec, R);        // rotation vector -> 3x3 matrix
double distance_mm = cv::norm(tvec);
```

`tvec` is the object's position in camera coordinates, in whatever unit you used for
`objectPoints3d` — use millimetres and you get millimetres out. `rvec` is a Rodrigues
rotation vector; `cv::Rodrigues` converts it to a matrix.

Combined with ArUco from lesson 3 this is a complete pose pipeline in about fifteen lines,
and it is what most marker-based AR and robot-registration systems actually are. Use
`cv::SOLVEPNP_IPPE_SQUARE` for planar square markers — it is faster and better conditioned
than the iterative default.

## Save the calibration

```cpp
cv::FileStorage fs("calib.yml", cv::FileStorage::WRITE);
fs << "image_width" << imageSize.width << "image_height" << imageSize.height;
fs << "K" << K << "dist" << dist << "rms" << rms
   << "date" << currentDateString();
```

Store the resolution and the date with it. Calibration is a property of a specific camera and
lens assembly: it survives a reboot, and it does not survive someone refocusing the lens,
knocking the camera, or swapping in a "identical" module from the next batch. Recalibrate
after any mechanical work, and keep the RMS in your logs so you notice drift.

## Check yourself

1. Why must you rescale `K` when you change capture resolution?
2. What is wrong with a calibration set shot entirely front-parallel?
3. When is `undistortPoints` better than `undistort`?
4. What do you need, beyond `fx`, to convert a pixel width into millimetres?

## Next

Static geometry done. Lesson 5 adds time: background subtraction, frame differencing,
optical flow both sparse and dense, the built-in trackers, and a Kalman filter that keeps an
ID alive through an occlusion.
