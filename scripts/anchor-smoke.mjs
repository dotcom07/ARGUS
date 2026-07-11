#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { Connection, PublicKey } from "@solana/web3.js";
import { openRelayerCaptureSession } from "../api/relayer/openCaptureSession.mjs";
import { registerProof } from "../api/relayer/registerProof.mjs";

loadEnv();

const PARTNER_ID = "recommerce-demo";
const USE_CASE = "marketplace_listing";
const verifierAllowlist = JSON.parse(process.env.ARGUS_VERIFIER_BASE_URL_ALLOWLIST || "[]");
const VERIFIER_URL = verifierAllowlist[0] || "https://verify.argus.dev";

const policy = JSON.parse(process.env.ARGUS_PARTNER_APP_ALLOWLIST || "[]").find(
  (entry) => entry?.partnerId === PARTNER_ID,
);
const appIdentityHash = policy?.appIdentityHashes?.[0];
assert.match(appIdentityHash || "", /^[0-9a-f]{64}$/i, "partner policy must contain an app identity hash");

const captureSession = openRelayerCaptureSession({
  appIdentityHash,
  partnerId: PARTNER_ID,
  useCase: USE_CASE,
});
const capturedAtMs = Date.now();
const photoBytes = sampleJpegBytes();
const imageHash = sha256Hex(photoBytes);
const metadataJson = stableStringify({
  condition: "anchor-smoke",
  listingId: `anchor-smoke-${capturedAtMs}`,
  listingTitle: "Argus ESP32-S3 anchor smoke",
  source: "hardware-smoke",
});
const cameraEvidenceJson = stableStringify({
  cameraMetadata: true,
  captureEvidenceDelayMs: 250,
  captureSurface: "native_android_camera",
  capturedAtMs,
  capturedFileBytes: photoBytes.length,
  collectedAtMs: capturedAtMs + 250,
  noGalleryImport: true,
});
const deviceIntegrityJson = stableStringify({
  androidEvidenceLevel: 2,
  appIdentityHash,
  appIdentityHashPresent: true,
  attestationCertificateChainPem: [],
  attestationStatus: "level_4_unsupported_fell_back_to_level_2",
  evidenceLevel: "level_2_native_capture",
  hardwareAttestation: {
    fallbackLevel: 2,
    reason: "anchor_smoke_fixture",
    supported: false,
  },
  keystorePublicKeyPem: "",
  keystoreSignature: false,
  level3KeystoreSignature: false,
  level4HardwareAttestation: false,
  motionSnapshot: {
    accelerometer: [0.01, 0.02, 9.81],
    accelerometerAvailable: true,
    available: true,
    gyroscope: [0.001, 0.002, 0.003],
    gyroscopeAvailable: true,
    sampledAtMs: capturedAtMs,
    sampleWindowMs: 180,
  },
});
const manifest = {
  app_identity_hash: appIdentityHash.toLowerCase(),
  camera_evidence_commitment: sha256Hex(cameraEvidenceJson),
  capture_session_id: captureSession.captureSessionId,
  captured_at_ms: capturedAtMs,
  device_integrity_commitment: sha256Hex(deviceIntegrityJson),
  image_sha256: imageHash,
  metadata_commitment: sha256Hex(metadataJson),
  nonce: captureSession.nonce,
  partner_id_hash: sha256Hex(PARTNER_ID),
  proof_level: "app_capture",
  schema_version: "argus.manifest.v1",
  use_case: USE_CASE,
};
const canonicalManifestJson = canonicalManifestStringify(manifest);
const manifestHash = sha256Hex(canonicalManifestJson);
const proofId = deriveProofId(manifestHash, imageHash, captureSession.nonce);

const registration = await registerProof({
  appIdentityHash,
  cameraEvidenceJson,
  canonicalManifestJson,
  captureSessionId: captureSession.captureSessionId,
  captureTimestamp: capturedAtMs,
  deviceIntegrityJson,
  imageHash,
  manifestHash,
  metadataJson,
  partnerId: PARTNER_ID,
  partnerIdHash: manifest.partner_id_hash,
  photoBytesBase64: photoBytes.toString("base64"),
  proofId,
  proofLevel: "app_capture",
  sessionNonce: captureSession.nonce,
  useCase: USE_CASE,
  verifierBaseUrl: VERIFIER_URL,
});

const rpcUrl = process.env.SOLANA_RPC_URL || process.env.ANCHOR_PROVIDER_URL;
const programId = new PublicKey(registration.registryProgramId);
const proofRecord = new PublicKey(registration.proofRecord.address);
const connection = new Connection(rpcUrl, "confirmed");
const account = await connection.getAccountInfo(proofRecord, "confirmed");
assert.ok(account, "proof PDA must exist after register_proof confirmation");
const data = account.data;
assert.equal(data.subarray(8, 40).toString("hex"), proofId);
assert.equal(data.subarray(40, 72).toString("hex"), manifestHash);
assert.equal(data.subarray(72, 104).toString("hex"), imageHash);
assert.equal(data.readBigInt64LE(136), BigInt(capturedAtMs));
assert.equal(new PublicKey(data.subarray(156, 188)).toBase58(), registration.relayer);
assert.equal(data[188], 0);
assert.equal(registration.registryProgramId, programId.toBase58());

console.log(JSON.stringify({
  ok: true,
  proofId,
  manifestHash,
  imageHash,
  solanaTx: registration.solanaTx,
  registryProgramId: registration.registryProgramId,
  proofRecord: proofRecord.toBase58(),
  captureTimestamp: capturedAtMs,
  onChainAccountBytes: data.byteLength,
  explorer: `https://explorer.solana.com/tx/${registration.solanaTx}?cluster=devnet`,
}, null, 2));

function sampleJpegBytes() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
    0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00,
    0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function canonicalManifestStringify(value) {
  return [
    "{",
    `"schema_version":${JSON.stringify(value.schema_version)},`,
    `"partner_id_hash":${JSON.stringify(value.partner_id_hash)},`,
    `"use_case":${JSON.stringify(value.use_case)},`,
    `"capture_session_id":${JSON.stringify(value.capture_session_id)},`,
    `"captured_at_ms":${value.captured_at_ms},`,
    `"image_sha256":${JSON.stringify(value.image_sha256)},`,
    `"metadata_commitment":${JSON.stringify(value.metadata_commitment)},`,
    `"camera_evidence_commitment":${JSON.stringify(value.camera_evidence_commitment)},`,
    `"device_integrity_commitment":${JSON.stringify(value.device_integrity_commitment)},`,
    `"app_identity_hash":${JSON.stringify(value.app_identity_hash)},`,
    `"nonce":${JSON.stringify(value.nonce)},`,
    `"proof_level":${JSON.stringify(value.proof_level)}`,
    "}",
  ].join("");
}

function deriveProofId(manifestHashValue, imageHashValue, nonce) {
  return sha256Hex(Buffer.concat([
    Buffer.from("argus-proof-v1"),
    Buffer.from(manifestHashValue, "hex"),
    Buffer.from(imageHashValue, "hex"),
    Buffer.from(nonce, "hex"),
  ]));
}
