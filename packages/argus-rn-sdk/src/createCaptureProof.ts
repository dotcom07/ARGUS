import { getConfig } from "./config";
import { callNativeCreateCaptureProof, callNativeGetAppIdentityHash } from "./nativeBridge";
import { openCaptureSessionWithRelayer } from "./openCaptureSessionWithRelayer";
import { registerProofWithRelayer } from "./registerProofWithRelayer";
import type { ArgusProof, CreateCaptureProofOptions } from "./types";

// kr: createCaptureProof는 파트너 앱에서 검증 촬영을 시작하는 SDK 함수입니다.
// en: createCaptureProof is the SDK function partner apps call to start verified capture.
export async function createCaptureProof(
  options: CreateCaptureProofOptions,
): Promise<ArgusProof> {
  const config = getConfig();
  if (options.partnerId !== config.partnerId) {
    throw new Error("Argus capture partnerId does not match SDK config");
  }

  const sessionFields = await buildNativeSessionFields(config, options);
  const proof = await callNativeCreateCaptureProof({
    ...options,
    ...sessionFields,
  });
  const registration = await registerProofWithRelayer(config, proof);

  return {
    ...proof,
    solanaTx: registration.solanaTx,
    registryAddress: registration.registryAddress,
    registryProgramId: registration.registryProgramId,
    relayer: registration.relayer,
    feePayer: registration.feePayer,
    sponsoredGas: registration.sponsoredGas,
    proofRecord: registration.proofRecord,
    verificationUrl: registration.verificationUrl,
  };
}

async function buildNativeSessionFields(
  config: ReturnType<typeof getConfig>,
  options: CreateCaptureProofOptions,
) {
  if (config.relayerUrl.startsWith("mock://")) {
    return {};
  }

  const appIdentityHash = await callNativeGetAppIdentityHash();
  const session = await openCaptureSessionWithRelayer(config, options, appIdentityHash);

  return {
    appIdentityHash: session.appIdentityHash,
    captureSessionId: session.captureSessionId,
    sessionNonce: session.nonce,
  };
}
