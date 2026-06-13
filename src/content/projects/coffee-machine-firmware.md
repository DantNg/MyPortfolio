---
title: "Coffee Machine Firmware — Embedded Brew Controller"
description: "STM32F411 FreeRTOS firmware running a brew-cycle state machine, a 100 Hz safety monitor, and a concurrent HX711 load-cell task, with DMA-driven multi-channel ADC and stepper control."
date: 2024-06-01
tags: ["STM32", "FreeRTOS", "C", "ADC DMA", "HX711", "Stepper"]
status: "completed"
githubUrl: "https://github.com/DantNg/cofffee_machine_webapp"
featured: true
order: 2
---

## Overview

An embedded brew controller for an automatic coffee machine, built on the STM32F411 (Cortex-M4F with FPU) and FreeRTOS. The design coordinates several real-time tasks safely and deterministically.

## Concurrent Task Design

- **Brew-cycle state machine** orchestrating the full brewing sequence.
- **100 Hz safety monitor** running independently to catch fault conditions (over-temperature, over-pressure) regardless of what the brew logic is doing.
- **HX711 load-cell task** reading weight concurrently for dose control.

Inter-task synchronization is handled through **FreeRTOS queues and semaphores**, keeping the safety monitor isolated from the brewing logic.

## Hardware Integration

- **12-bit ADC via DMA across 6 channels**: 3 temperature sensors, a pressure sensor, and a potentiometer — sampled continuously without CPU intervention.
- **Stepper motor control with limit-switch feedback** for precise mechanical positioning.

## Why It Matters

A coffee machine is a deceptively good real-time problem: hot water and pressure make the safety monitor genuinely safety-critical, while the user expects smooth, responsive behavior. Separating concerns into prioritized FreeRTOS tasks — with the safety monitor at the top — guarantees fault handling even under heavy load.
