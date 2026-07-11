import { getConfig } from "./config.ts";
import {
  canonicalJsonNumberLexeme,
  canonicalJsonValidationError,
  isCanonicalJson,
} from "./canonicalJson.ts";
import type { ArgusEvidenceLevel, ArgusIntegrityLevel, ArgusProof } from "./types";

export const ARGUS_REGISTRY_PROGRAM_ID = "STmkbEWTmfBJR2mDHrbvKNjo2spT6mPU9668mw2hMaL";
export const ARGUS_AUTHORIZED_RELAYER = "Ao3Vi2HeQHWyyPDA52rqVLYv8nt7pvAVQtPB1qw2pvTs";
export const ARGUS_LOCAL_DEMO_RELAYER = "ArgusLocalDemoRelayer111111111111111111111111";
const ARGUS_MANIFEST_SCHEMA_VERSION = "argus.manifest.v1";
const ARGUS_DEFAULT_VERIFIER_ORIGIN = "https://verify.argus.dev";
const MAX_CANONICAL_MANIFEST_JSON_BYTES = 4 * 1024;
const MAX_METADATA_JSON_BYTES = 64 * 1024;
const MAX_EVIDENCE_JSON_BYTES = 64 * 1024;
const MAX_NATIVE_CAPTURE_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_NATIVE_CAPTURE_PHOTO_BASE64_LENGTH = Math.ceil(MAX_NATIVE_CAPTURE_PHOTO_BYTES / 3) * 4;
const MAX_CAMERA_EVIDENCE_DELAY_MS = 5_000;
const MAX_MOTION_CAPTURE_DELTA_MS = 2_000;
const ARGUS_EVIDENCE_LEVEL_2 = "level_2_native_capture";
const ARGUS_LEVEL_4_FALLBACK_TO_LEVEL_2 = "level_4_unsupported_fell_back_to_level_2";
const ARGUS_LEVEL_4_MATERIAL_PENDING_RELAY_VALIDATION =
  "level_4_material_present_pending_relayer_root_validation";
const ARGUS_LEVEL_4_TRUSTED_ROOT_VALIDATED = "level_4_trusted_root_validated";
const ARGUS_KEYSTORE_SIGNATURE_ALGORITHMS = new Set(["SHA256withECDSA", "SHA256withRSA"]);

export function getArgusProofLevel(proof?: ArgusProof | null): ArgusIntegrityLevel | undefined {
  return proof?.proofLevel ?? proof?.integrityLevel;
}

// kr: evidence level은 committed device evidence의 표시용 계층입니다. Level 4는 chain뿐 아니라 trusted attestation root/fingerprint 검증 완료 신호까지 필요합니다.
// en: Evidence level is a display hierarchy for committed device evidence. Level 4 needs chain material plus a trusted attestation root/fingerprint validation signal.
export function getArgusEvidenceLevel(proof?: ArgusProof | null): ArgusEvidenceLevel | undefined {
  if (!proof) {
    return undefined;
  }

  const proofLevel = getArgusProofLevel(proof);
  if (proofLevel === "demo") {
    return "level_1_demo";
  }

  const summary = proof.deviceEvidenceSummary;
  const deviceIntegrity = parseObjectJson(proof.deviceIntegrityJson, MAX_EVIDENCE_JSON_BYTES);
  const hasNativeEvidence =
    summary?.cameraMetadata === true &&
    summary.motionSnapshot === true &&
    summary.appIdentityHash === true;
  const hasLevel3Evidence = Boolean(
    hasNativeEvidence &&
      deviceIntegrity &&
      (level3KeystoreEvidenceMatches(deviceIntegrity) ||
        level4MaterialFallsBackToLevel3Evidence(deviceIntegrity)),
  );
  const hasLevel4Evidence = Boolean(
    hasNativeEvidence && deviceIntegrity && level4HardwareAttestationEvidenceMatches(deviceIntegrity),
  );
  const hasRelayerAcceptedLevel4Evidence = Boolean(
    hasNativeEvidence && relayerAcceptedLevel4EvidenceMatches(summary),
  );

  if (hasLevel4Evidence || hasRelayerAcceptedLevel4Evidence) {
    return "level_4_hardware_attestation";
  }

  if (hasLevel3Evidence) {
    return "level_3_keystore_signature";
  }

  if (hasNativeEvidence) {
    return "level_2_native_capture";
  }

  return undefined;
}

export function getArgusEvidenceLevelLabel(proof?: ArgusProof | null): string | undefined {
  const evidenceLevel = getArgusEvidenceLevel(proof);
  if (!evidenceLevel) {
    return undefined;
  }

  const baseLabel = formatArgusEvidenceLevel(evidenceLevel);
  const deviceIntegrity = parseObjectJson(proof?.deviceIntegrityJson, MAX_EVIDENCE_JSON_BYTES);
  const committedLevel =
    typeof deviceIntegrity?.evidenceLevel === "string" ? deviceIntegrity.evidenceLevel : undefined;
  const claimedLevel = committedLevel ?? proof?.deviceEvidenceSummary?.evidenceLevel;
  if (
    evidenceLevel === "level_3_keystore_signature" &&
    hasPendingLevel4MaterialRelayerValidation(deviceIntegrity, proof)
  ) {
    return "Level 3 - hardware attestation material pending relayer validation";
  }

  if (
    claimedLevel === "level_4_hardware_attestation" &&
    evidenceLevel !== "level_4_hardware_attestation"
  ) {
    return `${baseLabel} (Level 4 attestation unavailable)`;
  }

  if (
    claimedLevel === "level_3_keystore_signature" &&
    evidenceLevel === "level_2_native_capture"
  ) {
    return `${baseLabel} (Level 3 public key evidence unavailable)`;
  }

  return baseLabel;
}

function hasPendingLevel4MaterialRelayerValidation(
  deviceIntegrity: Record<string, unknown> | null,
  proof?: ArgusProof | null,
): boolean {
  return Boolean(
    deviceIntegrity?.attestationStatus === ARGUS_LEVEL_4_MATERIAL_PENDING_RELAY_VALIDATION ||
      deviceIntegrity?.level4AttestationMaterial === true ||
      proof?.deviceEvidenceSummary?.attestationStatus === ARGUS_LEVEL_4_MATERIAL_PENDING_RELAY_VALIDATION ||
      proof?.deviceEvidenceSummary?.keystoreAttestationMaterial === true,
  );
}

export function hasArgusKeystorePublicKeyEvidence(proof?: ArgusProof | null): boolean {
  const deviceIntegrity = parseObjectJson(proof?.deviceIntegrityJson, MAX_EVIDENCE_JSON_BYTES);
  return Boolean(deviceIntegrity && deviceIntegrityKeystoreSignatureEvidenceMatches(deviceIntegrity));
}

export function hasArgusHardwareAttestationEvidence(proof?: ArgusProof | null): boolean {
  const deviceIntegrity = parseObjectJson(proof?.deviceIntegrityJson, MAX_EVIDENCE_JSON_BYTES);
  return Boolean(deviceIntegrity && deviceIntegrityHardwareAttestationEvidenceMatches(deviceIntegrity));
}

// kr: 기존 export 이름은 유지하지만 의미는 Level 3 public-key/signature evidence입니다. Level 4는 별도의 trusted-root 검증 gate가 필요합니다.
// en: Keep the legacy export name, but it means Level 3 public-key/signature evidence. Level 4 uses a separate trusted-root validation gate.
export function hasArgusPublicKeyCertificateEvidence(proof?: ArgusProof | null): boolean {
  const deviceIntegrity = parseObjectJson(proof?.deviceIntegrityJson, MAX_EVIDENCE_JSON_BYTES);
  return Boolean(deviceIntegrity && deviceIntegrityKeystoreSignatureEvidenceMatches(deviceIntegrity));
}

function formatArgusEvidenceLevel(evidenceLevel: ArgusEvidenceLevel): string {
  switch (evidenceLevel) {
    case "level_1_demo":
      return "Level 1 - Demo preview";
    case "level_2_native_capture":
      return "Level 2 - Native capture evidence";
    case "level_3_keystore_signature":
      return "Level 3 - Keystore-signed capture";
    case "level_4_hardware_attestation":
      return "Level 4 - Trusted device attestation";
  }
}

export function isSupportedProductionProofLevel(proofLevel?: string): proofLevel is "app_capture" {
  return proofLevel === "app_capture";
}

// kr: transaction id는 registry commitment가 아니지만 verified UI에 표시되므로 Solana signature 모양이 아니면 production proof로 올리지 않습니다.
// en: The transaction id is not a registry commitment, but it is displayed in verified UI, so non-Solana-signature shapes do not promote to production proof.
export function isPlausibleSolanaTransactionSignature(value?: string): value is string {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value);
}

// kr: registeredAt은 proofRecord의 운영 timestamp라서 commitment는 아니지만, malformed/predated 값이 verified record처럼 보이지 않게 묶습니다.
// en: registeredAt is an operational proofRecord timestamp, not a commitment, but bind its shape/order so malformed or predated values do not look verified.
export function isPlausibleProofRecordRegisteredAt(value: unknown, captureTimestamp: unknown): value is string {
  const parsed = strictIsoTimestampMs(value);
  if (
    parsed === null ||
    typeof captureTimestamp !== "number" ||
    !Number.isSafeInteger(captureTimestamp) ||
    captureTimestamp <= 0
  ) {
    return false;
  }

  return parsed >= captureTimestamp;
}

// kr: capturedAt은 proof object의 사람이 읽는 timestamp라서, manifest에 commitment된 millisecond instant와 다르면 fail-closed합니다.
// en: capturedAt is the proof object's human-readable timestamp, so fail closed unless it names the exact millisecond committed in the manifest.
export function isIsoTimestampAtMs(value: unknown, timestampMs: unknown): value is string {
  const parsed = strictIsoTimestampMs(value);
  return (
    parsed !== null &&
    typeof timestampMs === "number" &&
    Number.isSafeInteger(timestampMs) &&
    timestampMs > 0 &&
    parsed === timestampMs
  );
}

function strictIsoTimestampMs(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

// kr: production proof는 native capture evidence와 session/app identity binding이 모두 있을 때만 다음 단계로 보냅니다.
// en: A production proof advances only when native capture evidence and session/app-identity binding are all present.
export function hasRequiredProductionCaptureFields(proof?: ArgusProof | null): boolean {
  const proofLevel = getArgusProofLevel(proof);
  if (!proof || !isSupportedProductionProofLevel(proofLevel)) {
    return false;
  }

  const manifest = parseObjectJson(proof.canonicalManifestJson, MAX_CANONICAL_MANIFEST_JSON_BYTES);

  return (
    isNonZeroHex32(proof.proofId) &&
    isNonZeroHex32(proof.manifestHash) &&
    isNonZeroHex32(proof.imageHash) &&
    isNonZeroHex32(proof.partnerIdHash) &&
    hasText(proof.canonicalManifestJson) &&
    hasBoundedText(proof.metadataJson, MAX_METADATA_JSON_BYTES) &&
    hasBoundedText(proof.cameraEvidenceJson, MAX_EVIDENCE_JSON_BYTES) &&
    hasBoundedText(proof.deviceIntegrityJson, MAX_EVIDENCE_JSON_BYTES) &&
    hasText(proof.photoBytesBase64) &&
    hasText(proof.captureSessionId) &&
    isNonZeroHex32(proof.nonce) &&
    isNonZeroHex32(proof.appIdentityHash) &&
    manifestMatchesProofFields(proof, manifest, proofLevel) &&
    proofBundleHashesMatch(proof, manifest) &&
    productionCameraEvidenceMatches(proof.cameraEvidenceJson, manifest, proof.photoBytesBase64) &&
    productionDeviceIntegrityMatches(
      proof.deviceIntegrityJson,
      proof.appIdentityHash,
      manifest?.captured_at_ms,
    ) &&
    productionEvidenceJsonMatchesRelayerPolicy(proof) &&
    proof.deviceEvidenceSummary?.cameraMetadata === true &&
    proof.deviceEvidenceSummary?.motionSnapshot === true &&
    proof.deviceEvidenceSummary?.appIdentityHash === true &&
    androidEvidencePolicyMatches(parseObjectJson(proof.deviceIntegrityJson, MAX_EVIDENCE_JSON_BYTES))
  );
}

export function getProductionCaptureFieldDiagnostics(proof?: ArgusProof | null) {
  const proofLevel = getArgusProofLevel(proof);
  const supportedProofLevel = isSupportedProductionProofLevel(proofLevel) ? proofLevel : undefined;
  const manifest = parseObjectJson(proof?.canonicalManifestJson, MAX_CANONICAL_MANIFEST_JSON_BYTES);
  const cameraEvidence = parseObjectJson(proof?.cameraEvidenceJson, MAX_EVIDENCE_JSON_BYTES);
  const deviceIntegrity = parseObjectJson(proof?.deviceIntegrityJson, MAX_EVIDENCE_JSON_BYTES);
  const photoBytes = base64ToBytes(proof?.photoBytesBase64);
  const capturedAtMs = manifest?.captured_at_ms;
  const hardwareAttestation = asRecord(deviceIntegrity?.hardwareAttestation);
  const keystoreSignature = asRecord(deviceIntegrity?.keystoreSignature);
  const motionSnapshot = asRecord(deviceIntegrity?.motionSnapshot);
  const manifestCaptureTimestamp =
    typeof capturedAtMs === "number" && Number.isSafeInteger(capturedAtMs) ? capturedAtMs : undefined;
  const sampledAtMs =
    typeof motionSnapshot?.sampledAtMs === "number" && Number.isSafeInteger(motionSnapshot.sampledAtMs)
      ? motionSnapshot.sampledAtMs
      : undefined;
  const collectedAtMs =
    typeof cameraEvidence?.collectedAtMs === "number" && Number.isSafeInteger(cameraEvidence.collectedAtMs)
      ? cameraEvidence.collectedAtMs
      : undefined;

  return {
    parsed: {
      manifest: Boolean(manifest),
      cameraEvidence: Boolean(cameraEvidence),
      deviceIntegrity: Boolean(deviceIntegrity),
      photoBytes: Boolean(photoBytes),
    },
    checks: {
      supportedProofLevel: Boolean(supportedProofLevel),
      proofIdsPresent: Boolean(
        isNonZeroHex32(proof?.proofId) &&
          isNonZeroHex32(proof?.manifestHash) &&
          isNonZeroHex32(proof?.imageHash) &&
          isNonZeroHex32(proof?.partnerIdHash),
      ),
      topLevelFieldsPresent: Boolean(
        hasText(proof?.canonicalManifestJson) &&
          hasBoundedText(proof?.metadataJson, MAX_METADATA_JSON_BYTES) &&
          hasBoundedText(proof?.cameraEvidenceJson, MAX_EVIDENCE_JSON_BYTES) &&
          hasBoundedText(proof?.deviceIntegrityJson, MAX_EVIDENCE_JSON_BYTES) &&
          hasText(proof?.photoBytesBase64) &&
          hasText(proof?.captureSessionId) &&
          isNonZeroHex32(proof?.nonce) &&
          isNonZeroHex32(proof?.appIdentityHash),
      ),
      manifestMatchesProofFields: Boolean(
        proof && manifest && supportedProofLevel && manifestMatchesProofFields(proof, manifest, supportedProofLevel),
      ),
      proofBundleHashesMatch: Boolean(proof && manifest && proofBundleHashesMatch(proof, manifest)),
      cameraEvidenceMatches: Boolean(
        proof && productionCameraEvidenceMatches(proof.cameraEvidenceJson, manifest, proof.photoBytesBase64),
      ),
      deviceIntegrityMatches: Boolean(
        proof && productionDeviceIntegrityMatches(proof.deviceIntegrityJson, proof.appIdentityHash, capturedAtMs),
      ),
      evidenceJsonPolicy: Boolean(proof && productionEvidenceJsonMatchesRelayerPolicy(proof)),
      summaryFlags: Boolean(
        proof?.deviceEvidenceSummary?.cameraMetadata === true &&
          proof.deviceEvidenceSummary.motionSnapshot === true &&
          proof.deviceEvidenceSummary.appIdentityHash === true,
      ),
      androidEvidencePolicy: androidEvidencePolicyMatches(deviceIntegrity),
    },
    jsonPolicy: {
      metadataCanonical: isCanonicalJson(proof?.metadataJson),
      cameraEvidenceCanonical: isCanonicalJson(proof?.cameraEvidenceJson),
      deviceIntegrityCanonical: isCanonicalJson(proof?.deviceIntegrityJson),
      metadataError: canonicalJsonValidationError(proof?.metadataJson),
      cameraEvidenceError: canonicalJsonValidationError(proof?.cameraEvidenceJson),
      deviceIntegrityError: canonicalJsonValidationError(proof?.deviceIntegrityJson),
    },
    photoPolicy: {
      base64Decoded: Boolean(photoBytes),
      decodedBytes: photoBytes?.length ?? 0,
      startsWithJpegSoi: Boolean(photoBytes && byteAt(photoBytes, 0) === 0xff && byteAt(photoBytes, 1) === 0xd8),
      endsWithJpegEoi: Boolean(
        photoBytes &&
          byteAt(photoBytes, photoBytes.length - 2) === 0xff &&
          byteAt(photoBytes, photoBytes.length - 1) === 0xd9,
      ),
      nativeJpegPolicy: Boolean(photoBytes && isNativeJpegPhotoBytes(photoBytes)),
    },
    cameraEvidence: {
      captureSurface: cameraEvidence?.captureSurface,
      noGalleryImport: cameraEvidence?.noGalleryImport,
      cameraMetadata: cameraEvidence?.cameraMetadata,
      capturedFileBytes: cameraEvidence?.capturedFileBytes,
      photoBytesMatch: photoBytes ? cameraEvidence?.capturedFileBytes === photoBytes.length : false,
      capturedAtMatchesManifest: cameraEvidence?.capturedAtMs === capturedAtMs,
      captureEvidenceDelayMs: cameraEvidence?.captureEvidenceDelayMs,
      calculatedDelayMs:
        collectedAtMs !== undefined && manifestCaptureTimestamp !== undefined
          ? collectedAtMs - manifestCaptureTimestamp
          : undefined,
    },
    deviceIntegrity: {
      appIdentityMatches: deviceIntegrity?.appIdentityHash === proof?.appIdentityHash,
      appIdentityHashPresent: deviceIntegrity?.appIdentityHashPresent,
      evidenceLevel: deviceIntegrity?.evidenceLevel,
      androidEvidenceLevel: deviceIntegrity?.androidEvidenceLevel,
      attestationStatus: deviceIntegrity?.attestationStatus,
      level3KeystoreSignature: deviceIntegrity?.level3KeystoreSignature,
      level4AttestationMaterial: deviceIntegrity?.level4AttestationMaterial,
      level4HardwareAttestation: deviceIntegrity?.level4HardwareAttestation,
      level3KeystoreEvidence: deviceIntegrity ? level3KeystoreEvidenceMatches(deviceIntegrity) : false,
      pendingLevel4MaterialShape: deviceIntegrity
        ? level3PendingHardwareAttestationMaterialMatches(deviceIntegrity)
        : false,
      level4MaterialShape: deviceIntegrity ? level4HardwareAttestationMaterialMatches(deviceIntegrity) : false,
    },
    keystoreSignature: {
      present: Boolean(keystoreSignature),
      algorithm: keystoreSignature?.algorithm,
      hasPublicKeyPem: hasText(keystoreSignature?.publicKeyPem as string | undefined),
      hasSignedPayloadJson: hasText(keystoreSignature?.signedPayloadJson as string | undefined),
      hasSignatureBase64: hasText(keystoreSignature?.signatureBase64 as string | undefined),
      publicKeyMatchesTopLevel: keystoreSignature?.publicKeyPem === deviceIntegrity?.keystorePublicKeyPem,
    },
    hardwareAttestation: {
      present: Boolean(hardwareAttestation),
      supported: hardwareAttestation?.supported,
      hardwareBacked: hardwareAttestation?.hardwareBacked,
      rootValidated: hardwareAttestation?.rootValidated,
      fallbackLevel: hardwareAttestation?.fallbackLevel,
      reason: hardwareAttestation?.reason,
      challengeMatchesNonce: hardwareAttestation?.attestationChallengeHex === proof?.nonce,
      publicKeyMatchesKeystore: hardwareAttestation?.publicKeyPem === keystoreSignature?.publicKeyPem,
      certificateChainPemCount: arrayTextCount(hardwareAttestation?.certificateChainPem),
      topLevelCertificateChainPemCount: arrayTextCount(deviceIntegrity?.attestationCertificateChainPem),
    },
    motionSnapshot: {
      available: motionSnapshot?.available,
      accelerometerAvailable: motionSnapshot?.accelerometerAvailable,
      gyroscopeAvailable: motionSnapshot?.gyroscopeAvailable,
      accelerometerCount: Array.isArray(motionSnapshot?.accelerometer) ? motionSnapshot.accelerometer.length : 0,
      gyroscopeCount: Array.isArray(motionSnapshot?.gyroscope) ? motionSnapshot.gyroscope.length : 0,
      sampleWindowMs: motionSnapshot?.sampleWindowMs,
      sampledAtDeltaMs:
        sampledAtMs !== undefined && manifestCaptureTimestamp !== undefined
          ? sampledAtMs - manifestCaptureTimestamp
          : undefined,
    },
  };
}

export function hasRequiredLocalDemoCaptureFields(proof?: ArgusProof | null): boolean {
  const proofLevel = getArgusProofLevel(proof);
  if (!proof || proofLevel !== "demo") {
    return false;
  }

  const manifest = parseObjectJson(proof.canonicalManifestJson, MAX_CANONICAL_MANIFEST_JSON_BYTES);

  return (
    isNonZeroHex32(proof.proofId) &&
    isNonZeroHex32(proof.manifestHash) &&
    isNonZeroHex32(proof.imageHash) &&
    isNonZeroHex32(proof.partnerIdHash) &&
    hasText(proof.canonicalManifestJson) &&
    hasBoundedText(proof.metadataJson, MAX_METADATA_JSON_BYTES) &&
    hasBoundedText(proof.cameraEvidenceJson, MAX_EVIDENCE_JSON_BYTES) &&
    hasBoundedText(proof.deviceIntegrityJson, MAX_EVIDENCE_JSON_BYTES) &&
    hasText(proof.photoBytesBase64) &&
    hasText(proof.captureSessionId) &&
    isNonZeroHex32(proof.nonce) &&
    isNonZeroHex32(proof.appIdentityHash) &&
    manifestMatchesProofFields(proof, manifest, proofLevel) &&
    proofBundleHashesMatch(proof, manifest) &&
    cameraEvidenceMatches(proof.cameraEvidenceJson, true) &&
    localDeviceIntegrityMatches(proof.deviceIntegrityJson, proof.appIdentityHash) &&
    proof.deviceEvidenceSummary?.cameraMetadata === true &&
    proof.deviceEvidenceSummary?.motionSnapshot === true &&
    proof.deviceEvidenceSummary?.appIdentityHash === true &&
    proof.deviceEvidenceSummary?.keystoreSignature === false &&
    proof.deviceEvidenceSummary?.level3KeystoreSignature !== true &&
    proof.deviceEvidenceSummary?.level4HardwareAttestation !== true
  );
}

export function isArgusProductionProof(proof?: ArgusProof | null): boolean {
  return isArgusProductionProofCore(proof) && productionVerificationUrlMatchesProof(proof);
}

// kr: production label은 active record, production-pinned registry program, authorized production relayer fee payer, sponsored gas가 모두 맞을 때만 허용합니다.
// en: The production label is allowed only with an active record, production-pinned registry program, authorized production relayer fee payer, and sponsored gas.
function isArgusProductionProofCore(proof?: ArgusProof | null): boolean {
  if (!proof?.proofRecord) {
    return false;
  }

  const manifest = parseObjectJson(proof.canonicalManifestJson, MAX_CANONICAL_MANIFEST_JSON_BYTES);
  const proofLevel = getArgusProofLevel(proof);
  return (
    isSupportedProductionProofLevel(proofLevel) &&
    hasRequiredProductionCaptureFields(proof) &&
    hasProductionVerifiedEvidence(proof) &&
    proof.partnerIdHash === proof.proofRecord.partnerIdHash &&
    proof.proofRecord.proofId === proof.proofId &&
    proof.proofRecord.manifestHash === proof.manifestHash &&
    proof.proofRecord.imageHash === proof.imageHash &&
    proof.proofRecord.proofLevel === proofLevel &&
    proof.proofRecord.captureTimestamp === manifest?.captured_at_ms &&
    isPlausibleProofRecordRegisteredAt(proof.proofRecord.registeredAt, manifest?.captured_at_ms) &&
    proof.proofRecord.status === "active" &&
    isPlausibleSolanaTransactionSignature(proof.solanaTx) &&
    proof.registryAddress === ARGUS_REGISTRY_PROGRAM_ID &&
    proof.registryProgramId === ARGUS_REGISTRY_PROGRAM_ID &&
    proof.proofRecord.registryProgramId === ARGUS_REGISTRY_PROGRAM_ID &&
    proof.relayer === ARGUS_AUTHORIZED_RELAYER &&
    proof.feePayer === ARGUS_AUTHORIZED_RELAYER &&
    proof.sponsoredGas === true &&
    proof.proofRecord.relayer === ARGUS_AUTHORIZED_RELAYER &&
    proof.proofRecord.relayerAuthorized === true
  );
}

// Level 2 proves a native path was used, but without a verifier-checkable key it is not a production Verified Capture.
function hasProductionVerifiedEvidence(proof?: ArgusProof | null): boolean {
  const evidenceLevel = getArgusEvidenceLevel(proof);
  return evidenceLevel === "level_3_keystore_signature" || evidenceLevel === "level_4_hardware_attestation";
}

export function isArgusLocalDemoProof(proof?: ArgusProof | null): boolean {
  return isArgusLocalDemoProofCore(proof) && localDemoVerificationUrlMatchesProof(proof);
}

// kr: local demo preview는 의도적으로 downgraded 상태입니다. superseded/unauthorized/local relayer와 unsponsored fee payer가 아니면 preview로도 통과하지 않습니다.
// en: Local demo previews are intentionally downgraded; without superseded/unauthorized/local-relayer and unsponsored fee-payer fields they do not pass even as preview.
function isArgusLocalDemoProofCore(proof?: ArgusProof | null): boolean {
  const proofLevel = getArgusProofLevel(proof);
  const manifest = parseObjectJson(proof?.canonicalManifestJson, MAX_CANONICAL_MANIFEST_JSON_BYTES);

  return (
    proofLevel === "demo" &&
    hasRequiredLocalDemoCaptureFields(proof) &&
    proof?.proofRecord?.proofLevel === "demo" &&
    proof.proofRecord.proofId === proof.proofId &&
    proof.proofRecord.manifestHash === proof.manifestHash &&
    proof.proofRecord.imageHash === proof.imageHash &&
    proof.proofRecord.partnerIdHash === proof.partnerIdHash &&
    proof.proofRecord.captureTimestamp === manifest?.captured_at_ms &&
    isPlausibleProofRecordRegisteredAt(proof.proofRecord.registeredAt, manifest?.captured_at_ms) &&
    proof.proofRecord.status === "superseded" &&
    proof.registryAddress === ARGUS_REGISTRY_PROGRAM_ID &&
    proof.registryProgramId === ARGUS_REGISTRY_PROGRAM_ID &&
    proof.proofRecord.registryProgramId === ARGUS_REGISTRY_PROGRAM_ID &&
    proof.relayer === ARGUS_LOCAL_DEMO_RELAYER &&
    proof.feePayer === ARGUS_LOCAL_DEMO_RELAYER &&
    proof.sponsoredGas === false &&
    proof.proofRecord.relayer === ARGUS_LOCAL_DEMO_RELAYER &&
    proof.proofRecord.relayerAuthorized === false
  );
}

export function isSafeArgusVerificationUrl(value?: string): value is string {
  if (!hasText(value)) {
    return false;
  }

  const trimmed = value.trim();

  if (trimmed.startsWith("//")) {
    return false;
  }

  // kr: proof link에 scheme이 있으면 명시적인 authority까지 있어야 합니다. `https:host/path`를 URL parser가 보정하게 두지 않습니다.
  // en: If a proof link has a scheme, it must also have an explicit authority; do not let the URL parser repair `https:host/path`.
  if (hasSchemeWithoutAuthority(trimmed)) {
    return false;
  }

  if (hasRawPathTraversalSegments(trimmed)) {
    return false;
  }

  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    try {
      const parsed = new URL(trimmed, "https://argus.local");
      const localProofId = parsed.pathname.startsWith("/proof/")
        ? parsed.pathname.slice("/proof/".length)
        : undefined;
      return (
        parsed.origin === "https://argus.local" &&
        parsed.search === "" &&
        parsed.hash === "" &&
        isNonZeroHex32(localProofId)
      );
    } catch {
      return false;
    }
  }

  try {
    const parsed = new URL(trimmed);
    // kr: 이 helper는 소비자 링크 게이트로도 쓰일 수 있으므로 proof binding 전에도 relayer entrypoint의 no query/hash 정책을 맞춥니다.
    // en: This helper can gate consumer-opened links, so mirror the relayer entrypoint no-query/hash rule before proof binding.
    if (parsed.search !== "" || parsed.hash !== "") {
      return false;
    }

    if (parsed.protocol === "https:") {
      return (
        hasNoCredentials(parsed) &&
        isTrustedVerifierOrigin(parsed) &&
        verifierPathHasCanonicalProofId(parsed)
      );
    }

    if (parsed.protocol === "http:") {
      return hasNoCredentials(parsed) && isLoopbackHost(parsed.hostname) && verifierPathHasCanonicalProofId(parsed);
    }

    return (
      parsed.protocol === "argus:" &&
      parsed.hostname === "verify" &&
      hasNoCredentials(parsed) &&
      argusPathHasCanonicalProofId(parsed)
    );
  } catch {
    return false;
  }
}

export function getSafeArgusVerificationUrl(proof?: ArgusProof | null): string | undefined {
  const verificationUrl = proof?.verificationUrl?.trim();
  return isSafeArgusVerificationUrl(verificationUrl) && proofIdIsBoundToVerificationUrl(verificationUrl, proof)
    ? verificationUrl
    : undefined;
}

function hasText(value?: string): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayTextCount(value: unknown): number {
  return Array.isArray(value) ? value.filter((entry) => hasText(entry as string | undefined)).length : 0;
}

function hasBoundedText(value: string | undefined, maxUtf8Bytes: number): value is string {
  return hasText(value) && textToBytes(value).length <= maxUtf8Bytes;
}

function isNonZeroHex32(value?: string): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) && !/^0{64}$/.test(value);
}

function proofIdIsBoundToVerificationUrl(value: string, proof?: ArgusProof | null): boolean {
  const proofId = proof?.proofId;
  if (!isNonZeroHex32(proofId)) {
    return false;
  }

  try {
    const parsed = new URL(value, "https://argus.local");

    if (isArgusProductionProofCore(proof)) {
      return productionProofUrlMatches(parsed, proofId);
    }

    if (!isArgusLocalDemoProofCore(proof)) {
      return false;
    }

    return localDemoProofUrlMatches(parsed, proofId, value);
  } catch {
    return false;
  }
}

function productionVerificationUrlMatchesProof(proof?: ArgusProof | null): boolean {
  const verificationUrl = proof?.verificationUrl?.trim();
  const proofId = proof?.proofId;
  if (!hasText(verificationUrl) || !isNonZeroHex32(proofId)) {
    return false;
  }

  try {
    return (
      isSafeArgusVerificationUrl(verificationUrl) &&
      productionProofUrlMatches(new URL(verificationUrl), proofId)
    );
  } catch {
    return false;
  }
}

function localDemoVerificationUrlMatchesProof(proof?: ArgusProof | null): boolean {
  const verificationUrl = proof?.verificationUrl?.trim();
  const proofId = proof?.proofId;
  if (!hasText(verificationUrl) || !isNonZeroHex32(proofId)) {
    return false;
  }

  try {
    const parsed = new URL(verificationUrl, "https://argus.local");
    return isSafeArgusVerificationUrl(verificationUrl) && localDemoProofUrlMatches(parsed, proofId, verificationUrl);
  } catch {
    return false;
  }
}

function localDemoProofUrlMatches(parsed: URL, proofId: string, rawValue: string): boolean {
  if (!isLocalDemoVerifierUrl(parsed)) {
    return false;
  }

  const proofIdInPath =
    parsed.search === "" &&
    ((parsed.protocol === "argus:" &&
      parsed.pathname === `/local-simulator/${proofId}` &&
      rawValue === `argus://verify/local-simulator/${proofId}`) ||
      ((parsed.origin === "https://argus.local" ||
        ((parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopbackHost(parsed.hostname))) &&
        parsed.pathname === `/proof/${proofId}` &&
        rawLocalDemoProofPathMatches(rawValue, proofId)));
  return parsed.hash === "" && proofIdInPath;
}

function rawLocalDemoProofPathMatches(value: string, proofId: string): boolean {
  if (value === `/proof/${proofId}`) {
    return true;
  }

  return rawPathFromAbsoluteUrl(value) === `/proof/${proofId}`;
}

function isLocalDemoVerifierUrl(parsed: URL): boolean {
  return (
    parsed.origin === "https://argus.local" ||
    (parsed.protocol === "argus:" && parsed.hostname === "verify") ||
    ((parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopbackHost(parsed.hostname))
  );
}

function cameraEvidenceMatches(value: string | undefined, allowSimulatorSurface: boolean): boolean {
  const cameraEvidence = parseObjectJson(value, MAX_EVIDENCE_JSON_BYTES);
  if (!cameraEvidence) {
    return false;
  }

  return (
    cameraEvidence.noGalleryImport === true &&
    (cameraEvidence.captureSurface === "native_android_camera" ||
      (allowSimulatorSurface && cameraEvidence.captureSurface === "android-native-camera-stub"))
  );
}

function productionCameraEvidenceMatches(
  value: string | undefined,
  manifest: Record<string, unknown> | null,
  photoBytesBase64: string | undefined,
): boolean {
  // kr: app_capture는 basic JPEG-like byte gate와 camera timing을 함께 확인하지만 image forensics를 하지는 않습니다.
  // en: app_capture combines a basic JPEG-like byte gate with camera timing; it is not image forensics.
  const cameraEvidence = parseObjectJson(value, MAX_EVIDENCE_JSON_BYTES);
  const photoBytes = base64ToBytes(photoBytesBase64);
  if (!cameraEvidence || !photoBytes || !isNativeJpegPhotoBytes(photoBytes)) {
    return false;
  }

  return (
    cameraEvidence.noGalleryImport === true &&
    cameraEvidence.captureSurface === "native_android_camera" &&
    cameraEvidence.cameraMetadata === true &&
    Number.isSafeInteger(cameraEvidence.capturedFileBytes) &&
    cameraEvidence.capturedFileBytes === photoBytes.length &&
    canonicalJsonIntegerMatches(value, ["capturedFileBytes"], cameraEvidence.capturedFileBytes) &&
    Number.isSafeInteger(cameraEvidence.capturedAtMs) &&
    cameraEvidence.capturedAtMs === manifest?.captured_at_ms &&
    canonicalJsonIntegerMatches(value, ["capturedAtMs"], cameraEvidence.capturedAtMs) &&
    cameraEvidenceFreshnessMatches(cameraEvidence, manifest?.captured_at_ms, value)
  );
}

function cameraEvidenceFreshnessMatches(
  cameraEvidence: Record<string, unknown>,
  capturedAtMs: unknown,
  cameraEvidenceJson: string | undefined,
): boolean {
  if (!Number.isSafeInteger(capturedAtMs) || Number(capturedAtMs) <= 0) {
    return false;
  }

  const collectedAtMs = cameraEvidence.collectedAtMs;
  const captureEvidenceDelayMs = cameraEvidence.captureEvidenceDelayMs;
  if (
    !Number.isSafeInteger(collectedAtMs) ||
    !Number.isSafeInteger(captureEvidenceDelayMs) ||
    Number(collectedAtMs) <= 0 ||
    Number(captureEvidenceDelayMs) < 0
  ) {
    return false;
  }

  const calculatedDelayMs = Number(collectedAtMs) - Number(capturedAtMs);
  return (
    calculatedDelayMs >= 0 &&
    calculatedDelayMs === Number(captureEvidenceDelayMs) &&
    calculatedDelayMs <= MAX_CAMERA_EVIDENCE_DELAY_MS &&
    canonicalJsonIntegerMatches(cameraEvidenceJson, ["collectedAtMs"], collectedAtMs) &&
    canonicalJsonIntegerMatches(cameraEvidenceJson, ["captureEvidenceDelayMs"], captureEvidenceDelayMs)
  );
}

function productionDeviceIntegrityMatches(
  value: string | undefined,
  appIdentityHash: string | undefined,
  capturedAtMs: unknown,
): boolean {
  // kr: device integrity는 앱 identity와 capture 근처 motion evidence를 묶어, 느슨한 metadata만으로 production을 주장하지 못하게 합니다.
  // en: Device integrity binds app identity and near-capture motion evidence so loose metadata cannot claim production.
  const deviceIntegrity = parseObjectJson(value, MAX_EVIDENCE_JSON_BYTES);
  if (!deviceIntegrity) {
    return false;
  }

  return (
    deviceIntegrity.appIdentityHash === appIdentityHash &&
    deviceIntegrity.appIdentityHashPresent === true &&
    androidEvidencePolicyMatches(deviceIntegrity) &&
    hasDetailedMotionEvidence(deviceIntegrity.motionSnapshot, capturedAtMs, value)
  );
}

function localDeviceIntegrityMatches(value: string | undefined, appIdentityHash: string | undefined): boolean {
  const deviceIntegrity = parseObjectJson(value, MAX_EVIDENCE_JSON_BYTES);
  if (!deviceIntegrity) {
    return false;
  }

  return (
    deviceIntegrity.appIdentityHash === appIdentityHash &&
    deviceIntegrity.appIdentityHashPresent === true &&
    deviceIntegrity.level3KeystoreSignature !== true &&
    deviceIntegrity.level4HardwareAttestation !== true &&
    hasLocalDemoMotionEvidence(deviceIntegrity)
  );
}

function androidEvidencePolicyMatches(deviceIntegrity: Record<string, unknown> | null): boolean {
  if (!deviceIntegrity) {
    return false;
  }

  if (level2EvidenceFallbackMatches(deviceIntegrity)) {
    return true;
  }

  if (level3KeystoreEvidenceMatches(deviceIntegrity)) {
    return true;
  }

  if (level3PendingHardwareAttestationMaterialMatches(deviceIntegrity)) {
    return true;
  }

  // kr: registration preflight는 relayer가 root/fingerprint를 검증할 수 있게 Level 4 material shape까지만 허용합니다. UI 승격은 별도 marker를 요구합니다.
  // en: Registration preflight only accepts Level 4 material shape so the relayer can validate the root/fingerprint. UI promotion requires a separate marker.
  return level4HardwareAttestationMaterialMatches(deviceIntegrity);
}

function level2EvidenceFallbackMatches(deviceIntegrity: Record<string, unknown>): boolean {
  return (
    deviceIntegrity.evidenceLevel === ARGUS_EVIDENCE_LEVEL_2 &&
    deviceIntegrity.attestationStatus === ARGUS_LEVEL_4_FALLBACK_TO_LEVEL_2 &&
    deviceIntegrity.androidEvidenceLevel === 2 &&
    deviceIntegrity.keystoreSignature === false &&
    deviceIntegrity.level3KeystoreSignature === false &&
    deviceIntegrity.level4HardwareAttestation === false &&
    deviceIntegrity.keystorePublicKeyPem === "" &&
    Array.isArray(deviceIntegrity.attestationCertificateChainPem) &&
    deviceIntegrity.attestationCertificateChainPem.length === 0 &&
    hardwareAttestationFallbackMatches(deviceIntegrity.hardwareAttestation)
  );
}

function level3KeystoreEvidenceMatches(deviceIntegrity: Record<string, unknown>): boolean {
  return (
    deviceIntegrity.evidenceLevel === "level_3_keystore_signature" &&
    deviceIntegrity.androidEvidenceLevel === 3 &&
    deviceIntegrityKeystoreSignatureEvidenceMatches(deviceIntegrity) &&
    deviceIntegrity.level4HardwareAttestation === false &&
    hardwareAttestationFallbackMatches(deviceIntegrity.hardwareAttestation, 3)
  );
}

function level3PendingHardwareAttestationMaterialMatches(deviceIntegrity: Record<string, unknown>): boolean {
  const hardwareAttestation = deviceIntegrity.hardwareAttestation as Record<string, unknown> | undefined;
  return (
    deviceIntegrity.evidenceLevel === "level_3_keystore_signature" &&
    deviceIntegrity.androidEvidenceLevel === 3 &&
    deviceIntegrity.attestationStatus === ARGUS_LEVEL_4_MATERIAL_PENDING_RELAY_VALIDATION &&
    deviceIntegrity.level4AttestationMaterial === true &&
    deviceIntegrityKeystoreSignatureEvidenceMatches(deviceIntegrity) &&
    deviceIntegrity.level4HardwareAttestation === false &&
    Boolean(hardwareAttestation) &&
    typeof hardwareAttestation === "object" &&
    !Array.isArray(hardwareAttestation) &&
    hardwareAttestation.supported === false &&
    hardwareAttestation.hardwareBacked === true &&
    hardwareAttestation.rootValidated === false &&
    hardwareAttestation.fallbackLevel === 3 &&
    hasText(hardwareAttestation.reason as string | undefined) &&
    hasText(hardwareAttestation.attestationChallengeHex as string | undefined) &&
    hasText(hardwareAttestation.publicKeyPem as string | undefined) &&
    Array.isArray(hardwareAttestation.certificateChainPem) &&
    hardwareAttestation.certificateChainPem.some(
      (certificate) => typeof certificate === "string" && certificate.trim().length > 0,
    ) &&
    Array.isArray(deviceIntegrity.attestationCertificateChainPem) &&
    deviceIntegrity.attestationCertificateChainPem.some(
      (certificate) => typeof certificate === "string" && certificate.trim().length > 0,
    )
  );
}

function level4MaterialFallsBackToLevel3Evidence(deviceIntegrity: Record<string, unknown>): boolean {
  return (
    deviceIntegrity.evidenceLevel === "level_4_hardware_attestation" &&
    deviceIntegrity.androidEvidenceLevel === 4 &&
    deviceIntegrityKeystoreSignatureEvidenceMatches(deviceIntegrity) &&
    !level4HardwareAttestationEvidenceMatches(deviceIntegrity)
  );
}

function level4HardwareAttestationEvidenceMatches(deviceIntegrity: Record<string, unknown>): boolean {
  // kr: RN 클라이언트는 root 검증을 직접 수행하지 않지만, committed evidence에 검증 완료 marker가 없으면 Level 4 표시로 승격하지 않습니다.
  // en: The RN client does not perform root validation, but it will not promote Level 4 display without a committed validation marker.
  const keystoreSignature = deviceIntegrity.keystoreSignature as Record<string, unknown> | undefined;
  const hardwareAttestation = deviceIntegrity.hardwareAttestation as Record<string, unknown> | undefined;
  return (
    deviceIntegrity.evidenceLevel === "level_4_hardware_attestation" &&
    deviceIntegrity.androidEvidenceLevel === 4 &&
    deviceIntegrityHardwareAttestationEvidenceMatches(deviceIntegrity) &&
    hardwareAttestation?.supported === true &&
    hardwareAttestation.hardwareBacked === true &&
    hardwareAttestation.publicKeyPem === keystoreSignature?.publicKeyPem &&
    hasText(hardwareAttestation.attestationChallengeHex as string | undefined) &&
    Array.isArray(hardwareAttestation.certificateChainPem) &&
    hardwareAttestation.certificateChainPem.some(
      (certificate) => typeof certificate === "string" && certificate.trim().length > 0,
    )
  );
}

function level4HardwareAttestationMaterialMatches(deviceIntegrity: Record<string, unknown>): boolean {
  return (
    deviceIntegrity.evidenceLevel === "level_4_hardware_attestation" &&
    deviceIntegrity.androidEvidenceLevel === 4 &&
    deviceIntegrityHardwareAttestationMaterialMatches(deviceIntegrity)
  );
}

function deviceIntegrityKeystoreSignatureEvidenceMatches(deviceIntegrity: Record<string, unknown>): boolean {
  const keystoreSignature = deviceIntegrity.keystoreSignature as Record<string, unknown> | undefined;
  return (
    Boolean(keystoreSignature) &&
    typeof keystoreSignature === "object" &&
    !Array.isArray(keystoreSignature) &&
    ARGUS_KEYSTORE_SIGNATURE_ALGORITHMS.has(keystoreSignature.algorithm as string) &&
    hasText(keystoreSignature.publicKeyPem as string | undefined) &&
    hasText(keystoreSignature.signedPayloadJson as string | undefined) &&
    hasText(keystoreSignature.signatureBase64 as string | undefined) &&
    deviceIntegrity.level3KeystoreSignature === true &&
    deviceIntegrity.keystorePublicKeyPem === keystoreSignature.publicKeyPem
  );
}

function deviceIntegrityHardwareAttestationEvidenceMatches(deviceIntegrity: Record<string, unknown>): boolean {
  return (
    deviceIntegrityHardwareAttestationMaterialMatches(deviceIntegrity) &&
    trustedAttestationRootPolicyMatches(deviceIntegrity)
  );
}

function deviceIntegrityHardwareAttestationMaterialMatches(deviceIntegrity: Record<string, unknown>): boolean {
  const keystoreSignature = deviceIntegrity.keystoreSignature as Record<string, unknown> | undefined;
  const hardwareAttestation = deviceIntegrity.hardwareAttestation as Record<string, unknown> | undefined;
  return (
    deviceIntegrityKeystoreSignatureEvidenceMatches(deviceIntegrity) &&
    deviceIntegrity.level4HardwareAttestation === true &&
    Boolean(hardwareAttestation) &&
    typeof hardwareAttestation === "object" &&
    !Array.isArray(hardwareAttestation) &&
    hardwareAttestation.supported === true &&
    hardwareAttestation.hardwareBacked === true &&
    hardwareAttestation.publicKeyPem === keystoreSignature?.publicKeyPem &&
    hasText(hardwareAttestation.attestationChallengeHex as string | undefined) &&
    Array.isArray(hardwareAttestation.certificateChainPem) &&
    hardwareAttestation.certificateChainPem.some(
      (certificate) => typeof certificate === "string" && certificate.trim().length > 0,
    ) &&
    Array.isArray(deviceIntegrity.attestationCertificateChainPem) &&
    deviceIntegrity.attestationCertificateChainPem.some(
      (certificate) => typeof certificate === "string" && certificate.trim().length > 0,
    )
  );
}

function trustedAttestationRootPolicyMatches(deviceIntegrity: Record<string, unknown>): boolean {
  // kr: cert chain은 Android 입력입니다. nested hardwareAttestation 필드와 top-level marker를 섞으면 stale/부분 marker가 Level 4 표시로 승격될 수 있어 한 top-level marker만 신뢰합니다.
  // en: The cert chain is Android input. Trust one top-level marker only; mixing nested hardwareAttestation fields with top-level status can promote stale/partial markers to Level 4 display.
  return (
    deviceIntegrity.attestationStatus === ARGUS_LEVEL_4_TRUSTED_ROOT_VALIDATED &&
    deviceIntegrity.trustedAttestationRootConfigured === true &&
    deviceIntegrity.trustedAttestationRootValidated === true &&
    isNonZeroHex32(deviceIntegrity.trustedAttestationRootFingerprintSha256 as string | undefined)
  );
}

function relayerAcceptedLevel4EvidenceMatches(
  summary: ArgusProof["deviceEvidenceSummary"],
): boolean {
  return (
    summary?.evidenceLevel === "level_4_hardware_attestation" &&
    summary.level4HardwareAttestation === true &&
    summary.trustedAttestationRootConfigured === true &&
    summary.trustedAttestationRootValidated === true &&
    isNonZeroHex32(summary.trustedAttestationRootFingerprintSha256)
  );
}

function hardwareAttestationFallbackMatches(value: unknown, fallbackLevel = 2): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).supported === false &&
    (value as Record<string, unknown>).fallbackLevel === fallbackLevel &&
    hasText((value as Record<string, unknown>).reason as string | undefined)
  );
}

function hasLocalDemoMotionEvidence(deviceIntegrity: Record<string, unknown> | null): boolean {
  if (deviceIntegrity?.motionSnapshotPresent === true) {
    return true;
  }

  const snapshot = deviceIntegrity?.motionSnapshot;
  return Boolean(
    snapshot &&
      typeof snapshot === "object" &&
      !Array.isArray(snapshot) &&
      (snapshot as Record<string, unknown>).available === true,
  );
}

function hasDetailedMotionEvidence(
  motionSnapshot: unknown,
  capturedAtMs: unknown,
  deviceIntegrityJson?: string,
): boolean {
  if (
    !motionSnapshot ||
    typeof motionSnapshot !== "object" ||
    Array.isArray(motionSnapshot) ||
    !Number.isSafeInteger(capturedAtMs)
  ) {
    return false;
  }

  const snapshot = motionSnapshot as Record<string, unknown>;
  return (
    snapshot.available === true &&
    snapshot.accelerometerAvailable === true &&
    snapshot.gyroscopeAvailable === true &&
    isThreeNumberArray(snapshot.accelerometer) &&
    isThreeNumberArray(snapshot.gyroscope) &&
    Number.isSafeInteger(snapshot.sampledAtMs) &&
    Number.isSafeInteger(snapshot.sampleWindowMs) &&
    Number(snapshot.sampledAtMs) > 0 &&
    Number(snapshot.sampleWindowMs) > 0 &&
    Number(snapshot.sampleWindowMs) <= MAX_MOTION_CAPTURE_DELTA_MS &&
    Math.abs(Number(snapshot.sampledAtMs) - Number(capturedAtMs)) <= MAX_MOTION_CAPTURE_DELTA_MS &&
    canonicalJsonIntegerMatches(deviceIntegrityJson, ["motionSnapshot", "sampledAtMs"], snapshot.sampledAtMs) &&
    canonicalJsonIntegerMatches(deviceIntegrityJson, ["motionSnapshot", "sampleWindowMs"], snapshot.sampleWindowMs)
  );
}

function isThreeNumberArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(item));
}

function manifestMatchesProofFields(
  proof: ArgusProof,
  manifest: Record<string, unknown> | null,
  proofLevel: ArgusIntegrityLevel,
): boolean {
  return (
    Boolean(manifest) &&
    canonicalManifestStringify(manifest as Record<string, unknown>) === proof.canonicalManifestJson &&
    proof.proofLevel === proofLevel &&
    proof.integrityLevel === proofLevel &&
    partnerIdHashMatches(proof.partnerId, proof.partnerIdHash) &&
    manifest?.schema_version === ARGUS_MANIFEST_SCHEMA_VERSION &&
    manifest?.partner_id_hash === proof.partnerIdHash &&
    manifest?.use_case === proof.useCase &&
    manifest?.capture_session_id === proof.captureSessionId &&
    isPositiveSafeInteger(manifest?.captured_at_ms) &&
    isIsoTimestampAtMs(proof.capturedAt, manifest?.captured_at_ms) &&
    manifest?.image_sha256 === proof.imageHash &&
    isNonZeroHex32(asString(manifest?.metadata_commitment)) &&
    isNonZeroHex32(asString(manifest?.camera_evidence_commitment)) &&
    isNonZeroHex32(asString(manifest?.device_integrity_commitment)) &&
    manifest?.app_identity_hash === proof.appIdentityHash &&
    manifest?.nonce === proof.nonce &&
    manifest?.proof_level === proofLevel
  );
}

function partnerIdHashMatches(partnerId: string, partnerIdHash?: string): boolean {
  return hasText(partnerId) && sha256Hex(textToBytes(partnerId)) === partnerIdHash;
}

function proofBundleHashesMatch(
  proof: ArgusProof,
  manifest: Record<string, unknown> | null,
): boolean {
  if (!manifest || !proof.canonicalManifestJson) {
    return false;
  }

  const photoBytes = base64ToBytes(proof.photoBytesBase64);
  if (!photoBytes) {
    return false;
  }

  const manifestHash = sha256Hex(textToBytes(proof.canonicalManifestJson));
  const imageHash = sha256Hex(photoBytes);
  const metadataCommitment = proof.metadataJson ? sha256Hex(textToBytes(proof.metadataJson)) : undefined;
  const cameraEvidenceCommitment = proof.cameraEvidenceJson
    ? sha256Hex(textToBytes(proof.cameraEvidenceJson))
    : undefined;
  const deviceIntegrityCommitment = proof.deviceIntegrityJson
    ? sha256Hex(textToBytes(proof.deviceIntegrityJson))
    : undefined;
  const proofId =
    typeof manifest.nonce === "string" ? deriveProofId(manifestHash, imageHash, manifest.nonce) : undefined;

  return (
    manifestHash === proof.manifestHash &&
    imageHash === proof.imageHash &&
    imageHash === manifest.image_sha256 &&
    metadataCommitment === manifest.metadata_commitment &&
    cameraEvidenceCommitment === manifest.camera_evidence_commitment &&
    deviceIntegrityCommitment === manifest.device_integrity_commitment &&
    proofId === proof.proofId
  );
}

function productionEvidenceJsonMatchesRelayerPolicy(proof: ArgusProof): boolean {
  // kr: proof-bundle store는 trust root가 아니므로 relayer/Rust와 같은 text cap과 canonical JSON을 다시 적용합니다.
  // en: The proof-bundle store is not a trust root, so repeat relayer/Rust text caps and canonical JSON checks.
  return (
    hasBoundedText(proof.metadataJson, MAX_METADATA_JSON_BYTES) &&
    hasBoundedText(proof.cameraEvidenceJson, MAX_EVIDENCE_JSON_BYTES) &&
    hasBoundedText(proof.deviceIntegrityJson, MAX_EVIDENCE_JSON_BYTES) &&
    isCanonicalJson(proof.metadataJson) &&
    isCanonicalJson(proof.cameraEvidenceJson) &&
    isCanonicalJson(proof.deviceIntegrityJson)
  );
}

function canonicalJsonIntegerMatches(
  value: string | undefined,
  path: string[],
  expectedValue: unknown,
): boolean {
  return Number.isSafeInteger(expectedValue) && canonicalJsonNumberLexeme(value, path) === String(expectedValue);
}

function deriveProofId(manifestHash: string, imageHash: string, nonce: string): string | undefined {
  const manifestHashBytes = hexToBytes(manifestHash);
  const imageHashBytes = hexToBytes(imageHash);
  const nonceBytes = hexToBytes(nonce);
  if (!manifestHashBytes || !imageHashBytes || !nonceBytes) {
    return undefined;
  }

  return sha256Hex(concatBytes(textToBytes("argus-proof-v1"), manifestHashBytes, imageHashBytes, nonceBytes));
}

function canonicalManifestStringify(manifest: Record<string, unknown>): string {
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

function parseObjectJson(value?: string, maxUtf8Bytes?: number): Record<string, unknown> | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  if (maxUtf8Bytes !== undefined && textToBytes(value).length > maxUtf8Bytes) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function productionProofUrlMatches(parsed: URL, proofId: string): boolean {
  if (parsed.search !== "" || parsed.hash !== "" || !hasNoCredentials(parsed)) {
    return false;
  }

  const configuredVerifierBaseUrl = getConfiguredVerifierBaseUrl();
  if (parsed.origin === ARGUS_DEFAULT_VERIFIER_ORIGIN) {
    if (
      configuredVerifierBaseUrl &&
      isTrustedVerifierBaseUrl(configuredVerifierBaseUrl) &&
      parsed.origin === configuredVerifierBaseUrl.origin
    ) {
      return parsed.pathname === expectedProofPath(configuredVerifierBaseUrl, proofId);
    }

    return parsed.pathname === `/proof/${encodeURIComponent(proofId)}`;
  }

  if (
    configuredVerifierBaseUrl &&
    isTrustedVerifierBaseUrl(configuredVerifierBaseUrl) &&
    parsed.origin === configuredVerifierBaseUrl.origin
  ) {
    return parsed.pathname === expectedProofPath(configuredVerifierBaseUrl, proofId);
  }

  return false;
}

function expectedProofPath(verifierBaseUrl: URL, proofId: string): string {
  const basePath = verifierBaseUrl.pathname.replace(/\/+$/, "");
  return `${basePath}/proof/${encodeURIComponent(proofId)}`;
}

function verifierPathHasCanonicalProofId(parsed: URL): boolean {
  const configuredVerifierBaseUrl = getConfiguredVerifierBaseUrl();
  if (
    configuredVerifierBaseUrl &&
    isTrustedVerifierBaseUrl(configuredVerifierBaseUrl) &&
    parsed.origin === configuredVerifierBaseUrl.origin
  ) {
    const configuredBasePath = configuredVerifierBaseUrl.pathname.replace(/\/+$/, "");
    if (configuredBasePath !== "") {
      return isNonZeroHex32(proofIdFromExactPath(parsed.pathname, `${configuredBasePath}/proof/`));
    }
  }

  return isNonZeroHex32(proofIdFromExactPath(parsed.pathname, "/proof/"));
}

function argusPathHasCanonicalProofId(parsed: URL): boolean {
  return (
    isNonZeroHex32(proofIdFromExactPath(parsed.pathname, "/")) ||
    isNonZeroHex32(proofIdFromExactPath(parsed.pathname, "/local-simulator/"))
  );
}

function proofIdFromExactPath(pathname: string, prefix: string): string | undefined {
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }

  const proofId = pathname.slice(prefix.length);
  return proofId !== "" && !proofId.includes("/") ? proofId : undefined;
}

function isTrustedVerifierOrigin(url: URL): boolean {
  if (url.origin === ARGUS_DEFAULT_VERIFIER_ORIGIN || isLoopbackHost(url.hostname)) {
    return true;
  }

  const configuredVerifierBaseUrl = getConfiguredVerifierBaseUrl();
  return Boolean(
    configuredVerifierBaseUrl &&
      isTrustedVerifierBaseUrl(configuredVerifierBaseUrl) &&
      url.origin === configuredVerifierBaseUrl.origin,
  );
}

function getConfiguredVerifierBaseUrl(): URL | null {
  try {
    const verifierBaseUrl = getConfig().verifierBaseUrl;
    // kr: configured verifier는 production link 판단의 trust root입니다. repaired URL이나 raw traversal을 허용하면 proof link allowlist가 우회될 수 있습니다.
    // en: The configured verifier is the trust root for production link decisions; repaired URLs or raw traversal could bypass proof-link allowlisting.
    if (!hasAbsoluteUrlAuthority(verifierBaseUrl) || hasRawPathTraversalSegments(verifierBaseUrl)) {
      return null;
    }

    return new URL(verifierBaseUrl);
  } catch {
    return null;
  }
}

function isSafeVerifierBaseUrl(url: URL): boolean {
  return (
    hasNoCredentials(url) &&
    url.search === "" &&
    url.hash === "" &&
    (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname)))
  );
}

function isTrustedVerifierBaseUrl(url: URL): boolean {
  return isSafeVerifierBaseUrl(url);
}

function hasNoCredentials(url: URL): boolean {
  return url.username === "" && url.password === "";
}

function hasSchemeWithoutAuthority(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) && !hasAbsoluteUrlAuthority(value);
}

function hasAbsoluteUrlAuthority(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function hasRawPathTraversalSegments(value: string): boolean {
  const path = rawPathFromAbsoluteUrl(value);
  if (path === null) {
    return false;
  }

  // kr: raw slash/backslash path가 trust boundary입니다. parser가 정규화하기 전에 traversal만 fail-closed로 막습니다.
  // en: The raw slash/backslash path is the trust boundary; fail closed on traversal before parser normalization.
  return [path, path.replace(/%2f|%5c/gi, "/")].some((candidatePath) =>
    candidatePath.split(/[\\/]/).some((segment) => {
      const normalizedSegment = segment.replace(/%2e/gi, ".");
      return normalizedSegment === "." || normalizedSegment === "..";
    }),
  );
}

function rawPathFromAbsoluteUrl(value: string): string | null {
  const schemeSeparatorIndex = value.indexOf("://");
  if (schemeSeparatorIndex === -1) {
    // kr: WHATWG URL은 `https:\host\..\x`도 정규화하므로, `://`가 없어도 raw path로 검사합니다.
    // en: WHATWG URL normalizes `https:\host\..\x`, so no-`://` forms are inspected as raw paths too.
    return rawPathFromIndex(value, 0);
  }

  const authorityStartIndex = schemeSeparatorIndex + 3;
  const slashPathStartIndex = value.indexOf("/", authorityStartIndex);
  const backslashPathStartIndex = value.indexOf("\\", authorityStartIndex);
  const pathStartCandidates = [slashPathStartIndex, backslashPathStartIndex].filter(
    (index) => index !== -1,
  );
  if (pathStartCandidates.length === 0) {
    return "";
  }

  const pathStartIndex = Math.min(...pathStartCandidates);
  return rawPathFromIndex(value, pathStartIndex);
}

function rawPathFromIndex(value: string, pathStartIndex: number): string {
  const queryStartIndex = value.indexOf("?", pathStartIndex);
  const hashStartIndex = value.indexOf("#", pathStartIndex);
  const pathEndIndex = [queryStartIndex, hashStartIndex]
    .filter((index) => index !== -1)
    .reduce((lowest, index) => Math.min(lowest, index), value.length);

  return value.slice(pathStartIndex, pathEndIndex);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isPositiveSafeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function textToBytes(value: string): Uint8Array {
  const bytes: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.codePointAt(index) ?? 0xfffd;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    } else if (codePoint > 0xffff) {
      index += 1;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return Uint8Array.from(bytes);
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

function base64ToBytes(value?: string): Uint8Array | null {
  if (
    !value ||
    typeof value !== "string" ||
    value.length > MAX_NATIVE_CAPTURE_PHOTO_BASE64_LENGTH ||
    /\s/.test(value)
  ) {
    return null;
  }

  if (value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) {
    return null;
  }

  const firstPadding = value.indexOf("=");
  const paddingMatch = value.match(/=+$/);
  const padding = paddingMatch ? paddingMatch[0].length : 0;
  if (padding > 2 || (firstPadding !== -1 && firstPadding !== value.length - padding)) {
    return null;
  }

  if (!base64HasCanonicalTrailingBits(value, padding)) {
    return null;
  }

  const outputLength = Math.floor((value.length * 3) / 4) - padding;
  if (outputLength > MAX_NATIVE_CAPTURE_PHOTO_BYTES) {
    return null;
  }

  const bytes = new Uint8Array(outputLength);
  let buffer = 0;
  let bits = 0;
  let byteIndex = 0;

  for (const character of value) {
    if (character === "=") {
      break;
    }

    const base64Value = BASE64_ALPHABET.indexOf(character);
    if (base64Value < 0) {
      return null;
    }

    buffer = (buffer << 6) | base64Value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (byteIndex < outputLength) {
        bytes[byteIndex] = (buffer >> bits) & 0xff;
        byteIndex += 1;
      }
    }
  }

  return byteIndex === outputLength ? bytes : null;
}

function base64HasCanonicalTrailingBits(value: string, padding: number): boolean {
  const checkedCharacter =
    padding === 2 ? value[value.length - 3] : padding === 1 ? value[value.length - 2] : undefined;
  if (!checkedCharacter) {
    return true;
  }

  const checkedValue = BASE64_ALPHABET.indexOf(checkedCharacter);
  if (checkedValue < 0) {
    return false;
  }

  const unusedBits = padding === 2 ? 4 : 2;
  return (checkedValue & ((1 << unusedBits) - 1)) === 0;
}

// kr: isNativeJpegPhotoBytes는 production byte policy용 구조 검사이며 사진 내용의 진실성이나 AI 여부를 판단하지 않습니다.
// en: isNativeJpegPhotoBytes is a structural production byte-policy check, not a test of scene truth or AI generation.
export function isNativeJpegPhotoBytes(bytes: Uint8Array): boolean {
  if (
    bytes.length > MAX_NATIVE_CAPTURE_PHOTO_BYTES ||
    bytes.length < 12 ||
    byteAt(bytes, 0) !== 0xff ||
    byteAt(bytes, 1) !== 0xd8 ||
    byteAt(bytes, bytes.length - 2) !== 0xff ||
    byteAt(bytes, bytes.length - 1) !== 0xd9
  ) {
    return false;
  }

  let index = 2;
  let sawStartOfFrame = false;
  let frameComponentIds: number[] = [];
  const eoiIndex = bytes.length - 2;

  while (index < eoiIndex) {
    if (byteAt(bytes, index) !== 0xff) {
      return false;
    }

    while (index < eoiIndex && byteAt(bytes, index) === 0xff) {
      index += 1;
    }

    if (index >= eoiIndex) {
      return false;
    }

    const marker = byteAt(bytes, index);
    index += 1;

    if (marker === 0x00 || marker === 0xd9) {
      return false;
    }

    if (marker === 0x01) {
      continue;
    }

    if (index + 2 > eoiIndex) {
      return false;
    }

    const segmentLength = (byteAt(bytes, index) << 8) | byteAt(bytes, index + 1);
    if (segmentLength < 2) {
      return false;
    }

    const segmentEnd = index + segmentLength;
    if (segmentEnd > eoiIndex) {
      return false;
    }

    if (isStartOfFrameMarker(marker)) {
      // SOF defines the component-id allowlist for SOS. A second SOF before
      // scan data can rewrite that allowlist, so native-capture policy fails closed.
      if (sawStartOfFrame) {
        return false;
      }
      const frameComponents = startOfFrameComponents(bytes, index, segmentLength);
      if (frameComponents === null) {
        return false;
      }
      frameComponentIds = frameComponents;
      sawStartOfFrame = true;
    }

    if (marker === 0xda) {
      // kr: verifier도 relayer/Rust와 같은 SOS->SOF component id binding을 적용해 fail-closed 합니다.
      // en: The verifier mirrors relayer/Rust SOS-to-SOF component-id binding so policy stays fail-closed.
      if (!startOfScanReferencesFrameComponents(bytes, index, segmentLength, frameComponentIds)) {
        return false;
      }
      return sawStartOfFrame && scanDataRunsToFinalEoi(bytes, segmentEnd);
    }

    index = segmentEnd;
  }

  return false;
}

function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] & 0xff;
}

function isStartOfFrameMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function startOfFrameComponents(
  bytes: Uint8Array,
  lengthIndex: number,
  segmentLength: number,
): number[] | null {
  if (segmentLength < 11 || lengthIndex + segmentLength > bytes.length) {
    return null;
  }

  const height = (byteAt(bytes, lengthIndex + 3) << 8) | byteAt(bytes, lengthIndex + 4);
  const width = (byteAt(bytes, lengthIndex + 5) << 8) | byteAt(bytes, lengthIndex + 6);
  const componentCount = byteAt(bytes, lengthIndex + 7);

  if (
    height <= 0 ||
    width <= 0 ||
    componentCount < 1 ||
    componentCount > 4 ||
    segmentLength !== 8 + componentCount * 3
  ) {
    return null;
  }

  const componentIds: number[] = [];
  for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
    const componentId = byteAt(bytes, lengthIndex + 8 + componentIndex * 3);
    if (componentIds.includes(componentId)) {
      return null;
    }
    componentIds.push(componentId);
  }
  return componentIds;
}

function startOfScanReferencesFrameComponents(
  bytes: Uint8Array,
  lengthIndex: number,
  segmentLength: number,
  frameComponentIds: number[],
): boolean {
  if (segmentLength < 8 || lengthIndex + segmentLength > bytes.length) {
    return false;
  }

  const componentCount = byteAt(bytes, lengthIndex + 2);

  if (
    componentCount < 1 ||
    componentCount > 4 ||
    componentCount > frameComponentIds.length ||
    segmentLength !== 6 + componentCount * 2
  ) {
    return false;
  }

  const scanComponentIds: number[] = [];
  for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
    const componentId = byteAt(bytes, lengthIndex + 3 + componentIndex * 2);
    if (scanComponentIds.includes(componentId) || !frameComponentIds.includes(componentId)) {
      return false;
    }
    scanComponentIds.push(componentId);
  }

  return true;
}

function scanDataRunsToFinalEoi(bytes: Uint8Array, startIndex: number): boolean {
  const eoiIndex = bytes.length - 2;
  if (startIndex >= eoiIndex) {
    return false;
  }

  let index = startIndex;
  let sawScanData = false;
  while (index < eoiIndex) {
    if (byteAt(bytes, index) !== 0xff) {
      sawScanData = true;
      index += 1;
      continue;
    }

    index += 1;
    while (index < bytes.length && byteAt(bytes, index) === 0xff) {
      index += 1;
    }

    if (index >= bytes.length) {
      return false;
    }

    const marker = byteAt(bytes, index);
    if (marker === 0x00) {
      sawScanData = true;
      index += 1;
      continue;
    }

    if (marker >= 0xd0 && marker <= 0xd7) {
      index += 1;
      continue;
    }

    return marker === 0xd9 && index === bytes.length - 1 && sawScanData;
  }

  return sawScanData;
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    return null;
  }

  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function sha256Hex(bytes: Uint8Array): string {
  const hashWords = sha256(bytes);
  return hashWords.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function sha256(bytes: Uint8Array): number[] {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength, false);

  const hash = [
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ];
  const schedule = new Array<number>(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4, false);
    }

    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(schedule[index - 15], 7) ^ rotateRight(schedule[index - 15], 18) ^ (schedule[index - 15] >>> 3);
      const s1 = rotateRight(schedule[index - 2], 17) ^ rotateRight(schedule[index - 2], 19) ^ (schedule[index - 2] >>> 10);
      schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_K[index] + schedule[index]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
