---
title: "Getting Started with Zephyr RTOS on Nordic nRF52840"
description: "A practical guide to setting up Zephyr RTOS, configuring the build system, and running your first BLE application on the Nordic nRF52840 DK."
date: 2024-11-05
tags: ["Zephyr", "Nordic nRF", "BLE", "RTOS", "Embedded"]
coverImage: "/images/blog/zephyr-rtos.jpg"
draft: false
featured: true
---

## Why Zephyr?

Zephyr has become the de-facto RTOS for production IoT firmware. Unlike FreeRTOS, it ships with a complete networking stack, a hardware abstraction layer covering 500+ boards, and a powerful build system (CMake + west). If you're building a BLE or LoRa product, Zephyr deserves serious consideration.

## Prerequisites

- nRF52840 DK (or any Zephyr-supported board)
- Linux or macOS host (WSL2 works on Windows)
- Python 3.10+

## Setting Up the Toolchain

```bash
# Install west (Zephyr's meta-tool)
pip install west

# Initialize workspace
west init ~/zephyrproject
cd ~/zephyrproject
west update

# Install SDK
west sdk install
```

Zephyr's SDK bundles GCC cross-compilers for ARM, RISC-V, and more. No manual toolchain setup required.

## Your First BLE Application

Create `src/main.c`:

```c
#include <zephyr/kernel.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/hci.h>

static const struct bt_data ad[] = {
    BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
    BT_DATA(BT_DATA_NAME_COMPLETE, CONFIG_BT_DEVICE_NAME,
            sizeof(CONFIG_BT_DEVICE_NAME) - 1),
};

int main(void) {
    int err = bt_enable(NULL);
    if (err) {
        return err;
    }

    return bt_le_adv_start(BT_LE_ADV_CONN, ad, ARRAY_SIZE(ad), NULL, 0);
}
```

Create `CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.20)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(ble_hello)
target_sources(app PRIVATE src/main.c)
```

Create `prj.conf`:

```
CONFIG_BT=y
CONFIG_BT_PERIPHERAL=y
CONFIG_BT_DEVICE_NAME="ZephyrHello"
```

## Building and Flashing

```bash
west build -b nrf52840dk_nrf52840 .
west flash
```

## The Devicetree Difference

Zephyr's biggest learning curve is Devicetree. Hardware configuration lives in `.dts` overlays, not `#define` headers. This means:

```c
/* app.overlay */
&uart0 {
    current-speed = <921600>;
};
```

instead of `#define UART_BAUD_RATE 921600` in a header. It feels foreign at first but enables the same firmware binary to run on hardware revisions with different peripheral mappings.

## Next Steps

- Explore the `samples/bluetooth/` directory — 30+ ready-to-run BLE examples
- Read the Zephyr docs on `CONFIG_` system to understand Kconfig
- Try `west twister` for automated testing across boards

Zephyr's learning curve is steeper than FreeRTOS but the infrastructure it provides — logging, shell, filesystem, networking — saves weeks on any serious product.
