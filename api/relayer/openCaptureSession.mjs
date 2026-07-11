import { openCaptureSession } from "./sessionStore.mjs";
import { assertPartnerAppAuthorized } from "./partnerPolicy.mjs";

// kr: openRelayerCaptureSession은 SDK가 촬영 전에 받아야 하는 nonce 세션을 발급합니다.
// en: openRelayerCaptureSession issues the nonce session the SDK must use before capture.
export function openRelayerCaptureSession(request) {
  if (!request?.partnerId) {
    throw new Error("partnerId is required");
  }

  if (!request?.useCase) {
    throw new Error("useCase is required");
  }

  assertHex32("appIdentityHash", request.appIdentityHash);
  const appIdentityHash = request.appIdentityHash.toLowerCase();
  assertPartnerAppAuthorized({
    appIdentityHash,
    partnerId: request.partnerId,
    useCase: request.useCase,
  });

  // The authenticated API boundary is enforced by server.mjs. This function stays pure so tests and internal callers share the same policy.
  return openCaptureSession({
    appIdentityHash,
    partnerId: request.partnerId,
    useCase: request.useCase,
  });
}

function assertHex32(field, value) {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value) || /^0{64}$/.test(value)) {
    throw new Error(`${field} must be a non-zero 32-byte hex string`);
  }
}
