# Argus Threat Model

Argus is a capture-provenance system for user-submitted photo evidence. It helps a platform answer one focused question:

```text
Did this photo pass through the approved Argus in-app Android capture flow and production registration policy?
```

It does not answer whether the real-world claim behind the photo is true.

## Security Claim

For production `app_capture`, Argus verifies that a submitted photo:

- Came through an Argus-controlled native Android capture flow.
- Was bound to device-side evidence, app identity, capture timing, session nonce, partner ID, and use case.
- Was accepted by an authorized production relayer fee payer with sponsored gas.
- Was registered under the production-pinned Argus Registry program ID and trusted registry configuration.
- Matches an offchain proof bundle that the verifier can recompute against the registry record.

Argus does not treat "an image hash exists somewhere on Solana" as verification. A production Verified Capture record requires the Argus manifest, production Argus Registry record, trusted registry configuration, authorized production relayer registration, sponsored gas/fee-payer binding, allowlisted partner ID/use case/app identity hash, and Level 3 or Level 4 verifier-checkable Android signing evidence. Level 2 is native capture evidence for demo or diagnostic flows only.

The current reference use case is `marketplace_listing`. The core threat is broader: an AI-generated, reused, imported, or manipulated file is presented as if it came from a fresh in-app capture.

## Not Claimed

Argus does not prove:

- Physical scene truth.
- Item existence.
- Seller ownership.
- Item authenticity or condition.
- Seller intent.
- Legal validity.
- That the photographer did not photograph another screen.
- Deep JPEG/container semantic validity.
- Identical image decoding across all viewers.
- A universal physical camera sensor signature over image pixels.
- Complete prevention of rooted, emulated, or mock-camera environments.
- OS-level immutability for the temporary Android cache file.

Argus is also not a backend-free trustless oracle. The authorized relayer/backend is a trust boundary that validates bundles before registration. The onchain registry makes accepted commitments externally checkable and tamper-evident afterward.

## MVP Threats And Mitigations

| Threat | MVP mitigation |
| --- | --- |
| Gallery import submitted as fresh capture | Gallery imports do not receive production `app_capture` Verified Capture status. |
| Native capture returns an untrusted path, stale file, symlink, changed file identity, changed path/timestamp/length, or oversized file | Android accepts only the SDK-reserved cache capture file with expected name and timestamp, rejects symlinks, reads under the native-capture byte cap, repeats post-read path/file-identity/timestamp/symlink/length checks, and deletes the created file after proof generation. |
| Oversized manifest, capture session ID, metadata, camera evidence, or device integrity JSON | RN/Kotlin/relayer enforce UTF-8 caps: 4 KiB canonical manifest JSON, 4 KiB capture session ID, 64 KiB metadata JSON, and 64 KiB each for camera/device evidence JSON. The standalone Rust helper still caps optional evidence input at 16 KiB. |
| Direct registry payload with zero optional metadata commitment | Rust registry-payload builder rejects zero optional metadata commitments before hashing/building registry commitments. |
| Evidence photo changed after registration | Verifier hashes submitted photo bytes against `imageHash` and `manifest.image_sha256`, checks decoded base64 byte length against `capturedFileBytes`, and compares manifest and registry commitments. |
| Proof bundle store serves a changed manifest, changed evidence JSON, or changed photo reference after registration | Verifier recomputes photo, manifest, evidence, and proof ID commitments against the Argus Registry record and fails closed on mismatch. |
| Raw sensitive metadata leaked on-chain | Registry stores hashes and commitments only. |
| Malformed, oversized, or ambiguous image container creates viewer mismatch | Relayer and verifier enforce canonical base64, the 20 MiB native-capture photo byte cap, and the basic production JPEG-like structure gate. Unsupported or malformed production inputs should be rejected. |
| User asked to pay blockchain gas | Production registration is sponsored by the authorized relayer. |
| AI detector false confidence | Product claim focuses on capture provenance, not pixel authenticity. |
| Physical camera sensor signature overclaimed | Public docs state that Android camera evidence summaries are evidence, not a sensor signature. |
| Level 3 or Level 4 evidence overclaimed | Level 3 requires verifier-validated Android Keystore signature and signer public key policy. Level 4 requires Android Key Attestation chain validation, leaf public-key binding, session-nonce challenge, TEE/StrongBox security level, and configured trusted attestation root/fingerprint. Unsupported or unverifiable Level 4 falls back to Level 3; Level 2 never becomes a production badge. |
| Missing camera evidence, freshness timing, manifest-matching capture time, motion timing, or Level 3/4 app signing evidence shown as verified | Production `app_capture` policy rejects missing required evidence. |
| Rooted, emulated, or mock-camera environment | Treat as a visible limitation; require stronger attestation policy, optional Play Integrity policy, or manual review before expanding claims. |
| Local/mock/browser/simulator or devnet integration demo mistaken for production verification | UI must label demo states as preview unless the full production trust root is present. |
| Attacker posts an AI image hash to a random Solana account | Verifier requires the production-pinned Argus Registry program ID and registry record schema. |
| Attacker initializes a lookalike registry or relayer list | Verifier/ops trust only the production-pinned Argus Registry program ID and trusted registry configuration initialized by the expected Argus authority. |
| Attacker forks the SDK or calls the Rust proof core directly | Treat output as a local/demo bundle unless the authorized production relayer validates it under partner/use-case/app identity policy and sponsors registration under the production trust root. |
| Attacker runs a self-hosted relayer and claims Argus production status | Verifier rejects unless that relayer fee payer is explicitly authorized in trusted production registry/verifier configuration and sponsored gas/fee-payer binding matches policy. |
| Attacker points users at a fake verifier URL | Relayer returns only allowlisted verifier entrypoints, and verifier policy still checks registry, active record, authorized relayer, sponsored gas, and allowlisted partner/use-case/app identity. |
| Attacker calls Argus Registry directly | `register_proof` must require an authorized production relayer signer, and verifier policy must require sponsored gas/fee-payer binding before any production badge. |
| Attacker fabricates a manifest with fake metadata | Relayer validates session ID, nonce, partner/use-case/app identity tuple, schema, canonical IDs, proof level, photo byte policy, evidence commitments, camera freshness timing, manifest-matching capture time, and motion timing before registration. |
| Attacker replays an old manifest | Nonce/session freshness and proof ID uniqueness fail closed. |
| Relayer key or backend policy is compromised | Monitor registrations, keep auditable logs, rotate authorized relayer keys, revoke or supersede bad records where supported, and treat the incident as a trust-root compromise. |

## Adversarial Verification Model

The verifier should fail closed unless all required checks pass:

```text
1. Was this photo submitted with an Argus manifest?
2. Does the manifest follow the Argus schema?
3. Does canonical photoBytesBase64 decode to submitted photo bytes under the 20 MiB native-capture cap?
4. Do the photo bytes pass the basic production JPEG-like structure gate when required?
5. Do the photo bytes hash to imageHash and manifest.image_sha256?
6. Does decoded base64 byte length match capturedFileBytes?
7. Does canonical manifest hash match manifestHash?
8. Is manifestHash registered in the production-pinned Argus Registry program ID?
9. Was the registry entry created by an authorized production relayer fee payer?
10. Does sponsored gas and fee-payer binding match configured policy?
11. Was the registry configuration initialized by the expected Argus authority?
12. Does the manifest include required camera evidence, device integrity, and app identity commitments?
13. Did the relayer accept the capture session ID, nonce, partner ID, use case, and app identity tuple?
14. Do camera capturedAtMs/freshness timing, capturedFileBytes, motion timing, and explicitly validated optional signatures match the committed proof bundle?
15. Is the registry record active?
16. Is the proof level acceptable for this platform policy?
```

Example attack cases:

```text
Case A: Attacker posts a hash to a normal Solana account.
Result: Not a production Verified Capture record because it is not a production Argus Registry record.

Case B: Attacker calls Argus Registry directly.
Result: register_proof fails because the signer is not an authorized production relayer.

Case C: Attacker submits a fabricated manifest to the relayer.
Result: Relayer rejects missing or invalid session, nonce, partner/use-case/app identity tuple, schema, canonical IDs, proof level, photo byte policy, evidence commitments, camera timing, motion timing, or optional integrity evidence.

Case D: Attacker initializes a lookalike registry or relayer list.
Result: Not trusted because production verification requires the production-pinned Argus Registry program ID and trusted registry configuration.

Case E: Attacker forks the SDK or runs a self-hosted relayer.
Result: May produce compatible-looking artifacts, but production verification fails unless the production verifier trusts the relayer fee payer, registry configuration, sponsored gas binding, partner policy, and matching proof bundle.
```

## Trust Split

```text
Android SDK/native module
  -> accepts only the SDK-reserved cache capture file, reads under the native-capture byte cap, checks path/file-identity/timestamp/symlink/length stability, enforces shared JSON text caps, and collects capture evidence

Kotlin proof builder / Rust core rules
  -> generate canonical manifests and proof IDs; RN/Kotlin/relayer use 64 KiB metadata/evidence caps while the standalone Rust helper keeps a 16 KiB optional evidence cap

Rust registry payload builder
  -> repeats 4 KiB canonical manifest JSON and 4 KiB capture session ID caps, then rejects zero optional metadata commitments before building registry commitments

Partner backend / Argus relayer
  -> validates session, nonce, partner/use-case/app identity tuple, schema, shared JSON caps, canonical photoBytesBase64, photo byte cap, basic JPEG-like structure, image hashes, capturedFileBytes, evidence commitments, sponsored gas/fee-payer binding, and policy

Proof bundle store
  -> serves manifest/evidence/proof data keyed by proofId, but is not trusted unless the verifier recomputes hashes against the registry record

Argus Registry on Solana
  -> publishes authorized Argus commitments and makes accepted records tamper-evident after registration

Verifier app
  -> repeats byte, hash, base64-length, evidence-commitment, registry, authorized-relayer, sponsored-gas, and partner-policy checks
```

Solana is the public commitment layer for Argus-accepted records. It is not the component that directly inspects Android internals or raw photo bytes. The backend/relayer remains the pre-registration gatekeeper; the registry is the post-registration tamper-evidence anchor.

Production storage should be separated:

```text
photo bytes -> platform image or evidence storage, or verifier upload
manifest/evidence bundle -> partner or Argus proof-bundle store keyed by proofId
session/nonce consumed state -> relayer/backend database with short TTL
partner/use-case/app identity policy -> relayer policy configuration or database
commitments -> Argus Registry on Solana
```

The verifier must fail closed if only one component is present. A photo without a manifest, a manifest without matching photo bytes, or an onchain commitment without the production registry, trusted configuration, authorized relayer, sponsored gas, and partner policy is not a production Verified Capture record.

## Future Hardening

Future hardening should focus on Android Keystore key lifecycle, verifier signer-public-key policy, attestation-root rotation and revocation, Play Integrity deployment signals, partner backend policy, revocation, audit logs, and batched Merkle-root registration.

Only add a sensor-signed capture claim if an OEM, TEE, or camera HAL integration explicitly provides verifiable image or capture-result signatures.
