export const MAX_CANONICAL_MANIFEST_JSON_BYTES = 4 * 1024;
export const MAX_CAPTURE_SESSION_ID_BYTES = MAX_CANONICAL_MANIFEST_JSON_BYTES;
export const MAX_METADATA_JSON_BYTES = 64 * 1024;
export const MAX_EVIDENCE_JSON_BYTES = 16 * 1024;
export const MAX_VERIFIER_BASE_URL_BYTES = 2 * 1024;

const REGISTRATION_JSON_TEXT_LIMITS = Object.freeze([
  ["canonicalManifestJson", MAX_CANONICAL_MANIFEST_JSON_BYTES],
  ["captureSessionId", MAX_CAPTURE_SESSION_ID_BYTES],
  ["metadataJson", MAX_METADATA_JSON_BYTES],
  ["cameraEvidenceJson", MAX_EVIDENCE_JSON_BYTES],
  ["deviceIntegrityJson", MAX_EVIDENCE_JSON_BYTES],
]);

export function assertRegistrationJsonTextLimits(request, requiredContext) {
  for (const [field, maxBytes] of REGISTRATION_JSON_TEXT_LIMITS) {
    assertTextByteLength(field, request?.[field], maxBytes, requiredContext);
  }
}

export function assertVerifierBaseUrlTextLimit(value, requiredContext) {
  assertTextByteLength(
    "verifierBaseUrl",
    value,
    MAX_VERIFIER_BASE_URL_BYTES,
    requiredContext,
  );
}

function assertTextByteLength(field, value, maxBytes, requiredContext) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required ${requiredContext}`);
  }

  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error(`${field} exceeds relayer JSON text limit`);
  }
}
