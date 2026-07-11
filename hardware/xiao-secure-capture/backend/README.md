# MCU Backend Contract

The XIAO node sends an exact JPEG and an MCU receipt to the relayer over authenticated Wi-Fi. The current implementation is a development transport: it proves camera capture, byte hashing, receipt construction, SNTP time, and session consumption, but it does not yet claim a hardware-backed signature.

## Intended request

```json
{
  "deviceId": "xiao-s3-001",
  "captureSessionId": "capture-session-id",
  "serverNonce": "opaque-session-nonce",
  "photoBytesBase64": "...",
  "receipt": {
    "schema": "argus.xiao.capture.receipt.v1",
    "deviceId": "xiao-s3-001",
    "nonce": "opaque-session-nonce",
    "imageSha256": "...",
    "receiptDigest": "...",
    "captureCounter": 1,
    "capturedAtMs": 1783743405300,
    "firmwareVersion": "0.1.0",
    "firmwareBuild": "local-idf",
    "signatureAlgorithm": "none",
    "signatureBase64": "",
    "securityLevel": "unsigned_dev_only"
  }
}
```

The backend endpoint is `POST /mcu/capture`. It recomputes `imageSha256` from the received bytes, compares the receipt device ID and nonce with the issued session, recomputes `receiptDigest`, enforces the capture time window, and atomically consumes the session. The endpoint returns `productionVerified: false` for the current unsigned development receipt. It must reject `unsigned_dev_only` for production Verified Capture. Only after DS key enrollment and signature verification are implemented should this path construct a production Argus proof bundle.

## Transport rules

- Use HTTPS with server authentication; Wi-Fi connectivity alone is not device identity.
- Do not commit SSIDs, passwords, API tokens, DS material, or eFuse values.
- Bind the backend request to the same session nonce that the MCU signs.
- Treat the serial protocol as a lab/debug transport, not a production trust channel.
- Add retries only with an idempotency key derived from `deviceId`, `captureCounter`, and `receiptDigest`.

- The firmware uses ESP-IDF station mode, SNTP before capture timestamps, and HTTPS certificate-bundle validation. Plain HTTP is available only through an explicit local-development Kconfig switch.
- The upload path is not a Solana anchor path. The existing `/register-proof` flow and `scripts/anchor-smoke.mjs` validate the registry anchor separately; an unsigned MCU receipt must not be promoted into that production flow.
- The Wi-Fi client and HTTP upload are not claimed complete until the ESP-IDF project builds and a real request is accepted by the backend.
