---
lesson: 2
lang: en
title: "The Preprocessing Chain"
description: "Colour conversion, the four blurs and when each is correct, Otsu versus adaptive thresholding, and the morphology operations that clean a mask up — with a reason for every step."
duration: "16 min"
tags: ["OpenCV", "Filtering", "Thresholding"]
---

## Preprocessing is data reduction

A 1080p colour frame is 6.2 MB of numbers. The question your program actually wants answered
is usually one line long: *is there a part on the belt, and where?* Preprocessing is the
funnel between those two — every stage throws away information that does not help, so the
stage after it has less to look at.

That framing gives you a test for each step: **what did this discard, and did I need it?**
If you cannot answer, the step does not belong in your pipeline.

![The preprocessing chain, stage by stage](/MyPortfolio/images/opencv/preprocessing-chain.svg)

## Grayscale, and when colour is the signal

```cpp
cv::cvtColor(bgr, gray, cv::COLOR_BGR2GRAY);
```

This discards two thirds of the data and is usually right, because shape and edges survive
in luminance. The weights are not equal — `0.299R + 0.587G + 0.114B`, matching human
sensitivity — so a bright red object and a mid grey can converge to the same value.

If colour *is* the signal, do not use BGR for it. Use HSV:

```cpp
cv::cvtColor(bgr, hsv, cv::COLOR_BGR2HSV);
cv::inRange(hsv, cv::Scalar(35, 80, 60), cv::Scalar(85, 255, 255), mask);  // green
```

The reason is separation: in BGR, "green" is a diagonal region in a 3-D cube that moves
whenever the lighting changes. In HSV, hue is roughly independent of brightness, so a
threshold on H survives a passing cloud. OpenCV's H range is **0…179**, not 0…360 — it has to
fit in a byte. Red wraps around the end, so red needs two `inRange` calls ORed together.

For anything involving perceptual colour distance, `COLOR_BGR2Lab` is better still: Euclidean
distance in Lab approximates how different two colours *look*.

## The four blurs

Blur is not one operation. Picking the wrong one is the most common reason a pipeline is
either slow or subtly broken.

```cpp
cv::blur(src, dst, {5,5});                        // box: mean of the window
cv::GaussianBlur(src, dst, {5,5}, 1.5);           // weighted by distance
cv::medianBlur(src, dst, 5);                      // the median value in the window
cv::bilateralFilter(src, dst, 9, 75, 75);         // blur, but keep edges
```

| Filter | Cost | Kills | Keeps | Use when |
|---|---|---|---|---|
| Box | lowest | general noise | nothing | you truly only need speed |
| Gaussian | low | sensor noise | edges softly | default before edges/threshold |
| Median | medium | salt-and-pepper, single hot pixels | edges sharply | dead pixels, binary masks |
| Bilateral | very high | noise inside flat regions | edges exactly | photography, not real-time |

Two practical notes. Gaussian kernel size must be odd; passing `0` for the size and giving
only sigma lets OpenCV pick a matching size, which is usually what you want. And bilateral
filtering on a Pi at 1080p costs on the order of 400 ms per frame — it is a beautiful filter
and it does not belong in a frame loop.

Blur before thresholding or edge detection, always. Both amplify high-frequency content, and
noise is high-frequency content.

## Thresholding: three levels of adaptivity

**Fixed** works when you own the lighting — an enclosed inspection rig, a backlight.

```cpp
cv::threshold(gray, bin, 127, 255, cv::THRESH_BINARY);
```

**Otsu** picks the value for you, by finding the threshold that minimises variance within
the two resulting groups. It assumes the histogram is bimodal — a bright thing on a dark
background, or vice versa. When that holds it is excellent and free.

```cpp
double t = cv::threshold(gray, bin, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
// the chosen value comes back; log it — a jumping t means your lighting is drifting
```

**Adaptive** computes a threshold per neighbourhood, which is what you need under uneven
illumination — a document lit from one side, a belt with a shadow across it.

```cpp
cv::adaptiveThreshold(gray, bin, 255,
                      cv::ADAPTIVE_THRESH_GAUSSIAN_C,
                      cv::THRESH_BINARY,
                      31,    // block size: ODD, and larger than the features you keep
                      5);    // constant subtracted from the local mean
```

The block size is the parameter people get wrong. It must be comfortably larger than the
strokes or parts you want to keep, or the algorithm sees the *inside* of your object as its
own local background and hollows it out. Start at about three times your feature width and
tune from there.

If the lighting gradient is smooth, there is a cheaper fix than adaptive thresholding:
estimate the background with a very large blur and subtract it.

```cpp
cv::Mat bg;
cv::GaussianBlur(gray, bg, {0,0}, 51);      // background illumination only
cv::Mat flat = gray - bg + 128;              // flattened, then a fixed threshold works
```

## Morphology: cleaning up a binary mask

A threshold output is never clean. Morphology fixes the two failure modes.

```cpp
cv::Mat k = cv::getStructuringElement(cv::MORPH_ELLIPSE, {5,5});

cv::morphologyEx(bin, bin, cv::MORPH_OPEN,  k);   // erode then dilate: removes specks
cv::morphologyEx(bin, bin, cv::MORPH_CLOSE, k);   // dilate then erode: fills holes
```

- **Open** deletes anything smaller than the kernel. This is your speckle remover.
- **Close** fills gaps smaller than the kernel. This is your "my object came out with a hole
  in it" fix.
- Plain **erode** shrinks white regions, **dilate** grows them. Use dilate to reconnect a
  contour broken by a highlight.

The kernel *shape* matters more than people expect. `MORPH_RECT` biases everything towards
squares; `MORPH_ELLIPSE` is the honest default for real objects. For text or wires, an
anisotropic kernel — say `{15,1}` — will join characters along a line without merging
separate lines together.

Open then close, in that order, is the standard cleanup pair: kill the noise first so that
closing does not weld it to your object.

## Edges: Canny, with the thresholds explained

```cpp
cv::Canny(blurred, edges, 60, 180);
```

Canny runs a gradient, thins the response to single-pixel ridges, then applies *hysteresis*:
pixels above the high threshold are edges; pixels between low and high are edges only if
they connect to one. That is why there are two numbers and why the ratio matters more than
the absolute values — 1:2 to 1:3 is the usual advice.

For a starting point that adapts to the image rather than to your test photo:

```cpp
cv::Scalar m = cv::mean(gray);
double hi = 1.33 * m[0], lo = 0.66 * m[0];
cv::Canny(blurred, edges, lo, hi);
```

If the edges look like static, you did not blur enough. If your object's outline is broken
into dashes, lower the *low* threshold, or dilate the result by one pixel.

## Put the chain together

```cpp
cv::Mat gray, blur, bin, k = cv::getStructuringElement(cv::MORPH_ELLIPSE, {5,5});

cv::cvtColor(frame, gray, cv::COLOR_BGR2GRAY);          // 3 ch -> 1 ch
cv::GaussianBlur(gray, blur, {5,5}, 1.5);               // remove sensor noise
cv::threshold(blur, bin, 0, 255,
              cv::THRESH_BINARY | cv::THRESH_OTSU);     // 256 levels -> 2
cv::morphologyEx(bin, bin, cv::MORPH_OPEN,  k);         // drop specks
cv::morphologyEx(bin, bin, cv::MORPH_CLOSE, k);         // fill holes
```

Five stages, 6.2 MB down to a clean 2 MB single-bit-per-pixel mask, about 4 ms at 1080p on a
laptop. Every stage has a stated purpose. If you cannot state one for a line in your own
pipeline, delete it and see whether anything breaks — surprisingly often, nothing does.

## Debug by looking, not by guessing

```cpp
cv::imshow("1 gray", gray);
cv::imshow("2 blur", blur);
cv::imshow("3 bin",  bin);
cv::imshow("4 clean", cleaned);
cv::waitKey(0);
```

Four windows, and the stage where the information disappears is immediately obvious. When
there is no display — on a headless board — write them out instead:

```cpp
cv::imwrite("/tmp/stage3_bin.png", bin);
```

Nearly every "the detector doesn't work" report I have chased turned out to be visible in
stage 2 or 3 as soon as someone actually looked at it.

## Check yourself

1. Why is HSV better than BGR for colour thresholding, and what is OpenCV's hue range?
2. When would you choose median over Gaussian?
3. What breaks if the adaptive threshold block size is smaller than your object?
4. Why open before close, and not the other way round?

## Next

You now have a clean binary mask. Lesson 3 turns it into decisions: contours and the shape
descriptors that classify them, template matching, and the classical detectors — Haar, HOG,
ArUco — that still beat a neural network when your budget is a single ARM core.
