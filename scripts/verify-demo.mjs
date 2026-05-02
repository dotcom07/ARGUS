#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { openRelayerCaptureSession } from "../api/relayer/openCaptureSession.mjs";
import { registerProof } from "../api/relayer/registerProof.mjs";
import { authorizeCaptureSession } from "../api/relayer/sessionStore.mjs";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, value);
  },
};

const { createDemoCaptureProof, verifyDemoProof } = await import(
  "../packages/argus-rn-sdk/src/demoProof.mjs"
);

const requiredFiles = [
  "apps/marketplace-demo/src/App.tsx",
  "apps/marketplace-demo/package.json",
  "apps/verifier-web/src/App.tsx",
  "apps/verifier-web/package.json",
  "packages/argus-rn-sdk/src/index.ts",
  "packages/argus-rn-sdk/src/openCaptureSessionWithRelayer.ts",
  "packages/argus-rn-sdk/src/registerProofWithRelayer.ts",
  "packages/argus-rn-sdk/package.json",
  "packages/argus-rn-sdk/android/build.gradle",
  "packages/argus-rn-sdk/android/src/main/AndroidManifest.xml",
  "packages/argus-rn-sdk/android/src/main/java/com/argus/ArgusModule.kt",
  "packages/argus-rn-sdk/android/src/main/java/com/argus/ArgusCameraActivity.kt",
  "packages/argus-rn-sdk/android/src/main/java/com/argus/ArgusPackage.kt",
  "crates/argus-core/Cargo.toml",
  "api/relayer/registerProof.mjs",
  "api/relayer/openCaptureSession.mjs",
  "api/relayer/submitRegisterProof.mjs",
  "programs/argus-registry/src/lib.rs",
  "programs/argus-registry/Anchor.toml",
];

for (const filePath of requiredFiles) {
  assert.equal(existsSync(filePath), true, `${filePath} must exist`);
}

const marketplaceRn = readFileSync("apps/marketplace-demo/src/App.tsx", "utf8");
assert.match(marketplaceRn, /ArgusCamera/);
assert.match(marketplaceRn, /ArgusBadge/);
assert.match(marketplaceRn, /Buy It Now/);
assert.match(marketplaceRn, /or Best Offer/);
assert.match(marketplaceRn, /Capture proof pending/);
assert.doesNotMatch(marketplaceRn, /Verified Capture pending/);
assert.match(marketplaceRn, /Local Demo Preview/);
assert.match(marketplaceRn, /Simulator Preview/);
assert.match(marketplaceRn, /Authorized fee payer \+ sponsored gas/);
assert.match(marketplaceRn, /production relayer \+ pinned registry/);
assert.match(marketplaceRn, /Claimed proof ID/);
assert.match(marketplaceRn, /Claimed manifest hash/);
assert.match(marketplaceRn, /Claimed transaction reference/);
assert.match(marketplaceRn, /Claimed evidence level/);
assert.match(marketplaceRn, /Public key evidence \(Level 3\)/);
assert.match(marketplaceRn, /Trusted device attestation \(Level 4\)/);

const marketplaceWeb = [
  readFileSync("apps/marketplace-demo/index.html", "utf8"),
  readFileSync("apps/marketplace-demo/app.js", "utf8"),
].join("\n");
assert.match(marketplaceWeb, /Local demo preview pending/);
assert.match(marketplaceWeb, /Capture pending/);
assert.match(marketplaceWeb, /Verifier pending/);
assert.doesNotMatch(marketplaceWeb, /Verified Capture pending/);
assert.doesNotMatch(marketplaceWeb, /Local Demo Proof/);
assert.match(marketplaceWeb, /Simulated preview transaction reference/);
assert.doesNotMatch(marketplaceWeb, /Simulated registry tx/);
assert.match(marketplaceWeb, /aria-disabled="true"/);
assert.match(marketplaceWeb, /id="verifierLink" class="verifier-link disabled" aria-disabled="true" tabindex="-1"/);
assert.match(marketplaceWeb, /verifierLink\.removeAttribute\("aria-disabled"\)/);
assert.match(marketplaceWeb, /verifierLink\.removeAttribute\("tabindex"\)/);
assert.match(marketplaceWeb, /getSafeDemoVerificationUrl/);
assert.match(marketplaceWeb, /Verifier unavailable/);
assert.match(marketplaceWeb, /verificationUrl === expectedVerificationUrl/);
assert.match(marketplaceWeb, /Local demo preview only: simulated camera, motion, and app identity commitments/);
assert.match(marketplaceWeb, /Example capture-provenance flow for a marketplace listing photo/);
assert.match(marketplaceWeb, /Preview evidence level/);
assert.match(marketplaceWeb, /Level 1 - Demo preview/);
assert.match(marketplaceWeb, /Public key evidence: not present in local preview/);
assert.match(marketplaceWeb, /Trusted device attestation \(Level 4\): not in local preview/);
assert.match(marketplaceWeb, /Production-pinned registry write: not run in browser demo/);
assert.match(marketplaceWeb, /No authorized production registry write: simulated relayer only/);

const verifierRn = readFileSync("apps/verifier-web/src/App.tsx", "utf8");
assert.match(verifierRn, /VerificationResult/);
assert.match(verifierRn, /verifyProof/);
assert.match(verifierRn, /ARGUS_DEMO_BACKEND_URL/);
assert.match(verifierRn, /transaction reference/);
assert.doesNotMatch(verifierRn, /Solana transaction/);
assert.match(verifierRn, /Argus does not verify/);
assert.match(verifierRn, /Local Demo Preview Bundle Matched/);
assert.match(verifierRn, /production-pinned Argus Registry program/);
assert.match(verifierRn, /trusted registry configuration/);
assert.match(verifierRn, /authorized production relayer/);
assert.match(verifierRn, /Image forensics or AI detection/);
assert.match(verifierRn, /Proof pending/);
assert.match(verifierRn, /Proof not found/);
assert.match(verifierRn, /Proof fields pending/);
assert.match(verifierRn, /Proof fields unavailable/);
assert.match(verifierRn, /emptyProofFieldValue/);
assert.match(verifierRn, /emptyValue/);
assert.match(verifierRn, /No proof bundle was found for this proof ID/);
assert.match(verifierRn, /Unverified proof claims/);
assert.match(verifierRn, /Claimed proof ID/);
assert.match(verifierRn, /Claimed manifest hash/);
assert.match(verifierRn, /Claimed image hash commitment/);
assert.match(verifierRn, /Claimed transaction reference/);
assert.match(verifierRn, /Claimed relayer/);
assert.match(verifierRn, /Claimed evidence level/);
assert.match(verifierRn, /Public key evidence/);
assert.match(verifierRn, /Trusted device attestation \(Level 4\)/);
assert.match(verifierRn, /trusted-root hardware attestation/);
assert.match(verifierRn, /Claimed record status/);
assert.match(verifierRn, /const isDemoPreview = isDemoVerified/);
assert.doesNotMatch(verifierRn, /isProductionVerified \|\| isDemoLikeProof/);

const verifierWeb = [
  readFileSync("apps/verifier-web/index.html", "utf8"),
  readFileSync("apps/verifier-web/app.js", "utf8"),
].join("\n");
assert.match(verifierWeb, /Local Demo Preview Bundle Matched/);
assert.match(verifierWeb, /Local demo preview bundle/);
assert.match(verifierWeb, /production-pinned Argus Registry commitment/);
assert.match(verifierWeb, /authorized production relayer/);
assert.match(verifierWeb, /capture-provenance verification/);
assert.match(verifierWeb, /Ownership, condition, or legal validity/);
assert.match(verifierWeb, /Image forensics or AI detection/);
assert.doesNotMatch(verifierWeb, /marketplace verification/);
assert.doesNotMatch(verifierWeb, /Seller ownership of the item/);
assert.doesNotMatch(verifierWeb, /Checking the local demo proof bundle/);
assert.match(verifierWeb, /Proof pending/);
assert.match(verifierWeb, /Proof not found/);
assert.match(verifierWeb, /Proof fields pending/);
assert.match(verifierWeb, /Proof fields unavailable/);
assert.match(verifierWeb, /No proof claims are displayed/);
assert.match(verifierWeb, /Unverified proof claims/);
assert.match(verifierWeb, /Claimed proof ID/);
assert.match(verifierWeb, /Claimed manifest hash/);
assert.match(verifierWeb, /Claimed image hash commitment/);
assert.match(verifierWeb, /Claimed transaction reference/);
assert.match(verifierWeb, /transaction reference/i);
assert.match(verifierWeb, /Claimed relayer/);
assert.match(verifierWeb, /Claimed evidence level/);
assert.match(verifierWeb, /Public key evidence/);
assert.match(verifierWeb, /Trusted device attestation \(Level 4\)/);
assert.match(verifierWeb, /trusted-root hardware attestation/);
assert.match(verifierWeb, /Claimed record status/);

const verifierFixture = readFileSync("apps/verifier-web/src/data/proof.ts", "utf8");
assert.match(verifierFixture, /demo preview fixture/);
assert.match(verifierFixture, /Demo preview manifest hash/);
assert.match(verifierFixture, /production-pinned known Argus Registry program ID/);
assert.doesNotMatch(verifierFixture, /demo proof/);

const verifierIndex = readFileSync("apps/verifier-web/index.js", "utf8");
assert.match(verifierIndex, /Linking\.getInitialURL/);
assert.match(verifierIndex, /extractProofId/);

const rnSdkIndex = readFileSync("packages/argus-rn-sdk/src/index.ts", "utf8");
assert.match(rnSdkIndex, /ArgusProofSummary/);
assert.match(rnSdkIndex, /openCaptureSessionWithRelayer/);
assert.match(rnSdkIndex, /registerProofWithRelayer/);

const rnSdkBadge = readFileSync("packages/argus-rn-sdk/src/ArgusBadge.tsx", "utf8");
assert.match(rnSdkBadge, /Verified Capture/);
assert.match(rnSdkBadge, /Demo Preview/);
assert.match(rnSdkBadge, /Capture Pending/);
assert.match(rnSdkBadge, /Capture Not Verified/);

const rnSdkProofLink = readFileSync("packages/argus-rn-sdk/src/ArgusProofLink.tsx", "utf8");
assert.match(rnSdkProofLink, /getSafeArgusVerificationUrl/);
assert.match(rnSdkProofLink, /const isDisabled = !safeVerificationUrl \|\| \(!isProductionVerified && !isDemo\);/);
assert.match(rnSdkProofLink, /Verifier pending/);
assert.match(rnSdkProofLink, /Verifier unavailable/);
assert.match(rnSdkProofLink, /Open demo verifier/);

const rnSdkProofSummary = readFileSync("packages/argus-rn-sdk/src/ArgusProofSummary.tsx", "utf8");
assert.match(rnSdkProofSummary, /No capture proof yet/);
assert.match(rnSdkProofSummary, /Local demo preview proof ID/);
assert.match(rnSdkProofSummary, /Preview manifest hash/);
assert.match(rnSdkProofSummary, /Simulated preview transaction reference/);
assert.match(rnSdkProofSummary, /Preview evidence level/);
assert.match(rnSdkProofSummary, /Claimed proof ID/);
assert.match(rnSdkProofSummary, /Claimed manifest hash/);
assert.match(rnSdkProofSummary, /Claimed transaction reference/);
assert.match(rnSdkProofSummary, /Claimed evidence level/);

const rnSdkCreateCaptureProof = readFileSync("packages/argus-rn-sdk/src/createCaptureProof.ts", "utf8");
assert.match(rnSdkCreateCaptureProof, /callNativeGetAppIdentityHash/);
assert.match(rnSdkCreateCaptureProof, /openCaptureSessionWithRelayer/);

const rnSdkCamera = readFileSync("packages/argus-rn-sdk/src/ArgusCamera.tsx", "utf8");
assert.match(rnSdkCamera, /Open Argus camera/);
assert.doesNotMatch(rnSdkCamera, /Take verified photo/);

const relayerSubmit = readFileSync("api/relayer/submitRegisterProof.mjs", "utf8");
assert.match(relayerSubmit, /ARGUS_RELAYER_KEYPAIR/);
assert.match(relayerSubmit, /global:register_proof/);

const anchorToml = readFileSync("programs/argus-registry/Anchor.toml", "utf8");
assert.match(anchorToml, /programs.devnet/);
assert.match(anchorToml, /argus_registry = "[1-9A-HJ-NP-Za-km-z]{32,44}"/);

const androidActivity = readFileSync(
  "packages/argus-rn-sdk/android/src/main/java/com/argus/ArgusCameraActivity.kt",
  "utf8",
);
assert.match(androidActivity, /ProcessCameraProvider/);
assert.match(androidActivity, /ImageCapture/);
assert.match(androidActivity, /gallery import path/);

const androidModule = readFileSync(
  "packages/argus-rn-sdk/android/src/main/java/com/argus/ArgusModule.kt",
  "utf8",
);
assert.match(androidModule, /startActivityForResult/);
assert.match(androidModule, /readBytes/);
assert.match(androidModule, /getAppIdentityHash/);
assert.match(androidModule, /ARGUS_APP_IDENTITY_MISMATCH/);

const androidRustBridge = readFileSync(
  "packages/argus-rn-sdk/android/src/main/java/com/argus/ArgusRustBridge.kt",
  "utf8",
);
assert.match(androidRustBridge, /buildCanonicalManifestJson/);
assert.match(androidRustBridge, /deriveProofId/);
assert.match(androidRustBridge, /canonicalManifestJson/);
assert.match(androidRustBridge, /normalizeNonce/);

const androidEvidence = readFileSync(
  "packages/argus-rn-sdk/android/src/main/java/com/argus/ArgusEvidenceCollector.kt",
  "utf8",
);
assert.match(androidEvidence, /SensorManager/);
assert.match(androidEvidence, /GET_SIGNING_CERTIFICATES/);
assert.match(androidEvidence, /sha256Hex/);

const proof = await createDemoCaptureProof({
  partnerId: "recommerce-demo",
  useCase: "marketplace_listing",
  metadata: {
    listingId: "argus-listing-500cm",
    title: "Hasselblad 500C/M Medium Format Film Camera Kit",
    condition: "used-excellent",
  },
});

assert.equal(proof.integrityLevel, "demo");
assert.match(proof.partnerIdHash, /^[0-9a-f]{64}$/);
assert.equal(proof.deviceEvidenceSummary.cameraMetadata, true);
assert.equal(proof.deviceEvidenceSummary.motionSnapshot, true);
assert.equal(proof.deviceEvidenceSummary.appIdentityHash, true);
assert.match(proof.appIdentityHash, /^[0-9a-f]{64}$/);
assert.equal(proof.manifest.app_identity_hash, proof.appIdentityHash);
assert.equal(proof.feePayer, proof.proofRecord.relayer);
assert.equal(proof.sponsoredGas, false);

const openedSession = openRelayerCaptureSession({
  appIdentityHash: proof.appIdentityHash,
  partnerId: proof.partnerId,
  useCase: proof.useCase,
});
assert.match(openedSession.captureSessionId, /^argus-session-/);
assert.match(openedSession.nonce, /^[0-9a-f]{64}$/);

const verification = await verifyDemoProof(proof.proofId);
assert.equal(verification.status, "demo_verified");
assert.equal(verification.manifestHashMatches, true);
assert.equal(verification.imageHashMatches, true);
assert.equal(verification.proofRecordMatches, true);
assert.equal(verification.registryProgramMatches, true);
assert.equal(verification.authorizedRelayerMatches, false);

authorizeCaptureSession({
  appIdentityHash: proof.appIdentityHash,
  captureSessionId: proof.captureSessionId,
  nonce: proof.nonce,
  partnerId: proof.partnerId,
  useCase: proof.useCase,
});

const relayerProof = promoteToAppCaptureProof(proof);
await assert.rejects(
  () =>
    registerProof({
      proofId: relayerProof.proofId,
      manifestHash: relayerProof.manifestHash,
      imageHash: relayerProof.imageHash,
      partnerIdHash: relayerProof.manifest.partner_id_hash,
      partnerId: relayerProof.partnerId,
      useCase: relayerProof.useCase,
      verifierBaseUrl: "https://verify.argus.dev",
      canonicalManifestJson: relayerProof.canonicalManifestJson,
      metadataJson: relayerProof.metadataJson,
      cameraEvidenceJson: relayerProof.cameraEvidenceJson,
      deviceIntegrityJson: relayerProof.deviceIntegrityJson,
      photoBytesBase64: relayerProof.photoBytesBase64,
      captureSessionId: relayerProof.captureSessionId,
      sessionNonce: relayerProof.nonce,
      appIdentityHash: relayerProof.appIdentityHash,
      proofLevel: relayerProof.proofLevel,
      captureTimestamp: relayerProof.manifest.captured_at_ms,
    }),
  /app_capture requires the Argus native Android camera surface/,
);

assert.equal(proof.proofRecord.relayerAuthorized, false);
assert.equal(proof.proofRecord.status, "superseded");

console.log("Argus demo verification passed");

function promoteToAppCaptureProof(proofBundle) {
  const manifest = {
    ...proofBundle.manifest,
    proof_level: "app_capture",
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, manifest.image_sha256, manifest.nonce);

  return {
    ...proofBundle,
    canonicalManifestJson,
    integrityLevel: "app_capture",
    manifest,
    manifestHash,
    proofId,
    proofLevel: "app_capture",
  };
}

function canonicalManifestStringify(manifest) {
  return [
    "{",
    `"schema_version":${JSON.stringify(manifest.schema_version)},`,
    `"partner_id_hash":${JSON.stringify(manifest.partner_id_hash)},`,
    `"use_case":${JSON.stringify(manifest.use_case)},`,
    `"capture_session_id":${JSON.stringify(manifest.capture_session_id)},`,
    `"captured_at_ms":${manifest.captured_at_ms},`,
    `"image_sha256":${JSON.stringify(manifest.image_sha256)},`,
    `"metadata_commitment":${JSON.stringify(manifest.metadata_commitment)},`,
    `"camera_evidence_commitment":${JSON.stringify(manifest.camera_evidence_commitment)},`,
    `"device_integrity_commitment":${JSON.stringify(manifest.device_integrity_commitment)},`,
    `"app_identity_hash":${JSON.stringify(manifest.app_identity_hash)},`,
    `"nonce":${JSON.stringify(manifest.nonce)},`,
    `"proof_level":${JSON.stringify(manifest.proof_level)}`,
    "}",
  ].join("");
}

function deriveProofId(manifestHash, imageHash, nonce) {
  return sha256Hex(
    Buffer.concat([
      Buffer.from("argus-proof-v1"),
      Buffer.from(manifestHash, "hex"),
      Buffer.from(imageHash, "hex"),
      Buffer.from(nonce, "hex"),
    ]),
  );
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
