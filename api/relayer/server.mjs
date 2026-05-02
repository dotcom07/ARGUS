import http from "node:http";
import { config as loadEnv } from "dotenv";
import { openRelayerCaptureSession } from "./openCaptureSession.mjs";
import { registerProof } from "./registerProof.mjs";
import { loadProofBundle, storeProofBundle } from "./proofBundleStore.mjs";

loadEnv();

const DEFAULT_PORT = 8787;
const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
const PROOF_ROUTE_PREFIX = "/api/proofs/";

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    sendJson(response, 204, null);
    return;
  }

  try {
    await routeRequest(request, response);
  } catch (error) {
    const status = isClientError(error) ? 400 : 500;
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

  if (request.method === "POST" && url.pathname === "/capture-session") {
    const body = await readJsonBody(request);
    sendJson(response, 200, openRelayerCaptureSession(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/register-proof") {
    const body = await readJsonBody(request);
    const registration = await registerProof(body);
    const storedBundle = await storeProofBundle({ registration, request: body });
    sendJson(response, 200, {
      ...registration,
      explorerLinks: storedBundle.explorerLinks,
    });
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
    error instanceof SyntaxError ||
    error?.message?.includes("required") ||
    error?.message?.includes("must") ||
    error?.message?.includes("not authorized") ||
    error?.message?.includes("not supported") ||
    error?.message?.includes("does not match") ||
    error?.message?.includes("exceeds")
  );
}
