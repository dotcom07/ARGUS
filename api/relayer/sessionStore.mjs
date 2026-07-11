import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { MAX_CAPTURE_SESSION_ID_BYTES } from "./requestTextPolicy.mjs";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CLOCK_SKEW_MS = 30 * 1000;
const STORE_VERSION = 1;
const LOCK_WAIT_MS = 10;
const LOCK_TIMEOUT_MS = 15 * 1000;

// kr: 프로세스 재시작 후에도 nonce 소비 상태를 유지해야 replay가 살아나지 않습니다.
// en: The nonce-consumed state must survive process restarts, or replay protection disappears.
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

  const maxTtlMs = configuredMaxTtlMs();
  if (ttlMs > maxTtlMs) {
    throw new Error("ttlMs exceeds configured capture session maximum");
  }

  const captureSessionId = `argus-session-${randomBytes(16).toString("hex")}`;
  const nonce = sha256Hex(randomBytes(32));
  const issuedAtMs = nowMs;
  const expiresAtMs = nowMs + ttlMs;
  const captureWindowStartMs = issuedAtMs - configuredClockSkewMs();
  const captureWindowEndMs = expiresAtMs;

  authorizeCaptureSession({
    captureSessionId,
    nonce,
    partnerId,
    useCase,
    appIdentityHash,
    issuedAtMs,
    expiresAtMs,
    captureWindowStartMs,
    captureWindowEndMs,
  });

  return {
    captureSessionId,
    nonce,
    issuedAtMs,
    expiresAtMs,
    captureWindowStartMs,
    captureWindowEndMs,
  };
}

// kr: authorizeCaptureSession은 고정 fixture나 외부 발급기에서 만든 session도 같은 durable store에 넣습니다.
// en: authorizeCaptureSession puts fixture or externally issued sessions into the same durable store.
export function authorizeCaptureSession({
  captureSessionId,
  nonce,
  partnerId,
  useCase,
  appIdentityHash,
  issuedAtMs,
  expiresAtMs = Date.now() + DEFAULT_TTL_MS,
  captureWindowStartMs,
  captureWindowEndMs,
}) {
  validateSessionFields({ captureSessionId, nonce, partnerId, useCase, appIdentityHash });
  validateTimeMs("expiresAtMs", expiresAtMs);

  // Existing fixtures may only provide an expiry. Keep that API usable while real issuance always records issuedAtMs.
  const resolvedIssuedAtMs = issuedAtMs ?? Math.max(1, expiresAtMs - DEFAULT_TTL_MS);
  validateTimeMs("issuedAtMs", resolvedIssuedAtMs);
  if (expiresAtMs <= resolvedIssuedAtMs) {
    throw new Error("expiresAtMs must be after issuedAtMs");
  }

  const resolvedWindowStartMs = captureWindowStartMs ?? resolvedIssuedAtMs - configuredClockSkewMs();
  const resolvedWindowEndMs = captureWindowEndMs ?? expiresAtMs;
  validateTimeMs("captureWindowStartMs", resolvedWindowStartMs);
  validateTimeMs("captureWindowEndMs", resolvedWindowEndMs);
  if (resolvedWindowEndMs < resolvedWindowStartMs || resolvedWindowEndMs > expiresAtMs) {
    throw new Error("capture time window is invalid");
  }

  withExclusiveStore((state) => {
    if (state.sessions[captureSessionId]) {
      throw new Error("capture session already exists");
    }

    state.sessions[captureSessionId] = {
      appIdentityHash: appIdentityHash.toLowerCase(),
      captureSessionId,
      consumed: false,
      expiresAtMs,
      issuedAtMs: resolvedIssuedAtMs,
      captureWindowStartMs: resolvedWindowStartMs,
      captureWindowEndMs: resolvedWindowEndMs,
      nonce,
      partnerId,
      useCase,
    };
  });
}

// kr: 이 함수의 검증과 consumed=true 기록은 하나의 파일 잠금 구간 안에서 수행됩니다.
// en: Validation and consumed=true happen inside one file-lock section, making consumption atomic.
export function validateAndConsumeCaptureSession({
  captureSessionId,
  nonce,
  partnerId,
  useCase,
  appIdentityHash,
  captureTimestamp,
  nowMs = Date.now(),
}) {
  validateTimeMs("nowMs", nowMs);
  validateSessionFields({ captureSessionId, nonce, partnerId, useCase, appIdentityHash });
  validateTimeMs("captureTimestamp", captureTimestamp);

  return withExclusiveStore((state) => {
    const session = state.sessions[captureSessionId];
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

    if (captureTimestamp < session.captureWindowStartMs || captureTimestamp > session.captureWindowEndMs) {
      throw new Error("capture timestamp is outside the capture session time window");
    }

    session.consumed = true;
    session.consumedAtMs = nowMs;
    return { ...session };
  });
}

export function clearCaptureSessions() {
  withExclusiveStore((state) => {
    state.sessions = {};
  });
}

function withExclusiveStore(callback) {
  const storePath = resolveStorePath();
  const lockPath = `${storePath}.lock`;
  mkdirSync(path.dirname(storePath), { recursive: true });
  acquireLock(lockPath);

  try {
    const state = readStore(storePath);
    const result = callback(state);
    writeStoreAtomically(storePath, state);
    return result;
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

function acquireLock(lockPath) {
  const startedAt = Date.now();
  while (true) {
    try {
      mkdirSync(lockPath);
      writeFileSync(path.join(lockPath, "createdAt"), `${Date.now()}`);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      try {
        const createdAtMs = Number.parseInt(readFileSync(path.join(lockPath, "createdAt"), "utf8"), 10);
        if (!Number.isSafeInteger(createdAtMs)) {
          throw new Error("invalid lock marker");
        }
        const lockAgeMs = Date.now() - createdAtMs;
        if (lockAgeMs > LOCK_TIMEOUT_MS) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        // The owner may have died between mkdir and its marker write. Recover after the timeout.
        if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      }

      if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
        throw new Error("capture session store lock timed out");
      }

      sleepSync(LOCK_WAIT_MS);
    }
  }
}

function readStore(storePath) {
  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8"));
    if (parsed?.version !== STORE_VERSION || !parsed.sessions || typeof parsed.sessions !== "object") {
      throw new Error("capture session store schema is invalid");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { version: STORE_VERSION, sessions: {} };
    }
    throw error;
  }
}

function writeStoreAtomically(storePath, state) {
  const tempPath = `${storePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tempPath, storePath);
}

function resolveStorePath() {
  return path.resolve(process.env.ARGUS_SESSION_STORE_PATH || ".argus-relayer-data/capture-sessions.json");
}

function configuredMaxTtlMs() {
  const value = Number.parseInt(process.env.ARGUS_CAPTURE_SESSION_MAX_TTL_MS || `${DEFAULT_TTL_MS}`, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("ARGUS_CAPTURE_SESSION_MAX_TTL_MS must be a positive integer");
  }
  return value;
}

function configuredClockSkewMs() {
  const value = Number.parseInt(
    process.env.ARGUS_CAPTURE_CLOCK_SKEW_MS || `${DEFAULT_CLOCK_SKEW_MS}`,
    10,
  );
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("ARGUS_CAPTURE_CLOCK_SKEW_MS must be a non-negative integer");
  }
  return value;
}

function validateSessionFields({ captureSessionId, nonce, partnerId, useCase, appIdentityHash }) {
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

function sleepSync(milliseconds) {
  const shared = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(shared), 0, 0, milliseconds);
}
