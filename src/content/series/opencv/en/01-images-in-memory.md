---
lesson: 1
lang: en
title: "An Image Is Just Memory"
description: "What a cv::Mat really is, why step matters more than width, the difference between a copy and a view, and the one-line change that took a filter from 148 ms to 6 ms."
duration: "14 min"
tags: ["OpenCV", "Mat", "Performance"]
---

## Why start here

Most OpenCV tutorials start with `imread` and a blur. That works until the day your pipeline
has to run at 30 FPS on a board that costs eight dollars, and then every one of those
convenient one-liners becomes a number in a budget you do not have.

Almost every slow OpenCV program I have been asked to look at was slow for the same reason:
the author did not know what `Mat` was doing with memory. So we start with memory.

## Mat is a header plus a pointer

```cpp
cv::Mat img = cv::imread("frame.png", cv::IMREAD_COLOR);
```

`img` is a small struct — a few dozen bytes on the stack — holding `rows`, `cols`, `step`,
a `flags` word encoding the type, and `data`, a pointer to the pixels somewhere on the heap.
The pixels themselves are not in the `Mat`. That single fact explains most of the surprising
behaviour people hit.

```cpp
cv::Mat a = cv::imread("frame.png");
cv::Mat b = a;              // copies the HEADER. Both point at the same pixels.
b.at<cv::Vec3b>(0,0) = {0,0,0};
// a.at<Vec3b>(0,0) is now black too.

cv::Mat c = a.clone();      // copies the PIXELS. Independent.
```

`Mat` is reference counted, so the pixel buffer lives until the last header referring to it
goes away. Assignment is O(1) and free; `clone()` is O(width × height × channels) and is a
memcpy of, for a 1080p colour frame, about 6 MB.

![How a Mat is laid out in memory](/MyPortfolio/images/opencv/mat-memory.svg)

## Row-major, interleaved, and padded

Three properties of the layout, in the order they will bite you:

**Row-major.** Pixel `(y, x)` sits at `data + y*step + x*elemSize()`. Rows are contiguous;
columns are not. Iterating down a column touches a new cache line on every single access.

**Interleaved.** A three-channel image is not three planes. It is `B G R B G R B G R…`.
When you ask for "the blue channel", OpenCV has to gather every third byte —
`cv::split()` is not free, it is a full pass over the image.

**Padded.** `step` is the number of bytes from the start of one row to the start of the
next, and it is *not* always `cols * elemSize()`. Allocators pad rows for alignment, and any
ROI you take has the step of its parent. Code that assumes `step == cols*3` works on your
laptop and produces diagonal streaks on the target.

```cpp
cv::Mat m(480, 641, CV_8UC3);
std::cout << m.cols * m.elemSize() << "\n";   // 1923
std::cout << m.step << "\n";                  // 1924 or 1932, allocator's choice
std::cout << m.isContinuous() << "\n";        // may be false
```

Check `isContinuous()` before you treat the buffer as one flat array. If it is true, you may
walk `m.data` from `0` to `total()*elemSize()` in a single loop, which is measurably faster
than a nested one.

## Four ways to touch a pixel, ranked

Here is the same operation — a gamma-style brightness curve on a 1920×1080 BGR frame —
written four ways. Numbers are from a Raspberry Pi 4, single core, OpenCV 4.9, `-O2`.

```cpp
// 1) at<>() — bounds-checked in debug, one multiply per access. 148 ms
for (int y = 0; y < img.rows; ++y)
  for (int x = 0; x < img.cols; ++x)
    for (int c = 0; c < 3; ++c)
      img.at<cv::Vec3b>(y,x)[c] = lut[img.at<cv::Vec3b>(y,x)[c]];
```

```cpp
// 2) ptr<>() per row — one pointer computation per row. 39 ms
for (int y = 0; y < img.rows; ++y) {
  uchar* p = img.ptr<uchar>(y);
  for (int i = 0; i < img.cols * 3; ++i)
    p[i] = lut[p[i]];
}
```

```cpp
// 3) flat loop when continuous — 31 ms
if (img.isContinuous()) {
  uchar* p = img.data;
  const size_t n = img.total() * img.channels();
  for (size_t i = 0; i < n; ++i) p[i] = lut[p[i]];
}
```

```cpp
// 4) let the library do it — cv::LUT is SIMD and multi-threaded. 6 ms
cv::Mat table(1, 256, CV_8U, lut);
cv::LUT(img, table, img);
```

Twenty-five times, from the same algorithm. Nothing about the maths changed — only how many
times per pixel the CPU had to compute an address, and whether it could use NEON.

**The rule that follows:** if there is an OpenCV function that does what your loop does,
use it. The library's implementations are vectorised, often parallelised, and were tuned by
people with a profiler. Write your own loop only when no function fits, and then write it
with `ptr<>()`.

## ROI: the free crop

```cpp
cv::Mat roi = img(cv::Rect(100, 50, 320, 240));
```

This allocates nothing. `roi` is a new header pointing into the middle of `img`'s buffer,
with `roi.step == img.step`. Writing through `roi` writes into `img`. It is the cheapest
optimisation in computer vision: if you only care about a region, only process the region.

```cpp
// process a 320x240 band instead of a 1920x1080 frame: 24x less work
cv::Mat band = frame(cv::Rect(0, 420, 1920, 240));
cv::cvtColor(band, gray, cv::COLOR_BGR2GRAY);
```

Two things to remember. First, `roi.clone()` when you need it to outlive the parent or to be
continuous. Second, a function that reallocates its output (most of them do, if the size or
type does not match) will quietly detach the ROI instead of writing into the parent — so
pass a correctly sized, correctly typed output `Mat` when you mean to write in place.

## Types, and the error message you will see most

`CV_8UC3` reads as: 8 bits, Unsigned, 3 Channels. The family:

| Type | Bytes/px/ch | Range | Typical use |
|---|---|---|---|
| `CV_8U` | 1 | 0…255 | camera frames, masks |
| `CV_8S` | 1 | −128…127 | rare |
| `CV_16U` | 2 | 0…65535 | depth maps, raw sensors |
| `CV_32F` | 4 | float | intermediate maths, optical flow |
| `CV_64F` | 8 | double | calibration matrices |

`(-215:Assertion failed) src.type() == dst.type()` means you handed a function two images
of different types. The usual cause is arithmetic: `a - b` on two `CV_8U` images saturates at
zero, so people convert to `CV_32F`, do the maths, and forget to convert back before the next
call. `img.convertTo(out, CV_32F, 1.0/255.0)` converts and scales in one pass.

Also: **`CV_8U` arithmetic saturates, it does not wrap.** `200 + 100` is `255`, not `44`.
This is usually what you want, and it is the opposite of what plain C does.

## Preallocate in a loop

Every `cv::Mat` returned by value from a function inside your frame loop is a potential
allocation. OpenCV's functions reuse the output buffer if it is already the right size and
type, so hoist them:

```cpp
cv::Mat gray, blurred, edges;         // OUTSIDE the loop

while (cap.read(frame)) {
    cv::cvtColor(frame, gray, cv::COLOR_BGR2GRAY);   // reuses gray after frame 1
    cv::GaussianBlur(gray, blurred, {5,5}, 1.5);
    cv::Canny(blurred, edges, 60, 180);
}
```

Declared inside the loop, the same code allocates and frees roughly 3 MB per frame. At 30 FPS
that is 90 MB/s of malloc traffic that does nothing. On a desktop you will not notice; on a
board with a small heap you will get fragmentation and, eventually, a stall.

## A habit worth forming

Print the shape of everything the first time you write a pipeline:

```cpp
std::cout << "gray: " << gray.size() << " type=" << gray.type()
          << " step=" << gray.step << " cont=" << gray.isContinuous() << "\n";
```

Half of all OpenCV bugs are a size or type mismatch two stages upstream of where the
exception is thrown. Thirty seconds of printing beats an hour of guessing.

## Check yourself

1. What does `cv::Mat b = a;` copy, and what does it not?
2. Why can `step` be larger than `cols * elemSize()`, and when does that matter?
3. Why is `at<Vec3b>()` in a nested loop so much slower than `ptr<uchar>()`?
4. What does taking an ROI allocate?

## Next

Now that pixels are just memory, the preprocessing chain stops being a magic incantation.
Next lesson: colour conversion, the four blurs and when each is right, thresholding
including Otsu and adaptive, and morphology — with a clear answer for what each step is
actually *for*.
