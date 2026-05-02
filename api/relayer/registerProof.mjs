import { createHash } from "node:crypto";
import {
  summarizeAndroidAttestationRootDiagnostics,
  validateAndroidEvidenceLevel,
} from "./androidEvidencePolicy.mjs";
import { assertCanonicalJsonBytes, canonicalJsonNumberLexeme } from "./canonicalJson.mjs";
import { assertPartnerAppAuthorized } from "./partnerPolicy.mjs";
import { assertPhotoBytesBase64TextLimit, decodeCanonicalPhotoBytes } from "./photoBytesPolicy.mjs";
import {
  assertRegistrationJsonTextLimits,
  assertVerifierBaseUrlTextLimit,
} from "./requestTextPolicy.mjs";
import { recordRegistrationProgress } from "./registrationProgress.mjs";
import { validateAndConsumeCaptureSession } from "./sessionStore.mjs";

const DEFAULT_REGISTRY_ADDRESS = "STmkbEWTmfBJR2mDHrbvKNjo2spT6mPU9668mw2hMaL";
const DEFAULT_DEMO_RELAYER = "ArgusLocalDemoRelayer111111111111111111111111";
const REGISTRY_SCHEMA_VERSION = 1;
const MANIFEST_SCHEMA_VERSION = "argus.manifest.v1";
const KNOWN_USE_CASES = new Set(["marketplace_listing"]);
const KNOWN_PROOF_LEVELS = new Set(["app_capture"]);
const MAX_CAMERA_EVIDENCE_DELAY_MS = 5_000;
const MAX_MOTION_CAPTURE_DELTA_MS = 2_000;
const DEFAULT_VERIFIER_BASE_URL_ALLOWLIST = Object.freeze(["https://verify.argus.dev"]);

// kr: registerProof는 partner 대신 gas를 내는 relayer의 최소 등록 함수입니다.
// en: registerProof is the minimal relayer registration function that sponsors gas for a partner.
export async function registerProof(request) {
  const normalizedRequest = normalizeRegistrationRequest(request);
  const relayerMode = resolveRelayerMode();
  const submitToSolana = relayerMode === "solana";
  // kr: demo mode는 이 함수가 최종 등록 경계라서 검증 중 session을 바로 소비합니다.
  // kr: Solana/production 경로는 cheap config 오류를 retry 가능하게 두되, full bundle 검증 실패부터 nonce를 태웁니다.
  // en: Demo mode consumes the session inside this function because this is the final registration boundary.
  // en: Solana/production keeps cheap config failures retryable, then burns the nonce once full bundle validation fails.
  const consumeSessionDuringValidation = !submitToSolana && !isProductionRuntime();
  const { androidEvidenceDecision, manifest } = validateRegistrationRequest(normalizedRequest, {
    consumeSession: consumeSessionDuringValidation,
    consumeSessionOnValidationFailure: submitToSolana,
  });
  const relayerDeviceEvidenceSummary = buildRelayerDeviceEvidenceSummary(androidEvidenceDecision);
  if (androidEvidenceDecision.level4AttestationVerdict?.attempted) {
    const attestationRootDiagnostics = summarizeAndroidAttestationRootDiagnostics(
      JSON.parse(normalizedRequest.deviceIntegrityJson),
    );
    console.info("[Argus relayer] Android attestation root verdict", {
      proofId: shortValue(normalizedRequest.proofId),
      acceptedLevel: androidEvidenceDecision.level4AttestationVerdict.acceptedLevel,
      attestationCertificateChainPemCount:
        attestationRootDiagnostics.attestationCertificateChainPemCount,
      configuredAttestationRootFingerprintCount:
        attestationRootDiagnostics.configuredAttestationRootFingerprintCount,
      configuredAttestationRootFingerprintError:
        attestationRootDiagnostics.configuredAttestationRootFingerprintError,
      evidenceLevel: androidEvidenceDecision.level4AttestationVerdict.evidenceLevel,
      failureReason: androidEvidenceDecision.level4AttestationVerdict.failureReason,
      submittedAttestationRootFingerprintError:
        attestationRootDiagnostics.submittedAttestationRootFingerprintError,
      submittedAttestationRootFingerprintSha256:
        attestationRootDiagnostics.submittedAttestationRootFingerprintSha256,
      trustedAttestationRootConfigured:
        androidEvidenceDecision.level4AttestationVerdict.trustedAttestationRootConfigured === true,
      trustedAttestationRootConfiguredError:
        androidEvidenceDecision.level4AttestationVerdict.trustedAttestationRootConfiguredError,
      trustedAttestationRootFingerprintSha256:
        androidEvidenceDecision.level4AttestationVerdict.trustedAttestationRootFingerprintSha256,
      trustedAttestationRootValidated:
        androidEvidenceDecision.level4AttestationVerdict.trustedAttestationRootValidated === true,
    });
  }
  console.info("[Argus relayer] proof validation passed", {
    proofId: shortValue(normalizedRequest.proofId),
    proofLevel: normalizedRequest.proofLevel,
    relayerAcceptedEvidenceLevel: relayerDeviceEvidenceSummary?.evidenceLevel,
    trustedAttestationRootValidated:
      relayerDeviceEvidenceSummary?.trustedAttestationRootValidated,
    useCase: normalizedRequest.useCase,
    mode: relayerMode,
    submitToSolana,
  });
  recordRegistrationProgress(normalizedRequest.proofId, "proof_validated", "Proof bundle validated", {
    mode: relayerMode,
    proofLevel: normalizedRequest.proofLevel,
    submitToSolana,
    useCase: normalizedRequest.useCase,
  });
  assertProductionSolanaMode(submitToSolana);
  const verificationUrl = buildVerificationUrl(
    normalizedRequest.verifierBaseUrl,
    normalizedRequest.proofId,
  );

  // kr: Solana mode만 production acceptance를 만들 수 있습니다. submitter 성공 뒤에만 active/authorized/sponsored fee-payer 응답을 반환합니다.
  // en: Only Solana mode can create production acceptance; active/authorized/sponsored fee-payer responses are returned only after submitter success.
  if (submitToSolana) {
    const { submitRegisterProof } = await import("./submitRegisterProof.mjs");
    console.info("[Argus relayer] Solana registration starting", {
      proofId: shortValue(normalizedRequest.proofId),
      manifestHash: shortValue(normalizedRequest.manifestHash),
    });
    recordRegistrationProgress(
      normalizedRequest.proofId,
      "solana_registration_starting",
      "Solana registration starting",
      {
        manifestHash: normalizedRequest.manifestHash,
      },
    );
    const solanaResult = await submitRegisterProof(normalizedRequest);
    console.info("[Argus relayer] Solana registration finished", {
      proofId: shortValue(normalizedRequest.proofId),
      solanaTx: shortValue(solanaResult.solanaTx),
      proofRecord: shortValue(solanaResult.proofRecord),
    });
    recordRegistrationProgress(
      normalizedRequest.proofId,
      "solana_registration_finished",
      "Solana registration finished",
      {
        proofRecord: solanaResult.proofRecord,
        solanaTx: solanaResult.solanaTx,
      },
    );
    const proofRecord = buildProofRecord(normalizedRequest, manifest, {
      registeredAt: new Date().toISOString(),
      relayer: solanaResult.relayer,
      registryProgramId: solanaResult.registryAddress,
      relayerAuthorized: true,
      status: "active",
    });

    return {
      proofId: normalizedRequest.proofId,
      manifestHash: normalizedRequest.manifestHash,
      solanaTx: solanaResult.solanaTx,
      registryAddress: solanaResult.registryAddress,
      registryProgramId: solanaResult.registryAddress,
      proofRecord: {
        ...proofRecord,
        address: solanaResult.proofRecord,
      },
      relayer: solanaResult.relayer,
      feePayer: solanaResult.relayer,
      sponsoredGas: true,
      verificationUrl,
      deviceEvidenceSummary: relayerDeviceEvidenceSummary,
      level4AttestationVerdict: androidEvidenceDecision.level4AttestationVerdict,
    };
  }

  // kr: demo mode의 deterministic tx는 로컬 표시값입니다. production trust root로 오인되지 않도록 superseded/unauthorized/unsponsored로 낮춥니다.
  // en: The demo deterministic tx is local display data, downgraded to superseded/unauthorized/unsponsored to avoid production overclaim.
  const registryAddress = resolveDemoRegistryAddress();
  const demoRelayer = resolveDemoRelayer();
  const solanaTx = createHash("sha256")
    .update(
      [
        "argus-authorized-relayer-v1",
        normalizedRequest.proofId,
        normalizedRequest.manifestHash,
        normalizedRequest.imageHash,
        normalizedRequest.partnerIdHash,
        normalizedRequest.captureSessionId,
        normalizedRequest.useCase,
        normalizedRequest.proofLevel,
        demoRelayer,
      ].join(":"),
    )
    .digest("hex");
  const proofRecord = buildProofRecord(normalizedRequest, manifest, {
    registeredAt: new Date().toISOString(),
    relayer: demoRelayer,
    registryProgramId: registryAddress,
    relayerAuthorized: false,
    status: "superseded",
  });
  console.info("[Argus relayer] demo registration built", {
    proofId: shortValue(normalizedRequest.proofId),
    solanaTx: shortValue(solanaTx),
  });
  recordRegistrationProgress(normalizedRequest.proofId, "demo_registration_built", "Demo registration built", {
    solanaTx,
  });

  return {
    proofId: normalizedRequest.proofId,
    manifestHash: normalizedRequest.manifestHash,
    solanaTx,
    registryAddress,
    registryProgramId: registryAddress,
    proofRecord,
    relayer: demoRelayer,
    feePayer: demoRelayer,
    sponsoredGas: false,
    verificationUrl,
    deviceEvidenceSummary: relayerDeviceEvidenceSummary,
    level4AttestationVerdict: androidEvidenceDecision.level4AttestationVerdict,
  };
}

function shortValue(value) {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value.length <= 16 ? value : `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function normalizeRegistrationRequest(request) {
  if (!request || typeof request !== "object" || typeof request.appIdentityHash !== "string") {
    return request;
  }

  return {
    ...request,
    appIdentityHash: request.appIdentityHash.toLowerCase(),
  };
}

function validateRegistrationRequest(
  request,
  { consumeSession = true, consumeSessionOnValidationFailure = false } = {},
) {
  const requiredFields = [
    "proofId",
    "manifestHash",
    "imageHash",
    "partnerId",
    "partnerIdHash",
    "useCase",
    "verifierBaseUrl",
    "canonicalManifestJson",
    "metadataJson",
    "captureSessionId",
    "sessionNonce",
    "appIdentityHash",
    "proofLevel",
    "cameraEvidenceJson",
    "deviceIntegrityJson",
    "photoBytesBase64",
  ];

  for (const field of requiredFields) {
    if (!request?.[field]) {
      throw new Error(`${field} is required`);
    }
  }

  assertRegistrationJsonTextLimits(request, "for relayer validation");
  assertPhotoBytesBase64TextLimit(
    "photoBytesBase64",
    request.photoBytesBase64,
    "for relayer validation",
  );

  for (const field of [
    "proofId",
    "manifestHash",
    "imageHash",
    "partnerIdHash",
    "sessionNonce",
    "appIdentityHash",
  ]) {
    assertHex32(field, request[field]);
  }

  if (!KNOWN_USE_CASES.has(request.useCase)) {
    throw new Error("useCase is not supported by this relayer");
  }

  assertPartnerAppAuthorized({
    appIdentityHash: request.appIdentityHash,
    partnerId: request.partnerId,
    useCase: request.useCase,
  });

  if (!KNOWN_PROOF_LEVELS.has(request.proofLevel)) {
    throw new Error("proofLevel is not supported by this relayer");
  }

  if (request.schemaVersion !== undefined && request.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new Error("schemaVersion is not supported by this relayer");
  }

  const calculatedPartnerIdHash = createHash("sha256").update(request.partnerId).digest("hex");
  if (calculatedPartnerIdHash !== request.partnerIdHash) {
    throw new Error("partnerIdHash does not match partnerId");
  }

  const normalizedVerifierBaseUrl = normalizeVerifierBaseUrlForValidation(request, {
    consumeSessionOnValidationFailure,
  });
  assertVerifierBaseUrlAllowed(normalizedVerifierBaseUrl);

  if (consumeSession) {
    consumeRegistrationSession(request);
  }

  try {
    const manifest = verifyManifestAndProofId(request);
    const androidEvidenceDecision = verifyManifestPolicy(request, manifest);
    return { androidEvidenceDecision, manifest };
  } catch (error) {
    if (!consumeSession && consumeSessionOnValidationFailure) {
      consumeRegistrationSessionIfPresent(request);
    }
    throw error;
  }
}

function assertProductionSolanaMode(submitToSolana) {
  if (isProductionRuntime() && !submitToSolana) {
    throw new Error("ARGUS_RELAYER_MODE=solana is required for production registration");
  }
}

function resolveRelayerMode() {
  const mode = process.env.ARGUS_RELAYER_MODE;
  if (mode === undefined || mode === "" || mode === "demo") {
    return "demo";
  }

  if (mode === "solana") {
    return "solana";
  }

  throw new Error("ARGUS_RELAYER_MODE must be either demo or solana");
}

function resolveDemoRegistryAddress() {
  return process.env.ARGUS_REGISTRY_PROGRAM_ID || DEFAULT_REGISTRY_ADDRESS;
}

function resolveDemoRelayer() {
  return process.env.SOLANA_PUBLIC_KEY || DEFAULT_DEMO_RELAYER;
}

function consumeRegistrationSession(request) {
  validateAndConsumeCaptureSession({
    appIdentityHash: request.appIdentityHash,
    captureSessionId: request.captureSessionId,
    nonce: request.sessionNonce,
    partnerId: request.partnerId,
    useCase: request.useCase,
  });
}

function consumeRegistrationSessionIfPresent(request) {
  try {
    consumeRegistrationSession(request);
  } catch {
    // kr: 원래 validation error를 보존하기 위해 unknown/expired/이미 소비된 session 오류는 여기서 삼킵니다.
    // en: Preserve the original validation error; unknown, expired, or already-consumed session errors are swallowed here.
  }
}

function assertHex32(field, value) {
  if (!/^[0-9a-f]{64}$/.test(value) || /^0{64}$/.test(value)) {
    throw new Error(`${field} must be a canonical lowercase non-zero 32-byte hex string`);
  }
}

function verifyManifestAndProofId(request) {
  const canonicalManifestJson = request.canonicalManifestJson;
  const calculatedManifestHash = createHash("sha256")
    .update(canonicalManifestJson)
    .digest("hex");

  if (calculatedManifestHash !== request.manifestHash) {
    throw new Error("manifestHash does not match canonicalManifestJson");
  }

  const manifest = JSON.parse(canonicalManifestJson);
  if (canonicalManifestStringify(manifest) !== canonicalManifestJson) {
    throw new Error("canonicalManifestJson is not a canonical Argus manifest");
  }

  assertHex32("manifest.image_sha256", manifest.image_sha256);
  assertHex32("manifest.nonce", manifest.nonce);

  const calculatedProofId = createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from("argus-proof-v1"),
        Buffer.from(calculatedManifestHash, "hex"),
        Buffer.from(manifest.image_sha256, "hex"),
        Buffer.from(manifest.nonce, "hex"),
      ]),
    )
    .digest("hex");

  if (calculatedProofId !== request.proofId) {
    throw new Error("proofId does not match canonicalManifestJson");
  }

  return manifest;
}

function verifyManifestPolicy(request, manifest) {
  if (manifest.schema_version !== MANIFEST_SCHEMA_VERSION) {
    throw new Error("manifest schema_version is not supported");
  }

  if (!Number.isSafeInteger(manifest.captured_at_ms) || manifest.captured_at_ms <= 0) {
    throw new Error("manifest captured_at_ms must be a positive integer");
  }
  assertCaptureTimestampNotAfterRelayerClock(manifest.captured_at_ms);

  if (
    request.captureTimestamp !== undefined &&
    Number(request.captureTimestamp) !== manifest.captured_at_ms
  ) {
    throw new Error("captureTimestamp does not match canonicalManifestJson");
  }

  if (manifest.use_case !== request.useCase) {
    throw new Error("manifest use_case does not match request");
  }

  if (manifest.partner_id_hash !== request.partnerIdHash) {
    throw new Error("manifest partner_id_hash does not match request");
  }

  if (manifest.image_sha256 !== request.imageHash) {
    throw new Error("manifest image_sha256 does not match request");
  }

  if (manifest.capture_session_id !== request.captureSessionId) {
    throw new Error("manifest capture_session_id does not match request");
  }

  if (manifest.nonce !== request.sessionNonce) {
    throw new Error("manifest nonce does not match sessionNonce");
  }

  if (manifest.proof_level !== request.proofLevel) {
    throw new Error("manifest proof_level does not match request");
  }

  if (manifest.app_identity_hash !== request.appIdentityHash) {
    throw new Error("manifest app_identity_hash does not match request");
  }

  assertHex32("manifest.app_identity_hash", manifest.app_identity_hash);
  assertEvidenceCommitment(
    "cameraEvidenceJson",
    request.cameraEvidenceJson,
    manifest.camera_evidence_commitment,
  );
  assertEvidenceCommitment(
    "deviceIntegrityJson",
    request.deviceIntegrityJson,
    manifest.device_integrity_commitment,
  );

  assertEvidenceCommitment("metadataJson", request.metadataJson, manifest.metadata_commitment);
  return enforceProofLevelPolicy(request, manifest);
}

function assertCaptureTimestampNotAfterRelayerClock(capturedAtMs, nowMs = Date.now()) {
  // kr: registeredAt 응답은 relayer 운영 timestamp입니다. capture time이 미래면 verifier가 production record를 낮추기 전에 backend가 거절합니다.
  // en: registeredAt is a relayer operational timestamp; reject future capture times before the verifier has to downgrade the record.
  if (capturedAtMs > nowMs) {
    throw new Error("manifest captured_at_ms cannot be after relayer receipt time");
  }
}

function assertEvidenceCommitment(field, value, expectedHash) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required for relayer validation`);
  }

  assertHex32(`manifest commitment for ${field}`, expectedHash);
  const calculatedHash = createHash("sha256").update(value).digest("hex");

  if (calculatedHash !== expectedHash) {
    throw new Error(`${field} does not match manifest commitment`);
  }

  assertCanonicalJson(field, value);
}

function enforceProofLevelPolicy(request, manifest) {
  const cameraEvidence = parseEvidenceJson("cameraEvidenceJson", request.cameraEvidenceJson);
  const deviceIntegrity = parseEvidenceJson("deviceIntegrityJson", request.deviceIntegrityJson);

  if (cameraEvidence.noGalleryImport !== true) {
    throw new Error("cameraEvidenceJson must commit a native no-gallery capture path");
  }

  if (cameraEvidence.captureSurface !== "native_android_camera") {
    throw new Error("app_capture requires the Argus native Android camera surface");
  }

  if (cameraEvidence.cameraMetadata !== true) {
    throw new Error("app_capture requires committed camera metadata");
  }

  validateCapturedFileBytes(
    cameraEvidence,
    request.cameraEvidenceJson,
    request.photoBytesBase64,
    request.imageHash,
  );

  if (cameraEvidence.capturedAtMs !== manifest.captured_at_ms) {
    throw new Error("cameraEvidenceJson capturedAtMs does not match manifest");
  }
  assertCanonicalIntegerLexeme(
    "cameraEvidenceJson",
    request.cameraEvidenceJson,
    ["capturedAtMs"],
    manifest.captured_at_ms,
  );
  validateCameraEvidenceFreshness(
    cameraEvidence,
    manifest.captured_at_ms,
    request.cameraEvidenceJson,
  );

  if (deviceIntegrity.appIdentityHash !== request.appIdentityHash) {
    throw new Error("deviceIntegrityJson appIdentityHash does not match request");
  }

  if (deviceIntegrity.appIdentityHashPresent !== true) {
    throw new Error("deviceIntegrityJson must commit app identity presence");
  }

  validateMotionEvidence(
    deviceIntegrity.motionSnapshot,
    manifest.captured_at_ms,
    request.deviceIntegrityJson,
  );
  return validateAndroidEvidenceLevel({ deviceIntegrity, manifest, request });
}

function buildRelayerDeviceEvidenceSummary(androidEvidenceDecision) {
  const verdict = androidEvidenceDecision?.level4AttestationVerdict;
  if (!verdict?.attempted) {
    return undefined;
  }

  return {
    attestationSecurityLevel: verdict.attestationSecurityLevel,
    attestationStatus: verdict.attestationStatus,
    evidenceLevel: verdict.evidenceLevel,
    hardwareSecurityClass: verdict.hardwareSecurityClass,
    keymasterSecurityLevel: verdict.keymasterSecurityLevel,
    keystoreAttestationMaterial: true,
    keystoreSignature: true,
    level3KeystoreSignature: true,
    level4HardwareAttestation: verdict.accepted === true,
    relayerAcceptedAndroidEvidenceLevel: verdict.acceptedLevel,
    relayerAcceptedEvidenceLevel: verdict.evidenceLevel,
    trustedAttestationRootConfigured: verdict.trustedAttestationRootConfigured === true,
    trustedAttestationRootConfiguredError: verdict.trustedAttestationRootConfiguredError,
    trustedAttestationRootFingerprintSha256: verdict.trustedAttestationRootFingerprintSha256,
    trustedAttestationRootValidated: verdict.trustedAttestationRootValidated === true,
    trustedAttestationRootValidationAttempted: true,
    trustedAttestationRootValidationError: verdict.failureReason,
  };
}

function validateCapturedFileBytes(cameraEvidence, cameraEvidenceJson, photoBytesBase64, imageHash) {
  if (
    !Number.isSafeInteger(cameraEvidence.capturedFileBytes) ||
    cameraEvidence.capturedFileBytes <= 0
  ) {
    throw new Error("cameraEvidenceJson must commit positive capturedFileBytes");
  }

  assertCanonicalIntegerLexeme(
    "cameraEvidenceJson",
    cameraEvidenceJson,
    ["capturedFileBytes"],
    cameraEvidence.capturedFileBytes,
  );

  const photoBytes = decodeCanonicalPhotoBytes(
    "photoBytesBase64",
    photoBytesBase64,
    "for relayer validation",
  );
  if (photoBytes.byteLength !== cameraEvidence.capturedFileBytes) {
    throw new Error("cameraEvidenceJson capturedFileBytes does not match photoBytesBase64");
  }

  const calculatedImageHash = createHash("sha256").update(photoBytes).digest("hex");
  if (calculatedImageHash !== imageHash) {
    throw new Error("photoBytesBase64 does not match imageHash");
  }
}

function validateCameraEvidenceFreshness(cameraEvidence, capturedAtMs, cameraEvidenceJson) {
  if (
    !Number.isSafeInteger(cameraEvidence.collectedAtMs) ||
    !Number.isSafeInteger(cameraEvidence.captureEvidenceDelayMs) ||
    cameraEvidence.collectedAtMs <= 0 ||
    cameraEvidence.captureEvidenceDelayMs < 0
  ) {
    throw new Error("app_capture requires fresh camera evidence timing");
  }

  assertCanonicalIntegerLexeme(
    "cameraEvidenceJson",
    cameraEvidenceJson,
    ["collectedAtMs"],
    cameraEvidence.collectedAtMs,
  );
  assertCanonicalIntegerLexeme(
    "cameraEvidenceJson",
    cameraEvidenceJson,
    ["captureEvidenceDelayMs"],
    cameraEvidence.captureEvidenceDelayMs,
  );

  const calculatedDelayMs = cameraEvidence.collectedAtMs - capturedAtMs;
  if (calculatedDelayMs < 0) {
    throw new Error("camera evidence collectedAtMs cannot be before capturedAtMs");
  }

  if (calculatedDelayMs !== cameraEvidence.captureEvidenceDelayMs) {
    throw new Error("cameraEvidenceJson captureEvidenceDelayMs does not match collectedAtMs");
  }

  if (calculatedDelayMs > MAX_CAMERA_EVIDENCE_DELAY_MS) {
    throw new Error("camera evidence must be collected near shutter time");
  }
}

function validateMotionEvidence(motionSnapshot, capturedAtMs, deviceIntegrityJson) {
  if (
    !motionSnapshot ||
    typeof motionSnapshot !== "object" ||
    Array.isArray(motionSnapshot) ||
    motionSnapshot.available !== true ||
    motionSnapshot.accelerometerAvailable !== true ||
    motionSnapshot.gyroscopeAvailable !== true ||
    !isThreeNumberArray(motionSnapshot.accelerometer) ||
    !isThreeNumberArray(motionSnapshot.gyroscope) ||
    !Number.isSafeInteger(motionSnapshot.sampledAtMs) ||
    !Number.isSafeInteger(motionSnapshot.sampleWindowMs) ||
    motionSnapshot.sampledAtMs <= 0 ||
    motionSnapshot.sampleWindowMs <= 0
  ) {
    throw new Error("app_capture requires committed motion evidence");
  }

  assertCanonicalIntegerLexeme(
    "deviceIntegrityJson",
    deviceIntegrityJson,
    ["motionSnapshot", "sampledAtMs"],
    motionSnapshot.sampledAtMs,
  );
  assertCanonicalIntegerLexeme(
    "deviceIntegrityJson",
    deviceIntegrityJson,
    ["motionSnapshot", "sampleWindowMs"],
    motionSnapshot.sampleWindowMs,
  );

  if (Math.abs(motionSnapshot.sampledAtMs - capturedAtMs) > MAX_MOTION_CAPTURE_DELTA_MS) {
    throw new Error("motion evidence must be captured near shutter time");
  }

  if (motionSnapshot.sampleWindowMs > MAX_MOTION_CAPTURE_DELTA_MS) {
    throw new Error("motion evidence sample window is too wide");
  }
}

function parseEvidenceJson(field, value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw new Error(`${field} must be canonical JSON evidence`);
  }
}

function isThreeNumberArray(value) {
  return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(item));
}

function assertCanonicalJson(field, value) {
  try {
    assertCanonicalJsonBytes(value);
  } catch {
    throw new Error(`${field} must be canonical JSON`);
  }
}

function assertCanonicalIntegerLexeme(field, value, path, expectedValue) {
  if (canonicalJsonNumberLexeme(value, path) !== String(expectedValue)) {
    throw new Error(`${field} ${path.join(".")} must be encoded as a canonical integer`);
  }
}

function buildVerificationUrl(verifierBaseUrl, proofId) {
  const normalizedVerifierBaseUrl = assertVerifierBaseUrlAllowed(verifierBaseUrl);
  return `${normalizedVerifierBaseUrl}/proof/${proofId}`;
}

function assertVerifierBaseUrlAllowed(value) {
  const normalizedVerifierBaseUrl = normalizeVerifierBaseUrl(value);

  if (hasLoopbackVerifierHost(normalizedVerifierBaseUrl) && isProductionRuntime()) {
    throw new Error("loopback verifierBaseUrl is only allowed outside production");
  }

  if (isLoopbackHttpVerifierBaseUrl(normalizedVerifierBaseUrl)) {
    return normalizedVerifierBaseUrl;
  }

  if (!loadVerifierBaseUrlAllowlist().has(normalizedVerifierBaseUrl)) {
    throw new Error("verifierBaseUrl is not authorized by this relayer");
  }

  return normalizedVerifierBaseUrl;
}

function normalizeVerifierBaseUrl(value) {
  assertVerifierBaseUrlTextLimit(value, "for relayer validation");

  // kr: URL parser/proxy 정규화 전에 raw path를 검사하되, 정상 encoded base path는 막지 않습니다.
  // en: Inspect raw paths before parser/proxy normalization, without blocking valid encoded base paths.
  if (hasRawPathTraversalSegments(value)) {
    throw new Error("verifierBaseUrl must not contain path traversal segments");
  }

  // kr: verifier trust root는 `scheme://authority` 형태만 허용합니다. WHATWG URL의 `https:host/path` 보정에 의존하지 않습니다.
  // en: Verifier trust roots must use `scheme://authority`; do not rely on WHATWG URL fixing `https:host/path`.
  if (!hasAbsoluteUrlAuthority(value)) {
    throw new Error("verifierBaseUrl must include an explicit URL authority");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("verifierBaseUrl must be a valid URL");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("verifierBaseUrl must not include credentials, query, or fragment");
  }

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new Error("verifierBaseUrl must be https or loopback http");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${pathname}`;
}

function normalizeVerifierBaseUrlForValidation(request, { consumeSessionOnValidationFailure }) {
  try {
    return normalizeVerifierBaseUrl(request.verifierBaseUrl);
  } catch (error) {
    if (consumeSessionOnValidationFailure && shouldConsumeSessionAfterVerifierBaseUrlError(error)) {
      // kr: verifierBaseUrl path shape는 요청자가 바꿀 수 있는 경계입니다. traversal probe가 유효한 nonce를 재사용하게 두지 않습니다.
      // en: verifierBaseUrl path shape is request-controlled; do not let a traversal probe keep a valid nonce reusable.
      consumeRegistrationSessionIfPresent(request);
    }
    throw error;
  }
}

function shouldConsumeSessionAfterVerifierBaseUrlError(error) {
  return error instanceof Error && error.message === "verifierBaseUrl must not contain path traversal segments";
}

function hasAbsoluteUrlAuthority(value) {
  return typeof value === "string" && /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function hasRawPathTraversalSegments(value) {
  if (typeof value !== "string") {
    return false;
  }

  const path = rawPathFromAbsoluteUrl(value);
  if (path === null) {
    return false;
  }

  // kr: raw slash/backslash path가 trust boundary입니다. parser가 정규화하기 전에 traversal만 fail-closed로 막습니다.
  // kr: encoded slash 자체는 허용하고, separator로 해석했을 때 "."/".." segment가 생기는 경우만 막습니다.
  // en: The raw slash/backslash path is the trust boundary; fail closed on traversal before parser normalization.
  // en: Encoded slashes are allowed unless decoding them as separators creates "."/".." traversal segments.
  return [path, path.replace(/%2f|%5c/gi, "/")].some((candidatePath) =>
    candidatePath.split(/[\\/]/).some((segment) => {
      const normalizedSegment = segment.replace(/%2e/gi, ".");
      return normalizedSegment === "." || normalizedSegment === "..";
    }),
  );
}

function rawPathFromAbsoluteUrl(value) {
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

function rawPathFromIndex(value, pathStartIndex) {
  const queryStartIndex = value.indexOf("?", pathStartIndex);
  const hashStartIndex = value.indexOf("#", pathStartIndex);
  const pathEndIndex = [queryStartIndex, hashStartIndex]
    .filter((index) => index !== -1)
    .reduce((lowest, index) => Math.min(lowest, index), value.length);

  return value.slice(pathStartIndex, pathEndIndex);
}

function loadVerifierBaseUrlAllowlist() {
  const configuredAllowlist = process.env.ARGUS_VERIFIER_BASE_URL_ALLOWLIST;
  if (!configuredAllowlist) {
    return new Set(DEFAULT_VERIFIER_BASE_URL_ALLOWLIST);
  }

  let parsedAllowlist;
  try {
    parsedAllowlist = JSON.parse(configuredAllowlist);
  } catch {
    throw new Error("ARGUS_VERIFIER_BASE_URL_ALLOWLIST must be valid JSON");
  }

  if (!Array.isArray(parsedAllowlist) || parsedAllowlist.length === 0) {
    throw new Error("ARGUS_VERIFIER_BASE_URL_ALLOWLIST must be a non-empty JSON array");
  }

  const normalizedAllowlist = parsedAllowlist.map((entry) => normalizeVerifierBaseUrl(entry));
  assertUniqueVerifierBaseUrlAllowlist(normalizedAllowlist);
  if (isProductionRuntime() && normalizedAllowlist.some(hasLoopbackVerifierHost)) {
    // kr: production allowlist 자체가 verifier trust root라서, 요청이 해당 entry를 쓰지 않아도 loopback root가 섞이면 fail-closed 합니다.
    // en: The production allowlist is itself a verifier trust root, so fail closed on loopback roots even when the current request does not use them.
    throw new Error("loopback verifierBaseUrl is only allowed outside production");
  }

  return new Set(normalizedAllowlist);
}

function assertUniqueVerifierBaseUrlAllowlist(normalizedAllowlist) {
  // kr: verifier allowlist도 trust root라서, normalization 뒤 중복된 base를 Set으로 조용히 합치지 않습니다.
  // en: The verifier allowlist is a trust root too; do not silently merge duplicate normalized bases with Set.
  if (new Set(normalizedAllowlist).size !== normalizedAllowlist.length) {
    throw new Error("ARGUS_VERIFIER_BASE_URL_ALLOWLIST must not contain duplicate entries");
  }
}

function hasLoopbackVerifierHost(value) {
  const url = new URL(value);
  return isLoopbackHost(url.hostname);
}

function isLoopbackHttpVerifierBaseUrl(value) {
  const url = new URL(value);
  return url.protocol === "http:" && isLoopbackHost(url.hostname);
}

function isLoopbackHost(hostname) {
  // kr: production verifier allowlist가 127/8 또는 IPv4-mapped IPv6 loopback 별칭을 통과시키지 못하게 합니다.
  // en: Prevent production verifier allowlists from admitting 127/8 or IPv4-mapped IPv6 loopback aliases.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") {
    return true;
  }

  if (isIpv4LoopbackHost(host)) {
    return true;
  }

  const ipv4MappedHost = ipv4MappedLoopbackHost(host);
  return ipv4MappedHost !== null && isIpv4LoopbackHost(ipv4MappedHost);
}

function isIpv4LoopbackHost(host) {
  const octets = host.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d+$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255) &&
    Number(octets[0]) === 127
  );
}

function ipv4MappedLoopbackHost(host) {
  const dottedMatch = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMatch) {
    return dottedMatch[1];
  }

  const hexMatch = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hexMatch) {
    return null;
  }

  const high = Number.parseInt(hexMatch[1], 16);
  const low = Number.parseInt(hexMatch[2], 16);
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join(".");
}

function isProductionRuntime() {
  return process.env.NODE_ENV?.trim().toLowerCase() === "production";
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

function buildProofRecord(
  request,
  manifest,
  { registeredAt, relayer, registryProgramId, relayerAuthorized, status },
) {
  // kr: caller가 mode에 맞는 status/auth 값을 명시해야 합니다. helper는 demo를 production으로 승격하지 않습니다.
  // en: The caller must pass mode-specific status/auth values; this helper never upgrades demo into production.
  return {
    proofId: request.proofId,
    manifestHash: request.manifestHash,
    imageHash: request.imageHash,
    partnerIdHash: request.partnerIdHash,
    proofLevel: manifest.proof_level,
    captureTimestamp: manifest.captured_at_ms,
    registeredAt,
    relayer,
    relayerAuthorized,
    registryProgramId,
    status,
  };
}
