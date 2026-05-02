# 09 — Argus V3 Architecture Specification

## Overview

Argus is a B2B Verified Capture SDK and verifier workflow for platforms that need required fresh-capture paths for user-submitted photo evidence.

The current demo and Rust/registry allowlist use `marketplace_listing` because marketplace listings are concrete and judge-friendly. The architecture should remain a horizontal capture-provenance layer: use cases such as insurance claims, returns, rental/real-estate condition media, and field-work evidence should add use-case-specific relayer/verifier policy instead of changing the core proof model.

## Repository Code Style Rule

All coding agents should produce study-friendly code.

```text
- Use simple, explicit syntax unless a framework requires otherwise.
- Avoid clever one-liners, advanced generics, heavy metaprogramming, hidden magic, and unnecessary abstractions.
- Prefer small functions with clear names.
- Add comments to explain what each important function, bridge, instruction, verifier step, and feature block does.
- Use paired comments with `// kr:` first and `// en:` second.
- Comments should teach the purpose of the code, not repeat every line mechanically.
```

Example:

```ts
// kr: verifyProof는 verifier 화면에서 proofId로 등록된 증명을 조회하는 함수입니다.
// en: verifyProof fetches the registered proof by proofId for the verifier page.
async function verifyProof(proofId: string): Promise<VerificationResult> {
  // kr: verifier API는 Argus Registry와 manifest hash를 비교한 결과를 반환합니다.
  // en: The verifier API returns the bundle check result for the manifest, photo bytes, production-pinned registry record, trusted registry configuration, and authorized production relayer.
  return fetchVerificationResult(proofId);
}
```

The V3 architecture uses a layered SDK:

```text
Partner React Native App
  ↓
Argus RN SDK wrapper
  ↓
Kotlin Android Native Module
  ↓
Rust Proof Core
  ↓
Partner/Argus Relayer
  ↓
Argus Registry on Solana
  ↓
Relayer verifier API / Partner Verification API
```

## Why This Architecture

Argus needs three things at the same time:

1. **Partner integration simplicity** — React Native SDK surface.
2. **Android capture credibility** — Kotlin native camera/system integration.
3. **Deterministic proof logic** — Rust core for hashing, manifest construction, and verification.

A pure RN implementation is easy but weaker as a proof infrastructure story. A pure Rust implementation is not realistic for Android camera/system APIs. The correct split is:

```text
RN = integration and UI
Kotlin = Android platform boundary
Rust = proof core
Solana = public registry
```

For the hackathon, build every layer but keep each layer thin. Put the strongest demo signal in the native Android capture flow and device evidence summary; keep the Argus Registry on Solana as a simple commitment registry.

## Physical Camera Boundary

Normal Android apps do not get a universal cryptographic signature from the physical camera sensor over image pixels.

Argus should therefore model Android camera data as device-side evidence:

```text
native Android capture flow
committed camera evidence summary
manifest-matching capturedAtMs/freshness timing
detailed accelerometer/gyroscope motion snapshot near capture
app signing digest
server nonce
Level 3 Keystore signature / Level 4 Android Key Attestation only when verifier/relayer policy validates signature, signer/leaf public-key binding, extension-bound session nonce, TEE/StrongBox security level, certificate-chain evidence, and configured trusted root/fingerprint
```

Do not claim sensor-signed pixels unless an OEM/TEE/camera HAL integration explicitly provides that capability.

## Layer Responsibilities

### React Native SDK

```text
- partner-facing SDK API
- ArgusCamera component
- Verified Capture badge component
- proof result types
- demo app integration
- call Android native module
```

### Kotlin Android Native Module

```text
- native Android capture flow
- Android permissions and lifecycle
- camera evidence summary and freshness timing
- detailed motion sensor snapshot near capture time
- app package/signing certificate hash
- Level 3 Keystore / Level 4 attestation evidence only after verifier/relayer validation policy; Play Integrity remains optional deployment policy
- bridge image bytes and evidence input to Rust
- return proof result to RN
```

### Rust Proof Core

```text
- SHA-256 image hashing
- metadata commitment hashing
- deterministic manifest construction
- canonical manifest serialization
- manifest hash generation
- proof ID generation
- verification helpers
- optional Solana payload helpers
```

### Relayer / Backend

```text
- receive proof registration request
- validate SDK capture session and nonce
- validate partner app identity / signing certificate hash
- validate manifest schema, proof level, photo byte policy, image/manifest hash binding, decoded base64 byte count, and required evidence commitments
- apply partner policy
- sponsor Solana gas only after the full proof bundle passes policy
- submit register_proof transaction as an authorized production relayer for production `app_capture`
- return tx signature and verification URL
```

### Argus Registry on Solana

```text
- reject arbitrary user wallets for verified records
- store manifest hash
- store image hash / commitment
- store partner ID hash
- store proof level
- store registered relayer
- store use case
- store created_at / slot
- no raw images
- no raw GPS
- no raw device identifiers
```

### Relayer-Backed Verifier API / Client

```text
- serve stored proof bundles from `GET /api/proofs/:proofId`
- serve stored proof photo bytes from `GET /api/proofs/:proofId/photo`
- expose registration stages from `GET /api/registrations/:proofId/progress`
- recompute or return recomputed match flags for photo, manifest, evidence, proof record, registry program, and relayer/fee-payer policy
- let RN/client verifier code recompute accepted bundles before displaying production or demo status
- explain proof level and limitation: capture path/provenance, not scene truth
```

## Proof Flow

```text
1. Partner app calls `createCaptureProof` or uses `ArgusCamera`.
2. RN SDK opens Kotlin native camera flow.
3. User takes a verified photo in-app.
4. Kotlin collects image bytes, camera evidence summary/freshness timing, motion snapshot, app signing digest, and any explicitly validated optional integrity evidence.
5. Kotlin uses `ArgusRustBridge.kt` to mirror Rust core canonical rules.
6. The proof builder creates image hash, evidence commitments, manifest, manifest hash, and proof ID.
7. Kotlin/RN sends proof bundle registration request to relayer.
8. Relayer validates the full proof bundle: session nonce, app identity, manifest schema, proof level, photo byte policy, image/manifest hash binding, decoded base64 byte count, and evidence commitments.
9. Authorized production relayer sponsors gas and registers ArgusProofRecord under the production-pinned known Argus Registry program ID.
10. SDK returns ArgusProof to partner app.
11. Partner app displays Verified Capture only after the verifier checks the bundle, production-pinned known Argus Registry program ID, trusted registry configuration, active record, and authorized production relayer.
12. User or reviewer opens a verifier route or API-backed proof view.
```

## Accountable Trust And Storage

Argus should be designed as accountable trust, not a backend-free trustless oracle.

```text
photo bytes -> platform image or evidence storage or verifier upload
manifest/evidence bundle -> partner or Argus proof-bundle store keyed by proofId
session/nonce consumed state -> relayer/backend DB with short TTL
partner/use-case/app identity policy -> relayer policy config or DB
commitments -> Argus Registry on Solana
```

The relayer/backend is the pre-registration gatekeeper. It validates sessions, nonces, partner policy, app identity, evidence, and photo-byte commitments before registration. The Argus Registry on Solana is the post-registration tamper-evidence anchor: it makes accepted commitments public and externally checkable, but it does not inspect Android internals or prove physical scene truth.

The verifier must treat proof-bundle storage as a data source, not a trust root. It should fetch the bundle, recompute photo/manifest/evidence/proof commitments, and compare them with the production-pinned registry record and authorized relayer. If the bundle store later serves edited data, verification must fail.

## Open-Core / Production Access Boundary

Argus can be open-core without making production trust open-ended.

Good candidates for public or source-available code:

```text
- RN SDK integration surface
- Android native capture reference implementation
- manifest schema and canonicalization rules
- Rust proof core
- Argus Registry program
- verifier checks and demo apps
- demo relayer shape
```

Commercial and production-controlled surfaces:

```text
- Argus-authorized hosted relayer access
- partner/use-case/app identity allowlist policy
- production verifier hosting and proof-bundle retrieval
- relayer key management, audit logs, rate limits, abuse monitoring, and support
- enterprise dedicated deployments and compliance reporting
```

A forked SDK or self-hosted relayer can create compatible-looking artifacts, but production verification must require the production-pinned known registry program ID, trusted registry configuration, authorized production relayer fee payer, sponsored gas/fee-payer binding, and allowlisted partner policy.

## Suggested Monorepo

```text
argus/
├── packages/
│   └── argus-rn-sdk/
│       ├── src/
│       │   ├── ArgusCamera.tsx
│       │   ├── ArgusBadge.tsx
│       │   ├── createCaptureProof.ts
│       │   ├── verifyProof.ts
│       │   └── types.ts
│       └── android/
│           ├── src/main/java/com/argus/ArgusModule.kt
│           ├── src/main/java/com/argus/ArgusCameraActivity.kt
│           ├── src/main/java/com/argus/ArgusRustBridge.kt
│           └── src/main/java/com/argus/ArgusEvidenceCollector.kt
├── crates/
│   └── argus-core/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs
│           ├── manifest.rs
│           ├── hashing.rs
│           ├── canonical.rs
│           ├── verification.rs
│           ├── solana_payload.rs
│           └── ffi.rs
├── apps/
│   ├── marketplace-demo/
│   └── shared/
├── programs/
│   └── argus-registry/
├── api/
│   └── relayer/
└── docs/
    ├── ARCHITECTURE.md
    ├── THREAT_MODEL.md
    ├── SDK_INTEGRATION.md
    └── SECURITY_STATEMENT.md
```

## Partner-Facing SDK Example

```tsx
<ArgusCamera
  partnerId="recommerce-demo"
  useCase="marketplace_listing"
  metadata={{ listingId: "listing-001" }}
  onProofCreated={(proof) => {
    setPhoto(proof.imageUri);
    setProof(proof);
  }}
/>
```

## Proof Object

```ts
type ArgusProof = {
  proofId: string;
  manifestHash: string;
  imageHash: string;
  solanaTx?: string;
  registryAddress?: string;
  registryProgramId?: string;
  relayer?: string;
  capturedAt: string;
  partnerId: string;
  useCase: string;
  verificationUrl: string;
  proofLevel: "app_capture" | "demo";
  // Compatibility mirror of proofLevel while older callers migrate.
  integrityLevel: "app_capture" | "demo";
  deviceEvidenceSummary?: {
    cameraMetadata: boolean;
    motionSnapshot: boolean;
    appIdentityHash: boolean;
    keystoreSignature: boolean;
    evidenceLevel?: "level_1_demo" | "level_2_native_capture" | "level_3_keystore_signature" | "level_4_hardware_attestation";
    level3KeystoreSignature?: boolean;
    level4HardwareAttestation?: boolean;
    attestationStatus?: string;
    attestationCertificateChainPem?: string[];
  };
};
```

## Argus Registry Record

The registry account should represent an Argus proof record, not a loose hash:

```ts
type ArgusProofRecord = {
  proofId: string;
  manifestHash: string;
  imageHash: string;
  partnerIdHash: string;
  proofLevel: "app_capture";
  registeredAt: string;
  relayer: string;
  status: "active" | "revoked" | "superseded";
};
```

The verifier must query the production-pinned known Argus Registry program ID and reject records from arbitrary Solana programs or accounts.

## Manifest v1 Draft

This example uses the current demo-supported `marketplace_listing` policy. It should not be read as the only product use case; new use cases require explicit registry/relayer/verifier policy before production support.

```json
{
  "schema_version": "argus.manifest.v1",
  "partner_id_hash": "sha256(partner_id)",
  "use_case": "marketplace_listing",
  "capture_session_id": "uuid-or-random-id",
  "captured_at_ms": 1770000000000,
  "image_sha256": "...",
  "metadata_commitment": "sha256(canonical_metadata_json)",
  "camera_evidence_commitment": "sha256(canonical_camera_evidence_json)",
  "device_integrity_commitment": null,
  "nonce": "32-byte-random",
  "proof_level": "app_capture"
}
```

## Verifier Inputs

```text
photo.jpg
manifest.json
optional evidence bundle / signatures
on-chain ArgusProofRecord
```

The verifier checks the bundle, not only whether an image hash exists onchain.

## Proof Level

The current production Argus Registry and relayer support only `app_capture`. `demo` is a non-production preview label for local/mock/simulator flows and must not be registered or displayed as production Verified Capture.

| Level | Name | Meaning |
|---|---|---|
| 1 | Demo / bundle check | Commitments can recompute in local/browser/simulator preview, but no production badge or production registry trust root is present |
| 2 | Verified Capture (`app_capture`) | Current production path when native capture evidence, nonce/session binding, byte/manifest/evidence commitments, production-pinned registry/config, authorized production relayer fee payer, sponsored gas, and partner/use-case/app identity policy all verify |
| 3 | Keystore-signed binding | Level 2 plus Android Keystore signature over the proof manifest or binding message; verifier validates the signature and signer public key against partner/app policy |
| 4 | Hardware-backed key attestation | Level 3 plus Android Key Attestation certificate-chain validation, leaf public-key binding, extension-bound session nonce challenge, TEE/StrongBox security level, and configured trusted root/fingerprint validation; unsupported, unverifiable, unconfigured-root, or root-unvalidated Level 4 falls back to Level 3 or Level 2 and cannot claim hardware-backed attestation |

Levels 3 and 4 are not camera sensor signatures.

## Gas Model

End users never pay gas.

```text
Partner platform or Argus relayer sponsors transaction fees.
```

For local demos, a demo relayer or transaction script can pay fees, but production `app_capture` requires sponsored gas from an authorized production relayer fee payer under trusted registry configuration.

At scale, Argus can batch proof registrations:

```text
many capture proofs → Merkle root → one Solana transaction → per-proof Merkle inclusion proof
```

## What Argus Verifies

Argus verifies:

```text
The photo came through an Argus-controlled native Android capture flow and, for production `app_capture`, its commitments were registered with sponsored gas by an authorized production relayer fee payer under the production-pinned known Argus Registry program ID and trusted registry configuration.
The manifest may commit to Android camera/device evidence, but Argus still verifies capture path/provenance, not scene truth.
```

Argus does not prove:

```text
The scene is physically true.
The item belongs to the seller.
The claimant is honest.
The photographer did not photograph a screen.
```

## MVP Build Priority

```text
1. Rust core hash + manifest + test vectors
2. Kotlin native camera module with camera evidence summary/freshness timing and motion/app evidence
3. RN SDK wrapper
4. Marketplace demo app
5. Solana register_proof flow
6. Relayer-backed verifier API/client proof view
7. README + architecture + threat model + demo video
8. Roadmap insurance, returns, real-estate/rental, and field-work workflow research/prototypes
```
