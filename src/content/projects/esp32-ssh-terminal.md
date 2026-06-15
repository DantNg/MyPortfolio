---
title: "ESP32-S3 SSH Terminal — Wireless Shell on a Touchscreen"
description: "A standalone SSH client for the Guition JC8048W550 5\" display board. Connect via WiFi, authenticate via password, and get an interactive shell to any SSH-2 server — no PC required. Built with LVGL, libssh, and FreeRTOS on ESP32-S3."
date: 2026-06-15
tags: ["ESP32", "SSH", "LVGL", "FreeRTOS", "Embedded UI", "Networking"]
status: "completed"
githubUrl: "https://github.com/DantNg/esp32-ssh-terminal"
featured: true
order: 1
---

## Overview

An SSH terminal running entirely on a 5" touchscreen embedded device. The ESP32-S3 runs a full SSH-2 client stack (via libssh), manages WiFi connectivity with on-screen credentials storage, and renders an interactive terminal UI using LVGL. No computer needed — type commands directly on the device's capacitive touch interface and see output in real time.

## Hardware & Display

The build targets the **Guition JC8048W550**: an ESP32-S3 development board with 16 MB Flash and 8 MB OPI PSRAM, paired with a 5" 800×480 RGB parallel display (ST7262) and GT911 capacitive touch controller over I²C. The panel is driven via `Arduino_GFX` and backlit through GPIO 2.

This combination packs a full computing experience into a standalone, WiFi-capable device — suitable for remote server management in labs, edge deployments, or anywhere a quick SSH terminal beats pulling out a laptop.

## Real SSH-2 & Touch UI

Under the hood, **libssh** handles the SSH-2 handshake, password authentication, and remote shell channel. The UI stacks a **tabbed interface** built in LVGL: a WiFi tab for scanning and connecting to networks (with NVS-backed credential storage for auto-reconnect on boot), and a Terminal tab for entering host details and running commands.

The terminal view is append-only — commands and output scroll vertically, and a built-in ANSI filter strips escape sequences and control codes, keeping the display clean and simple. An on-screen soft keyboard makes text input natural on a touch device.

## Architecture: Layered & Threaded

The codebase follows SOLID principles with clean layer separation:

- **HAL**: DisplayHAL and TouchHAL abstract the low-level drivers.
- **Core**: AppConfig (schema-driven UI tables) and EventBus (lightweight publish-subscribe).
- **Network**: WiFiProvider for scanning/connecting, SSHClient for the SSH session, OTAService for wireless firmware updates.
- **UI**: UIManager orchestrates LVGL rendering and tabs.

**Threading** is intentional: Core 1 runs the main loop (LVGL rendering and EventBus draining), while Core 0 handles background tasks (WiFi scans, SSH sessions). Background tasks never call LVGL directly — they post events to an ISR-safe queue that UIManager drains on Core 1, ensuring all UI updates happen on the safe thread.

The SSH client runs a dedicated Core 0 task that owns the libssh session for its lifetime. Because libssh sessions are not thread-safe, UI sends go through a TX queue that the session task drains, keeping concurrency safe.

## Wireless Updates & Secure Shell

The device supports **over-the-air (OTA) firmware updates**: once connected to WiFi, browse to `http://<device-ip>/` and upload the new firmware binary. The OTA service flashes the inactive partition and reboots into the updated image.

For security: password authentication is supported, and host-key verification is intentionally skipped (the device has no persistent `known_hosts` store). This design is appropriate for trusted LANs; production deployments on untrusted networks should add key-based auth and persistent host-key checking.

## Why It Matters

A standalone SSH terminal eliminates friction from remote work. Instead of logging into a computer, opening a terminal, and SSH-ing to a server, you tap a device on the shelf, fill in credentials on screen, and you're in. The layered architecture makes adding new features straightforward — WiFi tabs and SSH form fields are driven by schema tables in `AppConfig.h`, so extending the UI is a one-line change, not a UI rewrite.

The threading model ensures the UI stays responsive even while SSH data flows in the background, and the event bus keeps the layers decoupled and testable.
