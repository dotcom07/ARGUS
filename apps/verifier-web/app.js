import { verifyDemoProof } from "../../packages/argus-rn-sdk/src/demoProof.mjs";
import { resolveBrowserDemoProofId } from "./proofRoute.js";

const proofId = resolveBrowserDemoProofId(window.location);

const elements = {
  proofCardTitle: document.querySelector("#proofCardTitle"),
  proofIdLabel: document.querySelector("#proofIdLabel"),
  manifestHashLabel: document.querySelector("#manifestHashLabel"),
  imageHashLabel: document.querySelector("#imageHashLabel"),
  solanaTxLabel: document.querySelector("#solanaTxLabel"),
  relayerLabel: document.querySelector("#relayerLabel"),
  registryProgramLabel: document.querySelector("#registryProgramLabel"),
  proofLevelLabel: document.querySelector("#proofLevelLabel"),
  recordStatusLabel: document.querySelector("#recordStatusLabel"),
  statusMark: document.querySelector("#statusMark"),
  statusTitle: document.querySelector("#statusTitle"),
  statusCopy: document.querySelector("#statusCopy"),
  proofId: document.querySelector("#proofId"),
  manifestHash: document.querySelector("#manifestHash"),
  imageHash: document.querySelector("#imageHash"),
  solanaTx: document.querySelector("#solanaTx"),
  relayer: document.querySelector("#relayer"),
  registryProgram: document.querySelector("#registryProgram"),
  proofLevel: document.querySelector("#proofLevel"),
  recordStatus: document.querySelector("#recordStatus"),
  cameraEvidence: document.querySelector("#cameraEvidence"),
  motionEvidence: document.querySelector("#motionEvidence"),
  appEvidence: document.querySelector("#appEvidence"),
  keystoreEvidence: document.querySelector("#keystoreEvidence"),
  level4Evidence: document.querySelector("#level4Evidence"),
};

renderVerification();

async function renderVerification() {
  const result = await verifyDemoProof(proofId);

  if (result.status !== "demo_verified") {
    renderMissingOrFailed(result);
    return;
  }

  const proof = result.proof;
  // The browser verifier only reads localStorage demo data, so matched bundles still stay preview-labeled.
  setProofLabels("demo-preview");
  elements.statusMark.textContent = "DEMO";
  elements.statusMark.className = "status-mark pending";
  elements.statusTitle.textContent = "Local Demo Preview Bundle Matched";
  elements.statusCopy.textContent =
    "This browser demo preview only matches localStorage simulated proof data. It is unauthorized, superseded, unsponsored, and not a production Argus Registry record.";

  elements.proofId.textContent = proof.proofId;
  elements.manifestHash.textContent = proof.manifestHash;
  elements.imageHash.textContent = proof.imageHash;
  elements.solanaTx.textContent = `simulated: ${proof.solanaTx}`;
  elements.relayer.textContent = `simulated: ${proof.relayer || proof.proofRecord?.relayer || "missing"}`;
  elements.registryProgram.textContent = proof.registryProgramId || proof.proofRecord?.registryProgramId || "missing";
  elements.proofLevel.textContent = "Level 1 - Demo preview";
  elements.recordStatus.textContent = `${proof.proofRecord?.status || "missing"} (local fixture)`;

  setEvidenceState(elements.cameraEvidence, proof.deviceEvidenceSummary.cameraMetadata);
  setEvidenceState(elements.motionEvidence, proof.deviceEvidenceSummary.motionSnapshot);
  setEvidenceState(elements.appEvidence, proof.deviceEvidenceSummary.appIdentityHash);
  setEvidenceState(elements.keystoreEvidence, false);
  setEvidenceState(elements.level4Evidence, false);
}

function renderMissingOrFailed(result) {
  const isPendingProofRequest = !proofId;
  const isMissingProofRequest = Boolean(proofId) && result.status === "missing" && !result.proof;
  const proofFieldsAreUnavailable = !isPendingProofRequest && !result.proof;
  // No proofId is pending; a missing proofId lookup is unavailable rather than a mismatched claim.
  setProofLabels(isPendingProofRequest ? "pending" : proofFieldsAreUnavailable ? "unavailable" : "claimed");
  clearProofValues();
  clearEvidenceValues();
  elements.statusMark.textContent = isPendingProofRequest ? "..." : isMissingProofRequest ? "N/A" : "!";
  elements.statusMark.className =
    isPendingProofRequest || isMissingProofRequest ? "status-mark pending" : "status-mark failed";
  elements.statusTitle.textContent = isPendingProofRequest
    ? "Proof pending"
    : result.status === "missing"
      ? "Proof not found"
      : "Proof mismatch";
  elements.statusCopy.textContent = isPendingProofRequest
    ? "Open a demo preview verifier link with a proof ID to check local proof data."
    : isMissingProofRequest
      ? "No local proof bundle was found for this proof ID. No proof claims are displayed."
    : result.message || "The proof bundle did not match the local demo preview commitment.";
}

function setProofLabels(state) {
  const isDemoPreview = state === "demo-preview";
  const isPendingProofRequest = state === "pending";
  const proofFieldsAreUnavailable = state === "unavailable";

  elements.proofCardTitle.textContent = isDemoPreview
    ? "Local demo preview bundle"
    : isPendingProofRequest
      ? "Proof fields pending"
      : proofFieldsAreUnavailable
        ? "Proof fields unavailable"
      : "Unverified proof claims";
  elements.proofIdLabel.textContent = isDemoPreview
    ? "Local demo preview proof ID"
    : isPendingProofRequest
      ? "Proof ID"
      : proofFieldsAreUnavailable
        ? "Proof ID"
      : "Claimed proof ID";
  elements.manifestHashLabel.textContent = isDemoPreview
    ? "Preview manifest hash"
    : isPendingProofRequest
      ? "Manifest hash"
      : proofFieldsAreUnavailable
        ? "Manifest hash"
      : "Claimed manifest hash";
  elements.imageHashLabel.textContent = isDemoPreview
    ? "Preview image hash commitment"
    : isPendingProofRequest
      ? "Image hash commitment"
      : proofFieldsAreUnavailable
        ? "Image hash commitment"
      : "Claimed image hash commitment";
  elements.solanaTxLabel.textContent = isDemoPreview
    ? "Simulated preview transaction reference"
    : isPendingProofRequest
      ? "Transaction reference"
      : proofFieldsAreUnavailable
        ? "Transaction reference"
      : "Claimed transaction reference";
  elements.relayerLabel.textContent = isDemoPreview
    ? "Demo preview relayer fixture"
    : isPendingProofRequest
      ? "Relayer"
      : proofFieldsAreUnavailable
        ? "Relayer"
      : "Claimed relayer";
  elements.registryProgramLabel.textContent = isDemoPreview
    ? "Expected preview registry program"
    : isPendingProofRequest
      ? "Registry program"
      : proofFieldsAreUnavailable
        ? "Registry program"
      : "Claimed registry program";
  elements.proofLevelLabel.textContent = isDemoPreview
    ? "Preview evidence level"
    : isPendingProofRequest
      ? "Evidence level"
      : proofFieldsAreUnavailable
        ? "Evidence level"
      : "Claimed evidence level";
  elements.recordStatusLabel.textContent = isDemoPreview
    ? "Local preview fixture status"
    : isPendingProofRequest
      ? "Record status"
      : proofFieldsAreUnavailable
        ? "Record status"
      : "Claimed record status";
}

function clearProofValues() {
  elements.proofId.textContent = "-";
  elements.manifestHash.textContent = "-";
  elements.imageHash.textContent = "-";
  elements.solanaTx.textContent = "-";
  elements.relayer.textContent = "-";
  elements.registryProgram.textContent = "-";
  elements.proofLevel.textContent = "-";
  elements.recordStatus.textContent = "-";
}

function clearEvidenceValues() {
  elements.cameraEvidence.className = "evidence-item muted";
  elements.cameraEvidence.textContent = "Camera evidence pending";
  elements.motionEvidence.className = "evidence-item muted";
  elements.motionEvidence.textContent = "Motion snapshot pending";
  elements.appEvidence.className = "evidence-item muted";
  elements.appEvidence.textContent = "App identity hash pending";
  elements.keystoreEvidence.className = "evidence-item muted";
  elements.keystoreEvidence.textContent = "Public key evidence pending";
  elements.level4Evidence.className = "evidence-item muted";
  elements.level4Evidence.textContent = "Trusted device attestation (Level 4) pending";
}

function setEvidenceState(element, isPresent) {
  if (isPresent) {
    element.className = "evidence-item";
    element.textContent = `${element.textContent.replace(" pending", "")} present`;
    return;
  }

  element.className = "evidence-item muted";
  element.textContent = `${element.textContent.replace(" present", "")} pending`;
}
