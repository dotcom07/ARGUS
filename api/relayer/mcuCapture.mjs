import { createHash } from "node:crypto";
import { decodeCanonicalPhotoBytes } from "./photoBytesPolicy.mjs";
import { validateAndConsumeCaptureSession } from "./sessionStore.mjs";

const RECEIPT_SCHEMA = "argus.xiao.capture.receipt.v1";

// This endpoint accepts a development MCU receipt for byte/session diagnostics.
// It never promotes an unsigned receipt to production Verified Capture.
export function acceptMcuCapture(request, { nowMs = Date.now() } = {}) {
  const receipt = request?.receipt;
  assertText("deviceId", request?.deviceId);
  assertText("captureSessionId", request?.captureSessionId);
  assertText("serverNonce", request?.serverNonce);
  assertText("partnerId", request?.partnerId);
  assertText("useCase", request?.useCase);
  assertHex32("appIdentityHash", request?.appIdentityHash);
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("receipt is required");
  }

  const photoBytes = decodeCanonicalPhotoBytes(
    "photoBytesBase64",
    request.photoBytesBase64,
    "for MCU capture",
  );
  validateReceiptShape(receipt);

  if (receipt.schema !== RECEIPT_SCHEMA) {
    throw new Error("unsupported MCU receipt schema");
  }
  if (receipt.deviceId !== request.deviceId) {
    throw new Error("MCU receipt deviceId does not match request");
  }
  if (receipt.nonce !== request.serverNonce) {
    throw new Error("MCU receipt nonce does not match request");
  }
  if (receipt.imageSha256 !== sha256Hex(photoBytes)) {
    throw new Error("MCU receipt imageSha256 does not match photoBytesBase64");
  }
  if (receipt.securityLevel !== "unsigned_dev_only" || receipt.signatureAlgorithm !== "none") {
    throw new Error("MCU hardware signature verification is not configured yet");
  }
  if (process.env.NODE_ENV?.trim().toLowerCase() === "production") {
    throw new Error("unsigned MCU receipts are not accepted in production");
  }

  const expectedReceiptDigest = sha256Hex([
    RECEIPT_SCHEMA,
    receipt.deviceId,
    receipt.nonce,
    receipt.captureCounter,
    receipt.capturedAtMs,
    receipt.imageSha256,
    receipt.firmwareVersion,
    receipt.firmwareBuild,
  ].join("|"));
  if (receipt.receiptDigest !== expectedReceiptDigest) {
    throw new Error("MCU receiptDigest does not match the canonical receipt");
  }

  const session = validateAndConsumeCaptureSession({
    appIdentityHash: request.appIdentityHash,
    captureSessionId: request.captureSessionId,
    nonce: request.serverNonce,
    partnerId: request.partnerId,
    useCase: request.useCase,
    captureTimestamp: receipt.capturedAtMs,
    nowMs,
  });

  return {
    accepted: true,
    productionVerified: false,
    receiptSchema: RECEIPT_SCHEMA,
    securityLevel: receipt.securityLevel,
    imageHash: receipt.imageSha256,
    receiptDigest: receipt.receiptDigest,
    capturedFileBytes: photoBytes.byteLength,
    captureCounter: receipt.captureCounter,
    capturedAtMs: receipt.capturedAtMs,
    receivedAtMs: nowMs,
    captureSessionId: session.captureSessionId,
    sessionConsumed: true,
  };
}

function validateReceiptShape(receipt) {
  for (const field of [
    "schema",
    "deviceId",
    "nonce",
    "imageSha256",
    "receiptDigest",
    "firmwareVersion",
    "firmwareBuild",
    "signatureAlgorithm",
    "securityLevel",
  ]) {
    assertText(`receipt.${field}`, receipt[field]);
    if (receipt[field].includes("|")) {
      throw new Error(`receipt.${field} contains a forbidden delimiter`);
    }
  }

  assertHex32("receipt.nonce", receipt.nonce);
  assertHex32("receipt.imageSha256", receipt.imageSha256);
  assertHex32("receipt.receiptDigest", receipt.receiptDigest);
  if (!Number.isSafeInteger(receipt.captureCounter) || receipt.captureCounter <= 0) {
    throw new Error("receipt.captureCounter must be a positive safe integer");
  }
  if (!Number.isSafeInteger(receipt.capturedAtMs) || receipt.capturedAtMs <= 0) {
    throw new Error("receipt.capturedAtMs must be a positive safe integer");
  }
  if (receipt.signatureBase64 !== "") {
    throw new Error("unsigned MCU receipt signatureBase64 must be empty");
  }
}

function assertText(field, value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new Error(`${field} must be a non-empty bounded string`);
  }
}

function assertHex32(field, value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${field} must be lowercase 32-byte hex`);
  }
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
