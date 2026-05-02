export type ArgusUseCase = "marketplace_listing" | "insurance_claim" | string;

export type ArgusIntegrityLevel = "app_capture" | "device_attested" | "demo";
export type ArgusEvidenceLevel =
  | "level_1_demo"
  | "level_2_native_capture"
  | "level_3_keystore_signature"
  | "level_4_hardware_attestation";

export type ArgusDeviceEvidenceSummary = {
  cameraMetadata: boolean;
  motionSnapshot: boolean;
  appIdentityHash: boolean;
  keystoreSignature: boolean;
  keystoreAttestationMaterial?: boolean;
  evidenceLevel?: ArgusEvidenceLevel;
  level3KeystoreSignature?: boolean;
  level4HardwareAttestation?: boolean;
  attestationStatus?: string;
  androidEvidenceLevel?: number;
  keystorePublicKeyPem?: string;
  attestationCertificateChainPem?: string[];
  relayerAcceptedAndroidEvidenceLevel?: number;
  relayerAcceptedEvidenceLevel?: ArgusEvidenceLevel;
  trustedAttestationRootConfiguredError?: string;
  trustedAttestationRootConfigured?: boolean;
  trustedAttestationRootValidated?: boolean;
  trustedAttestationRootFingerprintSha256?: string;
  trustedAttestationRootValidationAttempted?: boolean;
  trustedAttestationRootValidationError?: string;
  hardwareSecurityClass?: string;
  attestationSecurityLevel?: string;
  keymasterSecurityLevel?: string;
};

export type ArgusProofRecord = {
  address?: string;
  proofId: string;
  manifestHash: string;
  imageHash: string;
  partnerIdHash: string;
  proofLevel: ArgusIntegrityLevel;
  captureTimestamp: number;
  registeredAt: string;
  relayer: string;
  relayerAuthorized: boolean;
  registryProgramId: string;
  status: "active" | "revoked" | "superseded";
};

export type ArgusProof = {
  proofId: string;
  manifestHash: string;
  imageHash: string;
  partnerIdHash?: string;
  canonicalManifestJson?: string;
  metadataJson?: string;
  cameraEvidenceJson?: string;
  deviceIntegrityJson?: string;
  photoBytesBase64?: string;
  captureSessionId?: string;
  nonce?: string;
  appIdentityHash?: string;
  proofLevel?: ArgusIntegrityLevel;
  solanaTx?: string;
  registryAddress?: string;
  registryProgramId?: string;
  relayer?: string;
  feePayer?: string;
  sponsoredGas?: boolean;
  proofRecord?: ArgusProofRecord;
  capturedAt: string;
  partnerId: string;
  useCase: ArgusUseCase;
  verificationUrl: string;
  integrityLevel: ArgusIntegrityLevel;
  deviceEvidenceSummary?: ArgusDeviceEvidenceSummary;
};

export type ArgusConfig = {
  partnerId: string;
  relayerUrl: string;
  verifierBaseUrl: string;
};

export type ArgusCaptureSession = {
  captureSessionId: string;
  nonce: string;
  appIdentityHash: string;
  expiresAtMs?: number;
};

export type CreateCaptureProofOptions = {
  partnerId: string;
  useCase: ArgusUseCase;
  metadata: Record<string, string | number | boolean | null>;
};

export type VerificationResult = {
  status: "verified" | "demo_verified" | "failed" | "missing";
  manifestHashMatches: boolean;
  imageHashMatches: boolean;
  proofIdMatches: boolean;
  evidenceCommitmentsMatch: boolean;
  proofLevelMatches: boolean;
  proofRecordMatches: boolean;
  registryProgramMatches: boolean;
  authorizedRelayerMatches: boolean;
  proof?: ArgusProof;
  message?: string;
};

export type RelayerRegistrationResult = {
  proofId: string;
  manifestHash?: string;
  solanaTx: string;
  registryAddress: string;
  registryProgramId?: string;
  relayer?: string;
  proofRecord?: ArgusProofRecord;
  feePayer?: string;
  sponsoredGas: boolean;
  verificationUrl: string;
  deviceEvidenceSummary?: Partial<ArgusDeviceEvidenceSummary>;
  level4AttestationVerdict?: Record<string, unknown>;
};
