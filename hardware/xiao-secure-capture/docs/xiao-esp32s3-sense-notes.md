# XIAO ESP32-S3 Sense Notes

Last researched: 2026-05-12

## Board in Scope

Purchased board: Seeed Studio XIAO ESP32-S3 Sense, SKU `113991115`.

Useful board facts for this project:

- ESP32-S3R8, dual-core Xtensa LX7 up to 240 MHz.
- 2.4 GHz Wi-Fi and BLE are built in; no extra Wi-Fi module is needed.
- 8 MB PSRAM and 8 MB flash.
- Plug-in camera board, digital microphone, and microSD slot.
- The onboard camera path is enough for the first secure-capture receipt PoC; no soldering is required until external sensors/buttons are added.

## Official Sources to Start From

- Seeed getting started: https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/
- Seeed camera usage: https://wiki.seeedstudio.com/xiao_esp32s3_camera_usage/
- Seeed FreeRTOS guide: https://wiki.seeedstudio.com/xiao-esp32s3-freertos/
- Seeed pin multiplexing: https://wiki.seeedstudio.com/xiao_esp32s3_pin_multiplexing/
- Espressif camera driver: https://github.com/espressif/esp32-camera
- ESP-IDF FreeRTOS overview: https://docs.espressif.com/projects/esp-idf/en/v5.0.3/esp32s3/api-reference/system/freertos.html
- ESP32-S3 RSA Digital Signature peripheral: https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/peripherals/ds.html
- ESP32-S3 HMAC peripheral: https://docs.espressif.com/projects/esp-idf/en/v4.4.6/esp32s3/api-reference/peripherals/hmac.html

## Hardware Notes

Seeed documents that newer XIAO ESP32-S3 Sense stock may ship with OV3660 instead of OV2640. Their getting-started page says the camera examples remain compatible with OV2640, OV3660, and OV5640. Seeed also published a product change notice for SKU `113991115` and `102010635` saying OV2640 was replaced by OV3660 because OV2640 is no longer manufactured.

For camera work:

- Install the included antenna for reliable Wi-Fi/BLE testing.
- Attach the Sense expansion board by aligning the B2B connector until it clicks.
- Use FAT32 microSD up to 32 GB if saving images locally.
- Enable PSRAM for camera work. The Seeed FreeRTOS guide calls out 8 MB flash, Octal PSRAM, and 80 MHz PSRAM clock for ESP-IDF setup.
- Long-running camera streaming can make the board hot. The capture-receipt project should start with single-frame capture, not continuous high-resolution streaming.

Important camera pins from Seeed docs:

```text
GPIO10  XMCLK
GPIO11  DVP_Y8
GPIO12  DVP_Y7
GPIO13  DVP_PCLK
GPIO14  DVP_Y6
GPIO15  DVP_Y2
GPIO16  DVP_Y5
GPIO17  DVP_Y3
GPIO18  DVP_Y4
GPIO38  DVP_VSYNC
GPIO39  Camera SCL
GPIO40  Camera SDA
GPIO47  DVP_HREF
GPIO48  DVP_Y9
```

MicroSD SPI pins from Seeed docs:

```text
GPIO21  microSD CS
GPIO7   microSD SCK
GPIO8   microSD MISO
GPIO9   microSD MOSI
```

Microphone pins from Seeed docs:

```text
GPIO41  PDM microphone DATA
GPIO42  PDM microphone CLK
```

## Firmware Stack Choice

Use ESP-IDF, not MicroPython, for the portfolio-grade firmware path.

ESP-IDF starts FreeRTOS automatically and calls `app_main()` from the main task. The app should create the project tasks from `app_main()` rather than calling `vTaskStartScheduler()` manually.

Proposed FreeRTOS task split:

```text
control_task  USB serial or Wi-Fi command input; receives nonce.
capture_task  Calls esp_camera_fb_get(), validates JPEG frame buffer, returns it after processing.
hash_task     Calculates SHA-256 over exact fb->buf/fb->len bytes.
sign_task     Builds and signs the receipt payload.
comm_task     Emits receipt/JPEG over serial first, Wi-Fi HTTP later.
trace_task    Emits structured firmware trace lines for host-side analysis.
```

Use queues or event groups between tasks. Keep the first MVP on USB serial; add Wi-Fi POST after capture/hash/sign/trace are stable.

## Camera Driver Notes

Espressif's `esp32-camera` component supports ESP32-S3 and sensors including OV2640, OV3660, and OV5640.

Key driver lessons from the official repo:

- Add the ESP-IDF dependency with `idf.py add-dependency "espressif/esp32-camera"`.
- Enable PSRAM in menuconfig.
- Use JPEG capture for this project. The driver docs warn that YUV/RGB loads the chip heavily, especially when Wi-Fi is enabled.
- Except for CIF-or-lower JPEG cases, PSRAM should be enabled and available.
- `esp_camera_fb_get()` returns a `camera_fb_t *`; always call `esp_camera_fb_return(fb)` when done.
- Start with 1 frame buffer and single-frame capture for better control; increase buffering only after the trace output shows stable latency and memory.

## Receipt Format Draft

```json
{
  "schema": "argus.xiao.capture.receipt.v1",
  "deviceId": "xiao-esp32s3-sense-001",
  "nonce": "hex-or-base64-server-nonce",
  "imageSha256": "hex-sha256-of-jpeg-bytes",
  "captureCounter": 1,
  "firmwareVersion": "0.1.0",
  "firmwareBuild": "git-or-build-id",
  "capturedAtMs": 0,
  "signatureAlgorithm": "ecdsa-p256-sha256-dev-key",
  "signature": "base64-signature"
}
```

MVP signing can use a software development key while the pipeline is being validated. The docs and README must label this as development signing, not production hardware security.

## Security Path

Practical scope:

1. Software signing key for end-to-end pipeline validation.
2. Secure Boot / Flash Encryption experiment after the firmware can be reflashed and recovered confidently.
3. ESP32-S3 HMAC/eFuse/RSA_DS signing PoC after a second board or a stable backup plan is available.

The RSA_DS peripheral can calculate RSA signatures with encrypted private key parameters. Espressif documents that HMAC uses eFuse input keys and that the key material is not exposed to software during signature calculation. This is the most Argus-like hardware-backed signing path on ESP32-S3, but it involves irreversible eFuse provisioning, so do not start here.

HMAC alone is also useful for challenge-response, but it is symmetric. For backend-verifiable public receipts, prefer software ECDSA/RSA for MVP and evaluate RSA_DS for the advanced phase.

## Community and Troubleshooting Notes

Community material is useful for board-specific friction, but official docs should win when they conflict.

- Seeed forum reports a working camera server path and mentions that 640x480 streaming was stable indoors for one user. Treat this as anecdotal, not a performance guarantee.
- Forum and ESPHome threads repeatedly point at pin mapping as a common failure mode. XIAO ESP32-S3 Sense is not pin-compatible with generic ESP32-CAM modules.
- Common issues to document during bring-up:
  - PSRAM not enabled or wrong PSRAM mode.
  - Using the wrong camera sensor assumptions for OV2640 vs OV3660.
  - Missing antenna during Wi-Fi testing.
  - Not returning the camera frame buffer.
  - Running continuous stream before single-frame capture is stable.
  - SD card or partition warnings mixed into camera server examples.
  - Heat during long camera sessions.

## First Validation Checklist

1. Board enumerates over USB and prints serial logs.
2. ESP-IDF target is `esp32s3`.
3. Flash is configured as 8 MB.
4. PSRAM is enabled as Octal PSRAM.
5. Camera initializes with XIAO pins.
6. `esp_camera_fb_get()` returns a JPEG buffer.
7. Firmware computes SHA-256 of `fb->buf` with length `fb->len`.
8. Firmware emits a receipt and structured trace over USB serial.
9. Host Python recomputes the JPEG hash and verifies the receipt.
10. Firmware returns the frame buffer and survives repeated captures.
