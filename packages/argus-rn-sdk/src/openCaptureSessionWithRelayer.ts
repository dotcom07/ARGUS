import type { ArgusCaptureSession, ArgusConfig, CreateCaptureProofOptions } from "./types";
import { buildRelayerEndpointUrl } from "./relayerUrlPolicy.ts";

const MAX_CAPTURE_SESSION_ID_BYTES = 4 * 1024;

// kr: openCaptureSessionWithRelayer는 촬영 전에 relayer가 발급한 nonce 세션을 받아옵니다.
// en: openCaptureSessionWithRelayer fetches the relayer-issued nonce session before capture.
export async function openCaptureSessionWithRelayer(
  config: ArgusConfig,
  options: CreateCaptureProofOptions,
  appIdentityHash: string,
): Promise<ArgusCaptureSession> {
  assertHex32("appIdentityHash", appIdentityHash);
  if (options.partnerId !== config.partnerId) {
    throw new Error("Argus capture session partnerId does not match SDK config");
  }

  const normalizedAppIdentityHash = appIdentityHash.toLowerCase();
  const captureSessionUrl = buildRelayerEndpointUrl(config.relayerUrl, "/capture-session");
  if (!captureSessionUrl) {
    throw new Error("Argus relayer URL is not safe");
  }

  const response = await fetch(captureSessionUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      appIdentityHash: normalizedAppIdentityHash,
      partnerId: options.partnerId,
      useCase: options.useCase,
    }),
  });

  if (!response.ok) {
    throw new Error(`Argus relayer capture session returned ${response.status}`);
  }

  const session = (await response.json()) as Partial<ArgusCaptureSession>;
  if (session.captureSessionId === undefined) {
    throw new Error("Argus relayer capture session omitted captureSessionId");
  }

  // kr: relayer session envelope은 native capture로 전달되는 untrusted 입력입니다. relayer/Kotlin과 같은 길이 cap으로 fail-closed합니다.
  // en: The relayer session envelope is untrusted input passed into native capture; fail closed with the same length cap used by relayer/Kotlin.
  assertBoundedText("captureSessionId", session.captureSessionId, MAX_CAPTURE_SESSION_ID_BYTES);
  assertHex32("sessionNonce", session.nonce);
  assertOptionalPositiveSafeInteger("expiresAtMs", session.expiresAtMs);

  return {
    captureSessionId: session.captureSessionId,
    nonce: session.nonce.toLowerCase(),
    appIdentityHash: normalizedAppIdentityHash,
    expiresAtMs: session.expiresAtMs,
  };
}

function assertBoundedText(field: string, value: unknown, maxUtf8Bytes: number): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }

  if (utf8ByteLength(value) > maxUtf8Bytes) {
    throw new Error(`${field} exceeds Argus JSON text limit`);
  }
}

function assertHex32(field: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value) || /^0{64}$/.test(value)) {
    throw new Error(`${field} must be a non-zero 32-byte hex string`);
  }
}

function assertOptionalPositiveSafeInteger(field: string, value: unknown): asserts value is number | undefined {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0;
    if (codePoint > 0xffff) {
      index += 1;
    }

    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
