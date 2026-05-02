#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDemoCaptureProof, stableStringify, verifyDemoProof } from "./demoProof.mjs";

const STORAGE_PREFIX = "argus-proof:";
const ARGUS_REGISTRY_PROGRAM_ID = "STmkbEWTmfBJR2mDHrbvKNjo2spT6mPU9668mw2hMaL";
const ARGUS_AUTHORIZED_RELAYER = "Ao3Vi2HeQHWyyPDA52rqVLYv8nt7pvAVQtPB1qw2pvTs";
const ARGUS_LOCAL_DEMO_RELAYER = "ArgusLocalDemoRelayer111111111111111111111111";
const MAX_CANONICAL_MANIFEST_JSON_BYTES = 4 * 1024;
const MAX_EVIDENCE_JSON_BYTES = 16 * 1024;
const MAX_NATIVE_CAPTURE_PHOTO_BYTES = 20 * 1024 * 1024;

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, value);
  },
};

const proof = await createDemoCaptureProof({
  partnerId: "recommerce-demo",
  useCase: "marketplace_listing",
  metadata: {
    condition: "used-excellent",
    listingId: "argus-listing-verifier",
    title: "Verifier security listing",
  },
});

await acceptsCompleteProofBundle();
await rejectsRandomHashRecord();
await rejectsTamperedPhotoBytes();
await rejectsNonCanonicalPhotoBase64();
await rejectsOversizedDemoPhotoBytes();
await rejectsOversizedDemoCanonicalManifest();
await rejectsOversizedDemoEvidenceJson();
await rejectsEditedManifest();
await rejectsUnsupportedDemoManifestSchema();
await rejectsNonPositiveDemoCaptureTimestamp();
await rejectsDemoCapturedAtMismatch();
await rejectsChangedClaimedPartnerId();
await rejectsWrongProofId();
await rejectsMismatchedDemoVerificationUrl();
await rejectsUppercaseDemoProofHexFields();
await rejectsSpoofedRegistryProgram();
await rejectsUnauthorizedRelayer();
await rejectsPromotedDemoRelayerClaim();
await rejectsSponsoredGasClaimInLocalDemoPreview();
await rejectsPromotedDemoCameraStubAsAppCapture();
await rejectsInactiveProofRecord();
await rejectsUnsafeDemoRegisteredAt();
await rejectsCommittedCameraEvidenceWithoutNativeCapture();
await rejectsCommittedDeviceIntegrityAppIdentityMismatch();
await rejectsMetadataEvidenceWithExtraWhitespace();
await rejectsAppCaptureWithoutCommittedMotionEvidence();
await rejectsForgedLocalStorageAppCaptureAsProductionVerified();
await rejectsDeviceAttestedOverclaim();
await rejectsMalformedStoredProofJson();
await scrubsAcceptedLocalPreviewTransactionMetadata();
await scrubsFailedLocalPreviewClaimDiagnostics();

console.log("Verifier proof-bundle security checks passed");

async function acceptsCompleteProofBundle() {
  const result = await verifyDemoProof(proof.proofId);

  assert.equal(result.status, "demo_verified");
  assert.equal(result.manifestHashMatches, true);
  assert.equal(result.imageHashMatches, true);
  assert.equal(result.proofIdMatches, true);
  assert.equal(result.evidenceCommitmentsMatch, true);
  assert.equal(result.proofLevelMatches, true);
  assert.equal(result.proofRecordMatches, true);
  assert.equal(result.registryProgramMatches, true);
  assert.equal(result.authorizedRelayerMatches, false);
  assert.equal(proof.feePayer, ARGUS_LOCAL_DEMO_RELAYER);
  assert.equal(proof.sponsoredGas, false);
}

async function rejectsRandomHashRecord() {
  const proofId = "1".repeat(64);
  storeProof(proofId, {
    proofId,
    manifestHash: "2".repeat(64),
    imageHash: "3".repeat(64),
    registryAddress: ARGUS_REGISTRY_PROGRAM_ID,
    registryProgramId: ARGUS_REGISTRY_PROGRAM_ID,
    relayer: ARGUS_AUTHORIZED_RELAYER,
    proofRecord: {
      proofId,
      manifestHash: "2".repeat(64),
      imageHash: "3".repeat(64),
      partnerIdHash: "4".repeat(64),
      proofLevel: "demo",
      captureTimestamp: 1,
      registeredAt: new Date().toISOString(),
      relayer: ARGUS_AUTHORIZED_RELAYER,
      relayerAuthorized: true,
      registryProgramId: ARGUS_REGISTRY_PROGRAM_ID,
      status: "active",
    },
  });

  const result = await verifyDemoProof(proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.proof, undefined);
  assert.equal(result.manifestHashMatches, false);
  assertNoPartialBundleMatches(result);
}

async function rejectsTamperedPhotoBytes() {
  const tampered = cloneProof(proof);
  tampered.photoBytesBase64 = Buffer.from("tampered image bytes").toString("base64");
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.proof, undefined);
  assert.equal(result.imageHashMatches, false);
}

async function rejectsNonCanonicalPhotoBase64() {
  const tampered = cloneProof(proof);
  tampered.photoBytesBase64 = "YR==";
  rebindProofToManifest(tampered, {
    ...tampered.manifest,
    image_sha256: sha256Hex(Buffer.from("a")),
  });
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.imageHashMatches, false);
}

async function rejectsOversizedDemoPhotoBytes() {
  const tampered = cloneProof(proof);
  const oversizedPhotoBytes = Buffer.alloc(MAX_NATIVE_CAPTURE_PHOTO_BYTES + 1);
  const imageHash = sha256Hex(oversizedPhotoBytes);
  tampered.photoBytesBase64 = oversizedPhotoBytes.toString("base64");
  tampered.imageHash = imageHash;
  rebindProofToManifest(tampered, {
    ...tampered.manifest,
    image_sha256: imageHash,
  });
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.imageHashMatches, false);
}

async function rejectsOversizedDemoCanonicalManifest() {
  const tampered = cloneProof(proof);
  const captureSessionId = "s".repeat(MAX_CANONICAL_MANIFEST_JSON_BYTES);
  rebindProofToManifest(tampered, {
    ...tampered.manifest,
    capture_session_id: captureSessionId,
  });
  tampered.captureSessionId = captureSessionId;
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(
    Buffer.byteLength(tampered.canonicalManifestJson, "utf8") > MAX_CANONICAL_MANIFEST_JSON_BYTES,
    true,
  );
  assert.equal(result.status, "failed");
  assert.equal(result.manifestHashMatches, false);
}

async function rejectsOversizedDemoEvidenceJson() {
  const tampered = cloneProof(proof);
  const cameraEvidence = {
    ...JSON.parse(tampered.cameraEvidenceJson),
    padding: "a".repeat(MAX_EVIDENCE_JSON_BYTES),
  };
  tampered.cameraEvidenceJson = stableStringify(cameraEvidence);
  rebindProofToManifest(tampered, {
    ...tampered.manifest,
    camera_evidence_commitment: sha256Hex(tampered.cameraEvidenceJson),
  });
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(Buffer.byteLength(tampered.cameraEvidenceJson, "utf8") > MAX_EVIDENCE_JSON_BYTES, true);
  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsEditedManifest() {
  const tampered = cloneProof(proof);
  tampered.canonicalManifestJson = tampered.canonicalManifestJson.replace(
    "\"use_case\":\"marketplace_listing\"",
    "\"use_case\":\"insurance_claim\"",
  );
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.manifestHashMatches, false);
}

async function rejectsUnsupportedDemoManifestSchema() {
  const tampered = cloneProof(proof);
  rebindProofToManifest(tampered, {
    ...tampered.manifest,
    schema_version: "argus.manifest.v0",
  });
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.proofLevelMatches, false);
}

async function rejectsNonPositiveDemoCaptureTimestamp() {
  const tampered = cloneProof(proof);
  rebindProofToManifest(tampered, {
    ...tampered.manifest,
    captured_at_ms: 0,
  });
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.proofLevelMatches, false);
}

async function rejectsDemoCapturedAtMismatch() {
  const tampered = cloneProof(proof);
  tampered.capturedAt = new Date(tampered.manifest.captured_at_ms + 1).toISOString();
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsChangedClaimedPartnerId() {
  const tampered = cloneProof(proof);
  tampered.partnerId = "evil-partner";
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.evidenceCommitmentsMatch, false);
}

async function rejectsWrongProofId() {
  const tampered = cloneProof(proof);
  tampered.proofId = "5".repeat(64);
  tampered.proofRecord.proofId = tampered.proofId;
  storeProof(proof.proofId, tampered);

  const result = await verifyDemoProof(proof.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.proofIdMatches, false);
}

async function rejectsMismatchedDemoVerificationUrl() {
  const tampered = cloneProof(proof);
  tampered.verificationUrl = `../verifier-web/index.html?proofId=${"7".repeat(64)}`;
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsUppercaseDemoProofHexFields() {
  const tampered = cloneProof(proof);
  const appIdentityHash = tampered.appIdentityHash.toUpperCase();
  const deviceIntegrity = {
    ...JSON.parse(tampered.deviceIntegrityJson),
    appIdentityHash,
  };
  tampered.deviceIntegrityJson = JSON.stringify(deviceIntegrity);
  const manifest = {
    ...tampered.manifest,
    app_identity_hash: appIdentityHash,
    device_integrity_commitment: sha256Hex(tampered.deviceIntegrityJson),
    nonce: tampered.nonce.toUpperCase(),
  };
  rebindProofToManifest(tampered, manifest);
  tampered.appIdentityHash = appIdentityHash;
  tampered.nonce = manifest.nonce;
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.proofIdMatches, false);
  assert.equal(result.evidenceCommitmentsMatch, false);
}

async function rejectsSpoofedRegistryProgram() {
  const tampered = cloneProof(proof);
  tampered.registryProgramId = "FakeRegistry111111111111111111111111111111111";
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.registryProgramMatches, false);
}

async function rejectsUnauthorizedRelayer() {
  const tampered = cloneProof(proof);
  tampered.proofRecord.relayer = "UnauthorizedRelayer111111111111111111111111";
  tampered.proofRecord.relayerAuthorized = false;
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.authorizedRelayerMatches, false);
}

async function rejectsPromotedDemoRelayerClaim() {
  const tampered = cloneProof(proof);
  tampered.relayer = ARGUS_AUTHORIZED_RELAYER;
  tampered.proofRecord.relayer = ARGUS_AUTHORIZED_RELAYER;
  tampered.proofRecord.relayerAuthorized = true;
  tampered.proofRecord.status = "active";
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsSponsoredGasClaimInLocalDemoPreview() {
  const tampered = cloneProof(proof);
  tampered.feePayer = ARGUS_AUTHORIZED_RELAYER;
  tampered.sponsoredGas = true;
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsPromotedDemoCameraStubAsAppCapture() {
  const tampered = cloneProof(proof);
  tampered.relayer = ARGUS_AUTHORIZED_RELAYER;
  tampered.proofRecord.relayer = ARGUS_AUTHORIZED_RELAYER;
  tampered.proofRecord.relayerAuthorized = true;
  tampered.proofRecord.status = "active";
  rebindProofToManifest(tampered, {
    ...tampered.manifest,
    proof_level: "app_capture",
  });
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsInactiveProofRecord() {
  const tampered = cloneProof(proof);
  tampered.proofRecord.status = "revoked";
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.proofRecordMatches, false);
}

async function rejectsUnsafeDemoRegisteredAt() {
  let tampered = cloneProof(proof);
  tampered.proofRecord.registeredAt = "not-a-date";
  storeProof(tampered.proofId, tampered);

  let result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);

  tampered = cloneProof(proof);
  tampered.proofRecord.registeredAt = new Date(tampered.proofRecord.captureTimestamp - 1).toISOString();
  storeProof(tampered.proofId, tampered);

  result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsCommittedCameraEvidenceWithoutNativeCapture() {
  const tampered = cloneProof(proof);
  tampered.cameraEvidenceJson = JSON.stringify({
    captureSurface: "gallery_picker",
    noGalleryImport: false,
  });
  rebindProofToManifest(tampered, {
    ...tampered.manifest,
    camera_evidence_commitment: sha256Hex(tampered.cameraEvidenceJson),
  });
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsCommittedDeviceIntegrityAppIdentityMismatch() {
  const tampered = cloneProof(proof);
  tampered.deviceIntegrityJson = JSON.stringify({
    ...JSON.parse(tampered.deviceIntegrityJson),
    appIdentityHash: "6".repeat(64),
  });
  rebindProofToManifest(tampered, {
    ...tampered.manifest,
    device_integrity_commitment: sha256Hex(tampered.deviceIntegrityJson),
  });
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsMetadataEvidenceWithExtraWhitespace() {
  const tampered = cloneProof(proof);
  tampered.metadataJson = ` ${tampered.metadataJson}\n`;
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.evidenceCommitmentsMatch, false);
}

async function rejectsAppCaptureWithoutCommittedMotionEvidence() {
  const tampered = cloneProof(proof);
  tampered.deviceIntegrityJson = JSON.stringify({
    appIdentityHash: tampered.appIdentityHash,
    appIdentityHashPresent: true,
  });
  rebindProofToManifest(tampered, {
    ...tampered.manifest,
    device_integrity_commitment: sha256Hex(tampered.deviceIntegrityJson),
    proof_level: "app_capture",
  });
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsForgedLocalStorageAppCaptureAsProductionVerified() {
  const tampered = cloneProof(proof);
  tampered.cameraEvidenceJson = JSON.stringify({
    ...JSON.parse(tampered.cameraEvidenceJson),
    captureSurface: "native_android_camera",
  });
  tampered.relayer = ARGUS_AUTHORIZED_RELAYER;
  tampered.proofRecord.relayer = ARGUS_AUTHORIZED_RELAYER;
  tampered.proofRecord.relayerAuthorized = true;
  tampered.proofRecord.status = "active";
  rebindProofToManifest(tampered, {
    ...tampered.manifest,
    camera_evidence_commitment: sha256Hex(tampered.cameraEvidenceJson),
    proof_level: "app_capture",
  });
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsDeviceAttestedOverclaim() {
  const tampered = cloneProof(proof);
  const manifest = {
    ...tampered.manifest,
    proof_level: "device_attested",
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, tampered.imageHash, tampered.nonce);

  tampered.proofId = proofId;
  tampered.manifest = manifest;
  tampered.manifestHash = manifestHash;
  tampered.canonicalManifestJson = canonicalManifestJson;
  tampered.proofLevel = "device_attested";
  tampered.integrityLevel = "device_attested";
  tampered.proofRecord.proofId = proofId;
  tampered.proofRecord.manifestHash = manifestHash;
  tampered.proofRecord.proofLevel = "device_attested";
  storeProof(proofId, tampered);

  const result = await verifyDemoProof(proofId);

  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsMalformedStoredProofJson() {
  const proofId = "6".repeat(64);
  storage.set(`${STORAGE_PREFIX}${proofId}`, "{");

  const result = await verifyDemoProof(proofId);

  assert.equal(result.status, "missing");
  assertNoPartialBundleMatches(result);
}

async function scrubsAcceptedLocalPreviewTransactionMetadata() {
  let tampered = cloneProof(proof);
  tampered.solanaTx = { claimed: "not-a-transaction-string" };
  storeProof(tampered.proofId, tampered);

  let result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "demo_verified");
  assert.equal(result.proof.solanaTx, undefined);

  tampered = cloneProof(proof);
  tampered.solanaTx = "x".repeat(513);
  storeProof(tampered.proofId, tampered);

  result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "demo_verified");
  assert.equal(result.proof.solanaTx, undefined);

  tampered = cloneProof(proof);
  tampered.solanaTx = `simulated\n${"1".repeat(64)}`;
  storeProof(tampered.proofId, tampered);

  result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "demo_verified");
  assert.equal(result.proof.solanaTx, undefined);
}

async function scrubsFailedLocalPreviewClaimDiagnostics() {
  const tampered = cloneProof(proof);
  tampered.proofRecord.status = "active";
  tampered.solanaTx = "claimed-production-transaction";
  tampered.verificationUrl = `https://verify.argus.dev/proof/${tampered.proofId}`;
  storeProof(tampered.proofId, tampered);

  const result = await verifyDemoProof(tampered.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.proof, undefined);
  assert.equal(result.solanaTx, undefined);
  assert.equal(result.verificationUrl, undefined);
  assert.equal(result.calculatedManifestHash, undefined);
  assert.equal(result.calculatedImageHash, undefined);
  assert.equal(result.registeredManifestHash, undefined);
  assert.equal(result.message, undefined);
  assertNoPartialBundleMatches(result);
}

function storeProof(proofId, proofBundle) {
  storage.set(`${STORAGE_PREFIX}${proofId}`, JSON.stringify(proofBundle));
}

function cloneProof(proofBundle) {
  return JSON.parse(JSON.stringify(proofBundle));
}

function assertNoPartialBundleMatches(result) {
  assert.equal(result.manifestHashMatches, false);
  assert.equal(result.imageHashMatches, false);
  assert.equal(result.proofIdMatches, false);
  assert.equal(result.evidenceCommitmentsMatch, false);
  assert.equal(result.proofLevelMatches, false);
  assert.equal(result.proofRecordMatches, false);
  assert.equal(result.registryProgramMatches, false);
  assert.equal(result.authorizedRelayerMatches, false);
}

function rebindProofToManifest(proofBundle, manifest) {
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, manifest.image_sha256, manifest.nonce);

  proofBundle.proofId = proofId;
  proofBundle.manifest = manifest;
  proofBundle.manifestHash = manifestHash;
  proofBundle.canonicalManifestJson = canonicalManifestJson;
  proofBundle.proofLevel = manifest.proof_level;
  proofBundle.integrityLevel = manifest.proof_level;
  proofBundle.proofRecord.proofId = proofId;
  proofBundle.proofRecord.manifestHash = manifestHash;
  proofBundle.proofRecord.imageHash = manifest.image_sha256;
  proofBundle.proofRecord.partnerIdHash = manifest.partner_id_hash;
  proofBundle.proofRecord.proofLevel = manifest.proof_level;
  proofBundle.proofRecord.captureTimestamp = manifest.captured_at_ms;
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
