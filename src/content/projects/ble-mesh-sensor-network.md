---
title: "BLE Mesh Industrial Sensor Network"
description: "A scalable wireless sensor network using Nordic nRF52840 nodes running Zephyr RTOS with BLE Mesh protocol for industrial environment monitoring."
date: 2024-07-20
tags: ["Nordic nRF", "BLE Mesh", "Zephyr", "C", "IoT", "MQTT"]
coverImage: "/images/projects/ble-mesh.jpg"
status: "completed"
githubUrl: "https://github.com/yourusername/ble-mesh-sensor-network"
demoUrl: "https://demo.example.com/ble-mesh"
featured: true
order: 2
---

## Overview

Designed and deployed a 50-node BLE Mesh network for real-time temperature, humidity, and vibration monitoring across a factory floor. Data flows from sensor nodes through gateway nodes to an MQTT broker, then into a time-series database.

## System Architecture

```
[Sensor Nodes] → (BLE Mesh) → [Gateway nRF9160] → (MQTT) → [Broker] → [InfluxDB] → [Grafana]
```

Each sensor node runs Zephyr RTOS with the Bluetooth Mesh subsystem configured as a low-power node (LPN), achieving 2-year battery life on 2x AA cells.

## Protocol Stack

- **Zephyr BLE Mesh**: Provisioning, network & transport layers
- **Generic Sensor Server model**: Standardized property reporting
- **Friend node architecture**: LPN nodes poll a dedicated friend for queued messages
- **Heartbeat messages**: Network topology monitoring

## Key Challenges

### Latency vs. Power Tradeoff
LPN poll intervals had to be tuned per node class. Vibration sensors (event-driven) use 100 ms poll intervals; temperature sensors (slow-changing) use 30 s intervals.

### Mesh Reliability
Implemented redundant relay nodes (N+1) ensuring no single point of failure. Message TTL tuned to 5 hops maximum to prevent broadcast storms in the 50-node network.

## Results

- 99.7% message delivery rate over 6-month deployment
- Average end-to-end latency: 340 ms (sensor → dashboard)
- Battery life exceeded 18 months on all LPN nodes
