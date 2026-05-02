export type VerificationProof = {
  status: "demo_fixture";
  proofId: string;
  manifestHash: string;
  imageHash: string;
  solanaTx: string;
  evidence: {
    label: string;
    detail: string;
    present: boolean;
  }[];
  verifies: string[];
  limitations: string[];
};

// kr: proof는 verifier RN 화면용 demo preview fixture이며 production verifier 결과를 대신하지 않습니다.
// en: proof is the demo preview fixture for the verifier RN screen; it does not stand in for production verifier results.
export const proof: VerificationProof = {
  status: "demo_fixture",
  proofId: "argus-proof-7f91b7a0c38e",
  manifestHash: "92b71b4a0df53890d688ff201ea95af6e2bcbf4b65a621b347e2e086e9c1a4bd",
  imageHash: "c7bbd83e54d22007fd7cb90e2843c9cb4a559a74f1c883ab0185d65c617ee401",
  solanaTx: "5mJ9B3QqkQdYxwC8vVc1rgxAx7Kg6GkWSCJ5vArLxkYt",
  evidence: [
    {
      label: "Camera evidence",
      detail: "Demo fixture simulates native capture path and capture metadata summary.",
      present: true,
    },
    {
      label: "Motion snapshot",
      detail: "Demo motion sample is included in the local commitment.",
      present: true,
    },
    {
      label: "App identity hash",
      detail: "Demo app identity hash is included in the manifest commitment.",
      present: true,
    },
    {
      label: "Public key evidence",
      detail: "Required for Level 3 verification; Level 4 adds hardware attestation only with a configured and validated trusted attestation root/fingerprint. Not present in this demo preview fixture.",
      present: false,
    },
    {
      label: "Trusted device attestation (Level 4)",
      detail: "Unsupported in this preview; keep Level 1/2/3 fallback labels instead of overclaiming.",
      present: false,
    },
  ],
  verifies: [
    "Preview photo bytes hash to the local fixture image commitment; this is not image forensics.",
    "Demo preview manifest hash recomputes to the local fixture commitment.",
    "Production verification still requires the production-pinned known Argus Registry program ID, trusted registry configuration, authorized production relayer fee payer, sponsored gas, and partner/use-case/app identity policy.",
    "Evidence level is Level 1 demo preview; fixture status is local-only.",
    "The demo preview photo bytes were bound to the local Argus preview bundle.",
    "Device-side evidence commitments are simulated without storing raw image bytes on-chain.",
  ],
  limitations: [
    "Does not prove ownership, condition, or legal validity of the submitted subject.",
    "Does not prove the photographed scene is truthful or unstaged.",
    "Does not perform image forensics or detect AI images submitted outside Argus capture.",
    "Does not prove the camera was not pointed at another screen.",
    "Does not fully prevent rooted, emulated, or mock-camera environments.",
  ],
};
