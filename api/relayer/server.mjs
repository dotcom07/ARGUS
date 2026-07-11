import http from "node:http";
import { config as loadEnv } from "dotenv";
import { openRelayerCaptureSession } from "./openCaptureSession.mjs";
import { registerProof } from "./registerProof.mjs";
import { loadProofBundle, storeProofBundle } from "./proofBundleStore.mjs";
import { loadRegistrationProgress, recordRegistrationProgress } from "./registrationProgress.mjs";
import { ArgusHttpError, assertApiAuthentication, assertRateLimit } from "./requestSecurity.mjs";
import { acceptMcuCapture } from "./mcuCapture.mjs";

loadEnv();

const DEFAULT_PORT = 8787;
const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
const PROOF_ROUTE_PREFIX = "/api/proofs/";
const PROOF_PHOTO_ROUTE_SUFFIX = "/photo";
const REGISTRATION_PROGRESS_ROUTE_PREFIX = "/api/registrations/";

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    sendJson(response, 204, null);
    return;
  }

  try {
    await routeRequest(request, response);
  } catch (error) {
    const status = error?.statusCode || (isClientError(error) ? 400 : 500);
    console.error("[Argus relayer] request failed", {
      status,
      method: request.method,
      url: request.url,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    for (const [header, value] of Object.entries(error?.headers || {})) {
      response.setHeader(header, value);
    }
    sendJson(response, status, {
      error: status === 400 ? error.message : "Argus relayer request failed",
    });
  }
});

const port = Number.parseInt(process.env.PORT || `${DEFAULT_PORT}`, 10);
if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port");
}

server.listen(port, "0.0.0.0", () => {
  console.log(`Argus relayer listening on http://0.0.0.0:${port}`);
});

async function routeRequest(request, response) {
  const url = new URL(request.url ?? "/", "http://argus.local");

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: "argus-relayer",
      relayerMode: process.env.ARGUS_RELAYER_MODE || "demo",
    });
    return;
  }

  const securityRoute = routeSecurityName(request, url.pathname);
  assertApiAuthentication(request);
  assertRateLimit(request, securityRoute);

  if (request.method === "POST" && url.pathname === "/capture-session") {
    const body = await readJsonBody(request);
    console.info("[Argus relayer] capture session request received", {
      partnerId: body.partnerId,
      useCase: body.useCase,
      appIdentityHash: shortValue(body.appIdentityHash),
    });
    const session = openRelayerCaptureSession(body);
    console.info("[Argus relayer] capture session issued", {
      captureSessionId: shortValue(session.captureSessionId),
      issuedAtMs: session.issuedAtMs,
      expiresAtMs: session.expiresAtMs,
    });
    sendJson(response, 200, session);
    return;
  }

  if (request.method === "POST" && url.pathname === "/mcu/capture") {
    const body = await readJsonBody(request);
    const result = acceptMcuCapture(body);
    console.info("[Argus relayer] MCU capture accepted", {
      captureSessionId: shortValue(result.captureSessionId),
      imageHash: shortValue(result.imageHash),
      capturedFileBytes: result.capturedFileBytes,
      securityLevel: result.securityLevel,
    });
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/register-proof") {
    const body = await readJsonBody(request);
    recordRegistrationProgress(body.proofId, "request_received", "Register proof request received", {
      captureSessionId: body.captureSessionId,
      imageHash: body.imageHash,
      manifestHash: body.manifestHash,
    });
    console.info("[Argus relayer] register proof request received", {
      proofId: shortValue(body.proofId),
      manifestHash: shortValue(body.manifestHash),
      imageHash: shortValue(body.imageHash),
      captureSessionId: shortValue(body.captureSessionId),
    });
    try {
      const registration = await registerProof(body);
      const storedBundle = await storeProofBundle({ registration, request: body });
      recordRegistrationProgress(registration.proofId, "bundle_stored", "Proof bundle stored", {
        proofRecord: registration.proofRecord?.address,
        solanaTx: registration.solanaTx,
      });
      console.info("[Argus relayer] register proof completed", {
        proofId: shortValue(registration.proofId),
        solanaTx: shortValue(registration.solanaTx),
        proofRecord: shortValue(registration.proofRecord?.address),
        stored: true,
      });
      sendJson(response, 200, {
        ...registration,
        explorerLinks: storedBundle.explorerLinks,
      });
      recordRegistrationProgress(registration.proofId, "response_sent", "Registration response sent", {
        solanaTx: registration.solanaTx,
      });
      console.info("[Argus relayer] register proof response sent", {
        proofId: shortValue(registration.proofId),
        solanaTx: shortValue(registration.solanaTx),
      });
    } catch (error) {
      recordRegistrationProgress(body.proofId, "failed", "Registration failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return;
  }

  if (
    request.method === "GET" &&
    url.pathname.startsWith(REGISTRATION_PROGRESS_ROUTE_PREFIX) &&
    url.pathname.endsWith("/progress")
  ) {
    const proofId = decodeURIComponent(
      url.pathname.slice(
        REGISTRATION_PROGRESS_ROUTE_PREFIX.length,
        -"/progress".length,
      ),
    );
    sendJson(response, 200, loadRegistrationProgress(proofId));
    return;
  }

  if (
    request.method === "GET" &&
    url.pathname.startsWith(PROOF_ROUTE_PREFIX) &&
    url.pathname.endsWith(PROOF_PHOTO_ROUTE_SUFFIX)
  ) {
    const proofId = decodeURIComponent(
      url.pathname.slice(
        PROOF_ROUTE_PREFIX.length,
        -PROOF_PHOTO_ROUTE_SUFFIX.length,
      ),
    );
    const storedBundle = await loadProofBundle(proofId);
    if (!storedBundle?.proof?.photoBytesBase64) {
      sendJson(response, 404, {
        error: "Proof photo was not found.",
      });
      return;
    }

    response.statusCode = 200;
    response.setHeader("content-type", "image/jpeg");
    response.setHeader("cache-control", "private, max-age=60");
    response.end(Buffer.from(storedBundle.proof.photoBytesBase64, "base64"));
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith(PROOF_ROUTE_PREFIX)) {
    const proofId = decodeURIComponent(url.pathname.slice(PROOF_ROUTE_PREFIX.length));
    const storedBundle = await loadProofBundle(proofId);
    if (!storedBundle) {
      sendJson(response, 404, {
        status: "missing",
        manifestHashMatches: false,
        imageHashMatches: false,
        proofIdMatches: false,
        evidenceCommitmentsMatch: false,
        proofLevelMatches: false,
        proofRecordMatches: false,
        registryProgramMatches: false,
        authorizedRelayerMatches: false,
        message: "Proof bundle was not found.",
      });
      return;
    }

    sendJson(response, 200, {
      ...storedBundle.verification,
      proof: storedBundle.proof,
      explorerLinks: storedBundle.explorerLinks,
    });
    return;
  }

  sendJson(response, 404, {
    error: "Not found",
  });
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > MAX_REQUEST_BODY_BYTES) {
      throw new Error("request body exceeds Argus relayer limit");
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

function shortValue(value) {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value.length <= 16 ? value : `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;

  if (body === null) {
    response.end();
    return;
  }

  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body)}\n`);
}

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", process.env.ARGUS_CORS_ORIGIN || "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function isClientError(error) {
  return (
    error instanceof ArgusHttpError ||
    error instanceof SyntaxError ||
    error?.message?.includes("required") ||
    error?.message?.includes("must") ||
    error?.message?.includes("not authorized") ||
    error?.message?.includes("not supported") ||
    error?.message?.includes("does not match") ||
    error?.message?.includes("exceeds")
  );
}

function routeSecurityName(request, pathname) {
  if (request.method === "POST" && pathname === "/capture-session") {
    return "capture-session";
  }
  if (request.method === "POST" && pathname === "/mcu/capture") {
    return "mcu-capture";
  }
  if (request.method === "POST" && pathname === "/register-proof") {
    return "register-proof";
  }
  return "proof-read";
}
