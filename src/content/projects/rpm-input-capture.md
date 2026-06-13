---
title: "RPM Input Capture — STM32 Modbus RTU Sensor"
description: "STM32F103 firmware measuring ultra-low rotational speed via Timer Input Capture with 64-bit overflow handling, exposed over an industrial Modbus RTU / RS485 interface."
date: 2024-09-01
tags: ["STM32", "C", "Modbus RTU", "RS485", "Timer Input Capture"]
status: "completed"
githubUrl: "https://github.com/DantNg/rpm_input_capture"
featured: true
order: 1
---

## Overview

An STM32F103 (Cortex-M3) firmware for accurate rotational-speed (RPM) measurement, designed for noisy industrial environments and integrated into PLC/SCADA systems over Modbus RTU.

## Key Features

- **Timer Input Capture with 64-bit overflow** for reliable ultra-low-speed detection where simple counting fails.
- **Configurable parameters**: pulses-per-revolution (PPR), wheel diameter, and measurement timeout — all **persisted to Flash** so settings survive power cycles.
- **Full Modbus RTU stack** (master/slave) over RS485 with CRC16 validation.
- **Adaptive period-averaging** and a **hysteresis filtering table** (up to 10 entries) to produce stable readings on jittery, noisy signals.

## Technical Highlights

The core challenge was measuring very low speeds accurately. Instead of counting pulses over a fixed window (which loses resolution at low RPM), the firmware measures the *period* between pulses using hardware Input Capture, extended to 64 bits in software to handle long intervals without timer overflow errors.

The hysteresis table prevents the readout from flickering between values when the input signal sits near a threshold — essential for clean HMI display and downstream control logic.
