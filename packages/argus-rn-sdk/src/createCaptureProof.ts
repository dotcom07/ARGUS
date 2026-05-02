import { getConfig } from "./config";
import { callNativeCreateCaptureProof, callNativeGetAppIdentityHash } from "./nativeBridge";
import { openCaptureSessionWithRelayer } from "./openCaptureSessionWithRelayer";
import { registerProofWithRelayer } from "./registerProofWithRelayer";
import type {
  ArgusDeviceEvidenceSummary,
  ArgusProof,
  CreateCaptureProofOptions,
  RelayerRegistrationResult,
} from "./types";

// kr: createCaptureProof는 파트너 앱에서 검증 촬영을 시작하는 SDK 함수입니다.
// en: createCaptureProof is the SDK function partner apps call to start verified capture.
export async function createCaptureProof(
  options: CreateCaptureProofOptions,
  lifecycle?: {
    onNativeProofCreated?(proof: ArgusProof): void;
  },
): Promise<ArgusProof> {
  const config = getConfig();
  if (options.partnerId !== config.partnerId) {
    throw new Error("Argus capture partnerId does not match SDK config");
  }

  const sessionFields = await buildNativeSessionFields(config, options);
  console.log("[Argus SDK] capture session fields", summarizeSessionFields(sessionFields));
  const proof = await callNativeCreateCaptureProof({
    ...options,
    ...sessionFields,
  });
  console.log("[Argus SDK] native proof summary", summarizeNativeProof(proof));
  lifecycle?.onNativeProofCreated?.(proof);
  await waitForUiFrame();
  let registration: RelayerRegistrationResult;
  try {
    registration = await registerProofWithRelayer(config, proof);
  } catch (error) {
    if (!hasPendingHardwareAttestationMaterial(proof) || !isRelayerCommunicationFailure(error)) {
      throw error;
    }

    console.warn("[Argus SDK] Level 4 attestation material is pending relayer validation", {
      message: error instanceof Error ? error.message : "unknown relayer error",
      proofId: shortenDebugValue(proof.proofId),
    });
    return proof;
  }

  const deviceEvidenceSummary = proof.deviceEvidenceSummary
    ? {
        ...proof.deviceEvidenceSummary,
        ...registration.deviceEvidenceSummary,
      }
    : undefined;

  return {
    ...proof,
    solanaTx: registration.solanaTx,
    registryAddress: registration.registryAddress,
    registryProgramId: registration.registryProgramId,
    relayer: registration.relayer,
    feePayer: registration.feePayer,
    sponsoredGas: registration.sponsoredGas,
    proofRecord: registration.proofRecord,
    deviceEvidenceSummary,
    verificationUrl: registration.verificationUrl,
  };
}

const LEVEL_4_PENDING_RELAY_VALIDATION = "level_4_material_present_pending_relayer_root_validation";

function waitForUiFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function buildNativeSessionFields(
  config: ReturnType<typeof getConfig>,
  options: CreateCaptureProofOptions,
) {
  if (config.relayerUrl.startsWith("mock://")) {
    return {};
  }

  const appIdentityHash = await callNativeGetAppIdentityHash();
  const session = await openCaptureSessionWithRelayer(config, options, appIdentityHash);

  return {
    appIdentityHash: session.appIdentityHash,
    captureSessionId: session.captureSessionId,
    sessionNonce: session.nonce,
  };
}

function summarizeSessionFields(fields: {
  appIdentityHash?: string;
  captureSessionId?: string;
  sessionNonce?: string;
}) {
  return {
    hasAppIdentityHash: hasText(fields.appIdentityHash),
    hasCaptureSessionId: hasText(fields.captureSessionId),
    hasSessionNonce: hasText(fields.sessionNonce),
    appIdentityHash: shortenDebugValue(fields.appIdentityHash),
    captureSessionId: fields.captureSessionId,
    sessionNonce: shortenDebugValue(fields.sessionNonce),
  };
}

function summarizeNativeProof(proof: ArgusProof) {
  return {
    proofLevel: proof.proofLevel ?? proof.integrityLevel,
    proofId: shortenDebugValue(proof.proofId),
    manifestHash: shortenDebugValue(proof.manifestHash),
    imageHash: shortenDebugValue(proof.imageHash),
    partnerIdHash: shortenDebugValue(proof.partnerIdHash),
    hasCaptureSessionId: hasText(proof.captureSessionId),
    hasNonce: hasText(proof.nonce),
    hasAppIdentityHash: hasText(proof.appIdentityHash),
    hasCanonicalManifestJson: hasText(proof.canonicalManifestJson),
    metadataJsonBytes: utf8ByteLength(proof.metadataJson),
    cameraEvidenceJsonBytes: utf8ByteLength(proof.cameraEvidenceJson),
    deviceIntegrityJsonBytes: utf8ByteLength(proof.deviceIntegrityJson),
    photoBytesBase64Length: proof.photoBytesBase64?.length ?? 0,
    deviceEvidenceSummary: summarizeDeviceEvidenceSummary(proof.deviceEvidenceSummary),
  };
}

function summarizeDeviceEvidenceSummary(summary?: ArgusDeviceEvidenceSummary) {
  if (!summary) {
    return undefined;
  }

  return {
    cameraMetadata: summary.cameraMetadata,
    motionSnapshot: summary.motionSnapshot,
    appIdentityHash: summary.appIdentityHash,
    keystoreSignature: summary.keystoreSignature,
    keystoreAttestationMaterial: summary.keystoreAttestationMaterial,
    evidenceLevel: summary.evidenceLevel,
    level3KeystoreSignature: summary.level3KeystoreSignature,
    level4HardwareAttestation: summary.level4HardwareAttestation,
    androidEvidenceLevel: summary.androidEvidenceLevel,
    attestationStatus: summary.attestationStatus,
    keystorePublicKeyPem: shortenDebugValue(summary.keystorePublicKeyPem),
    attestationCertificateChainPemCount: summary.attestationCertificateChainPem?.length ?? 0,
  };
}

function hasPendingHardwareAttestationMaterial(proof: ArgusProof): boolean {
  const summary = proof.deviceEvidenceSummary;
  if (
    summary?.attestationStatus === LEVEL_4_PENDING_RELAY_VALIDATION ||
    summary?.keystoreAttestationMaterial === true
  ) {
    return true;
  }

  const deviceIntegrity = parseObjectJson(proof.deviceIntegrityJson);
  return Boolean(
    deviceIntegrity &&
      (deviceIntegrity.attestationStatus === LEVEL_4_PENDING_RELAY_VALIDATION ||
        deviceIntegrity.level4AttestationMaterial === true),
  );
}

function isRelayerCommunicationFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /network request failed/i.test(message) ||
    /failed to fetch/i.test(message) ||
    /load failed/i.test(message) ||
    /Argus relayer returned 5\d\d/.test(message)
  );
}

function parseObjectJson(value?: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value ?? "");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasText(value?: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function utf8ByteLength(value?: string): number {
  if (!value) {
    return 0;
  }

  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0;
    if (codePoint > 0xffff) {
      index += 1;
    }
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}

function shortenDebugValue(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length <= 18 ? value : `${value.slice(0, 8)}...${value.slice(-6)}`;
}
