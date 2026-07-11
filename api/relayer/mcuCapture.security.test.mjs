import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { acceptMcuCapture } from "./mcuCapture.mjs";
import { authorizeCaptureSession, clearCaptureSessions } from "./sessionStore.mjs";

const appIdentityHash = "a".repeat(64);
const deviceId = "xiao-esp32s3-sense-dev";
const partnerId = "recommerce-demo";
const useCase = "marketplace_listing";
const baseTime = 1_800_000_000_000;
const photoBytes = sampleJpegBytes();
const directory = mkdtempSync(path.join(os.tmpdir(), "argus-mcu-capture-test-"));
const previousStorePath = process.env.ARGUS_SESSION_STORE_PATH;
const previousNodeEnv = process.env.NODE_ENV;
process.env.ARGUS_SESSION_STORE_PATH = path.join(directory, "sessions.json");
delete process.env.NODE_ENV;

try {
  clearCaptureSessions();
  const first = issueSession("mcu-session-1", "1".repeat(64));
  const validRequest = buildRequest(first, photoBytes, baseTime + 1_000);
  const accepted = acceptMcuCapture(validRequest, { nowMs: baseTime + 2_000 });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.productionVerified, false);
  assert.equal(accepted.sessionConsumed, true);
  assert.equal(accepted.imageHash, sha256Hex(photoBytes));
  assert.throws(
    () => acceptMcuCapture(validRequest, { nowMs: baseTime + 2_001 }),
    /already consumed/,
  );

  const second = issueSession("mcu-session-2", "2".repeat(64));
  const tamperedRequest = buildRequest(second, photoBytes, baseTime + 3_000);
  tamperedRequest.photoBytesBase64 = Buffer.from("tampered").toString("base64");
  assert.throws(
    () => acceptMcuCapture(tamperedRequest, { nowMs: baseTime + 3_001 }),
    /JPEG-like byte policy/,
  );

  const third = issueSession("mcu-session-3", "3".repeat(64));
  process.env.NODE_ENV = "production";
  assert.throws(
    () => acceptMcuCapture(buildRequest(third, photoBytes, baseTime + 4_000)),
    /unsigned MCU receipts are not accepted in production/,
  );
  console.log("MCU capture security tests passed");
} finally {
  if (previousStorePath === undefined) delete process.env.ARGUS_SESSION_STORE_PATH;
  else process.env.ARGUS_SESSION_STORE_PATH = previousStorePath;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  rmSync(directory, { recursive: true, force: true });
}

function issueSession(captureSessionId, nonce) {
  authorizeCaptureSession({
    appIdentityHash,
    captureSessionId,
    nonce,
    partnerId,
    useCase,
    issuedAtMs: baseTime,
    expiresAtMs: baseTime + 60_000,
    captureWindowStartMs: baseTime,
    captureWindowEndMs: baseTime + 60_000,
  });
  return { captureSessionId, nonce };
}

function buildRequest(session, bytes, capturedAtMs) {
  const imageSha256 = sha256Hex(bytes);
  const firmwareVersion = "0.1.0";
  const firmwareBuild = "local-idf";
  const receiptDigest = sha256Hex([
    "argus.xiao.capture.receipt.v1",
    deviceId,
    session.nonce,
    1,
    capturedAtMs,
    imageSha256,
    firmwareVersion,
    firmwareBuild,
  ].join("|"));
  return {
    deviceId,
    captureSessionId: session.captureSessionId,
    serverNonce: session.nonce,
    partnerId,
    useCase,
    appIdentityHash,
    photoBytesBase64: bytes.toString("base64"),
    receipt: {
      schema: "argus.xiao.capture.receipt.v1",
      deviceId,
      nonce: session.nonce,
      imageSha256,
      receiptDigest,
      captureCounter: 1,
      capturedAtMs,
      firmwareVersion,
      firmwareBuild,
      signatureAlgorithm: "none",
      signatureBase64: "",
      securityLevel: "unsigned_dev_only",
    },
  };
}

function sampleJpegBytes() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
    0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00,
    0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
