#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { config as loadEnv } from "dotenv";

loadEnv();

const baseUrl = process.env.ARGUS_MCU_SMOKE_BASE_URL || "http://127.0.0.1:8787";
const partnerId = "recommerce-demo";
const useCase = "marketplace_listing";
const appIdentityHash = JSON.parse(process.env.ARGUS_PARTNER_APP_ALLOWLIST || "[]")
  .find((entry) => entry?.partnerId === partnerId)?.appIdentityHashes?.[0];
const photoBytes = sampleJpegBytes();
assert.match(appIdentityHash || "", /^[0-9a-f]{64}$/i, "partner policy must contain an app identity hash");

const headers = { "content-type": "application/json" };
if (process.env.ARGUS_API_AUTH_TOKEN) {
  headers.authorization = `Bearer ${process.env.ARGUS_API_AUTH_TOKEN}`;
}

const sessionResponse = await fetch(`${baseUrl}/capture-session`, {
  method: "POST",
  headers,
  body: JSON.stringify({ partnerId, useCase, appIdentityHash }),
});
if (sessionResponse.status !== 200) {
  throw new Error(`capture-session failed: ${sessionResponse.status} ${await sessionResponse.text()}`);
}
const session = await sessionResponse.json();
const capturedAtMs = session.issuedAtMs + 1_000;
const imageSha256 = sha256Hex(photoBytes);
const firmwareVersion = "0.1.0";
const firmwareBuild = "local-idf";
const deviceId = "xiao-esp32s3-sense-dev";
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

const captureResponse = await fetch(`${baseUrl}/mcu/capture`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    deviceId,
    captureSessionId: session.captureSessionId,
    serverNonce: session.nonce,
    partnerId,
    useCase,
    appIdentityHash,
    photoBytesBase64: photoBytes.toString("base64"),
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
  }),
});
if (captureResponse.status !== 200) {
  throw new Error(`mcu/capture failed: ${captureResponse.status} ${await captureResponse.text()}`);
}
const result = await captureResponse.json();
assert.equal(result.accepted, true);
assert.equal(result.productionVerified, false);
assert.equal(result.sessionConsumed, true);
assert.equal(result.imageHash, imageSha256);
console.log(JSON.stringify({
  ok: true,
  captureSessionIssued: true,
  mcuCaptureAccepted: result.accepted,
  productionVerified: result.productionVerified,
  sessionConsumed: result.sessionConsumed,
  capturedFileBytes: result.capturedFileBytes,
  imageHash: result.imageHash,
}, null, 2));

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
