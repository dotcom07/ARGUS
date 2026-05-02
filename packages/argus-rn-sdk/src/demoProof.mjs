const STORAGE_PREFIX = "argus-proof:";
const ARGUS_REGISTRY_PROGRAM_ID = "STmkbEWTmfBJR2mDHrbvKNjo2spT6mPU9668mw2hMaL";
const ARGUS_AUTHORIZED_RELAYER = "Ao3Vi2HeQHWyyPDA52rqVLYv8nt7pvAVQtPB1qw2pvTs";
const ARGUS_LOCAL_DEMO_RELAYER = "ArgusLocalDemoRelayer111111111111111111111111";
const ARGUS_MANIFEST_SCHEMA_VERSION = "argus.manifest.v1";
const MAX_CANONICAL_MANIFEST_JSON_BYTES = 4 * 1024;
const MAX_METADATA_JSON_BYTES = 64 * 1024;
const MAX_EVIDENCE_JSON_BYTES = 16 * 1024;
const MAX_REPORTED_TRANSACTION_REFERENCE_BYTES = 512;
const MAX_NATIVE_CAPTURE_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_NATIVE_CAPTURE_PHOTO_BASE64_LENGTH = Math.ceil(MAX_NATIVE_CAPTURE_PHOTO_BYTES / 3) * 4;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// kr: stableStringify는 manifest와 evidence hash가 매번 같은 값이 되도록 key 순서를 고정합니다.
// en: stableStringify fixes key order so manifest and evidence hashes stay deterministic.
export function stableStringify(value) {
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

// kr: sha256Hex는 browser demo와 Node test에서 같은 hash 문자열을 만들기 위한 helper입니다.
// en: sha256Hex creates the same hash string in the browser demo and Node tests.
export async function sha256Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;

  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return bytesToHex(new Uint8Array(digest));
  }

  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

// kr: createDemoCaptureProof는 웹 데모에서 Kotlin/Rust/relayer 흐름을 얇게 시뮬레이션합니다.
// en: createDemoCaptureProof thinly simulates the Kotlin/Rust/relayer flow for the web demo.
export async function createDemoCaptureProof(options) {
  validateCaptureOptions(options);

  const capturedAtMs = Date.now();
  const capturedAt = new Date(capturedAtMs).toISOString();
  const captureSessionId = `argus-session-${capturedAtMs}`;
  const nonce = await sha256Hex(`${captureSessionId}:${options.partnerId}:${Math.random()}`);
  const productPhotoBytes = new TextEncoder().encode(
    `${options.metadata.listingId}:${options.metadata.title}:${captureSessionId}`,
  );
  const imageHash = await sha256Hex(productPhotoBytes);
  const photoBytesBase64 = bytesToBase64(productPhotoBytes);
  const appIdentityHash = await sha256Hex("com.argus.marketplace.demo:demo-signing-cert");
  const metadataJson = stableStringify({
    condition: options.metadata.condition,
    listingId: options.metadata.listingId,
    listingTitle: options.metadata.title,
    source: "argus-marketplace-demo",
  });
  const cameraEvidenceJson = stableStringify(buildDemoCameraEvidence(capturedAtMs));
  const deviceIntegrityJson = stableStringify(buildDemoDeviceIntegrity(appIdentityHash));

  const manifest = {
    app_identity_hash: appIdentityHash,
    camera_evidence_commitment: await sha256Hex(cameraEvidenceJson),
    capture_session_id: captureSessionId,
    captured_at_ms: capturedAtMs,
    device_integrity_commitment: await sha256Hex(deviceIntegrityJson),
    image_sha256: imageHash,
    metadata_commitment: await sha256Hex(metadataJson),
    nonce,
    partner_id_hash: await sha256Hex(options.partnerId),
    proof_level: "demo",
    schema_version: "argus.manifest.v1",
    use_case: options.useCase,
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = await sha256Hex(canonicalManifestJson);
  const proofId = await deriveProofId(manifestHash, imageHash, nonce);
  const registration = await registerDemoProof({
    proofId,
    manifestHash,
    imageHash,
    partnerIdHash: manifest.partner_id_hash,
    partnerId: options.partnerId,
    proofLevel: manifest.proof_level,
    captureTimestamp: manifest.captured_at_ms,
    useCase: options.useCase,
  });

  const proof = {
    proofId,
    manifestHash,
    imageHash,
    partnerIdHash: manifest.partner_id_hash,
    captureSessionId,
    nonce,
    appIdentityHash,
    proofLevel: manifest.proof_level,
    canonicalManifestJson,
    metadataJson,
    cameraEvidenceJson,
    deviceIntegrityJson,
    photoBytesBase64,
    solanaTx: registration.solanaTx,
    registryAddress: registration.registryAddress,
    registryProgramId: registration.registryProgramId,
    relayer: registration.relayer,
    feePayer: registration.feePayer,
    sponsoredGas: registration.sponsoredGas,
    proofRecord: registration.proofRecord,
    capturedAt,
    partnerId: options.partnerId,
    useCase: options.useCase,
    verificationUrl: `../verifier-web/index.html?proofId=${proofId}`,
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
    manifest,
    evidencePreview: {
      camera: JSON.parse(cameraEvidenceJson),
      device: JSON.parse(deviceIntegrityJson),
      metadata: JSON.parse(metadataJson),
    },
  };

  saveProof(proof);
  return proof;
}

// kr: verifyDemoProof는 verifier 화면에서 manifest hash와 registry commitment를 다시 비교합니다.
// en: verifyDemoProof recomputes the manifest hash and compares it with the registry commitment.
export async function verifyDemoProof(proofId) {
  if (!isNonZeroHex32(proofId)) {
    return {
      ...failedProofBundleMatches(),
      status: "missing",
      message: "No local proof was found for this proof id.",
    };
  }

  const proof = loadProof(proofId);

  if (!proof) {
    return {
      ...failedProofBundleMatches(),
      status: "missing",
      message: "No local proof was found for this proof id.",
    };
  }

  const manifest = parseCanonicalManifest(proof.canonicalManifestJson);
  const canonicalManifestMatches =
    Boolean(manifest) && canonicalManifestStringify(manifest) === proof.canonicalManifestJson;
  const canonicalHexFieldsMatch = canonicalProofHexFieldsMatch(proof, manifest);
  const calculatedManifestHash = canonicalManifestMatches
    ? await sha256Hex(proof.canonicalManifestJson)
    : null;
  const manifestHashMatches =
    calculatedManifestHash === proof.manifestHash &&
    proof.proofRecord?.manifestHash === proof.manifestHash;
  const photoBytes = proof.photoBytesBase64 ? base64ToBytes(proof.photoBytesBase64) : null;
  const calculatedImageHash = photoBytes ? await sha256Hex(photoBytes) : null;
  const imageHashMatches =
    calculatedImageHash === proof.imageHash &&
    calculatedImageHash === manifest?.image_sha256 &&
    proof.proofRecord?.imageHash === proof.imageHash;
  const calculatedProofId =
    manifestHashMatches && imageHashMatches && canonicalHexFieldsMatch
      ? await deriveProofId(calculatedManifestHash, manifest.image_sha256, manifest.nonce)
      : null;
  const proofIdMatches =
    calculatedProofId === proof.proofId &&
    proof.proofId === proofId &&
    proof.proofRecord?.proofId === proof.proofId;
  const evidenceCommitmentsMatch =
    canonicalManifestMatches &&
    canonicalHexFieldsMatch &&
    (await verifyEvidenceCommitments(manifest, proof));
  const proofLevelMatches =
    canonicalHexFieldsMatch &&
    manifest?.schema_version === ARGUS_MANIFEST_SCHEMA_VERSION &&
    isPositiveSafeInteger(manifest?.captured_at_ms) &&
    isIsoTimestampAtMs(proof.capturedAt, manifest?.captured_at_ms) &&
    manifest?.proof_level === proof.proofLevel &&
    manifest?.proof_level === proof.integrityLevel &&
    proof.proofRecord?.proofLevel === manifest?.proof_level &&
    proofLevelPolicyMatches(manifest?.proof_level, proof);
  const isLocalDemoProof = proof.proofRecord?.proofLevel === "demo" || proof.proofLevel === "demo";
  const proofRecordMatches =
    proof.proofRecord?.proofId === proof.proofId &&
    proof.proofRecord?.manifestHash === proof.manifestHash &&
    proof.proofRecord?.imageHash === proof.imageHash &&
    proof.proofRecord?.partnerIdHash === proof.partnerIdHash &&
    proof.proofRecord?.proofLevel === manifest?.proof_level &&
    proof.proofRecord?.captureTimestamp === manifest?.captured_at_ms &&
    isPlausibleProofRecordRegisteredAt(proof.proofRecord?.registeredAt, manifest?.captured_at_ms) &&
    proof.proofRecord?.status === (isLocalDemoProof ? "superseded" : "active");
  const registryProgramMatches =
    proof.registryAddress === ARGUS_REGISTRY_PROGRAM_ID &&
    proof.registryProgramId === ARGUS_REGISTRY_PROGRAM_ID &&
    proof.proofRecord?.registryProgramId === ARGUS_REGISTRY_PROGRAM_ID;
  const authorizedRelayerMatches =
    proof.relayer === ARGUS_AUTHORIZED_RELAYER &&
    proof.proofRecord?.relayer === ARGUS_AUTHORIZED_RELAYER &&
    proof.proofRecord?.relayerAuthorized === true;
  // kr: localStorage preview도 sponsoredGas를 주장하면 demo_verified로 승격하지 않습니다. production sponsorship과 local preview는 서로 배타적인 trust boundary입니다.
  // en: Even localStorage previews must not claim sponsoredGas; production sponsorship and local preview are mutually exclusive trust boundaries.
  const localDemoRelayerMatches =
    proof.relayer === ARGUS_LOCAL_DEMO_RELAYER &&
    proof.feePayer === ARGUS_LOCAL_DEMO_RELAYER &&
    proof.sponsoredGas === false &&
    proof.proofRecord?.relayer === ARGUS_LOCAL_DEMO_RELAYER &&
    proof.proofRecord?.relayerAuthorized === false;
  const verificationUrlMatches = proof.verificationUrl === `../verifier-web/index.html?proofId=${proofId}`;
  const bundleMatches =
    canonicalManifestMatches &&
    manifestHashMatches &&
    imageHashMatches &&
    proofIdMatches &&
    evidenceCommitmentsMatch &&
    proofLevelMatches &&
    proofRecordMatches &&
    registryProgramMatches;
  const demoVerified =
    bundleMatches &&
    isLocalDemoProof &&
    localDemoRelayerMatches &&
    verificationUrlMatches;
  const bundleMatchFlags = demoVerified
    ? {
        manifestHashMatches,
        imageHashMatches,
        proofIdMatches,
        evidenceCommitmentsMatch,
        proofLevelMatches,
        proofRecordMatches,
        registryProgramMatches,
        authorizedRelayerMatches,
      }
    : failedProofBundleMatches();

  if (!demoVerified) {
    // kr: 실패한 localStorage preview는 공격자가 쓴 claim일 수 있으므로 proof/tx/link/hash 진단을 모두 scrub합니다.
    // en: A failed localStorage preview may be attacker-written, so scrub proof/tx/link/hash diagnostics.
    return {
      status: "failed",
      ...failedProofBundleMatches(),
    };
  }

  return {
    status: "demo_verified",
    ...bundleMatchFlags,
    calculatedManifestHash,
    calculatedImageHash,
    registeredManifestHash: proof.manifestHash,
    proof: sanitizeAcceptedProof(proof),
  };
}

function sanitizeAcceptedProof(proof) {
  // kr: browser demo의 localStorage도 proof-bundle store라서 표시용 tx metadata를 그대로 신뢰하지 않습니다.
  // en: Browser-demo localStorage is also a proof-bundle store, so display-only tx metadata is not trusted as-is.
  const solanaTx = sanitizeReportedTransactionReference(proof?.solanaTx);
  return solanaTx === proof?.solanaTx ? proof : { ...proof, solanaTx };
}

function sanitizeReportedTransactionReference(value) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    /\s/.test(value) ||
    utf8ByteLength(value) > MAX_REPORTED_TRANSACTION_REFERENCE_BYTES
  ) {
    return undefined;
  }

  return value;
}

function failedProofBundleMatches() {
  return {
    manifestHashMatches: false,
    imageHashMatches: false,
    proofIdMatches: false,
    evidenceCommitmentsMatch: false,
    proofLevelMatches: false,
    proofRecordMatches: false,
    registryProgramMatches: false,
    authorizedRelayerMatches: false,
  };
}

function canonicalProofHexFieldsMatch(proof, manifest) {
  return (
    Boolean(manifest) &&
    isNonZeroHex32(proof.proofId) &&
    isNonZeroHex32(proof.manifestHash) &&
    isNonZeroHex32(proof.imageHash) &&
    isNonZeroHex32(proof.partnerIdHash) &&
    isNonZeroHex32(proof.nonce) &&
    isNonZeroHex32(proof.appIdentityHash) &&
    isNonZeroHex32(manifest.partner_id_hash) &&
    isNonZeroHex32(manifest.image_sha256) &&
    isNonZeroHex32(manifest.metadata_commitment) &&
    isNonZeroHex32(manifest.camera_evidence_commitment) &&
    isNonZeroHex32(manifest.device_integrity_commitment) &&
    isNonZeroHex32(manifest.app_identity_hash) &&
    isNonZeroHex32(manifest.nonce)
  );
}

function parseCanonicalManifest(value) {
  if (!value || typeof value !== "string" || utf8ByteLength(value) > MAX_CANONICAL_MANIFEST_JSON_BYTES) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).length;
}

async function verifyEvidenceCommitments(manifest, proof) {
  // kr: localStorage preview bundle도 untrusted data라 relayer와 같은 text cap을 넘기면 preview로도 승격하지 않습니다.
  // en: The localStorage preview bundle is also untrusted data; oversized evidence does not become even a demo preview.
  return (
    (await commitmentMatches(proof.metadataJson, manifest.metadata_commitment, MAX_METADATA_JSON_BYTES)) &&
    (await commitmentMatches(
      proof.cameraEvidenceJson,
      manifest.camera_evidence_commitment,
      MAX_EVIDENCE_JSON_BYTES,
    )) &&
    (await commitmentMatches(
      proof.deviceIntegrityJson,
      manifest.device_integrity_commitment,
      MAX_EVIDENCE_JSON_BYTES,
    )) &&
    (await partnerIdHashMatches(proof.partnerId, proof.partnerIdHash)) &&
    manifest.app_identity_hash === proof.appIdentityHash &&
    manifest.nonce === proof.nonce &&
    manifest.capture_session_id === proof.captureSessionId &&
    manifest.partner_id_hash === proof.partnerIdHash &&
    manifest.use_case === proof.useCase
  );
}

async function commitmentMatches(value, expectedHash, maxUtf8Bytes) {
  if (
    !value ||
    typeof value !== "string" ||
    utf8ByteLength(value) > maxUtf8Bytes ||
    typeof expectedHash !== "string"
  ) {
    return false;
  }

  return (await sha256Hex(value)) === expectedHash;
}

async function partnerIdHashMatches(partnerId, partnerIdHash) {
  return (
    typeof partnerId === "string" &&
    partnerId.trim().length > 0 &&
    (await sha256Hex(partnerId)) === partnerIdHash
  );
}

function proofLevelPolicyMatches(proofLevel, proof) {
  const cameraEvidence = parseEvidenceJson(proof.cameraEvidenceJson, MAX_EVIDENCE_JSON_BYTES);
  const deviceIntegrity = parseEvidenceJson(proof.deviceIntegrityJson, MAX_EVIDENCE_JSON_BYTES);
  const deviceEvidenceMatches =
    deviceIntegrityPolicyMatches(deviceIntegrity, proof.appIdentityHash) && hasMotionEvidence(deviceIntegrity);
  const summaryMatches =
    proof.deviceEvidenceSummary?.cameraMetadata === true &&
    proof.deviceEvidenceSummary?.motionSnapshot === true &&
    proof.deviceEvidenceSummary?.appIdentityHash === true;

  if (proofLevel === "demo") {
    return cameraEvidencePolicyMatches(cameraEvidence, true) && deviceEvidenceMatches && summaryMatches;
  }

  if (proofLevel === "app_capture") {
    return cameraEvidencePolicyMatches(cameraEvidence, false) && deviceEvidenceMatches && summaryMatches;
  }

  return false;
}

function parseEvidenceJson(value, maxUtf8Bytes) {
  if (!value || typeof value !== "string" || utf8ByteLength(value) > maxUtf8Bytes) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function cameraEvidencePolicyMatches(cameraEvidence, allowSimulatorSurface) {
  return (
    cameraEvidence?.noGalleryImport === true &&
    (cameraEvidence.captureSurface === "native_android_camera" ||
      (allowSimulatorSurface && cameraEvidence.captureSurface === "android-native-camera-stub"))
  );
}

function deviceIntegrityPolicyMatches(deviceIntegrity, appIdentityHash) {
  return (
    deviceIntegrity?.appIdentityHash === appIdentityHash &&
    deviceIntegrity.appIdentityHashPresent === true
  );
}

function hasMotionEvidence(deviceIntegrity) {
  if (deviceIntegrity?.motionSnapshotPresent === true) {
    return true;
  }

  const snapshot = deviceIntegrity?.motionSnapshot;
  return Boolean(snapshot && typeof snapshot === "object" && snapshot.available === true);
}

// kr: saveProof는 browser demo에서 marketplace와 verifier가 같은 proof를 읽게 합니다.
// en: saveProof lets the marketplace and verifier pages read the same proof in the browser demo.
export function saveProof(proof) {
  if (!globalThis.localStorage) {
    return;
  }

  globalThis.localStorage.setItem(`${STORAGE_PREFIX}${proof.proofId}`, JSON.stringify(proof));
}

// kr: loadProof는 verifier가 proofId로 저장된 증명을 조회하는 함수입니다.
// en: loadProof fetches a saved proof by proofId for the verifier.
export function loadProof(proofId) {
  if (!globalThis.localStorage || !proofId) {
    return null;
  }

  const rawProof = globalThis.localStorage.getItem(`${STORAGE_PREFIX}${proofId}`);
  if (!rawProof) {
    return null;
  }

  try {
    return JSON.parse(rawProof);
  } catch {
    return null;
  }
}

async function registerDemoProof(fields) {
  const solanaTx = await sha256Hex(
    `argus-demo-tx:${fields.proofId}:${fields.manifestHash}:${ARGUS_LOCAL_DEMO_RELAYER}`,
  );
  const registeredAt = new Date().toISOString();
  const proofRecord = {
    proofId: fields.proofId,
    manifestHash: fields.manifestHash,
    imageHash: fields.imageHash,
    partnerIdHash: fields.partnerIdHash,
    proofLevel: fields.proofLevel,
    captureTimestamp: fields.captureTimestamp,
    registeredAt,
    relayer: ARGUS_LOCAL_DEMO_RELAYER,
    relayerAuthorized: false,
    registryProgramId: ARGUS_REGISTRY_PROGRAM_ID,
    status: "superseded",
  };

  return {
    solanaTx: solanaTx.slice(0, 64),
    registryAddress: ARGUS_REGISTRY_PROGRAM_ID,
    registryProgramId: ARGUS_REGISTRY_PROGRAM_ID,
    relayer: ARGUS_LOCAL_DEMO_RELAYER,
    feePayer: ARGUS_LOCAL_DEMO_RELAYER,
    proofRecord,
    sponsoredGas: false,
  };
}

async function deriveProofId(manifestHash, imageHash, nonce) {
  const manifestHashBytes = hexToBytes(manifestHash);
  const imageHashBytes = hexToBytes(imageHash);
  const nonceBytes = hexToBytes(nonce);
  if (!manifestHashBytes || !imageHashBytes || !nonceBytes) {
    return null;
  }

  const prefix = new TextEncoder().encode("argus-proof-v1");
  const bytes = new Uint8Array(prefix.length + 32 + 32 + 32);
  bytes.set(prefix, 0);
  bytes.set(manifestHashBytes, prefix.length);
  bytes.set(imageHashBytes, prefix.length + 32);
  bytes.set(nonceBytes, prefix.length + 64);
  return sha256Hex(bytes);
}

function hexToBytes(hex) {
  if (!isNonZeroHex32(hex)) {
    return null;
  }

  const bytes = new Uint8Array(hex.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

function isNonZeroHex32(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) && !/^0{64}$/.test(value);
}

function isPlausibleProofRecordRegisteredAt(value, captureTimestamp) {
  // kr: localStorage preview의 registeredAt도 proof-bundle envelope 필드라, strict ISO와 capture 이후 순서를 만족할 때만 preview로 승격합니다.
  // en: localStorage preview registeredAt is also a proof-bundle envelope field, so it only promotes when strict ISO and after capture.
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

function isIsoTimestampAtMs(value, timestampMs) {
  // kr: localStorage proof bundle은 사용자가 수정할 수 있으므로, 표시용 capturedAt도 manifest에 commitment된 instant와 같을 때만 신뢰합니다.
  // en: The localStorage proof bundle is user-editable, so trust display capturedAt only when it matches the manifest-committed instant.
  const parsed = strictIsoTimestampMs(value);
  return (
    parsed !== null &&
    typeof timestampMs === "number" &&
    Number.isSafeInteger(timestampMs) &&
    timestampMs > 0 &&
    parsed === timestampMs
  );
}

function strictIsoTimestampMs(value) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function buildDemoCameraEvidence(capturedAtMs) {
  return {
    cameraId: "0",
    captureSurface: "android-native-camera-stub",
    capturedAtMs,
    exposureTimeNs: 8333333,
    focalLengthMm: 4.25,
    imageDimensions: "3024x4032",
    iso: 125,
    lensFacing: "back",
    noGalleryImport: true,
    orientation: "portrait",
    sensorTimestampNs: capturedAtMs * 1_000_000,
  };
}

function buildDemoDeviceIntegrity(appIdentityHash) {
  return {
    attestationCertificateChainPem: [],
    attestationStatus: "level_4_unsupported_fell_back_to_level_1_demo",
    androidEvidenceLevel: 1,
    evidenceLevel: "level_1_demo",
    hardwareAttestation: {
      fallbackLevel: 1,
      reason: "local_demo_no_android_keystore",
      supported: false,
    },
    appIdentityHash,
    appIdentityHashPresent: true,
    appPackageName: "com.argus.marketplace.demo",
    keystorePublicKeyPem: "",
    keystoreSignature: false,
    level3KeystoreSignature: false,
    level4HardwareAttestation: false,
    motionSnapshotPresent: true,
    relayerSponsoredGas: true,
  };
}

function bytesToBase64(bytes) {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value) {
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

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function base64HasCanonicalTrailingBits(value, padding) {
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

function validateCaptureOptions(options) {
  if (!options?.partnerId) {
    throw new Error("partnerId is required");
  }

  if (!options?.useCase) {
    throw new Error("useCase is required");
  }

  if (!options?.metadata?.listingId) {
    throw new Error("metadata.listingId is required");
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
