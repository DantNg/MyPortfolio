---
title: "Autonomous Drone Flight Controller"
description: "A custom flight controller built on STM32H7 with PX4 firmware integration, featuring sensor fusion using IMU, barometer, and GPS for precise autonomous navigation."
date: 2024-10-15
tags: ["STM32", "PX4", "MAVLink", "C++", "Sensor Fusion", "FreeRTOS"]
coverImage: "/images/projects/drone-controller.jpg"
status: "completed"
githubUrl: "https://github.com/yourusername/drone-flight-controller"
featured: true
order: 1
---

## Overview

This project implements a custom flight controller targeting the STM32H743 MCU, tightly integrated with the PX4 autopilot stack. The controller handles sensor acquisition, state estimation, and control loop execution at 1 kHz.

## Architecture

The firmware is structured around FreeRTOS tasks with strict priority assignment:

- **Sensor Task** (highest priority): Reads IMU (ICM-42688-P), barometer (BMP388), and magnetometer at fixed intervals.
- **Estimator Task**: Runs an Extended Kalman Filter for attitude and position estimation.
- **Control Task**: Implements PID controllers for roll, pitch, yaw, and altitude hold.
- **MAVLink Task**: Handles telemetry and command communication with a ground station.

## Key Features

- 1 kHz IMU sampling with SPI DMA transfers
- EKF-based sensor fusion (IMU + GPS + Barometer)
- MAVLink v2 protocol implementation over UART
- Failsafe modes: Return-to-Home, land-in-place
- Hardware-in-the-loop simulation support via SITL

## Results

Achieved stable hover with <5 cm positional drift in GPS-denied environments using optical flow. Flight time improved 12% over reference design through optimized ESC communication (DSHOT600).

## Lessons Learned

Working at the hardware-software boundary exposed the criticality of deterministic scheduling. A single missed IMU sample at 1 kHz causes EKF divergence within 200 ms — FreeRTOS task pinning and DMA-driven transfers were essential.
