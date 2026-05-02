import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
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
  registerProofWithRelayer,
  type ArgusProof,
} from "../../../packages/argus-rn-sdk/src";
import {
  ARGUS_DEMO_BACKEND_URL,
  ARGUS_DEMO_PARTNER_ID,
  ARGUS_DEMO_USE_CASE,
} from "../../shared/argusDemoConfig";
import { captureProof, listing } from "./data/listing";
import { createMarketplaceSimulatorProof } from "./demoProof";
import {
  buildListingDraft,
  loadLocalListingDraft,
  saveLocalListingDraft,
  type ListingBackendStatus,
  type LocalListingDraft,
} from "./localListingStore";

type TabId = "home" | "myEbay" | "search" | "inbox" | "selling";
type UploadSource = "argus_camera" | "local_upload";

const bottomTabs: Array<{ id: TabId; label: string; icon: string }> = [
  { id: "home", label: "Home", icon: "H" },
  { id: "myEbay", label: "My eBay", icon: "Me" },
  { id: "search", label: "Search", icon: "S" },
  { id: "inbox", label: "Inbox", icon: "In" },
  { id: "selling", label: "Selling", icon: "$" },
];

export default function MarketplaceDemoApp() {
  const [draft, setDraft] = useState<LocalListingDraft | null>(() => loadLocalListingDraft());
  const [proof, setProof] = useState<ArgusProof | null>(() => draft?.proof ?? null);
  const [activeTab, setActiveTab] = useState<TabId>("selling");
  const [lastError, setLastError] = useState<string | null>(draft?.backendMessage ?? null);
  const [backendStatus, setBackendStatus] = useState<ListingBackendStatus>(
    () => draft?.backendStatus ?? "pending",
  );
  const [isRegistering, setIsRegistering] = useState(false);
  const [isSimulatorFallback, setIsSimulatorFallback] = useState(
    () => draft?.uploadSource === "local_upload" && draft.backendStatus === "local_only",
  );

  const isProductionProof = isArgusProductionProof(proof);
  const isLocalOnlyProof = isArgusLocalDemoProof(proof);
  const isSimulatorPreview = isMarketplaceSimulatorPreviewProof(proof, isSimulatorFallback);
  const hasVerifiedOrPreviewProof = isProductionProof || isLocalOnlyProof || isSimulatorPreview;
  const photoUri = draft?.photoUri ?? listing.photoUrl;
  const listingStatus =
    isProductionProof || isLocalOnlyProof
      ? "ARGUS checked"
      : isSimulatorPreview
        ? "Local photo saved"
        : "Capture proof pending";

  useEffect(() => {
    configure({
      partnerId: ARGUS_DEMO_PARTNER_ID,
      relayerUrl: ARGUS_DEMO_BACKEND_URL,
      verifierBaseUrl: ARGUS_DEMO_BACKEND_URL,
    });
  }, []);

  function handleNativeError(error: Error) {
    const simulatorProof = createMarketplaceSimulatorProof();
    persistDraft(simulatorProof, {
      backendMessage: `Local photo and JSON saved. Native CameraX was unavailable here: ${error.message}`,
      backendStatus: "local_only",
      uploadSource: "local_upload",
    });
    setIsSimulatorFallback(true);
  }

  function handleProofCreated(createdProof: ArgusProof) {
    void persistAndRegisterProof(createdProof);
  }

  function handleUploadLocalPhoto() {
    const simulatorProof = createMarketplaceSimulatorProof();
    persistDraft(simulatorProof, {
      backendMessage:
        "Local demo photo and JSON saved on device. Use the Argus camera button on Android for production evidence.",
      backendStatus: "local_only",
      uploadSource: "local_upload",
    });
    setIsSimulatorFallback(true);
  }

  async function persistAndRegisterProof(createdProof: ArgusProof) {
    setIsSimulatorFallback(false);
    persistDraft(createdProof, {
      backendMessage: "Saved locally. Contacting Argus backend for proof-bundle registration.",
      backendStatus: "registering",
      uploadSource: "argus_camera",
    });

    setIsRegistering(true);
    try {
      const registration = await registerProofWithRelayer(
        {
          partnerId: ARGUS_DEMO_PARTNER_ID,
          relayerUrl: ARGUS_DEMO_BACKEND_URL,
          verifierBaseUrl: ARGUS_DEMO_BACKEND_URL,
        },
        createdProof,
      );
      const registeredProof = { ...createdProof, ...registration };
      persistDraft(registeredProof, {
        backendMessage:
          "Backend accepted the proof bundle. Production status still requires an authorized production relayer fee payer and sponsored gas.",
        backendStatus: "registered",
        uploadSource: "argus_camera",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Backend registration failed";
      persistDraft(createdProof, {
        backendMessage: `Saved locally; backend registration is pending. ${message}`,
        backendStatus: "local_only",
        uploadSource: "argus_camera",
      });
    } finally {
      setIsRegistering(false);
    }
  }

  function persistDraft(
    nextProof: ArgusProof,
    options: {
      backendMessage: string;
      backendStatus: ListingBackendStatus;
      uploadSource: UploadSource;
    },
  ) {
    const nextDraft = saveLocalListingDraft(
      buildListingDraft({
        backendMessage: options.backendMessage,
        backendStatus: options.backendStatus,
        listing,
        proof: nextProof,
        uploadSource: options.uploadSource,
      }),
    );
    setDraft(nextDraft);
    setProof(nextProof);
    setBackendStatus(options.backendStatus);
    setLastError(options.backendMessage);
  }

  function handleOpenVerifier(url: string) {
    Alert.alert("Argus verifier", url);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.appShell}>
        <ScrollView contentContainerStyle={styles.screen} style={styles.scrollView}>
          <View style={styles.topBar}>
            <Text style={styles.brand}>
              <Text style={styles.ebayRed}>e</Text>
              <Text style={styles.ebayBlue}>b</Text>
              <Text style={styles.ebayYellow}>a</Text>
              <Text style={styles.ebayGreen}>y</Text>
              <Text style={styles.argusWord}> argus</Text>
            </Text>
            <Text style={styles.cartButton}>Cart</Text>
          </View>

          <View style={styles.searchBar}>
            <Text style={styles.searchIcon}>S</Text>
            <Text style={styles.searchText}>Search on eBay</Text>
            <Text style={styles.cameraIcon}>Cam</Text>
          </View>

          <View style={styles.categoryStrip}>
            {["Saved", "Selling", "Deals", "Cameras", "Collectibles"].map((category) => (
              <Text key={category} style={styles.categoryLink}>
                {category}
              </Text>
            ))}
          </View>

          <View style={styles.sellingHero}>
            <Text style={styles.eyebrow}>Selling</Text>
            <Text style={styles.sellingHeroTitle}>List an item</Text>
            <Text style={styles.panelCopy}>
              Camera capture, local JSON save, backend proof registration, then a visible listing badge.
            </Text>
            <View style={styles.flowSteps}>
              <FlowStep index="1" title="Photo" copy={proof ? "Photo saved" : "Capture proof pending"} active />
              <FlowStep
                index="2"
                title="ARGUS check"
                copy={statusCopy(backendStatus, isRegistering)}
                active={backendStatus === "registering" || backendStatus === "registered"}
              />
              <FlowStep index="3" title="Ready to list" copy={listingStatus} active={hasVerifiedOrPreviewProof} />
            </View>
          </View>

          <View style={styles.photoStage}>
            <Image source={{ uri: photoUri }} style={styles.itemPhoto} resizeMode="cover" />
            <View style={styles.photoBadge}>
              <ArgusBadge proof={proof} />
            </View>
          </View>

          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>
              Pre-owned - Local seller - Ships from {listing.seller.location}
            </Text>
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
            <Text style={styles.shipping}>{listing.offerLabel} - {listing.shipping}</Text>
          </View>

          <View style={styles.actionRow}>
            <Pressable accessibilityRole="button" style={styles.primaryAction}>
              <Text style={styles.primaryActionText}>Buy It Now</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>Add to cart</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>Make offer</Text>
            </Pressable>
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Create listing photo</Text>
            <Text style={styles.panelCopy}>
              The SDK camera creates the proof bundle. The demo also saves the photo bytes and JSON locally so the
              listing can recover after refresh.
            </Text>
            <ArgusCamera
              partnerId={ARGUS_DEMO_PARTNER_ID}
              useCase={ARGUS_DEMO_USE_CASE}
              metadata={{
                condition: listing.condition,
                listingId: listing.id,
                title: listing.title,
              }}
              onProofCreated={handleProofCreated}
              onError={handleNativeError}
            />
            <Pressable accessibilityRole="button" onPress={handleUploadLocalPhoto} style={styles.uploadAction}>
              <Text style={styles.uploadActionText}>Upload local demo photo</Text>
            </Pressable>
            {lastError ? <Text style={styles.fallbackNote}>{lastError}</Text> : null}
            <Text style={styles.storageNote}>
              Local JSON: {draft ? "saved" : "waiting"} - Backend: {statusCopy(backendStatus, isRegistering)}
            </Text>
            {isSimulatorPreview ? null : <ArgusProofSummary proof={proof} />}
            <CaptureProofDetails proof={proof} isSimulatorPreview={isSimulatorPreview} />
            <View style={styles.verifierButton}>
              <ArgusProofLink proof={proof} onOpen={handleOpenVerifier} />
            </View>
          </View>

          <ListingPreview proof={proof} status={listingStatus} photoUri={photoUri} />
          <ProductPreview proof={proof} photoUri={photoUri} />

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
            <Text style={styles.panelCopy}>
              Production verified means native capture plus registry policy, authorized production relayer fee payer,
              and sponsored gas.
            </Text>
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
              isReady={Boolean(
                isProductionProof && getArgusEvidenceLevel(proof) === "level_4_hardware_attestation",
              )}
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

        <View style={styles.bottomNav}>
          {bottomTabs.map((tab) => (
            <Pressable
              accessibilityRole="tab"
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={activeTab === tab.id ? styles.bottomTabActive : styles.bottomTab}
            >
              <Text style={activeTab === tab.id ? styles.bottomIconActive : styles.bottomIcon}>{tab.icon}</Text>
              <Text style={activeTab === tab.id ? styles.bottomLabelActive : styles.bottomLabel}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

function FlowStep({
  active,
  copy,
  index,
  title,
}: {
  active?: boolean;
  copy: string;
  index: string;
  title: string;
}) {
  return (
    <View style={active ? styles.flowStepActive : styles.flowStep}>
      <Text style={styles.flowStepIndex}>{index}</Text>
      <Text style={styles.flowStepTitle}>{title}</Text>
      <Text style={styles.flowStepCopy}>{copy}</Text>
    </View>
  );
}

function ListingPreview({
  photoUri,
  proof,
  status,
}: {
  photoUri: string;
  proof: ArgusProof | null;
  status: string;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Listing preview</Text>
      <View style={styles.listingRow}>
        <Image source={{ uri: photoUri }} style={styles.listingThumb} resizeMode="cover" />
        <View style={styles.listingCopy}>
          <Text style={styles.listingTitle}>{listing.title}</Text>
          <Text style={styles.listingPrice}>{listing.price}</Text>
          <Text style={styles.shipping}>{status}</Text>
          <Text style={styles.proofTiny}>{proof ? `Proof ${shortenHash(proof.proofId)}` : "Proof waiting"}</Text>
        </View>
      </View>
    </View>
  );
}

function ProductPreview({ photoUri, proof }: { photoUri: string; proof: ArgusProof | null }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Item page preview</Text>
      <Image source={{ uri: photoUri }} style={styles.productPhoto} resizeMode="cover" />
      <Text style={styles.titleSmall}>{listing.title}</Text>
      <Text style={styles.priceSmall}>{listing.price}</Text>
      <View style={styles.productBadgeRow}>
        <ArgusBadge proof={proof} />
        <Text style={styles.shipping}>
          {proof ? "Photo captured for this listing" : "Capture proof appears here after upload"}
        </Text>
      </View>
    </View>
  );
}

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

export function ProofDetail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.proofDetail}>
      <Text style={styles.proofLabel}>{label}</Text>
      <Text style={styles.proofValue}>{value}</Text>
    </View>
  );
}

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

function EvidenceLine({ label, isReady }: { label: string; isReady: boolean }) {
  return (
    <Text style={styles.evidenceLine}>
      {label}: {isReady ? "captured" : "pending"}
    </Text>
  );
}

function statusCopy(status: ListingBackendStatus, isRegistering: boolean): string {
  if (isRegistering || status === "registering") {
    return "Contacting backend";
  }

  if (status === "registered") {
    return "Backend registered";
  }

  if (status === "local_only") {
    return "Saved locally";
  }

  return "Verifier pending";
}

export function shortenHash(value?: string) {
  if (!value) {
    return "Unavailable";
  }

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
  appShell: {
    backgroundColor: "#ffffff",
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  screen: {
    gap: 16,
    padding: 16,
    paddingBottom: 28,
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 48,
  },
  brand: {
    color: "#111827",
    flex: 1,
    fontSize: 32,
    fontWeight: "800",
  },
  ebayRed: {
    color: "#e53238",
  },
  ebayBlue: {
    color: "#0064d2",
  },
  ebayYellow: {
    color: "#f5af02",
  },
  ebayGreen: {
    color: "#86b817",
  },
  argusWord: {
    color: "#42464d",
    fontSize: 17,
    fontWeight: "800",
  },
  cartButton: {
    backgroundColor: "#111827",
    borderRadius: 22,
    color: "#ffffff",
    fontSize: 20,
    height: 44,
    lineHeight: 44,
    overflow: "hidden",
    textAlign: "center",
    width: 44,
  },
  searchBar: {
    alignItems: "center",
    borderColor: "#6b7280",
    borderRadius: 25,
    borderWidth: 2,
    flexDirection: "row",
    gap: 10,
    minHeight: 50,
    paddingHorizontal: 16,
  },
  searchIcon: {
    color: "#6b7280",
    fontSize: 24,
  },
  searchText: {
    color: "#111827",
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
  },
  cameraIcon: {
    color: "#6b7280",
    fontSize: 22,
  },
  categoryStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryLink: {
    borderColor: "#777b80",
    borderRadius: 19,
    borderWidth: 1,
    color: "#374151",
    fontSize: 14,
    fontWeight: "700",
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  sellingHero: {
    backgroundColor: "#f5f9ff",
    borderColor: "#cddbf9",
    borderRadius: 8,
    borderWidth: 1,
    gap: 11,
    padding: 16,
  },
  sellingHeroTitle: {
    color: "#111827",
    fontSize: 30,
    fontWeight: "800",
  },
  flowSteps: {
    gap: 8,
  },
  flowStep: {
    backgroundColor: "#ffffff",
    borderColor: "#d6dbe2",
    borderRadius: 8,
    borderWidth: 1,
    gap: 3,
    padding: 10,
  },
  flowStepActive: {
    backgroundColor: "#ffffff",
    borderColor: "#3665f3",
    borderRadius: 8,
    borderWidth: 2,
    gap: 3,
    padding: 10,
  },
  flowStepIndex: {
    color: "#3665f3",
    fontSize: 12,
    fontWeight: "800",
  },
  flowStepTitle: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "800",
  },
  flowStepCopy: {
    color: "#5f6875",
    fontSize: 12,
  },
  photoStage: {
    aspectRatio: 1,
    backgroundColor: "#f4f5f7",
    borderColor: "#d6dbe2",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
  },
  itemPhoto: {
    height: "100%",
    width: "100%",
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
  titleSmall: {
    color: "#111827",
    fontSize: 19,
    fontWeight: "800",
    lineHeight: 25,
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
  priceSmall: {
    color: "#111827",
    fontSize: 23,
    fontWeight: "800",
  },
  shipping: {
    color: "#5f6875",
    fontSize: 15,
    lineHeight: 21,
  },
  actionRow: {
    gap: 10,
  },
  primaryAction: {
    alignItems: "center",
    backgroundColor: "#3665f3",
    borderRadius: 22,
    minHeight: 46,
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
    borderColor: "#3665f3",
    borderRadius: 22,
    borderWidth: 1,
    minHeight: 46,
    justifyContent: "center",
  },
  secondaryActionText: {
    color: "#2558d4",
    fontSize: 16,
    fontWeight: "800",
  },
  uploadAction: {
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 22,
    minHeight: 44,
    justifyContent: "center",
  },
  uploadActionText: {
    color: "#ffffff",
    fontSize: 15,
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
    fontSize: 18,
    fontWeight: "800",
  },
  panelCopy: {
    color: "#5f6875",
    fontSize: 14,
    lineHeight: 20,
  },
  fallbackNote: {
    color: "#8a4b00",
    fontSize: 12,
    lineHeight: 18,
  },
  storageNote: {
    color: "#374151",
    fontSize: 13,
    fontWeight: "800",
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
  listingRow: {
    flexDirection: "row",
    gap: 12,
  },
  listingThumb: {
    backgroundColor: "#edf0f4",
    borderRadius: 8,
    height: 116,
    width: 116,
  },
  listingCopy: {
    flex: 1,
    gap: 5,
  },
  listingTitle: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
  },
  listingPrice: {
    color: "#111827",
    fontSize: 22,
    fontWeight: "800",
  },
  proofTiny: {
    color: "#3665f3",
    fontSize: 12,
    fontWeight: "800",
  },
  productPhoto: {
    aspectRatio: 4 / 3,
    backgroundColor: "#edf0f4",
    borderRadius: 8,
    width: "100%",
  },
  productBadgeRow: {
    gap: 8,
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
  bottomNav: {
    backgroundColor: "#ffffff",
    borderTopColor: "#d6dbe2",
    borderTopWidth: 1,
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingTop: 7,
    paddingBottom: 8,
  },
  bottomTab: {
    alignItems: "center",
    borderRadius: 22,
    flex: 1,
    gap: 2,
    minHeight: 52,
    justifyContent: "center",
  },
  bottomTabActive: {
    alignItems: "center",
    backgroundColor: "#e9f1ff",
    borderRadius: 22,
    flex: 1,
    gap: 2,
    minHeight: 52,
    justifyContent: "center",
  },
  bottomIcon: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "800",
  },
  bottomIconActive: {
    color: "#3665f3",
    fontSize: 20,
    fontWeight: "800",
  },
  bottomLabel: {
    color: "#374151",
    fontSize: 11,
    fontWeight: "700",
  },
  bottomLabelActive: {
    color: "#3665f3",
    fontSize: 11,
    fontWeight: "800",
  },
});
