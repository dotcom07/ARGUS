import { getConfig } from "./config.ts";
import {
  ARGUS_AUTHORIZED_RELAYER,
  ARGUS_REGISTRY_PROGRAM_ID,
  isNativeJpegPhotoBytes,
  isArgusLocalDemoProof,
  isArgusProductionProof,
  isIsoTimestampAtMs,
  isPlausibleProofRecordRegisteredAt,
  isSupportedProductionProofLevel,
} from "./proofStatus.ts";
import type { ArgusProof, VerificationResult } from "./types.ts";

type SubtleCryptoLike = {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
};

type VerificationMatchFlags = Required<
  Pick<
    VerificationResult,
    | "manifestHashMatches"
    | "imageHashMatches"
    | "proofIdMatches"
    | "evidenceCommitmentsMatch"
    | "proofLevelMatches"
    | "proofRecordMatches"
    | "registryProgramMatches"
    | "authorizedRelayerMatches"
  >
>;

const ARGUS_MANIFEST_SCHEMA_VERSION = "argus.manifest.v1";
const ARGUS_DEFAULT_VERIFIER_ORIGIN = "https://verify.argus.dev";
const MAX_CANONICAL_MANIFEST_JSON_BYTES = 4 * 1024;
const MAX_METADATA_JSON_BYTES = 64 * 1024;
const MAX_EVIDENCE_JSON_BYTES = 16 * 1024;
const MAX_REPORTED_TRANSACTION_REFERENCE_BYTES = 512;
const MAX_NATIVE_CAPTURE_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_NATIVE_CAPTURE_PHOTO_BASE64_LENGTH = Math.ceil(MAX_NATIVE_CAPTURE_PHOTO_BYTES / 3) * 4;

// kr: verifyProof는 proofId를 verifier API에 보내 등록된 manifest hash와 비교 결과를 받습니다.
// en: verifyProof sends a proofId to the verifier API and receives the manifest-hash comparison result.
export async function verifyProof(proofId: string): Promise<VerificationResult> {
  if (!isNonZeroHex32(proofId)) {
    return failedResult("Proof id is not a valid Argus proof id.");
  }

  const config = getConfig();
  const verifierApiUrl = buildVerifierApiUrl(config.verifierBaseUrl, proofId);
  if (!verifierApiUrl) {
    return failedResult("Verifier base URL is not safe.");
  }

  let response: Response;
  try {
    response = await fetch(verifierApiUrl);
  } catch {
    return failedResult("Verifier request failed.");
  }

  if (!response.ok) {
    // kr: 404는 proof bundle 미존재지만 verifier 장애/5xx를 "not found"로 낮추면 운영 실패가 missing proof처럼 보입니다.
    // en: 404 means no proof bundle; verifier outages/5xx must not be downgraded to "not found".
    return failureResult(response.status === 404 ? "missing" : "failed", `Verifier returned ${response.status}`);
  }

  try {
    return normalizeVerificationResult(await response.json(), proofId);
  } catch {
    return failedResult("Verifier returned an invalid verification result.");
  }
}

async function normalizeVerificationResult(
  result: unknown,
  requestedProofId: string,
): Promise<VerificationResult> {
  if (!isObjectRecord(result)) {
    return failedResult("Verifier response was not an object.");
  }

  // kr: verifier API의 "verified" 응답만 믿지 않고, 클라이언트가 proof bundle을 다시 계산합니다.
  // en: Do not trust the verifier API's "verified" label alone; the client recomputes the proof bundle.
  if (result.status === "verified") {
    const proof = result.proof as ArgusProof | undefined;
    const bundleChecks = await calculateProofBundleMatches(proof, requestedProofId);
    const productionBundleMatches =
      verifierReportedFullBundleMatches(result) &&
      result.authorizedRelayerMatches === true &&
      fullBundleMatches(bundleChecks) &&
      bundleChecks.authorizedRelayerMatches === true &&
      isArgusProductionProof(proof);
    return productionBundleMatches
      ? acceptedVerificationResult("verified", proof, bundleChecks)
      : failedResult(
          "Verifier response did not include a complete production Argus proof-bundle match.",
        );
  }

  // kr: demo_verified는 로컬 미리보기 전용입니다. authorized relayer로 보이면 오히려 실패시켜 production badge 오인을 막습니다.
  // en: demo_verified is only a local preview; if it appears authorized, fail it to avoid a production badge overclaim.
  if (result.status === "demo_verified") {
    const proof = result.proof as ArgusProof | undefined;
    const bundleChecks = await calculateProofBundleMatches(proof, requestedProofId);
    const demoBundleMatches =
      verifierReportedFullBundleMatches(result) &&
      result.authorizedRelayerMatches === false &&
      fullBundleMatches(bundleChecks) &&
      bundleChecks.authorizedRelayerMatches === false &&
      isArgusLocalDemoProof(proof);

    return demoBundleMatches
      ? acceptedVerificationResult("demo_verified", proof, bundleChecks)
      : failedResult(
          "Verifier response did not include a complete local demo preview bundle match.",
        );
  }

  if (result.status !== "failed" && result.status !== "missing") {
    return failedResult("Verifier response status was not recognized.");
  }

  return failureResult(result.status);
}

function acceptedVerificationResult(
  status: "verified" | "demo_verified",
  proof: ArgusProof | undefined,
  bundleChecks: VerificationMatchFlags,
): VerificationResult {
  // kr: accepted 응답도 verifier API/proof-bundle store에서 온 untrusted envelope입니다. stale top-level tx/link/message가 verified proof 필드를 shadow하지 못하게 재계산된 flags와 proof만 반환합니다.
  // en: Even accepted responses come from an untrusted verifier/proof-bundle envelope; return only recomputed flags and proof so stale top-level tx/link/message fields cannot shadow verified proof fields.
  return {
    status,
    ...bundleChecks,
    proof: sanitizeAcceptedProof(proof),
  };
}

function sanitizeAcceptedProof(proof: ArgusProof | undefined): ArgusProof | undefined {
  if (!proof) {
    return undefined;
  }

  // kr: proof.solanaTx는 registry 재계산 입력이 아니라 표시용 metadata이므로, accepted proof에서도 proof-bundle store가 보낸 값을 작고 문자열인 경우로 제한합니다.
  // en: proof.solanaTx is display metadata, not recomputed registry input, so accepted proofs keep only small string values from the proof-bundle store.
  const solanaTx = sanitizeReportedTransactionReference(proof.solanaTx);
  return solanaTx === proof.solanaTx ? proof : { ...proof, solanaTx };
}

function sanitizeReportedTransactionReference(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    /\s/.test(value) ||
    textToBytes(value).length > MAX_REPORTED_TRANSACTION_REFERENCE_BYTES
  ) {
    return undefined;
  }

  return value;
}

// kr: authorizedRelayerMatches는 relayer public key, fee payer, gas sponsorship까지 묶으며 production과 demo의 기대값이 반대라서 별도로 확인합니다.
// en: authorizedRelayerMatches binds the relayer public key, fee payer, and gas sponsorship; production and demo require opposite values, so it is checked separately.
function verifierReportedFullBundleMatches(result: Partial<VerificationResult>): boolean {
  return (
    result.manifestHashMatches === true &&
    result.imageHashMatches === true &&
    result.proofIdMatches === true &&
    result.evidenceCommitmentsMatch === true &&
    result.proofLevelMatches === true &&
    result.proofRecordMatches === true &&
    result.registryProgramMatches === true
  );
}

// kr: 로컬 재계산도 같은 증거/registry 필드를 요구해 API가 true 플래그만 보내는 경우를 fail-closed로 처리합니다.
// en: Local recomputation requires the same evidence and registry fields so API-only true flags fail closed.
function fullBundleMatches(result: Partial<VerificationResult>): boolean {
  return (
    result.manifestHashMatches === true &&
    result.imageHashMatches === true &&
    result.proofIdMatches === true &&
    result.evidenceCommitmentsMatch === true &&
    result.proofLevelMatches === true &&
    result.proofRecordMatches === true &&
    result.registryProgramMatches === true
  );
}

async function calculateProofBundleMatches(
  proof: ArgusProof | undefined,
  requestedProofId: string,
): Promise<VerificationMatchFlags> {
  // kr: 이 함수는 manifest, image, evidence, registry trust root를 모두 로컬에서 다시 묶어 검증합니다.
  // en: This function locally re-binds the manifest, image, evidence, and registry trust root.
  if (!proof) {
    return failedProofBundleMatches();
  }

  const manifest = parseCanonicalManifest(proof.canonicalManifestJson);
  const canonicalManifestMatches =
    manifest !== null && canonicalManifestStringify(manifest) === proof.canonicalManifestJson;
  const calculatedManifestHash = canonicalManifestMatches
    ? await sha256Hex(proof.canonicalManifestJson ?? "")
    : null;
  const manifestHashMatches =
    calculatedManifestHash === proof.manifestHash &&
    proof.proofRecord?.manifestHash === proof.manifestHash;
  const photoBytes = base64ToBytes(proof.photoBytesBase64);
  const manifestProofLevel = typeof manifest?.proof_level === "string" ? manifest.proof_level : undefined;
  // kr: demo는 fixture/시뮬레이터 표시를 위해 byte 정책을 낮춥니다. production app_capture는 basic JPEG-like gate를 통과해야 하지만 image forensics는 아닙니다.
  // en: Demo lowers the byte policy for fixture/simulator display; production app_capture must pass a basic JPEG-like gate, not image forensics.
  const photoBytesPolicyMatches =
    photoBytes !== null && (manifestProofLevel === "demo" || isNativeJpegPhotoBytes(photoBytes));
  const calculatedImageHash = photoBytes ? await sha256Hex(photoBytes) : null;
  const imageHashMatches =
    photoBytesPolicyMatches &&
    calculatedImageHash === proof.imageHash &&
    calculatedImageHash === manifest?.image_sha256 &&
    proof.proofRecord?.imageHash === proof.imageHash;
  const calculatedProofId =
    manifestHashMatches && imageHashMatches
      ? await deriveProofId(calculatedManifestHash, manifest?.image_sha256, manifest?.nonce)
      : null;
  const proofIdMatches =
    calculatedProofId === proof.proofId &&
    proof.proofId === requestedProofId &&
    proof.proofRecord?.proofId === proof.proofId;
  const evidenceCommitmentsMatch =
    canonicalManifestMatches && (await verifyEvidenceCommitments(manifest, proof));
  const proofLevelMatches =
    manifest?.schema_version === ARGUS_MANIFEST_SCHEMA_VERSION &&
    isPositiveSafeInteger(manifest?.captured_at_ms) &&
    isIsoTimestampAtMs(proof.capturedAt, manifest?.captured_at_ms) &&
    proofLevelPolicyMatches(manifest?.proof_level) &&
    manifest?.proof_level === proof.proofLevel &&
    manifest?.proof_level === proof.integrityLevel &&
    proof.proofRecord?.proofLevel === manifest?.proof_level;
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
    proof.feePayer === ARGUS_AUTHORIZED_RELAYER &&
    proof.sponsoredGas === true &&
    proof.proofRecord?.relayer === ARGUS_AUTHORIZED_RELAYER &&
    proof.proofRecord?.relayerAuthorized === true;

  return {
    manifestHashMatches,
    imageHashMatches,
    proofIdMatches,
    evidenceCommitmentsMatch,
    proofLevelMatches,
    proofRecordMatches,
    registryProgramMatches,
    authorizedRelayerMatches,
  };
}

function failedProofBundleMatches(): VerificationMatchFlags {
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

function parseCanonicalManifest(value?: string): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "string" ||
    textToBytes(value).length > MAX_CANONICAL_MANIFEST_JSON_BYTES
  ) {
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

async function verifyEvidenceCommitments(
  manifest: Record<string, unknown> | null,
  proof: ArgusProof,
): Promise<boolean> {
  // kr: verifier API/proof-bundle store는 untrusted retrieval layer라서 hash 전에 relayer와 같은 evidence text cap을 반복합니다.
  // en: The verifier API/proof-bundle store is an untrusted retrieval layer, so repeat relayer evidence text caps before hashing.
  return (
    Boolean(manifest) &&
    (await commitmentMatches(proof.metadataJson, manifest?.metadata_commitment, MAX_METADATA_JSON_BYTES)) &&
    (await commitmentMatches(
      proof.cameraEvidenceJson,
      manifest?.camera_evidence_commitment,
      MAX_EVIDENCE_JSON_BYTES,
    )) &&
    (await commitmentMatches(
      proof.deviceIntegrityJson,
      manifest?.device_integrity_commitment,
      MAX_EVIDENCE_JSON_BYTES,
    )) &&
    (await partnerIdHashMatches(proof.partnerId, proof.partnerIdHash)) &&
    manifest?.app_identity_hash === proof.appIdentityHash &&
    manifest?.nonce === proof.nonce &&
    manifest?.capture_session_id === proof.captureSessionId &&
    manifest?.partner_id_hash === proof.partnerIdHash &&
    manifest?.use_case === proof.useCase
  );
}

async function commitmentMatches(
  value: string | undefined,
  expectedHash: unknown,
  maxUtf8Bytes: number,
): Promise<boolean> {
  if (
    !value ||
    typeof value !== "string" ||
    textToBytes(value).length > maxUtf8Bytes ||
    typeof expectedHash !== "string"
  ) {
    return false;
  }

  return (await sha256Hex(value)) === expectedHash;
}

async function partnerIdHashMatches(partnerId: string, partnerIdHash?: string): Promise<boolean> {
  return (
    typeof partnerId === "string" &&
    partnerId.trim().length > 0 &&
    (await sha256Hex(partnerId)) === partnerIdHash
  );
}

function proofLevelPolicyMatches(proofLevel: unknown): boolean {
  return typeof proofLevel === "string" && (proofLevel === "demo" || isSupportedProductionProofLevel(proofLevel));
}

async function deriveProofId(
  manifestHash: string | null,
  imageHash: unknown,
  nonce: unknown,
): Promise<string | null> {
  if (typeof manifestHash !== "string" || typeof imageHash !== "string" || typeof nonce !== "string") {
    return null;
  }

  const manifestHashBytes = hexToBytes(manifestHash);
  const imageHashBytes = hexToBytes(imageHash);
  const nonceBytes = hexToBytes(nonce);
  if (!manifestHashBytes || !imageHashBytes || !nonceBytes) {
    return null;
  }

  const prefix = textToBytes("argus-proof-v1");
  if (!prefix) {
    return null;
  }

  const bytes = new Uint8Array(prefix.length + manifestHashBytes.length + imageHashBytes.length + nonceBytes.length);
  bytes.set(prefix, 0);
  bytes.set(manifestHashBytes, prefix.length);
  bytes.set(imageHashBytes, prefix.length + manifestHashBytes.length);
  bytes.set(nonceBytes, prefix.length + manifestHashBytes.length + imageHashBytes.length);
  return sha256Hex(bytes);
}

async function sha256Hex(value: string | Uint8Array): Promise<string | null> {
  const bytes = typeof value === "string" ? textToBytes(value) : value;
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCryptoLike } }).crypto?.subtle;
  if (!bytes || !subtle) {
    return null;
  }

  try {
    const digest = await subtle.digest("SHA-256", bytes);
    return bytesToHex(new Uint8Array(digest));
  } catch {
    return null;
  }
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64ToBytes(value?: string): Uint8Array | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  if (value.length > MAX_NATIVE_CAPTURE_PHOTO_BASE64_LENGTH || /\s/.test(value)) {
    return null;
  }

  const normalized = value;
  if (!normalized || normalized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(normalized)) {
    return null;
  }

  const firstPadding = normalized.indexOf("=");
  const paddingMatch = normalized.match(/=+$/);
  const padding = paddingMatch ? paddingMatch[0].length : 0;
  const remainder = normalized.length % 4;
  if (
    padding > 2 ||
    (padding > 0 && remainder !== 0) ||
    (firstPadding !== -1 && firstPadding !== normalized.length - padding)
  ) {
    return null;
  }

  if (!base64HasCanonicalTrailingBits(normalized, padding, remainder)) {
    return null;
  }

  const outputLength = Math.floor((normalized.length * 3) / 4) - padding;
  if (outputLength > MAX_NATIVE_CAPTURE_PHOTO_BYTES) {
    return null;
  }

  const bytes = new Uint8Array(outputLength);
  let buffer = 0;
  let bits = 0;
  let byteIndex = 0;

  for (const character of normalized) {
    if (character === "=") {
      break;
    }

    const value = BASE64_ALPHABET.indexOf(character);
    if (value < 0) {
      return null;
    }

    buffer = (buffer << 6) | value;
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

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64HasCanonicalTrailingBits(value: string, padding: number, remainder: number): boolean {
  const checkedCharacter =
    padding === 2
      ? value[value.length - 3]
      : padding === 1
        ? value[value.length - 2]
        : remainder === 2 || remainder === 3
          ? value[value.length - 1]
          : undefined;
  if (!checkedCharacter) {
    return true;
  }

  const checkedValue = BASE64_ALPHABET.indexOf(checkedCharacter);
  if (checkedValue < 0) {
    return false;
  }

  const unusedBits = padding === 2 || remainder === 2 ? 4 : 2;
  return (checkedValue & ((1 << unusedBits) - 1)) === 0;
}

function buildVerifierApiUrl(verifierBaseUrl: string, proofId: string): string | null {
  try {
    // kr: verifierBaseUrl은 API fetch의 trust root입니다. `https:host/path` 같은 repaired URL은 host가 같아 보여도 설정 오입력을 숨기므로 거부합니다.
    // en: verifierBaseUrl is the API fetch trust root; reject repaired forms like `https:host/path` because they hide config mistakes even when the host looks right.
    if (!hasAbsoluteUrlAuthority(verifierBaseUrl)) {
      return null;
    }

    // kr: URL parser/proxy 정규화 전에 raw path를 검사하되, 정상 encoded base path는 허용합니다.
    // en: Inspect the raw path before parser/proxy normalization while still allowing valid encoded base paths.
    if (hasRawPathTraversalSegments(verifierBaseUrl)) {
      return null;
    }

    const parsed = new URL(verifierBaseUrl);
    if (!isSafeVerifierBaseUrl(parsed)) {
      return null;
    }

    const basePath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${basePath}/api/proofs/${encodeURIComponent(proofId)}`;
  } catch {
    return null;
  }
}

function isSafeVerifierBaseUrl(url: URL): boolean {
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    return false;
  }

  return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
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

function failedResult(message: string): VerificationResult {
  return failureResult("failed", message);
}

// kr: 외부 verifier의 실패/누락 응답은 claim 필드를 버리고, 내부 guard 실패만 안전한 로컬 message를 붙입니다.
// en: External failed/missing responses drop claim fields; only local guard failures attach a safe local message.
function failureResult(status: "failed" | "missing", message?: string): VerificationResult {
  return {
    ...failedProofBundleMatches(),
    status,
    ...(message ? { message } : {}),
  };
}

function isObjectRecord(value: unknown): value is Partial<VerificationResult> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonZeroHex32(value?: string): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) && !/^0{64}$/.test(value);
}

function isPositiveSafeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
