# Beginner Guide for the XIAO Secure Capture Project

This guide is for a first-time embedded developer using the Seeed Studio XIAO ESP32-S3 Sense to build a small but real firmware project around MCU camera capture, RTOS design, signing, and firmware trace analysis.

The goal is not to merely run a camera demo. The goal is to build and document this claim:

```text
The ESP32-S3 firmware receives a server nonce, captures JPEG bytes through the onboard camera, computes SHA-256 over the exact JPEG bytes, signs nonce + imageHash + captureCounter + firmwareVersion + deviceId, and emits a traceable capture receipt that can be verified by host/backend tooling.
```

This does not prove the real-world truth of the photographed scene. The precise claim is that a specific MCU firmware path captured and signed a specific image byte sequence. That phrasing is technically safer and aligns well with Argus.

## Mental Model

```text
XIAO ESP32-S3 Sense
  camera sensor -> JPEG frame buffer -> SHA-256 -> signed receipt -> USB serial or Wi-Fi

Host / Backend
  nonce issue -> receive JPEG + receipt -> recompute image hash -> verify signature -> analyze trace
```

You do not need Wi-Fi on day one. Sending a nonce over USB serial and receiving a signed receipt is already enough to demonstrate MCU firmware, RTOS structure, and trace-analysis work. Wi-Fi upload is a later phase.

## What This Board Can Do

The XIAO ESP32-S3 Sense is small, but it has the parts needed for this project:

- ESP32-S3R8 dual-core MCU up to 240 MHz.
- Built-in 2.4 GHz Wi-Fi and BLE.
- 8 MB PSRAM and 8 MB flash.
- Sense expansion board with camera, digital microphone, and microSD slot.
- USB-C for flashing, serial monitoring, and host-tool interaction.
- ESP-IDF support, which means FreeRTOS tasks, queues, event groups, timers, and watchdogs are available.

The first MVP does not require soldering. Soldering or wiring only becomes necessary when you add external buttons, sensors, secure elements, motors, or another MCU.

## First Checks When the Board Arrives

Before writing code, verify the board state.

1. Make sure the Sense camera expansion board is seated on the XIAO B2B connector.
2. Attach the included antenna before Wi-Fi/BLE tests.
3. Confirm that the USB-C cable supports data, not only charging.
4. Check that a serial port appears on macOS.
5. Locate the reset and boot buttons.
6. Watch for excessive heat. Long-running streaming tests come later.

According to Seeed's docs, newer XIAO ESP32-S3 Sense units may ship with OV3660 instead of OV2640. A seller page may still mention OV2640. The important point is that Seeed says the camera wiki examples apply to OV2640, OV3660, and OV5640. Do not hard-code "this is always OV2640" into the project narrative. Log the detected sensor when possible.

## Development Environment Choice

This board can be used with Arduino, MicroPython, or ESP-IDF. For this project's purpose, the final firmware should use ESP-IDF.

| Option | Strength | Role in this project |
| --- | --- | --- |
| Arduino | Fast examples and low friction | Good for a temporary camera smoke test |
| MicroPython | Friendly REPL for Python users | Weaker for C/RTOS/firmware portfolio claims |
| ESP-IDF | Official framework, FreeRTOS, components, menuconfig, security features | Final project baseline |

If ESP-IDF feels heavy at first, it is fine to run an Arduino camera example to confirm the hardware. Move the portfolio implementation to ESP-IDF afterward.

First checks after installation:

```bash
idf.py --version
idf.py set-target esp32s3
idf.py build
idf.py flash monitor
```

On macOS, the serial port usually appears as `/dev/cu.usbmodem*` or `/dev/cu.usbserial*`. If the board does not appear, first suspect a charge-only USB-C cable.

If the ESP32-S3 board does not enter flashing mode reliably, the usual pattern is holding the boot button while resetting or reconnecting USB to enter bootloader mode. The exact button sequence can vary with tool and board state, so preserve the serial boot log before guessing.

## Vocabulary

An MCU is a small computer. Unlike a laptop app running on a large operating system, firmware usually starts close to power-on and directly initializes hardware.

Firmware is the program running on the MCU. In this project it is written in C or C++ and directly touches camera drivers, memory, RTOS tasks, communication, and crypto code.

An RTOS is a Real-Time Operating System. It is not a desktop OS. It is a small kernel that lets embedded software be split into tasks that run with priorities, timing rules, and synchronization primitives.

ESP-IDF is Espressif's official development framework. On ESP32-S3, ESP-IDF includes FreeRTOS. The application starts at `app_main()`, where you create queues, tasks, and system services.

PSRAM is external RAM. It matters for camera work because JPEG frame buffers can be large. The XIAO ESP32-S3 Sense has 8 MB PSRAM, and ESP-IDF must be configured for Octal PSRAM.

A frame buffer is a memory block containing image bytes captured by the camera. You get one with `esp_camera_fb_get()` and must return it with `esp_camera_fb_return(fb)`.

A hash is a fingerprint of data. SHA-256 changes completely if even one byte of the JPEG changes.

A signature proves that the holder of a device identity key approved a payload. The MVP can start with a software development key. A later phase can evaluate ESP32-S3 HMAC/eFuse/RSA_DS for hardware-backed signing.

A trace log is structured firmware output designed for later analysis. For the Sandisk-style skill target, automated firmware trace analysis is as important as the capture itself.

## Why Use an RTOS

You could write the entire camera flow as one huge `while (true)` loop. That is enough for a demo, but it becomes hard to debug once camera capture, hashing, signing, serial output, Wi-Fi, and error recovery interact.

An RTOS lets you split the work:

```text
control_task  receives nonce commands
capture_task  captures JPEG frame buffers from the camera
hash_task     computes SHA-256 over the JPEG bytes
sign_task     builds and signs the receipt payload
comm_task     sends the result over USB serial or Wi-Fi
trace_task    emits structured trace logs
```

This is stronger for interviews than saying "I used FreeRTOS." You can say that you split capture, hashing, signing, communication, and trace logging into RTOS tasks connected by queues.

## RTOS Concepts

A task is an independently scheduled function. It usually contains a `for (;;)` or `while (true)` loop and should not return normally.

The scheduler decides which ready task runs next. A blocked task waits for an event, delay, queue message, or semaphore.

Priority controls scheduling preference. Do not give every task a high priority. Start simple, measure with trace logs, and adjust only when needed.

Stack is per-task memory for local variables and call frames. ESP-IDF FreeRTOS stack units differ from vanilla FreeRTOS in some APIs, so check the official docs when sizing tasks.

A queue transfers data between tasks. For example, `capture_task` can send a captured-frame descriptor to `hash_task`. Do not copy whole JPEG buffers through queues. Pass a pointer/length descriptor and manage ownership carefully.

An event group stores shared state bits such as `WIFI_READY`, `NONCE_READY`, `CAPTURE_DONE`, or `UPLOAD_DONE`.

A semaphore represents access to a resource. A mutex is a semaphore pattern used to protect shared state such as serial output or capture counters.

A timer triggers code after a delay or on an interval. It is useful for health checks and capture timeouts.

A watchdog detects tasks that hang or fail to yield for too long. It is useful when camera or network calls can block unexpectedly.

Core affinity pins a task to a CPU core. ESP32-S3 is dual-core. Do not overuse pinning at the beginning. Add it only after the single-core/task pipeline is working and trace logs show a reason.

## How to Read C Firmware Code

If C is new to you, read firmware in this order.

A `.h` file is a contract. It declares types, constants, and function prototypes that other files can use.

```c
typedef struct {
    const uint8_t *bytes;
    size_t length;
} jpeg_view_t;

esp_err_t capture_take_frame(jpeg_view_t *out);
```

A `.c` file is the implementation. It contains the actual behavior.

```c
esp_err_t capture_take_frame(jpeg_view_t *out) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb == NULL) {
        return ESP_FAIL;
    }
    out->bytes = fb->buf;
    out->length = fb->len;
    return ESP_OK;
}
```

A `struct` groups related data. RTOS queues often carry struct messages.

A pointer is an address, not the data itself. For large data such as JPEG images, do not copy the entire image through a queue. Pass a pointer and length descriptor instead.

`esp_err_t` is the common ESP-IDF success/failure type. Anything other than `ESP_OK` should become a clear trace event.

Ownership means who is responsible for memory. A camera frame buffer is borrowed from the camera driver. After hashing/signing, it must be returned with `esp_camera_fb_return(fb)`.

## Recommended RTOS Evolution

Grow the firmware in this order:

1. Single-task MVP: receive a serial command, capture, hash, sign, and print the receipt.
2. Add trace logs for every important step.
3. Add queues and split capture, hash, and sign into tasks.
4. Split communication into serial and later Wi-Fi.
5. Add core affinity only when the system is stable enough to measure.

This order avoids debugging too many variables at once. If camera, PSRAM, queues, Wi-Fi, and core affinity all change at the same time, failure analysis becomes noisy.

## How to Read This Folder

The hardware work is intentionally separated from the React Native SDK:

```text
hardware/xiao-secure-capture/
  README.md
  docs/
  firmware/
  host-tools/
  backend/
```

When firmware code is added, read it in this order:

1. `firmware/CMakeLists.txt`: which ESP-IDF components are built.
2. `firmware/main/app_main.c`: the real application entry point.
3. `firmware/components/board/`: XIAO pin definitions, camera config, board-specific initialization.
4. `firmware/components/capture/`: camera frame-buffer acquisition and release.
5. `firmware/components/crypto/`: SHA-256, receipt payload, and signing.
6. `firmware/components/protocol/`: serial commands, Wi-Fi upload, and message framing.
7. `firmware/components/trace/`: trace event names and log formatting.
8. `host-tools/`: Python nonce sender, receipt verifier, and trace analyzer.
9. `backend/`: optional HTTP nonce and capture upload API for the Wi-Fi phase.

Read data flow before reading every function:

```text
nonce -> capture request -> camera_fb_t -> imageSha256 -> receiptPayload -> signature -> upload/serial -> verifier
```

## What to Look For in ESP-IDF Code

Start at `app_main()`.

```c
void app_main(void) {
    // init NVS, board, camera, queues, tasks
}
```

Then search for `xTaskCreate()` or `xTaskCreatePinnedToCore()`. Task names, priorities, and stack sizes reveal the firmware design.

```c
xTaskCreate(capture_task, "capture", 8192, NULL, 5, NULL);
```

Queue creation is another design signal:

```c
QueueHandle_t capture_queue = xQueueCreate(4, sizeof(capture_request_t));
```

This means the queue can hold four `capture_request_t` messages.

Follow `esp_err_t` error handling:

```c
esp_err_t err = esp_camera_init(&config);
if (err != ESP_OK) {
    TRACE_ERROR("CAMERA_INIT_FAILED", err);
    return;
}
```

Good firmware does not hide failures. It turns them into traceable events.

## How to Read Camera Code

Camera code usually has three stages:

1. Fill `camera_config_t`.
2. Initialize with `esp_camera_init(&config)`.
3. Capture with `esp_camera_fb_get()`.

Key settings:

```text
pixel_format  Prefer JPEG. RGB/YUV costs more memory and CPU.
frame_size    Start low, such as VGA or SVGA.
jpeg_quality  Lower numbers can mean higher quality and larger files.
fb_count      Start with 1 for better control.
fb_location   Use PSRAM.
```

The critical frame-buffer pattern:

```c
camera_fb_t *fb = esp_camera_fb_get();
if (fb == NULL) {
    // trace failure
    return;
}

// hash fb->buf using fb->len

esp_camera_fb_return(fb);
```

`fb->buf` is the JPEG byte array. `fb->len` is its exact length. The signed `imageSha256` must be computed from exactly that byte range.

Frame-buffer ownership rule:

```text
capture_task receives fb.
hash_task/sign_task may read fb->buf/fb->len.
After all processing, capture_task or the designated owner calls esp_camera_fb_return(fb).
After return, no task may read fb->buf.
```

For the first implementation, keep ownership simple: capture, hash, sign, and return the frame buffer inside `capture_task`. Split the stages through queues only after the rule is documented and tested.

## How to Read Security and Signing Code

Keep three ideas separate.

The image hash is a fingerprint of the JPEG:

```text
imageSha256 = SHA256(jpegBytes)
```

The receipt payload is the meaningful data to sign:

```json
{
  "schema": "argus.xiao.capture.receipt.v1",
  "deviceId": "xiao-esp32s3-sense-001",
  "nonce": "...",
  "imageSha256": "...",
  "captureCounter": 1,
  "firmwareVersion": "0.1.0"
}
```

The signature is the device identity statement:

```text
signature = Sign(devicePrivateKey, canonicalReceiptPayload)
```

The MVP may use a software development key, but the docs must label it as development signing, not production hardware security.

The advanced path can evaluate ESP32-S3 HMAC/eFuse/RSA Digital Signature peripheral. That path is closer to hardware-backed signing because signing uses eFuse/HMAC-derived material that software should not directly see. However, eFuse provisioning is irreversible, so do not start there on the first board.

Practical security ladder:

| Phase | Implementation | Safe claim |
| --- | --- | --- |
| v0.1 | Software development key | Implemented firmware data path and receipt verification |
| v0.2 | Flash Encryption / Secure Boot experiment | Explored defenses against arbitrary firmware and flash extraction |
| v0.3 | HMAC/eFuse challenge-response | Tested eFuse-secret-based device authenticity |
| v0.4 | RSA_DS signing PoC | Explored a hardware-backed signing path where software does not directly see private key material |
| Production | Provisioning, key lifecycle, secure manufacturing | Beyond the scope of a personal project |

HMAC is symmetric, so the backend needs the same secret or a secure derived verification path. Public receipt verification is easier to explain with ECDSA/RSA signatures. That is why the MVP should use software ECDSA/RSA for the end-to-end flow and evaluate RSA_DS later.

## Where This Connects to Argus

Argus already has an Android path that binds photo bytes, evidence, relayer policy, and registry commitments.

The XIAO project is a separate MCU witness. Later, a proof bundle can include a `hardwareWitness` object:

```json
{
  "hardwareWitness": {
    "deviceModel": "Seeed XIAO ESP32-S3 Sense",
    "receiptSchema": "argus.xiao.capture.receipt.v1",
    "nonce": "...",
    "imageSha256": "...",
    "captureCounter": 12,
    "firmwareVersion": "0.1.0",
    "signatureAlgorithm": "...",
    "signature": "...",
    "publicKeyId": "xiao-dev-001"
  }
}
```

The phone-camera proof and MCU-camera proof do not need to be the same image in the first version. Build the MCU capture receipt independently first, then attach it as hardware witness evidence later.

## Trace Log Design

Trace logs should be machine-readable. Avoid unstructured "done" prints.

Recommended format:

```text
T=12345 LVL=INFO EVT=NONCE_RX nonce=ab12...
T=12400 LVL=INFO EVT=CAPTURE_START core=1 heap=151232 psram=7012344
T=12890 LVL=INFO EVT=CAPTURE_DONE bytes=84231 elapsed_ms=490
T=12920 LVL=INFO EVT=HASH_DONE sha256=...
T=12960 LVL=INFO EVT=SIGN_DONE counter=12
T=13100 LVL=INFO EVT=SERIAL_TX_DONE bytes=...
```

The Python analyzer should answer:

- Was capture started after nonce receipt?
- Did capture, hash, sign, and transmit happen in the correct order?
- Does the JPEG hash match receipt `imageSha256`?
- Does the signature verify?
- Is capture latency within the expected range?
- Does heap/PSRAM trend downward after repeated captures?
- If there is a failure event, what is the likely root cause?

This is the part that most directly targets automated firmware trace analysis.

Analyzer output example:

```text
PASS capture_id=12
image_hash_match=true
signature_valid=true
event_order=NONCE_RX>CAPTURE_START>CAPTURE_DONE>HASH_DONE>SIGN_DONE>SERIAL_TX_DONE
capture_latency_ms=490
min_heap=151232
min_psram=7012344
root_cause=none
```

Failure classification examples:

```text
FAIL root_cause=CAMERA_INIT_FAILED hint="check B2B connector, camera pins, PSRAM mode"
FAIL root_cause=HASH_MISMATCH hint="host did not verify the exact JPEG bytes emitted by firmware"
FAIL root_cause=COUNTER_ROLLBACK hint="captureCounter is not monotonic"
FAIL root_cause=SIGNATURE_INVALID hint="receipt payload canonicalization or key mismatch"
FAIL root_cause=UPLOAD_FAILED hint="check antenna, Wi-Fi credentials, backend URL"
```

## Development Roadmap

### Phase 0: Freeze the Goal

Read this guide, `xiao-esp32s3-sense-notes.md`, and the project README.

Success criterion:

```text
You can explain the layout, RTOS task plan, receipt format, and trace format without the board connected.
```

### Phase 1: ESP-IDF Bring-Up

Commands:

```bash
idf.py set-target esp32s3
idf.py menuconfig
idf.py build
idf.py flash monitor
```

Settings:

```text
Flash size: 8 MB
PSRAM: enabled
PSRAM mode: Octal
PSRAM clock: 80 MHz
```

Success criterion:

```text
Serial monitor prints app version, chip info, free heap, and free PSRAM.
```

### Phase 2: Single Frame Capture

Implement:

```text
camera init
esp_camera_fb_get()
print JPEG length
print first/last bytes
esp_camera_fb_return()
```

Success criterion:

```text
Repeated captures succeed and heap/PSRAM do not continuously decrease.
```

### Phase 3: SHA-256

Implement:

```text
SHA-256 over fb->buf/fb->len
print imageSha256 over serial
host Python recomputes the hash from the same JPEG bytes
```

Success criterion:

```text
Firmware hash equals host hash.
```

### Phase 4: Software-Signed Receipt

Implement:

```text
nonce input
captureCounter increment
receipt JSON creation
development-key signing
host Python signature verification
```

Success criterion:

```text
Changing nonce, imageSha256, counter, or firmwareVersion breaks verification.
```

### Phase 5: RTOS Pipeline

Implement tasks:

```text
control_task
capture_task
hash_task
sign_task
comm_task
trace_task
```

Success criterion:

```text
Tasks communicate through queues/events and the trace analyzer reports the correct sequence as PASS.
```

### Phase 6: Wi-Fi Backend Upload

Implement:

```text
GET /nonce
POST /captures with JPEG binary + receipt JSON
backend recomputes image hash
backend verifies signature
```

Success criterion:

```text
The MCU uploads a capture receipt over Wi-Fi and the backend stores PASS/FAIL.
```

### Phase 7: Hardware-Backed Security Experiment

Investigate:

```text
Secure Boot / Flash Encryption
HMAC/eFuse/RSA_DS signing PoC
second board or recovery plan before eFuse experiments
```

Success criterion:

```text
The docs clearly state what can be called hardware-backed and what must not be called production security.
```

## Wi-Fi Transport Design

Start the Wi-Fi phase with a simple API:

```text
GET /nonce
  response: { "nonce": "...", "expiresAtMs": ... }

POST /captures
  multipart/form-data:
    image: raw JPEG binary
    receipt: JSON string
```

Avoid this:

```text
Embedding the whole JPEG as base64 inside JSON
```

Base64 increases size and makes MCU memory handling more awkward. Send JPEG as a binary part and receipt as JSON.

It is fine to start with local HTTP instead of HTTPS. TLS adds memory pressure and certificate handling, so add it after capture/hash/sign/trace are stable.

## Debugging Routine

Narrow problems in this order:

1. Power/USB: does a serial port appear?
2. Boot log: is the chip detected as ESP32-S3?
3. Flash/PSRAM: are 8 MB flash and Octal PSRAM configured?
4. Camera board: is the B2B connector seated correctly?
5. Antenna: is it attached before Wi-Fi testing?
6. Camera init: are pin mapping and sensor assumptions correct?
7. Frame buffer: is `fb` NULL? Is `fb->len` abnormal?
8. Memory: does heap/PSRAM shrink after repeated captures?
9. Tasks: are queue send/receive operations timing out?
10. Host verification: is the host hashing the exact JPEG sent by the firmware?

## Good Firmware Habits

Prefer a traceable data path over clever abstractions.

Good habits:

- Do not swallow errors; turn them into trace events.
- Avoid copying JPEG bytes unless necessary.
- Always return camera frame buffers.
- Do not put large image data directly into queues.
- Check task stack high-water marks.
- Keep security claims precise.
- Separate MVP software signing from hardware-backed signing in the docs.

Avoid:

- Continuous streaming as the first milestone.
- High-resolution/high-quality JPEG at the start.
- Adding Wi-Fi, camera, SD, signing, and backend all at once.
- Burning eFuses on day one.
- Saying "camera sensor attestation" when the system does not prove that.

## Documentation Deliverables

Firmware experience is easier to evaluate when the design and validation notes are visible. Keep these documents next to the code:

```text
docs/architecture.md       overall flow, task graph, data path
docs/rtos-design.md        task, queue, priority, stack, core-affinity rationale
docs/receipt-format.md     signed receipt schema and canonicalization rules
docs/trace-format.md       trace event list and analyzer rules
docs/security-model.md     difference between software signing and hardware-backed signing
docs/test-results.md       repeated capture, hash, signature, upload results
docs/failure-analysis.md   failure cases and root-cause classification
```

These documents help interviewers see not just what you built, but how you debugged and validated it.

## Resume and Interview Language

Short version:

```text
Built ESP32-S3 FreeRTOS firmware on a XIAO Sense board for camera JPEG capture, SHA-256 hashing, signed capture receipts, USB/Wi-Fi transport, and Python-based firmware trace analysis.
```

More technical version:

```text
Separated camera capture, hashing, signing, communication, and trace output into FreeRTOS tasks connected by queues. Built host-side Python tooling to parse firmware traces and report capture latency, heap/PSRAM state, image-hash verification, and signature verification.
```

Security version:

```text
Validated the capture receipt signing path with a software development key, then documented an advanced path for ESP32-S3 HMAC/eFuse/RSA_DS hardware-backed signing experiments.
```

## Mapping to Sandisk-Style Requirements

`develop, debug, validate on embedded multi-core architectures`:

```text
Designed a FreeRTOS task pipeline on ESP32-S3 dual-core and validated camera/hash/sign/comm latency and memory state through trace logs.
```

`initiate first FA on customer issues`:

```text
Classified camera init failure, PSRAM misconfiguration, hash mismatch, signature mismatch, and upload failure using trace events and a Python analyzer.
```

`automate FW trace analysis`:

```text
Parsed UART trace logs with a Python CLI to automatically report PASS/FAIL, likely root cause, latency, and heap trends.
```

`C/C++/Python`:

```text
Implemented ESP-IDF C firmware plus Python host verification and trace-analysis tools.
```

## References

- Seeed XIAO ESP32-S3 getting started: https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/
- Seeed XIAO ESP32-S3 Sense camera usage: https://wiki.seeedstudio.com/xiao_esp32s3_camera_usage/
- Seeed XIAO ESP32-S3 FreeRTOS guide: https://wiki.seeedstudio.com/xiao-esp32s3-freertos/
- Seeed XIAO ESP32-S3 pin multiplexing: https://wiki.seeedstudio.com/xiao_esp32s3_pin_multiplexing/
- Espressif esp32-camera component: https://github.com/espressif/esp32-camera
- ESP-IDF FreeRTOS docs: https://docs.espressif.com/projects/esp-idf/en/v5.0/esp32s3/api-reference/system/freertos.html
- ESP32-S3 datasheet: https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf
- ESP32-S3 RSA Digital Signature peripheral: https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/peripherals/ds.html
- ESP32-S3 HMAC peripheral: https://docs.espressif.com/projects/esp-idf/en/v4.4.6/esp32s3/api-reference/peripherals/hmac.html
