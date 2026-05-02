import React, { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  ArgusBadge,
  ArgusCamera,
  ArgusProofLink,
  ArgusProofSummary,
  ARGUS_LOCAL_DEMO_RELAYER,
  configure,
  getArgusEvidenceLevel,
  getArgusEvidenceLevelLabel,
  hasArgusPublicKeyCertificateEvidence,
  isArgusLocalDemoProof,
  isArgusProductionProof,
  type ArgusProof,
} from "../../../packages/argus-rn-sdk/src";
import { captureProof, listing } from "./data/listing";
import { createMarketplaceSimulatorProof } from "./demoProof";

// kr: MarketplaceDemoApp은 production badge, local demo preview, simulator fallback을 분리해 보여주는 RN marketplace 데모입니다.
// en: MarketplaceDemoApp separates production badge, local demo preview, and simulator fallback states in the RN marketplace demo.
export default function MarketplaceDemoApp() {
  const [proof, setProof] = useState<ArgusProof | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isSimulatorFallback, setIsSimulatorFallback] = useState(false);
  const isProductionProof = isArgusProductionProof(proof);
  const isLocalOnlyProof = isArgusLocalDemoProof(proof);
  const isSimulatorPreview = isMarketplaceSimulatorPreviewProof(proof, isSimulatorFallback);
  const hasVerifiedOrPreviewProof = isProductionProof || isLocalOnlyProof || isSimulatorPreview;

  useEffect(() => {
    configure({
      partnerId: "recommerce-demo",
      relayerUrl: "mock://argus-relayer",
      verifierBaseUrl: "https://verify.argus.dev",
    });
  }, []);

  // kr: handleNativeError는 native camera module이 없을 때 simulator preview만 만들고 production badge로 승격하지 않습니다.
  // en: handleNativeError creates only a simulator preview when the native camera module is unavailable; it never earns the production badge.
  function handleNativeError(error: Error) {
    const simulatorProof = createMarketplaceSimulatorProof();
    setProof(simulatorProof);
    setIsSimulatorFallback(true);
    setLastError(`Local simulator preview only: ${error.message}`);
  }

  function handleProofCreated(createdProof: ArgusProof) {
    setProof(createdProof);
    setIsSimulatorFallback(false);
    setLastError(null);
  }

  // kr: handleOpenVerifier는 RN demo에서 verifier deep link를 확인할 수 있게 표시합니다.
  // en: handleOpenVerifier displays the verifier deep link in the RN demo.
  function handleOpenVerifier(url: string) {
    Alert.alert("Argus verifier", url);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.brand}>re:market</Text>
          <Text style={styles.headerLink}>Sell</Text>
          <Text style={styles.headerLink}>Watchlist</Text>
          <Text style={styles.headerLink}>Cart</Text>
        </View>

        <View style={styles.searchBar}>
          <Text style={styles.categoryText}>All Categories</Text>
          <Text style={styles.searchText}>vintage camera capture verification</Text>
          <Text style={styles.searchButton}>Search</Text>
        </View>

        <View style={styles.categoryStrip}>
          {["Saved", "Electronics", "Cameras", "Sneakers", "Luxury", "Local pickup"].map(
            (category) => (
              <Text key={category} style={styles.categoryLink}>
                {category}
              </Text>
            ),
          )}
        </View>

        <View style={styles.photoStage}>
          <View style={styles.cameraBody}>
            <View style={styles.cameraTop} />
            <View style={styles.cameraLensOuter}>
              <View style={styles.cameraLensInner} />
            </View>
          </View>
          <View style={styles.photoBadge}>
            <ArgusBadge proof={proof} />
          </View>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.eyebrow}>Pre-owned - Local seller - Ships from {listing.seller.location}</Text>
          <Text style={styles.title}>{listing.title}</Text>
          <View style={styles.badgeRow}>
            <Text style={styles.conditionPill}>{listing.condition}</Text>
            <Text style={isProductionProof ? styles.verifiedPill : styles.pendingPill}>
              {isProductionProof
                ? "Verified Capture"
                : isLocalOnlyProof
                  ? "Local Demo Preview"
                  : isSimulatorPreview
                    ? "Simulator Preview"
                    : "Capture proof pending"}
            </Text>
          </View>
          <Text style={styles.price}>{listing.price}</Text>
          <Text style={styles.shipping}>or Best Offer - Free 3 day shipping</Text>
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.primaryAction}>
            <Text style={styles.primaryActionText}>Buy It Now</Text>
          </Pressable>
          <Pressable style={styles.secondaryAction}>
            <Text style={styles.secondaryActionText}>Add to cart</Text>
          </Pressable>
          <Pressable style={styles.secondaryAction}>
            <Text style={styles.secondaryActionText}>Make offer</Text>
          </Pressable>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Listing photo provenance</Text>
          <Text style={styles.panelCopy}>Example capture-provenance flow for a marketplace listing photo.</Text>
          <ArgusCamera
            partnerId="recommerce-demo"
            useCase="marketplace_listing"
            metadata={{
              condition: listing.condition,
              listingId: listing.id,
              title: listing.title,
            }}
            onProofCreated={handleProofCreated}
            onError={handleNativeError}
          />
          {lastError ? <Text style={styles.fallbackNote}>{lastError}</Text> : null}
          {/* kr: Simulator fallback은 marketplace 전용 downgraded checks로 설명하고, generic SDK summary의 claimed 라벨과 섞지 않습니다. */}
          {/* en: Simulator fallback is explained by marketplace-specific downgraded checks, so do not mix in the generic SDK summary's claimed labels. */}
          {isSimulatorPreview ? null : <ArgusProofSummary proof={proof} />}
          <CaptureProofDetails proof={proof} isSimulatorPreview={isSimulatorPreview} />
          <View style={styles.verifierButton}>
            <ArgusProofLink proof={proof} onOpen={handleOpenVerifier} />
          </View>
        </View>

        <View style={styles.sellerPanel}>
          <Text style={styles.panelTitle}>Seller information</Text>
          <Text style={styles.sellerName}>{listing.seller.name}</Text>
          <Text style={styles.shipping}>
            {listing.seller.positiveRate} - {listing.seller.score}
          </Text>
          <View style={styles.sellerMeter}>
            <View style={styles.sellerMeterFill} />
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Proof status</Text>
          <EvidenceLine
            label={
              isLocalOnlyProof || isSimulatorPreview
                ? "Simulated camera evidence commitment"
                : "Camera evidence commitment"
            }
            isReady={Boolean(hasVerifiedOrPreviewProof && proof?.deviceEvidenceSummary?.cameraMetadata)}
          />
          <EvidenceLine
            label={isLocalOnlyProof || isSimulatorPreview ? "Simulated motion snapshot" : "Motion snapshot"}
            isReady={Boolean(hasVerifiedOrPreviewProof && proof?.deviceEvidenceSummary?.motionSnapshot)}
          />
          <EvidenceLine
            label={isLocalOnlyProof || isSimulatorPreview ? "Simulated app identity hash" : "App identity hash"}
            isReady={Boolean(hasVerifiedOrPreviewProof && proof?.deviceEvidenceSummary?.appIdentityHash)}
          />
          <EvidenceLine
            label={
              isLocalOnlyProof || isSimulatorPreview
                ? "Public key evidence (not present in local preview)"
                : "Public key evidence (Level 3)"
            }
            isReady={Boolean(isProductionProof && hasArgusPublicKeyCertificateEvidence(proof))}
          />
          <EvidenceLine
            label={
              isLocalOnlyProof || isSimulatorPreview
                ? "Trusted device attestation (Level 4, not in local preview)"
                : "Trusted device attestation (Level 4)"
            }
            isReady={Boolean(isProductionProof && getArgusEvidenceLevel(proof) === "level_4_hardware_attestation")}
          />
          <EvidenceLine
            label={
              isLocalOnlyProof || isSimulatorPreview
                ? "Authorized relayer registration (not present in local preview)"
                : "Authorized fee payer + sponsored gas (production relayer + pinned registry)"
            }
            isReady={Boolean(isProductionProof && proof?.proofRecord?.relayerAuthorized)}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// kr: CaptureProofDetails는 pending, production, preview, unverified claim 라벨을 나눠 buyer가 proof 상태를 오해하지 않게 합니다.
// en: CaptureProofDetails separates pending, production, preview, and unverified-claim labels so buyers do not overread proof state.
export function CaptureProofDetails({
  proof,
  isSimulatorPreview = false,
}: {
  proof: ArgusProof | null;
  isSimulatorPreview?: boolean;
}) {
  const manifestHash = proof?.manifestHash ?? captureProof.manifestHash;
  const solanaTx = proof?.solanaTx ?? captureProof.solanaTx;
  const isProductionProof = isArgusProductionProof(proof);
  const isLocalDemoProof = isArgusLocalDemoProof(proof);
  const isTrustedSimulatorPreview = isMarketplaceSimulatorPreviewProof(proof, isSimulatorPreview);
  const displayedProofLevel = proof?.proofRecord?.proofLevel ?? proof?.proofLevel;
  const evidenceLevelLabel = getArgusEvidenceLevelLabel(proof);
  const displayedEvidenceLevel = evidenceLevelLabel ?? displayedProofLevel;
  // kr: proof가 없을 때는 failed claim이 아니라 capture 대기 상태입니다.
  // en: A missing proof is waiting for capture, not a failed or unverified claim.
  const isPendingProof = !proof;
  const isTrustedOrPreviewProof = isProductionProof || isLocalDemoProof || isTrustedSimulatorPreview;
  const evidenceStatus = proof
    ? isProductionProof
      ? "OK"
      : isLocalDemoProof
        ? "Local preview"
        : isTrustedSimulatorPreview
          ? "Simulator preview"
        : "Unverified"
    : "Pending";
  const proofIdLabel = isLocalDemoProof
    ? "Local demo preview proof ID"
    : isTrustedSimulatorPreview
      ? "Simulator preview proof ID"
      : isProductionProof
        ? "Proof ID"
        : isPendingProof
          ? "Proof ID"
        : "Claimed proof ID";
  const transactionLabel = isProductionProof
    ? "Reported transaction reference"
    : isLocalDemoProof
      ? "Simulated preview transaction reference"
      : isTrustedSimulatorPreview
        ? "Simulator preview transaction reference"
        : isPendingProof
          ? "Transaction reference"
        : "Claimed transaction reference";
  const manifestHashLabel = isProductionProof
    ? "Manifest hash"
    : isLocalDemoProof || isTrustedSimulatorPreview
      ? "Preview manifest hash"
      : isPendingProof
        ? "Manifest hash"
      : "Claimed manifest hash";
  const proofLevelLabel = isProductionProof
    ? "Evidence level"
    : isLocalDemoProof || isTrustedSimulatorPreview
      ? "Preview evidence level"
      : isPendingProof
        ? "Evidence level"
      : "Claimed evidence level";

  return (
    <View style={styles.detailsPanel}>
      <ProofDetail label={proofIdLabel} value={proof?.proofId ?? "Waiting for capture proof"} />
      <ProofDetail
        label={manifestHashLabel}
        value={proof ? shortenHash(manifestHash) : "Waiting for capture"}
      />
      <ProofDetail
        label={transactionLabel}
        value={proof ? shortenHash(solanaTx) : "Waiting for registration"}
      />
      <ProofDetail
        label={proofLevelLabel}
        value={
          isTrustedOrPreviewProof
            ? displayedEvidenceLevel ?? "Waiting for policy check"
            : displayedEvidenceLevel
              ? `${displayedEvidenceLevel} (not verified)`
              : "Waiting for policy check"
        }
      />

      <Text style={styles.detailHeading}>Evidence summary</Text>
      {captureProof.evidence.map((item) => (
        <Text key={item} style={styles.evidenceLine}>
          {evidenceStatus} - {item}
        </Text>
      ))}

      <Text style={styles.detailHeading}>Proof limitations</Text>
      {captureProof.limitations.map((item) => (
        <Text key={item} style={styles.limitLine}>
          - {item}
        </Text>
      ))}
    </View>
  );
}

// kr: ProofDetail은 긴 proof 값을 작은 모바일 행으로 나누어 표시합니다.
// en: ProofDetail splits long proof values into small mobile rows.
export function ProofDetail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.proofDetail}>
      <Text style={styles.proofLabel}>{label}</Text>
      <Text style={styles.proofValue}>{value}</Text>
    </View>
  );
}

// kr: simulator preview 라벨도 downgraded local relayer/fee payer가 명시된 fallback proof에만 붙입니다.
// en: Simulator preview labels are allowed only for fallback proofs that explicitly carry downgraded local relayer/fee-payer fields.
function isMarketplaceSimulatorPreviewProof(proof: ArgusProof | null, isSimulatorPreview: boolean): boolean {
  return Boolean(
    isSimulatorPreview &&
      proof &&
      !isArgusProductionProof(proof) &&
      !isArgusLocalDemoProof(proof) &&
      proof.proofLevel === "demo" &&
      proof.relayer === ARGUS_LOCAL_DEMO_RELAYER &&
      proof.feePayer === ARGUS_LOCAL_DEMO_RELAYER &&
      proof.sponsoredGas === false &&
      proof.proofRecord?.proofLevel === "demo" &&
      proof.proofRecord?.status === "revoked" &&
      proof.proofRecord?.relayer === ARGUS_LOCAL_DEMO_RELAYER &&
      proof.proofRecord?.relayerAuthorized === false,
  );
}

// kr: EvidenceLine은 각 proof evidence의 준비 상태를 한 줄로 표시합니다.
// en: EvidenceLine displays each proof evidence readiness state in one row.
function EvidenceLine({ label, isReady }: { label: string; isReady: boolean }) {
  return (
    <Text style={styles.evidenceLine}>
      {label}: {isReady ? "captured" : "pending"}
    </Text>
  );
}

// kr: shortenHash는 긴 hash와 transaction을 listing 화면에서 읽기 쉽게 줄입니다.
// en: shortenHash shortens long hashes and transactions for the listing screen.
export function shortenHash(value: string) {
  if (value.length <= 24) {
    return value;
  }

  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "#ffffff",
    flex: 1,
  },
  screen: {
    gap: 16,
    padding: 18,
  },
  header: {
    alignItems: "center",
    borderBottomColor: "#d6dbe2",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 14,
    paddingBottom: 12,
  },
  brand: {
    color: "#111827",
    flex: 1,
    fontSize: 25,
    fontWeight: "800",
  },
  headerLink: {
    color: "#5f6875",
    fontSize: 14,
    fontWeight: "600",
  },
  searchBar: {
    borderColor: "#111827",
    borderWidth: 2,
    flexDirection: "row",
    minHeight: 46,
  },
  categoryText: {
    backgroundColor: "#f8fafc",
    borderRightColor: "#d6dbe2",
    borderRightWidth: 1,
    color: "#374151",
    padding: 12,
    width: 122,
  },
  searchText: {
    color: "#111827",
    flex: 1,
    padding: 12,
  },
  searchButton: {
    backgroundColor: "#2558d4",
    color: "#ffffff",
    fontWeight: "800",
    padding: 12,
  },
  categoryStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  categoryLink: {
    color: "#374151",
    fontSize: 14,
  },
  photoStage: {
    alignItems: "center",
    aspectRatio: 4 / 3,
    backgroundColor: "#f4f5f7",
    borderColor: "#d6dbe2",
    borderWidth: 1,
    justifyContent: "center",
    position: "relative",
  },
  cameraBody: {
    alignItems: "center",
    backgroundColor: "#2f343b",
    borderRadius: 16,
    height: 170,
    justifyContent: "center",
    width: 250,
  },
  cameraTop: {
    backgroundColor: "#58606b",
    borderRadius: 8,
    height: 34,
    position: "absolute",
    right: 34,
    top: 20,
    width: 70,
  },
  cameraLensOuter: {
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 62,
    height: 124,
    justifyContent: "center",
    width: 124,
  },
  cameraLensInner: {
    backgroundColor: "#4f697d",
    borderRadius: 38,
    height: 76,
    width: 76,
  },
  photoBadge: {
    bottom: 14,
    left: 14,
    position: "absolute",
  },
  titleBlock: {
    gap: 8,
  },
  eyebrow: {
    color: "#5f6875",
    fontSize: 14,
  },
  title: {
    color: "#111827",
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 31,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  conditionPill: {
    backgroundColor: "#fff4c2",
    borderRadius: 4,
    color: "#6c5000",
    fontSize: 13,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  verifiedPill: {
    backgroundColor: "#dff7ef",
    borderRadius: 4,
    color: "#075c46",
    fontSize: 13,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pendingPill: {
    backgroundColor: "#edf0f4",
    borderRadius: 4,
    color: "#596273",
    fontSize: 13,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  price: {
    color: "#111827",
    fontSize: 31,
    fontWeight: "800",
    marginTop: 8,
  },
  shipping: {
    color: "#5f6875",
    fontSize: 15,
  },
  actionRow: {
    gap: 10,
  },
  primaryAction: {
    alignItems: "center",
    backgroundColor: "#2558d4",
    borderRadius: 4,
    minHeight: 44,
    justifyContent: "center",
  },
  primaryActionText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
  secondaryAction: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#2558d4",
    borderRadius: 4,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  secondaryActionText: {
    color: "#2558d4",
    fontSize: 16,
    fontWeight: "800",
  },
  panel: {
    backgroundColor: "#f9fbff",
    borderColor: "#d6dbe2",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  panelTitle: {
    color: "#111827",
    fontSize: 17,
    fontWeight: "800",
  },
  panelCopy: {
    color: "#5f6875",
    fontSize: 14,
  },
  fallbackNote: {
    color: "#8a4b00",
    fontSize: 12,
  },
  verifierButton: {
    alignItems: "flex-start",
  },
  detailsPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#d6dbe2",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  proofDetail: {
    borderBottomColor: "#edf0f4",
    borderBottomWidth: 1,
    gap: 3,
    paddingBottom: 8,
  },
  proofLabel: {
    color: "#5f6875",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  proofValue: {
    color: "#111827",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  detailHeading: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "800",
    marginTop: 4,
  },
  sellerPanel: {
    borderColor: "#d6dbe2",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  sellerName: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "800",
  },
  sellerMeter: {
    backgroundColor: "#edf0f4",
    borderRadius: 4,
    height: 8,
    overflow: "hidden",
  },
  sellerMeterFill: {
    backgroundColor: "#0f7b5f",
    height: 8,
    width: "92%",
  },
  evidenceLine: {
    color: "#374151",
    fontSize: 14,
    lineHeight: 22,
  },
  limitLine: {
    color: "#5f6875",
    fontSize: 14,
    lineHeight: 22,
  },
});
