import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  authorizeCaptureSession,
  clearCaptureSessions,
  openCaptureSession,
  validateAndConsumeCaptureSession,
} from "./sessionStore.mjs";
import { validateAndroidEvidenceLevel } from "./androidEvidencePolicy.mjs";
import {
  ArgusHttpError,
  assertApiAuthentication,
  assertRateLimit,
  clearRateLimits,
} from "./requestSecurity.mjs";
import { verifyPlayIntegrityForRequest } from "./playIntegrityPolicy.mjs";

const appIdentityHash = "a".repeat(64);
const nonce = "b".repeat(64);
const baseTime = 1_800_000_000_000;

await testsDurableAtomicSession();
testsCaptureWindow();
testsProductionLevelTwoGate();
testsApiAuthAndRateLimit();
await testsPlayIntegrityNonceBinding();
console.log("security boundary tests passed");

async function testsDurableAtomicSession() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "argus-session-test-"));
  const storePath = path.join(directory, "sessions.json");
  const previousPath = process.env.ARGUS_SESSION_STORE_PATH;
  process.env.ARGUS_SESSION_STORE_PATH = storePath;

  try {
    clearCaptureSessions();
    const session = openCaptureSession({
      partnerId: "recommerce-demo",
      useCase: "marketplace_listing",
      appIdentityHash,
      nowMs: baseTime,
      ttlMs: 60_000,
    });
    assert.equal(session.issuedAtMs, baseTime);
    assert.equal(session.captureWindowEndMs, session.expiresAtMs);
    validateAndConsumeCaptureSession({
      appIdentityHash,
      captureSessionId: session.captureSessionId,
      nonce: session.nonce,
      partnerId: "recommerce-demo",
      useCase: "marketplace_listing",
      captureTimestamp: baseTime + 1_000,
      nowMs: baseTime + 2_000,
    });
    assert.throws(
      () =>
        validateAndConsumeCaptureSession({
          appIdentityHash,
          captureSessionId: session.captureSessionId,
          nonce: session.nonce,
          partnerId: "recommerce-demo",
          useCase: "marketplace_listing",
          captureTimestamp: baseTime + 1_000,
          nowMs: baseTime + 2_000,
        }),
      /already consumed/,
    );
  } finally {
    if (previousPath === undefined) delete process.env.ARGUS_SESSION_STORE_PATH;
    else process.env.ARGUS_SESSION_STORE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
}

function testsCaptureWindow() {
  const previousPath = process.env.ARGUS_SESSION_STORE_PATH;
  const directory = mkdtempSync(path.join(os.tmpdir(), "argus-session-window-"));
  process.env.ARGUS_SESSION_STORE_PATH = path.join(directory, "sessions.json");
  try {
    clearCaptureSessions();
    authorizeCaptureSession({
      appIdentityHash,
      captureSessionId: "argus-session-window",
      nonce,
      partnerId: "recommerce-demo",
      useCase: "marketplace_listing",
      issuedAtMs: baseTime,
      expiresAtMs: baseTime + 60_000,
      captureWindowStartMs: baseTime,
      captureWindowEndMs: baseTime + 60_000,
    });
    assert.throws(
      () =>
        validateAndConsumeCaptureSession({
          appIdentityHash,
          captureSessionId: "argus-session-window",
          nonce,
          partnerId: "recommerce-demo",
          useCase: "marketplace_listing",
          captureTimestamp: baseTime - 1,
          nowMs: baseTime + 1,
        }),
      /outside the capture session time window/,
    );
  } finally {
    if (previousPath === undefined) delete process.env.ARGUS_SESSION_STORE_PATH;
    else process.env.ARGUS_SESSION_STORE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
}

function testsProductionLevelTwoGate() {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousRelayerMode = process.env.ARGUS_RELAYER_MODE;
  process.env.NODE_ENV = "production";
  process.env.ARGUS_RELAYER_MODE = "solana";
  try {
    assert.throws(
      () =>
        validateAndroidEvidenceLevel({
          deviceIntegrity: {
            androidEvidenceLevel: 2,
            hardwareAttestation: {
              supported: false,
              fallbackLevel: 2,
              reason: "android_key_attestation_unavailable",
            },
          },
          manifest: {},
          request: {},
        }),
      /Level 3 or Level 4 Android evidence/,
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousRelayerMode === undefined) delete process.env.ARGUS_RELAYER_MODE;
    else process.env.ARGUS_RELAYER_MODE = previousRelayerMode;
  }
}

function testsApiAuthAndRateLimit() {
  const previousToken = process.env.ARGUS_API_AUTH_TOKEN;
  const previousCount = process.env.ARGUS_RATE_LIMIT_CAPTURE_SESSION_COUNT;
  const previousWindow = process.env.ARGUS_RATE_LIMIT_CAPTURE_SESSION_WINDOW_MS;
  process.env.ARGUS_API_AUTH_TOKEN = "test-token";
  process.env.ARGUS_RATE_LIMIT_CAPTURE_SESSION_COUNT = "1";
  process.env.ARGUS_RATE_LIMIT_CAPTURE_SESSION_WINDOW_MS = "60000";
  clearRateLimits();
  const request = {
    headers: { authorization: "Bearer test-token" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  try {
    assert.doesNotThrow(() => assertApiAuthentication(request));
    assert.throws(
      () => assertApiAuthentication({ ...request, headers: { authorization: "Bearer wrong" } }),
      (error) => error instanceof ArgusHttpError && error.statusCode === 401,
    );
    assert.doesNotThrow(() => assertRateLimit(request, "capture-session"));
    assert.throws(
      () => assertRateLimit(request, "capture-session"),
      (error) => error instanceof ArgusHttpError && error.statusCode === 429,
    );
  } finally {
    if (previousToken === undefined) delete process.env.ARGUS_API_AUTH_TOKEN;
    else process.env.ARGUS_API_AUTH_TOKEN = previousToken;
    if (previousCount === undefined) delete process.env.ARGUS_RATE_LIMIT_CAPTURE_SESSION_COUNT;
    else process.env.ARGUS_RATE_LIMIT_CAPTURE_SESSION_COUNT = previousCount;
    if (previousWindow === undefined) delete process.env.ARGUS_RATE_LIMIT_CAPTURE_SESSION_WINDOW_MS;
    else process.env.ARGUS_RATE_LIMIT_CAPTURE_SESSION_WINDOW_MS = previousWindow;
  }
}

async function testsPlayIntegrityNonceBinding() {
  const previousRequired = process.env.ARGUS_PLAY_INTEGRITY_REQUIRED;
  const previousUrl = process.env.ARGUS_PLAY_INTEGRITY_VERIFIER_URL;
  const previousFetch = globalThis.fetch;
  process.env.ARGUS_PLAY_INTEGRITY_REQUIRED = "true";
  delete process.env.ARGUS_PLAY_INTEGRITY_VERIFIER_URL;
  try {
    await assert.rejects(
      () =>
        verifyPlayIntegrityForRequest({
          appIdentityHash,
          deviceIntegrityJson: "{}",
          sessionNonce: nonce,
        }),
      /nonce-bound Play Integrity/,
    );

    globalThis.fetch = async (_url, init) => {
      const parsed = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            valid: parsed.expectedNonce === nonce,
            nonce: parsed.expectedNonce,
            appIdentityHash,
          };
        },
      };
    };
    process.env.ARGUS_PLAY_INTEGRITY_VERIFIER_URL = "https://test-verifier.invalid";
    const decision = await verifyPlayIntegrityForRequest({
      appIdentityHash,
      deviceIntegrityJson: JSON.stringify({
        playIntegrity: { token: "opaque-token" },
      }),
      sessionNonce: nonce,
    });
    assert.equal(decision.verified, true);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRequired === undefined) delete process.env.ARGUS_PLAY_INTEGRITY_REQUIRED;
    else process.env.ARGUS_PLAY_INTEGRITY_REQUIRED = previousRequired;
    if (previousUrl === undefined) delete process.env.ARGUS_PLAY_INTEGRITY_VERIFIER_URL;
    else process.env.ARGUS_PLAY_INTEGRITY_VERIFIER_URL = previousUrl;
  }
}
