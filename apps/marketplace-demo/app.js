import { createDemoCaptureProof } from "../../packages/argus-rn-sdk/src/demoProof.mjs";

const ARGUS_PROOF_ID_PATTERN = /^[0-9a-f]{64}$/;
const DEMO_VERIFIER_QUERY_PREFIX = "../verifier-web/index.html?proofId=";

const listing = {
  listingId: "argus-listing-500cm",
  title: "Hasselblad 500C/M Medium Format Film Camera Kit",
  condition: "used-excellent",
};

const elements = {
  captureButton: document.querySelector("#captureButton"),
  evidenceSummary: document.querySelector("#evidenceSummary"),
  evidenceLevel: document.querySelector("#evidenceLevel"),
  manifestHash: document.querySelector("#manifestHash"),
  solanaTx: document.querySelector("#solanaTx"),
  verifierLink: document.querySelector("#verifierLink"),
  photoBadge: document.querySelector("#photoBadge"),
  verifiedPill: document.querySelector("#verifiedPill"),
  cameraStatus: document.querySelector("#cameraStatus"),
  motionStatus: document.querySelector("#motionStatus"),
  appStatus: document.querySelector("#appStatus"),
  keyCertStatus: document.querySelector("#keyCertStatus"),
  level4Status: document.querySelector("#level4Status"),
  gasStatus: document.querySelector("#gasStatus"),
};

elements.captureButton.addEventListener("click", handleVerifiedCapture);

async function handleVerifiedCapture() {
  setCaptureState("capturing");

  try {
    const proof = await createDemoCaptureProof({
      partnerId: "recommerce-demo",
      useCase: "marketplace_listing",
      metadata: listing,
    });

    renderProof(proof);
  } catch (error) {
    setCaptureState("failed");
    elements.evidenceSummary.textContent = error.message;
  }
}

function renderProof(proof) {
  // Browser preview data is local and simulated, so every status stays demo-labeled and muted.
  elements.captureButton.textContent = "Create another local demo preview";
  elements.captureButton.disabled = false;
  elements.photoBadge.textContent = "Local Demo Preview";
  elements.photoBadge.className = "photo-badge pending";
  elements.verifiedPill.textContent = "Local Demo Preview";
  elements.verifiedPill.className = "verified-pill muted";
  elements.manifestHash.textContent = shortenHash(proof.manifestHash);
  elements.solanaTx.textContent = shortenHash(proof.solanaTx);
  elements.evidenceLevel.textContent = "Level 1 - Demo preview";
  elements.evidenceSummary.textContent =
    "Local demo preview only: simulated camera, motion, and app identity commitments";
  const safeVerificationUrl = getSafeDemoVerificationUrl(proof);
  if (safeVerificationUrl) {
    elements.verifierLink.href = safeVerificationUrl;
    elements.verifierLink.className = "verifier-link";
    elements.verifierLink.textContent = "Open demo preview verifier";
    elements.verifierLink.removeAttribute("aria-disabled");
    elements.verifierLink.removeAttribute("tabindex");
  } else {
    elements.verifierLink.removeAttribute("href");
    elements.verifierLink.className = "verifier-link disabled";
    elements.verifierLink.textContent = "Verifier unavailable";
    elements.verifierLink.setAttribute("aria-disabled", "true");
    elements.verifierLink.setAttribute("tabindex", "-1");
  }

  elements.cameraStatus.textContent = "Simulated camera evidence commitment: present";
  elements.motionStatus.textContent = "Simulated motion snapshot: captured";
  elements.appStatus.textContent = "Simulated app identity hash: committed";
  elements.keyCertStatus.textContent = "Public key evidence: not present in local preview";
  elements.level4Status.textContent = "Trusted device attestation (Level 4): not in local preview";
  elements.gasStatus.textContent = "No authorized production registry write: simulated relayer only";
}

function setCaptureState(state) {
  if (state === "capturing") {
    elements.captureButton.textContent = "Creating local demo preview...";
    elements.captureButton.disabled = true;
    elements.evidenceSummary.textContent = "Collecting simulated local demo preview commitments";
  }

  if (state === "failed") {
    elements.captureButton.textContent = "Try again";
    elements.captureButton.disabled = false;
  }
}

function shortenHash(hash) {
  if (!hash) {
    return "Unavailable";
  }

  return `${hash.slice(0, 12)}...${hash.slice(-10)}`;
}

function getSafeDemoVerificationUrl(proof) {
  const proofId = typeof proof?.proofId === "string" ? proof.proofId : "";
  const verificationUrl = typeof proof?.verificationUrl === "string" ? proof.verificationUrl.trim() : "";

  if (!ARGUS_PROOF_ID_PATTERN.test(proofId) || /^0{64}$/.test(proofId)) {
    return undefined;
  }

  // The browser demo verifier reads localStorage only; enable a link only when it is bound to this proof ID.
  const expectedVerificationUrl = `${DEMO_VERIFIER_QUERY_PREFIX}${proofId}`;
  return verificationUrl === expectedVerificationUrl ? verificationUrl : undefined;
}
