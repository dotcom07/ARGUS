#!/usr/bin/env node
import assert from "node:assert/strict";
import { X509Certificate, createHash, createPublicKey, createSign, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { buildAndroidKeystoreSignedPayloadJson } from "./androidEvidencePolicy.mjs";
import {
  decodeCanonicalPhotoBytes,
  MAX_NATIVE_CAPTURE_PHOTO_BASE64_LENGTH,
  MAX_NATIVE_CAPTURE_PHOTO_BYTES,
} from "./photoBytesPolicy.mjs";
import { registerProof } from "./registerProof.mjs";
import {
  MAX_CANONICAL_MANIFEST_JSON_BYTES,
  MAX_CAPTURE_SESSION_ID_BYTES,
  MAX_EVIDENCE_JSON_BYTES,
} from "./requestTextPolicy.mjs";
import {
  assertSolanaTransactionSignature,
  submitRegisterProof,
} from "./submitRegisterProof.mjs";
import { authorizeCaptureSession, clearCaptureSessions } from "./sessionStore.mjs";

const { createDemoCaptureProof } = await import("../../packages/argus-rn-sdk/src/demoProof.mjs");

const TRUSTED_REGISTRY_PROGRAM_ID = "STmkbEWTmfBJR2mDHrbvKNjo2spT6mPU9668mw2hMaL";
const demoProof = await createDemoCaptureProof({
  partnerId: "recommerce-demo",
  useCase: "marketplace_listing",
  metadata: {
    condition: "used-excellent",
    listingId: "argus-submit-security",
    title: "Submitter security listing",
  },
});
const proof = promoteToAppCaptureProof(demoProof);
const LEVEL4_ATTESTED_PRIVATE_KEY_PEM = [
  "-----BEGIN EC " + "PRIVATE " + "KEY-----",
  "MHcCAQEEIL2fBwEF4e78vpRBY7plkiAqhanQy1tlXcL+8YvOn4QZoAoGCCqGSM49",
  "AwEHoUQDQgAEzFRUpqRjHXD7/BRkRhdoHHW3VyZyiwhoj4FmVG3W7vgnOnCFH7Kw",
  "RwmCtlUelyh1tNbNDL6/F+0ggTEKskeTDQ==",
  "-----END EC " + "PRIVATE " + "KEY-----",
].join("\n");
const LEVEL4_ATTESTATION_CHALLENGE_HEX =
  "65b2ea7ca3507081b4a4090fca6079492b26ffa6728240bdbe1a59fef2c01313";
const LEVEL4_ATTESTATION_CERTIFICATE_PEM = `-----BEGIN CERTIFICATE-----
MIIB7TCCAZOgAwIBAgIUYXVIAwyXt2PtWknQvC8ruRxxAdMwCgYIKoZIzj0EAwIw
KDEmMCQGA1UEAwwdQXJndXMgTGV2ZWw0IFRlc3QgQXR0ZXN0YXRpb24wHhcNMjYw
NTAyMDQxNDU4WhcNMzYwNDI5MDQxNDU4WjAoMSYwJAYDVQQDDB1Bcmd1cyBMZXZl
bDQgVGVzdCBBdHRlc3RhdGlvbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMxU
VKakYx1w+/wUZEYXaBx1t1cmcosIaI+BZlRt1u74JzpwhR+ysEcJgrZVHpcodbTW
zQy+vxftIIExCrJHkw2jgZowgZcwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQU
IubIXBO1JhVJaO0jz/36IQjRYd8wHwYDVR0jBBgwFoAUIubIXBO1JhVJaO0jz/36
IQjRYd8wRAYKKwYBBAHWeQIBEQQ2MDQCAQQKAQECAQQKAQEEIGWy6nyjUHCBtKQJ
D8pgeUkrJv+mcoJAvb4aWf7ywBMTBAAwADAAMAoGCCqGSM49BAMCA0gAMEUCIQCj
fmOgsp3SgH/i9OKqybMWja7xoAKuq9rtsBRhLaKeCAIgdGN6N8sioYeTydMY+2ed
AueuKAp3yP9xVK3suDGjgK8=
-----END CERTIFICATE-----`;
const LEVEL4_NO_ANDROID_EXTENSION_CERTIFICATE_PEM = `-----BEGIN CERTIFICATE-----
MIIBpDCCAUugAwIBAgIUfGr/3xGbx1LqRCwPCP7P+9yBuD4wCgYIKoZIzj0EAwIw
KDEmMCQGA1UEAwwdQXJndXMgTGV2ZWw0IFRlc3QgQXR0ZXN0YXRpb24wHhcNMjYw
NTAyMDM1MzA1WhcNMzYwNDI5MDM1MzA1WjAoMSYwJAYDVQQDDB1Bcmd1cyBMZXZl
bDQgVGVzdCBBdHRlc3RhdGlvbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMxU
VKakYx1w+/wUZEYXaBx1t1cmcosIaI+BZlRt1u74JzpwhR+ysEcJgrZVHpcodbTW
zQy+vxftIIExCrJHkw2jUzBRMB0GA1UdDgQWBBQi5shcE7UmFUlo7SPP/fohCNFh
3zAfBgNVHSMEGDAWgBQi5shcE7UmFUlo7SPP/fohCNFh3zAPBgNVHRMBAf8EBTAD
AQH/MAoGCCqGSM49BAMCA0cAMEQCIB3W+X1AWLDYzYeUZfxpywWyLHFH5pX1cx4B
MoPnPJn9AiA5SJnW8UAakK3TrO0/YpLuKXRj+rp2s6DU0o0rtzn6tQ==
-----END CERTIFICATE-----`;
const PLACEHOLDER_CERTIFICATE_PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256 = certificateSha256(
  LEVEL4_ATTESTATION_CERTIFICATE_PEM,
);
const originalPartnerAllowlist = process.env.ARGUS_PARTNER_APP_ALLOWLIST;

await acceptsPhotoBytesExactlyAtNativeCaptureLimitBeforeSolana();
await rejectsPhotoBytesOneByteOverNativeCaptureLimitBeforeSolana();
await rejectsPhotoBytesWithNonCanonicalTrailingBitsBeforeSolana();
await rejectsPhotoBytesWithNonCanonicalSinglePaddingTrailingBitsBeforeSolana();
await rejectsPhotoBytesWithMalformedJpegSegmentBeforeSolana();
await rejectsPhotoBytesWithMismatchedJpegComponentsBeforeSolana();
await rejectsPhotoBytesWithScanComponentMissingFromFrameBeforeSolana();
await rejectsPhotoBytesWithRedefinedFrameComponentsBeforeSolana();
await rejectsDefaultPartnerPolicyBeforeSolana();
rejectsUnsafeSolanaTransactionSignatureShape();
process.env.ARGUS_PARTNER_APP_ALLOWLIST = JSON.stringify([
  {
    appIdentityHashes: [proof.appIdentityHash],
    partnerId: proof.partnerId,
    useCases: [proof.useCase],
  },
]);
process.env.ARGUS_VERIFIER_BASE_URL_ALLOWLIST = JSON.stringify(["https://verify.argus.dev"]);
process.env.ARGUS_RELAYER_MODE = "demo";

await rejectsProductionRegistryProgramOverrideBeforeSolana();
await rejectsHashOnlyRequestBeforeSolana();
await rejectsManifestHashMismatchBeforeSolana();
await rejectsImageHashMismatchBeforeSolana();
await rejectsProofIdMismatchBeforeSolana();
await rejectsProofIdThatOmitsNonceBeforeSolana();
await rejectsUppercaseProofIdBeforeSolana();
await rejectsDuplicateKeyManifestBeforeSolana();
await rejectsNonFiniteManifestNumberBeforeSolana();
await rejectsFutureCaptureTimestampBeforeSolana();
await rejectsNonCanonicalManifestBeforeSolana();
await rejectsNonCanonicalEvidenceJsonBeforeSolana();
await acceptsKotlinCanonicalEvidenceNumbersBeforeSolana();
await acceptsKotlinCanonicalControlEscapesBeforeSolana();
await acceptsFiniteAndroidSensorNumberLexemesBeforeSolana();
await acceptsFiniteSensorNumberTrailingZerosBeforeSolana();
await rejectsCameraEvidenceDecimalCapturedAtMsBeforeSolana();
await rejectsCameraEvidenceDecimalCollectedAtMsBeforeSolana();
await rejectsCameraEvidenceDecimalCapturedFileBytesBeforeSolana();
await rejectsMotionEvidenceDecimalWindowBeforeSolana();
await rejectsMotionEvidenceDecimalSampledAtBeforeSolana();
await rejectsNonFiniteEvidenceJsonBeforeSolana();
await rejectsEvidenceJsonWithUncommittedPaddingBeforeSolana();
await rejectsOversizedCanonicalManifestJsonBeforeSolana();
await rejectsOversizedMetadataJsonBeforeSolana();
await rejectsOversizedCameraEvidenceJsonBeforeSolana();
await rejectsOversizedDeviceIntegrityJsonBeforeSolana();
await rejectsOversizedCaptureSessionIdBeforeSolana();
await rejectsUnsupportedUseCaseBeforeSolana();
await rejectsUnauthorizedPartnerBeforeSolana();
await rejectsUnauthorizedAppIdentityBeforeSolana();
await passesUppercaseAppIdentityValidationBeforeSolana();
await rejectsDemoProofLevelBeforeSolana();
await rejectsDemoCameraStubForAppCaptureBeforeSolana();
await rejectsDeviceAttestedOverclaimBeforeSolana();
await rejectsEvidenceCommitmentMismatchBeforeSolana();
await rejectsAppCaptureWithoutCameraMetadataBeforeSolana();
await rejectsAppCaptureWithoutCapturedFileBytesBeforeSolana();
await rejectsAppCaptureWithoutPhotoBytesBeforeSolana();
await rejectsAppCaptureWithMismatchedPhotoBytesBeforeSolana();
await consumesSessionAfterPhotoBytesValidationFailureBeforeSolana();
await rejectsAppCaptureWithMismatchedCapturedFileBytesBeforeSolana();
await acceptsLevel3KeystoreEvidenceBeforeSolana();
await acceptsLevel3NativeCanonicalKeystoreEvidenceBeforeSolana();
await acceptsLevel4HardwareAttestationEvidenceBeforeSolana();
await rejectsLevel4WithoutTrustedRootBeforeSolana();
await rejectsLevel4UntrustedRootBeforeSolana();
await rejectsLevel4PlaceholderCertificateChainBeforeSolana();
await rejectsLevel4CertificateWithoutAndroidKeyAttestationExtensionBeforeSolana();
await rejectsLevel4ChallengeSessionMismatchBeforeSolana();
await rejectsLevel4HardwareFallbackPromotionBeforeSolana();
await rejectsAppCaptureWithNonCanonicalPhotoBytesBeforeSolana();
await rejectsAppCaptureWithOversizedPhotoBytesBeforeConsumingSessionBeforeSolana();
await rejectsAppCaptureWithNonJpegPhotoBytesBeforeSolana();
await rejectsAppCaptureWithMalformedJpegSegmentBeforeSolana();
await rejectsAppCaptureWithMotionPresenceFlagOnlyBeforeSolana();
await rejectsAppCaptureWithStaleCameraEvidenceBeforeSolana();
await rejectsAppCaptureWithStaleMotionSnapshotBeforeSolana();
await rejectsAppCaptureWithWideMotionWindowBeforeSolana();
await rejectsUnknownSessionNonceBeforeSolana();
await rejectsExpiredSessionNonceBeforeSolana();
await doesNotConsumeSessionWhenRpcIsMissingBeforeSolana();
await doesNotConsumeSessionWhenRpcUrlIsInvalidBeforeSolana();
await rejectsMismatchedAuthorizedRelayerSignerBeforeSolana();
await rejectsProductionMissingAuthorizedRelayerSignerBeforeSolana();
await rejectsSessionPartnerMismatchBeforeSolana();
await rejectsSessionUseCaseMismatchBeforeSolana();
await rejectsSessionAppIdentityMismatchBeforeSolana();
await rejectsMissingCameraEvidenceBeforeSolana();
await rejectsMissingDeviceIntegrityBeforeSolana();

restoreEnv("ARGUS_PARTNER_APP_ALLOWLIST", originalPartnerAllowlist);

console.log("Low-level registry submitter security checks passed");

async function rejectsDefaultPartnerPolicyBeforeSolana() {
  delete process.env.ARGUS_PARTNER_APP_ALLOWLIST;

  await assert.rejects(
    () => submitRegisterProof(buildRequest(proof)),
    /ARGUS_PARTNER_APP_ALLOWLIST is required outside the demo relayer/,
  );
}

function rejectsUnsafeSolanaTransactionSignatureShape() {
  assert.doesNotThrow(() => assertSolanaTransactionSignature("2".repeat(64)));
  assert.doesNotThrow(() => assertSolanaTransactionSignature("z".repeat(88)));

  for (const unsafeSignature of [
    "",
    "0".repeat(64),
    "O".repeat(64),
    "2".repeat(89),
    "javascript:alert(1)",
    { tx: "not-a-string" },
  ]) {
    assert.throws(
      () => assertSolanaTransactionSignature(unsafeSignature),
      /solanaTx must be a plausible Solana transaction signature/,
    );
  }
}

async function acceptsPhotoBytesExactlyAtNativeCaptureLimitBeforeSolana() {
  const photoBytesBase64 = jpegBytesOfLength(MAX_NATIVE_CAPTURE_PHOTO_BYTES).toString("base64");

  assert.equal(photoBytesBase64.length, MAX_NATIVE_CAPTURE_PHOTO_BASE64_LENGTH);
  assert.equal(
    decodeCanonicalPhotoBytes(
      "photoBytesBase64",
      photoBytesBase64,
      "for registry submission",
    ).byteLength,
    MAX_NATIVE_CAPTURE_PHOTO_BYTES,
  );
}

async function rejectsPhotoBytesOneByteOverNativeCaptureLimitBeforeSolana() {
  const photoBytesBase64 = jpegBytesOfLength(MAX_NATIVE_CAPTURE_PHOTO_BYTES + 1).toString(
    "base64",
  );

  assert.equal(photoBytesBase64.length, MAX_NATIVE_CAPTURE_PHOTO_BASE64_LENGTH);
  assert.equal(
    Buffer.from(photoBytesBase64, "base64").byteLength,
    MAX_NATIVE_CAPTURE_PHOTO_BYTES + 1,
  );
  assert.throws(
    () =>
      decodeCanonicalPhotoBytes(
        "photoBytesBase64",
        photoBytesBase64,
        "for registry submission",
      ),
    /photoBytesBase64 exceeds native capture photo byte limit/,
  );
}

async function rejectsPhotoBytesWithNonCanonicalTrailingBitsBeforeSolana() {
  const photoBytesBase64 = sampleJpegBytes().toString("base64").replace(/Q==$/, "R==");

  assert.throws(
    () =>
      decodeCanonicalPhotoBytes(
        "photoBytesBase64",
        photoBytesBase64,
        "for registry submission",
      ),
    /photoBytesBase64 must be canonical base64/,
  );
}

async function rejectsPhotoBytesWithNonCanonicalSinglePaddingTrailingBitsBeforeSolana() {
  const photoBytesBase64 = jpegBytesOfLength(sampleJpegBytes().byteLength + 1).toString("base64");
  const malformedPhotoBytesBase64 = `${photoBytesBase64.slice(0, -2)}B=`;

  assert.ok(photoBytesBase64.endsWith("="));
  assert.ok(!photoBytesBase64.endsWith("=="));
  assert.throws(
    () =>
      decodeCanonicalPhotoBytes(
        "photoBytesBase64",
        malformedPhotoBytesBase64,
        "for registry submission",
      ),
    /photoBytesBase64 must be canonical base64/,
  );
}

async function rejectsPhotoBytesWithMalformedJpegSegmentBeforeSolana() {
  assert.throws(
    () =>
      decodeCanonicalPhotoBytes(
        "photoBytesBase64",
        malformedSofJpegBytes().toString("base64"),
        "for registry submission",
      ),
    /photoBytesBase64 must pass the native-capture JPEG-like byte policy/,
  );
}

async function rejectsPhotoBytesWithMismatchedJpegComponentsBeforeSolana() {
  assert.throws(
    () =>
      decodeCanonicalPhotoBytes(
        "photoBytesBase64",
        mismatchedComponentJpegBytes().toString("base64"),
        "for registry submission",
      ),
    /photoBytesBase64 must pass the native-capture JPEG-like byte policy/,
  );
}

async function rejectsHashOnlyRequestBeforeSolana() {
  await assert.rejects(
    () =>
      submitRegisterProof({
        proofId: proof.proofId,
        manifestHash: proof.manifestHash,
        imageHash: proof.imageHash,
        partnerId: proof.partnerId,
        partnerIdHash: proof.partnerIdHash,
        proofLevel: proof.proofLevel,
        useCase: proof.useCase,
      }),
    /canonicalManifestJson is required for registry submission/,
  );
}

async function rejectsProductionRegistryProgramOverrideBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  const originalProgramId = process.env.ARGUS_REGISTRY_PROGRAM_ID;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.ARGUS_REGISTRY_PROGRAM_ID = Keypair.generate().publicKey.toBase58();
  process.env.NODE_ENV = "production";

  try {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(proof)),
      /ARGUS_REGISTRY_PROGRAM_ID must match the known Argus Registry program in production/,
    );
  } finally {
    restoreEnv("ARGUS_REGISTRY_PROGRAM_ID", originalProgramId);
    restoreEnv("NODE_ENV", originalNodeEnv);
  }

  const result = await registerProof({
    ...buildRequest(proof),
    verifierBaseUrl: "https://verify.argus.dev",
  });
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsManifestHashMismatchBeforeSolana() {
  await assert.rejects(
    () => submitRegisterProof({ ...buildRequest(proof), manifestHash: "1".repeat(64) }),
    /manifestHash does not match canonicalManifestJson/,
  );
}

async function rejectsImageHashMismatchBeforeSolana() {
  await assert.rejects(
    () => submitRegisterProof({ ...buildRequest(proof), imageHash: "2".repeat(64) }),
    /manifest image_sha256 does not match request/,
  );
}

async function rejectsProofIdMismatchBeforeSolana() {
  await assert.rejects(
    () => submitRegisterProof({ ...buildRequest(proof), proofId: "3".repeat(64) }),
    /proofId does not match canonicalManifestJson/,
  );
}

async function rejectsProofIdThatOmitsNonceBeforeSolana() {
  await assert.rejects(
    () =>
      submitRegisterProof({
        ...buildRequest(proof),
        proofId: deriveProofIdWithoutNonce(proof.manifestHash, proof.imageHash),
      }),
    /proofId does not match canonicalManifestJson/,
  );
}

async function rejectsUppercaseProofIdBeforeSolana() {
  await assert.rejects(
    () => submitRegisterProof({ ...buildRequest(proof), proofId: "A".repeat(64) }),
    /proofId must be a canonical lowercase non-zero 32-byte hex string/,
  );
}

async function rejectsDuplicateKeyManifestBeforeSolana() {
  const canonicalManifestJson = proof.canonicalManifestJson.replace(
    `"proof_level":"app_capture"`,
    `"proof_level":"demo","proof_level":"app_capture"`,
  );
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, proof.imageHash, proof.nonce);

  await assert.rejects(
    () =>
      submitRegisterProof({
        ...buildRequest(proof),
        canonicalManifestJson,
        manifestHash,
        proofId,
      }),
    /canonicalManifestJson is not a canonical Argus manifest/,
  );
}

async function rejectsNonFiniteManifestNumberBeforeSolana() {
  const canonicalManifestJson = proof.canonicalManifestJson.replace(
    `"captured_at_ms":${proof.manifest.captured_at_ms}`,
    `"captured_at_ms":1e999`,
  );
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, proof.imageHash, proof.nonce);

  await assert.rejects(
    () =>
      submitRegisterProof({
        ...buildRequest(proof),
        canonicalManifestJson,
        manifestHash,
        proofId,
      }),
    /canonicalManifestJson is not a canonical Argus manifest/,
  );
}

async function rejectsFutureCaptureTimestampBeforeSolana() {
  clearCaptureSessions();
  const futureProof = rewriteProofCaptureTimestamp(proof, Date.now() + 60_000);
  authorizeProofSession(futureProof);

  await assert.rejects(
    () => submitRegisterProof(buildRequest(futureProof)),
    /manifest captured_at_ms cannot be after relayer receipt time/,
  );

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(futureProof),
        verifierBaseUrl: "https://verify.argus.dev",
      }),
    /capture session was already consumed/,
  );
}

async function rejectsNonCanonicalManifestBeforeSolana() {
  const manifest = {
    ...proof.manifest,
    physical_scene_truth: true,
  };
  const canonicalManifestJson = JSON.stringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, proof.imageHash, proof.nonce);

  await assert.rejects(
    () =>
      submitRegisterProof({
        ...buildRequest(proof),
        canonicalManifestJson,
        manifestHash,
        proofId,
      }),
    /canonicalManifestJson is not a canonical Argus manifest/,
  );
}

async function rejectsNonCanonicalEvidenceJsonBeforeSolana() {
  clearCaptureSessions();
  const cameraEvidenceJson = [
    "{",
    `"captureSurface":"android-native-camera-stub",`,
    `"captureSurface":"native_android_camera",`,
    `"cameraMetadata":true,`,
    `"capturedAtMs":${proof.manifest.captured_at_ms},`,
    `"noGalleryImport":true`,
    "}",
  ].join("");
  const ambiguousProof = rewriteProofEvidence(proof, { cameraEvidenceJson });
  authorizeProofSession(ambiguousProof);

  await assert.rejects(
    () => submitRegisterProof(buildRequest(ambiguousProof)),
    /cameraEvidenceJson must be canonical JSON/,
  );
}

async function acceptsKotlinCanonicalEvidenceNumbersBeforeSolana() {
  const kotlinProof = rewriteProofEvidence(proof, {
    deviceIntegrityJson: buildKotlinNumberDeviceIntegrityJson(proof),
  });
  clearCaptureSessions();
  authorizeProofSession(kotlinProof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(kotlinProof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

async function acceptsKotlinCanonicalControlEscapesBeforeSolana() {
  const kotlinProof = rewriteProofEvidence(proof, {
    metadataJson: "{\"description\":\"line\\b\\f\\n\\r\\tend\"}",
  });
  clearCaptureSessions();
  authorizeProofSession(kotlinProof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(kotlinProof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

async function acceptsFiniteAndroidSensorNumberLexemesBeforeSolana() {
  const androidProof = rewriteProofEvidence(proof, {
    deviceIntegrityJson: buildRawFloatToStringDeviceIntegrityJson(proof),
  });
  clearCaptureSessions();
  authorizeProofSession(androidProof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(androidProof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

async function acceptsFiniteSensorNumberTrailingZerosBeforeSolana() {
  const deviceIntegrityJson = buildKotlinNumberDeviceIntegrityJson(proof).replace("9.81", "9.810");
  const androidProof = rewriteProofEvidence(proof, { deviceIntegrityJson });
  clearCaptureSessions();
  authorizeProofSession(androidProof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(androidProof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

async function rejectsCameraEvidenceDecimalCapturedAtMsBeforeSolana() {
  const cameraEvidenceJson = proof.cameraEvidenceJson.replace(
    `"capturedAtMs":${proof.manifest.captured_at_ms}`,
    `"capturedAtMs":${proof.manifest.captured_at_ms}.0`,
  );
  const weakProof = rewriteProofEvidence(proof, { cameraEvidenceJson });
  clearCaptureSessions();
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => submitRegisterProof(buildRequest(weakProof)),
    /cameraEvidenceJson capturedAtMs must be encoded as a canonical integer/,
  );
}

async function rejectsCameraEvidenceDecimalCollectedAtMsBeforeSolana() {
  const collectedAtMs = proof.manifest.captured_at_ms + 250;
  const cameraEvidenceJson = proof.cameraEvidenceJson.replace(
    `"collectedAtMs":${collectedAtMs}`,
    `"collectedAtMs":${collectedAtMs}.0`,
  );
  const weakProof = rewriteProofEvidence(proof, { cameraEvidenceJson });
  clearCaptureSessions();
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => submitRegisterProof(buildRequest(weakProof)),
    /cameraEvidenceJson collectedAtMs must be encoded as a canonical integer/,
  );
}

async function rejectsCameraEvidenceDecimalCapturedFileBytesBeforeSolana() {
  const capturedFileBytes = decodedByteLength(proof.photoBytesBase64);
  const cameraEvidenceJson = proof.cameraEvidenceJson.replace(
    `"capturedFileBytes":${capturedFileBytes}`,
    `"capturedFileBytes":${capturedFileBytes}.0`,
  );
  const weakProof = rewriteProofEvidence(proof, { cameraEvidenceJson });
  clearCaptureSessions();
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => submitRegisterProof(buildRequest(weakProof)),
    /cameraEvidenceJson capturedFileBytes must be encoded as a canonical integer/,
  );
}

async function rejectsMotionEvidenceDecimalWindowBeforeSolana() {
  const deviceIntegrityJson = proof.deviceIntegrityJson.replace(
    `"sampleWindowMs":180`,
    `"sampleWindowMs":180.0`,
  );
  const weakProof = rewriteProofEvidence(proof, { deviceIntegrityJson });
  clearCaptureSessions();
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => submitRegisterProof(buildRequest(weakProof)),
    /deviceIntegrityJson motionSnapshot.sampleWindowMs must be encoded as a canonical integer/,
  );
}

async function rejectsMotionEvidenceDecimalSampledAtBeforeSolana() {
  const deviceIntegrityJson = proof.deviceIntegrityJson.replace(
    `"sampledAtMs":${proof.manifest.captured_at_ms}`,
    `"sampledAtMs":${proof.manifest.captured_at_ms}.0`,
  );
  const weakProof = rewriteProofEvidence(proof, { deviceIntegrityJson });
  clearCaptureSessions();
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => submitRegisterProof(buildRequest(weakProof)),
    /deviceIntegrityJson motionSnapshot.sampledAtMs must be encoded as a canonical integer/,
  );
}

async function rejectsNonFiniteEvidenceJsonBeforeSolana() {
  clearCaptureSessions();
  const deviceIntegrityJson = proof.deviceIntegrityJson.replace("0.01", "1e999");
  const weakProof = rewriteProofEvidence(proof, { deviceIntegrityJson });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => submitRegisterProof(buildRequest(weakProof)),
    /deviceIntegrityJson must be canonical JSON/,
  );
}

async function rejectsEvidenceJsonWithUncommittedPaddingBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      submitRegisterProof({
        ...buildRequest(proof),
        cameraEvidenceJson: `\n${proof.cameraEvidenceJson}\n`,
      }),
    /cameraEvidenceJson does not match manifest commitment/,
  );
}

async function rejectsOversizedCanonicalManifestJsonBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () =>
        submitRegisterProof({
          ...buildRequest(proof),
          canonicalManifestJson: oversizedCanonicalManifestJson(),
        }),
      /canonicalManifestJson exceeds relayer JSON text limit/,
    );

    await assert.rejects(
      () => submitRegisterProof(buildRequest(proof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

async function rejectsOversizedMetadataJsonBeforeSolana() {
  clearCaptureSessions();
  const oversizedProof = rewriteProofEvidence(proof, {
    metadataJson: oversizedMetadataJson(),
  });
  authorizeProofSession(oversizedProof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(oversizedProof)),
      /metadataJson exceeds relayer JSON text limit/,
    );

    await assert.rejects(
      () => submitRegisterProof(buildRequest(proof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

async function rejectsOversizedCameraEvidenceJsonBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () =>
        submitRegisterProof({
          ...buildRequest(proof),
          cameraEvidenceJson: oversizedEvidenceJson(),
        }),
      /cameraEvidenceJson exceeds relayer JSON text limit/,
    );

    await assert.rejects(
      () => submitRegisterProof(buildRequest(proof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

async function rejectsOversizedDeviceIntegrityJsonBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () =>
        submitRegisterProof({
          ...buildRequest(proof),
          deviceIntegrityJson: oversizedEvidenceJson(),
        }),
      /deviceIntegrityJson exceeds relayer JSON text limit/,
    );

    await assert.rejects(
      () => submitRegisterProof(buildRequest(proof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

async function rejectsOversizedCaptureSessionIdBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () =>
        submitRegisterProof({
          ...buildRequest(proof),
          captureSessionId: oversizedCaptureSessionId(),
        }),
      /captureSessionId exceeds relayer JSON text limit/,
    );

    await assert.rejects(
      () => submitRegisterProof(buildRequest(proof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

async function rejectsUnsupportedUseCaseBeforeSolana() {
  const request = buildRequestWithManifestPatch(proof, { use_case: "insurance_claim" }, {
    useCase: "insurance_claim",
  });

  await assert.rejects(
    () => submitRegisterProof(request),
    /useCase is not supported by the registry submitter/,
  );
}

async function rejectsUnauthorizedPartnerBeforeSolana() {
  await assert.rejects(
    () =>
      submitRegisterProof({
        ...buildRequest(proof),
        partnerId: "attacker-partner",
        partnerIdHash: sha256Hex("attacker-partner"),
      }),
    /partnerId is not authorized by this relayer/,
  );
}

async function rejectsUnauthorizedAppIdentityBeforeSolana() {
  await assert.rejects(
    () => submitRegisterProof({ ...buildRequest(proof), appIdentityHash: "5".repeat(64) }),
    /appIdentityHash is not authorized for partnerId/,
  );
}

async function passesUppercaseAppIdentityValidationBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () =>
        submitRegisterProof({
          ...buildRequest(proof),
          appIdentityHash: proof.appIdentityHash.toUpperCase(),
        }),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

async function rejectsDemoProofLevelBeforeSolana() {
  await assert.rejects(
    () => submitRegisterProof(buildRequest(demoProof)),
    /proofLevel is not supported by the registry submitter/,
  );
}

async function rejectsDemoCameraStubForAppCaptureBeforeSolana() {
  const stubProof = promoteToAppCaptureProof(demoProof, { allowDemoCameraStub: true });
  clearCaptureSessions();
  authorizeProofSession(stubProof);

  await assert.rejects(
    () => submitRegisterProof(buildRequest(stubProof)),
    /app_capture requires the Argus native Android camera surface/,
  );
}

async function rejectsDeviceAttestedOverclaimBeforeSolana() {
  const request = buildRequestWithManifestPatch(proof, { proof_level: "device_attested" }, {
    proofLevel: "device_attested",
  });

  await assert.rejects(
    () => submitRegisterProof(request),
    /proofLevel is not supported by the registry submitter/,
  );
}

async function rejectsEvidenceCommitmentMismatchBeforeSolana() {
  await assert.rejects(
    () => submitRegisterProof({ ...buildRequest(proof), cameraEvidenceJson: "{}" }),
    /cameraEvidenceJson does not match manifest commitment/,
  );
}

async function rejectsAppCaptureWithoutCameraMetadataBeforeSolana() {
  const cameraEvidence = JSON.parse(proof.cameraEvidenceJson);
  cameraEvidence.captureSurface = "native_android_camera";
  delete cameraEvidence.cameraMetadata;
  const weakProof = rewriteProofEvidence(proof, {
    cameraEvidenceJson: stableStringify(cameraEvidence),
  });
  clearCaptureSessions();
  authorizeProofSession(weakProof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(weakProof)),
      /app_capture requires committed camera metadata/,
    );
  });
}

async function rejectsAppCaptureWithoutCapturedFileBytesBeforeSolana() {
  const cameraEvidence = JSON.parse(proof.cameraEvidenceJson);
  delete cameraEvidence.capturedFileBytes;
  const weakProof = rewriteProofEvidence(proof, {
    cameraEvidenceJson: stableStringify(cameraEvidence),
  });
  clearCaptureSessions();
  authorizeProofSession(weakProof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(weakProof)),
      /cameraEvidenceJson must commit positive capturedFileBytes/,
    );
  });
}

async function rejectsAppCaptureWithoutPhotoBytesBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () => submitRegisterProof({ ...buildRequest(proof), photoBytesBase64: "" }),
    /photoBytesBase64 is required for registry submission/,
  );
}

async function rejectsAppCaptureWithMismatchedPhotoBytesBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      submitRegisterProof({
        ...buildRequest(proof),
        photoBytesBase64: sameLengthDifferentBase64(proof.photoBytesBase64),
      }),
    /photoBytesBase64 does not match imageHash/,
  );
}

async function consumesSessionAfterPhotoBytesValidationFailureBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      submitRegisterProof({
        ...buildRequest(proof),
        photoBytesBase64: sameLengthDifferentBase64(proof.photoBytesBase64),
      }),
    /photoBytesBase64 does not match imageHash/,
  );

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        verifierBaseUrl: "https://verify.argus.dev",
      }),
    /capture session was already consumed/,
  );
}

async function rejectsAppCaptureWithMismatchedCapturedFileBytesBeforeSolana() {
  const cameraEvidence = JSON.parse(proof.cameraEvidenceJson);
  cameraEvidence.capturedFileBytes += 1;
  const weakProof = rewriteProofEvidence(proof, {
    cameraEvidenceJson: stableStringify(cameraEvidence),
  });
  clearCaptureSessions();
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => submitRegisterProof(buildRequest(weakProof)),
    /cameraEvidenceJson capturedFileBytes does not match photoBytesBase64/,
  );
}

async function acceptsLevel3KeystoreEvidenceBeforeSolana() {
  clearCaptureSessions();
  const level3Proof = rewriteProofAndroidEvidence(proof, { level: 3 });
  authorizeProofSession(level3Proof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(level3Proof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

async function acceptsLevel3NativeCanonicalKeystoreEvidenceBeforeSolana() {
  clearCaptureSessions();
  const level3Proof = rewriteProofAndroidNativeCanonicalEvidence(proof);
  authorizeProofSession(level3Proof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(level3Proof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

async function acceptsLevel4HardwareAttestationEvidenceBeforeSolana() {
  clearCaptureSessions();
  const level4Proof = rewriteProofAndroidEvidence(proof, {
    hardwareAttestation: "level4",
    level: 4,
  });
  authorizeProofSession(level4Proof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(level4Proof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

async function rejectsLevel4WithoutTrustedRootBeforeSolana() {
  clearCaptureSessions();
  const previousTrustedRoots = process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256;
  delete process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256;
  try {
    const weakProof = rewriteProofAndroidEvidence(proof, {
      hardwareAttestation: "level4",
      level: 4,
    });
    authorizeProofSession(weakProof);

    await assert.rejects(
      () => submitRegisterProof(buildRequest(weakProof)),
      /Level 4 Android evidence requires configured Android attestation trust root/,
    );
  } finally {
    process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256 = previousTrustedRoots;
  }
}

async function rejectsLevel4UntrustedRootBeforeSolana() {
  clearCaptureSessions();
  const previousTrustedRoots = process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256;
  process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256 = "b".repeat(64);
  try {
    const weakProof = rewriteProofAndroidEvidence(proof, {
      hardwareAttestation: "level4",
      level: 4,
    });
    authorizeProofSession(weakProof);

    await assert.rejects(
      () => submitRegisterProof(buildRequest(weakProof)),
      /Level 4 Android attestation root is not trusted/,
    );
  } finally {
    process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256 = previousTrustedRoots;
  }
}

async function rejectsLevel4PlaceholderCertificateChainBeforeSolana() {
  clearCaptureSessions();
  const weakProof = rewriteProofAndroidEvidence(proof, {
    certificateChainPem: [PLACEHOLDER_CERTIFICATE_PEM],
    hardwareAttestation: "level4",
    level: 4,
  });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => submitRegisterProof(buildRequest(weakProof)),
    /Level 4 Android evidence requires verifier-compatible certificate-chain material/,
  );

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(weakProof),
        verifierBaseUrl: "https://verify.argus.dev",
      }),
    /capture session was already consumed/,
  );
}

async function rejectsLevel4CertificateWithoutAndroidKeyAttestationExtensionBeforeSolana() {
  clearCaptureSessions();
  const previousTrustedRoots = process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256;
  process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256 = certificateSha256(
    LEVEL4_NO_ANDROID_EXTENSION_CERTIFICATE_PEM,
  );
  try {
    const weakProof = rewriteProofAndroidEvidence(proof, {
      certificateChainPem: [LEVEL4_NO_ANDROID_EXTENSION_CERTIFICATE_PEM],
      hardwareAttestation: "level4",
      level: 4,
    });
    authorizeProofSession(weakProof);

    await assert.rejects(
      () => submitRegisterProof(buildRequest(weakProof)),
      /Level 4 Android evidence requires Android key attestation certificate extension/,
    );
  } finally {
    process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256 = previousTrustedRoots;
  }
}

async function rejectsLevel4ChallengeSessionMismatchBeforeSolana() {
  clearCaptureSessions();
  const weakProof = rewriteProofAndroidEvidence(proof, {
    attestationChallengeHex: "f".repeat(64),
    hardwareAttestation: "level4",
    level: 4,
  });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => submitRegisterProof(buildRequest(weakProof)),
    /Level 4 Android evidence requires hardware-backed attestation material/,
  );

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(weakProof),
        verifierBaseUrl: "https://verify.argus.dev",
      }),
    /capture session was already consumed/,
  );
}

async function rejectsLevel4HardwareFallbackPromotionBeforeSolana() {
  clearCaptureSessions();
  const weakProof = rewriteProofAndroidEvidence(proof, {
    hardwareAttestation: hardwareUnsupportedFallback(3),
    level: 4,
  });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => submitRegisterProof(buildRequest(weakProof)),
    /Level 4 Android evidence cannot use hardware attestation fallback/,
  );

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(weakProof),
        verifierBaseUrl: "https://verify.argus.dev",
      }),
    /capture session was already consumed/,
  );
}

async function rejectsAppCaptureWithNonCanonicalPhotoBytesBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      submitRegisterProof({
        ...buildRequest(proof),
        photoBytesBase64: `${proof.photoBytesBase64}\n`,
      }),
    /photoBytesBase64 must be canonical base64/,
  );

  const result = await registerProof({
    ...buildRequest(proof),
    verifierBaseUrl: "https://verify.argus.dev",
  });
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsAppCaptureWithOversizedPhotoBytesBeforeConsumingSessionBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);
  const photoBytesBase64 = jpegBytesOfLength(MAX_NATIVE_CAPTURE_PHOTO_BYTES + 1).toString(
    "base64",
  );

  assert.equal(photoBytesBase64.length, MAX_NATIVE_CAPTURE_PHOTO_BASE64_LENGTH);
  assert.equal(Buffer.from(photoBytesBase64, "base64").byteLength, MAX_NATIVE_CAPTURE_PHOTO_BYTES + 1);
  await assert.rejects(
    () =>
      submitRegisterProof({
        ...buildRequest(proof),
        photoBytesBase64,
      }),
    /photoBytesBase64 exceeds native capture photo byte limit/,
  );

  const result = await registerProof({
    ...buildRequest(proof),
    verifierBaseUrl: "https://verify.argus.dev",
  });
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsAppCaptureWithNonJpegPhotoBytesBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      submitRegisterProof({
        ...buildRequest(proof),
        photoBytesBase64: Buffer.alloc(decodedByteLength(proof.photoBytesBase64), 0x61).toString("base64"),
      }),
    /photoBytesBase64 must pass the native-capture JPEG-like byte policy/,
  );
}

async function rejectsAppCaptureWithMalformedJpegSegmentBeforeSolana() {
  clearCaptureSessions();
  const malformedProof = rewriteProofPhotoBytes(proof, malformedSofJpegBytes());
  authorizeProofSession(malformedProof);

  await assert.rejects(
    () => submitRegisterProof(buildRequest(malformedProof)),
    /photoBytesBase64 must pass the native-capture JPEG-like byte policy/,
  );

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(malformedProof),
        verifierBaseUrl: "https://verify.argus.dev",
      }),
    /capture session was already consumed/,
  );
}

async function rejectsPhotoBytesWithScanComponentMissingFromFrameBeforeSolana() {
  assert.throws(
    () =>
      decodeCanonicalPhotoBytes(
        "photoBytesBase64",
        scanComponentMissingFromFrameJpegBytes().toString("base64"),
        "for registry submission",
      ),
    /photoBytesBase64 must pass the native-capture JPEG-like byte policy/,
  );
}

async function rejectsPhotoBytesWithRedefinedFrameComponentsBeforeSolana() {
  assert.throws(
    () =>
      decodeCanonicalPhotoBytes(
        "photoBytesBase64",
        redefinedFrameComponentJpegBytes().toString("base64"),
        "for registry submission",
      ),
    /photoBytesBase64 must pass the native-capture JPEG-like byte policy/,
  );
}

async function rejectsAppCaptureWithMotionPresenceFlagOnlyBeforeSolana() {
  const deviceIntegrityJson = stableStringify({
    appIdentityHash: proof.appIdentityHash,
    appIdentityHashPresent: true,
    motionSnapshotPresent: true,
  });
  const weakProof = rewriteProofEvidence(proof, { deviceIntegrityJson });
  clearCaptureSessions();
  authorizeProofSession(weakProof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(weakProof)),
      /app_capture requires committed motion evidence/,
    );
  });
}

async function rejectsAppCaptureWithStaleCameraEvidenceBeforeSolana() {
  const cameraEvidence = JSON.parse(proof.cameraEvidenceJson);
  cameraEvidence.collectedAtMs = proof.manifest.captured_at_ms + 10_000;
  cameraEvidence.captureEvidenceDelayMs = 10_000;
  const staleProof = rewriteProofEvidence(proof, {
    cameraEvidenceJson: stableStringify(cameraEvidence),
  });
  clearCaptureSessions();
  authorizeProofSession(staleProof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(staleProof)),
      /camera evidence must be collected near shutter time/,
    );
  });
}

async function rejectsAppCaptureWithStaleMotionSnapshotBeforeSolana() {
  const staleProof = rewriteProofEvidence(proof, {
    deviceIntegrityJson: buildDeviceIntegrityJson(proof, {
      sampledAtMs: proof.manifest.captured_at_ms - 10_000,
    }),
  });
  clearCaptureSessions();
  authorizeProofSession(staleProof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(staleProof)),
      /motion evidence must be captured near shutter time/,
    );
  });
}

async function rejectsAppCaptureWithWideMotionWindowBeforeSolana() {
  const wideProof = rewriteProofEvidence(proof, {
    deviceIntegrityJson: buildDeviceIntegrityJson(proof, {
      sampleWindowMs: 10_000,
    }),
  });
  clearCaptureSessions();
  authorizeProofSession(wideProof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(wideProof)),
      /motion evidence sample window is too wide/,
    );
  });
}

async function rejectsUnknownSessionNonceBeforeSolana() {
  clearCaptureSessions();

  await assert.rejects(
    () => submitRegisterProof(buildRequest(proof)),
    /capture session was not opened by the relayer/,
  );
}

async function rejectsExpiredSessionNonceBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof, { expiresAtMs: Date.now() - 1 });

  await assert.rejects(
    () => submitRegisterProof(buildRequest(proof)),
    /capture session expired/,
  );
}

async function doesNotConsumeSessionWhenRpcIsMissingBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withoutSolanaRpc(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(proof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );

    await assert.rejects(
      () => submitRegisterProof(buildRequest(proof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

async function doesNotConsumeSessionWhenRpcUrlIsInvalidBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withInvalidSolanaRpcAndKeypair(async () => {
    await assert.rejects(
      () => submitRegisterProof(buildRequest(proof)),
      /Endpoint URL must start with `http:` or `https:`/,
    );

    await assert.rejects(
      () => submitRegisterProof(buildRequest(proof)),
      /Endpoint URL must start with `http:` or `https:`/,
    );
  });
}

async function rejectsMismatchedAuthorizedRelayerSignerBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  const keypair = Keypair.generate();
  await withRelayerKeypairConfig(
    {
      authorizedRelayer: Keypair.generate().publicKey.toBase58(),
      keypair,
      rpcUrl: "http://127.0.0.1:9",
    },
    async () => {
      await assert.rejects(
        () => submitRegisterProof(buildRequest(proof)),
        /relayer keypair does not match ARGUS_AUTHORIZED_RELAYER_PUBLIC_KEY/,
      );
    },
  );

  const result = await registerProof({
    ...buildRequest(proof),
    verifierBaseUrl: "https://verify.argus.dev",
  });
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsProductionMissingAuthorizedRelayerSignerBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withRelayerKeypairConfig(
    {
      keypair: Keypair.generate(),
      nodeEnv: "production",
      registryProgramId: TRUSTED_REGISTRY_PROGRAM_ID,
      rpcUrl: "http://127.0.0.1:9",
    },
    async () => {
      await assert.rejects(
        () => submitRegisterProof(buildRequest(proof)),
        /ARGUS_AUTHORIZED_RELAYER_PUBLIC_KEY is required in production/,
      );
    },
  );

  const result = await registerProof({
    ...buildRequest(proof),
    verifierBaseUrl: "https://verify.argus.dev",
  });
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsSessionPartnerMismatchBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof, { partnerId: "attacker-partner" });

  await assert.rejects(
    () => submitRegisterProof(buildRequest(proof)),
    /capture session partnerId does not match/,
  );
}

async function rejectsSessionUseCaseMismatchBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof, { useCase: "insurance_claim" });

  await assert.rejects(
    () => submitRegisterProof(buildRequest(proof)),
    /capture session useCase does not match/,
  );
}

async function rejectsSessionAppIdentityMismatchBeforeSolana() {
  clearCaptureSessions();
  authorizeProofSession(proof, { appIdentityHash: "5".repeat(64) });

  await assert.rejects(
    () => submitRegisterProof(buildRequest(proof)),
    /capture session app identity does not match/,
  );
}

async function rejectsMissingCameraEvidenceBeforeSolana() {
  await assert.rejects(
    () => submitRegisterProof({ ...buildRequest(proof), cameraEvidenceJson: "" }),
    /cameraEvidenceJson is required for registry submission/,
  );
}

async function rejectsMissingDeviceIntegrityBeforeSolana() {
  await assert.rejects(
    () => submitRegisterProof({ ...buildRequest(proof), deviceIntegrityJson: "" }),
    /deviceIntegrityJson is required for registry submission/,
  );
}

function buildRequest(proofBundle) {
  return {
    proofId: proofBundle.proofId,
    manifestHash: proofBundle.manifestHash,
    imageHash: proofBundle.imageHash,
    partnerIdHash: proofBundle.partnerIdHash,
    partnerId: proofBundle.partnerId,
    useCase: proofBundle.useCase,
    canonicalManifestJson: proofBundle.canonicalManifestJson,
    metadataJson: proofBundle.metadataJson,
    cameraEvidenceJson: proofBundle.cameraEvidenceJson,
    deviceIntegrityJson: proofBundle.deviceIntegrityJson,
    photoBytesBase64: proofBundle.photoBytesBase64,
    captureSessionId: proofBundle.captureSessionId,
    sessionNonce: proofBundle.nonce,
    appIdentityHash: proofBundle.appIdentityHash,
    proofLevel: proofBundle.proofLevel,
    captureTimestamp: proofBundle.manifest.captured_at_ms,
  };
}

function buildRequestWithManifestPatch(proofBundle, manifestPatch, requestPatch) {
  const manifest = {
    ...proofBundle.manifest,
    ...manifestPatch,
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, manifest.image_sha256, manifest.nonce);

  return {
    ...buildRequest(proofBundle),
    ...requestPatch,
    canonicalManifestJson,
    manifestHash,
    proofId,
  };
}

function authorizeProofSession(proofBundle, overrides = {}) {
  authorizeCaptureSession({
    appIdentityHash: overrides.appIdentityHash ?? proofBundle.appIdentityHash,
    captureSessionId: proofBundle.captureSessionId,
    expiresAtMs: overrides.expiresAtMs,
    nonce: proofBundle.nonce,
    partnerId: overrides.partnerId ?? proofBundle.partnerId,
    useCase: overrides.useCase ?? proofBundle.useCase,
  });
}

function promoteToAppCaptureProof(proofBundle, { allowDemoCameraStub = false } = {}) {
  const photoBytesBase64 = sampleJpegBytes().toString("base64");
  const imageHash = sha256Hex(Buffer.from(photoBytesBase64, "base64"));
  const photoProofBundle = {
    ...proofBundle,
    imageHash,
    photoBytesBase64,
  };
  const cameraEvidenceJson = buildCameraEvidenceJson(photoProofBundle, { allowDemoCameraStub });
  const deviceIntegrityJson = buildDeviceIntegrityJson(photoProofBundle);
  const manifest = {
    ...proofBundle.manifest,
    camera_evidence_commitment: sha256Hex(cameraEvidenceJson),
    device_integrity_commitment: sha256Hex(deviceIntegrityJson),
    image_sha256: imageHash,
    proof_level: "app_capture",
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, manifest.image_sha256, manifest.nonce);

  return {
    ...proofBundle,
    cameraEvidenceJson,
    canonicalManifestJson,
    deviceIntegrityJson,
    imageHash,
    integrityLevel: "app_capture",
    manifest,
    manifestHash,
    photoBytesBase64,
    proofId,
    proofLevel: "app_capture",
  };
}

function rewriteProofEvidence(
  proofBundle,
  {
    cameraEvidenceJson = proofBundle.cameraEvidenceJson,
    deviceIntegrityJson = proofBundle.deviceIntegrityJson,
    metadataJson = proofBundle.metadataJson,
  } = {},
) {
  const manifest = {
    ...proofBundle.manifest,
    camera_evidence_commitment: sha256Hex(cameraEvidenceJson),
    device_integrity_commitment: sha256Hex(deviceIntegrityJson),
    metadata_commitment: sha256Hex(metadataJson),
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, manifest.image_sha256, manifest.nonce);

  return {
    ...proofBundle,
    cameraEvidenceJson,
    canonicalManifestJson,
    deviceIntegrityJson,
    manifest,
    manifestHash,
    metadataJson,
    proofId,
  };
}

function rewriteProofCaptureTimestamp(proofBundle, capturedAtMs) {
  const cameraEvidence = JSON.parse(proofBundle.cameraEvidenceJson);
  cameraEvidence.capturedAtMs = capturedAtMs;
  cameraEvidence.collectedAtMs = capturedAtMs + 250;
  cameraEvidence.captureEvidenceDelayMs = 250;
  const deviceIntegrity = JSON.parse(proofBundle.deviceIntegrityJson);
  deviceIntegrity.motionSnapshot = {
    ...deviceIntegrity.motionSnapshot,
    sampledAtMs: capturedAtMs,
  };
  const cameraEvidenceJson = stableStringify(cameraEvidence);
  const deviceIntegrityJson = stableStringify(deviceIntegrity);
  const manifest = {
    ...proofBundle.manifest,
    camera_evidence_commitment: sha256Hex(cameraEvidenceJson),
    captured_at_ms: capturedAtMs,
    device_integrity_commitment: sha256Hex(deviceIntegrityJson),
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, manifest.image_sha256, manifest.nonce);

  return {
    ...proofBundle,
    cameraEvidenceJson,
    canonicalManifestJson,
    deviceIntegrityJson,
    manifest,
    manifestHash,
    proofId,
  };
}

function rewriteProofAndroidEvidence(proofBundle, {
  attestationChallengeHex,
  certificateChainPem,
  hardwareAttestation,
  level,
}) {
  if (hardwareAttestation === "level4" && attestationChallengeHex === undefined) {
    proofBundle = rewriteProofNonce(proofBundle, LEVEL4_ATTESTATION_CHALLENGE_HEX);
  }

  const { privateKey, publicKey } = hardwareAttestation === "level4"
    ? {
        privateKey: LEVEL4_ATTESTED_PRIVATE_KEY_PEM,
        publicKey: createPublicKey(LEVEL4_ATTESTED_PRIVATE_KEY_PEM),
      }
    : generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  const deviceIntegrity = JSON.parse(proofBundle.deviceIntegrityJson);
  deviceIntegrity.androidEvidenceLevel = level;
  delete deviceIntegrity.keystoreSignature;

  if (hardwareAttestation === "level4") {
    deviceIntegrity.hardwareAttestation = level4HardwareAttestation(
      proofBundle,
      publicKeyPem,
      certificateChainPem,
      attestationChallengeHex,
    );
  } else if (hardwareAttestation) {
    deviceIntegrity.hardwareAttestation = hardwareAttestation;
  } else {
    delete deviceIntegrity.hardwareAttestation;
  }

  const signedPayloadJson = buildAndroidKeystoreSignedPayloadJson({
    deviceIntegrity,
    manifest: proofBundle.manifest,
    request: buildRequest(proofBundle),
  });
  deviceIntegrity.keystoreSignature = {
    algorithm: "SHA256withECDSA",
    publicKeyPem,
    signatureBase64: signAndroidEvidencePayload(privateKey, signedPayloadJson),
    signedPayloadJson,
  };

  return rewriteProofEvidence(proofBundle, {
    deviceIntegrityJson: stableStringify(deviceIntegrity),
  });
}

function rewriteProofNonce(proofBundle, nonce) {
  const manifest = {
    ...proofBundle.manifest,
    nonce,
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, manifest.image_sha256, manifest.nonce);

  return {
    ...proofBundle,
    canonicalManifestJson,
    manifest,
    manifestHash,
    nonce,
    proofId,
  };
}

function rewriteProofAndroidNativeCanonicalEvidence(proofBundle) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  const deviceIntegrity = JSON.parse(proofBundle.deviceIntegrityJson);
  deviceIntegrity.androidEvidenceLevel = 3;
  deviceIntegrity.hardwareAttestation = hardwareUnsupportedFallback(3);
  const signedPayloadJson = buildNativeKeystoreBindingJson(proofBundle);
  deviceIntegrity.keystoreSignature = {
    algorithm: "SHA256withECDSA",
    publicKeyPem,
    publicKeySpkiBase64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    signatureBase64: signAndroidEvidencePayload(privateKey, signedPayloadJson),
    signedPayloadJson,
  };

  return rewriteProofEvidence(proofBundle, {
    deviceIntegrityJson: stableStringify(deviceIntegrity),
  });
}

function buildNativeKeystoreBindingJson(proofBundle) {
  return [
    "{",
    "\"schema\":\"argus.keystore.binding.v1\",",
    `"partnerId":${JSON.stringify(proofBundle.partnerId)},`,
    `"useCase":${JSON.stringify(proofBundle.useCase)},`,
    `"metadataCommitment":${JSON.stringify(proofBundle.manifest.metadata_commitment)},`,
    `"cameraEvidenceCommitment":${JSON.stringify(proofBundle.manifest.camera_evidence_commitment)},`,
    `"appIdentityHash":${JSON.stringify(proofBundle.appIdentityHash)},`,
    `"captureSessionId":${JSON.stringify(proofBundle.captureSessionId)},`,
    `"sessionNonce":${JSON.stringify(proofBundle.nonce)},`,
    `"capturedAtMs":${proofBundle.manifest.captured_at_ms},`,
    `"imageHash":${JSON.stringify(proofBundle.imageHash)}`,
    "}",
  ].join("");
}

function signAndroidEvidencePayload(privateKey, signedPayloadJson) {
  const signer = createSign("sha256");
  signer.update(signedPayloadJson);
  signer.end();
  return signer.sign(privateKey).toString("base64");
}

function certificateSha256(certificatePem) {
  return createHash("sha256").update(new X509Certificate(normalizePemBlock(certificatePem)).raw).digest("hex");
}

function normalizePemBlock(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function hardwareUnsupportedFallback(level) {
  return {
    fallbackLevel: level,
    reason: "android_key_attestation_unavailable",
    supported: false,
  };
}

function level4HardwareAttestation(
  proofBundle,
  publicKeyPem,
  certificateChainPem,
  attestationChallengeHex,
) {
  return {
    attestationChallengeHex: attestationChallengeHex ?? proofBundle.nonce,
    certificateChainPem: certificateChainPem ?? [LEVEL4_ATTESTATION_CERTIFICATE_PEM],
    hardwareBacked: true,
    publicKeyPem,
    supported: true,
  };
}

function rewriteProofPhotoBytes(proofBundle, imageBytes) {
  const photoBytesBase64 = Buffer.from(imageBytes).toString("base64");
  const imageHash = sha256Hex(imageBytes);
  const cameraEvidence = JSON.parse(proofBundle.cameraEvidenceJson);
  cameraEvidence.capturedFileBytes = imageBytes.length;
  const cameraEvidenceJson = stableStringify(cameraEvidence);
  const manifest = {
    ...proofBundle.manifest,
    camera_evidence_commitment: sha256Hex(cameraEvidenceJson),
    image_sha256: imageHash,
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, manifest.image_sha256, manifest.nonce);

  return {
    ...proofBundle,
    cameraEvidenceJson,
    canonicalManifestJson,
    imageHash,
    manifest,
    manifestHash,
    photoBytesBase64,
    proofId,
  };
}

function buildCameraEvidenceJson(proofBundle, { allowDemoCameraStub = false } = {}) {
  const cameraEvidence = JSON.parse(proofBundle.cameraEvidenceJson);
  cameraEvidence.cameraMetadata = true;
  if (!allowDemoCameraStub) {
    cameraEvidence.captureSurface = "native_android_camera";
  }
  cameraEvidence.capturedFileBytes = decodedByteLength(proofBundle.photoBytesBase64);
  cameraEvidence.capturedAtMs = proofBundle.manifest.captured_at_ms;
  cameraEvidence.collectedAtMs = proofBundle.manifest.captured_at_ms + 250;
  cameraEvidence.captureEvidenceDelayMs = 250;
  return stableStringify(cameraEvidence);
}

function decodedByteLength(base64) {
  return Buffer.from(base64, "base64").byteLength;
}

function sameLengthDifferentBase64(base64) {
  const bytes = Buffer.from(base64, "base64");
  bytes[bytes.length - 3] ^= 1;
  return bytes.toString("base64");
}

function oversizedMetadataJson() {
  return `{"description":"${"a".repeat(70 * 1024)}"}`;
}

function oversizedCanonicalManifestJson() {
  return "a".repeat(MAX_CANONICAL_MANIFEST_JSON_BYTES + 1);
}

function oversizedEvidenceJson() {
  return "é".repeat(MAX_EVIDENCE_JSON_BYTES / 2) + "a";
}

function oversizedCaptureSessionId() {
  return "é".repeat(MAX_CAPTURE_SESSION_ID_BYTES / 2) + "a";
}

function sampleJpegBytes() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
    0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00,
    0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

function malformedSofJpegBytes() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x02, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00,
    0x3f, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

function mismatchedComponentJpegBytes() {
  const bytes = [...sampleJpegBytes()];
  bytes[23] = 0x00;
  bytes[24] = 0x0a;
  bytes[25] = 0x02;
  bytes.splice(28, 0, 0x02, 0x00);
  return Buffer.from(bytes);
}

function scanComponentMissingFromFrameJpegBytes() {
  const bytes = [...sampleJpegBytes()];
  bytes[26] = 0x02;
  return Buffer.from(bytes);
}

function redefinedFrameComponentJpegBytes() {
  const bytes = [...sampleJpegBytes()];
  bytes.splice(21, 0, ...singleComponentStartOfFrameSegment(0x02));
  bytes[39] = 0x02;
  return Buffer.from(bytes);
}

function singleComponentStartOfFrameSegment(componentId) {
  return [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, componentId, 0x11, 0x00];
}

function jpegBytesOfLength(byteLength) {
  const sample = sampleJpegBytes();
  assert.ok(byteLength >= sample.byteLength);
  const bytes = Buffer.alloc(byteLength, 0x00);
  sample.copy(bytes, 0, 0, sample.byteLength - 2);
  sample.copy(bytes, byteLength - 2, sample.byteLength - 2);
  return bytes;
}

function buildDeviceIntegrityJson(proofBundle, motionPatch = {}) {
  const deviceIntegrity = JSON.parse(proofBundle.deviceIntegrityJson);
  deviceIntegrity.androidEvidenceLevel = 2;
  deviceIntegrity.appIdentityHash = proofBundle.appIdentityHash;
  deviceIntegrity.appIdentityHashPresent = true;
  deviceIntegrity.attestationCertificateChainPem = [];
  deviceIntegrity.attestationStatus = "level_4_unsupported_fell_back_to_level_2";
  deviceIntegrity.evidenceLevel = "level_2_native_capture";
  deviceIntegrity.hardwareAttestation = {
    fallbackLevel: 2,
    reason: "android_key_attestation_unavailable",
    supported: false,
  };
  deviceIntegrity.keystorePublicKeyPem = "";
  deviceIntegrity.keystoreSignature = false;
  deviceIntegrity.level3KeystoreSignature = false;
  deviceIntegrity.level4HardwareAttestation = false;
  delete deviceIntegrity.motionSnapshotPresent;
  deviceIntegrity.motionSnapshot = {
    accelerometer: [0.01, 0.02, 9.81],
    accelerometerAvailable: true,
    available: true,
    gyroscope: [0.001, 0.002, 0.003],
    gyroscopeAvailable: true,
    sampledAtMs: proofBundle.manifest.captured_at_ms,
    sampleWindowMs: 180,
    ...motionPatch,
  };
  return stableStringify(deviceIntegrity);
}

function buildKotlinNumberDeviceIntegrityJson(proofBundle) {
  return [
    "{",
    `"appIdentityHash":"${proofBundle.appIdentityHash}",`,
    `"appIdentityHashPresent":true,`,
    `"motionSnapshot":{`,
    `"accelerometer":[0,0,9.81],`,
    `"accelerometerAvailable":true,`,
    `"available":true,`,
    `"gyroscope":[1,0.0001,-0.000123],`,
    `"gyroscopeAvailable":true,`,
    `"sampleWindowMs":180,`,
    `"sampledAtMs":${proofBundle.manifest.captured_at_ms}`,
    "}",
    "}",
  ].join("");
}

function buildRawFloatToStringDeviceIntegrityJson(proofBundle) {
  return [
    "{",
    `"appIdentityHash":"${proofBundle.appIdentityHash}",`,
    `"appIdentityHashPresent":true,`,
    `"motionSnapshot":{`,
    `"accelerometer":[0.0,-0.0,9.81],`,
    `"accelerometerAvailable":true,`,
    `"available":true,`,
    `"gyroscope":[1.0,1.0E-4,-1.23E-4],`,
    `"gyroscopeAvailable":true,`,
    `"sampleWindowMs":180,`,
    `"sampledAtMs":${proofBundle.manifest.captured_at_ms}`,
    "}",
    "}",
  ].join("");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const fields = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${fields.join(",")}}`;
}

async function withoutSolanaRpc(callback) {
  const originalRpcUrl = process.env.SOLANA_RPC_URL;
  const originalAnchorProviderUrl = process.env.ANCHOR_PROVIDER_URL;
  delete process.env.SOLANA_RPC_URL;
  delete process.env.ANCHOR_PROVIDER_URL;

  try {
    return await callback();
  } finally {
    restoreEnv("SOLANA_RPC_URL", originalRpcUrl);
    restoreEnv("ANCHOR_PROVIDER_URL", originalAnchorProviderUrl);
  }
}

async function withInvalidSolanaRpcAndKeypair(callback) {
  const originalRpcUrl = process.env.SOLANA_RPC_URL;
  const originalAnchorProviderUrl = process.env.ANCHOR_PROVIDER_URL;
  const originalRelayerKeypair = process.env.ARGUS_RELAYER_KEYPAIR;
  const originalAuthorizedRelayer = process.env.ARGUS_AUTHORIZED_RELAYER_PUBLIC_KEY;
  const tempDir = await mkdtemp(join(tmpdir(), "argus-relayer-test-"));
  const keypairPath = join(tempDir, "relayer-keypair.json");
  await writeFile(keypairPath, JSON.stringify(Array.from(Keypair.generate().secretKey)));
  process.env.SOLANA_RPC_URL = "not-a-url";
  delete process.env.ANCHOR_PROVIDER_URL;
  process.env.ARGUS_RELAYER_KEYPAIR = keypairPath;
  delete process.env.ARGUS_AUTHORIZED_RELAYER_PUBLIC_KEY;

  try {
    return await callback();
  } finally {
    restoreEnv("SOLANA_RPC_URL", originalRpcUrl);
    restoreEnv("ANCHOR_PROVIDER_URL", originalAnchorProviderUrl);
    restoreEnv("ARGUS_RELAYER_KEYPAIR", originalRelayerKeypair);
    restoreEnv("ARGUS_AUTHORIZED_RELAYER_PUBLIC_KEY", originalAuthorizedRelayer);
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function withRelayerKeypairConfig(
  { authorizedRelayer, keypair, nodeEnv, registryProgramId, rpcUrl },
  callback,
) {
  const originalRpcUrl = process.env.SOLANA_RPC_URL;
  const originalAnchorProviderUrl = process.env.ANCHOR_PROVIDER_URL;
  const originalRelayerKeypair = process.env.ARGUS_RELAYER_KEYPAIR;
  const originalAuthorizedRelayer = process.env.ARGUS_AUTHORIZED_RELAYER_PUBLIC_KEY;
  const originalRegistryProgramId = process.env.ARGUS_REGISTRY_PROGRAM_ID;
  const originalNodeEnv = process.env.NODE_ENV;
  const tempDir = await mkdtemp(join(tmpdir(), "argus-relayer-test-"));
  const keypairPath = join(tempDir, "relayer-keypair.json");
  await writeFile(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));
  process.env.SOLANA_RPC_URL = rpcUrl;
  delete process.env.ANCHOR_PROVIDER_URL;
  process.env.ARGUS_RELAYER_KEYPAIR = keypairPath;
  if (authorizedRelayer === undefined) {
    delete process.env.ARGUS_AUTHORIZED_RELAYER_PUBLIC_KEY;
  } else {
    process.env.ARGUS_AUTHORIZED_RELAYER_PUBLIC_KEY = authorizedRelayer;
  }
  if (nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = nodeEnv;
  }
  if (registryProgramId === undefined) {
    delete process.env.ARGUS_REGISTRY_PROGRAM_ID;
  } else {
    process.env.ARGUS_REGISTRY_PROGRAM_ID = registryProgramId;
  }

  try {
    return await callback();
  } finally {
    restoreEnv("SOLANA_RPC_URL", originalRpcUrl);
    restoreEnv("ANCHOR_PROVIDER_URL", originalAnchorProviderUrl);
    restoreEnv("ARGUS_RELAYER_KEYPAIR", originalRelayerKeypair);
    restoreEnv("ARGUS_AUTHORIZED_RELAYER_PUBLIC_KEY", originalAuthorizedRelayer);
    restoreEnv("ARGUS_REGISTRY_PROGRAM_ID", originalRegistryProgramId);
    restoreEnv("NODE_ENV", originalNodeEnv);
    await rm(tempDir, { force: true, recursive: true });
  }
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
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

function deriveProofIdWithoutNonce(manifestHash, imageHash) {
  return sha256Hex(
    Buffer.concat([
      Buffer.from("argus-proof-v1"),
      Buffer.from(manifestHash, "hex"),
      Buffer.from(imageHash, "hex"),
    ]),
  );
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
