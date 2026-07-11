# Argus Security Implementation Notes

## Board verification

- USB device: Espressif USB JTAG/serial debug unit
- Port: /dev/cu.usbmodem101
- Development firmware: ESP-IDF v6.0.2 built and flashed to `/dev/cu.usbmodem101`
- Boot verification: 8 MB PSRAM, OV3660 camera, bidirectional USB Serial/JTAG console
- Capture verification: 11-13 KB JPEG frames, two receipts, `captureCounter` 1 -> 2
- Receipt boundary: `securityLevel=unsigned_dev_only`, `signatureAlgorithm=none`
- Thermal verification: about 30.8 C at boot and about 30.8 C after the 30-second sample
- Task stability: after the stack fix, `stack_free_words=6980` was observed
- New firmware thermal sample period: 30 seconds
- New firmware thermal guard: delay from 70 C, stop capture from 78 C

The internal temperature sensor is a die-temperature signal for thermal protection, not a calibrated board-surface or enclosure measurement. Validate thresholds separately with an external thermometer or thermocouple.

## Security boundaries

Level 2 binds a CameraX native path, file bytes, timestamp, motion, and app signing digest. It still does not have a verifier-checkable private-key signature, so it is not production Verified Capture.

Level 3 requires an Android Keystore private key to sign the proof binding. Level 4 adds Key Attestation chain validation, challenge binding, TEE/StrongBox security level, trusted roots, and revocation handling at the relayer.

Play Integrity is represented as an opaque token supplied by the app. The relayer sends it to a separate verifier service, which decrypts the Google response and returns a verdict. The relayer compares the decoded nonce with the capture-session nonce and the decoded app identity with the session app identity. A JSON field that merely says verified=true is never trusted.

## Relayer

- Bearer API authentication covers /capture-session and proof routes.
- Per-client rate limits reduce session issuance and registration abuse.
- The durable session store uses an atomic temp-file rename and a directory lock.
- Validation and consumed=true are performed inside one lock section.
- Sessions record issuedAtMs, expiry, and a capture time window.
- A capture timestamp outside that window is rejected.

## MCU receipt

~~~text
receiptDigest =
  SHA-256(
    "argus.xiao.capture.receipt.v1" |
    deviceId | nonce | captureCounter | capturedAtMs |
    imageSha256 | firmwareVersion | firmwareBuild
  )
~~~

The firmware hashes the exact fb->buf bytes with fb->len. It does not decode and re-encode the JPEG. This lets the backend recompute the same image hash from the received bytes.

Development builds explicitly use securityLevel=unsigned_dev_only. The device is not described as signed before DS enrollment.

## ESP32-S3 DS key enrollment

The ESP32-S3 RSA Digital Signature peripheral uses an HMAC eFuse key to unwrap encrypted RSA private-key parameters and sign inside hardware. Software does not read the raw private key.

The reviewed sequence is:

1. Generate Secure Boot and DS RSA material in an offline environment.
2. Prepare the encrypted DS parameter blob.
3. Burn a per-device HMAC key and read-protect it.
4. Store the DS blob and slot metadata in encrypted NVS.
5. Validate Secure Boot v2 and Flash Encryption release mode.
6. Test reboot, wrong firmware, wrong receipt, and power-loss recovery on one device.
7. Only then provision production devices.

firmware/main/key_enrollment.c deliberately does not burn eFuses. It implements the enrollment record and the handoff to the DS peripheral.

## Secure Boot and Flash Encryption

firmware/sdkconfig.defaults is safe development configuration. firmware/sdkconfig.production.defaults is a reviewed production starting point. Selecting production config and burning irreversible eFuses are separate operations.

The irreversible operations are Secure Boot, Flash Encryption release mode, HMAC key read protection, and debug/JTAG changes. They are not automated for the connected board.

## Resume/interview code fragments

### Atomic nonce consumption

See api/relayer/sessionStore.mjs.

~~~js
return withExclusiveStore((state) => {
  const session = state.sessions[captureSessionId];
  if (!session || session.consumed) throw new Error("replay");
  if (captureTimestamp < session.captureWindowStartMs) throw new Error("too early");
  session.consumed = true;
  session.consumedAtMs = nowMs;
  return { ...session };
});
~~~

The explanation is that the read, policy check, and state transition share one lock section. A multi-node deployment can replace this adapter with PostgreSQL conditional update or Redis Lua.

### Level 2 downgrade

See api/relayer/androidEvidencePolicy.mjs.

~~~js
if (level === 2 && isProductionRegistrationRuntime()) {
  throw new Error("Production Verified Capture requires Level 3 or Level 4");
}
~~~

Native capture provenance and cryptographic signer provenance are different claims. Treating Level 2 as a production badge would leave a direct API forgery path.

### RTOS thermal guard

See hardware/xiao-secure-capture/firmware/main/app_main.c. The thermal task samples the internal sensor and publishes EventGroup bits. The capture task consumes those bits and delays or rejects work. This is easier to trace and test than a hidden sleep in the camera function.

## Resume sentence

Built an ESP32-S3 camera capture node with ESP-IDF/FreeRTOS, exact-JPEG SHA-256 receipts, nonce/session binding, and periodic thermal protection. On Android and the relayer, separated native capture evidence from cryptographic trust by excluding Level 2 from production Verified Capture and adding durable atomic sessions, time windows, nonce-bound Play Integrity, and Keystore/Key Attestation policy.

## Not yet verified on the physical device

- Wi-Fi connection and HTTPS upload: the current firmware milestone is intentionally serial-only.
- End-to-end transport of the original JPEG bytes and backend recomputation of `imageSha256`
- DS encrypted-parameter provisioning
- Secure Boot/Flash Encryption eFuse burn
- A real Google Play Integrity verifier service

These remain explicit validation tasks, not implied completion.
