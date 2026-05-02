import { createDemoCaptureProof } from "../../packages/argus-rn-sdk/src/demoProof.mjs";

const ARGUS_PROOF_ID_PATTERN = /^[0-9a-f]{64}$/;
const DEMO_VERIFIER_DEEP_LINK_PREFIX = "argus://verify/local-simulator/";

const listing = {
  listingId: "ebay-argus-camera-001",
  title: "Vintage Kodak Instamatic camera and 35mm film set",
  condition: "used-excellent",
};

const elements = {
  appStatus: document.querySelector("#appStatus"),
  cameraStatus: document.querySelector("#cameraStatus"),
  captureButton: document.querySelector("#captureButton"),
  evidenceLevel: document.querySelector("#evidenceLevel"),
  evidenceSummary: document.querySelector("#evidenceSummary"),
  gasStatus: document.querySelector("#gasStatus"),
  keyCertStatus: document.querySelector("#keyCertStatus"),
  level4Status: document.querySelector("#level4Status"),
  manifestHash: document.querySelector("#manifestHash"),
  motionStatus: document.querySelector("#motionStatus"),
  photoBadge: document.querySelector("#photoBadge"),
  saveStatus: document.querySelector("#saveStatus"),
  solanaTx: document.querySelector("#solanaTx"),
  stepCamera: document.querySelector("#stepCamera"),
  stepProof: document.querySelector("#stepProof"),
  stepPublish: document.querySelector("#stepPublish"),
  verifiedPill: document.querySelector("#verifiedPill"),
  verifierLink: document.querySelector("#verifierLink"),
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

    saveListingDraft(proof);
    renderProof(proof);
  } catch (error) {
    setCaptureState("failed");
    elements.evidenceSummary.textContent = error.message;
  }
}

function renderProof(proof) {
  // Browser preview data is local and simulated, so every status stays demo-labeled and muted.
  elements.captureButton.textContent = "Capture again";
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
  elements.saveStatus.textContent =
    "Local photo + JSON saved; listing and item page proof badges are ready for preview";
  elements.saveStatus.className = "save-status saved";

  markStepDone(elements.stepCamera, "Camera evidence committed");
  markStepDone(elements.stepProof, "Manifest matched locally");
  markStepDone(elements.stepPublish, "Badge attached to listing");

  const safeVerificationUrl = getSafeDemoVerificationUrl(proof);
  if (safeVerificationUrl) {
    elements.verifierLink.href = safeVerificationUrl;
    elements.verifierLink.className = "verifier-link";
    elements.verifierLink.textContent = "Proof deep link saved";
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
  elements.gasStatus.textContent =
    "Authorized production relayer fee payer and sponsored gas: simulated relayer only";
}

function setCaptureState(state) {
  if (state === "capturing") {
    elements.captureButton.textContent = "Creating local demo preview...";
    elements.captureButton.disabled = true;
    elements.evidenceSummary.textContent = "Collecting simulated local demo preview commitments";
    elements.saveStatus.textContent = "Saving local photo bytes and metadata JSON...";
    elements.saveStatus.className = "save-status";
    elements.stepCamera.className = "step-card active";
    updateStepCopy(elements.stepCamera, "Camera session open");
  }

  if (state === "failed") {
    elements.captureButton.textContent = "Try again";
    elements.captureButton.disabled = false;
    updateStepCopy(elements.stepCamera, "Capture failed");
  }
}

function markStepDone(step, copy) {
  step.className = "step-card done";
  updateStepCopy(step, copy);
}

function updateStepCopy(step, copy) {
  const status = step.querySelector("small");
  status.textContent = copy;
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

  // The browser preview stores the proof locally and keeps the mobile deep link bound to this proof ID.
  const expectedVerificationUrl = `${DEMO_VERIFIER_DEEP_LINK_PREFIX}${proofId}`;
  return verificationUrl === expectedVerificationUrl ? verificationUrl : undefined;
}

function saveListingDraft(proof) {
  const draft = {
    backendMessage:
      "Local demo photo and JSON saved. Native Android capture can register this proof bundle with the Argus backend.",
    backendStatus: "local_only",
    listing,
    metadataJson: proof.metadataJson || "{}",
    photoBytesBase64: proof.photoBytesBase64 || "",
    photoUri: "assets/product-camera.jpg",
    proof,
    savedAt: new Date().toISOString(),
    uploadSource: "local_upload",
  };

  localStorage.setItem("ebay_argus.local_listing", JSON.stringify(draft));
}
