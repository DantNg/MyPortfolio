---
title: "BLE Mesh Architecture: From Theory to Production"
description: "A comprehensive look at Bluetooth Mesh networking — how provisioning, relay flooding, and friend/LPN relationships work, and what to watch out for in a real deployment."
date: 2024-08-02
tags: ["BLE Mesh", "BLE", "IoT", "Networking", "Nordic nRF"]
coverImage: "/images/blog/ble-mesh.jpg"
draft: false
featured: false
---

## What Makes BLE Mesh Different

Standard BLE is point-to-point or point-to-multipoint (broadcaster → scanner). BLE Mesh flips this into a true many-to-many network using **managed flooding**: every relay node re-broadcasts each message, and message integrity + TTL prevent infinite loops.

This is both BLE Mesh's strength and its weakness: it's simple to implement and self-healing, but flooding doesn't scale to thousands of nodes without careful design.

## The Four Node Roles

| Role | Description | Power |
|------|-------------|-------|
| **Relay** | Re-broadcasts received messages | High |
| **Proxy** | Bridges GATT (phone) ↔ Mesh | High |
| **Friend** | Stores messages for LPN nodes | Medium |
| **Low Power Node (LPN)** | Polls friend, sleeps otherwise | Ultra-low |

A node can fulfill multiple roles. A gateway node typically runs Relay + Proxy + Friend simultaneously.

## Provisioning Deep Dive

Provisioning is how a bare device joins the mesh and receives its network keys. Steps:

1. **Beaconing**: Unprovisioned device broadcasts `PB-ADV` or `PB-GATT` beacon
2. **Invitation**: Provisioner sends capabilities request
3. **Exchanging Keys**: ECDH key agreement establishes session security
4. **Distribution**: Provisioner sends NetKey, DevKey, IV Index, unicast address
5. **Complete**: Device is now a mesh node

```c
/* Zephyr: handle provisioning complete */
static void prov_complete(uint16_t net_idx, uint16_t addr) {
    LOG_INF("Provisioned: net_idx=0x%04x addr=0x%04x", net_idx, addr);
    board_led_set(true);
}

static const struct bt_mesh_prov prov = {
    .uuid = dev_uuid,
    .complete = prov_complete,
};
```

## Friend/LPN Relationship

The Friend feature is the key to battery-powered mesh nodes. An LPN wakes periodically, sends a **Friend Poll**, and receives queued messages from its friend node. Between polls, it's in deep sleep.

The poll interval is a critical tuning parameter:
- **Short interval** (100 ms): Low latency, high power consumption
- **Long interval** (10 s): High latency, excellent battery life

```c
/* prj.conf for LPN configuration */
CONFIG_BT_MESH_LOW_POWER=y
CONFIG_BT_MESH_LPN_POLL_TIMEOUT=300   /* 3 seconds */
CONFIG_BT_MESH_LPN_INIT_POLL_TIMEOUT=100
CONFIG_BT_MESH_LPN_MIN_QUEUE_SIZE=2
```

## TTL Tuning and Network Sizing

The Time-To-Live field caps the number of relay hops. Each relay decrements TTL by 1; at TTL=1 the message is not relayed further.

For a network with diameter D (max hops between any two nodes):
- Set `TTL = D + 1` as your default

Too high: unnecessary traffic, potential for broadcast storms.
Too low: messages don't reach distant nodes.

For 50 nodes across a 3000 m² floor, I found TTL=5 covered all nodes with 2-hop redundancy after placing relay nodes every 15 m.

## Production Gotchas

**1. IV Index Updates**: The IV index must be updated periodically to prevent sequence number exhaustion. Zephyr handles this automatically, but ensure your friend nodes stay online during the update window.

**2. Key Refresh Procedure**: If a node is compromised, you must rotate network keys. This is a multi-step procedure that requires all nodes to be reachable — plan your key refresh strategy before deployment.

**3. Scanner Duty Cycle**: Relay nodes must scan continuously, which means ~10 mA average current. Use mains-powered hardware for relay/friend roles, not batteries.

**4. Advertising Congestion**: In dense deployments (>30 nodes in one room), simultaneous transmissions cause collisions. Randomized backoff in the relay algorithm helps, but observe the 37.5 ms advertising interval and avoid flooding with high-frequency publications.

BLE Mesh is genuinely production-ready for smart building and industrial use cases — the Bluetooth SIG specification is mature and vendors like Nordic, Silicon Labs, and Espressif have solid SDKs. Just go in with eyes open about the relay/power tradeoffs.
