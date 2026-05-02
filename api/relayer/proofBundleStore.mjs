import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PROOF_BUNDLE_DIR = ".argus-relayer-data/proofs";
const HEX32 = /^[0-9a-f]{64}$/;

export async function storeProofBundle({ registration, request }) {
  const proof = buildProofFromRegistration({ registration, request });
  const verification = calculateVerificationResult(proof);
  const storedBundle = {
    createdAt: new Date().toISOString(),
    explorerLinks: buildExplorerLinks(proof),
    proof,
    verification,
  };

  const filePath = proofBundlePath(proof.proofId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(storedBundle, null, 2)}\n`, "utf8");

  return storedBundle;
}

export async function loadProofBundle(proofId) {
  assertProofId(proofId);

  try {
    return JSON.parse(await readFile(proofBundlePath(proofId), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function buildExplorerLinks(proof) {
  const links = {};

  if (typeof proof?.solanaTx === "string" && proof.solanaTx.trim().length > 0) {
    links.transaction = `https://explorer.solana.com/tx/${proof.solanaTx}?cluster=devnet`;
  }

  if (typeof proof?.proofRecord?.address === "string" && proof.proofRecord.address.trim().length > 0) {
    links.proofRecord = `https://explorer.solana.com/address/${proof.proofRecord.address}?cluster=devnet`;
  }

  return links;
}

function buildProofFromRegistration({ registration, request }) {
  const manifest = parseObjectJson(request.canonicalManifestJson);
  const capturedAtMs = manifest?.captured_at_ms;
  const proofLevel = request.proofLevel ?? registration.proofRecord?.proofLevel;

  return {
    proofId: request.proofId,
    manifestHash: request.manifestHash,
    imageHash: request.imageHash,
    partnerIdHash: request.partnerIdHash,
    canonicalManifestJson: request.canonicalManifestJson,
    metadataJson: request.metadataJson,
    cameraEvidenceJson: request.cameraEvidenceJson,
    deviceIntegrityJson: request.deviceIntegrityJson,
    photoBytesBase64: request.photoBytesBase64,
    captureSessionId: request.captureSessionId,
    nonce: request.sessionNonce,
    appIdentityHash: request.appIdentityHash,
    proofLevel,
    solanaTx: registration.solanaTx,
    registryAddress: registration.registryAddress,
    registryProgramId: registration.registryProgramId ?? registration.registryAddress,
    relayer: registration.relayer,
    feePayer: registration.feePayer,
    sponsoredGas: registration.sponsoredGas,
    proofRecord: {
      ...registration.proofRecord,
      registryProgramId:
        registration.proofRecord?.registryProgramId ??
        registration.registryProgramId ??
        registration.registryAddress,
    },
    capturedAt: Number.isSafeInteger(capturedAtMs)
      ? new Date(capturedAtMs).toISOString()
      : new Date().toISOString(),
    partnerId: request.partnerId,
    useCase: request.useCase,
    verificationUrl: registration.verificationUrl,
    integrityLevel: proofLevel,
    deviceEvidenceSummary: {
      ...buildDeviceEvidenceSummary({
        cameraEvidenceJson: request.cameraEvidenceJson,
        deviceIntegrityJson: request.deviceIntegrityJson,
      }),
      ...(registration.deviceEvidenceSummary ?? {}),
    },
  };
}

function calculateVerificationResult(proof) {
  const manifest = parseObjectJson(proof.canonicalManifestJson);
  const calculatedManifestHash = proof.canonicalManifestJson
    ? sha256Hex(proof.canonicalManifestJson)
    : null;
  const photoBytes = decodeBase64(proof.photoBytesBase64);
  const calculatedImageHash = photoBytes ? sha256Hex(photoBytes) : null;
  const calculatedProofId =
    calculatedManifestHash && calculatedImageHash && typeof manifest?.nonce === "string"
      ? deriveProofId(calculatedManifestHash, calculatedImageHash, manifest.nonce)
      : null;

  const manifestHashMatches =
    calculatedManifestHash === proof.manifestHash &&
    proof.proofRecord?.manifestHash === proof.manifestHash;
  const imageHashMatches =
    calculatedImageHash === proof.imageHash &&
    manifest?.image_sha256 === proof.imageHash &&
    proof.proofRecord?.imageHash === proof.imageHash;
  const proofIdMatches =
    calculatedProofId === proof.proofId &&
    proof.proofRecord?.proofId === proof.proofId;
  const evidenceCommitmentsMatch =
    manifest?.metadata_commitment === sha256Hex(proof.metadataJson ?? "") &&
    manifest?.camera_evidence_commitment === sha256Hex(proof.cameraEvidenceJson ?? "") &&
    manifest?.device_integrity_commitment === sha256Hex(proof.deviceIntegrityJson ?? "") &&
    manifest?.capture_session_id === proof.captureSessionId &&
    manifest?.nonce === proof.nonce &&
    manifest?.app_identity_hash === proof.appIdentityHash &&
    manifest?.partner_id_hash === proof.partnerIdHash &&
    manifest?.use_case === proof.useCase;
  const proofLevelMatches =
    manifest?.proof_level === proof.proofLevel &&
    proof.proofLevel === proof.integrityLevel &&
    proof.proofRecord?.proofLevel === proof.proofLevel;
  const proofRecordMatches =
    proof.proofRecord?.proofId === proof.proofId &&
    proof.proofRecord?.manifestHash === proof.manifestHash &&
    proof.proofRecord?.imageHash === proof.imageHash &&
    proof.proofRecord?.partnerIdHash === proof.partnerIdHash &&
    proof.proofRecord?.captureTimestamp === manifest?.captured_at_ms;
  const registryProgramMatches =
    proof.registryAddress === proof.registryProgramId &&
    proof.proofRecord?.registryProgramId === proof.registryProgramId;
  const authorizedRelayerMatches =
    proof.relayer === proof.feePayer &&
    proof.relayer === proof.proofRecord?.relayer &&
    proof.sponsoredGas === true &&
    proof.proofRecord?.relayerAuthorized === true &&
    proof.proofRecord?.status === "active";
  const fullBundleMatches =
    manifestHashMatches &&
    imageHashMatches &&
    proofIdMatches &&
    evidenceCommitmentsMatch &&
    proofLevelMatches &&
    proofRecordMatches &&
    registryProgramMatches;

  return {
    status: fullBundleMatches && authorizedRelayerMatches ? "verified" : "failed",
    manifestHashMatches,
    imageHashMatches,
    proofIdMatches,
    evidenceCommitmentsMatch,
    proofLevelMatches,
    proofRecordMatches,
    registryProgramMatches,
    authorizedRelayerMatches,
    message:
      fullBundleMatches && authorizedRelayerMatches
        ? "Proof bundle matches the Argus Registry commitment."
        : fullBundleMatches
          ? "Proof bundle matches locally, but this is not an active authorized Solana registry acceptance."
          : "Proof bundle does not match the stored Argus commitments.",
  };
}

function buildDeviceEvidenceSummary({ cameraEvidenceJson, deviceIntegrityJson }) {
  const cameraEvidence = parseObjectJson(cameraEvidenceJson);
  const deviceIntegrity = parseObjectJson(deviceIntegrityJson);
  const keystoreSignature =
    deviceIntegrity?.level3KeystoreSignature === true ||
    (deviceIntegrity?.keystoreSignature &&
      typeof deviceIntegrity.keystoreSignature === "object" &&
      deviceIntegrity.keystoreSignature.available === true);

  return {
    cameraMetadata: cameraEvidence?.cameraMetadata === true,
    motionSnapshot: Boolean(deviceIntegrity?.motionSnapshot),
    appIdentityHash: deviceIntegrity?.appIdentityHashPresent === true,
    keystoreSignature,
    keystoreAttestationMaterial: deviceIntegrity?.keystoreAttestationMaterial === true,
    evidenceLevel:
      typeof deviceIntegrity?.evidenceLevel === "string"
        ? deviceIntegrity.evidenceLevel
        : undefined,
    level3KeystoreSignature: deviceIntegrity?.level3KeystoreSignature === true,
    level4HardwareAttestation: deviceIntegrity?.level4HardwareAttestation === true,
    attestationStatus:
      typeof deviceIntegrity?.attestationStatus === "string"
        ? deviceIntegrity.attestationStatus
        : undefined,
    androidEvidenceLevel:
      Number.isSafeInteger(deviceIntegrity?.androidEvidenceLevel)
        ? deviceIntegrity.androidEvidenceLevel
        : undefined,
    keystorePublicKeyPem:
      typeof deviceIntegrity?.keystorePublicKeyPem === "string"
        ? deviceIntegrity.keystorePublicKeyPem
        : undefined,
    attestationCertificateChainPem: Array.isArray(deviceIntegrity?.attestationCertificateChainPem)
      ? deviceIntegrity.attestationCertificateChainPem
      : undefined,
    trustedAttestationRootConfigured: deviceIntegrity?.trustedAttestationRootConfigured === true,
    trustedAttestationRootValidated: deviceIntegrity?.trustedAttestationRootValidated === true,
    trustedAttestationRootFingerprintSha256:
      typeof deviceIntegrity?.trustedAttestationRootFingerprintSha256 === "string"
        ? deviceIntegrity.trustedAttestationRootFingerprintSha256
        : undefined,
  };
}

function proofBundlePath(proofId) {
  assertProofId(proofId);
  return path.join(
    process.cwd(),
    process.env.ARGUS_PROOF_BUNDLE_DIR || DEFAULT_PROOF_BUNDLE_DIR,
    `${proofId}.json`,
  );
}

function assertProofId(proofId) {
  if (typeof proofId !== "string" || !HEX32.test(proofId) || /^0{64}$/.test(proofId)) {
    throw new Error("proofId must be a canonical lowercase non-zero 32-byte hex string");
  }
}

function parseObjectJson(value) {
  try {
    const parsed = JSON.parse(value ?? "");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function decodeBase64(value) {
  try {
    if (typeof value !== "string" || value.length === 0) {
      return null;
    }

    return Buffer.from(value, "base64");
  } catch {
    return null;
  }
}

function deriveProofId(manifestHash, imageHash, nonce) {
  if (!HEX32.test(manifestHash) || !HEX32.test(imageHash) || !HEX32.test(nonce)) {
    return null;
  }

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
