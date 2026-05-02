import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { validateAndroidEvidenceLevel } from "./androidEvidencePolicy.mjs";
import { assertCanonicalJsonBytes, canonicalJsonNumberLexeme } from "./canonicalJson.mjs";
import { assertPartnerAppAuthorized } from "./partnerPolicy.mjs";
import { assertPhotoBytesBase64TextLimit, decodeCanonicalPhotoBytes } from "./photoBytesPolicy.mjs";
import { assertRegistrationJsonTextLimits } from "./requestTextPolicy.mjs";
import { recordRegistrationProgress } from "./registrationProgress.mjs";
import { validateAndConsumeCaptureSession } from "./sessionStore.mjs";

loadEnv();

const TRUSTED_REGISTRY_PROGRAM_ID = "STmkbEWTmfBJR2mDHrbvKNjo2spT6mPU9668mw2hMaL";
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRY_SCHEMA_VERSION = 1;
const MANIFEST_SCHEMA_VERSION = "argus.manifest.v1";
const SUPPORTED_PROOF_LEVELS = new Set(["app_capture"]);
const SUPPORTED_USE_CASES = new Set(["marketplace_listing"]);
const MAX_CAMERA_EVIDENCE_DELAY_MS = 5_000;
const MAX_MOTION_CAPTURE_DELTA_MS = 2_000;
const CONFIRMED_COMMITMENT = "confirmed";
const SIGNATURE_CONFIRM_TIMEOUT_MS = 90_000;

// kr: submitRegisterProof는 Anchor register_proof instruction을 devnet/localnet에 직접 제출합니다.
// en: submitRegisterProof submits the Anchor register_proof instruction directly to devnet/localnet.
export async function submitRegisterProof(request) {
  const normalizedRequest = normalizeSubmitRegisterProofRequest(request);
  // kr: registry trust root는 session 소비 전에 고정합니다. production config가 틀리면 nonce를 태우지 않고 실패합니다.
  // en: Pin the registry trust root before consuming the session, so bad production config fails without burning the nonce.
  const programId = resolveRegistryProgramId();
  // kr: submitter는 proof bundle을 먼저 재검증하고, manifest/evidence/photo 검증 실패는 open session replay를 막기 위해 소비합니다.
  // kr: RPC/keypair/signature 전제 조건 실패는 operator 설정 문제라서 capture를 다시 요구하지 않도록 retry 가능하게 둡니다.
  // en: The submitter revalidates the proof bundle first; manifest/evidence/photo validation failures consume the open session to block replay.
  // en: RPC/keypair/signature prerequisite failures stay retryable because they are operator setup issues, not capture defects.
  const registration = validateSubmitRegisterProofRequest(normalizedRequest, {
    consumeSession: false,
    consumeSessionOnValidationFailure: true,
  });
  console.info("[Argus relayer] Solana submitter validation passed", {
    proofId: shortValue(registration.proofId),
    proofLevel: registration.proofLevel,
    useCase: registration.useCase,
  });
  recordRegistrationProgress(registration.proofId, "submitter_validated", "Solana submitter validated", {
    proofLevel: registration.proofLevel,
    useCase: registration.useCase,
  });
  const rpcUrl = process.env.SOLANA_RPC_URL || process.env.ANCHOR_PROVIDER_URL;
  if (!rpcUrl) {
    throw new Error("SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required");
  }

  const payer = await loadRelayerKeypair();
  assertAuthorizedRelayerSigner(payer.publicKey);
  const connection = new Connection(rpcUrl, CONFIRMED_COMMITMENT);
  const proofId = hexToBytes32("proofId", registration.proofId);
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("argus-config")],
    programId,
  );
  const [proofRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from("argus-proof"), Buffer.from(proofId)],
    programId,
  );
  console.info("[Argus relayer] Solana instruction prepared", {
    proofId: shortValue(registration.proofId),
    registryProgramId: programId.toBase58(),
    relayer: payer.publicKey.toBase58(),
    configAccount: configAccount.toBase58(),
    proofRecord: proofRecord.toBase58(),
    rpcHost: safeRpcHost(rpcUrl),
  });
  recordRegistrationProgress(registration.proofId, "instruction_prepared", "Solana instruction prepared", {
    configAccount: configAccount.toBase58(),
    proofRecord: proofRecord.toBase58(),
    registryProgramId: programId.toBase58(),
    relayer: payer.publicKey.toBase58(),
    rpcHost: safeRpcHost(rpcUrl),
  });

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configAccount, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: proofRecord, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildRegisterProofData(registration),
  });
  const transaction = new Transaction().add(instruction);
  // kr: proof bundle 검증이 끝난 뒤, chain submit 직전에 session을 소비해 재등록 replay를 막습니다.
  // en: After proof-bundle validation, consume the session just before chain submit to prevent registration replay.
  consumeRegistrationSession(normalizedRequest);
  console.info("[Argus relayer] capture session consumed before Solana submit", {
    proofId: shortValue(registration.proofId),
    captureSessionId: shortValue(normalizedRequest.captureSessionId),
  });
  recordRegistrationProgress(registration.proofId, "session_consumed", "Capture session consumed", {
    captureSessionId: normalizedRequest.captureSessionId,
  });
  const signature = await sendAndConfirmViaHttp(connection, transaction, [payer], {
    proofId: registration.proofId,
  });
  assertSolanaTransactionSignature(signature);

  return {
    configAccount: configAccount.toBase58(),
    proofRecord: proofRecord.toBase58(),
    relayer: payer.publicKey.toBase58(),
    registryAddress: programId.toBase58(),
    solanaTx: signature,
  };
}

async function sendAndConfirmViaHttp(connection, transaction, signers, context = {}) {
  const latestBlockhash = await connection.getLatestBlockhash(CONFIRMED_COMMITMENT);
  transaction.feePayer = signers[0].publicKey;
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.sign(...signers);

  console.info("[Argus relayer] sending Solana transaction", {
    proofId: shortValue(context.proofId),
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });
  recordRegistrationProgress(context.proofId, "transaction_sending", "Sending Solana transaction", {
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: CONFIRMED_COMMITMENT,
    maxRetries: 5,
  });
  console.info("[Argus relayer] Solana transaction submitted", {
    proofId: shortValue(context.proofId),
    signature: shortValue(signature),
  });
  recordRegistrationProgress(context.proofId, "transaction_submitted", "Solana transaction submitted", {
    signature,
  });
  await waitForSignatureViaHttp(connection, signature, latestBlockhash.lastValidBlockHeight);
  console.info("[Argus relayer] Solana transaction confirmed", {
    proofId: shortValue(context.proofId),
    signature: shortValue(signature),
  });
  recordRegistrationProgress(context.proofId, "transaction_confirmed", "Solana transaction confirmed", {
    signature,
  });
  return signature;
}

async function waitForSignatureViaHttp(connection, signature, lastValidBlockHeight) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SIGNATURE_CONFIRM_TIMEOUT_MS) {
    const response = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = response.value[0];

    if (status?.err) {
      throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    }

    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized" ||
      status?.confirmations === null
    ) {
      return;
    }

    const currentBlockHeight = await connection.getBlockHeight(CONFIRMED_COMMITMENT);
    if (currentBlockHeight > lastValidBlockHeight) {
      throw new Error(`Transaction ${signature} expired before confirmation`);
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for transaction ${signature} confirmation`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function assertSolanaTransactionSignature(value) {
  // kr: solanaTx는 commitment가 아니지만 production response/audit에 노출되는 relayer envelope입니다.
  // en: solanaTx is not a commitment, but it is exposed in the production response/audit envelope.
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value)) {
    throw new Error("solanaTx must be a plausible Solana transaction signature");
  }
}

function normalizeSubmitRegisterProofRequest(request) {
  if (!request || typeof request !== "object" || typeof request.appIdentityHash !== "string") {
    return request;
  }

  return {
    ...request,
    appIdentityHash: request.appIdentityHash.toLowerCase(),
  };
}

async function loadRelayerKeypair() {
  const keypairPath = process.env.ARGUS_RELAYER_KEYPAIR || process.env.SOLANA_KEYPAIR_PATH;
  if (!keypairPath) {
    throw new Error("ARGUS_RELAYER_KEYPAIR or SOLANA_KEYPAIR_PATH is required");
  }

  const rawKeypair = await readFile(resolveRepoPath(keypairPath), "utf8");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(rawKeypair)));
}

function resolveRepoPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT_DIR, value);
}

function shortValue(value) {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value.length <= 16 ? value : `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function safeRpcHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return "invalid-rpc-url";
  }
}

function assertAuthorizedRelayerSigner(relayerPublicKey) {
  const configuredRelayer = process.env.ARGUS_AUTHORIZED_RELAYER_PUBLIC_KEY;
  if (!configuredRelayer) {
    if (isProductionRuntime()) {
      throw new Error("ARGUS_AUTHORIZED_RELAYER_PUBLIC_KEY is required in production");
    }
    return;
  }

  const authorizedRelayer = new PublicKey(configuredRelayer);
  // kr: relayer signer는 registry config의 authorized relayer와 같은 trust root로 배포에서 고정되어야 합니다.
  // en: The relayer signer must be deployment-pinned to the same authorized relayer trust root as registry config.
  if (!relayerPublicKey.equals(authorizedRelayer)) {
    throw new Error("relayer keypair does not match ARGUS_AUTHORIZED_RELAYER_PUBLIC_KEY");
  }
}

function resolveRegistryProgramId() {
  const configuredProgramId =
    process.env.ARGUS_REGISTRY_PROGRAM_ID || TRUSTED_REGISTRY_PROGRAM_ID;
  const programId = new PublicKey(configuredProgramId);

  // kr: production에서는 known Argus Registry program만 trust root입니다. lookalike/devnet program은 fail-closed입니다.
  // en: In production, only the known Argus Registry program is the trust root; lookalike/devnet programs fail closed.
  if (isProductionRuntime() && programId.toBase58() !== TRUSTED_REGISTRY_PROGRAM_ID) {
    throw new Error(
      "ARGUS_REGISTRY_PROGRAM_ID must match the known Argus Registry program in production",
    );
  }

  return programId;
}

function isProductionRuntime() {
  return process.env.NODE_ENV?.trim().toLowerCase() === "production";
}

function buildRegisterProofData(request) {
  const discriminator = createHash("sha256")
    .update("global:register_proof")
    .digest()
    .subarray(0, 8);
  const proofId = hexToBytes32("proofId", request.proofId);
  const manifestHash = hexToBytes32("manifestHash", request.manifestHash);
  const imageHash = hexToBytes32("imageHash", request.imageHash);
  const partnerIdHash = hexToBytes32("partnerIdHash", request.partnerIdHash);
  const captureTimestamp = Buffer.alloc(8);
  captureTimestamp.writeBigInt64LE(BigInt(request.captureTimestamp), 0);
  const proofLevel = Buffer.from([mapProofLevel(request.proofLevel)]);
  const useCase = Buffer.from([mapUseCase(request.useCase)]);
  const schemaVersion = Buffer.alloc(2);
  schemaVersion.writeUInt16LE(request.schemaVersion ?? REGISTRY_SCHEMA_VERSION, 0);

  return Buffer.concat([
    discriminator,
    Buffer.from(proofId),
    Buffer.from(manifestHash),
    Buffer.from(imageHash),
    Buffer.from(partnerIdHash),
    captureTimestamp,
    proofLevel,
    useCase,
    schemaVersion,
  ]);
}

function hexToBytes32(field, value) {
  if (!/^[0-9a-f]{64}$/.test(value) || /^0{64}$/.test(value)) {
    throw new Error(`${field} must be a canonical lowercase non-zero 32-byte hex string`);
  }

  return Uint8Array.from(Buffer.from(value, "hex"));
}

function mapUseCase(useCase) {
  if (useCase === "marketplace_listing") {
    return 1;
  }

  throw new Error("useCase is not supported by the registry submitter");
}

function mapProofLevel(proofLevel) {
  if (proofLevel === "demo") {
    return 0;
  }

  if (proofLevel === "app_capture") {
    return 1;
  }

  throw new Error("proofLevel is not supported by the registry submitter");
}

function validateSubmitRegisterProofRequest(
  request,
  { consumeSession = true, consumeSessionOnValidationFailure = false } = {},
) {
  if (!request || typeof request !== "object") {
    throw new Error("register proof request is required");
  }

  for (const field of [
    "proofId",
    "manifestHash",
    "imageHash",
    "partnerId",
    "partnerIdHash",
    "useCase",
    "canonicalManifestJson",
    "metadataJson",
    "cameraEvidenceJson",
    "deviceIntegrityJson",
    "photoBytesBase64",
    "captureSessionId",
    "sessionNonce",
    "appIdentityHash",
    "proofLevel",
  ]) {
    if (!request[field]) {
      throw new Error(`${field} is required for registry submission`);
    }
  }

  assertRegistrationJsonTextLimits(request, "for registry submission");
  assertPhotoBytesBase64TextLimit(
    "photoBytesBase64",
    request.photoBytesBase64,
    "for registry submission",
  );

  for (const field of [
    "proofId",
    "manifestHash",
    "imageHash",
    "partnerIdHash",
    "sessionNonce",
    "appIdentityHash",
  ]) {
    hexToBytes32(field, request[field]);
  }

  if (request.schemaVersion !== undefined && request.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new Error("schemaVersion is not supported by the registry submitter");
  }

  if (!SUPPORTED_USE_CASES.has(request.useCase)) {
    throw new Error("useCase is not supported by the registry submitter");
  }

  assertPartnerAppAuthorized({
    allowDefaultPolicy: false,
    appIdentityHash: request.appIdentityHash,
    partnerId: request.partnerId,
    useCase: request.useCase,
  });

  if (!SUPPORTED_PROOF_LEVELS.has(request.proofLevel)) {
    throw new Error("proofLevel is not supported by the registry submitter");
  }

  const calculatedPartnerIdHash = sha256Hex(request.partnerId);
  if (calculatedPartnerIdHash !== request.partnerIdHash) {
    throw new Error("partnerIdHash does not match partnerId");
  }

  if (consumeSession) {
    consumeRegistrationSession(request);
  }

  try {
    const manifest = parseCanonicalManifest(request.canonicalManifestJson);
    if (canonicalManifestStringify(manifest) !== request.canonicalManifestJson) {
      throw new Error("canonicalManifestJson is not a canonical Argus manifest");
    }

    const calculatedManifestHash = sha256Hex(request.canonicalManifestJson);
    if (calculatedManifestHash !== request.manifestHash) {
      throw new Error("manifestHash does not match canonicalManifestJson");
    }

    validateManifestPolicy(request, manifest, calculatedManifestHash);

    return {
      proofId: request.proofId,
      manifestHash: calculatedManifestHash,
      imageHash: manifest.image_sha256,
      partnerIdHash: manifest.partner_id_hash,
      captureTimestamp: manifest.captured_at_ms,
      proofLevel: manifest.proof_level,
      useCase: manifest.use_case,
      schemaVersion: REGISTRY_SCHEMA_VERSION,
    };
  } catch (error) {
    if (!consumeSession && consumeSessionOnValidationFailure) {
      consumeRegistrationSessionIfPresent(request);
    }
    throw error;
  }
}

function parseCanonicalManifest(value) {
  try {
    const manifest = JSON.parse(value);
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new Error("not an object");
    }
    return manifest;
  } catch {
    throw new Error("canonicalManifestJson must be valid JSON");
  }
}

function validateManifestPolicy(request, manifest, manifestHash) {
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

  hexToBytes32("manifest.image_sha256", manifest.image_sha256);
  hexToBytes32("manifest.nonce", manifest.nonce);
  hexToBytes32("manifest.app_identity_hash", manifest.app_identity_hash);

  const calculatedProofId = deriveProofId(manifestHash, manifest.image_sha256, manifest.nonce);
  if (calculatedProofId !== request.proofId) {
    throw new Error("proofId does not match canonicalManifestJson");
  }

  assertEvidenceCommitment("metadataJson", request.metadataJson, manifest.metadata_commitment);
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
  enforceProofLevelPolicy(request, manifest);
}

function assertCaptureTimestampNotAfterRelayerClock(capturedAtMs, nowMs = Date.now()) {
  // kr: registeredAt 응답은 relayer 운영 timestamp입니다. capture time이 미래면 production submit 전에 fail-closed 합니다.
  // en: registeredAt is a relayer operational timestamp; fail closed on future capture times before production submit.
  if (capturedAtMs > nowMs) {
    throw new Error("manifest captured_at_ms cannot be after relayer receipt time");
  }
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
    // kr: 원래 proof-bundle validation 실패를 숨기지 않도록 session 상태 오류는 여기서 삼킵니다.
    // en: Do not hide the original proof-bundle validation failure; swallow session-state errors here.
  }
}

function assertEvidenceCommitment(field, value, expectedHash) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required for registry submission`);
  }

  hexToBytes32(`manifest commitment for ${field}`, expectedHash);
  const calculatedHash = sha256Hex(value);

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
  validateAndroidEvidenceLevel({ deviceIntegrity, manifest, request });
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
    "for registry submission",
  );
  if (photoBytes.byteLength !== cameraEvidence.capturedFileBytes) {
    throw new Error("cameraEvidenceJson capturedFileBytes does not match photoBytesBase64");
  }

  const calculatedImageHash = sha256Hex(photoBytes);
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

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
