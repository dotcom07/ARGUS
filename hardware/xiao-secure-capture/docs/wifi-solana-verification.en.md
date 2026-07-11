# Wi-Fi and Solana Verification Record

## Scope

This record describes the development verification performed **without irreversible eFuse changes**.

| Item | Result | Meaning |
| --- | --- | --- |
| ESP-IDF serial-only build | Passed | Camera, receipt, and thermal tasks compile |
| ESP-IDF Wi-Fi build | Passed | Station, SNTP, HTTP client, and TLS CA bundle compile |
| Physical board flash | Passed | `/dev/cu.usbmodem101`, no eFuse modification |
| Physical JPEG capture | Passed | 11,726-byte and 12,932-byte frames observed |
| Capture counter | Passed | 1 -> 2 |
| Internal temperature | Passed | 30.80 C and 31.80 C; below the 70 C warning threshold |
| Local MCU HTTP endpoint | Passed | Session issue, JPEG hash, receipt digest, atomic consume |
| Physical Wi-Fi AP upload | Passed | `dlink`, Mac `10.78.203.33`, real board JPEG 9,764 bytes, HTTP 200 |
| Solana Devnet anchor | Passed | Real transaction and proof PDA verified for `/register-proof` |

## MCU HTTP Path

1. The relayer issues `captureSessionId`, `nonce`, and a capture window through `POST /capture-session`.
2. The firmware accepts `CAPTURE <server_nonce> <capture_session_id>` and hashes the camera frame buffer's exact JPEG bytes.
3. When Wi-Fi is enabled, the firmware synchronizes time with SNTP and posts the exact JPEG plus receipt to `POST /mcu/capture`.
4. The relayer re-hashes the received JPEG, checks receipt nonce/device ID/digest/time window, and consumes the session exactly once.
5. The current receipt is `securityLevel=unsigned_dev_only`, so the result always has `productionVerified=false`.

`/mcu/capture` is a diagnostic transport endpoint. The current MCU receipt is not promoted directly to `/register-proof` or Verified Capture. Until RSA-DS key enrollment and backend signature verification exist, the system makes no cryptographic claim about hardware origin.

## Physical Wi-Fi Preconditions

- The board and relayer host must share the same 2.4 GHz network.
- SSID, password, and API tokens must never be committed.
- Use `ARGUS_ALLOW_INSECURE_HTTP=y` only for a temporary local development endpoint. External environments use HTTPS and the CA bundle.
- Confirm `WIFI_CONNECTED`, `WIFI_TIME_SYNCED`, and `WIFI_UPLOAD status=200` in the firmware log.
- Send a session-bound command with `host-tools/serial_smoke.py --nonce <64-hex> --session-id <capture-session-id>`.

Physical result: the board joined `dlink`, synchronized time with SNTP, and logged `WIFI_UPLOAD status=200 bytes=9764`. The relayer consumed the same capture session once and verified `imageHash=328e3ae99818d30ef32343b25b8060de4e64098306fe5b41e87356d4e0064604`. The board's internal temperature during this run was 32.80 C.

## Solana Devnet Result

Latest smoke result:

- Program: `STmkbEWTmfBJR2mDHrbvKNjo2spT6mPU9668mw2hMaL`
- Proof PDA: `6ksLB6BcShmqnnczNqseTcgY3ZJWjRFTBrsdBnBtq8Un`
- Transaction: [`2rt4XjjPXQybFuVGfqoZLcrFHSjkxL8rPsLqiicYBbGbjCXCHWuJ317U5wk5y7P8Z8EVMSeYJVaVahYfvpAhu7WR`](https://explorer.solana.com/tx/2rt4XjjPXQybFuVGfqoZLcrFHSjkxL8rPsLqiicYBbGbjCXCHWuJ317U5wk5y7P8Z8EVMSeYJVaVahYfvpAhu7WR?cluster=devnet)
- On-chain account length: 189 bytes

This transaction verifies the existing `app_capture` anchor fixture. It does not mean that the unsigned MCU receipt was included in that transaction.

## Irreversible Work Intentionally Deferred

- eFuse HMAC key write
- Secure Boot enablement
- Flash Encryption enablement
- JTAG/download disablement
- Non-exportable RSA-DS key enrollment

These require a separate phase with recovery procedures, key custody, brick recovery, and production signature verification.
