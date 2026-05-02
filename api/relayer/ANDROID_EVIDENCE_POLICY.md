# Android Evidence Level Policy

Argus stores Android evidence inside the committed `deviceIntegrityJson`. The Solana registry still records the production proof as `app_capture`; Android levels describe the device-side evidence that supports that proof.

## Branches

| Device evidence | Relayer result | Meaning |
| --- | --- | --- |
| Native CameraX capture, app identity, motion snapshot | Level 2 | The photo passed the Argus Android native capture path and local file-swap guards. |
| Level 2 plus a valid Android Keystore signature over the proof binding | Level 3 | The image hash, evidence commitments, app identity, session ID, nonce, timestamp, partner, and use case are signed by an app-private Keystore key. |
| Level 3 plus Android Key Attestation chain, trusted root, matching nonce challenge, matching leaf public key, and TEE/StrongBox security levels | Level 4 | The Keystore key is backed by Android hardware attestation accepted by the Argus relayer trust root. |
| Keystore signature valid, but attestation is unsupported, missing, malformed, or root validation is unavailable | Level 3 fallback | The signature is still useful, but the proof must not be displayed as Level 4. |
| Keystore signature unavailable or invalid | Level 2 fallback | The capture evidence remains native Android evidence only. |

## TEE vs StrongBox

The Android SDK may try StrongBox first and fall back to the regular Android Keystore path. The relayer does not trust that request by itself. Level 4 is accepted only when the Android Key Attestation certificate extension reports both:

- `attestationSecurityLevel` as TrustedEnvironment or StrongBox
- `keymasterSecurityLevel` as TrustedEnvironment or StrongBox

The relayer records the validated class as:

- `strongbox` when both attestation and keymaster levels are StrongBox
- `trusted_environment` when the hardware-backed levels are TEE/TrustedEnvironment or mixed TEE/StrongBox

## Fail-Closed Rules

Level 4 claims fail closed when:

- `ARGUS_ANDROID_ATTESTATION_ROOT_SHA256` is unset or malformed
- the certificate chain does not verify
- the root fingerprint is not trusted
- the leaf public key differs from `keystoreSignature.publicKeyPem`
- the attestation challenge does not match the capture session nonce
- the Android Key Attestation extension is absent or malformed
- either security level is Software instead of TEE/StrongBox
- a `supported:false` fallback is submitted while claiming Level 4

Unsupported devices must submit Level 3 or Level 2 fallback evidence explicitly. The relayer accepts those lower levels only when the fallback level and reason match the committed `androidEvidenceLevel`.
