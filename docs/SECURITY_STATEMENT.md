# Argus Security Statement

Argus verifies capture-path provenance, not physical truth.

Argus is a capture-provenance SDK and verifier workflow for platforms that need verifier-backed claims about required in-app photo capture, not scene truth.

Argus verifies that a submitted photo came through an Argus-controlled native Android capture flow, was bound to device-side evidence, and, for production `app_capture`, was registered with sponsored gas by an authorized production relayer fee payer under the production-pinned known Argus Registry program ID, trusted registry configuration, and allowlisted partner ID, use case, and app identity hash.

The MVP security boundary is user-submitted photo evidence where a platform can require fresh capture. The current demo can use marketplace listings, but the same boundary applies to insurance claims, warranty/returns, rental and real-estate media, field-work audits, and other workflows where AI-generated, reused, edited, or imported files may be presented as fresh captures.

For MVP production `app_capture`, a valid production Verified Capture record means:

1. The partner app requested an Argus capture session.
2. The native capture flow produced image bytes that pass the basic JPEG-like structure gate from an SDK-reserved cache capture file that Android revalidated, read under the native-capture byte cap, checked for post-read path/file-identity/timestamp/symlink/length stability, and enforced the current RN/Kotlin JSON text caps that the relayer later repeats before registration, plus a committed camera evidence summary with manifest-matching capture time and freshness timing, app identity, and detailed accelerometer/gyroscope motion evidence near capture.
3. The SDK proof builder in `ArgusRustBridge.kt` produced a deterministic manifest using the same canonical manifest/proof-ID rules as the Rust proof core; the current RN/Kotlin/relayer path caps metadata, camera evidence, and device integrity JSON at 64 KiB, while the standalone Rust core helper still caps optional evidence input at 16 KiB. The Rust registry-payload builder also rejects canonical manifest JSON and capture session IDs over 4 KiB, plus zero optional metadata commitments, before hashing/building registry commitments.
4. The relayer validated the capture session ID + nonce + partner/use case/app identity tuple, canonical lowercase non-zero 64-hex request proof/hash IDs, schema, supported production `app_capture` proof level, canonical `photoBytesBase64`, the 20 MiB native-capture photo byte cap, basic JPEG-like native-capture structure, `imageHash`/`manifest.image_sha256` binding, `capturedFileBytes`, evidence commitments, and production evidence shape.
5. The Argus Registry accepted the record from an authorized production relayer fee payer under trusted registry configuration.
6. The Solana record stored commitments only, not the photo or raw sensitive metadata.
7. The verifier and SDK client repeated the submitted-photo-byte policy, canonical manifest, `capturedFileBytes` and evidence-commitment checks, production-pinned known Argus Registry program ID, trusted registry configuration, active Argus Registry record written by an authorized production relayer fee payer, sponsored gas/fee-payer binding, allowlisted partner ID/use case/app identity hash, proof status, proof level, and limitation checks on the display bundle.

Argus does not store photos on-chain. The Argus Registry on Solana stores commitments so Verified Capture records remain externally checkable even when file metadata is stripped, platform records change, or a later verifier cannot trust platform-local metadata alone.

Argus is not a backend-free trustless photo oracle. The Argus backend/relayer is a critical trust boundary: it opens capture sessions, manages nonce consumption, enforces partner/use-case/app identity policy, validates the manifest/evidence/photo bundle, protects the relayer key, and writes only accepted commitments. Production operation also needs rate-limited partner access and relayer key rotation. Solana then anchors those accepted commitments so the proof bundle cannot be silently rewritten after registration.

Production storage should be explicit:

```text
photo bytes -> platform image or evidence storage or verifier-provided upload
manifest/evidence bundle -> partner or Argus proof-bundle store keyed by proofId
session/nonce consumed state -> relayer/backend DB with short TTL
partner/use-case/app identity policy -> relayer policy config or DB
commitments -> Argus Registry on Solana
```

The verifier must treat the proof-bundle store as a source of data, not a source of truth. It fetches or receives the offchain photo, manifest, metadata, camera evidence, and device evidence, then recomputes the commitments against the production-pinned Argus Registry record. If the backend later serves a different photo or edited manifest/evidence JSON, verification fails because the hashes no longer match the onchain commitments.

The correct security framing is accountable trust: SDK and relayer policy decide what may be registered, Solana makes that decision publicly checkable and tamper-evident, and the verifier recomputes the bundle. Do not claim Solana directly proves Android camera truth.

Local/mock/browser/simulator demos are outside the production verification claim. `proofLevel: "demo"`, `mock://` relayer responses, localStorage demo records, `demo_verified` results, `relayerAuthorized: false`, `status: "superseded"`, simulated Android evidence, and simulated transaction references must be labeled as demo artifacts, even when they exercise the same verifier checklist.

Solana/devnet runs are integration demos unless the real Android capture path, required evidence commitments, production-pinned known registry program ID, trusted registry configuration, authorized production relayer fee payer, sponsored gas, and explicitly allowlisted partner ID, use case, and app identity hash are all present.

The verifier and SDK client hash the exact submitted image bytes, enforce the 20 MiB native-capture photo byte cap and basic production JPEG-like structure gate where applicable, confirm `capturedFileBytes` matches the decoded base64 byte length, and compare that hash to the manifest and registry commitments. The MVP security claim does not include deep JPEG/container semantic validation or a guarantee that every viewer decodes malformed or ambiguous image files identically.

For any platform workflow, the operational decision should be limited to badge/status, retake, downgrade, rejection, or manual review. The badge should not be sold as scene truth, item existence, ownership, authenticity, legal validity, or claim validity.

## Evidence Levels

Evidence levels are verifier policy labels, not truth scores. The registry `proofLevel` remains `app_capture` for production registry records; Android evidence levels ride inside the committed device evidence:

| Level | Security claim |
| --- | --- |
| **Level 1 - Demo / bundle check** | Local, browser, simulator, or other preview flow where photo, manifest, and evidence commitments may recompute, but there is no production badge or production registry trust root. |
| **Level 2 - Verified Capture (`app_capture`)** | Current production claim when the full production trust root is present: native Android capture evidence, required device/app/motion commitments, nonce/session binding, exact byte/manifest/evidence commitments, production-pinned registry/config, authorized production relayer fee payer, and sponsored gas/fee-payer binding all verify. |
| **Level 3 - Keystore-signed binding** | Level 2 plus an Android Keystore signature over the proof manifest or binding message. The verifier must validate the signature and signer public key against expected partner/app policy before displaying Level 3. |
| **Level 4 - Hardware-backed key attestation** | Level 3 plus Android Key Attestation certificate-chain validation, leaf public-key binding, extension-bound session nonce challenge, TEE/StrongBox security level, and configured trusted attestation root/fingerprint. Unsupported, unverifiable, unconfigured-root, or root-unvalidated Level 4 falls back to Level 3 or Level 2 and cannot claim hardware-backed attestation. |

Level 3 and Level 4 are not camera sensor signatures. They bind app/device key evidence to the proof policy; they do not mean the camera sensor cryptographically signed the image pixels.

## Physical Camera Boundary

Normal Android apps do not get a universal cryptographic signature from the physical camera sensor over the image pixels.

For the MVP, CameraX capture-path and timing summaries are platform evidence, not hardware-signed sensor truth. The strongest practical claim is:

```text
native Android capture flow + committed camera evidence summary + manifest-matching capturedAtMs/freshness timing + detailed accelerometer/gyroscope motion snapshot near capture + app signing digest + server nonce + Level 3 Keystore signature / Level 4 Android Key Attestation only when verifier/relayer policy validates signature, signer/leaf public-key binding, extension-bound session nonce, TEE/StrongBox security level, certificate-chain evidence, and configured trusted root/fingerprint
```

Do not claim the physical camera sensor signed the photo unless OEM/TEE/camera HAL support is explicitly implemented.

The Android `app_capture` tier requires the production Argus camera surface (`native_android_camera`), a committed camera evidence summary, `capturedAtMs` matching the manifest, camera evidence collected within the 5-second policy window, detailed accelerometer/gyroscope motion evidence within the 2-second capture delta/window, and a committed app signing digest. Simulator evidence such as `android-native-camera-stub` can support a demo preview, but policy must reject it rather than display a production Verified Capture claim.

Full Camera2 capture-result fields such as ISO, exposure, and focal length are future hardening, not an MVP production claim.

Rooted devices, emulators, and mock-camera setups are not completely preventable in the MVP. They must be treated as visible limitations and handled by proof-level policy, validated Level 3/4 evidence where available, optional Play Integrity policy, or manual review.

## Authorized Registration Boundary

Argus verification is not "any hash on Solana." The registry must only mark a record as production Verified Capture when an authorized production relayer fee payer registered it with sponsored gas through the production-pinned known Argus Registry program ID under trusted registry configuration.

Registry initialization and relayer authorization are also security boundaries. Production tooling should trust only the production-pinned known Argus Registry program ID and registry configuration initialized by the Argus program upgrade authority; a lookalike registry, forked program, or relayer list initialized by another authority is not an Argus production trust root.

Open-source or source-available SDK code is not a production trust root. A forked SDK, direct Rust proof-core call, or self-hosted relayer can create compatible-looking JSON, but it must not produce production Argus status unless the verifier sees the production-pinned registry program, trusted registry configuration, authorized production relayer fee payer, sponsored gas/fee-payer binding, allowlisted partner policy, and matching proof bundle.

Verifier links are allowlisted entrypoints only. Their base URL must be allowed by the relayer and by the client verifier trust policy, such as the production default `https://verify.argus.dev`, and relayer policy caps `verifierBaseUrl` at 2 KiB. A branded partner base needs matching relayer and client trust configuration. Loopback verifier bases are local-development only, raw slash and backslash traversal checks must agree before a link is accepted, and that entrypoint does not confer Verified Capture.

Relayer submission roots follow the same boundary. `relayerUrl` is trusted partner/client configuration, not a value that end users or arbitrary pages can choose. Loopback relayer roots and aliases are local-development only; production client policy should reject unsafe relayer roots before posting capture bundles, and production relayer policy should reject loopback aliases for verifier links.

The production relayer/verifier path should reject at the layer that can observe each input:

```text
- hashes stored outside the production-pinned known Argus Registry program ID
- registry configuration not initialized by the Argus program upgrade authority
- registry records signed by unknown wallets
- manifests that do not match the Argus schema
- registration requests or verifier bundles whose image bytes exceed the 20 MiB native-capture photo byte cap, fail the basic production JPEG-like structure gate, or do not match `imageHash` and `manifest.image_sha256`
- manifests with missing or invalid nonce/session/app identity commitments
- camera evidence whose `capturedAtMs` or freshness timing does not match policy
- device integrity evidence without detailed near-capture accelerometer/gyroscope motion samples
- proof level is not supported production `app_capture` or is missing required evidence commitments
```

The proof level is an evidence tier, not a truth score. It must not be presented as proof that an item exists, belongs to the seller, or was not staged.
