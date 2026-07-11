# Argus Security Statement

Argus verifies capture-path provenance, not physical truth.

Argus is a capture-provenance SDK, relayer, registry, and verifier workflow for platforms that need stronger evidence that a submitted photo was captured inside an approved app flow. It is intended for workflows where imported, reused, edited, or AI-generated files may be presented as fresh captures.

The current reference use case is `marketplace_listing`, but the same security boundary can apply to insurance claims, warranty or returns intake, rental and real-estate media, field-work audits, and similar evidence-heavy workflows.

## Security Claim

For production `app_capture`, Argus verifies that:

1. A partner app requested an Argus capture session.
2. Native Android capture produced image bytes from an SDK-reserved cache capture file.
3. The SDK checked expected path, file name, timestamp, symlink state, file identity, length, and native-capture byte cap before proof generation.
4. The SDK committed camera evidence, capture timing, app identity, and near-capture accelerometer/gyroscope evidence into the proof bundle.
5. The Kotlin proof builder produced a deterministic canonical manifest and proof ID using the same rules as the Rust proof core.
6. The authorized relayer validated the session, nonce, partner ID, use case, app identity, schema, photo bytes, evidence commitments, production proof level, sponsored gas, and fee-payer binding before registration.
7. The Argus Registry accepted commitments from an authorized production relayer fee payer under trusted registry configuration.
8. The verifier recomputed the submitted photo hash, manifest hash, proof ID, evidence commitments, production registry record, authorized relayer fee payer, sponsored gas/fee-payer binding, allowlisted partner policy, proof status, and proof level before displaying production Verified Capture.

The Argus Registry stores commitments, not photos or raw sensitive metadata. Argus does not store photos on-chain.

## What Argus Does Not Claim

Argus does not prove:

- Physical scene truth.
- Item existence.
- Seller or claimant ownership.
- Item authenticity or condition.
- Legal validity.
- User intent.
- That the user did not photograph another screen.
- That every image viewer decodes malformed or ambiguous image files identically.
- That a normal Android app can universally prove the physical camera sensor cryptographically signed the image pixels.
- That rooted, emulated, or mock-camera environments are impossible.

The production decision should be limited to badge/status, retake, downgrade, rejection, or manual review. Verified Capture should not be presented as proof that the underlying claim is true.

## Trust Model

Argus is not a backend-free trustless photo oracle. It uses accountable trust:

- The SDK constrains capture and builds deterministic proof material.
- The relayer opens sessions, consumes nonces, enforces partner/use-case/app identity policy, validates the proof bundle, protects the relayer key, and registers only accepted commitments.
- The Argus Registry on Solana makes accepted commitments publicly checkable and tamper-evident after registration.
- The verifier recomputes the offchain bundle and compares it with the registry record.

Solana anchors accepted commitments. It does not directly inspect Android internals, raw photo bytes, or physical scene truth.

Production operation also requires authenticated partner access, rate limiting, durable audit logs, relayer key rotation, revocation or supersession procedures where supported, and proof-bundle retention policy.

## Production Storage

Production storage should separate photo data, proof bundles, session state, partner policy, and public commitments:

```text
photo bytes -> platform image or evidence storage, or verifier-provided upload
manifest/evidence bundle -> partner or Argus proof-bundle store keyed by proofId
session/nonce consumed state -> relayer/backend database with short TTL
partner/use-case/app identity policy -> relayer policy configuration or database
commitments -> Argus Registry on Solana
```

The proof-bundle store is a source of data, not a source of truth. The verifier fetches or receives the offchain photo, manifest, metadata, camera evidence, and device evidence, then recomputes commitments against the production-pinned Argus Registry record. If a backend later serves a different photo or edited manifest/evidence JSON, verification fails because the hashes no longer match the registered commitments.

## Evidence Levels

Evidence levels are verifier policy labels, not truth scores.

| Level | Security claim |
| --- | --- |
| **Level 1 - Demo / bundle check** | Local, browser, simulator, or other preview flow where photo, manifest, and evidence commitments may recompute, but there is no production badge or production registry trust root. |
| **Level 2 - Native capture evidence** | Native Android capture evidence and file-swap guards may verify, but Level 2 is demo/non-production evidence and is never eligible for a production Verified Capture badge because it has no verifier-checkable private-key signature. |
| **Level 3 - Keystore-signed binding** | Production evidence begins here: Level 2 plus an Android Keystore signature over the proof manifest or binding message. The verifier must validate the signature and signer public key against expected partner/app policy before displaying production Verified Capture. |
| **Level 4 - Hardware-backed key attestation** | Level 3 plus Android Key Attestation certificate-chain validation, leaf public-key binding, extension-bound session nonce challenge, TEE/StrongBox security level, and configured trusted attestation root/fingerprint. Unsupported or unverifiable Level 4 falls back to Level 3; it never falls back to a production Level 2 badge. |

Level 3 and Level 4 bind app/device key evidence to the proof policy. They are not camera sensor signatures.

## Physical Camera Boundary

Normal Android apps do not receive a universal cryptographic signature from the physical camera sensor over the image pixels.

For the MVP, CameraX capture-path and timing summaries are platform evidence, not hardware-signed sensor truth. The strongest practical claim is:

```text
native Android capture flow + committed camera evidence summary + manifest-matching capturedAtMs/freshness timing + detailed accelerometer/gyroscope motion snapshot near capture + app signing digest + server nonce + Level 3 Keystore signature / Level 4 Android Key Attestation only when verifier and relayer policy validate signature, signer or leaf public-key binding, extension-bound session nonce, TEE/StrongBox security level, certificate-chain evidence, and configured trusted root/fingerprint
```

Do not claim the physical camera sensor signed the photo unless OEM, TEE, or camera HAL support explicitly provides verifiable image or capture-result signatures.

The Android `app_capture` tier requires the production Argus camera surface (`native_android_camera`), committed camera evidence, `capturedAtMs` matching the manifest, camera evidence collected within the 5-second policy window, detailed accelerometer/gyroscope motion evidence within the 2-second capture policy window, and a committed app signing digest.

Simulator evidence such as `android-native-camera-stub` can support demo preview only. Production policy must reject it for Verified Capture.

Full Camera2 capture-result fields such as ISO, exposure, and focal length are future hardening, not an MVP production claim.

## Byte And Metadata Policy

The verifier and SDK client hash the exact submitted image bytes, enforce the 20 MiB native-capture photo byte cap and basic production JPEG-like structure gate where applicable, confirm `capturedFileBytes` matches the decoded base64 byte length, and compare that hash to the manifest and registry commitments.

The MVP security claim does not include deep JPEG/container semantic validation or a guarantee that every viewer decodes malformed or ambiguous image files identically.

The current RN/Kotlin/relayer path enforces these UTF-8 text caps:

| Input | Cap |
| --- | ---: |
| Canonical manifest JSON | 4 KiB |
| Capture session ID | 4 KiB |
| Metadata JSON | 64 KiB |
| Camera evidence JSON | 64 KiB |
| Device integrity JSON | 64 KiB |

The standalone Rust core helper still caps optional evidence input at 16 KiB. The Rust registry-payload builder repeats the canonical manifest JSON and capture session ID caps and rejects zero optional metadata commitments before hashing and building registry commitments.

## Authorized Registration Boundary

Argus verification is not "any hash on Solana." A production Verified Capture record requires:

- The production-pinned Argus Registry program ID.
- Trusted registry configuration initialized by the expected Argus authority.
- An active Argus Registry record.
- An authorized production relayer fee payer.
- Sponsored gas and fee-payer binding.
- Allowlisted partner ID, use case, and app identity hash.
- A matching proof bundle that the verifier can recompute.

Open-source or source-available SDK code is not a production trust root. A forked SDK, direct Rust proof-core call, or self-hosted relayer can create compatible-looking JSON, but it must not produce production Argus status unless the verifier sees the full production trust root and matching proof bundle.

Verifier links are allowlisted entrypoints only. `verifierBaseUrl` must be trusted by relayer policy and client verifier policy. Loopback verifier bases are local-development only. The entrypoint does not confer Verified Capture by itself; the verifier must still recompute the bundle and check the production registry, authorized relayer, sponsored gas, and partner policy.

`relayerUrl` follows the same boundary. It is trusted partner/client configuration, not a value that end users or arbitrary pages can choose. Production client policy should reject unsafe relayer roots before posting capture bundles.

## Demo And Development States

Local, mock, browser, simulator, and devnet demos are outside the production verification claim unless the full production trust root is present.

These states must be labeled as demo or preview:

- `proofLevel: "demo"`
- `mock://` relayer responses
- localStorage demo records
- `demo_verified` results
- `relayerAuthorized: false`
- `status: "superseded"`
- simulated Android evidence
- simulated transaction references
- devnet-only runs

They can exercise the same UX and verifier checklist, but they must not display a production Verified Capture badge.
