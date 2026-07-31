---
lesson: 6
lang: en
title: "Holding a Frame Rate on Real Hardware"
description: "Measuring where the milliseconds go, the capture and conversion costs nobody counts, threading a pipeline so capture and processing overlap, and the build flags that double your speed for free."
duration: "17 min"
tags: ["OpenCV", "Performance", "Embedded"]
---

## Start with a budget, not an optimisation

30 FPS means **33.3 ms per frame, for everything**: capture, colour conversion, your
algorithm, drawing, encoding, and whatever the OS does while you are not looking. Write the
budget down before you write the code.

```
capture + decode      6 ms
resize to 640x360     1 ms
preprocessing         4 ms
detection            12 ms
tracking + logic      2 ms
draw + display        3 ms
                     -----
                     28 ms   -> 5 ms of headroom. That is a healthy design.
```

A pipeline with no headroom does not run at 30 FPS; it runs at 30 FPS until something else
on the board wakes up.

## Measure before you guess

```cpp
struct Stage {
    const char* name; double total = 0; int n = 0;
    void add(double ms) { total += ms; ++n; }
    double avg() const { return n ? total / n : 0; }
};

int64 t0 = cv::getTickCount();
cv::cvtColor(frame, gray, cv::COLOR_BGR2GRAY);
double ms = (cv::getTickCount() - t0) * 1000.0 / cv::getTickFrequency();
stages[CVT].add(ms);
```

Print the table every hundred frames. It takes fifteen minutes to add and it has never once
told me what I expected. The stage people are most often wrong about is capture.

Two measurement traps worth avoiding:

**Report percentiles, not just the mean.** A pipeline with a 20 ms mean and a 60 ms 99th
percentile drops frames, and the mean will never tell you. Keep max and p99.

**Warm up first.** The first few frames pay for lazy allocation, OpenCL context creation and
cold caches. Discard the first thirty.

## The costs nobody counts

**Capture.** `cap.read()` blocks until the camera delivers a frame. On a 30 FPS camera it
returns every 33 ms whatever you do, so if your processing takes 20 ms, the naive loop takes
53 ms per frame and runs at 19 FPS — while both the camera and the CPU sit idle half the
time. This is the single most common reason for an unexplained low frame rate.

**MJPEG decode.** Most USB cameras deliver MJPEG, and every frame is a JPEG decode: about
8 ms at 1080p on an ARM core, before your code runs at all. Ask for a lower resolution
rather than capturing 1080p and resizing.

```cpp
cap.set(cv::CAP_PROP_FRAME_WIDTH,  640);
cap.set(cv::CAP_PROP_FRAME_HEIGHT, 360);
cap.set(cv::CAP_PROP_FOURCC, cv::VideoWriter::fourcc('M','J','P','G'));
cap.set(cv::CAP_PROP_BUFFERSIZE, 1);       // do not hand me stale frames
cap.set(cv::CAP_PROP_FPS, 30);

// then VERIFY — cameras silently ignore what they cannot do
std::cout << cap.get(cv::CAP_PROP_FRAME_WIDTH) << "x"
          << cap.get(cv::CAP_PROP_FRAME_HEIGHT) << " @"
          << cap.get(cv::CAP_PROP_FPS) << "\n";
```

`CAP_PROP_BUFFERSIZE` deserves the emphasis. With the default queue, a slow consumer
processes frames that are several hundred milliseconds old — the output looks like it is
lagging reality because it is.

**Display.** `cv::imshow` plus `cv::waitKey(1)` costs 3–8 ms and, over a remote X connection,
far more. Ship without a display, or draw every fifth frame.

## Resolution is the biggest lever you have

Cost scales with pixel count, so halving each dimension quarters most of the work:

| Resolution | Pixels | Relative cost |
|---|---|---|
| 1920×1080 | 2.07 M | 1.00 |
| 1280×720 | 0.92 M | 0.44 |
| 640×360 | 0.23 M | 0.11 |
| 320×180 | 0.06 M | 0.03 |

Nine times cheaper from 1080p to 360p. The question is never "is smaller worse" — it is
"what is the smallest size at which the thing I need to see is still there". Find your
object's minimum pixel size empirically and work at that scale.

The best version of this idea is a two-stage pipeline: **find at low resolution, measure at
full resolution.**

```cpp
cv::resize(frame, small, {}, 0.25, 0.25, cv::INTER_AREA);
auto candidates = findRegions(small);                 // 16x cheaper

for (auto r : candidates) {
    cv::Rect full(r.x*4, r.y*4, r.width*4, r.height*4);
    measurePrecisely(frame(full));                    // only the interesting parts
}
```

Use `INTER_AREA` for downscaling — it averages, so it does not alias. `INTER_LINEAR`
downsampling throws away information in a way that makes small features flicker in and out
between frames.

## Thread the pipeline

Capture blocks; processing does not have to wait for it. Put capture in its own thread with a
one-frame handoff and both run concurrently:

```cpp
std::mutex m; cv::Mat shared; std::atomic<bool> running{true}; bool fresh = false;

std::thread grabber([&]{
    cv::Mat f;
    while (running) {
        cap.read(f);                              // blocks here, not in main
        std::lock_guard<std::mutex> lk(m);
        f.copyTo(shared);
        fresh = true;                             // deliberately drop old frames
    }
});

while (running) {
    cv::Mat work;
    { std::lock_guard<std::mutex> lk(m); if (!fresh) continue; shared.copyTo(work); fresh = false; }
    process(work);
}
```

The 20 ms-of-work example above goes from 19 FPS to the full 30. Note the design decision
in `fresh = true`: this drops frames rather than queueing them. For a live system that is
correct — a frame you cannot process in time is worth less than the next one. For recorded
analysis it is wrong; use a bounded queue there.

![A threaded capture and processing pipeline](/MyPortfolio/images/opencv/pipeline-threading.svg)

## Let OpenCV use the hardware

**Check what you actually have.** The `opencv-python` wheel and most distro packages are
built for portability, not for your CPU:

```cpp
std::cout << cv::getBuildInformation();        // NEON? OpenCL? TBB? IPP?
std::cout << cv::getNumThreads() << " threads\n";
```

A build with NEON and a parallel backend is commonly **two to four times faster** on the same
board than the default package, for zero code change. On a Pi or Jetson, building OpenCV from
source with `-DENABLE_NEON=ON -DWITH_TBB=ON -DCMAKE_BUILD_TYPE=Release` is an afternoon that
buys more than a week of hand-optimisation.

**Threads.** `cv::setNumThreads(n)` controls OpenCV's internal parallelism. On a 4-core board
where you already run your own threads, letting OpenCV spawn four more oversubscribes the
CPU and makes everything slower. Set it deliberately — often `setNumThreads(2)` alongside a
capture thread beats the default.

**UMat / OpenCL** moves work to an integrated GPU with almost no code change:

```cpp
cv::UMat gpuFrame, gpuGray;
frame.copyTo(gpuFrame);
cv::cvtColor(gpuFrame, gpuGray, cv::COLOR_BGR2GRAY);
```

Worth trying, worth measuring, and not free: every `Mat`↔`UMat` transition is a copy. One
conversion on the GPU surrounded by CPU stages is slower than doing it all on the CPU. Keep
the whole chain in `UMat` or none of it.

## Algorithmic wins beat micro-optimisation

In rough order of how much they typically return:

1. **Process fewer pixels** — ROI, downscale, skip the sky.
2. **Process fewer frames** — detect every Nth frame and track between, as in lesson 5.
3. **Exit early** — check the cheap discriminator first. `if (area < 200) continue;` before
   anything expensive.
4. **Precompute** — undistortion maps, structuring elements, LUTs, network warm-up. Anything
   that does not change per frame belongs outside the loop.
5. **Reuse buffers** — hoist every `Mat` out of the loop, as in lesson 1.

Only after all five is it worth thinking about SIMD intrinsics, and by then you usually do
not need to.

## The checklist before you ship

- Frame time p99 is inside budget, on the target board, at the target ambient temperature.
  Thermal throttling on a Pi in a sealed enclosure is real and it arrives twenty minutes in.
- The pipeline degrades sensibly when it cannot keep up — drops frames, does not queue them
  into a growing lag.
- `CAP_PROP_BUFFERSIZE` is 1, and you have verified the negotiated resolution and FPS rather
  than assuming.
- Every allocation is outside the frame loop; RSS is flat over an hour-long run.
- The camera disconnecting is handled. USB cameras do disconnect, and `cap.read()` returning
  false forever is not a crash, so nothing restarts on its own unless you make it.
- Calibration file, model files and thresholds are versioned and logged at startup — future
  you will be asked why the numbers changed.

## Where to go from here

You now have the whole path: pixels in memory, a preprocessing chain with a reason for each
step, classical detectors, calibration into real units, motion and tracking, and a frame-rate
budget you can defend. That covers a large share of the vision work that actually ships.

When the scene stops being controllable — arbitrary backgrounds, visually diverse objects,
rules that would need fifty tuned constants — that is the boundary where a learned detector
earns its cost. The YOLO series picks up exactly there, and everything in this lesson about
budgets, capture and threading applies unchanged.

## Check yourself

1. Why can a 20 ms algorithm on a 30 FPS camera produce 19 FPS, and what fixes it?
2. What does `CAP_PROP_BUFFERSIZE = 1` prevent?
3. Why is `INTER_AREA` the right choice for downscaling?
4. When does moving a stage to `UMat` make the pipeline slower?
