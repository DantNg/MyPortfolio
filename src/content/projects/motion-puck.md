---
title: "Motion Puck — Coin-Size Wireless IMU Logger"
description: "ESP32-S3 dual-core FreeRTOS device streaming a 9-axis BNO085 IMU at 1000 Hz over BLE 5.0 while logging to microSD, with a WiFi SoftAP HTTP server for log retrieval."
date: 2024-02-01
tags: ["ESP32", "FreeRTOS", "BLE 5.0", "WiFi", "IMU", "microSD"]
status: "completed"
githubUrl: "https://github.com/DantNg/Motion_Puck"
featured: true
order: 3
---

## Overview

A coin-size wireless motion logger built on the ESP32-S3 (dual-core, FreeRTOS). It captures high-rate inertial data from a 9-axis BNO085 IMU and both streams it live and stores it locally.

## Key Features

- **1000 Hz 9-axis IMU capture** from the BNO085, streamed over **BLE 5.0** with **concurrent binary logging to microSD**.
- **WiFi SoftAP HTTP server** (with Basic Auth) for downloading logs directly from the device — no special tools required.
- **Ring-buffer DMA pipeline** and a **compact binary envelope format** to sustain high throughput without dropping samples.

## Engineering Challenges

Sustaining 1000 Hz capture while simultaneously streaming over BLE and writing to microSD is a throughput and timing problem. The dual-core ESP32-S3 lets sensor acquisition run on one core while networking and storage run on the other. A ring-buffer DMA pipeline decouples the fast sensor producer from the slower storage/transport consumers, and the compact binary format minimizes both airtime and SD write volume.

This combination of live streaming plus reliable local logging makes the device useful for motion analysis where neither a dropped connection nor a missing sample is acceptable.
