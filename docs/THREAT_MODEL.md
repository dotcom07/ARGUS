# Argus Threat Model

## Security Claim

Argus verifies that a submitted photo came through an Argus-controlled native Android capture flow, was bound to device-side evidence, and, for production `app_capture`, was registered by an authorized production relayer fee payer with sponsored gas under the production-pinned known Argus Registry program ID, trusted registry configuration, and allowlisted partner ID, use case, and app identity hash.

Argus is a capture-provenance SDK and verifier workflow. Its MVP claim is a required-capture-path provenance signal, not absolute physical truth.

Argus does not treat "image hash exists somewhere on Solana" as verification. A production Verified Capture record requires an Argus manifest, an Argus Registry record under the production-pinned known Argus Registry program ID, trusted registry configuration, authorized production relayer fee payer registration, sponsored gas/fee-payer binding, and allowlisted partner ID, use case, and app identity hash.

The current demo/use case is `marketplace_listing`, but the core threat is broader: an AI-generated, reused, imported, or manipulated file is presented as if it came from a fresh in-app capture. Marketplace listing photos are one concrete policy example; other evidence-heavy workflows should reuse the same device-bound native capture evidence boundary when they are added.

## Not Claimed

Argus does not prove scene truth, item existence, seller ownership, item authenticity, item condition, seller intent, legal validity, or that the photographer did not photograph another screen.

Argus also does not claim deep JPEG/container semantic validation or identical decoding across all image viewers; the byte policy is canonical base64, a 20 MiB native-capture photo byte cap, and a basic JPEG-like structure gate, and the verifier bundle binds exact submitted image bytes to manifest and registry commitments.

Argus also does not claim that a normal Android app can universally prove the physical camera sensor cryptographically signed the image pixels, or completely prevent rooted, emulated, or mock-camera environments.

Argus also does not claim OS-level immutability for the temporary Android cache file. The MVP checks the expected path/name/timestamp, rejects symlinks, bounds the read, and repeats post-read path/file-identity/timestamp/symlink/length checks before deleting the file.

Argus is also not a backend-free trustless oracle. The authorized relayer/backend is a trust boundary that validates the bundle before registration. The onchain registry makes accepted commitments externally checkable and tamper-evident afterward; it does not remove the need to protect and rotate relayer keys, enforce partner policy and rate limits, protect proof-bundle storage, and keep audit logs.

## MVP Threats

| Threat | MVP mitigation |
| --- | --- |
| Gallery import submitted as fresh capture | Gallery import does not receive `app_capture` Verified Capture status |
| Native capture returns an untrusted path, stale file, symlink, changed file identity, path/timestamp/length-changed file, or oversized file | Android accepts only the SDK-reserved cache capture file with the expected name/timestamp, rejects symlinks, reads it under the native-capture byte cap, requires post-read path/file-identity/timestamp/symlink/length checks to still match, then deletes the created file after proof generation |
| Oversized manifest, capture session ID, metadata, camera evidence, or device integrity JSON | The current RN/Kotlin/relayer path enforces UTF-8 text caps of 4 KiB canonical manifest JSON, 4 KiB capture session ID, 64 KiB metadata JSON, and 64 KiB each for camera/device evidence JSON; the standalone Rust core helper still caps optional evidence input at 16 KiB, and the registry-payload builder repeats the canonical manifest JSON and capture session ID caps before hashing/building registry commitments |
| Direct registry payload with zero optional metadata commitment | Rust registry-payload builder rejects zero optional metadata commitments before hashing/building registry commitments |
| Evidence photo changed after registration | Verifier hashes submitted photo bytes against `imageHash` and `manifest.image_sha256`, checks decoded base64 byte length against `capturedFileBytes`, then compares the manifest and registry commitments |
| Proof bundle store serves a changed manifest, changed evidence JSON, or changed photo reference after registration | Verifier recomputes photo, manifest, evidence, and proof ID commitments against the Argus Registry record and fails closed on mismatch |
| Raw sensitive metadata leaked on-chain | Registry stores hashes/commitments only |
| Malformed, oversized, or ambiguous image container creates viewer mismatch | Relayer and client-side verifier enforce canonical base64, the 20 MiB native-capture photo byte cap, and the basic production JPEG-like structure gate; MVP policy should reject unsupported or malformed image inputs rather than treat JPEG parsing as a truth signal |
| User asked to pay blockchain gas | Relayer sponsors registration |
| AI detector false confidence | Product claim focuses on capture provenance, not pixel authenticity |
| Physical camera sensor signature overclaimed | Documented boundary: Android camera evidence summaries are evidence, not a sensor signature |
| Level 3 or Level 4 evidence overclaimed | Level 3 requires a verifier-validated Android Keystore signature over the proof manifest or binding message with signer public key validation; Level 4 requires Android Key Attestation certificate-chain validation, leaf public-key binding, extension challenge matching the session nonce, TEE/StrongBox security level, and a configured trusted attestation root/fingerprint. Unsupported, unverifiable, unconfigured-root, or root-unvalidated Level 4 falls back to Level 3 or Level 2 and cannot claim hardware-backed attestation. Neither level is a camera sensor signature. |
| Missing camera evidence summary/freshness timing, manifest-matching capture time, accelerometer/gyroscope motion timing, or app signing evidence shown as normal verified capture | Production `app_capture` policy must reject when required evidence is unavailable |
| Rooted, emulated, or mock-camera environment | Visible limitation; require stronger attestation policy before expanding the production claim beyond current `app_capture` |
| Local/mock/browser/simulator or devnet integration demo mistaken for production verified capture | UI and pitch must label `proofLevel: "demo"`, `demo_verified`, `relayerAuthorized: false`, `status: "superseded"`, simulated transaction references, local demo records, and devnet-only runs as non-production unless the full production trust root is present, including the production-pinned known registry program ID and sponsored gas/fee-payer binding |
| Attacker posts an AI image hash to a random Solana account | Verifier requires the production-pinned known Argus Registry program ID and registry record schema |
| Attacker initializes a lookalike registry or relayer list | Verifier/ops trust only the production-pinned known Argus Registry program ID and registry config initialized by the Argus program upgrade authority |
| Attacker forks the open SDK or calls the Rust proof core directly | Treat the output as a local/demo bundle unless the authorized production relayer validates it under partner/use-case/app identity policy and sponsors registration under the production trust root |
| Attacker runs a self-hosted relayer and claims Argus production status | Verifier rejects unless that relayer fee payer is explicitly authorized in trusted production registry/verifier configuration and the sponsored gas/fee-payer binding matches policy |
| Attacker points users at a fake verifier URL | Relayer returns only allowlisted verifier entrypoints, caps `verifierBaseUrl` at 2 KiB, rejects raw slash/backslash traversal, and the verifier must still check the production-pinned known Argus Registry program ID, trusted registry configuration, active record, authorized production relayer fee payer, sponsored gas/fee-payer binding, and allowlisted partner/use-case/app identity tuple |
| Attacker calls Argus Registry directly | `register_proof` must require an authorized production relayer signer, and the verifier must require sponsored gas/fee-payer binding before any production badge |
| Attacker fabricates a manifest with fake metadata | Relayer validates the capture session ID + nonce + partner/use case/app identity tuple, canonical lowercase non-zero 64-hex request proof/hash IDs, schema, proof level, canonical `photoBytesBase64`, the 20 MiB native-capture photo byte cap, basic JPEG-like native-capture structure, `imageHash`/`manifest.image_sha256` binding, `capturedFileBytes`, camera evidence commitments and freshness timing, manifest-matching capture time, and detailed accelerometer/gyroscope motion timing before registration |
| Attacker replays an old manifest | Nonce/session freshness and proof ID uniqueness must fail closed |
| Relayer key or backend policy is compromised | Monitor registrations, keep auditable logs, rotate authorized relayer keys, revoke/supersede bad records where supported, and treat the incident as a trust-root compromise |

## Adversarial Verification Model

The verifier must ask these questions:

```text
1. Was this photo submitted with an Argus manifest?
2. Does the manifest follow the Argus schema?
3. Does canonical photoBytesBase64 decode to submitted photo bytes under the 20 MiB native-capture cap, do those bytes pass the basic production JPEG-like structure gate when required, hash to imageHash and manifest.image_sha256, and have a decoded base64 byte length matching capturedFileBytes?
4. Does the canonical manifest hash match manifestHash?
5. Is manifestHash registered in the production-pinned known Argus Registry program ID?
6. Was the registry entry created by an authorized production relayer fee payer with the expected sponsored gas/fee-payer binding?
7. Was the registry configuration initialized by the Argus program upgrade authority?
8. Does the manifest include camera evidence, device integrity, and app identity commitments?
9. Did the authorized production relayer accept the capture session ID + nonce + partner/use case/app identity tuple, and do camera `capturedAtMs`/freshness timing, `capturedFileBytes`, detailed accelerometer/gyroscope motion timing, and any explicitly validated optional signatures match the committed proof bundle?
10. Is the registry record active, and is the proof level acceptable for this platform policy?
```

Fake cases:

```text
Case A: Attacker posts a hash to a normal Solana account.
Result: Not a production Verified Capture record because it is not a production Argus Registry record.

Case B: Attacker calls Argus Registry directly.
Result: register_proof fails because the signer is not an authorized production relayer.

Case C: Attacker submits a fabricated manifest to the relayer.
Result: relayer rejects missing/invalid capture session ID + nonce + partner/use case/app identity tuple, schema, canonical lowercase non-zero 64-hex request proof/hash IDs, proof level, photo byte policy, evidence commitments, camera freshness timing, manifest-matching capture time, detailed accelerometer/gyroscope motion timing, or optional integrity evidence.

Case D: Attacker initializes a lookalike registry or relayer list.
Result: not trusted because production verification requires the production-pinned known Argus Registry program ID and registry config initialized by the Argus program upgrade authority.

Case E: Attacker forks the SDK or runs a self-hosted relayer.
Result: may produce compatible-looking artifacts, but production verification fails unless the production verifier trusts the relayer fee payer, registry configuration, sponsored gas binding, partner/use-case/app identity policy, and matching proof bundle.
```

## Trust Split

```text
Android SDK/native module -> accepts only the SDK-reserved cache capture file, reads it under the native-capture byte cap with path/file-identity/timestamp/symlink and post-read length stability, enforces shared JSON text caps before proof generation, and collects capture evidence
Kotlin proof builder / Rust core rules -> current Android proof generation mirrors Rust canonical manifest and proof-ID rules; RN/Kotlin/relayer use 64 KiB metadata/evidence caps, while the standalone Rust helper keeps a 16 KiB optional evidence cap
Rust registry payload builder -> repeats 4 KiB canonical manifest JSON plus 4 KiB capture session ID caps and zero optional metadata commitment checks before hashing/building registry commitments
Partner backend / Argus relayer -> validates capture session ID + nonce + partner/use case/app identity tuple, canonical lowercase non-zero 64-hex request proof/hash IDs, schema, shared JSON text caps, canonical photoBytesBase64, 20 MiB native-capture photo byte cap, basic JPEG-like native-capture structure, imageHash/manifest.image_sha256 binding, capturedFileBytes, evidence commitments, sponsored gas/fee-payer binding, and policy
Proof bundle store -> serves manifest/evidence/proof data keyed by proofId, but is not trusted unless the verifier recomputes hashes against the registry record
Argus Registry on Solana -> publishes authorized Argus commitments and makes accepted records tamper-evident after registration
Verifier app -> repeats submitted-photo-byte cap/JPEG-like-structure/hash/base64-byte-count checks and compares evidence commitments and Argus Registry record
```

Solana is the public commitment layer for Argus-accepted records, so verifiers can compare commitments even when platform-local metadata is missing, rewritten, or not trusted. It is not the component that directly inspects Android internals or raw photo bytes. The backend/relayer remains the pre-registration gatekeeper; the registry is the post-registration tamper-evidence anchor.

Production storage should be separated:

```text
photo bytes -> platform image or evidence storage or verifier upload
manifest/evidence bundle -> partner or Argus proof-bundle store keyed by proofId
session/nonce consumed state -> relayer/backend DB with short TTL
partner/use-case/app identity policy -> relayer policy config or DB
commitments -> Argus Registry on Solana
```

The verifier must fail closed if only one component is present. A photo without a manifest, a manifest without matching photo bytes, or an onchain commitment without the production-pinned known Argus Registry program ID, trusted registry configuration, authorized production relayer fee payer, and sponsored gas/fee-payer binding is not a production Verified Capture record.

## Future Hardening

Continue hardening Android Keystore key lifecycle, verifier signer-public-key policy, attestation-root rotation/revocation, Play Integrity deployment signals, partner backend policy, revocation, audit logs, and batched Merkle-root registration. Level 4 certificate-chain, Android Key Attestation extension, nonce challenge, security-level, and configured-root validation are already part of the relayer/verifier trust boundary; future work should operationalize root management rather than weaken fallback behavior.

Only add a sensor-signed capture claim if an OEM/TEE/camera HAL integration explicitly provides verifiable image or capture-result signatures.
