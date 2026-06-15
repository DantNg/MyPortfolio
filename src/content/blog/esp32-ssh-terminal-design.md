---
title: "Building an SSH Terminal on ESP32-S3: Architecture, Threading, and LVGL"
description: "How to architect a real SSH client on an embedded microcontroller: libssh integration, safe cross-core threading, event-driven UI updates, and schema-driven configuration."
date: 2026-06-15
tags: ["ESP32", "SSH", "LVGL", "FreeRTOS", "Embedded Architecture", "Networking"]
coverImage: "/images/esp32_ssh_terminal/20260615_204348.jpg"
draft: false
featured: true
---

## Why SSH on a Microcontroller?

SSH feels like a desktop tool — you open your laptop, spin up a terminal, and connect to a server. But embedded systems live everywhere: IoT gateways, edge computing nodes, industrial controllers, lab equipment. Giving those devices a **standalone terminal interface** eliminates the dependency on a PC for remote management. The Guition JC8048W550 — an ESP32-S3 with a 5" touchscreen — is just big enough to be practical and small enough to sit on a shelf.

Building SSH into the device itself means no latency, no SSH client software to bundle, and a self-contained remote management appliance. The challenge is that SSH-2 is complex, libssh wasn't designed for microcontrollers, and coordinating a UI, networking, and cryptography across two CPU cores requires careful threading.

## The Stack: libssh, LVGL, FreeRTOS

The foundation is **libssh-ESP32**, a port of libssh to Arduino-ESP32. It handles the full SSH-2 handshake, password authentication, and session management. On top sits **LVGL**, a lightweight UI toolkit designed for embedded displays — perfect for a resistive or capacitive touchscreen. FreeRTOS coordinates threading: one core for UI, one for network I/O.

The magic is ensuring these layers talk safely to each other. LVGL is single-threaded by design (it owns the framebuffer and must not be called from multiple cores). libssh sessions are also not thread-safe — a session can only be owned by one task at a time. So we need a clean, thread-safe boundary between the UI and the network stack.

## Threading Model: Core 1 for UI, Core 0 for I/O

The design splits responsibility clearly:

**Core 1 (Main Thread):**
- LVGL rendering and input polling
- Drains the EventBus (a thread-safe, ISR-safe queue of UI events)
- Updates all UI state

**Core 0 (Background Tasks):**
- WiFi scan and connect tasks
- SSH session task (owns the libssh session for its entire lifetime)
- OTA service (HTTP server for firmware updates)

Background tasks **never call LVGL directly**. Instead, they post events to the EventBus — a lightweight publish-subscribe mechanism backed by an ISR-safe queue. The UIManager's main loop drains the queue and applies updates on Core 1.

```cpp
// From SSHClient (runs on Core 0)
// Never touch LVGL here. Push an event instead.
void onDataReceived(const char* data, size_t len) {
    UIEvent event;
    event.type = UIEventType::SSH_DATA_RECEIVED;
    memcpy(event.payload, data, len);
    eventBus.publishAsync(event);  // ISR-safe queue
}

// From UIManager (runs on Core 1)
void tick() {
    UIEvent event;
    while (eventBus.tryDequeue(event)) {
        if (event.type == UIEventType::SSH_DATA_RECEIVED) {
            terminalView.append(event.payload);  // Safe to call LVGL here
        }
    }
}
```

This pattern ensures LVGL is called only from Core 1, even though SSH data flows in on Core 0.

## Safe Session Ownership: TX Queue Pattern

libssh sessions are not thread-safe. A single session must be owned by one task. The SSHClient task owns the session and runs the full session loop: handshake, auth, open channel, RX/TX pump.

When the UI (running on Core 1) wants to send a command, it can't call `libssh_channel_write()` directly — that would race with the session task's RX loop on Core 0. Instead, the UI enqueues bytes onto a **TX queue** that the session task drains:

```cpp
// From UI (Core 1)
void SSHClient::send(const char* cmd) {
    for (size_t i = 0; i < strlen(cmd); i++) {
        txQueue.enqueue(cmd[i]);  // FreeRTOS queue: thread-safe
    }
}

// From SSHClient session task (Core 0)
void sessionLoop() {
    // ... SSH setup ...
    while (connected) {
        // RX: read from remote, post to EventBus
        if (ssh_channel_poll(channel, 0) > 0) {
            char buf[256];
            int n = ssh_channel_read(channel, buf, sizeof(buf), 0);
            eventBus.publishAsync(SSH_DATA_RECEIVED, buf, n);
        }
        
        // TX: drain the queue, write to remote
        char byte;
        while (txQueue.tryDequeue(byte)) {
            ssh_channel_write(channel, &byte, 1);
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}
```

All SSH calls stay on Core 0. All LVGL calls stay on Core 1. The queues bridge them safely.

![WiFi Connection Interface](/images/esp32_ssh_terminal/20260615_204730.jpg)
*WiFi tab showing network list and connection management*

## Schema-Driven UI: No Hardcoding Tabs

A common pitfall in embedded UI code is hardcoding every field, button, and label. The terminal tab needs fields for Host/IP, Port, Username, and Password. The WiFi tab needs a network list and connect button. If you hardcode all of this in LVGL callbacks, adding a new field means rewriting UI code.

Instead, **define the UI in data tables** (`AppConfig.h`):

```cpp
struct FieldSchema {
    const char* label;
    const char* placeholder;
    FieldType type;  // TEXT, PASSWORD, NUMBER, etc.
};

const FieldSchema sshFormFields[] = {
    {"Host / IP", "192.168.1.100", FieldType::TEXT},
    {"Port", "22", FieldType::NUMBER},
    {"Username", "root", FieldType::TEXT},
    {"Password", "", FieldType::PASSWORD},
};

struct TabSchema {
    const char* name;
    const FieldSchema* fields;
    size_t fieldCount;
};

const TabSchema appTabs[] = {
    {"WiFi", nullptr, 0},   // Special case: WiFi tab has its own logic
    {"SSH Terminal", sshFormFields, ARRAY_SIZE(sshFormFields)},
};
```

The UIManager reads these tables and auto-generates the form:

```cpp
void UIManager::buildTabs() {
    for (const auto& tab : appTabs) {
        auto tabView = createTabView(tab.name);
        
        for (size_t i = 0; i < tab.fieldCount; i++) {
            const auto& field = tab.fields[i];
            auto input = createInputField(field.label, field.placeholder);
            lv_obj_add_child(tabView, input);
        }
    }
}
```

Now adding a new field is a one-line change to the schema table — no UI rewriting.

## Terminal Output: Append-Only with ANSI Filtering

A traditional SSH terminal emulates VT100 — it interprets escape sequences, moves the cursor, redraws lines, supports full-screen editors like `vi`. That's a lot of work and adds complexity to an already-constrained device.

Instead, the terminal here is **append-only**: commands and output scroll vertically, and all ANSI escape sequences and control codes are stripped by `TerminalView::stripAnsi`:

```cpp
void TerminalView::append(const char* data, size_t len) {
    // Filter out escape sequences and control bytes
    for (size_t i = 0; i < len; i++) {
        if (data[i] == '\033') {
            // Skip to end of escape sequence
            while (i < len && !isalpha(data[i])) i++;
        } else if (data[i] >= 32 || data[i] == '\n' || data[i] == '\t') {
            // Append printable char
            scrollBuffer.append(data[i]);
        }
    }
    redraw();
}
```

The trade-off is that full-screen TUI programs (`top`, `vim`, `less`, interactive `sudo` prompts) won't work — they expect PTY support and VT100 emulation. But for command-line work (running scripts, checking logs, restarting services), plain output is clean and sufficient.

![SSH Terminal UI in Action](/images/esp32_ssh_terminal/20260615_204523.jpg)
*Terminal tab with SSH connection active and command output*

## WiFi Credentials: NVS Storage & Auto-Reconnect

WiFi credentials are stored in **NVS** (Non-Volatile Storage) — ESP32's on-device flash-based key-value store. On boot, if stored credentials exist, the WiFiProvider auto-connects:

```cpp
void WiFiProvider::init() {
    if (nvs.getString("ssid").length() > 0) {
        String ssid = nvs.getString("ssid");
        String pwd = nvs.getString("password");
        connect(ssid.c_str(), pwd.c_str());  // Auto-reconnect
    }
}

void WiFiProvider::saveCredentials(const char* ssid, const char* pwd) {
    nvs.setString("ssid", ssid);
    nvs.setString("password", pwd);
    nvs.commit();
}
```

On the WiFi tab, the user scans available networks, picks one, enters the password, and taps connect. Credentials are saved, so on the next power-up, the device reconnects automatically. The terminal is ready to go.

## OTA Updates: Firmware Over HTTP

Once on WiFi, the device runs a lightweight HTTP server on port 80. A browser request to `http://<device-ip>/` serves an upload form. POST the new `firmware.bin` and the device flashes the inactive OTA partition, reboots, and runs the new image.

```cpp
void OTAService::handleUpload() {
    // Read firmware.bin from HTTP request body
    // Write to inactive OTA partition
    esp_ota_end(handle);
    esp_ota_set_boot_partition(update_partition);
    esp_restart();
}
```

This eliminates the need for a USB cable and a flashing tool — update firmware from anywhere you can reach the device's IP.

## Lessons Learned

1. **Thread-safe queues are your friend.** Don't try to share state directly between cores; use FreeRTOS queues.
2. **LVGL is single-threaded by design.** All UI updates must come from one core. The EventBus pattern enforces this.
3. **Session ownership is clear.** One task owns the libssh session for its lifetime; others talk to it through queues.
4. **Data-driven UI saves rewrites.** Schema tables are more maintainable than hardcoded LVGL calls.
5. **Scope carefully.** An append-only terminal without PTY support is simpler and still useful for most SSH work.

## Next Steps

If you're building an SSH client for embedded systems:

- Start with a working WiFi + LVGL example (Guition and Arduino-GFX have plenty).
- Add libssh-ESP32 and test the SSH handshake and auth in isolation.
- Wrap the session in a FreeRTOS task and post events to the UI via a queue.
- Build the form UI on top, using schema-driven tables from the start.
- Add OTA support early — you'll appreciate wireless updates as you iterate.

The full source is on [GitHub](https://github.com/DantNg/esp32-ssh-terminal). Questions or improvements? Open an issue.
