---
lesson: 4
lang: en
title: "Binder, in Enough Depth to Debug It"
description: "The kernel driver, what a Parcel really is, the one-copy transaction, servicemanager, the 16-thread pool and the 1 MB buffer that will eventually break something, death recipients, and how to read binder state."
duration: "17 min"
tags: ["AOSP", "Binder", "IPC"]
---

## Everything is Binder

An app calling `getSystemService`, a system service calling a HAL, `dumpsys`, an intent, a
content provider query — all Binder transactions. A mid-range device does tens of thousands
per second. When Android feels slow, a Binder call is very often what it is waiting on.

Android chose Binder over pipes, sockets and System V IPC for four reasons that still hold:
one memory copy instead of two, per-call identity of the caller (`getCallingUid()`), lifetime
management across processes, and a thread pool model that maps a remote call onto a real
thread without you writing one.

![A binder transaction](/MyPortfolio/images/aosp/binder-flow.svg)

## The path of one call

```
client                    kernel                     server
  |                         |                           |
  proxy.setBrightness(0,128)|                           |
  |-- writes a Parcel ----->|                           |
  |   ioctl(BINDER_WRITE_READ)                          |
  |                         |-- copies ONCE into ------>|
  |                         |   the server's mapped     |
  |                         |   buffer                  |
  |   (client blocks)       |                    onTransact(code, data, reply)
  |                         |                           |  ...does the work
  |<-- reply Parcel --------|<--------------------------|
  |                         |                           |
```

The **one copy** is the design's central trick. `/dev/binder` maps a receive buffer into every
process; the driver copies straight from the sender's user space into the receiver's mapped
buffer. A socket would copy twice — user to kernel, kernel to user.

**The client blocks.** A synchronous Binder call blocks the calling thread until the reply
arrives. On the main thread of an app, that is a frozen UI, and this is the origin of a large
share of ANRs. Mark methods `oneway` when you do not need a reply:

```java
interface ILedCallback {
    oneway void onBrightnessChanged(int id, int brightness);
}
```

`oneway` returns immediately, delivers asynchronously, and has its own smaller buffer quota.
Use it for callbacks and notifications; never for something whose result you need.

## Parcels

A Parcel is a flat, ordered byte buffer. Not a schema, not a self-describing format — just
values written in an order that the reader must know exactly.

```cpp
// generated for you, but this is what it does
data.writeInterfaceToken(ILedControl::descriptor);
data.writeInt32(id);
data.writeInt32(brightness);
remote()->transact(SET_BRIGHTNESS, data, &reply);
reply.readInt32(&result);
```

Three consequences:

**Order is the contract.** Write two ints, read two ints, in that order. A mismatch does not
throw; it silently reads adjacent memory as the wrong type. This is exactly why you use
generated AIDL stubs rather than hand-writing transactions.

**`writeInterfaceToken` is a security check.** It stamps the interface descriptor so a server
can reject a Parcel aimed at a different interface. Hand-written Binder code that omits it is
a real vulnerability class.

**Binder objects can be parcelled.** Writing an `IBinder` into a Parcel passes a *reference*
across the process boundary; the kernel translates the handle. This is how callbacks work,
and it is a genuinely unusual capability for an IPC mechanism. File descriptors travel the
same way.

## servicemanager

The name registry, itself a Binder service, at the well-known handle 0.

```cpp
// server
AServiceManager_addService(binder, "android.hardware.acme.led.ILedControl/default");

// client
AServiceManager_waitForService("android.hardware.acme.led.ILedControl/default");
```

```bash
adb shell service list                 # every registered service
adb shell service check power          # is one there
adb shell dumpsys activity             # talk to one
```

Registration is SELinux-controlled: a service that lacks the policy to register will fail
`addService` and the client will see nothing. `add_service` denials in logcat are a common
bring-up failure — lesson 5.

Prefer `waitForService` over `getService`. The latter returns null when the service has not
registered yet, and half the "service is null at boot" bugs are exactly this race.

## The thread pool, and the number 16

```cpp
ABinderProcess_setThreadPoolMaxThreadCount(4);
ABinderProcess_startThreadPool();
ABinderProcess_joinThreadPool();
```

Every Binder server process has a pool of threads that pick up incoming transactions. The
platform default is **15 plus the main thread = 16**.

This is a hard limit with real consequences. If sixteen transactions are in flight and all
sixteen threads are busy, the seventeenth caller **blocks until a thread frees up**. If your
service's methods do slow work — file I/O, a network call, waiting on hardware — you can
exhaust the pool, and every client of your service stalls. From the client side this looks
like a mysterious system-wide hang.

Two rules follow:

- **Binder methods should be fast.** Hand slow work to your own worker thread and return.
- **Do not call back into a client while holding a lock.** Binder calls can re-enter: A calls
  B, B calls back into A on a different thread, and if A holds a lock the first thread needs,
  you deadlock. This is the classic Binder deadlock and it is unpleasant to diagnose.

Size the pool deliberately. A HAL serving one client does not need 15 threads; a busy system
service might.

## The 1 MB buffer

Each process has **one 1 MB Binder buffer, shared by all its transactions**. Not per call —
per process.

```
android.os.TransactionTooLargeException: data parcel size 1359872 bytes
```

The practical limit is well under 1 MB, because concurrent transactions share the space. A
500 KB Parcel may succeed on an idle system and fail under load, which makes this a
wonderful intermittent bug.

What to do instead of sending large data:

- **Paginate.** Return 50 items with a cursor, not 5000.
- **Send a file descriptor.** `ParcelFileDescriptor` passes an fd, not the bytes. This is the
  right answer for images, buffers and files, and it is very cheap.
- **Use shared memory.** `ashmem` / `MemoryFile` for large buffers.
- **Use a `Bundle` carefully.** A Bundle holding a Bitmap is a common way to hit this
  accidentally.

Note also that `oneway` transactions get only a fraction of the buffer, so flooding
asynchronous calls can fail while synchronous ones still work.

## Death recipients

A client holding a proxy to a dead service will otherwise fail on every call forever.

```cpp
static void onDied(void* cookie) {
    LOG(ERROR) << "led HAL died; will reconnect";
    reinterpret_cast<MyClass*>(cookie)->reconnect();
}

AIBinder_DeathRecipient* r = AIBinder_DeathRecipient_new(onDied);
AIBinder_linkToDeath(binder.get(), r, this);
```

```java
binder.linkToDeath(() -> { Log.e(TAG, "service died"); reconnect(); }, 0);
```

Link to death for **any** long-lived remote reference. Services get killed — by lmkd under
memory pressure, by a crash, by an update — and a client that does not notice becomes
permanently broken until it is restarted. This is a very common omission in vendor code and
it produces "works until it doesn't" bugs.

The mirror case matters too: a server holding callbacks from dead clients leaks them.
`RemoteCallbackList` handles this on the Java side by unregistering automatically on death;
on the native side, do it yourself.

## Identity and permissions

Every incoming transaction carries the caller's identity:

```cpp
uid_t uid = AIBinder_getCallingUid();
pid_t pid = AIBinder_getCallingPid();
```

```java
int uid = Binder.getCallingUid();
mContext.enforceCallingPermission(android.Manifest.permission.MY_PERM, "setBrightness");
```

This is the foundation of Android's permission model — the check happens in the *server*, in
the process that owns the resource, using an identity the kernel provided and the caller
cannot forge.

The one subtlety everyone hits: **inside your own process, `getCallingUid()` returns your own
uid**, because there was no transaction. And when your service calls out to another service
on behalf of a client, you must decide whose identity to use:

```java
long token = Binder.clearCallingIdentity();     // act as MYSELF
try {
    otherService.doPrivilegedThing();
} finally {
    Binder.restoreCallingIdentity(token);       // ALWAYS in a finally
}
```

Forgetting to restore leaves the thread running with the wrong identity for every subsequent
call it serves — a genuine privilege escalation, and the reason this pattern is always
written with `try/finally`.

## Debugging Binder

```bash
# who is registered
adb shell service list
adb shell lshal

# per-process binder state: threads, pending transactions, dead nodes
adb shell cat /sys/kernel/debug/binder/stats
adb shell cat /sys/kernel/debug/binder/transactions
adb shell cat /sys/kernel/debug/binder/proc/<pid>

# what is blocked right now
adb shell debuggerd -b <pid>       # native backtrace of every thread
adb shell kill -3 <system_server_pid>  # Java thread dump -> /data/anr/traces.txt
```

The two symptoms and where to look:

**"Everything is slow."** Look for a service whose thread pool is exhausted. In
`/sys/kernel/debug/binder/transactions` you will see transactions queued against one process.
The fix is in that service, not in the callers.

**A hang.** Take a thread dump of both processes. A Binder deadlock shows as thread A in
`IPCThreadState::waitForResponse` and, in the other process, a thread blocked on a lock held
by a thread that is itself in a Binder call. Once you have seen the shape once you recognise
it instantly.

For tracing, Perfetto has a Binder track that shows every transaction with its duration and
both endpoints. For "why did this take 300 ms", it beats every one of the commands above.

## Check yourself

1. Why is Binder one copy where a socket is two?
2. What happens to the seventeenth concurrent caller of a service with a default thread pool?
3. Why can a 500 KB Parcel work sometimes and fail other times?
4. What does `clearCallingIdentity` do and why must it be paired in a `finally`?

## Next

You now have every piece needed to add something of your own. Lesson 5 builds a complete
system service: the AIDL interface, the native implementation, init wiring, the SELinux
policy that will be your main obstacle, and a framework-side API for clients.
