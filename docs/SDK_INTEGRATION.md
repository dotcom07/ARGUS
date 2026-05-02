# Argus SDK Integration

Argus is a capture-provenance SDK for platforms that need device-bound native capture evidence for user-submitted photos. Partner platforms embed the React Native SDK, receive a deterministic proof object, and, for production `app_capture`, submit the proof bundle for sponsored registration by an authorized production relayer fee payer under the production-pinned known Argus Registry program ID, trusted registry configuration, and allowlisted partner ID, use case, and app identity hash.

The current reference demo/use case is `marketplace_listing`. Treat it as one concrete policy example; the Android capture boundary is the same device-bound evidence flow used to reduce AI-generated, reused, imported, or manipulated-file risk in insurance claims, warranty/returns, rental and real-estate media, field-work audits, and other platform workflows.

For any integration, the platform action should be concrete: route eligible photo evidence through Argus capture, submit proof bundles through an authorized production relayer fee payer, show Verified Capture only after an active registry record, sponsored gas/fee-payer binding, production-pinned known Argus Registry program ID, and trusted registry configuration are verified, and require retake, rejection, downgrade, or manual review for demo, unsupported, missing, or failed verification states.

The SDK should treat native Android capture evidence as a strong provenance signal, not as a universal camera-sensor signature. The practical MVP stack is:

```text
native Android capture flow + committed camera evidence summary + manifest-matching capturedAtMs/freshness timing + detailed accelerometer/gyroscope motion snapshot near capture + app signing digest + server nonce + Level 3 Keystore signature / Level 4 Android Key Attestation only when verifier/relayer policy validates signature, signer/leaf public-key binding, extension-bound session nonce, TEE/StrongBox security level, certificate-chain evidence, and configured trusted root/fingerprint
```

Today that camera evidence summary is not a full Camera2 capture result; it commits the native surface, no-gallery flag, camera metadata flag, lens facing, captured file byte count, `capturedAtMs`, `collectedAtMs`, and `captureEvidenceDelayMs`.

Native Android must produce the production photo bytes from an SDK-reserved cache capture file, revalidate the expected path/name/timestamp, reject symlinks, read the file under the native-capture byte cap, and fail proof generation if post-read path, file identity (`fileKey`, with creation time as fallback), timestamp, symlink, or length checks do not still match. These checks narrow simple file-swap/TOCTOU risk; they are not an OS-level guarantee that the captured bytes are immutable outside the SDK process. React Native receives the resulting proof object; it does not supply production `app_capture` photo bytes.

The current RN/Kotlin/relayer path enforces these UTF-8 text caps before accepting metadata/evidence or emitting/registering a proof: 4 KiB canonical manifest JSON, 4 KiB capture session ID, 64 KiB metadata JSON, and 64 KiB each for camera evidence and device integrity JSON. The standalone Rust core crate still caps its optional evidence JSON helper inputs at 16 KiB, while the Android `ArgusRustBridge.kt` mirrors the canonical manifest/proof rules in Kotlin with the 64 KiB evidence cap. The Rust registry-payload builder repeats the canonical manifest JSON and capture session ID caps and rejects zero optional metadata commitments before deriving registry payload commitments.

```ts
import { ArgusCamera, ArgusBadge, configure } from "@argus/rn-sdk";

configure({
  partnerId: "recommerce-demo",
  relayerUrl: "https://relayer.argus.dev",
  verifierBaseUrl: "https://verify.argus.dev",
});
```

```tsx
<ArgusCamera
  partnerId="recommerce-demo"
  useCase="marketplace_listing"
  metadata={{ listingId: "argus-listing-500cm" }}
  onProofCreated={(proof) => setProof(proof)}
  onError={(error) => console.error(error)}
/>
```

```tsx
<ArgusBadge proof={proof} />
```

The partner app receives an `ArgusProof` with `proofId`, `manifestHash`, `imageHash`, optional `solanaTx`, `verificationUrl`, `proofLevel`, compatibility `integrityLevel`, and `deviceEvidenceSummary`.

## SDK Distribution And Production Access

The SDK package can be open-source or source-available so partner developers can inspect the capture flow, manifest schema, evidence commitments, and verifier behavior.

Production access is a separate trust boundary. A production partner must be configured through:

```text
- trusted relayer root
- partner ID / use case / app identity allowlist
- authorized production relayer fee payer
- sponsored gas/fee-payer binding
- production-pinned Argus Registry program ID and trusted registry configuration
- proof-bundle retrieval and verifier recomputation path
```

A forked SDK can call similar APIs and produce local/demo bundles, but it cannot create a production Verified Capture badge unless the authorized relayer and verifier policy accept the bundle under the production trust root.

## Evidence Level Policy

Treat `proofLevel` / `integrityLevel` as verifier policy labels:

| Level | Integration rule |
| --- | --- |
| **Level 1 - Demo / bundle check** | Preview-only flow. Matching local hashes or demo transaction references do not earn the production badge. |
| **Level 2 - Verified Capture (`app_capture`)** | Current production path when native capture evidence, byte/manifest/evidence commitments, nonce/session binding, production-pinned registry/config, authorized production relayer fee payer, sponsored gas, and partner/use-case/app identity policy all verify. |
| **Level 3 - Keystore-signed binding** | Level 2 plus a real Android Keystore signature over the proof manifest or binding message, with verifier validation of the signature and signer public key against partner/app policy. Do not map a bare boolean summary or unvalidated key to Level 3. |
| **Level 4 - Hardware-backed key attestation** | Level 3 plus verifier-validated Android Key Attestation certificate chain, leaf public-key binding, extension-bound session nonce challenge, TEE/StrongBox security level, and configured trusted attestation root/fingerprint. If unsupported, unverifiable, no attestation root fingerprint is configured, or root validation fails, fall back to Level 3 or Level 2 and do not show hardware-backed attestation copy. |

Level 3 and Level 4 are app/device key evidence, not camera sensor signatures or proof that the physical scene is true.

## Proof Bundle Storage

Argus verification needs more than the photo and onchain record. Production integrations should store or serve the offchain proof bundle keyed by `proofId`:

```text
photo bytes or platform image/evidence object key
canonicalManifestJson
metadataJson
cameraEvidenceJson
deviceIntegrityJson
proofRecord / registry reference
```

Recommended storage split:

```text
photo bytes -> platform image or evidence storage or verifier-provided upload
manifest/evidence bundle -> partner or Argus proof-bundle store keyed by proofId
session/nonce consumed state -> relayer/backend DB with short TTL
partner/use-case/app identity policy -> relayer policy config or DB
commitments -> Argus Registry on Solana
```

The current demo uses browser `localStorage` for static preview proof bundles, file-backed HTTP relayer bundles under `.argus-relayer-data/proofs`, and an in-memory relayer session map. A production integration needs durable proof-bundle storage, durable nonce/session/audit storage, authenticated and rate-limited partner access, retention policy, and relayer key rotation/operations.

The proof-bundle store is not the trust root. It is a retrieval layer. The verifier must recompute the photo hash, manifest hash, evidence commitments, proof ID, registry record match, production-pinned registry program ID, trusted registry configuration, authorized production relayer fee payer, and sponsored gas/fee-payer binding. If the backend serves a changed photo, manifest, or evidence bundle later, verification fails against the onchain commitments.

This is the intended pitch boundary: the backend/relayer is the pre-registration gatekeeper, Solana is the public tamper-evidence anchor for accepted commitments, and the verifier recomputes the bundle. Do not claim that Solana directly verifies Android camera evidence.

Commercially, this means the SDK is only the integration surface. Customers pay for production relayer/verifier access, accepted registrations, durable proof-bundle operations, audit logs, fraud/review workflow, enterprise support, and optional dedicated deployments.

Relayer-issued verifier links are allowlisted entrypoints with the route shape `<verifierBaseUrl>/proof/{proofId}`, with no credentials, query, or fragment. Relayer policy caps `verifierBaseUrl` at 2 KiB and rejects traversal after raw slash and backslash-normalized path checks. RN verifier API calls derive `<verifierBaseUrl>/api/proofs/{proofId}` from the same trusted base, and the current relayer also exposes `GET /api/proofs/:proofId/photo` plus `GET /api/registrations/:proofId/progress`. Verifier/client proof IDs and relayer request proof/hash IDs are canonical lowercase non-zero 64-hex strings. The current RN SDK production client trusts the default production verifier origin and loopback development bases; branded verifier bases need matching client trust support in addition to relayer allowlisting. The static browser preview uses local `argus://verify/local-simulator/{proofId}` deep links and localStorage records; do not treat that preview URL shape as the production integration contract.

Treat `relayerUrl` the same way: it is trusted submission configuration, not user-supplied routing. Production clients should submit capture bundles only to trusted relayer roots; loopback relayer roots and aliases are local-development only, and RN client policy should reject unsafe relayer roots before posting bundles.

Partner UI should show a production Verified Capture badge only after the bundle has `proofLevel: "app_capture"` and the verifier can check an active Argus Registry record from an authorized production relayer fee payer, sponsored gas/fee-payer binding, the production-pinned known Argus Registry program ID, and trusted registry configuration. Before that, the UI should say pending capture or pending registration. The production camera surface is `native_android_camera`; `android-native-camera-stub` is only for simulator/demo previews and must not earn the production badge.

Local RN, the static browser preview served by `npm run demo:web-preview`, simulator, and `mock://` flows may use `proofLevel: "demo"`, local demo records, `demo_verified` results, `relayerAuthorized: false`, `status: "superseded"`, or simulated transaction references. Those paths are for previewing integration UX only; partner UI must label them as demo/preview and must not display a production Verified Capture badge.

The canonical manifest and proof ID are generated by native Android/Kotlin before React Native receives the proof object. React Native can display and submit that object; the relayer helper snapshots the proof fields before posting, and a mutation after native proof generation must not become valid: the relayer recomputes the photo hash, manifest hash, proof ID, app identity binding, and evidence commitments before registration.

The verifier and SDK client repeat the submitted-photo-byte policy when evaluating a display bundle: canonical base64, the 20 MiB native-capture photo byte cap, the basic production JPEG-like structure gate for `app_capture`, hash checks against `imageHash` and `manifest.image_sha256`, `capturedFileBytes` matching the decoded base64 byte length, and evidence-commitment checks.

For production `app_capture`, missing native camera evidence summary, manifest-matching `capturedAtMs`, camera freshness timing, detailed accelerometer/gyroscope motion timing, or app signing digest must fail policy. If UI previews an unsupported or demo proof, label it explicitly and do not display it as a normal Verified Capture.

## Registration Boundary

Partner apps should not submit arbitrary hashes directly to Solana or treat a transaction reference as enough for the badge. They submit an Argus proof bundle to the relayer:

```text
photo bytes + canonical manifest + evidence JSON/commitments + SDK session nonce + partner app identity
```

The relayer registers only after it validates:

```text
- capture session ID + nonce + partner ID + use case + app identity hash form a fresh, known authorization tuple
- request proof/hash IDs are canonical lowercase non-zero 64-hex strings
- partner app identity matches the configured partner
- manifest follows the current Argus schema
- canonical manifest, capture session ID, metadata, camera evidence, and device integrity JSON stay within the current RN/Kotlin/relayer text caps: 4 KiB, 4 KiB, 64 KiB, 64 KiB, and 64 KiB respectively; the standalone Rust core helper still has a 16 KiB optional evidence input cap, and the registry-payload builder repeats the canonical manifest JSON and capture session ID caps before deriving registry commitments
- proof level is the supported production `app_capture` level and is allowed for the partner/use case
- canonical `photoBytesBase64` decodes to submitted photo bytes under the 20 MiB native-capture photo byte cap; those bytes pass the basic JPEG-like native-capture structure gate and their SHA-256 matches `imageHash` and `manifest.image_sha256`
- camera evidence uses `native_android_camera`, commits the current camera evidence summary, has `capturedAtMs` matching the manifest, has `capturedFileBytes` matching the decoded base64 byte length, and has `captureEvidenceDelayMs` within the 5-second policy window
- device integrity commits the expected app identity and an accelerometer/gyroscope motion snapshot with finite 3-axis samples whose `sampledAtMs` and `sampleWindowMs` are within the 2-second capture policy window
- Level 3 Keystore evidence is treated as production evidence only when the verifier/relayer validates the signature and signer public key over the proof manifest or binding message; Level 4 additionally requires Android Key Attestation certificate-chain validation, leaf public-key binding, extension challenge matching the session nonce, TEE/StrongBox security level, and a configured trusted attestation root/fingerprint. Unsupported or unverifiable Level 4 falls back to Level 3 or Level 2. Play Integrity remains optional deployment policy.
- sponsored registration fields bind `sponsoredGas` and `feePayer` to the configured relayer policy before the bundle can earn a production badge
```

The verifier later reapplies the same byte cap and basic production JPEG-like structure gate, hashes the submitted photo bytes again, checks the decoded base64 byte length against `capturedFileBytes`, compares the commitments to the manifest and registry record, and checks the production-pinned known Argus Registry program ID, trusted registry configuration, active onchain `ArgusProofRecord`, authorized production relayer fee payer, sponsored gas/fee-payer binding, and allowlisted partner ID, use case, and app identity hash. It should never treat a random onchain image hash or an untrusted registry configuration as production Verified Capture.

The verifier result is a provenance decision. The proof level helps the partner platform decide whether the evidence is strong enough for its workflow policy, but it does not prove physical scene truth, item existence, seller ownership, item authenticity, item condition, legal validity, or user intent.
