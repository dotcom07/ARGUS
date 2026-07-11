# XIAO Secure Capture Trace Node

This folder is the hardware-side workspace for a Seeed Studio XIAO ESP32-S3 Sense capture node.

The first build target is the current stable ESP-IDF 6.0 series for ESP32-S3. The project keeps the temperature-sensor and LEDC driver components explicit because ESP-IDF 6 separates those public driver dependencies.

The goal is to keep the MCU work separate from the React Native SDK while leaving a clean path to later attach a hardware witness receipt to an Argus proof bundle.

## Target Claim

This is the intended release-level claim. The current development build deliberately reports `unsigned_dev_only` until DS enrollment is completed.

```text
The ESP32-S3 firmware receives a relayer nonce, captures JPEG bytes through the onboard camera, hashes the exact JPEG bytes on-device, signs nonce + imageHash + captureCounter + firmwareVersion + deviceId, and emits a traceable capture receipt.
```

This is a firmware-path claim. It does not claim that the camera sensor independently proves the real-world truth of the scene.

## Layout

```text
firmware/    ESP-IDF / FreeRTOS firmware for camera capture, hashing, signing, thermal guard, and trace logs.
host-tools/  Python tools for nonce injection, receipt verification, and firmware trace analysis.
backend/     Optional HTTP nonce and capture upload server for the Wi-Fi phase.
docs/        Board notes, RTOS/security plan, trace format, and validation notes.
```

## Current Bring-up

The connected board was identified as an Espressif USB JTAG/serial debug unit at `/dev/cu.usbmodem101` with MAC `44:1b:f6:80:3c:48`. The safe ESP-IDF 6.0.2 development firmware was built and flashed without a full-flash erase or any eFuse operation. The board booted with 8 MB PSRAM, detected its OV3660 camera, and produced 11-13 KB JPEG frames.

The new ESP-IDF project adds:

- FreeRTOS command, capture, and thermal tasks.
- A 30-second internal temperature sample to keep thermal-monitoring overhead negligible.
- A 70 C warning threshold and 78 C capture stop threshold.
- Exact frame-buffer SHA-256 and a canonical receipt digest.
- An explicit unsigned development receipt until DS enrollment exists.
- An ESP32-S3 RSA-DS enrollment boundary without automatic eFuse writes.
- A bidirectional USB Serial/JTAG console using the blocking ESP-IDF driver.
- A capture task stack high-water-mark log to catch memory regressions.

The final local smoke test captured twice, advanced `captureCounter` from 1 to 2, emitted `securityLevel=unsigned_dev_only`, and reported `capture task stack_free_words=6980`. The internal temperature sensor reported about 30.8 C at boot and again after the 30-second sample interval. No stack overflow occurred after the task-stack fix.

The development Wi-Fi path is now implemented and compiled in a separate Wi-Fi-enabled configuration. It connects as an ESP-IDF station, synchronizes time with SNTP, posts the exact JPEG plus receipt to `POST /mcu/capture`, and keeps Wi-Fi credentials in RAM only. The Wi-Fi build is about 1.06 MiB, so the default app partition was increased to the ESP-IDF 1.5 MiB single-app layout. A local HTTP smoke request passed session issuance, JPEG re-hashing, receipt-digest verification, and atomic session consumption; it intentionally returned `productionVerified=false`.

The connected board was first validated with the Wi-Fi-disabled development build, producing 11,726-byte and 12,932-byte JPEGs. It was then flashed with a temporary Wi-Fi-enabled build for the physical network test. On `dlink`, the board joined the AP, synchronized time with SNTP, and uploaded a real 9,764-byte JPEG to the Mac relayer at `10.78.203.33:8787`; the relayer returned HTTP 200 and consumed the capture session exactly once. The board's internal die temperature was 32.80 C during that run.

The existing Solana `/register-proof` path was also verified against Devnet. The smoke script confirmed a 189-byte proof PDA and matched the on-chain proof ID, manifest hash, image hash, capture timestamp, relayer, and active status. This is separate from the MCU endpoint: the current unsigned MCU receipt is not promoted to a Solana production proof.

The ESP32-S3 internal temperature sensor is a die-temperature signal for thermal protection, not a calibrated enclosure or board-surface measurement. Validate the thresholds with an external thermometer or thermocouple during hardware characterization.

## Phases

1. USB serial MVP: nonce in, JPEG capture, SHA-256, unsigned development receipt, trace output. Verified on the connected board.
2. RTOS pipeline: split command, capture, and thermal work across tasks and queues; hash/sign currently run inside the capture task.
3. Wi-Fi upload: request nonce and POST exact JPEG bytes plus receipt to an authenticated backend. Code/build, local HTTP contract, and physical AP upload are verified; the current receipt remains unsigned development evidence.
4. Hardware-backed signing: provision ESP32-S3 HMAC/DS material only after recovery and thermal tests.
