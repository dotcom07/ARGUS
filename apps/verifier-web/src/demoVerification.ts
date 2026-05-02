import type { VerificationResult } from "../../../packages/argus-rn-sdk/src";

// kr: loadDemoVerification은 verifier API가 없는 RN preview에서 빈 상태를 보여주며 production verified 결과를 만들지 않습니다.
// en: loadDemoVerification shows the empty state in RN previews without a verifier API and never creates a production verified result.
export function loadDemoVerification(): VerificationResult {
  return {
    status: "missing",
    manifestHashMatches: false,
    imageHashMatches: false,
    proofIdMatches: false,
    evidenceCommitmentsMatch: false,
    proofLevelMatches: false,
    proofRecordMatches: false,
    registryProgramMatches: false,
    authorizedRelayerMatches: false,
    message: "Open a full Argus proof bundle to verify photo bytes, manifest, production-pinned registry program, trusted registry configuration, authorized production relayer fee payer, and sponsored gas.",
  };
}
