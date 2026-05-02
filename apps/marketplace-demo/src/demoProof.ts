import {
  ARGUS_LOCAL_DEMO_RELAYER,
  ARGUS_REGISTRY_PROGRAM_ID,
} from "../../../packages/argus-rn-sdk/src/proofStatus.ts";
import type { ArgusProof } from "../../../packages/argus-rn-sdk/src/types.ts";

// kr: createMarketplaceSimulatorProof는 native module이 없는 RN preview에서도 데모 흐름을 보여주기 위한 fallback입니다.
// en: createMarketplaceSimulatorProof is a fallback that shows the demo flow in RN previews without the native module.
export function createMarketplaceSimulatorProof(): ArgusProof {
  const capturedAtMs = Date.now();
  const capturedAt = new Date(capturedAtMs).toISOString();
  const proofSeed = String(capturedAtMs);
  const captureSessionId = `argus-session-${proofSeed}`;
  const proofId = demoHex(`proof:${proofSeed}`);
  const manifestHash = demoHex(`manifest:${proofSeed}`);
  const imageHash = demoHex(`image:${proofSeed}`);
  const partnerIdHash = demoHex("partner:recommerce-demo");
  const nonce = demoHex(`nonce:${proofSeed}`);
  const appIdentityHash = demoHex("app:com.argus.marketplace.demo");
  const metadataJson = "{\"listingId\":\"ebay-argus-camera-001\",\"source\":\"ebay_argus\"}";
  const cameraEvidenceJson = `{"captureSurface":"android-native-camera-stub","capturedAtMs":${capturedAtMs},"noGalleryImport":true}`;
  const deviceIntegrityJson = `{"androidEvidenceLevel":1,"appIdentityHash":"${appIdentityHash}","appIdentityHashPresent":true,"attestationCertificateChainPem":[],"attestationStatus":"level_4_unsupported_fell_back_to_level_1_demo","evidenceLevel":"level_1_demo","hardwareAttestation":{"fallbackLevel":1,"reason":"local_demo_no_android_keystore","supported":false},"keystorePublicKeyPem":"","keystoreSignature":false,"level3KeystoreSignature":false,"level4HardwareAttestation":false,"motionSnapshotPresent":true}`;
  const canonicalManifestJson = [
    "{",
    "\"schema_version\":\"argus.manifest.v1\",",
    `"partner_id_hash":"${partnerIdHash}",`,
    "\"use_case\":\"marketplace_listing\",",
    `"capture_session_id":"${captureSessionId}",`,
    `"captured_at_ms":${capturedAtMs},`,
    `"image_sha256":"${imageHash}",`,
    `"metadata_commitment":"${demoHex(`metadata:${proofSeed}`)}",`,
    `"camera_evidence_commitment":"${demoHex(`camera:${proofSeed}`)}",`,
    `"device_integrity_commitment":"${demoHex(`device:${proofSeed}`)}",`,
    `"app_identity_hash":"${appIdentityHash}",`,
    `"nonce":"${nonce}",`,
    "\"proof_level\":\"demo\"",
    "}",
  ].join("");

  return {
    proofId,
    manifestHash,
    imageHash,
    partnerIdHash,
    canonicalManifestJson,
    metadataJson,
    cameraEvidenceJson,
    deviceIntegrityJson,
    photoBytesBase64: "YXJndXMtbWFya2V0cGxhY2UtZGVtby1waG90bw==",
    captureSessionId,
    nonce,
    appIdentityHash,
    proofLevel: "demo",
    solanaTx: demoHex(`simulated-solana-tx:${proofSeed}`),
    registryAddress: ARGUS_REGISTRY_PROGRAM_ID,
    registryProgramId: ARGUS_REGISTRY_PROGRAM_ID,
    relayer: ARGUS_LOCAL_DEMO_RELAYER,
    feePayer: ARGUS_LOCAL_DEMO_RELAYER,
    sponsoredGas: false,
    proofRecord: {
      proofId,
      manifestHash,
      imageHash,
      partnerIdHash,
      proofLevel: "demo",
      captureTimestamp: capturedAtMs,
      registeredAt: capturedAt,
      relayer: ARGUS_LOCAL_DEMO_RELAYER,
      relayerAuthorized: false,
      registryProgramId: ARGUS_REGISTRY_PROGRAM_ID,
      status: "revoked",
    },
    capturedAt,
    partnerId: "recommerce-demo",
    useCase: "marketplace_listing",
    verificationUrl: "",
    integrityLevel: "demo",
    deviceEvidenceSummary: {
      cameraMetadata: true,
      motionSnapshot: true,
      appIdentityHash: true,
      keystoreSignature: false,
      evidenceLevel: "level_1_demo",
      androidEvidenceLevel: 1,
      level3KeystoreSignature: false,
      level4HardwareAttestation: false,
      attestationStatus: "level_4_unsupported_fell_back_to_level_1_demo",
      keystorePublicKeyPem: "",
      attestationCertificateChainPem: [],
    },
  };
}

function demoHex(seed: string): string {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash).toString(16).padStart(8, "0").repeat(8).slice(0, 64);
}
