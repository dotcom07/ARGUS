import { createHash } from "node:crypto";

const MAX_PLAY_INTEGRITY_TOKEN_BYTES = 24 * 1024;

// The relayer never decrypts a Play Integrity JWE locally. It delegates decoding to a trusted verifier service
// so Google service-account credentials stay outside this process.
export async function verifyPlayIntegrityForRequest(request, { enforceRequired = true } = {}) {
  const deviceIntegrity = parseObjectJson(request?.deviceIntegrityJson, "deviceIntegrityJson");
  const evidence = asRecord(deviceIntegrity?.playIntegrity);
  const token = evidence?.token;
  const required = enforceRequired && playIntegrityRequired();

  if (!evidence) {
    if (required) {
      throw new Error("Production capture requires nonce-bound Play Integrity evidence");
    }
    return { present: false, verified: false, required: false };
  }

  if (typeof token !== "string" || token.length === 0 || Buffer.byteLength(token, "utf8") > MAX_PLAY_INTEGRITY_TOKEN_BYTES) {
    throw new Error("playIntegrity.token must be a bounded non-empty token");
  }

  const tokenSha256 = sha256Hex(token);
  if (evidence.tokenSha256 !== undefined && evidence.tokenSha256 !== tokenSha256) {
    throw new Error("playIntegrity.tokenSha256 does not match playIntegrity.token");
  }

  const verifierUrl = process.env.ARGUS_PLAY_INTEGRITY_VERIFIER_URL?.trim();
  if (!verifierUrl) {
    if (required) {
      throw new Error("ARGUS_PLAY_INTEGRITY_VERIFIER_URL is required when Play Integrity is required");
    }
    return {
      present: true,
      verified: false,
      required: false,
      reason: "play_integrity_verifier_not_configured",
      tokenSha256,
    };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(verifierUrl);
  } catch {
    throw new Error("ARGUS_PLAY_INTEGRITY_VERIFIER_URL must be an absolute URL");
  }
  if (parsedUrl.protocol !== "https:" && process.env.NODE_ENV?.trim().toLowerCase() === "production") {
    throw new Error("ARGUS_PLAY_INTEGRITY_VERIFIER_URL must use HTTPS in production");
  }

  const response = await fetch(parsedUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.ARGUS_PLAY_INTEGRITY_VERIFIER_TOKEN
        ? { authorization: `Bearer ${process.env.ARGUS_PLAY_INTEGRITY_VERIFIER_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      integrityToken: token,
      expectedNonce: request.sessionNonce,
      expectedAppIdentityHash: request.appIdentityHash,
    }),
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`Play Integrity verifier returned ${response.status}`);
  }

  const verdict = await response.json();
  if (verdict?.valid !== true) {
    throw new Error("Play Integrity verifier rejected the token");
  }
  if (verdict.nonce !== request.sessionNonce) {
    throw new Error("Play Integrity verdict nonce does not match the capture session nonce");
  }
  if (
    typeof verdict.appIdentityHash === "string" &&
    verdict.appIdentityHash.toLowerCase() !== request.appIdentityHash
  ) {
    throw new Error("Play Integrity verdict app identity does not match the capture session");
  }

  return {
    present: true,
    verified: true,
    required,
    provider: "argus-play-integrity-verifier",
    tokenSha256,
    appRecognitionVerdict: verdict.appRecognitionVerdict,
    deviceRecognitionVerdict: verdict.deviceRecognitionVerdict,
  };
}

export function playIntegrityRequired() {
  const configured = process.env.ARGUS_PLAY_INTEGRITY_REQUIRED;
  if (configured === "true") {
    return true;
  }
  if (configured === "false") {
    return false;
  }
  return process.env.NODE_ENV?.trim().toLowerCase() === "production";
}

function parseObjectJson(value, field) {
  try {
    const parsed = JSON.parse(value ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw new Error(`${field} must be valid JSON`);
  }
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
