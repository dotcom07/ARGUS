import { createHash, randomBytes } from "node:crypto";
import { MAX_CAPTURE_SESSION_ID_BYTES } from "./requestTextPolicy.mjs";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const sessions = new Map();

// kr: openCaptureSession은 relayer/backend가 촬영 전에 발급하는 nonce 세션을 만듭니다.
// en: openCaptureSession creates the nonce session issued by the relayer/backend before capture.
export function openCaptureSession({
  partnerId,
  useCase,
  appIdentityHash,
  nowMs = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
}) {
  validateTimeMs("nowMs", nowMs);
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("ttlMs must be a positive safe integer");
  }

  const captureSessionId = `argus-session-${randomBytes(16).toString("hex")}`;
  const nonce = sha256Hex(randomBytes(32));
  const expiresAtMs = nowMs + ttlMs;
  validateTimeMs("expiresAtMs", expiresAtMs);

  authorizeCaptureSession({
    captureSessionId,
    nonce,
    partnerId,
    useCase,
    appIdentityHash,
    expiresAtMs,
  });

  return {
    captureSessionId,
    nonce,
    expiresAtMs,
  };
}

// kr: authorizeCaptureSession은 demo/test에서 이미 만들어진 capture session을 relayer store에 등록합니다.
// en: authorizeCaptureSession records an already-created capture session in the relayer store for demos/tests.
export function authorizeCaptureSession({
  captureSessionId,
  nonce,
  partnerId,
  useCase,
  appIdentityHash,
  expiresAtMs = Date.now() + DEFAULT_TTL_MS,
}) {
  validateSessionFields({
    captureSessionId,
    nonce,
    partnerId,
    useCase,
    appIdentityHash,
  });
  validateTimeMs("expiresAtMs", expiresAtMs);

  const normalizedAppIdentityHash = appIdentityHash.toLowerCase();
  if (sessions.has(captureSessionId)) {
    throw new Error("capture session already exists");
  }

  sessions.set(captureSessionId, {
    appIdentityHash: normalizedAppIdentityHash,
    captureSessionId,
    consumed: false,
    expiresAtMs,
    nonce,
    partnerId,
    useCase,
  });
}

// kr: validateAndConsumeCaptureSession은 nonce 재사용과 알 수 없는 세션을 fail-closed로 막습니다.
// en: validateAndConsumeCaptureSession fails closed for unknown sessions and nonce replay.
export function validateAndConsumeCaptureSession({
  captureSessionId,
  nonce,
  partnerId,
  useCase,
  appIdentityHash,
  nowMs = Date.now(),
}) {
  validateTimeMs("nowMs", nowMs);
  validateSessionFields({
    captureSessionId,
    nonce,
    partnerId,
    useCase,
    appIdentityHash,
  });

  const session = sessions.get(captureSessionId);
  if (!session) {
    throw new Error("capture session was not opened by the relayer");
  }

  if (session.consumed) {
    throw new Error("capture session was already consumed");
  }

  if (session.expiresAtMs <= nowMs) {
    throw new Error("capture session expired");
  }

  if (session.nonce !== nonce) {
    throw new Error("capture session nonce does not match");
  }

  if (session.partnerId !== partnerId) {
    throw new Error("capture session partnerId does not match");
  }

  if (session.useCase !== useCase) {
    throw new Error("capture session useCase does not match");
  }

  if (session.appIdentityHash !== appIdentityHash.toLowerCase()) {
    throw new Error("capture session app identity does not match");
  }

  session.consumed = true;
}

export function clearCaptureSessions() {
  sessions.clear();
}

function validateSessionFields({
  captureSessionId,
  nonce,
  partnerId,
  useCase,
  appIdentityHash,
}) {
  if (!captureSessionId || typeof captureSessionId !== "string") {
    throw new Error("captureSessionId is required");
  }

  if (Buffer.byteLength(captureSessionId, "utf8") > MAX_CAPTURE_SESSION_ID_BYTES) {
    throw new Error("captureSessionId exceeds relayer JSON text limit");
  }

  if (!partnerId || typeof partnerId !== "string") {
    throw new Error("partnerId is required");
  }

  if (!useCase || typeof useCase !== "string") {
    throw new Error("useCase is required");
  }

  assertHex32("nonce", nonce);
  assertHex32("appIdentityHash", appIdentityHash);
}

function validateTimeMs(field, value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
}

function assertHex32(field, value) {
  if (!/^[0-9a-fA-F]{64}$/.test(value) || /^0{64}$/.test(value)) {
    throw new Error(`${field} must be a non-zero 32-byte hex string`);
  }
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
