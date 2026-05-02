#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { configure } from "./config.ts";
import { openCaptureSessionWithRelayer } from "./openCaptureSessionWithRelayer.ts";
import { registerProofWithRelayer } from "./registerProofWithRelayer.ts";
import {
  ARGUS_AUTHORIZED_RELAYER,
  ARGUS_LOCAL_DEMO_RELAYER,
  ARGUS_REGISTRY_PROGRAM_ID,
  getArgusEvidenceLevel,
  getArgusEvidenceLevelLabel,
  getArgusProofLevel,
  getSafeArgusVerificationUrl,
  hasArgusHardwareAttestationEvidence,
  hasArgusPublicKeyCertificateEvidence,
  isSafeArgusVerificationUrl,
  isArgusLocalDemoProof,
  isArgusProductionProof,
} from "./proofStatus.ts";
import { verifyProof } from "./verifyProof.ts";
import { createMarketplaceSimulatorProof } from "../../../apps/marketplace-demo/src/demoProof.ts";

const config = {
  partnerId: "recommerce-demo",
  relayerUrl: "https://relayer.argus.dev",
  verifierBaseUrl: "https://verify.argus.dev",
};
const MAX_EVIDENCE_JSON_BYTES = 64 * 1024;
const originalFetch = globalThis.fetch;

try {
  await acceptsActiveAuthorizedAppCaptureRegistration();
  await acceptsPendingLevel4MaterialForRelayerValidation();
  await acceptsFiniteAndroidSensorNumberLexemes();
  await rejectsRelayerSelfAttestation();
  await rejectsUnsponsoredProductionRegistration();
  await rejectsMismatchedFeePayerProductionRegistration();
  await rejectsUnsupportedDeviceAttestedRegistration();
  await keepsMockRegistrationOutOfProductionStatus();
  await acceptsRemoteDemoRegistrationAsNonProductionStatus();
  await rejectsProductionStatusWithoutSponsoredGas();
  await rejectsSpoofedRegistryProgramInProductionStatus();
  await rejectsProductionStatusWithoutNativeProofFields();
  await rejectsProductionStatusWithDemoCameraStub();
  await rejectsProductionStatusWithoutCommittedCameraMetadata();
  await rejectsProductionStatusWithoutFreshCameraEvidence();
  await rejectsProductionStatusWithMismatchedCameraEvidenceByteCount();
  await rejectsProductionStatusWithNonJpegPhotoBytes();
  await rejectsProductionStatusWithMalformedJpegSegment();
  await rejectsProductionStatusWithScanComponentMissingFromFrame();
  await rejectsProductionStatusWithRedefinedFrameComponents();
  await rejectsProductionStatusWithNonCanonicalEvidenceJson();
  await rejectsProductionStatusWithNonCanonicalEvidenceInteger();
  await rejectsProductionStatusWithMotionPresenceFlagOnly();
  await rejectsProductionStatusWithUnsupportedAttestationClaim();
  await rejectsProductionStatusWithStaleMotionSnapshot();
  await rejectsProductionStatusWithWideMotionWindow();
  await rejectsProductionStatusWithUnsupportedManifestSchema();
  await rejectsProductionStatusWithNonCanonicalManifest();
  await rejectsProductionStatusWithOversizedCanonicalManifest();
  await rejectsProductionStatusWithOversizedEvidenceJson();
  await rejectsProductionStatusWithClaimedPartnerIdMismatch();
  await rejectsProductionStatusWithPartnerIdHashMismatch();
  await rejectsProductionStatusWithoutPhotoBytes();
  await rejectsProductionStatusWithProofIdDerivedWithoutNonce();
  await rejectsProductionStatusWithForgedBundleHashes();
  await rejectsProductionStatusWithManifestProofFieldMismatch();
  await rejectsProductionStatusWithMismatchedProofRecordTimestamp();
  await rejectsProductionStatusWithNonPositiveCaptureTimestamp();
  rejectsProofStatusWithCapturedAtMismatch();
  rejectsProductionStatusWithInvalidRegisteredAt();
  rejectsProductionStatusWithUnsafeSolanaTx();
  await rejectsRegistrationWhenNativeProofFieldsAreMissing();
  await rejectsRegistrationWithConfigPartnerIdMismatch();
  await rejectsRegistrationWithMismatchedProofRecordTimestamp();
  await rejectsRegistrationWithCapturedAtMismatch();
  await rejectsRegistrationWithInvalidRegisteredAt();
  await rejectsRegistrationWhenProofObjectMutatesDuringRelayerCall();
  await rejectsRegistrationWithUnsafeSolanaTx();
  await rejectsRegistrationWithNoAuthorityRelayerUrl();
  await rejectsCaptureSessionWithTraversalRelayerUrl();
  await rejectsCaptureSessionWithOversizedSessionId();
  await rejectsCaptureSessionWithUnsafeExpiry();
  await rejectsUnsafeVerificationUrlFromRelayer();
  await rejectsVerificationUrlWithCredentialsFromRelayer();
  await rejectsUnsafeVerifierBaseUrlConfigFromRelayer();
  await rejectsNoAuthorityVerifierBaseUrlConfigFromRelayer();
  await rejectsUntrustedVerifierBaseUrlConfigFromRelayer();
  await rejectsVerificationUrlWithProofIdOutsideRoute();
  await rejectsVerificationUrlWithNormalizedPathTraversal();
  await rejectsVerificationUrlWithBackslashTraversal();
  await rejectsVerificationUrlWithSchemeBackslashTraversal();
  await rejectsVerificationUrlWithoutAuthorityFromRelayer();
  await acceptsProductionVerifierBasePath();
  await acceptsProductionVerifierEncodedSeparatorBasePath();
  await acceptsLoopbackIpv6VerifierBasePath();
  rejectsProductionProofLinkToLoopbackWhenDefaultVerifierConfigured();
  rejectsUnsafeProofLinkUrls();
  rejectsMarketplaceSimulatorPreviewAsLocalDemoLink();
  await acceptsCompleteProductionVerifiedVerifierResponse();
  await scrubsTopLevelClaimFieldsFromAcceptedVerifierResponses();
  await scrubsNestedProofTransactionMetadataFromAcceptedVerifierResponses();
  await rejectsVerifiedVerifierResponseWithoutSponsoredGas();
  await rejectsVerifiedVerifierResponseWithUnsafeSolanaTx();
  await requestsVerifierApiUnderConfiguredBasePath();
  await requestsVerifierApiUnderEncodedSeparatorBasePath();
  await rejectsVerifierRequestWithUnsafeBaseUrl();
  await rejectsVerifierRequestWithPathTraversalBaseUrl();
  await rejectsVerifierRequestWithEncodedSeparatorBaseUrl();
  await rejectsVerifierRequestWithBackslashTraversalBaseUrl();
  await rejectsVerifierRequestWithSchemeBackslashTraversalBaseUrl();
  await rejectsVerifierRequestWithNoAuthorityBaseUrl();
  await rejectsVerifierRequestWithUntrustedHttpsBaseUrl();
  await rejectsVerifierRequestWithMalformedProofId();
  await rejectsVerifierRequestWithUppercaseProofId();
  await rejectsVerifierRequestWithZeroProofId();
  await treatsVerifierNotFoundAsMissingWithoutClaims();
  await treatsVerifierServerErrorsAsFailedWithoutClaims();
  await treatsVerifierNetworkErrorsAsFailedWithoutClaims();
  verifierTrustBoundaryCopyNamesSponsorship();
  await rejectsIncompleteVerifiedVerifierResponse();
  await rejectsVerifiedVerifierResponseWithoutPhotoBytes();
  await rejectsVerifiedVerifierResponseWhenCryptoSubtleUnavailable();
  await rejectsVerifiedVerifierResponseWithMalformedBase64();
  await rejectsVerifiedVerifierResponseWithWhitespaceBase64();
  await rejectsVerifiedVerifierResponseWithUnpaddedBase64();
  await rejectsVerifiedVerifierResponseWithNonJpegPhotoBytes();
  await rejectsNonObjectVerifierResponse();
  await rejectsFailedVerifierResponseWithProofClaims();
  await rejectsFailedVerifierResponseWithStringClaimMessage();
  await rejectsMissingVerifierResponseWithProofClaims();
  await rejectsMissingVerifierResponseWithStringClaimMessage();
  await rejectsMismatchedVerifierResponseWithProofClaims();
  await acceptsCompleteDemoVerifiedVerifierResponse();
  await rejectsMarketplaceSimulatorPreviewAsDemoVerifiedResponse();
  await rejectsDemoVerifiedWithClaimedSponsorship();
  await rejectsVerifiedVerifierResponseWithProofIdDerivedWithoutNonce();
  await rejectsVerifiedVerifierResponseWithTamperedPhotoBytes();
  await rejectsVerifiedVerifierResponseWithEditedManifest();
  await rejectsVerifiedVerifierResponseWithOversizedCanonicalManifest();
  await rejectsVerifiedVerifierResponseWithOversizedEvidenceJson();
  await rejectsVerifiedVerifierResponseWithoutFreshCameraEvidence();
  await rejectsVerifiedVerifierResponseWithMismatchedCameraEvidenceByteCount();
  await rejectsVerifiedVerifierResponseWithNonCanonicalEvidenceJson();
  await rejectsVerifiedVerifierResponseWithNonCanonicalEvidenceInteger();
  await rejectsVerifiedVerifierResponseWithMalformedJpegSegment();
  await rejectsVerifiedVerifierResponseWithScanComponentMissingFromFrame();
  await rejectsVerifiedVerifierResponseWithRedefinedFrameComponents();
  await rejectsVerifiedVerifierResponseWithClaimedPartnerIdMismatch();
  await rejectsVerifiedVerifierResponseWithUnsupportedManifestSchema();
  await rejectsVerifiedVerifierResponseWithUnsupportedProofLevel();
  await rejectsVerifiedVerifierResponseWithNonCanonicalProofNonce();
  await rejectsVerifiedVerifierResponseWithNonPositiveCaptureTimestamp();
  await rejectsVerifiedVerifierResponseWithCapturedAtMismatch();
  await rejectsVerifiedVerifierResponseWithInvalidRegisteredAt();
  await rejectsVerifiedVerifierResponseWithTamperedEvidence();
  await rejectsVerifiedVerifierResponseWithWhitespaceEditedEvidence();
  await rejectsVerifiedVerifierResponseForDifferentRequestedProofId();
  await rejectsDemoProofReportedAsProductionWithoutPartialMatches();
  rejectsIncompleteLocalDemoProofStatus();
  rejectsLocalDemoStatusWithClaimedPartnerIdMismatch();
  derivesEvidenceLevelFallbackWithoutOverclaimingAttestation();
  rendersProductionProofSummaryWithTransactionReference();
  rejectsUntrustedDemoProofSummaryOverclaim();
  rendersLocalDemoProofSummaryAsPreview();
  rejectsUntrustedMarketplaceDemoDetailsOverclaim();
  rejectsSponsoredMarketplaceSimulatorDetailsOverclaim();
  rendersMarketplaceSimulatorDetailsAsPreview();
  hidesGenericProofSummaryForMarketplaceSimulatorFallback();
  rendersGenericProofSummaryOutsideMarketplaceSimulatorFallback();
  rendersMarketplaceProductionDetailsWithTransactionReference();
  rendersMarketplaceLocalDemoDetailsAsPreview();
  await rejectsIncompleteDemoVerifiedVerifierResponse();
  await rejectsDemoVerifiedWithMismatchedProofRecord();
  await rejectsDemoVerifiedWithUnknownLocalRelayer();
  rejectsLocalDemoStatusWithNonCanonicalPhotoBase64();
  rejectsUnverifiedRelayerClaimInMarketplaceStatusPanel();
  keepsLevel4MarketplaceStatusPendingWithoutTrustedRootMarker();

  console.log("SDK relayer registration security checks passed");
} finally {
  globalThis.fetch = originalFetch;
}

async function acceptsActiveAuthorizedAppCaptureRegistration() {
  const proof = buildProof();
  mockRelayerResponse(buildRegistration(proof));

  const registration = await registerProofWithRelayer(config, proof);

  assert.equal(registration.proofRecord?.relayerAuthorized, true);
  assert.equal(registration.proofRecord?.status, "active");
  assert.equal(isArgusProductionProof({ ...proof, ...registration }), true);
}

async function acceptsPendingLevel4MaterialForRelayerValidation() {
  const baseProof = buildProof();
  const publicKeyPem = "-----BEGIN PUBLIC KEY-----\nargus-test\n-----END PUBLIC KEY-----";
  const certificatePem = "-----BEGIN CERTIFICATE-----\nargus-test\n-----END CERTIFICATE-----";
  const deviceIntegrity = {
    ...JSON.parse(baseProof.deviceIntegrityJson),
    androidEvidenceLevel: 3,
    attestationCertificateChainPem: [certificatePem],
    attestationStatus: "level_4_material_present_pending_relayer_root_validation",
    evidenceLevel: "level_3_keystore_signature",
    hardwareAttestation: {
      attestationChallengeHex: baseProof.nonce,
      certificateChainPem: [certificatePem],
      fallbackLevel: 3,
      hardwareBacked: true,
      publicKeyPem,
      reason: "attestation_root_validation_required",
      rootValidated: false,
      supported: false,
    },
    keystorePublicKeyPem: publicKeyPem,
    keystoreSignature: {
      algorithm: "SHA256withECDSA",
      publicKeyPem,
      signedPayloadJson: "{\"proofId\":\"argus-test\"}",
      signatureBase64: "YXJndXMtc2ln",
    },
    level3KeystoreSignature: true,
    level4AttestationMaterial: true,
    level4HardwareAttestation: false,
  };
  const proof = {
    ...rebindProofEvidence(baseProof, {
      deviceIntegrityJson: stableStringify(deviceIntegrity),
    }),
    deviceEvidenceSummary: {
      ...baseProof.deviceEvidenceSummary,
      androidEvidenceLevel: 3,
      attestationCertificateChainPem: [certificatePem],
      attestationStatus: "level_4_material_present_pending_relayer_root_validation",
      evidenceLevel: "level_3_keystore_signature",
      keystoreAttestationMaterial: true,
      keystorePublicKeyPem: publicKeyPem,
      keystoreSignature: true,
      level3KeystoreSignature: true,
      level4HardwareAttestation: false,
    },
  };
  mockRelayerResponse(buildRegistration(proof));

  const registration = await registerProofWithRelayer(config, proof);

  assert.equal(registration.proofRecord?.status, "active");
  assert.equal(getArgusEvidenceLevel(proof), "level_3_keystore_signature");
  assert.equal(
    getArgusEvidenceLevelLabel(proof),
    "Level 3 - hardware attestation material pending relayer validation",
  );
}

async function acceptsFiniteAndroidSensorNumberLexemes() {
  const baseProof = buildProof();
  const deviceIntegrityJson = baseProof.deviceIntegrityJson
    .replace("\"accelerometer\":[0.01,0.02,9.81]", "\"accelerometer\":[0.0100,0.0200,9.8100]")
    .replace("\"gyroscope\":[0.001,0.002,0.003]", "\"gyroscope\":[0.0010,0.0020,0.0030]");
  const proof = rebindProofEvidence(baseProof, { deviceIntegrityJson });
  mockRelayerResponse(buildRegistration(proof));

  const registration = await registerProofWithRelayer(config, proof);

  assert.equal(registration.proofRecord?.status, "active");
  assert.equal(isArgusProductionProof({ ...proof, ...registration }), true);
}

async function rejectsRelayerSelfAttestation() {
  const proof = buildProof();
  mockRelayerResponse(
    buildRegistration(proof, {
      relayer: "FakeRelayer111111111111111111111111111111111",
      proofRecord: {
        relayer: "FakeRelayer111111111111111111111111111111111",
        relayerAuthorized: true,
      },
    }),
  );

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /not an Argus-authorized relayer/,
  );
}

async function rejectsUnsponsoredProductionRegistration() {
  const proof = buildProof();
  mockRelayerResponse(buildRegistration(proof, { sponsoredGas: false }));

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /not an Argus-authorized relayer/,
  );
}

async function rejectsMismatchedFeePayerProductionRegistration() {
  const proof = buildProof();
  mockRelayerResponse(
    buildRegistration(proof, {
      feePayer: "FakeRelayer111111111111111111111111111111111",
    }),
  );

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /not an Argus-authorized relayer/,
  );
}

async function rejectsUnsupportedDeviceAttestedRegistration() {
  const proof = buildProof({
    proofLevel: "device_attested",
    integrityLevel: "device_attested",
  });
  mockRelayerResponse(buildRegistration(proof));

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /proofLevel is not supported/,
  );
}

async function keepsMockRegistrationOutOfProductionStatus() {
  const proof = buildProof();
  const registration = await registerProofWithRelayer(
    { ...config, relayerUrl: "mock://argus-relayer" },
    proof,
  );

  assert.equal(registration.proofRecord?.relayerAuthorized, false);
  assert.equal(registration.proofRecord?.status, "superseded");
  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
}

async function acceptsRemoteDemoRegistrationAsNonProductionStatus() {
  const proof = buildProof();
  mockRelayerResponse(
    buildRegistration(proof, {
      relayer: ARGUS_LOCAL_DEMO_RELAYER,
      feePayer: ARGUS_LOCAL_DEMO_RELAYER,
      sponsoredGas: false,
      solanaTx: "a".repeat(64),
      verificationUrl: `https://demo.argus.example/proof/${proof.proofId}`,
      proofRecord: {
        relayer: ARGUS_LOCAL_DEMO_RELAYER,
        relayerAuthorized: false,
        status: "superseded",
      },
    }),
  );

  const registration = await registerProofWithRelayer(
    { ...config, verifierBaseUrl: "https://demo.argus.example" },
    proof,
  );

  assert.equal(registration.proofRecord?.relayerAuthorized, false);
  assert.equal(registration.proofRecord?.status, "superseded");
  assert.equal(registration.sponsoredGas, false);
  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
}

async function rejectsProductionStatusWithoutSponsoredGas() {
  const proof = buildProof();
  const registration = buildRegistration(proof, { sponsoredGas: false });

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
}

async function rejectsSpoofedRegistryProgramInProductionStatus() {
  const proof = buildProof();
  const registration = buildRegistration(proof, {
    registryProgramId: "FakeRegistry111111111111111111111111111111111",
    proofRecord: {
      registryProgramId: "FakeRegistry111111111111111111111111111111111",
    },
  });

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
}

async function rejectsProductionStatusWithoutNativeProofFields() {
  const proof = buildProof({ deviceEvidenceSummary: undefined });
  const registration = buildRegistration(proof);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
}

async function rejectsProductionStatusWithDemoCameraStub() {
  const proof = buildProof({
    cameraEvidenceJson:
      "{\"cameraMetadata\":true,\"capturedAtMs\":1777651200000,\"captureSurface\":\"android-native-camera-stub\",\"noGalleryImport\":true}",
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithoutCommittedCameraMetadata() {
  const proof = buildProof({
    cameraEvidenceJson:
      "{\"capturedAtMs\":1777651200000,\"captureSurface\":\"native_android_camera\",\"noGalleryImport\":true}",
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithoutFreshCameraEvidence() {
  const capturedAtMs = Date.parse("2026-05-01T16:00:00.000Z");
  const proof = buildProof({
    cameraEvidenceJson:
      `{"cameraMetadata":true,"capturedAtMs":${capturedAtMs},"capturedFileBytes":22,"captureEvidenceDelayMs":10000,"captureSurface":"native_android_camera","collectedAtMs":${capturedAtMs + 10_000},"noGalleryImport":true}`,
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithMismatchedCameraEvidenceByteCount() {
  const baseProof = buildProof();
  const cameraEvidence = JSON.parse(baseProof.cameraEvidenceJson);
  cameraEvidence.capturedFileBytes += 1;
  const proof = rebindProofEvidence(baseProof, {
    cameraEvidenceJson: stableStringify(cameraEvidence),
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithNonJpegPhotoBytes() {
  const proof = buildProof({
    photoBytesBase64: Buffer.from("not native jpeg bytes").toString("base64"),
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithMalformedJpegSegment() {
  const proof = buildProof({
    photoBytesBase64: Buffer.from(malformedScanComponentJpegBytes()).toString("base64"),
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithScanComponentMissingFromFrame() {
  const proof = buildProof({
    photoBytesBase64: Buffer.from(scanComponentMissingFromFrameJpegBytes()).toString("base64"),
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithRedefinedFrameComponents() {
  const proof = buildProof({
    photoBytesBase64: Buffer.from(duplicateStartOfFrameJpegBytes()).toString("base64"),
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithNonCanonicalEvidenceJson() {
  const baseProof = buildProof();
  const capturedAtMs = Date.parse(baseProof.capturedAt);
  const capturedFileBytes = Buffer.from(baseProof.photoBytesBase64, "base64").length;
  const cameraEvidenceJson = [
    "{",
    `"cameraMetadata":true,`,
    `"captureEvidenceDelayMs":250,`,
    `"captureSurface":"gallery_picker",`,
    `"captureSurface":"native_android_camera",`,
    `"capturedAtMs":${capturedAtMs},`,
    `"capturedFileBytes":${capturedFileBytes},`,
    `"collectedAtMs":${capturedAtMs + 250},`,
    `"noGalleryImport":true`,
    "}",
  ].join("");
  const proof = rebindProofEvidence(baseProof, { cameraEvidenceJson });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithNonCanonicalEvidenceInteger() {
  const baseProof = buildProof();
  const capturedFileBytes = Buffer.from(baseProof.photoBytesBase64, "base64").length;
  const cameraEvidenceJson = baseProof.cameraEvidenceJson.replace(
    `"capturedFileBytes":${capturedFileBytes}`,
    `"capturedFileBytes":${capturedFileBytes}.0`,
  );
  const proof = rebindProofEvidence(baseProof, { cameraEvidenceJson });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithMotionPresenceFlagOnly() {
  const proof = buildProof({
    deviceIntegrityJson:
      `{"appIdentityHash":"${"6".repeat(64)}","appIdentityHashPresent":true,"motionSnapshotPresent":true}`,
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithUnsupportedAttestationClaim() {
  const baseProof = buildProof();
  const deviceIntegrity = JSON.parse(baseProof.deviceIntegrityJson);
  deviceIntegrity.androidEvidenceLevel = 4;
  deviceIntegrity.evidenceLevel = "level_4_hardware_attestation";
  deviceIntegrity.hardwareAttestation = {
    attestationChallengeHex: baseProof.nonce,
    certificateChainPem: ["-----BEGIN CERTIFICATE-----\\nclaimed\\n-----END CERTIFICATE-----"],
    hardwareBacked: true,
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\\nclaimed\\n-----END PUBLIC KEY-----",
    supported: true,
  };
  deviceIntegrity.keystoreSignature = true;
  deviceIntegrity.level3KeystoreSignature = true;
  deviceIntegrity.level4HardwareAttestation = true;
  deviceIntegrity.keystorePublicKeyPem = "-----BEGIN PUBLIC KEY-----\\nclaimed\\n-----END PUBLIC KEY-----";
  deviceIntegrity.attestationCertificateChainPem = ["-----BEGIN CERTIFICATE-----\\nclaimed\\n-----END CERTIFICATE-----"];
  const proof = {
    ...rebindProofEvidence(baseProof, {
      deviceIntegrityJson: stableStringify(deviceIntegrity),
    }),
    deviceEvidenceSummary: {
      ...baseProof.deviceEvidenceSummary,
      evidenceLevel: "level_4_hardware_attestation",
      keystoreSignature: true,
      level3KeystoreSignature: true,
      level4HardwareAttestation: true,
    },
  };
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithStaleMotionSnapshot() {
  const proof = buildProof({
    deviceIntegrityJson: buildDeviceIntegrityJson({
      appIdentityHash: "6".repeat(64),
      sampledAtMs: Date.parse("2026-05-01T16:00:00.000Z") - 10_000,
    }),
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithWideMotionWindow() {
  const proof = buildProof({
    deviceIntegrityJson: buildDeviceIntegrityJson({
      appIdentityHash: "6".repeat(64),
      sampleWindowMs: 10_000,
      sampledAtMs: Date.parse("2026-05-01T16:00:00.000Z"),
    }),
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithUnsupportedManifestSchema() {
  const proof = buildProofWithManifestOverrides({
    schema_version: "argus.manifest.v0",
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithNonCanonicalManifest() {
  const baseProof = buildProof();
  const proof = buildProof({
    canonicalManifestJson: JSON.stringify(JSON.parse(baseProof.canonicalManifestJson), null, 2),
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithOversizedCanonicalManifest() {
  const proof = buildProof({
    captureSessionId: "s".repeat(4096),
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(Buffer.byteLength(proof.canonicalManifestJson, "utf8") > 4096, true);
  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithOversizedEvidenceJson() {
  const baseProof = buildProof();
  const cameraEvidenceJson = oversizedCameraEvidenceJson(baseProof);
  const proof = rebindProofEvidence(baseProof, { cameraEvidenceJson });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(Buffer.byteLength(cameraEvidenceJson, "utf8") > MAX_EVIDENCE_JSON_BYTES, true);
  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithClaimedPartnerIdMismatch() {
  const proof = {
    ...buildProof(),
    partnerId: "evil-partner",
  };
  const registration = buildRegistration(proof);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
}

async function rejectsProductionStatusWithPartnerIdHashMismatch() {
  const proof = buildProof({ partnerIdHash: "4".repeat(64) });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithoutPhotoBytes() {
  const proof = buildProof({ photoBytesBase64: undefined });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithProofIdDerivedWithoutNonce() {
  const baseProof = buildProof();
  const proofId = deriveProofIdWithoutNonce(baseProof.manifestHash, baseProof.imageHash);
  const proof = {
    ...baseProof,
    proofId,
    verificationUrl: `https://verify.argus.dev/proof/${proofId}`,
  };
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithForgedBundleHashes() {
  const proof = buildProof({
    manifestHash: "1".repeat(64),
    proofId: "2".repeat(64),
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithManifestProofFieldMismatch() {
  const baseProof = buildProof();
  const manifest = {
    ...JSON.parse(baseProof.canonicalManifestJson),
    capture_session_id: "argus-session-other",
  };
  const proof = buildProof({
    canonicalManifestJson: canonicalManifestStringify(manifest),
  });
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsProductionStatusWithMismatchedProofRecordTimestamp() {
  const proof = buildProof();
  const registration = buildRegistration(proof, {
    proofRecord: {
      captureTimestamp: Date.parse(proof.capturedAt) + 1,
    },
  });
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
}

async function rejectsProductionStatusWithNonPositiveCaptureTimestamp() {
  const proof = buildNonPositiveCaptureTimestampProof();
  const registration = buildRegistration(proof);
  mockRelayerResponse(registration);

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

function rejectsProofStatusWithCapturedAtMismatch() {
  const nativeProof = buildProof();
  const registration = buildRegistration(nativeProof);
  const staleProductionProof = {
    ...nativeProof,
    ...registration,
    capturedAt: "2026-05-01T16:00:01.000Z",
  };

  assert.equal(isArgusProductionProof(staleProductionProof), false);

  const localDemoProof = buildLocalDemoProof();
  assert.equal(
    isArgusLocalDemoProof({
      ...localDemoProof,
      capturedAt: "2026-05-01T16:00:01.000Z",
    }),
    false,
  );
}

function rejectsProductionStatusWithInvalidRegisteredAt() {
  const proof = buildProof();
  const registration = buildRegistration(proof, {
    proofRecord: {
      registeredAt: "not-a-date",
    },
  });

  assert.equal(isArgusProductionProof({ ...proof, ...registration }), false);
}

function rejectsProductionStatusWithUnsafeSolanaTx() {
  const nativeProof = buildProof();
  const registration = buildRegistration(nativeProof, {
    solanaTx: "claimed-production-transaction",
  });

  assert.equal(isArgusProductionProof({ ...nativeProof, ...registration }), false);
}

async function rejectsRegistrationWhenNativeProofFieldsAreMissing() {
  const proof = buildProof({ canonicalManifestJson: undefined });
  globalThis.fetch = async () => {
    assert.fail("relayer should not be called for an incomplete native proof");
  };

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsRegistrationWithConfigPartnerIdMismatch() {
  const proof = buildProof({ partnerId: "another-partner" });
  globalThis.fetch = async () => {
    assert.fail("relayer should not be called for a proof from another partner");
  };

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /partnerId does not match SDK config/,
  );
}

async function rejectsRegistrationWithMismatchedProofRecordTimestamp() {
  const proof = buildProof();
  mockRelayerResponse(
    buildRegistration(proof, {
      proofRecord: {
        captureTimestamp: Date.parse(proof.capturedAt) + 1,
      },
    }),
  );

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /proofRecord does not match/,
  );
}

async function rejectsRegistrationWithCapturedAtMismatch() {
  const nativeProof = buildProof();
  const staleProof = {
    ...nativeProof,
    capturedAt: "2026-05-01T16:00:01.000Z",
  };
  globalThis.fetch = async () => {
    assert.fail("relayer should not be called when proof capturedAt diverges from the manifest");
  };

  await assert.rejects(
    () => registerProofWithRelayer(config, staleProof),
    /missing required app_capture evidence or session fields/,
  );
}

async function rejectsRegistrationWithInvalidRegisteredAt() {
  const proof = buildProof();
  mockRelayerResponse(
    buildRegistration(proof, {
      proofRecord: {
        registeredAt: "not-a-date",
      },
    }),
  );

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /registeredAt/,
  );
}

async function rejectsRegistrationWhenProofObjectMutatesDuringRelayerCall() {
  const proof = buildProof();
  const mutatedProof = buildProof({
    captureSessionId: "argus-session-mutated",
    capturedAt: "2026-05-01T16:00:01.000Z",
    nonce: "8".repeat(64),
  });
  const mutatedRegistration = buildRegistration(mutatedProof);

  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.proofId, proof.proofId);
    assert.equal(body.captureSessionId, proof.captureSessionId);
    Object.assign(proof, mutatedProof);

    return {
      ok: true,
      status: 200,
      async json() {
        return mutatedRegistration;
      },
    };
  };

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /mismatched proofId/,
  );
}

async function rejectsRegistrationWithUnsafeSolanaTx() {
  const proof = buildProof();
  mockRelayerResponse(
    buildRegistration(proof, {
      solanaTx: "javascript:alert(1)",
    }),
  );

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /unsafe solanaTx/,
  );
}

async function rejectsRegistrationWithNoAuthorityRelayerUrl() {
  const proof = buildProof();
  globalThis.fetch = async () => {
    assert.fail("no-authority relayerUrl should not be fetched");
  };

  await assert.rejects(
    () =>
      registerProofWithRelayer(
        { ...config, relayerUrl: "https:relayer.argus.dev" },
        proof,
      ),
    /relayer URL is not safe/,
  );
}

async function rejectsCaptureSessionWithTraversalRelayerUrl() {
  globalThis.fetch = async () => {
    assert.fail("traversal relayerUrl should not be fetched");
  };

  await assert.rejects(
    () =>
      openCaptureSessionWithRelayer(
        { ...config, relayerUrl: "https:\\relayer.argus.dev\\..\\evil" },
        { partnerId: config.partnerId, useCase: "marketplace_listing", metadata: {} },
        "6".repeat(64),
      ),
    /relayer URL is not safe/,
  );
}

async function rejectsCaptureSessionWithOversizedSessionId() {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        captureSessionId: "é".repeat(2048) + "a",
        nonce: "6".repeat(64),
      };
    },
  });

  await assert.rejects(
    () =>
      openCaptureSessionWithRelayer(
        config,
        { partnerId: config.partnerId, useCase: "marketplace_listing", metadata: {} },
        "6".repeat(64),
      ),
    /captureSessionId exceeds Argus JSON text limit/,
  );
}

async function rejectsCaptureSessionWithUnsafeExpiry() {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        captureSessionId: "argus-session-1",
        expiresAtMs: "soon",
        nonce: "6".repeat(64),
      };
    },
  });

  await assert.rejects(
    () =>
      openCaptureSessionWithRelayer(
        config,
        { partnerId: config.partnerId, useCase: "marketplace_listing", metadata: {} },
        "6".repeat(64),
      ),
    /expiresAtMs must be a positive safe integer/,
  );
}

async function rejectsUnsafeVerificationUrlFromRelayer() {
  const proof = buildProof();
  mockRelayerResponse(
    buildRegistration(proof, {
      verificationUrl: `javascript:alert(${proof.proofId})`,
    }),
  );

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /unsafe verificationUrl/,
  );
}

async function rejectsVerificationUrlWithCredentialsFromRelayer() {
  const proof = buildProof();
  mockRelayerResponse(
    buildRegistration(proof, {
      verificationUrl: `https://user@verify.argus.dev/proof/${proof.proofId}`,
    }),
  );

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /unsafe verificationUrl/,
  );
}

async function rejectsUnsafeVerifierBaseUrlConfigFromRelayer() {
  const proof = buildProof();
  mockRelayerResponse(buildRegistration(proof));

  await assert.rejects(
    () =>
      registerProofWithRelayer(
        { ...config, verifierBaseUrl: "https://verify.argus.dev?next=https://evil.example" },
        proof,
      ),
    /unsafe verificationUrl/,
  );
}

async function rejectsNoAuthorityVerifierBaseUrlConfigFromRelayer() {
  const proof = buildProof();
  mockRelayerResponse(buildRegistration(proof));

  await assert.rejects(
    () =>
      registerProofWithRelayer(
        { ...config, verifierBaseUrl: "https:verify.argus.dev" },
        proof,
      ),
    /unsafe verificationUrl/,
  );
}

async function rejectsUntrustedVerifierBaseUrlConfigFromRelayer() {
  const proof = buildProof();
  mockRelayerResponse(
    buildRegistration(proof, {
      verificationUrl: `https://evil.example/proof/${proof.proofId}`,
    }),
  );

  await assert.rejects(
    () =>
      registerProofWithRelayer(
        { ...config, verifierBaseUrl: "https://demo.argus.example" },
        proof,
      ),
    /unsafe verificationUrl/,
  );
}

async function rejectsVerificationUrlWithProofIdOutsideRoute() {
  const proof = buildProof();
  mockRelayerResponse(
    buildRegistration(proof, {
      verificationUrl: `https://verify.argus.dev/continue?next=/proof/${proof.proofId}`,
    }),
  );

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /unsafe verificationUrl/,
  );
}

async function rejectsVerificationUrlWithNormalizedPathTraversal() {
  const proof = buildProof();
  mockRelayerResponse(
    buildRegistration(proof, {
      verificationUrl: `https://verify.argus.dev/settings/%2e%2e/proof/${proof.proofId}`,
    }),
  );

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /unsafe verificationUrl/,
  );
}

async function rejectsVerificationUrlWithBackslashTraversal() {
  const proof = buildProof();
  mockRelayerResponse(
    buildRegistration(proof, {
      verificationUrl: `https://verify.argus.dev\\..\\proof\\${proof.proofId}`,
    }),
  );

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /unsafe verificationUrl/,
  );
}

async function rejectsVerificationUrlWithSchemeBackslashTraversal() {
  const proof = buildProof();
  mockRelayerResponse(
    buildRegistration(proof, {
      verificationUrl: `https:\\verify.argus.dev\\..\\proof\\${proof.proofId}`,
    }),
  );

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /unsafe verificationUrl/,
  );
}

async function rejectsVerificationUrlWithoutAuthorityFromRelayer() {
  const proof = buildProof();
  mockRelayerResponse(
    buildRegistration(proof, {
      verificationUrl: `https:verify.argus.dev/proof/${proof.proofId}`,
    }),
  );

  await assert.rejects(
    () => registerProofWithRelayer(config, proof),
    /unsafe verificationUrl/,
  );
}

async function acceptsProductionVerifierBasePath() {
  const proof = buildProof();
  const verificationUrl = `https://verify.argus.dev/brand/proof/${proof.proofId}`;
  const basePathConfig = {
    ...config,
    verifierBaseUrl: "https://verify.argus.dev/brand",
  };
  mockRelayerResponse(
    buildRegistration(proof, {
      verificationUrl,
    }),
  );

  const registration = await registerProofWithRelayer(basePathConfig, proof);

  configure(basePathConfig);
  assert.equal(registration.verificationUrl, verificationUrl);
  assert.equal(isSafeArgusVerificationUrl(verificationUrl), true);
  assert.equal(isSafeArgusVerificationUrl(`https://verify.argus.dev/proof/${proof.proofId}`), false);
  assert.equal(isArgusProductionProof({ ...proof, ...registration }), true);
  assert.equal(getSafeArgusVerificationUrl({ ...proof, ...registration }), verificationUrl);
}

async function acceptsProductionVerifierEncodedSeparatorBasePath() {
  const proof = buildProof();
  const verificationUrl = `https://verify.argus.dev/brand%2fregion/proof/${proof.proofId}`;
  const basePathConfig = {
    ...config,
    verifierBaseUrl: "https://verify.argus.dev/brand%2fregion",
  };
  mockRelayerResponse(
    buildRegistration(proof, {
      verificationUrl,
    }),
  );

  const registration = await registerProofWithRelayer(basePathConfig, proof);

  configure(basePathConfig);
  assert.equal(registration.verificationUrl, verificationUrl);
  assert.equal(isSafeArgusVerificationUrl(verificationUrl), true);
  assert.equal(isSafeArgusVerificationUrl(`https://verify.argus.dev/proof/${proof.proofId}`), false);
  assert.equal(isArgusProductionProof({ ...proof, ...registration }), true);
  assert.equal(getSafeArgusVerificationUrl({ ...proof, ...registration }), verificationUrl);
}

async function acceptsLoopbackIpv6VerifierBasePath() {
  const proof = buildProof();
  const verificationUrl = `http://[::1]:8080/verifier/proof/${proof.proofId}`;
  const loopbackConfig = {
    ...config,
    verifierBaseUrl: "http://[::1]:8080/verifier",
  };
  mockRelayerResponse(
    buildRegistration(proof, {
      verificationUrl,
    }),
  );

  const registration = await registerProofWithRelayer(loopbackConfig, proof);

  configure(loopbackConfig);
  assert.equal(registration.verificationUrl, verificationUrl);
  assert.equal(isSafeArgusVerificationUrl(verificationUrl), true);
  assert.equal(isSafeArgusVerificationUrl(`http://[::1]:8080/proof/${proof.proofId}`), false);
  assert.equal(isArgusProductionProof({ ...proof, ...registration }), true);
  assert.equal(getSafeArgusVerificationUrl({ ...proof, ...registration }), verificationUrl);
}

function rejectsProductionProofLinkToLoopbackWhenDefaultVerifierConfigured() {
  configure(config);
  const proof = buildProof();
  const productionProof = {
    ...proof,
    ...buildRegistration(proof, {
      verificationUrl: `http://localhost:8080/proof/${proof.proofId}`,
    }),
  };

  assert.equal(isArgusProductionProof(productionProof), false);
  assert.equal(getSafeArgusVerificationUrl(productionProof), undefined);
}

function rejectsUnsafeProofLinkUrls() {
  configure(config);
  const proof = buildProof();
  const productionProof = {
    ...proof,
    ...buildRegistration(proof),
  };

  assert.equal(isSafeArgusVerificationUrl("javascript:alert(1)"), false);
  assert.equal(isSafeArgusVerificationUrl("file:///tmp/proof.html"), false);
  assert.equal(isSafeArgusVerificationUrl("//evil.example/proof"), false);
  assert.equal(isSafeArgusVerificationUrl("https:verify.argus.dev/proof/1"), false);
  assert.equal(isSafeArgusVerificationUrl("https://evil.example/proof/1"), false);
  assert.equal(isSafeArgusVerificationUrl(`https://verify.argus.dev/proof/${proof.proofId}`), true);
  assert.equal(isSafeArgusVerificationUrl("https://verify.argus.dev/proof/1"), false);
  assert.equal(isSafeArgusVerificationUrl(`https://verify.argus.dev/settings/proof/${proof.proofId}`), false);
  assert.equal(isSafeArgusVerificationUrl("https://verify.argus.dev/proof/1?next=https://evil.example"), false);
  assert.equal(isSafeArgusVerificationUrl("https://verify.argus.dev/proof/1#trusted"), false);
  assert.equal(isSafeArgusVerificationUrl(`http://localhost:8080/proof/${proof.proofId}`), true);
  assert.equal(isSafeArgusVerificationUrl("http://localhost:8080/proof/1"), false);
  assert.equal(isSafeArgusVerificationUrl("http://localhost:8080/proof/1?next=https://evil.example"), false);
  assert.equal(isSafeArgusVerificationUrl("http://[::1]:8080/proof/1"), false);
  assert.equal(isSafeArgusVerificationUrl(`http://[::1]:8080/proof/${proof.proofId}`), true);
  assert.equal(isSafeArgusVerificationUrl(`argus://verify/local-simulator/${proof.proofId}`), true);
  assert.equal(isSafeArgusVerificationUrl("argus://verify/local-simulator/1"), false);
  assert.equal(isSafeArgusVerificationUrl(`argus://verify/settings/${proof.proofId}`), false);
  assert.equal(isSafeArgusVerificationUrl("argus://verify/local-simulator/1?next=https://evil.example"), false);
  assert.equal(isSafeArgusVerificationUrl("argus://user@verify/local-simulator/1"), false);
  assert.equal(isSafeArgusVerificationUrl(`https://verify.argus.dev\\..\\evil\\proof\\${proof.proofId}`), false);
  assert.equal(isSafeArgusVerificationUrl(`https:\\verify.argus.dev\\..\\evil\\proof\\${proof.proofId}`), false);
  configure({ ...config, verifierBaseUrl: "https://demo.argus.example" });
  assert.equal(isSafeArgusVerificationUrl(`https://demo.argus.example/proof/${productionProof.proofId}`), true);
  assert.equal(
    getSafeArgusVerificationUrl({
      ...productionProof,
      verificationUrl: `https://demo.argus.example/proof/${productionProof.proofId}`,
    }),
    `https://demo.argus.example/proof/${productionProof.proofId}`,
  );
  configure(config);
  assert.equal(getSafeArgusVerificationUrl({ ...proof, verificationUrl: "javascript:alert(1)" }), undefined);
  assert.equal(
    getSafeArgusVerificationUrl({
      ...proof,
      verificationUrl: `https://verify.argus.dev/proof/${"9".repeat(64)}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...proof,
      verificationUrl: `https://verify.argus.dev/continue?next=/proof/${proof.proofId}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...proof,
      verificationUrl: `https://verify.argus.dev/proof/${proof.proofId}`,
    }),
    undefined,
  );
  const localDemoProof = buildLocalDemoProof();
  assert.equal(isArgusLocalDemoProof(localDemoProof), true);
  assert.equal(isSafeArgusVerificationUrl(`/proof/${localDemoProof.proofId}`), true);
  assert.equal(isSafeArgusVerificationUrl("/proof/not-a-proof-id"), false);
  assert.equal(isSafeArgusVerificationUrl(`/settings/proof/${localDemoProof.proofId}`), false);
  assert.equal(isSafeArgusVerificationUrl(`/proof/${localDemoProof.proofId}?next=https://evil.example`), false);
  assert.equal(isSafeArgusVerificationUrl(`/proof/${localDemoProof.proofId}#trusted`), false);
  assert.equal(isSafeArgusVerificationUrl(`/settings/%2e%2e/proof/${localDemoProof.proofId}`), false);
  assert.equal(isSafeArgusVerificationUrl(`../proof/${localDemoProof.proofId}`), false);
  assert.equal(isSafeArgusVerificationUrl(`./settings/%2e%2e/proof/${localDemoProof.proofId}`), false);
  assert.equal(
    isArgusLocalDemoProof({
      ...localDemoProof,
      verificationUrl: `https://verify.argus.dev/proof/${localDemoProof.proofId}`,
    }),
    false,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `https://verify.argus.dev/proof/${localDemoProof.proofId}`,
    }),
    undefined,
  );
  assert.equal(isArgusLocalDemoProof({ ...localDemoProof, verificationUrl: "javascript:alert(1)" }), false);
  assert.equal(
    isArgusLocalDemoProof({
      ...localDemoProof,
      verificationUrl: `argus://verify/local-simulator/${localDemoProof.proofId}?next=https://evil.example`,
    }),
    false,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `argus://verify/settings?proofId=${localDemoProof.proofId}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `argus://verify/settings/${localDemoProof.proofId}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `http://localhost:8080/settings/${localDemoProof.proofId}`,
    }),
    undefined,
  );
  assert.equal(
    isArgusLocalDemoProof({
      ...localDemoProof,
      verificationUrl: `http://localhost:8080/settings/proof/${localDemoProof.proofId}`,
    }),
    false,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `http://localhost:8080/settings/proof/${localDemoProof.proofId}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: "http://localhost:8080/proof/%zz",
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `http://localhost:8080/proof/${"%31".repeat(64)}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `http://localhost:8080/proof/${localDemoProof.proofId}/`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `http://localhost:8080/proof//${localDemoProof.proofId}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `argus://verify/local-simulator/${"%31".repeat(64)}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `argus://verify/local-simulator/${localDemoProof.proofId}/`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `argus://verify//local-simulator/${localDemoProof.proofId}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `/settings/%2e%2e/proof/${localDemoProof.proofId}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `./proof/${localDemoProof.proofId}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `../marketplace-demo/index.html?proofId=${localDemoProof.proofId}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `/proof/${localDemoProof.proofId}`,
    }),
    `/proof/${localDemoProof.proofId}`,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `http://localhost:8080/proof/${localDemoProof.proofId}`,
    }),
    `http://localhost:8080/proof/${localDemoProof.proofId}`,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...localDemoProof,
      verificationUrl: `argus://verify/local-simulator/${localDemoProof.proofId}`,
    }),
    `argus://verify/local-simulator/${localDemoProof.proofId}`,
  );
  assert.equal(isArgusProductionProof(productionProof), true);
  assert.equal(
    isArgusProductionProof({
      ...productionProof,
      verificationUrl: `https://evil.example/proof/${productionProof.proofId}`,
    }),
    false,
  );
  assert.equal(
    isArgusProductionProof({
      ...productionProof,
      verificationUrl: "javascript:alert(1)",
    }),
    false,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...productionProof,
      verificationUrl: `https://evil.example/proof/${productionProof.proofId}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...productionProof,
      verificationUrl: `https://verify.argus.dev/archive/proof/${productionProof.proofId}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...productionProof,
      verificationUrl: `https://verify.argus.dev/archive/%2e%2e/proof/${productionProof.proofId}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...productionProof,
      verificationUrl: `https://verify.argus.dev/continue?proofId=${productionProof.proofId}`,
    }),
    undefined,
  );
  assert.equal(
    getSafeArgusVerificationUrl({
      ...productionProof,
      verificationUrl: `https://verify.argus.dev/proof/${productionProof.proofId}`,
    }),
    `https://verify.argus.dev/proof/${productionProof.proofId}`,
  );
}

function rejectsMarketplaceSimulatorPreviewAsLocalDemoLink() {
  const proof = createMarketplaceSimulatorProof();

  assert.equal(isArgusLocalDemoProof(proof), false);
  assert.equal(getSafeArgusVerificationUrl(proof), undefined);
}

async function acceptsCompleteProductionVerifiedVerifierResponse() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse({
    status: "verified",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: true,
    proof,
  });

  const result = await verifyProof(proof.proofId);

  assert.equal(result.status, "verified");
  assert.equal(result.manifestHashMatches, true);
  assert.equal(result.imageHashMatches, true);
  assert.equal(result.proofIdMatches, true);
  assert.equal(result.evidenceCommitmentsMatch, true);
}

async function scrubsTopLevelClaimFieldsFromAcceptedVerifierResponses() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse({
    ...buildVerifiedVerifierResponse(proof),
    verificationUrl: `javascript:alert(${proof.proofId})`,
    solanaTx: "stale-production-transaction",
    message: `Verified Capture ${proof.solanaTx}`,
    calculatedManifestHash: "stale-calculation",
    registeredManifestHash: "stale-registry-claim",
  });

  let result = await verifyProof(proof.proofId);

  assert.equal(result.status, "verified");
  assert.equal(result.proof, proof);
  assert.equal(result.verificationUrl, undefined);
  assert.equal(result.solanaTx, undefined);
  assert.equal(result.message, undefined);
  assert.equal(result.calculatedManifestHash, undefined);
  assert.equal(result.registeredManifestHash, undefined);

  const demoProof = buildLocalDemoProof();
  mockVerifierResponse({
    status: "demo_verified",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: false,
    verificationUrl: `https://verify.argus.dev/proof/${demoProof.proofId}`,
    solanaTx: "claimed-production-transaction",
    message: `Verified Capture ${demoProof.solanaTx}`,
    calculatedManifestHash: "stale-demo-calculation",
    registeredManifestHash: "stale-demo-registry-claim",
    proof: demoProof,
  });

  result = await verifyProof(demoProof.proofId);

  assert.equal(result.status, "demo_verified");
  assert.equal(result.proof, demoProof);
  assert.equal(result.verificationUrl, undefined);
  assert.equal(result.solanaTx, undefined);
  assert.equal(result.message, undefined);
  assert.equal(result.calculatedManifestHash, undefined);
  assert.equal(result.registeredManifestHash, undefined);
}

async function scrubsNestedProofTransactionMetadataFromAcceptedVerifierResponses() {
  configure(config);
  let proof = buildLocalDemoProof({
    solanaTx: { claimed: "not-a-transaction-string" },
  });
  mockVerifierResponse({
    status: "demo_verified",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: false,
    proof,
  });

  let result = await verifyProof(proof.proofId);

  assert.equal(result.status, "demo_verified");
  assert.equal(result.proof?.solanaTx, undefined);
  assert.equal(isArgusLocalDemoProof(result.proof), true);

  proof = buildLocalDemoProof({
    solanaTx: "x".repeat(513),
  });
  mockVerifierResponse({
    status: "demo_verified",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: false,
    proof,
  });

  result = await verifyProof(proof.proofId);

  assert.equal(result.status, "demo_verified");
  assert.equal(result.proof?.solanaTx, undefined);
  assert.equal(isArgusLocalDemoProof(result.proof), true);

  proof = buildLocalDemoProof({
    solanaTx: `simulated\n${"1".repeat(64)}`,
  });
  mockVerifierResponse({
    status: "demo_verified",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: false,
    proof,
  });

  result = await verifyProof(proof.proofId);

  assert.equal(result.status, "demo_verified");
  assert.equal(result.proof?.solanaTx, undefined);
  assert.equal(isArgusLocalDemoProof(result.proof), true);
}

async function rejectsVerifiedVerifierResponseWithoutSponsoredGas() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof, { sponsoredGas: false }),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsVerifiedVerifierResponseWithUnsafeSolanaTx() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof, {
      solanaTx: "claimed-production-transaction",
    }),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
}

async function requestsVerifierApiUnderConfiguredBasePath() {
  const loopbackConfig = {
    ...config,
    verifierBaseUrl: "http://[::1]:8080/verifier/",
  };
  configure(loopbackConfig);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  globalThis.fetch = async (url) => {
    assert.equal(url, `http://[::1]:8080/verifier/api/proofs/${proof.proofId}`);

    return {
      ok: true,
      status: 200,
      async json() {
        return buildVerifiedVerifierResponse(proof);
      },
    };
  };

  const result = await verifyProof(proof.proofId);

  assert.equal(result.status, "verified");
}

async function requestsVerifierApiUnderEncodedSeparatorBasePath() {
  const encodedPathConfig = {
    ...config,
    verifierBaseUrl: "https://verify.argus.dev/brand%2fregion",
  };
  configure(encodedPathConfig);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof, {
      verificationUrl: `https://verify.argus.dev/brand%2fregion/proof/${nativeProof.proofId}`,
    }),
  };
  globalThis.fetch = async (url) => {
    assert.equal(url, `https://verify.argus.dev/brand%2fregion/api/proofs/${proof.proofId}`);

    return {
      ok: true,
      status: 200,
      async json() {
        return buildVerifiedVerifierResponse(proof);
      },
    };
  };

  const result = await verifyProof(proof.proofId);

  assert.equal(result.status, "verified");
}

async function rejectsVerifierRequestWithUnsafeBaseUrl() {
  configure({ ...config, verifierBaseUrl: "https://verify.argus.dev?next=https://evil.example" });
  globalThis.fetch = async () => {
    assert.fail("unsafe verifierBaseUrl should not be fetched");
  };

  const result = await verifyProof("1".repeat(64));

  assert.equal(result.status, "failed");
  assert.match(result.message, /base URL is not safe/);
}

async function rejectsVerifierRequestWithPathTraversalBaseUrl() {
  configure({ ...config, verifierBaseUrl: "https://verify.argus.dev/brand/%2e%2e" });
  globalThis.fetch = async () => {
    assert.fail("path traversal verifierBaseUrl should not be fetched");
  };

  const result = await verifyProof("1".repeat(64));

  assert.equal(result.status, "failed");
  assert.match(result.message, /base URL is not safe/);
}

async function rejectsVerifierRequestWithEncodedSeparatorBaseUrl() {
  configure({ ...config, verifierBaseUrl: "https://verify.argus.dev/brand%2f.." });
  globalThis.fetch = async () => {
    assert.fail("encoded separator verifierBaseUrl should not be fetched");
  };

  const result = await verifyProof("1".repeat(64));

  assert.equal(result.status, "failed");
  assert.match(result.message, /base URL is not safe/);
}

async function rejectsVerifierRequestWithBackslashTraversalBaseUrl() {
  configure({ ...config, verifierBaseUrl: "https://verify.argus.dev\\..\\evil" });
  globalThis.fetch = async () => {
    assert.fail("backslash traversal verifierBaseUrl should not be fetched");
  };

  const result = await verifyProof("1".repeat(64));

  assert.equal(result.status, "failed");
  assert.match(result.message, /base URL is not safe/);
}

async function rejectsVerifierRequestWithSchemeBackslashTraversalBaseUrl() {
  configure({ ...config, verifierBaseUrl: "https:\\verify.argus.dev\\..\\evil" });
  globalThis.fetch = async () => {
    assert.fail("scheme-backslash traversal verifierBaseUrl should not be fetched");
  };

  const result = await verifyProof("1".repeat(64));

  assert.equal(result.status, "failed");
  assert.match(result.message, /base URL is not safe/);
}

async function rejectsVerifierRequestWithNoAuthorityBaseUrl() {
  configure({ ...config, verifierBaseUrl: "https:verify.argus.dev" });
  globalThis.fetch = async () => {
    assert.fail("no-authority verifierBaseUrl should not be fetched");
  };

  const result = await verifyProof("1".repeat(64));

  assert.equal(result.status, "failed");
  assert.match(result.message, /base URL is not safe/);
}

async function rejectsVerifierRequestWithUntrustedHttpsBaseUrl() {
  configure({ ...config, verifierBaseUrl: "https://demo.argus.example" });
  let fetchedUrl;
  globalThis.fetch = async (url) => {
    fetchedUrl = url;
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
    };
  };

  const result = await verifyProof("1".repeat(64));

  assert.equal(fetchedUrl, `https://demo.argus.example/api/proofs/${"1".repeat(64)}`);
  assert.equal(result.status, "missing");
  assert.match(result.message, /Verifier returned 404/);
}

async function rejectsVerifierRequestWithMalformedProofId() {
  configure(config);
  globalThis.fetch = async () => {
    assert.fail("malformed proofId should not be fetched");
  };

  const result = await verifyProof("../proof/evil");

  assert.equal(result.status, "failed");
  assert.match(result.message, /not a valid Argus proof id/);
}

async function rejectsVerifierRequestWithUppercaseProofId() {
  configure(config);
  globalThis.fetch = async () => {
    assert.fail("uppercase proofId should not be fetched");
  };

  const result = await verifyProof("A".repeat(64));

  assert.equal(result.status, "failed");
  assert.match(result.message, /not a valid Argus proof id/);
}

async function rejectsVerifierRequestWithZeroProofId() {
  configure(config);
  globalThis.fetch = async () => {
    assert.fail("zero proofId should not be fetched");
  };

  const result = await verifyProof("0".repeat(64));

  assert.equal(result.status, "failed");
  assert.match(result.message, /not a valid Argus proof id/);
}

async function treatsVerifierNotFoundAsMissingWithoutClaims() {
  configure(config);
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
  });

  const result = await verifyProof("1".repeat(64));

  assert.equal(result.status, "missing");
  assert.equal(result.proof, undefined);
  assert.match(result.message, /Verifier returned 404/);
  assertNoPartialBundleMatches(result);
}

async function treatsVerifierServerErrorsAsFailedWithoutClaims() {
  configure(config);
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
  });

  const result = await verifyProof("1".repeat(64));

  assert.equal(result.status, "failed");
  assert.equal(result.proof, undefined);
  assert.match(result.message, /Verifier returned 503/);
  assertNoPartialBundleMatches(result);
}

async function treatsVerifierNetworkErrorsAsFailedWithoutClaims() {
  configure(config);
  globalThis.fetch = async () => {
    throw new Error("network unavailable");
  };

  const result = await verifyProof("1".repeat(64));

  assert.equal(result.status, "failed");
  assert.equal(result.proof, undefined);
  assert.match(result.message, /Verifier request failed/);
  assertNoPartialBundleMatches(result);
}

function verifierTrustBoundaryCopyNamesSponsorship() {
  const marketplaceApp = readFileSync(
    new URL("../../../apps/marketplace-demo/src/App.tsx", import.meta.url),
    "utf8",
  );
  const documentationSources = [
    readFileSync(new URL("../../../apps/marketplace-demo/index.html", import.meta.url), "utf8"),
    readFileSync(new URL("../../../api/relayer/README.md", import.meta.url), "utf8"),
  ];

  assert.match(marketplaceApp, /SDK checks/);
  assert.match(marketplaceApp, /Authorized relayer/);
  assert.match(marketplaceApp, /Open Solana Explorer/);
  assert.doesNotMatch(marketplaceApp, /authorized production relayer fee payer/);

  for (const source of documentationSources) {
    assert.match(source, /authorized production relayer fee payer/);
    assert.match(source, /sponsored gas/);
  }
}

async function rejectsIncompleteVerifiedVerifierResponse() {
  configure(config);
  mockVerifierResponse({
    status: "verified",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: true,
  });

  const result = await verifyProof("1".repeat(64));

  assert.equal(result.status, "failed");
}

async function rejectsVerifiedVerifierResponseWithoutPhotoBytes() {
  configure(config);
  const nativeProof = buildProof({ photoBytesBase64: undefined });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse({
    status: "verified",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: true,
    proof,
  });

  const result = await verifyProof(proof.proofId);

  assert.equal(result.status, "failed");
}

async function rejectsVerifiedVerifierResponseWhenCryptoSubtleUnavailable() {
  configure(config);
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: undefined,
  });

  try {
    const result = await verifyProof(proof.proofId);

    assert.equal(result.status, "failed");
    assert.equal(result.manifestHashMatches, false);
  } finally {
    if (cryptoDescriptor) {
      Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
    } else {
      delete globalThis.crypto;
    }
  }
}

async function rejectsVerifiedVerifierResponseWithMalformedBase64() {
  configure(config);
  const nativeProof = buildProof({
    photoBytesBase64: "YQ==",
  });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
    photoBytesBase64: "YR==",
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.imageHashMatches, false);
}

async function rejectsVerifiedVerifierResponseWithWhitespaceBase64() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
    photoBytesBase64: `${nativeProof.photoBytesBase64.slice(0, 4)}\n${nativeProof.photoBytesBase64.slice(4)}`,
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.imageHashMatches, false);
}

async function rejectsVerifiedVerifierResponseWithUnpaddedBase64() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
    photoBytesBase64: nativeProof.photoBytesBase64.replace(/=+$/, ""),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.imageHashMatches, false);
}

async function rejectsVerifiedVerifierResponseWithNonJpegPhotoBytes() {
  configure(config);
  const nativeProof = buildProof({
    photoBytesBase64: Buffer.from("not native camera jpeg bytes").toString("base64"),
  });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
}

async function rejectsVerifiedVerifierResponseWithMalformedJpegSegment() {
  configure(config);
  const nativeProof = buildProof({
    photoBytesBase64: Buffer.from(malformedScanComponentJpegBytes()).toString("base64"),
  });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsVerifiedVerifierResponseWithScanComponentMissingFromFrame() {
  configure(config);
  const nativeProof = buildProof({
    photoBytesBase64: Buffer.from(scanComponentMissingFromFrameJpegBytes()).toString("base64"),
  });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsVerifiedVerifierResponseWithRedefinedFrameComponents() {
  configure(config);
  const nativeProof = buildProof({
    photoBytesBase64: Buffer.from(duplicateStartOfFrameJpegBytes()).toString("base64"),
  });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsNonObjectVerifierResponse() {
  configure(config);
  mockVerifierResponse(null);

  const result = await verifyProof("1".repeat(64));

  assert.equal(result.status, "failed");
}

async function rejectsFailedVerifierResponseWithProofClaims() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse({
    status: "failed",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: true,
    verificationUrl: `javascript:alert(${proof.proofId})`,
    solanaTx: "claimed-failed-transaction",
    message: { text: "claim-like message" },
    proof,
  });

  const result = await verifyProof(proof.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.proof, undefined);
  assert.equal(result.verificationUrl, undefined);
  assert.equal(result.solanaTx, undefined);
  assert.equal(result.message, undefined);
  assertNoPartialBundleMatches(result);
}

async function rejectsFailedVerifierResponseWithStringClaimMessage() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse({
    status: "failed",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: true,
    message: `Verified Capture ${proof.solanaTx}`,
    proof,
  });

  const result = await verifyProof(proof.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.proof, undefined);
  assert.equal(result.message, undefined);
  assertNoPartialBundleMatches(result);
}

async function rejectsMissingVerifierResponseWithProofClaims() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse({
    status: "missing",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: true,
    verificationUrl: `https://verify.argus.dev/proof/${proof.proofId}`,
    solanaTx: "claimed-missing-transaction",
    message: { text: "claim-like message" },
    proof,
  });

  const result = await verifyProof(proof.proofId);

  assert.equal(result.status, "missing");
  assert.equal(result.proof, undefined);
  assert.equal(result.verificationUrl, undefined);
  assert.equal(result.solanaTx, undefined);
  assert.equal(result.message, undefined);
  assertNoPartialBundleMatches(result);
}

async function rejectsMissingVerifierResponseWithStringClaimMessage() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse({
    status: "missing",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: true,
    message: `Authorized production relayer ${proof.relayer}`,
    proof,
  });

  const result = await verifyProof(proof.proofId);

  assert.equal(result.status, "missing");
  assert.equal(result.proof, undefined);
  assert.equal(result.message, undefined);
  assertNoPartialBundleMatches(result);
}

async function rejectsMismatchedVerifierResponseWithProofClaims() {
  configure(config);
  const nativeProof = buildProof({
    photoBytesBase64: Buffer.from("not native camera jpeg bytes").toString("base64"),
  });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.proof, undefined);
  assertNoPartialBundleMatches(result);
}

async function acceptsCompleteDemoVerifiedVerifierResponse() {
  configure(config);
  const proof = buildLocalDemoProof();
  mockVerifierResponse({
    status: "demo_verified",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: false,
    proof,
  });

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusLocalDemoProof(proof), true);
  assert.equal(result.status, "demo_verified");
}

async function rejectsMarketplaceSimulatorPreviewAsDemoVerifiedResponse() {
  configure(config);
  const proof = createMarketplaceSimulatorProof();
  mockVerifierResponse({
    status: "demo_verified",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: false,
    proof,
  });

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusLocalDemoProof(proof), false);
  assert.equal(result.status, "failed");
  assert.equal(result.manifestHashMatches, false);
}

async function rejectsDemoVerifiedWithClaimedSponsorship() {
  configure(config);
  const proof = buildLocalDemoProof({
    feePayer: ARGUS_AUTHORIZED_RELAYER,
    sponsoredGas: true,
  });
  mockVerifierResponse({
    status: "demo_verified",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: false,
    proof,
  });

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusLocalDemoProof(proof), false);
  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsVerifiedVerifierResponseWithTamperedPhotoBytes() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
    photoBytesBase64: Buffer.from("tampered capture bytes").toString("base64"),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assert.equal(result.imageHashMatches, false);
}

async function rejectsVerifiedVerifierResponseWithProofIdDerivedWithoutNonce() {
  configure(config);
  const baseProof = buildProof();
  const proofId = deriveProofIdWithoutNonce(baseProof.manifestHash, baseProof.imageHash);
  const nativeProof = {
    ...baseProof,
    proofId,
    verificationUrl: `https://verify.argus.dev/proof/${proofId}`,
  };
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assert.equal(result.proofIdMatches, false);
}

async function rejectsVerifiedVerifierResponseWithEditedManifest() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
    canonicalManifestJson: nativeProof.canonicalManifestJson.replace(
      "\"use_case\":\"marketplace_listing\"",
      "\"use_case\":\"insurance_claim\"",
    ),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assert.equal(result.manifestHashMatches, false);
}

async function rejectsVerifiedVerifierResponseWithOversizedCanonicalManifest() {
  configure(config);
  const nativeProof = buildProof({
    captureSessionId: "s".repeat(4096),
  });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(Buffer.byteLength(proof.canonicalManifestJson, "utf8") > 4096, true);
  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsVerifiedVerifierResponseWithOversizedEvidenceJson() {
  configure(config);
  const baseProof = buildProof();
  const cameraEvidenceJson = oversizedCameraEvidenceJson(baseProof);
  const nativeProof = rebindProofEvidence(baseProof, { cameraEvidenceJson });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(Buffer.byteLength(cameraEvidenceJson, "utf8") > MAX_EVIDENCE_JSON_BYTES, true);
  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsVerifiedVerifierResponseWithoutFreshCameraEvidence() {
  configure(config);
  const capturedAtMs = Date.parse("2026-05-01T16:00:00.000Z");
  const nativeProof = buildProof({
    cameraEvidenceJson:
      `{"cameraMetadata":true,"capturedAtMs":${capturedAtMs},"capturedFileBytes":22,"captureEvidenceDelayMs":10000,"captureSurface":"native_android_camera","collectedAtMs":${capturedAtMs + 10_000},"noGalleryImport":true}`,
  });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
}

async function rejectsVerifiedVerifierResponseWithMismatchedCameraEvidenceByteCount() {
  configure(config);
  const baseProof = buildProof();
  const cameraEvidence = JSON.parse(baseProof.cameraEvidenceJson);
  cameraEvidence.capturedFileBytes += 1;
  const nativeProof = rebindProofEvidence(baseProof, {
    cameraEvidenceJson: stableStringify(cameraEvidence),
  });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
}

async function rejectsVerifiedVerifierResponseWithNonCanonicalEvidenceJson() {
  configure(config);
  const baseProof = buildProof();
  const capturedAtMs = Date.parse(baseProof.capturedAt);
  const capturedFileBytes = Buffer.from(baseProof.photoBytesBase64, "base64").length;
  const cameraEvidenceJson = [
    "{",
    `"cameraMetadata":true,`,
    `"captureEvidenceDelayMs":250,`,
    `"captureSurface":"gallery_picker",`,
    `"captureSurface":"native_android_camera",`,
    `"capturedAtMs":${capturedAtMs},`,
    `"capturedFileBytes":${capturedFileBytes},`,
    `"collectedAtMs":${capturedAtMs + 250},`,
    `"noGalleryImport":true`,
    "}",
  ].join("");
  const nativeProof = rebindProofEvidence(baseProof, { cameraEvidenceJson });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
}

async function rejectsVerifiedVerifierResponseWithNonCanonicalEvidenceInteger() {
  configure(config);
  const baseProof = buildProof();
  const capturedFileBytes = Buffer.from(baseProof.photoBytesBase64, "base64").length;
  const cameraEvidenceJson = baseProof.cameraEvidenceJson.replace(
    `"capturedFileBytes":${capturedFileBytes}`,
    `"capturedFileBytes":${capturedFileBytes}.0`,
  );
  const nativeProof = rebindProofEvidence(baseProof, { cameraEvidenceJson });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
}

async function rejectsVerifiedVerifierResponseWithClaimedPartnerIdMismatch() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
    partnerId: "evil-partner",
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assert.equal(result.evidenceCommitmentsMatch, false);
}

async function rejectsVerifiedVerifierResponseWithUnsupportedManifestSchema() {
  configure(config);
  const nativeProof = buildProofWithManifestOverrides({
    schema_version: "argus.manifest.v0",
  });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(result.status, "failed");
  assert.equal(result.proofLevelMatches, false);
}

async function rejectsVerifiedVerifierResponseWithUnsupportedProofLevel() {
  configure(config);
  const nativeProof = buildProof({
    proofLevel: "device_attested",
    integrityLevel: "device_attested",
  });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsVerifiedVerifierResponseWithNonCanonicalProofNonce() {
  configure(config);
  const nativeProof = buildProof({
    nonce: "A".repeat(64),
  });
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

async function rejectsVerifiedVerifierResponseWithNonPositiveCaptureTimestamp() {
  configure(config);
  const nativeProof = buildNonPositiveCaptureTimestampProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assert.equal(result.proofLevelMatches, false);
}

async function rejectsVerifiedVerifierResponseWithCapturedAtMismatch() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
    capturedAt: "2026-05-01T16:00:01.000Z",
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assert.equal(result.proofLevelMatches, false);
}

async function rejectsVerifiedVerifierResponseWithInvalidRegisteredAt() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof, {
      proofRecord: {
        registeredAt: "not-a-date",
      },
    }),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assert.equal(result.proofRecordMatches, false);
}

async function rejectsVerifiedVerifierResponseWithTamperedEvidence() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
    metadataJson: "{\"listingId\":\"evil-edit\"}",
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assert.equal(result.evidenceCommitmentsMatch, false);
}

async function rejectsVerifiedVerifierResponseWithWhitespaceEditedEvidence() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
    metadataJson: `${nativeProof.metadataJson}\n`,
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assert.equal(result.evidenceCommitmentsMatch, false);
}

async function rejectsVerifiedVerifierResponseForDifferentRequestedProofId() {
  configure(config);
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof("9".repeat(64));

  assert.equal(result.status, "failed");
  assert.equal(result.proofIdMatches, false);
}

async function rejectsDemoProofReportedAsProductionWithoutPartialMatches() {
  configure(config);
  const proof = buildLocalDemoProof();
  mockVerifierResponse(buildVerifiedVerifierResponse(proof));

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusProductionProof(proof), false);
  assert.equal(result.status, "failed");
  assertNoPartialBundleMatches(result);
}

function rejectsIncompleteLocalDemoProofStatus() {
  const proof = buildLocalDemoProof({ photoBytesBase64: undefined });

  assert.equal(isArgusLocalDemoProof(proof), false);
}

function rejectsLocalDemoStatusWithClaimedPartnerIdMismatch() {
  const proof = {
    ...buildLocalDemoProof(),
    partnerId: "evil-partner",
  };

  assert.equal(isArgusLocalDemoProof(proof), false);
}

function derivesEvidenceLevelFallbackWithoutOverclaimingAttestation() {
  const publicKeyPem = "-----BEGIN PUBLIC KEY-----\nargus-test\n-----END PUBLIC KEY-----";
  const certificatePem = "-----BEGIN CERTIFICATE-----\nargus-test\n-----END CERTIFICATE-----";
  const trustedAttestationRootFingerprintSha256 = "a".repeat(64);
  const level4ClaimWithoutKeyCert = buildProof({
    deviceEvidenceSummary: {
      cameraMetadata: true,
      motionSnapshot: true,
      appIdentityHash: true,
      keystoreSignature: false,
      evidenceLevel: "level_4_hardware_attestation",
      level4HardwareAttestation: false,
    },
  });
  const committedLevel4ClaimWithLevel2Summary = buildProof({
    deviceIntegrityJson: stableStringify({
      ...JSON.parse(level4ClaimWithoutKeyCert.deviceIntegrityJson),
      androidEvidenceLevel: 4,
      evidenceLevel: "level_4_hardware_attestation",
      hardwareAttestation: {
        fallbackLevel: 2,
        reason: "android_key_attestation_unavailable",
        supported: false,
      },
      level4HardwareAttestation: false,
    }),
    deviceEvidenceSummary: {
      cameraMetadata: true,
      motionSnapshot: true,
      appIdentityHash: true,
      keystoreSignature: false,
      evidenceLevel: "level_2_native_capture",
      level3KeystoreSignature: false,
      level4HardwareAttestation: false,
    },
  });
  const level3Base = buildProof();
  const level3DeviceIntegrity = {
    ...JSON.parse(level3Base.deviceIntegrityJson),
    androidEvidenceLevel: 3,
    attestationCertificateChainPem: [],
    evidenceLevel: "level_3_keystore_signature",
    hardwareAttestation: {
      fallbackLevel: 3,
      reason: "android_key_attestation_unavailable",
      supported: false,
    },
    keystorePublicKeyPem: publicKeyPem,
    keystoreSignature: {
      algorithm: "SHA256withECDSA",
      publicKeyPem,
      signedPayloadJson: "{\"proofId\":\"argus-test\"}",
      signatureBase64: "YXJndXMtc2ln",
    },
    level3KeystoreSignature: true,
    level4HardwareAttestation: false,
  };
  const level3Proof = buildProof({
    deviceIntegrityJson: stableStringify(level3DeviceIntegrity),
    deviceEvidenceSummary: {
      cameraMetadata: true,
      motionSnapshot: true,
      appIdentityHash: true,
      keystoreSignature: true,
      evidenceLevel: "level_4_hardware_attestation",
      level3KeystoreSignature: true,
      level4HardwareAttestation: false,
    },
  });
  const level4Base = buildProof();
  const level4DeviceIntegrity = {
    ...JSON.parse(level4Base.deviceIntegrityJson),
    androidEvidenceLevel: 4,
    attestationCertificateChainPem: [certificatePem],
    evidenceLevel: "level_4_hardware_attestation",
    hardwareAttestation: {
      attestationChallengeHex: level4Base.nonce,
      certificateChainPem: [certificatePem],
      hardwareBacked: true,
      publicKeyPem,
      supported: true,
    },
    keystorePublicKeyPem: publicKeyPem,
    keystoreSignature: {
      algorithm: "SHA256withECDSA",
      publicKeyPem,
      signedPayloadJson: "{\"proofId\":\"argus-test\"}",
      signatureBase64: "YXJndXMtc2ln",
    },
    level3KeystoreSignature: true,
    level4HardwareAttestation: true,
  };
  const level4MaterialWithoutTrustedRootProof = buildProof({
    deviceIntegrityJson: stableStringify(level4DeviceIntegrity),
    deviceEvidenceSummary: {
      cameraMetadata: true,
      motionSnapshot: true,
      appIdentityHash: true,
      keystoreSignature: true,
      evidenceLevel: "level_4_hardware_attestation",
      level3KeystoreSignature: true,
      level4HardwareAttestation: true,
    },
  });
  const trustedLevel4DeviceIntegrity = {
    ...level4DeviceIntegrity,
    attestationStatus: "level_4_trusted_root_validated",
    trustedAttestationRootConfigured: true,
    trustedAttestationRootFingerprintSha256,
    trustedAttestationRootValidated: true,
  };
  const level4WithoutTrustedRootFingerprintProof = buildProof({
    deviceIntegrityJson: stableStringify({
      ...trustedLevel4DeviceIntegrity,
      trustedAttestationRootFingerprintSha256: "0".repeat(64),
    }),
    deviceEvidenceSummary: {
      cameraMetadata: true,
      motionSnapshot: true,
      appIdentityHash: true,
      keystoreSignature: true,
      evidenceLevel: "level_4_hardware_attestation",
      level3KeystoreSignature: true,
      level4HardwareAttestation: true,
      attestationStatus: "level_4_trusted_root_validated",
      trustedAttestationRootConfigured: true,
      trustedAttestationRootFingerprintSha256: "0".repeat(64),
      trustedAttestationRootValidated: true,
    },
  });
  const level4WithoutTrustedRootValidationProof = buildProof({
    deviceIntegrityJson: stableStringify({
      ...trustedLevel4DeviceIntegrity,
      trustedAttestationRootValidated: false,
    }),
    deviceEvidenceSummary: {
      cameraMetadata: true,
      motionSnapshot: true,
      appIdentityHash: true,
      keystoreSignature: true,
      evidenceLevel: "level_4_hardware_attestation",
      level3KeystoreSignature: true,
      level4HardwareAttestation: true,
      attestationStatus: "level_4_trusted_root_validated",
      trustedAttestationRootConfigured: true,
      trustedAttestationRootFingerprintSha256,
      trustedAttestationRootValidated: false,
    },
  });
  const level4WithNestedOnlyTrustedRootMarkerProof = buildProof({
    deviceIntegrityJson: stableStringify({
      ...level4DeviceIntegrity,
      attestationStatus: "level_4_trusted_root_validated",
      hardwareAttestation: {
        ...level4DeviceIntegrity.hardwareAttestation,
        trustedRootConfigured: true,
        trustedRootFingerprintSha256: trustedAttestationRootFingerprintSha256,
        trustedRootValidated: true,
      },
    }),
    deviceEvidenceSummary: {
      cameraMetadata: true,
      motionSnapshot: true,
      appIdentityHash: true,
      keystoreSignature: true,
      evidenceLevel: "level_4_hardware_attestation",
      level3KeystoreSignature: true,
      level4HardwareAttestation: true,
      attestationStatus: "level_4_trusted_root_validated",
    },
  });
  const level4Proof = buildProof({
    deviceIntegrityJson: stableStringify(trustedLevel4DeviceIntegrity),
    deviceEvidenceSummary: {
      cameraMetadata: true,
      motionSnapshot: true,
      appIdentityHash: true,
      keystoreSignature: true,
      evidenceLevel: "level_4_hardware_attestation",
      level3KeystoreSignature: true,
      level4HardwareAttestation: true,
      attestationStatus: "level_4_trusted_root_validated",
      trustedAttestationRootConfigured: true,
      trustedAttestationRootFingerprintSha256,
      trustedAttestationRootValidated: true,
    },
  });

  assert.equal(getArgusEvidenceLevel(level4ClaimWithoutKeyCert), "level_2_native_capture");
  assert.equal(
    getArgusEvidenceLevelLabel(level4ClaimWithoutKeyCert),
    "Level 2 - Native capture evidence",
  );
  assert.equal(getArgusEvidenceLevel(committedLevel4ClaimWithLevel2Summary), "level_2_native_capture");
  assert.equal(
    getArgusEvidenceLevelLabel(committedLevel4ClaimWithLevel2Summary),
    "Level 2 - Native capture evidence (Level 4 attestation unavailable)",
  );
  assert.equal(hasArgusPublicKeyCertificateEvidence(level4ClaimWithoutKeyCert), false);
  assert.equal(getArgusEvidenceLevel(level3Proof), "level_3_keystore_signature");
  assert.equal(
    getArgusEvidenceLevelLabel(level3Proof),
    "Level 3 - Keystore-signed capture",
  );
  assert.equal(hasArgusPublicKeyCertificateEvidence(level3Proof), true);
  assert.equal(getArgusEvidenceLevel(level4MaterialWithoutTrustedRootProof), "level_3_keystore_signature");
  assert.equal(
    getArgusEvidenceLevelLabel(level4MaterialWithoutTrustedRootProof),
    "Level 3 - Keystore-signed capture (Level 4 attestation unavailable)",
  );
  assert.equal(hasArgusPublicKeyCertificateEvidence(level4MaterialWithoutTrustedRootProof), true);
  assert.equal(hasArgusHardwareAttestationEvidence(level4MaterialWithoutTrustedRootProof), false);
  assert.equal(getArgusEvidenceLevel(level4WithoutTrustedRootFingerprintProof), "level_3_keystore_signature");
  assert.equal(hasArgusHardwareAttestationEvidence(level4WithoutTrustedRootFingerprintProof), false);
  assert.equal(getArgusEvidenceLevel(level4WithoutTrustedRootValidationProof), "level_3_keystore_signature");
  assert.equal(hasArgusHardwareAttestationEvidence(level4WithoutTrustedRootValidationProof), false);
  assert.equal(getArgusEvidenceLevel(level4WithNestedOnlyTrustedRootMarkerProof), "level_3_keystore_signature");
  assert.equal(hasArgusHardwareAttestationEvidence(level4WithNestedOnlyTrustedRootMarkerProof), false);
  assert.equal(getArgusEvidenceLevel(level4Proof), "level_4_hardware_attestation");
  assert.equal(getArgusEvidenceLevelLabel(level4Proof), "Level 4 - Trusted device attestation");
  assert.equal(hasArgusHardwareAttestationEvidence(level4Proof), true);
}

function rendersProductionProofSummaryWithTransactionReference() {
  const { ArgusProofSummary } = loadArgusProofSummaryForTest();
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  const renderedText = collectRenderedText(ArgusProofSummary({ proof })).join("\n");

  assert.equal(isArgusProductionProof(proof), true);
  assert.match(renderedText, /Reported transaction reference/);
  assert.match(renderedText, /Evidence level/);
  assert.match(renderedText, /Level 2 - Native capture evidence/);
  assert.doesNotMatch(renderedText, /Reported Solana tx/);
  assert.doesNotMatch(renderedText, /Claimed transaction reference/);
}

function rejectsUntrustedDemoProofSummaryOverclaim() {
  const { ArgusProofSummary } = loadArgusProofSummaryForTest();
  const proof = buildLocalDemoProof({
    proofRecord: undefined,
    relayer: undefined,
  });
  const renderedText = collectRenderedText(ArgusProofSummary({ proof })).join("\n");

  assert.equal(isArgusLocalDemoProof(proof), false);
  assert.match(renderedText, /Claimed proof ID/);
  assert.match(renderedText, /Claimed manifest hash/);
  assert.match(renderedText, /Claimed transaction reference/);
  assert.match(renderedText, /Claimed evidence level/);
  assert.match(renderedText, /Level 1 - Demo preview \(not verified\)/);
  assert.doesNotMatch(renderedText, /Simulator proof ID/);
  assert.doesNotMatch(renderedText, /Simulator tx/);
}

function rendersLocalDemoProofSummaryAsPreview() {
  const { ArgusProofSummary } = loadArgusProofSummaryForTest();
  const proof = buildLocalDemoProof();
  const renderedText = collectRenderedText(ArgusProofSummary({ proof })).join("\n");

  assert.equal(isArgusLocalDemoProof(proof), true);
  assert.match(renderedText, /Local demo preview proof ID/);
  assert.match(renderedText, /Preview manifest hash/);
  assert.match(renderedText, /Simulated preview transaction reference/);
  assert.match(renderedText, /Preview evidence level/);
  assert.match(renderedText, /Level 1 - Demo preview/);
  assert.doesNotMatch(renderedText, /Verified Capture/);
  assert.doesNotMatch(renderedText, /Solana tx/);
}

function rejectsUntrustedMarketplaceDemoDetailsOverclaim() {
  const { VerificationSnapshot } = loadMarketplaceDemoAppForTest();
  const proof = buildLocalDemoProof({
    proofRecord: undefined,
    relayer: undefined,
  });
  const renderedText = collectRenderedText(
    VerificationSnapshot({ proof, backendStatus: "pending", isRegistering: false }),
  ).join("\n");

  assert.equal(isArgusLocalDemoProof(proof), false);
  assert.match(renderedText, /Unverified/);
  assert.match(renderedText, /Level 1 - Demo preview/);
  assert.doesNotMatch(renderedText, /Registry[\s\S]*active/);
  assert.match(renderedText, /Solana record pending/);
  assert.doesNotMatch(renderedText, /Claimed proof ID/);
  assert.doesNotMatch(renderedText, /Claimed manifest hash/);
  assert.doesNotMatch(renderedText, /Claimed transaction reference/);
  assert.doesNotMatch(renderedText, /Claimed evidence level/);
  assert.doesNotMatch(renderedText, /Simulator preview/);
  assert.doesNotMatch(renderedText, /Open Solana Explorer/);
}

function rejectsSponsoredMarketplaceSimulatorDetailsOverclaim() {
  const { VerificationSnapshot } = loadMarketplaceDemoAppForTest();
  const proof = buildLocalDemoProof({
    relayer: ARGUS_AUTHORIZED_RELAYER,
    feePayer: ARGUS_AUTHORIZED_RELAYER,
    sponsoredGas: true,
    proofRecord: {
      relayer: ARGUS_AUTHORIZED_RELAYER,
      relayerAuthorized: true,
      status: "revoked",
    },
  });
  const renderedText = collectRenderedText(
    VerificationSnapshot({ proof, backendStatus: "pending", isRegistering: false, isSimulatorPreview: true }),
  ).join("\n");

  assert.equal(isArgusLocalDemoProof(proof), false);
  assert.match(renderedText, /Unverified/);
  assert.match(renderedText, /Level 1 - Demo preview/);
  assert.doesNotMatch(renderedText, /Simulator preview/);
  assert.doesNotMatch(renderedText, /Open Solana Explorer/);
}

function rendersMarketplaceSimulatorDetailsAsPreview() {
  const { VerificationSnapshot } = loadMarketplaceDemoAppForTest();
  const proof = createMarketplaceSimulatorProof();
  const renderedText = collectRenderedText(
    VerificationSnapshot({ proof, backendStatus: "local_only", isRegistering: false, isSimulatorPreview: true }),
  ).join("\n");

  assert.equal(proof.sponsoredGas, false);
  assert.match(renderedText, /Simulator preview/);
  assert.match(renderedText, /Level 1 - Demo preview/);
  assert.match(renderedText, /Solana record pending/);
  assert.doesNotMatch(renderedText, /Claimed proof ID/);
}

function hidesGenericProofSummaryForMarketplaceSimulatorFallback() {
  const { default: MarketplaceDemoApp } = loadMarketplaceDemoAppForTest([
    createMarketplaceSimulatorProof(),
    "Local simulator preview only: Native module unavailable",
    true,
  ]);
  const renderedText = collectRenderedText(MarketplaceDemoApp({})).join("\n");

  assert.match(renderedText, /Argus demo preview/);
  assert.match(renderedText, /Simulator preview/);
  assert.match(renderedText, /Solana record pending/);
  assert.doesNotMatch(renderedText, /Generic SDK proof summary/);
}

function rendersGenericProofSummaryOutsideMarketplaceSimulatorFallback() {
  const proof = buildLocalDemoProof();
  const { default: MarketplaceDemoApp } = loadMarketplaceDemoAppForTest([proof]);
  const renderedText = collectRenderedText(MarketplaceDemoApp({})).join("\n");

  assert.equal(isArgusLocalDemoProof(proof), true);
  assert.match(renderedText, /Argus demo preview/);
  assert.match(renderedText, /Local preview/);
  assert.doesNotMatch(renderedText, /Generic SDK proof summary/);
}

function rendersMarketplaceProductionDetailsWithTransactionReference() {
  const { VerificationSnapshot } = loadMarketplaceDemoAppForTest();
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  const renderedText = collectRenderedText(
    VerificationSnapshot({ proof, backendStatus: "registered", isRegistering: false }),
  ).join("\n");

  assert.equal(isArgusProductionProof(proof), true);
  assert.match(renderedText, /Verified/);
  assert.match(renderedText, /Level 2 - Native capture evidence/);
  assert.match(renderedText, /Open Solana Explorer/);
  assert.doesNotMatch(renderedText, /Claimed transaction reference/);
}

function rendersMarketplaceLocalDemoDetailsAsPreview() {
  const { VerificationSnapshot } = loadMarketplaceDemoAppForTest();
  const proof = buildLocalDemoProof();
  const renderedText = collectRenderedText(
    VerificationSnapshot({ proof, backendStatus: "local_only", isRegistering: false }),
  ).join("\n");

  assert.equal(isArgusLocalDemoProof(proof), true);
  assert.match(renderedText, /Local preview/);
  assert.match(renderedText, /Level 1 - Demo preview/);
  assert.match(renderedText, /Solana record pending/);
  assert.doesNotMatch(renderedText, /Verified Capture/);
}

function rejectsUnverifiedRelayerClaimInMarketplaceStatusPanel() {
  const nativeProof = buildProof();
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof, {
      registryProgramId: "FakeRegistry111111111111111111111111111111111",
      proofRecord: {
        registryProgramId: "FakeRegistry111111111111111111111111111111111",
      },
    }),
  };
  const { default: MarketplaceDemoApp } = loadMarketplaceDemoAppForTest([proof]);
  const renderedText = collectRenderedText(MarketplaceDemoApp({})).join("\n");

  assert.equal(proof.proofRecord.relayerAuthorized, true);
  assert.equal(isArgusProductionProof(proof), false);
  assert.match(renderedText, /Authorized relayer[\s\S]*pending/);
  assert.doesNotMatch(renderedText, /Authorized relayer[\s\S]*captured/);
}

function keepsLevel4MarketplaceStatusPendingWithoutTrustedRootMarker() {
  const publicKeyPem = "-----BEGIN PUBLIC KEY-----\nargus-test\n-----END PUBLIC KEY-----";
  const certificatePem = "-----BEGIN CERTIFICATE-----\nargus-test\n-----END CERTIFICATE-----";
  const baseProof = buildProof();
  const deviceIntegrity = {
    ...JSON.parse(baseProof.deviceIntegrityJson),
    androidEvidenceLevel: 4,
    attestationCertificateChainPem: [certificatePem],
    evidenceLevel: "level_4_hardware_attestation",
    hardwareAttestation: {
      attestationChallengeHex: baseProof.nonce,
      certificateChainPem: [certificatePem],
      hardwareBacked: true,
      publicKeyPem,
      supported: true,
    },
    keystorePublicKeyPem: publicKeyPem,
    keystoreSignature: {
      algorithm: "SHA256withECDSA",
      publicKeyPem,
      signedPayloadJson: "{\"proofId\":\"argus-test\"}",
      signatureBase64: "YXJndXMtc2ln",
    },
    level3KeystoreSignature: true,
    level4HardwareAttestation: true,
  };
  const nativeProof = {
    ...rebindProofEvidence(baseProof, {
      deviceIntegrityJson: stableStringify(deviceIntegrity),
    }),
    deviceEvidenceSummary: {
      ...baseProof.deviceEvidenceSummary,
      evidenceLevel: "level_4_hardware_attestation",
      keystoreSignature: true,
      level3KeystoreSignature: true,
      level4HardwareAttestation: true,
    },
  };
  const proof = {
    ...nativeProof,
    ...buildRegistration(nativeProof),
  };
  const { default: MarketplaceDemoApp } = loadMarketplaceDemoAppForTest([proof]);
  const renderedText = collectRenderedText(MarketplaceDemoApp({})).join("\n");

  assert.equal(isArgusProductionProof(proof), true);
  assert.equal(getArgusEvidenceLevel(proof), "level_3_keystore_signature");
  assert.match(renderedText, /Level 4 attestation\s*:\s*pending/);
  assert.doesNotMatch(renderedText, /Level 4 attestation\s*:\s*captured/);
}

function rejectsLocalDemoStatusWithNonCanonicalPhotoBase64() {
  const proof = buildLocalDemoProof({ photoBytesBase64: "YR==" });

  assert.equal(isArgusLocalDemoProof(proof), false);
}

async function rejectsIncompleteDemoVerifiedVerifierResponse() {
  configure(config);
  mockVerifierResponse({
    status: "demo_verified",
    manifestHashMatches: true,
  });

  const result = await verifyProof("demo-proof");

  assert.equal(result.status, "failed");
}

async function rejectsDemoVerifiedWithMismatchedProofRecord() {
  configure(config);
  const proof = buildLocalDemoProof({
    proofRecord: {
      imageHash: "9".repeat(64),
    },
  });
  mockVerifierResponse({
    status: "demo_verified",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: false,
    proof,
  });

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusLocalDemoProof(proof), false);
  assert.equal(result.status, "failed");
}

async function rejectsDemoVerifiedWithUnknownLocalRelayer() {
  configure(config);
  const proof = buildLocalDemoProof({
    relayer: "UnknownDemoRelayer111111111111111111111111",
    proofRecord: {
      relayer: "UnknownDemoRelayer111111111111111111111111",
    },
  });
  mockVerifierResponse({
    status: "demo_verified",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: false,
    proof,
  });

  const result = await verifyProof(proof.proofId);

  assert.equal(isArgusLocalDemoProof(proof), false);
  assert.equal(result.status, "failed");
}

function mockRelayerResponse(registration) {
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.proofId, registration.proofId);
    assert.equal(body.proofLevel, registration.proofRecord.proofLevel);
    assert.match(body.photoBytesBase64, /^[A-Za-z0-9+/]+={0,2}$/);

    return {
      ok: true,
      status: 200,
      async json() {
        return registration;
      },
    };
  };
}

function mockVerifierResponse(result) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return result;
    },
  });
}

function buildVerifiedVerifierResponse(proof) {
  return {
    status: "verified",
    manifestHashMatches: true,
    imageHashMatches: true,
    proofIdMatches: true,
    evidenceCommitmentsMatch: true,
    proofLevelMatches: true,
    proofRecordMatches: true,
    registryProgramMatches: true,
    authorizedRelayerMatches: true,
    proof,
  };
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

function failedVerificationResult(status, message) {
  return {
    status,
    manifestHashMatches: false,
    imageHashMatches: false,
    proofIdMatches: false,
    evidenceCommitmentsMatch: false,
    proofLevelMatches: false,
    proofRecordMatches: false,
    registryProgramMatches: false,
    authorizedRelayerMatches: false,
    ...(message ? { message } : {}),
  };
}

function loadArgusProofSummaryForTest() {
  const source = readFileSync(new URL("./ArgusProofSummary.tsx", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: false,
    },
  }).outputText;
  const React = {
    createElement(type, props, ...children) {
      return {
        type,
        props: {
          ...(props ?? {}),
          children,
        },
      };
    },
  };
  const module = { exports: {} };
  const require = (specifier) => {
    if (specifier === "react") {
      return { default: React };
    }
    if (specifier === "react-native") {
      return { Text: "Text", View: "View" };
    }
    if (specifier === "./proofStatus") {
      return {
        getArgusEvidenceLevelLabel,
        getArgusProofLevel,
        isArgusLocalDemoProof,
        isArgusProductionProof,
      };
    }
    throw new Error(`Unexpected test import: ${specifier}`);
  };

  Function("require", "exports", "module", output)(require, module.exports, module);
  return module.exports;
}

function loadMarketplaceDemoAppForTest(initialStateValues = []) {
  const normalizedInitialStateValues = normalizeMarketplaceInitialStateValues(initialStateValues);
  const source = readFileSync(new URL("../../../apps/marketplace-demo/src/App.tsx", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: false,
    },
  }).outputText;
  const React = {
    createElement(type, props, ...children) {
      return {
        type,
        props: {
          ...(props ?? {}),
          children,
        },
      };
    },
  };
  const module = { exports: {} };
  let stateIndex = 0;
  const require = (specifier) => {
    if (specifier === "react") {
      return {
        default: React,
        useEffect() {},
        useState(initialValue) {
          const fallbackValue = typeof initialValue === "function" ? initialValue() : initialValue;
          const value =
            stateIndex < normalizedInitialStateValues.length
              ? normalizedInitialStateValues[stateIndex]
              : fallbackValue;
          stateIndex += 1;
          return [value, () => {}];
        },
      };
    }
    if (specifier === "react-native") {
      return {
        Alert: { alert() {} },
        Image: "Image",
        Pressable: "Pressable",
        SafeAreaView: "SafeAreaView",
        ScrollView: "ScrollView",
        StyleSheet: { create: (styles) => styles },
        Text: "Text",
        View: "View",
      };
    }
    if (specifier === "react-native-svg") {
      return {
        default: "Svg",
        Path: "Path",
      };
    }
    if (specifier === "../../../packages/argus-rn-sdk/src") {
      return {
        ArgusBadge: () => null,
        ArgusCamera: () => null,
        ArgusProofLink: () => null,
        ArgusProofSummary: () => null,
        ARGUS_LOCAL_DEMO_RELAYER,
        configure() {},
        getArgusEvidenceLevel,
        getArgusEvidenceLevelLabel,
        hasArgusPublicKeyCertificateEvidence,
        isArgusLocalDemoProof,
        isArgusProductionProof,
        registerProofWithRelayer() {
          throw new Error("registerProofWithRelayer should not run during static render tests");
        },
      };
    }
    if (specifier === "../../shared/argusDemoConfig") {
      return {
        ARGUS_DEMO_BACKEND_URL: "https://demo.argus.example",
        ARGUS_DEMO_PARTNER_ID: "recommerce-demo",
        ARGUS_DEMO_USE_CASE: "marketplace_listing",
      };
    }
    if (specifier === "./data/listing") {
      return {
        captureProof: {
          evidence: ["Camera evidence", "Motion snapshot", "App identity hash"],
          limitations: ["Does not prove seller ownership"],
          manifestHash: "1".repeat(64),
          solanaTx: "2".repeat(64),
        },
        listing: {
          condition: "Used",
          id: "argus-listing-test",
          offerLabel: "Buy It Now or Best Offer",
          photoUrl: "https://demo.argus.example/item.jpg",
          price: "$1",
          seller: {
            location: "Austin, TX",
            name: "TestSeller",
            positiveRate: "99%",
            score: "10 sales",
          },
          title: "Test listing",
          shipping: "Free shipping",
        },
      };
    }
    if (specifier === "./demoProof") {
      return { createMarketplaceSimulatorProof };
    }
    if (specifier === "./FigmaIcon") {
      return {
        FigmaIcon: () => null,
      };
    }
    if (specifier === "./localListingStore") {
      return {
        buildListingDraft({ backendMessage, backendStatus, listing, proof, uploadSource }) {
          return {
            backendMessage,
            backendStatus,
            listing,
            metadataJson: proof.metadataJson ?? "{}",
            photoBytesBase64: proof.photoBytesBase64 ?? "",
            photoUri: listing.photoUrl,
            proof,
            savedAt: "2026-05-02T00:00:00.000Z",
            uploadSource,
          };
        },
        loadLocalListingDraft() {
          return null;
        },
        loadLocalListingDrafts() {
          return [];
        },
        saveLocalListingDraft(draft) {
          return draft;
        },
        saveLocalListingDrafts(drafts) {
          return drafts;
        },
      };
    }
    if (specifier.startsWith("../assets/")) {
      return { uri: specifier };
    }
    throw new Error(`Unexpected test import: ${specifier}`);
  };

  Function("require", "exports", "module", output)(require, module.exports, module);
  return module.exports;
}

function normalizeMarketplaceInitialStateValues(initialStateValues) {
  const firstValue = initialStateValues[0];

  if (!firstValue || typeof firstValue !== "object" || !("proofId" in firstValue)) {
    return initialStateValues;
  }

  const fallbackMessage = typeof initialStateValues[1] === "string" ? initialStateValues[1] : null;
  const isSimulatorFallback = initialStateValues[2] === true;
  const backendStatus = isSimulatorFallback || isArgusLocalDemoProof(firstValue) ? "local_only" : "registered";
  const draft = {
    backendMessage:
      fallbackMessage ?? (backendStatus === "local_only" ? "Local preview only" : "Solana devnet registered"),
    backendStatus,
    listing: {
      condition: "Used",
      id: "argus-listing-test",
      offerLabel: "Buy It Now or Best Offer",
      photoUrl: "https://demo.argus.example/item.jpg",
      price: "$1",
      seller: {
        location: "Austin, TX",
        name: "TestSeller",
        positiveRate: "99%",
        score: "10 sales",
      },
      shipping: "Free shipping",
      title: "Test listing",
    },
    metadataJson: firstValue.metadataJson ?? "{}",
    photoBytesBase64: firstValue.photoBytesBase64 ?? "",
    photoUri: "https://demo.argus.example/item.jpg",
    proof: firstValue,
    savedAt: "2026-05-02T00:00:00.000Z",
    uploadSource: isSimulatorFallback ? "local_upload" : "argus_camera",
  };

  return [
    [draft],
    draft.listing.id,
    "selling",
    "argus-listing-test",
    {
      condition: "",
      location: "",
      price: "",
      title: "",
    },
    fallbackMessage,
    null,
  ];
}

function collectRenderedText(node) {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }
  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectRenderedText);
  }
  if (typeof node.type === "function") {
    return collectRenderedText(node.type(node.props ?? {}));
  }
  return collectRenderedText(node.props?.children);
}

function oversizedCameraEvidenceJson(proof) {
  const cameraEvidence = JSON.parse(proof.cameraEvidenceJson);
  cameraEvidence.padding = "a".repeat(MAX_EVIDENCE_JSON_BYTES);
  return stableStringify(cameraEvidence);
}

function buildProof(overrides = {}) {
  const partnerId = hasOwn(overrides, "partnerId") ? overrides.partnerId : "recommerce-demo";
  const appIdentityHash = hasOwn(overrides, "appIdentityHash") ? overrides.appIdentityHash : "6".repeat(64);
  const proofLevel = hasOwn(overrides, "proofLevel") ? overrides.proofLevel : "app_capture";
  const integrityLevel = hasOwn(overrides, "integrityLevel") ? overrides.integrityLevel : proofLevel;
  const partnerIdHash = hasOwn(overrides, "partnerIdHash") ? overrides.partnerIdHash : sha256Hex(partnerId);
  const captureSessionId = hasOwn(overrides, "captureSessionId") ? overrides.captureSessionId : "argus-session-1";
  const nonce = hasOwn(overrides, "nonce") ? overrides.nonce : "5".repeat(64);
  const capturedAt = hasOwn(overrides, "capturedAt") ? overrides.capturedAt : "2026-05-01T16:00:00.000Z";
  const capturedAtMs = Date.parse(capturedAt);
  const useCase = hasOwn(overrides, "useCase") ? overrides.useCase : "marketplace_listing";
  const metadataJson = hasOwn(overrides, "metadataJson") ? overrides.metadataJson : "{}";
  const defaultPhotoBytesBase64 = Buffer.from(minimalJpegBytes()).toString("base64");
  const photoBytesBase64 = hasOwn(overrides, "photoBytesBase64")
    ? overrides.photoBytesBase64
    : defaultPhotoBytesBase64;
  const capturedFileBytes = Buffer.from(photoBytesBase64 ?? defaultPhotoBytesBase64, "base64").length;
  const cameraEvidenceJson = hasOwn(overrides, "cameraEvidenceJson")
    ? overrides.cameraEvidenceJson
    : stableStringify({
        cameraMetadata: true,
        capturedAtMs,
        capturedFileBytes,
        captureEvidenceDelayMs: 250,
        captureSurface: "native_android_camera",
        collectedAtMs: capturedAtMs + 250,
        noGalleryImport: true,
      });
  const deviceIntegrityJson = hasOwn(overrides, "deviceIntegrityJson")
    ? overrides.deviceIntegrityJson
    : buildDeviceIntegrityJson({
        appIdentityHash,
        sampledAtMs: capturedAtMs,
      });
  const imageHash = hasOwn(overrides, "imageHash")
    ? overrides.imageHash
    : sha256Hex(Buffer.from(photoBytesBase64 ?? defaultPhotoBytesBase64, "base64"));
  const manifest = {
    schema_version: "argus.manifest.v1",
    partner_id_hash: partnerIdHash,
    use_case: useCase,
    capture_session_id: captureSessionId,
    captured_at_ms: capturedAtMs,
    image_sha256: imageHash,
    metadata_commitment: sha256Hex(metadataJson ?? ""),
    camera_evidence_commitment: sha256Hex(cameraEvidenceJson ?? ""),
    device_integrity_commitment: sha256Hex(deviceIntegrityJson ?? ""),
    app_identity_hash: appIdentityHash,
    nonce,
    proof_level: proofLevel,
  };
  const computedCanonicalManifestJson = canonicalManifestStringify(manifest);
  const canonicalManifestJson = hasOwn(overrides, "canonicalManifestJson")
    ? overrides.canonicalManifestJson
    : computedCanonicalManifestJson;
  const manifestHash = hasOwn(overrides, "manifestHash")
    ? overrides.manifestHash
    : sha256Hex(canonicalManifestJson ?? computedCanonicalManifestJson);
  const proofId = hasOwn(overrides, "proofId")
    ? overrides.proofId
    : deriveProofId(manifestHash, imageHash, nonce);

  return {
    proofId,
    manifestHash,
    imageHash,
    partnerIdHash,
    canonicalManifestJson,
    metadataJson,
    cameraEvidenceJson,
    deviceIntegrityJson,
    photoBytesBase64,
    captureSessionId,
    nonce,
    appIdentityHash,
    proofLevel,
    capturedAt,
    partnerId,
    useCase,
    verificationUrl: `https://verify.argus.dev/proof/${proofId}`,
    integrityLevel,
    deviceEvidenceSummary: {
      cameraMetadata: true,
      motionSnapshot: true,
      appIdentityHash: true,
      keystoreSignature: false,
      evidenceLevel: "level_2_native_capture",
      androidEvidenceLevel: 2,
      level3KeystoreSignature: false,
      level4HardwareAttestation: false,
      attestationStatus: "level_4_unsupported_fell_back_to_level_2",
      keystorePublicKeyPem: "",
      attestationCertificateChainPem: [],
    },
    ...overrides,
  };
}

function buildLocalDemoProof(overrides = {}) {
  const { proofRecord: proofRecordOverrides, ...proofOverrides } = overrides;
  const proof = buildProof({
    proofLevel: "demo",
    integrityLevel: "demo",
    relayer: ARGUS_LOCAL_DEMO_RELAYER,
    feePayer: ARGUS_LOCAL_DEMO_RELAYER,
    sponsoredGas: false,
    registryAddress: ARGUS_REGISTRY_PROGRAM_ID,
    registryProgramId: ARGUS_REGISTRY_PROGRAM_ID,
    ...proofOverrides,
  });
  const verificationUrl = hasOwn(proofOverrides, "verificationUrl")
    ? proofOverrides.verificationUrl
    : `argus://verify/local-simulator/${proof.proofId}`;

  return {
    ...proof,
    verificationUrl,
    proofRecord: {
      proofId: proof.proofId,
      manifestHash: proof.manifestHash,
      imageHash: proof.imageHash,
      partnerIdHash: proof.partnerIdHash,
      proofLevel: "demo",
      captureTimestamp: Date.parse(proof.capturedAt),
      registeredAt: "2026-05-01T16:00:10.000Z",
      relayer: ARGUS_LOCAL_DEMO_RELAYER,
      relayerAuthorized: false,
      registryProgramId: ARGUS_REGISTRY_PROGRAM_ID,
      status: "superseded",
      ...proofRecordOverrides,
    },
  };
}

function buildProofWithManifestOverrides(manifestOverrides = {}) {
  const proof = buildProof();
  const manifest = {
    ...JSON.parse(proof.canonicalManifestJson),
    ...manifestOverrides,
  };

  return rebindProofToManifest(proof, manifest);
}

function rebindProofEvidence(proof, evidenceOverrides = {}) {
  const metadataJson = hasOwn(evidenceOverrides, "metadataJson")
    ? evidenceOverrides.metadataJson
    : proof.metadataJson;
  const cameraEvidenceJson = hasOwn(evidenceOverrides, "cameraEvidenceJson")
    ? evidenceOverrides.cameraEvidenceJson
    : proof.cameraEvidenceJson;
  const deviceIntegrityJson = hasOwn(evidenceOverrides, "deviceIntegrityJson")
    ? evidenceOverrides.deviceIntegrityJson
    : proof.deviceIntegrityJson;
  const manifest = {
    ...JSON.parse(proof.canonicalManifestJson),
    metadata_commitment: sha256Hex(metadataJson ?? ""),
    camera_evidence_commitment: sha256Hex(cameraEvidenceJson ?? ""),
    device_integrity_commitment: sha256Hex(deviceIntegrityJson ?? ""),
  };

  return rebindProofToManifest(
    {
      ...proof,
      metadataJson,
      cameraEvidenceJson,
      deviceIntegrityJson,
    },
    manifest,
  );
}

function buildNonPositiveCaptureTimestampProof() {
  return buildProof({
    capturedAt: "1970-01-01T00:00:00.000Z",
    cameraEvidenceJson:
      "{\"cameraMetadata\":true,\"capturedAtMs\":0,\"captureSurface\":\"native_android_camera\",\"noGalleryImport\":true}",
    deviceIntegrityJson: buildDeviceIntegrityJson({
      appIdentityHash: "6".repeat(64),
      sampledAtMs: 1,
    }),
  });
}

function rebindProofToManifest(proof, manifest) {
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const imageHash = manifest.image_sha256;
  const proofId = deriveProofId(manifestHash, imageHash, manifest.nonce);

  return {
    ...proof,
    proofId,
    manifestHash,
    imageHash,
    partnerIdHash: manifest.partner_id_hash,
    canonicalManifestJson,
    captureSessionId: manifest.capture_session_id,
    nonce: manifest.nonce,
    proofLevel: manifest.proof_level,
    integrityLevel: manifest.proof_level,
    verificationUrl: `https://verify.argus.dev/proof/${proofId}`,
  };
}

function buildRegistration(proof, overrides = {}) {
  const proofRecord = {
    proofId: proof.proofId,
    manifestHash: proof.manifestHash,
    imageHash: proof.imageHash,
    partnerIdHash: proof.partnerIdHash,
    proofLevel: proof.proofLevel ?? proof.integrityLevel,
    captureTimestamp: Date.parse(proof.capturedAt),
    registeredAt: "2026-05-01T16:00:10.000Z",
    relayer: ARGUS_AUTHORIZED_RELAYER,
    relayerAuthorized: true,
    registryProgramId: ARGUS_REGISTRY_PROGRAM_ID,
    status: "active",
    ...overrides.proofRecord,
  };

  return {
    proofId: proof.proofId,
    manifestHash: proof.manifestHash,
    solanaTx: "7".repeat(64),
    registryAddress: ARGUS_REGISTRY_PROGRAM_ID,
    registryProgramId: ARGUS_REGISTRY_PROGRAM_ID,
    relayer: ARGUS_AUTHORIZED_RELAYER,
    feePayer: ARGUS_AUTHORIZED_RELAYER,
    sponsoredGas: true,
    verificationUrl: `https://verify.argus.dev/proof/${proof.proofId}`,
    ...overrides,
    proofRecord,
  };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function buildDeviceIntegrityJson({ appIdentityHash, sampledAtMs, sampleWindowMs = 180 }) {
  return stableStringify({
    appIdentityHash,
    appIdentityHashPresent: true,
    androidEvidenceLevel: 2,
    attestationCertificateChainPem: [],
    attestationStatus: "level_4_unsupported_fell_back_to_level_2",
    evidenceLevel: "level_2_native_capture",
    hardwareAttestation: {
      fallbackLevel: 2,
      reason: "android_key_attestation_unavailable",
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
      sampledAtMs,
      sampleWindowMs,
    },
  });
}

function minimalJpegBytes() {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x00,
    0xff, 0xd9,
  ]);
}

function malformedScanComponentJpegBytes() {
  const bytes = Array.from(minimalJpegBytes());
  bytes[17] = 0x00;
  bytes[18] = 0x0a;
  bytes[19] = 0x02;
  bytes.splice(22, 0, 0x02, 0x00);
  return Uint8Array.from(bytes);
}

function scanComponentMissingFromFrameJpegBytes() {
  const bytes = Array.from(minimalJpegBytes());
  bytes[20] = 0x02;
  return Uint8Array.from(bytes);
}

function duplicateStartOfFrameJpegBytes() {
  const bytes = Array.from(minimalJpegBytes());
  bytes.splice(15, 0, ...singleComponentStartOfFrameSegment(0x01));
  return Uint8Array.from(bytes);
}

function singleComponentStartOfFrameSegment(componentId) {
  return [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, componentId, 0x11, 0x00];
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
