---
title: "LoRaWAN Smart Agriculture Gateway"
description: "An end-to-end LoRaWAN solution for precision agriculture, featuring ESP32-based sensor nodes, a Raspberry Pi gateway, and a cloud dashboard for real-time crop monitoring."
date: 2024-03-10
tags: ["ESP32", "LoRaWAN", "Python", "Docker", "MQTT", "IoT"]
coverImage: "/images/projects/lorawan-gateway.jpg"
status: "completed"
githubUrl: "https://github.com/yourusername/lorawan-agriculture"
featured: true
order: 3
---

## Overview

Built a complete LoRaWAN deployment covering 15 km² of farmland with 120 sensor nodes monitoring soil moisture, leaf wetness, ambient temperature, and rainfall. The system triggers automated irrigation based on sensor thresholds.

## Hardware Stack

- **Sensor nodes**: ESP32 + SX1276 LoRa module, solar-charged LiPo
- **Gateway**: Raspberry Pi 4 + RAK2245 LoRa concentrator (8 channels)
- **Backend**: Docker stack — ChirpStack Network Server + Application Server

## Firmware (ESP32 / Arduino-style C++)

- LoRaWAN Class A device (OTAA join)
- Adaptive Data Rate (ADR) enabled
- Cayenne LPP payload encoding (compact binary format)
- Deep sleep between transmissions: 15-minute intervals → ~3 mA average

## Backend Architecture

The ChirpStack application server forwards decoded payloads to an MQTT broker. A Python service subscribes, applies business logic, and writes to InfluxDB. Grafana serves the dashboard.

Automated irrigation triggers are implemented as Python rules engine with hysteresis to prevent relay chatter.

## Results

- 12 km maximum range achieved (line of sight, SF12)
- Sensor node battery life: 8 months on 3000 mAh LiPo + 2W solar panel
- 15% reduction in water usage vs. scheduled irrigation
- System uptime: 99.2% over 8-month field trial
