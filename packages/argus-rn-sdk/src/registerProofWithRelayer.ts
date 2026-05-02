import {
  ARGUS_AUTHORIZED_RELAYER,
  ARGUS_REGISTRY_PROGRAM_ID,
  hasRequiredProductionCaptureFields,
  isPlausibleProofRecordRegisteredAt,
  isPlausibleSolanaTransactionSignature,
  isSupportedProductionProofLevel,
} from "./proofStatus.ts";
import { buildRelayerEndpointUrl } from "./relayerUrlPolicy.ts";
import type { ArgusConfig, ArgusProof, RelayerRegistrationResult } from "./types";

const ARGUS_DEFAULT_VERIFIER_ORIGIN = "https://verify.argus.dev";

// kr: registerProofWithRelayer는 native proof를 relayer에 보내 Solana 등록을 요청합니다.
// en: registerProofWithRelayer sends a native proof to the relayer and requests Solana registration.
export async function registerProofWithRelayer(
  config: ArgusConfig,
  proof: ArgusProof,
): Promise<RelayerRegistrationResult> {
  if (proof.partnerId !== config.partnerId) {
    throw new Error("Argus relayer proof partnerId does not match SDK config");
  }

  const proofSnapshot = snapshotProofForRegistration(proof);

  if (config.relayerUrl.startsWith("mock://")) {
    // kr: mock://는 simulator/demo 표시만 위한 경로라 production registration 검사를 의도적으로 통과시키지 않습니다.
    // en: mock:// is display-only for simulator/demo use, so it intentionally does not pass production registration checks.
    return createMockRegistration(config, proofSnapshot);
  }

  const registerProofUrl = buildRelayerEndpointUrl(config.relayerUrl, "/register-proof");
  if (!registerProofUrl) {
    throw new Error("Argus relayer URL is not safe");
  }

  assertProofAllowedForProductionRegistration(proofSnapshot);

  const response = await fetch(registerProofUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      proofId: proofSnapshot.proofId,
      manifestHash: proofSnapshot.manifestHash,
      imageHash: proofSnapshot.imageHash,
      partnerId: proofSnapshot.partnerId,
      partnerIdHash: proofSnapshot.partnerIdHash,
      useCase: proofSnapshot.useCase,
      verifierBaseUrl: config.verifierBaseUrl,
      canonicalManifestJson: proofSnapshot.canonicalManifestJson,
      metadataJson: proofSnapshot.metadataJson,
      cameraEvidenceJson: proofSnapshot.cameraEvidenceJson,
      deviceIntegrityJson: proofSnapshot.deviceIntegrityJson,
      photoBytesBase64: proofSnapshot.photoBytesBase64,
      captureSessionId: proofSnapshot.captureSessionId,
      sessionNonce: proofSnapshot.nonce,
      appIdentityHash: proofSnapshot.appIdentityHash,
      proofLevel: proofSnapshot.proofLevel ?? proofSnapshot.integrityLevel,
    }),
  });

  if (!response.ok) {
    throw new Error(`Argus relayer returned ${response.status}`);
  }

  const registration = (await response.json()) as RelayerRegistrationResult;
  assertRegistrationMatchesProof(config, registration, proofSnapshot);
  return registration;
}

function snapshotProofForRegistration(proof: ArgusProof): ArgusProof {
  const proofSnapshot = { ...proof };

  if (proof.proofRecord) {
    proofSnapshot.proofRecord = { ...proof.proofRecord };
  }

  if (proof.deviceEvidenceSummary) {
    proofSnapshot.deviceEvidenceSummary = { ...proof.deviceEvidenceSummary };
  }

  return proofSnapshot;
}

function assertRegistrationMatchesProof(
  config: ArgusConfig,
  registration: RelayerRegistrationResult,
  proof: ArgusProof,
) {
  // kr: relayer 응답은 신뢰 경계 밖 데이터입니다. native proof와 production trust root에 맞지 않으면 즉시 실패합니다.
  // en: The relayer response is outside the trust boundary; fail unless it matches the native proof and production trust root.
  const proofLevel = assertProofAllowedForProductionRegistration(proof);
  const manifestCaptureTimestamp = getManifestCaptureTimestamp(proof);

  if (registration.proofId !== proof.proofId) {
    throw new Error("Argus relayer returned a mismatched proofId");
  }

  if (registration.manifestHash && registration.manifestHash !== proof.manifestHash) {
    throw new Error("Argus relayer returned a mismatched manifestHash");
  }

  if (!registration.proofRecord) {
    throw new Error("Argus relayer omitted proofRecord");
  }

  if (
    registration.proofRecord.proofId !== proof.proofId ||
    registration.proofRecord.manifestHash !== proof.manifestHash ||
    registration.proofRecord.imageHash !== proof.imageHash ||
    registration.proofRecord.partnerIdHash !== proof.partnerIdHash ||
    registration.proofRecord.proofLevel !== proofLevel ||
    registration.proofRecord.captureTimestamp !== manifestCaptureTimestamp
  ) {
    throw new Error("Argus relayer proofRecord does not match the native proof");
  }

  if (!isPlausibleProofRecordRegisteredAt(registration.proofRecord.registeredAt, manifestCaptureTimestamp)) {
    throw new Error("Argus relayer proofRecord registeredAt is not safe");
  }

  if (
    registration.registryAddress !== ARGUS_REGISTRY_PROGRAM_ID ||
    registration.registryProgramId !== ARGUS_REGISTRY_PROGRAM_ID ||
    registration.proofRecord.registryProgramId !== ARGUS_REGISTRY_PROGRAM_ID
  ) {
    // kr: registry program ID는 production trust root입니다. devnet/테스트 program은 production proof로 라벨링하지 않습니다.
    // en: The registry program ID is the production trust root; devnet/test programs are not labeled as production proof.
    throw new Error("Argus relayer returned an unknown registry program");
  }

  if (registration.relayer !== registration.proofRecord.relayer) {
    throw new Error("Argus relayer response does not match proofRecord relayer");
  }

  if (registration.feePayer !== registration.relayer) {
    throw new Error("Argus relayer proofRecord is not an Argus-authorized relayer");
  }

  if (isProductionRelayerAcceptance(registration)) {
    // kr: solanaTx는 commitment 자체는 아니지만 verified UI에 표시되는 외부 relayer envelope 필드입니다. production 표시 전에 Solana signature shape로 fail-closed합니다.
    // en: solanaTx is not itself a commitment, but it is an external relayer-envelope field shown in verified UI; fail closed on Solana signature shape before production display.
    if (!isPlausibleSolanaTransactionSignature(registration.solanaTx)) {
      throw new Error("Argus relayer returned an unsafe solanaTx");
    }
  } else if (isDemoRelayerAcceptance(registration)) {
    if (!isSafeDemoTransactionReference(registration.solanaTx)) {
      throw new Error("Argus relayer returned an unsafe demo transaction reference");
    }
  } else {
    // kr: active/sponsored/authorized 조합이 모두 known Argus relayer에 묶일 때만 production으로 승격합니다. demo backend는 superseded/unauthorized/unsponsored만 통과합니다.
    // en: Only the active/sponsored/authorized tuple bound to the known Argus relayer promotes to production. Demo backend records must stay superseded/unauthorized/unsponsored.
    throw new Error("Argus relayer proofRecord is not an Argus-authorized relayer");
  }

  if (!isSafeRegistrationVerificationUrl(registration.verificationUrl, config.verifierBaseUrl, proof.proofId)) {
    throw new Error("Argus relayer returned an unsafe verificationUrl");
  }
}

function assertProofAllowedForProductionRegistration(proof: ArgusProof) {
  const proofLevel = proof.proofLevel ?? proof.integrityLevel;

  if (!isSupportedProductionProofLevel(proofLevel)) {
    throw new Error("Argus relayer proofLevel is not supported for production registration");
  }

  if (!hasRequiredProductionCaptureFields(proof)) {
    throw new Error("Argus native proof is missing required app_capture evidence or session fields");
  }

  return proofLevel;
}

function isProductionRelayerAcceptance(registration: RelayerRegistrationResult): boolean {
  return (
    registration.relayer === ARGUS_AUTHORIZED_RELAYER &&
    registration.feePayer === ARGUS_AUTHORIZED_RELAYER &&
    registration.sponsoredGas === true &&
    registration.proofRecord?.relayer === ARGUS_AUTHORIZED_RELAYER &&
    registration.proofRecord?.relayerAuthorized === true &&
    registration.proofRecord?.status === "active"
  );
}

function isDemoRelayerAcceptance(registration: RelayerRegistrationResult): boolean {
  return (
    hasText(registration.relayer) &&
    registration.feePayer === registration.relayer &&
    registration.proofRecord?.relayer === registration.relayer &&
    registration.sponsoredGas === false &&
    registration.proofRecord?.relayerAuthorized === false &&
    registration.proofRecord?.status === "superseded"
  );
}

function isSafeDemoTransactionReference(value?: string): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value);
}

// kr: createMockRegistration은 simulator/demo 표시용 데이터만 만들며 authorized, active, sponsored로 표시하지 않습니다.
// en: createMockRegistration only builds simulator/demo display data and does not mark it authorized, active, or sponsored.
function createMockRegistration(config: ArgusConfig, proof: ArgusProof): RelayerRegistrationResult {
  const txSeed = `${proof.proofId}:${proof.manifestHash}:${proof.imageHash}`;
  const solanaTx = simpleDemoHash(txSeed).padEnd(64, "0").slice(0, 64);
  const mockRelayer = "ArgusMockRelayer111111111111111111111111111";

  return {
    proofId: proof.proofId,
    solanaTx,
    registryAddress: ARGUS_REGISTRY_PROGRAM_ID,
    registryProgramId: ARGUS_REGISTRY_PROGRAM_ID,
    relayer: mockRelayer,
    proofRecord: {
      proofId: proof.proofId,
      manifestHash: proof.manifestHash,
      imageHash: proof.imageHash,
      partnerIdHash: proof.partnerIdHash ?? "missing",
      proofLevel: proof.proofLevel ?? proof.integrityLevel,
      captureTimestamp: Date.parse(proof.capturedAt),
      registeredAt: new Date().toISOString(),
      relayer: mockRelayer,
      relayerAuthorized: false,
      registryProgramId: ARGUS_REGISTRY_PROGRAM_ID,
      status: "superseded",
    },
    feePayer: mockRelayer,
    sponsoredGas: false,
    verificationUrl: `argus://verify/mock/${proof.proofId}`,
  };
}

// kr: simpleDemoHash는 mock 모드 전용 표시값이며 실제 proof 보안에는 Rust SHA-256 core를 사용합니다.
// en: simpleDemoHash is display-only for mock mode; real proof security uses the Rust SHA-256 core.
function simpleDemoHash(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash).toString(16);
}

function isSafeRegistrationVerificationUrl(
  verificationUrl: string,
  verifierBaseUrl: string,
  proofId: string,
): boolean {
  try {
    // kr: production verifier link와 base URL은 명시적인 `scheme://authority`만 신뢰합니다. URL parser가 `https:host/path`를 보정하게 두면 trust root가 흐려집니다.
    // en: Production verifier links and base URLs must carry an explicit `scheme://authority`; letting the URL parser repair `https:host/path` blurs the trust root.
    if (!hasAbsoluteUrlAuthority(verificationUrl) || !hasAbsoluteUrlAuthority(verifierBaseUrl)) {
      return false;
    }

    if (hasRawPathTraversalSegments(verificationUrl) || hasRawPathTraversalSegments(verifierBaseUrl)) {
      return false;
    }

    const parsedVerificationUrl = new URL(verificationUrl);
    const parsedVerifierBaseUrl = new URL(verifierBaseUrl);

    if (!isSafeVerifierBaseUrl(parsedVerifierBaseUrl)) {
      return false;
    }

    return (
      hasNoCredentials(parsedVerificationUrl) &&
      parsedVerificationUrl.origin === parsedVerifierBaseUrl.origin &&
      parsedVerificationUrl.pathname === expectedProofPath(parsedVerifierBaseUrl, proofId) &&
      parsedVerificationUrl.search === "" &&
      parsedVerificationUrl.hash === ""
    );
  } catch {
    return false;
  }
}

function getManifestCaptureTimestamp(proof: ArgusProof): unknown {
  try {
    const manifest: unknown = JSON.parse(proof.canonicalManifestJson ?? "");
    return manifest && typeof manifest === "object" && !Array.isArray(manifest)
      ? (manifest as Record<string, unknown>).captured_at_ms
      : undefined;
  } catch {
    return undefined;
  }
}

function expectedProofPath(verifierBaseUrl: URL, proofId: string): string {
  const basePath = verifierBaseUrl.pathname.replace(/\/+$/, "");
  return `${basePath}/proof/${encodeURIComponent(proofId)}`;
}

function isSafeVerifierBaseUrl(url: URL): boolean {
  if (!hasNoCredentials(url) || url.search !== "" || url.hash !== "") {
    return false;
  }

  return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasNoCredentials(url: URL): boolean {
  return url.username === "" && url.password === "";
}

function hasAbsoluteUrlAuthority(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function hasRawPathTraversalSegments(value: string): boolean {
  const path = rawPathFromAbsoluteUrl(value);
  if (path === null) {
    return false;
  }

  // kr: raw slash/backslash path가 trust boundary입니다. parser가 정규화하기 전에 traversal만 fail-closed로 막습니다.
  // en: The raw slash/backslash path is the trust boundary; fail closed on traversal before parser normalization.
  return [path, path.replace(/%2f|%5c/gi, "/")].some((candidatePath) =>
    candidatePath.split(/[\\/]/).some((segment) => {
      const normalizedSegment = segment.replace(/%2e/gi, ".");
      return normalizedSegment === "." || normalizedSegment === "..";
    }),
  );
}

function rawPathFromAbsoluteUrl(value: string): string | null {
  const schemeSeparatorIndex = value.indexOf("://");
  if (schemeSeparatorIndex === -1) {
    // kr: WHATWG URL은 `https:\host\..\x`도 정규화하므로, `://`가 없어도 raw path로 검사합니다.
    // en: WHATWG URL normalizes `https:\host\..\x`, so no-`://` forms are inspected as raw paths too.
    return rawPathFromIndex(value, 0);
  }

  const authorityStartIndex = schemeSeparatorIndex + 3;
  const slashPathStartIndex = value.indexOf("/", authorityStartIndex);
  const backslashPathStartIndex = value.indexOf("\\", authorityStartIndex);
  const pathStartCandidates = [slashPathStartIndex, backslashPathStartIndex].filter(
    (index) => index !== -1,
  );
  if (pathStartCandidates.length === 0) {
    return "";
  }

  const pathStartIndex = Math.min(...pathStartCandidates);
  return rawPathFromIndex(value, pathStartIndex);
}

function rawPathFromIndex(value: string, pathStartIndex: number): string {
  const queryStartIndex = value.indexOf("?", pathStartIndex);
  const hashStartIndex = value.indexOf("#", pathStartIndex);
  const pathEndIndex = [queryStartIndex, hashStartIndex]
    .filter((index) => index !== -1)
    .reduce((lowest, index) => Math.min(lowest, index), value.length);

  return value.slice(pathStartIndex, pathEndIndex);
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}
