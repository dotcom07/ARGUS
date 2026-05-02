import React, { useEffect, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  configure,
  getArgusEvidenceLevel,
  getArgusEvidenceLevelLabel,
  isArgusLocalDemoProof,
  isArgusProductionProof,
  hasArgusPublicKeyCertificateEvidence,
  verifyProof,
  type VerificationResult,
} from "../../../packages/argus-rn-sdk/src";
import { ARGUS_DEMO_BACKEND_URL, ARGUS_DEMO_PARTNER_ID } from "../../shared/argusDemoConfig";
import { loadDemoVerification } from "./demoVerification";

type VerifierAppProps = {
  proofId?: string;
  verifierBaseUrl?: string;
};

// kr: VerifierApp은 production verifier 결과와 local demo preview 결과를 분리해 proofId 상태를 보여주는 RN verifier 데모입니다.
// en: VerifierApp separates production verifier results from local demo preview results while showing proofId status.
export default function VerifierApp({ proofId, verifierBaseUrl }: VerifierAppProps) {
  const [result, setResult] = useState<VerificationResult>(() => loadDemoVerification());
  const activeVerifierBaseUrl = verifierBaseUrl ?? ARGUS_DEMO_BACKEND_URL;
  const hasProofRequest = Boolean(proofId);

  useEffect(() => {
    configure({
      partnerId: ARGUS_DEMO_PARTNER_ID,
      relayerUrl: ARGUS_DEMO_BACKEND_URL,
      verifierBaseUrl: activeVerifierBaseUrl,
    });
  }, [activeVerifierBaseUrl]);

  useEffect(() => {
    if (!proofId) {
      // kr: proofId가 사라진 route에서는 이전 verifier 결과를 그대로 두면 pending 화면에 stale claim이 남습니다.
      // en: When the proofId disappears, clear prior verifier results so the pending route cannot show stale claims.
      setResult(loadDemoVerification());
      return;
    }

    let isMounted = true;

    // kr: 새 proofId를 조회하는 동안 이전 route의 proof bundle을 계속 보여주면 다른 proofId에 대한 stale badge가 됩니다.
    // en: While a new proofId is being checked, clear the prior route's bundle so stale badges cannot appear for another proofId.
    setResult(loadDemoVerification());

    // kr: 실제 verifier flow에서는 proofId로 verifier API를 조회하고 registry commitment 결과를 표시합니다.
    // en: In the real verifier flow, proofId queries the verifier API and displays registry commitment results.
    verifyProof(proofId)
      .then((verification) => {
        if (isMounted) {
          setResult(verification);
        }
      })
      .catch(() => {
        if (isMounted) {
          // kr: 예외/장애는 proof 없음이 아니라 verifier 실패입니다. missing으로 낮추면 outage가 "not found"처럼 보입니다.
          // en: Exceptions/outages are verifier failures, not absent proofs; downgrading them to missing makes outages look like "not found".
          setResult({
            status: "failed",
            manifestHashMatches: false,
            imageHashMatches: false,
            proofIdMatches: false,
            evidenceCommitmentsMatch: false,
            proofLevelMatches: false,
            proofRecordMatches: false,
            registryProgramMatches: false,
            authorizedRelayerMatches: false,
            message: "Verifier request failed.",
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [proofId, activeVerifierBaseUrl]);

  const pendingVerification = loadDemoVerification();
  // kr: route proofId와 bundle proofId가 다르면 이전 lookup 결과이므로 pending처럼 취급합니다.
  // en: If the route proofId and bundle proofId differ, treat the bundle as stale and render the pending state.
  const staleProofForRoute = Boolean(hasProofRequest && result.proof && result.proof.proofId !== proofId);
  const proof = staleProofForRoute ? undefined : result.proof;
  const evidenceLevel = getArgusEvidenceLevel(proof);
  const evidenceLevelLabel = getArgusEvidenceLevelLabel(proof);
  const initialLookupIsPending =
    hasProofRequest &&
    result.status === "missing" &&
    !proof &&
    result.message === pendingVerification.message;
  const isDemoProof = isArgusLocalDemoProof(proof);
  const proofBundleMatches =
    !staleProofForRoute &&
    result.manifestHashMatches === true &&
    result.imageHashMatches === true &&
    result.proofIdMatches === true &&
    result.evidenceCommitmentsMatch === true &&
    result.proofLevelMatches === true &&
    result.proofRecordMatches === true &&
    result.registryProgramMatches === true;
  const isProductionVerified =
    result.status === "verified" &&
    proofBundleMatches &&
    result.authorizedRelayerMatches === true &&
    isArgusProductionProof(proof);
  const proofLevel = proof?.proofRecord?.proofLevel ?? proof?.proofLevel ?? proof?.integrityLevel;
  const isDemoVerified =
    result.status === "demo_verified" &&
    proofBundleMatches &&
    result.authorizedRelayerMatches === false &&
    isDemoProof;
  const isDemoPreview = isDemoVerified;
  // kr: proofId 없이 열린 verifier는 실패가 아니라 아직 확인할 proof가 없는 pending 상태입니다.
  // en: A verifier opened without a proofId is pending, not a failed proof check.
  const isPendingProofRequest =
    staleProofForRoute || initialLookupIsPending || (!hasProofRequest && result.status === "missing");
  // kr: proofId는 있지만 bundle이 없으면 mismatch가 아니라 unavailable 상태로 표시합니다.
  // en: When a proofId exists but no bundle returns, show unavailable rather than mismatch wording.
  const isMissingProofRequest =
    hasProofRequest && !isPendingProofRequest && result.status === "missing" && !proof;
  // kr: failed/missing 결과는 claim 필드를 scrub하므로 빈 표를 claimed data처럼 표시하지 않습니다.
  // en: Failed/missing results scrub claim fields, so the empty table is not labeled as claimed data.
  const proofFieldsAreUnavailable = !isPendingProofRequest && !proof;
  // kr: 빈 proof 필드는 verifier 상태에 맞춘 placeholder를 써서 pending/unavailable 화면이 claim처럼 보이지 않게 합니다.
  // en: Empty proof fields use verifier-state placeholders so pending/unavailable screens do not look like proof claims.
  const emptyProofFieldValue = isPendingProofRequest
    ? "pending"
    : proofFieldsAreUnavailable
      ? "unavailable"
      : "missing";
  const hasVerifiedEvidence = isProductionVerified || isDemoVerified;
  const unverifiedMessage =
    result.message ?? "The verifier could not match the proof bundle to the required Argus trust-root checks.";
  const statusMarkStyle = isProductionVerified
    ? styles.statusMarkVerified
    : isDemoVerified
      ? styles.statusMarkDemo
      : isPendingProofRequest || isMissingProofRequest
        ? styles.statusMarkPending
        : styles.statusMarkFailed;
  const statusMarkText = isProductionVerified
    ? "OK"
    : isDemoVerified
      ? "DEMO"
      : isPendingProofRequest
        ? "..."
        : isMissingProofRequest
          ? "N/A"
          : "!";

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.brand}>Argus Verify</Text>
          <Text style={styles.headerLink}>Demo example</Text>
        </View>

        <View style={styles.statusPanel}>
          <View style={statusMarkStyle}>
            <Text style={styles.statusMarkText}>{statusMarkText}</Text>
          </View>
          <View style={styles.statusCopyBlock}>
            <Text style={styles.eyebrow}>Capture verification report</Text>
            <Text style={styles.statusTitle}>
              {isProductionVerified
                ? "Verified Capture"
                : isDemoVerified
                  ? "Local Demo Preview Bundle Matched"
                  : isPendingProofRequest
                    ? "Proof pending"
                    : isMissingProofRequest
                      ? "Proof not found"
                    : "Proof not verified"}
            </Text>
            <Text style={styles.statusCopy}>
              {isProductionVerified
                ? "The photo, manifest, production-pinned Argus Registry program, trusted registry configuration, authorized production relayer fee payer, sponsored gas, partner/use-case/app identity policy, and committed device-evidence policy all match."
                : isDemoVerified
                  ? "This local demo preview bundle matches simulated proof data. It is unauthorized, superseded, unsponsored, and not a production Argus Registry record."
                  : isPendingProofRequest
                    ? "Open a verifier link with a proof ID to check the proof bundle against Argus commitments."
                    : isMissingProofRequest
                      ? "No proof bundle was found for this proof ID. No proof claims are displayed."
                    : `Not verified: ${unverifiedMessage}`}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {isProductionVerified
              ? "Registry commitment"
              : isDemoPreview
                ? "Local demo preview bundle"
                : isPendingProofRequest
                  ? "Proof fields pending"
                  : proofFieldsAreUnavailable
                    ? "Proof fields unavailable"
                  : "Unverified proof claims"}
          </Text>
          <HashRow
            label={
              isProductionVerified
                ? "Proof ID"
                : isDemoPreview
                  ? "Local demo preview proof ID"
                  : isPendingProofRequest
                    ? "Proof ID"
                    : proofFieldsAreUnavailable
                      ? "Proof ID"
                    : "Claimed proof ID"
            }
            value={proof?.proofId}
            emptyValue={emptyProofFieldValue}
          />
          <HashRow
            label={
              isProductionVerified
                ? "Manifest hash"
                : isDemoPreview
                  ? "Preview manifest hash"
                  : isPendingProofRequest
                    ? "Manifest hash"
                    : proofFieldsAreUnavailable
                      ? "Manifest hash"
                    : "Claimed manifest hash"
            }
            value={proof?.manifestHash}
            emptyValue={emptyProofFieldValue}
          />
          <HashRow
            label={
              isProductionVerified
                ? "Image hash commitment"
                : isDemoPreview
                  ? "Preview image hash commitment"
                  : isPendingProofRequest
                    ? "Image hash commitment"
                    : proofFieldsAreUnavailable
                      ? "Image hash commitment"
                    : "Claimed image hash commitment"
            }
            value={proof?.imageHash}
            emptyValue={emptyProofFieldValue}
          />
          <HashRow
            label={
              isProductionVerified
                ? "Reported transaction reference"
                : isDemoPreview
                  ? "Simulated preview transaction reference"
                : isPendingProofRequest
                    ? "Transaction reference"
                    : proofFieldsAreUnavailable
                      ? "Transaction reference"
                    : "Claimed transaction reference"
            }
            value={proof?.solanaTx}
            emptyValue={emptyProofFieldValue}
          />
          <HashRow
            label={
              isProductionVerified
                ? "Registry address"
                : isDemoPreview
                  ? "Expected preview registry address"
                  : isPendingProofRequest
                    ? "Registry address"
                    : proofFieldsAreUnavailable
                      ? "Registry address"
                    : "Claimed registry address"
            }
            value={proof?.registryAddress}
            emptyValue={emptyProofFieldValue}
          />
          <HashRow
            label={
              isProductionVerified
                ? "Registry program"
                : isDemoPreview
                  ? "Expected preview registry program"
                  : isPendingProofRequest
                    ? "Registry program"
                    : proofFieldsAreUnavailable
                      ? "Registry program"
                    : "Claimed registry program"
            }
            value={proof?.registryProgramId ?? proof?.proofRecord?.registryProgramId}
            emptyValue={emptyProofFieldValue}
          />
          <HashRow
            label={
              isProductionVerified
                ? "Authorized relayer"
                : isDemoPreview
                  ? "Demo preview relayer fixture"
                  : isPendingProofRequest
                    ? "Relayer"
                    : proofFieldsAreUnavailable
                      ? "Relayer"
                    : "Claimed relayer"
            }
            value={proof?.relayer ?? proof?.proofRecord?.relayer}
            emptyValue={emptyProofFieldValue}
          />
          <HashRow
            label={
              isProductionVerified
                ? "Evidence level"
                : isDemoPreview
                  ? "Preview evidence level"
                  : isPendingProofRequest
                    ? "Evidence level"
                    : proofFieldsAreUnavailable
                      ? "Evidence level"
                    : "Claimed evidence level"
            }
            value={evidenceLevelLabel ?? proofLevel}
            emptyValue={emptyProofFieldValue}
          />
          <HashRow
            label={
              isProductionVerified
                ? "Record status"
                : isDemoPreview
                  ? "Local preview fixture status"
                  : isPendingProofRequest
                    ? "Record status"
                    : proofFieldsAreUnavailable
                      ? "Record status"
                    : "Claimed record status"
            }
            value={proof?.proofRecord?.status}
            emptyValue={emptyProofFieldValue}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Capture evidence summary</Text>
          <EvidencePill label="Camera evidence" ready={Boolean(hasVerifiedEvidence && proof?.deviceEvidenceSummary?.cameraMetadata)} />
          <EvidencePill label="Motion snapshot" ready={Boolean(hasVerifiedEvidence && proof?.deviceEvidenceSummary?.motionSnapshot)} />
          <EvidencePill label="App identity hash" ready={Boolean(hasVerifiedEvidence && proof?.deviceEvidenceSummary?.appIdentityHash)} />
          <EvidencePill label="Public key evidence" ready={Boolean(hasVerifiedEvidence && hasArgusPublicKeyCertificateEvidence(proof))} />
          <EvidencePill label="Trusted device attestation (Level 4)" ready={Boolean(hasVerifiedEvidence && evidenceLevel === "level_4_hardware_attestation")} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Proof boundary</Text>
          <Text style={styles.boundaryHeading}>Production Argus verifies</Text>
          <Text style={styles.boundaryText}>- Photo bytes pass the structural JPEG-like byte gate and match the manifest image commitment.</Text>
          <Text style={styles.boundaryText}>- Canonical manifest hash matches a production-pinned Argus Registry commitment.</Text>
          <Text style={styles.boundaryText}>- Active registry record matches trusted registry configuration, authorized production relayer fee payer, sponsored gas, and fee-payer binding.</Text>
          <Text style={styles.boundaryText}>- Partner/use-case/app identity policy, committed device-evidence policy, and active status are acceptable for capture-provenance verification.</Text>
          <Text style={styles.boundaryText}>- Level 3 requires validated Keystore public key/signature evidence. Level 4 requires trusted-root hardware attestation; otherwise show Level 3/2 fallback.</Text>
          <Text style={styles.boundaryText}>- Device-side evidence was committed without raw image storage on-chain.</Text>

          <Text style={styles.boundaryHeading}>Argus does not verify</Text>
          <Text style={styles.boundaryText}>- Physical scene truth.</Text>
          <Text style={styles.boundaryText}>- Ownership, condition, or legal validity of the submitted subject.</Text>
          <Text style={styles.boundaryText}>- Image forensics or AI detection for images submitted outside Argus capture.</Text>
          <Text style={styles.boundaryText}>- Whether the camera photographed a screen.</Text>
          <Text style={styles.boundaryText}>- Complete prevention of rooted, emulated, or mock-camera environments.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// kr: HashRow는 proof ID, manifest hash 같은 긴 값과 상태별 빈 값 placeholder를 표시합니다.
// en: HashRow displays long proof values and a verifier-state placeholder when a value is unavailable.
export function HashRow({
  label,
  value,
  emptyValue = "missing",
}: {
  label: string;
  value?: string;
  emptyValue?: string;
}) {
  return (
    <View style={styles.hashRow}>
      <Text style={styles.hashLabel}>{label}</Text>
      <Text style={styles.hashValue}>{value ?? emptyValue}</Text>
    </View>
  );
}

// kr: EvidencePill은 verifier가 확인한 evidence 항목의 present/pending 상태를 보여줍니다.
// en: EvidencePill shows the present/pending state for each evidence item checked by the verifier.
export function EvidencePill({ label, ready }: { label: string; ready: boolean }) {
  return (
    <View style={ready ? styles.evidenceReady : styles.evidenceMuted}>
      <Text style={ready ? styles.evidenceReadyText : styles.evidenceMutedText}>
        {label}: {ready ? "present" : "pending"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "#f6f8fb",
    flex: 1,
  },
  screen: {
    gap: 16,
    padding: 18,
  },
  header: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderBottomColor: "#d9dee7",
    borderBottomWidth: 1,
    flexDirection: "row",
    paddingBottom: 12,
  },
  brand: {
    color: "#111827",
    flex: 1,
    fontSize: 24,
    fontWeight: "800",
  },
  headerLink: {
    color: "#2558d4",
    fontSize: 14,
    fontWeight: "800",
  },
  statusPanel: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#d9dee7",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    padding: 18,
  },
  statusMarkVerified: {
    alignItems: "center",
    backgroundColor: "#0f7b5f",
    borderRadius: 8,
    height: 62,
    justifyContent: "center",
    width: 62,
  },
  statusMarkDemo: {
    alignItems: "center",
    backgroundColor: "#6b7280",
    borderRadius: 8,
    height: 62,
    justifyContent: "center",
    width: 62,
  },
  statusMarkPending: {
    alignItems: "center",
    backgroundColor: "#6b7280",
    borderRadius: 8,
    height: 62,
    justifyContent: "center",
    width: 62,
  },
  statusMarkFailed: {
    alignItems: "center",
    backgroundColor: "#c83f36",
    borderRadius: 8,
    height: 62,
    justifyContent: "center",
    width: 62,
  },
  statusMarkText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
  },
  statusCopyBlock: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    color: "#667085",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  statusTitle: {
    color: "#111827",
    fontSize: 27,
    fontWeight: "800",
  },
  statusCopy: {
    color: "#667085",
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#d9dee7",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  cardTitle: {
    color: "#111827",
    fontSize: 18,
    fontWeight: "800",
  },
  hashRow: {
    borderTopColor: "#d9dee7",
    borderTopWidth: 1,
    gap: 4,
    paddingTop: 9,
  },
  hashLabel: {
    color: "#667085",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  hashValue: {
    color: "#111827",
    fontFamily: "monospace",
    fontSize: 13,
  },
  evidenceReady: {
    backgroundColor: "#e3f7ef",
    borderColor: "#9ad9c1",
    borderRadius: 6,
    borderWidth: 1,
    padding: 12,
  },
  evidenceMuted: {
    backgroundColor: "#edf0f4",
    borderColor: "#d9dee7",
    borderRadius: 6,
    borderWidth: 1,
    padding: 12,
  },
  evidenceReadyText: {
    color: "#075c46",
    fontWeight: "800",
  },
  evidenceMutedText: {
    color: "#596273",
    fontWeight: "800",
  },
  boundaryHeading: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 6,
  },
  boundaryText: {
    color: "#374151",
    fontSize: 14,
    lineHeight: 21,
  },
});
