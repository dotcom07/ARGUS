import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native";
import {
  ArgusBadge,
  ArgusCamera,
  ArgusProofLink,
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
import { listing } from "./data/listing";
import { createMarketplaceSimulatorProof } from "./demoProof";
import { FigmaIcon, type FigmaIconName } from "./FigmaIcon";
import {
  buildListingDraft,
  loadLocalListingDraft,
  saveLocalListingDraft,
  type ListingBackendStatus,
  type LocalListingDraft,
} from "./localListingStore";

type TabId = "home" | "myEbay" | "search" | "inbox" | "selling";
type UploadSource = "argus_camera" | "local_upload";
type DemoHomeListing = {
  condition: string;
  details?: string;
  image: ImageSourcePropType;
  price: string;
  priceDetail?: string;
  seller: string;
  sellerInitial: string;
  sellerScore: string;
  title: string;
};

const appLogo = require("../assets/ebay_argus.png");

const bottomTabs: Array<{ id: TabId; label: string; icon: FigmaIconName }> = [
  { id: "home", label: "Home", icon: "home" },
  { id: "myEbay", label: "My eBay", icon: "profile" },
  { id: "search", label: "Search", icon: "search" },
  { id: "inbox", label: "Inbox", icon: "bell" },
  { id: "selling", label: "Selling", icon: "tag" },
];

const categoryLinks: Array<{ label: string; icon: FigmaIconName }> = [
  { label: "Saved", icon: "heart" },
  { label: "Selling", icon: "tag" },
  { label: "Deals", icon: "filter" },
  { label: "Cameras", icon: "camera" },
  { label: "Collectibles", icon: "plusSquare" },
];

const homeListings: DemoHomeListing[] = [
  {
    condition: "Good used",
    details: "Japanese model - 4GB",
    image: require("../assets/ebay/Nintendo New 3DS.webp") as ImageSourcePropType,
    price: "US $340.39",
    priceDetail: "Was US $369.99 - 8% off",
    seller: "The Coco Store",
    sellerInitial: "T",
    sellerScore: "38095 - 99.9% positive",
    title: "Nintendo New 3DS LL XL 4GB Handheld Gaming System Black",
  },
  {
    condition: "Used",
    details: "Excellent condition lightly used",
    image: require("../assets/ebay/Ricoh WG-M1 Digital Camera.webp") as ImageSourcePropType,
    price: "US $145.00",
    priceDetail: "or Best Offer",
    seller: "rbrodley",
    sellerInitial: "R",
    sellerScore: "5",
    title: "Ricoh WG-M1 Digital Camera Black Includes bag and accessories",
  },
  {
    condition: "New with box",
    details: "US Shoe Size 8.5 - Nike",
    image: require("../assets/ebay/nike air jordan 1 mid.webp") as ImageSourcePropType,
    price: "AU $170.00",
    priceDetail: "Approximately US $122.43",
    seller: "lamil90",
    sellerInitial: "L",
    sellerScore: "0",
    title: "nike air jordan 1 mid",
  },
];

export default function MarketplaceDemoApp() {
  const [draft, setDraft] = useState<LocalListingDraft | null>(() => loadLocalListingDraft());
  const [proof, setProof] = useState<ArgusProof | null>(() => draft?.proof ?? null);
  const [activeTab, setActiveTab] = useState<TabId>("home");
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
      backendMessage: `SDK capture failed: ${error.message}`,
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
      backendMessage: "Local preview saved",
      backendStatus: "local_only",
      uploadSource: "local_upload",
    });
    setIsSimulatorFallback(true);
  }

  async function persistAndRegisterProof(createdProof: ArgusProof) {
    setIsSimulatorFallback(false);
    persistDraft(createdProof, {
      backendMessage: "Registering proof",
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
        backendMessage: "Solana devnet registered",
        backendStatus: "registered",
        uploadSource: "argus_camera",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Backend registration failed";
      persistDraft(createdProof, {
        backendMessage: `Registration pending: ${message}`,
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
    void Linking.openURL(url).catch(() => Alert.alert("Argus verifier", url));
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.appShell}>
        <ScrollView contentContainerStyle={styles.screen} style={styles.scrollView}>
          <View style={styles.topBar}>
            <Image source={appLogo} style={styles.brandLogo} resizeMode="contain" />
            <View style={styles.topIconButton}>
              <FigmaIcon color="#ffffff" name="cart" size={22} />
            </View>
          </View>

          <View style={styles.searchBar}>
            <FigmaIcon color="#6b7280" name="search" size={20} />
            <Text style={styles.searchText}>Search on eBay</Text>
            <FigmaIcon color="#6b7280" name="camera" size={22} />
          </View>

          <View style={styles.categoryStrip}>
            {categoryLinks.map((category) => (
              <View key={category.label} style={styles.categoryPill}>
                <FigmaIcon color="#374151" name={category.icon} size={15} />
                <Text style={styles.categoryLink}>{category.label}</Text>
              </View>
            ))}
          </View>

          {activeTab === "home" ? (
            <HomeScreen
              backendStatus={backendStatus}
              isRegistering={isRegistering}
              isSimulatorPreview={isSimulatorPreview}
              listingStatus={listingStatus}
              photoUri={photoUri}
              proof={proof}
            />
          ) : activeTab === "selling" ? (
            <>
          <View style={styles.sellingHero}>
            <Text style={styles.eyebrow}>Selling</Text>
            <Text style={styles.sellingHeroTitle}>List an item</Text>
            <View style={styles.flowSteps}>
              <FlowStep index="1" title="Capture" copy={proof ? "SDK photo saved" : "Use Argus SDK"} active />
              <FlowStep
                index="2"
                title="Verify"
                copy={statusCopy(backendStatus, isRegistering)}
                active={backendStatus === "registering" || backendStatus === "registered"}
              />
              <FlowStep index="3" title="List" copy={listingStatus} active={hasVerifiedOrPreviewProof} />
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
              <FigmaIcon color="#ffffff" name="upload" size={18} />
              <Text style={styles.uploadActionText}>Upload local demo photo</Text>
            </Pressable>
            {lastError ? <Text style={styles.fallbackNote}>{lastError}</Text> : null}
            <VerificationSnapshot
              backendStatus={backendStatus}
              isRegistering={isRegistering}
              isSimulatorPreview={isSimulatorPreview}
              proof={proof}
            />
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
            <Text style={styles.panelTitle}>SDK checks</Text>
            <EvidenceLine
              label={isLocalOnlyProof || isSimulatorPreview ? "Camera evidence" : "Native CameraX"}
              isReady={Boolean(hasVerifiedOrPreviewProof && proof?.deviceEvidenceSummary?.cameraMetadata)}
            />
            <EvidenceLine
              label="Motion snapshot"
              isReady={Boolean(hasVerifiedOrPreviewProof && proof?.deviceEvidenceSummary?.motionSnapshot)}
            />
            <EvidenceLine
              label="App identity hash"
              isReady={Boolean(hasVerifiedOrPreviewProof && proof?.deviceEvidenceSummary?.appIdentityHash)}
            />
            <EvidenceLine
              label="Level 3 key"
              isReady={Boolean(isProductionProof && hasArgusPublicKeyCertificateEvidence(proof))}
            />
            <EvidenceLine
              label="Level 4 attestation"
              isReady={Boolean(
                isProductionProof && getArgusEvidenceLevel(proof) === "level_4_hardware_attestation",
              )}
            />
            <EvidenceLine
              label="Authorized relayer"
              isReady={Boolean(isProductionProof && proof?.proofRecord?.relayerAuthorized)}
            />
          </View>
            </>
          ) : (
            <PlaceholderTab label={bottomTabs.find((tab) => tab.id === activeTab)?.label ?? "eBay"} />
          )}
        </ScrollView>

        <View style={styles.bottomNav}>
          {bottomTabs.map((tab) => (
            <Pressable
              accessibilityRole="tab"
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={activeTab === tab.id ? styles.bottomTabActive : styles.bottomTab}
            >
              <FigmaIcon
                color={activeTab === tab.id ? "#3665f3" : "#111827"}
                name={tab.icon}
                size={22}
              />
              <Text style={activeTab === tab.id ? styles.bottomLabelActive : styles.bottomLabel}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

function HomeScreen({
  backendStatus,
  isRegistering,
  isSimulatorPreview,
  listingStatus,
  photoUri,
  proof,
}: {
  backendStatus: ListingBackendStatus;
  isRegistering: boolean;
  isSimulatorPreview: boolean;
  listingStatus: string;
  photoUri: string;
  proof: ArgusProof | null;
}) {
  return (
    <>
      <View style={styles.homeHeader}>
        <Text style={styles.homeTitle}>Home</Text>
        <Text style={styles.homeSubtitle}>Marketplace listings</Text>
      </View>

      {homeListings.map((item) => (
        <HomeListingCard item={item} key={item.title} />
      ))}

      {proof ? (
        <View style={styles.homeSection}>
          <Text style={styles.panelTitle}>Your Argus listing</Text>
          <ArgusHomeListing
            backendStatus={backendStatus}
            isRegistering={isRegistering}
            isSimulatorPreview={isSimulatorPreview}
            listingStatus={listingStatus}
            photoUri={photoUri}
            proof={proof}
          />
        </View>
      ) : null}
    </>
  );
}

function HomeListingCard({ item }: { item: DemoHomeListing }) {
  return (
    <View style={styles.homeListingCard}>
      <Image source={item.image} style={styles.homeListingImage} resizeMode="cover" />
      <View style={styles.homeListingBody}>
        <Text style={styles.homeListingTitle}>{item.title}</Text>
        <View style={styles.sellerLine}>
          <Text style={styles.sellerAvatar}>{item.sellerInitial}</Text>
          <Text style={styles.homeMeta}>
            {item.seller} - {item.sellerScore}
          </Text>
        </View>
        <Text style={styles.homePrice}>{item.price}</Text>
        {item.priceDetail ? <Text style={styles.homeMeta}>{item.priceDetail}</Text> : null}
        <Text style={styles.homeMeta}>Condition: {item.condition}</Text>
        {item.details ? <Text style={styles.homeMeta}>{item.details}</Text> : null}
        <Text style={styles.notVerifiedPill}>Argus not verified</Text>
      </View>
    </View>
  );
}

function ArgusHomeListing({
  backendStatus,
  isRegistering,
  isSimulatorPreview,
  listingStatus,
  photoUri,
  proof,
}: {
  backendStatus: ListingBackendStatus;
  isRegistering: boolean;
  isSimulatorPreview: boolean;
  listingStatus: string;
  photoUri: string;
  proof: ArgusProof;
}) {
  const solanaUrl = getSolanaExplorerUrl(proof);
  const level = getArgusEvidenceLevelLabel(proof) ?? proof.proofRecord?.proofLevel ?? proof.proofLevel;
  const statusLabel = isArgusProductionProof(proof)
    ? "Argus verified"
    : isArgusLocalDemoProof(proof) || isSimulatorPreview
      ? "Argus demo preview"
      : listingStatus;

  return (
    <View style={styles.argusHomeCard}>
      <Image source={{ uri: photoUri }} style={styles.homeListingImage} resizeMode="cover" />
      <View style={styles.homeListingBody}>
        <View style={styles.snapshotHeader}>
          <ArgusBadge proof={proof} />
          <Text style={styles.verifiedPill}>{statusLabel}</Text>
        </View>
        <Text style={styles.homeListingTitle}>{listing.title}</Text>
        <Text style={styles.homePrice}>{listing.price}</Text>
        <View style={styles.homeProofGrid}>
          <ProofDetail label="Level" value={level ?? "Pending"} />
          <ProofDetail label="Registry" value={proof.proofRecord?.status ?? "pending"} />
          <ProofDetail label="Solana" value={proof.solanaTx ? shortenHash(proof.solanaTx) : "Pending"} />
          <ProofDetail label="Backend" value={statusCopy(backendStatus, isRegistering)} />
        </View>
        <Pressable
          accessibilityRole="link"
          disabled={!solanaUrl}
          onPress={() => {
            if (solanaUrl) {
              void Linking.openURL(solanaUrl);
            }
          }}
          style={solanaUrl ? styles.solanaAction : styles.solanaActionDisabled}
        >
          <Text style={solanaUrl ? styles.solanaActionText : styles.solanaActionTextDisabled}>
            {solanaUrl ? "Open Solana scan" : "Solana record pending"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function PlaceholderTab({ label }: { label: string }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{label}</Text>
      <Text style={styles.panelCopy}>Demo tab</Text>
    </View>
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
        <FigmaIcon color={proof ? "#0f7b5f" : "#596273"} name={proof ? "shieldCheck" : "shield"} size={18} />
        <Text style={styles.shipping}>
          {proof ? "Photo captured for this listing" : "Capture proof appears here after upload"}
        </Text>
      </View>
    </View>
  );
}

export function VerificationSnapshot({
  backendStatus,
  isRegistering,
  proof,
  isSimulatorPreview = false,
}: {
  backendStatus: ListingBackendStatus;
  isRegistering: boolean;
  proof: ArgusProof | null;
  isSimulatorPreview?: boolean;
}) {
  const solanaTx = proof?.solanaTx;
  const isProductionProof = isArgusProductionProof(proof);
  const isLocalDemoProof = isArgusLocalDemoProof(proof);
  const isTrustedSimulatorPreview = isMarketplaceSimulatorPreviewProof(proof, isSimulatorPreview);
  const displayedProofLevel = proof?.proofRecord?.proofLevel ?? proof?.proofLevel;
  const displayedEvidenceLevel = getArgusEvidenceLevelLabel(proof) ?? displayedProofLevel;
  const statusLabel = proof
    ? isProductionProof
      ? "Verified"
      : isLocalDemoProof
        ? "Local preview"
        : isTrustedSimulatorPreview
          ? "Simulator preview"
          : "Unverified"
    : "Pending";
  const registryStatus = proof?.proofRecord?.status ?? "pending";
  const solanaUrl = getSolanaExplorerUrl(proof);

  return (
    <View style={styles.snapshotPanel}>
      <View style={styles.snapshotHeader}>
        <ArgusBadge proof={proof} />
        <Text style={styles.snapshotStatus}>{statusLabel}</Text>
      </View>
      <View style={styles.metricGrid}>
        <ProofDetail label="Level" value={displayedEvidenceLevel ?? "Pending"} />
        <ProofDetail label="Registry" value={registryStatus} />
        <ProofDetail label="Solana" value={solanaTx ? shortenHash(solanaTx) : "Pending"} />
        <ProofDetail label="Backend" value={statusCopy(backendStatus, isRegistering)} />
      </View>
      <Text style={styles.proofTiny}>{proof ? `Proof ${shortenHash(proof.proofId)}` : "Proof pending"}</Text>
      <Pressable
        accessibilityRole="link"
        disabled={!solanaUrl}
        onPress={() => {
          if (solanaUrl) {
            void Linking.openURL(solanaUrl);
          }
        }}
        style={solanaUrl ? styles.solanaAction : styles.solanaActionDisabled}
      >
        <Text style={solanaUrl ? styles.solanaActionText : styles.solanaActionTextDisabled}>
          {solanaUrl ? "Open Solana Explorer" : "Solana record pending"}
        </Text>
      </Pressable>
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
    <View style={styles.evidenceStatusRow}>
      <FigmaIcon color={isReady ? "#0f7b5f" : "#596273"} name={isReady ? "check" : "shield"} size={16} />
      <Text style={styles.evidenceStatusText}>
        {label}: {isReady ? "captured" : "pending"}
      </Text>
    </View>
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

function getSolanaExplorerUrl(proof: ArgusProof | null): string | undefined {
  if (!proof?.solanaTx || proof.proofRecord?.status !== "active") {
    return undefined;
  }

  return `https://explorer.solana.com/tx/${proof.solanaTx}?cluster=devnet`;
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
  brandLogo: {
    flex: 1,
    height: 42,
    maxWidth: 170,
  },
  topIconButton: {
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
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
  searchText: {
    color: "#111827",
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
  },
  categoryStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryPill: {
    alignItems: "center",
    borderColor: "#777b80",
    borderRadius: 19,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  categoryLink: {
    color: "#374151",
    fontSize: 14,
    fontWeight: "700",
  },
  homeHeader: {
    gap: 4,
  },
  homeTitle: {
    color: "#111827",
    fontSize: 30,
    fontWeight: "800",
  },
  homeSubtitle: {
    color: "#5f6875",
    fontSize: 15,
  },
  homeSection: {
    gap: 12,
  },
  homeListingCard: {
    backgroundColor: "#ffffff",
    borderColor: "#d6dbe2",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  argusHomeCard: {
    backgroundColor: "#f9fbff",
    borderColor: "#cddbf9",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  homeListingImage: {
    backgroundColor: "#edf0f4",
    borderRadius: 8,
    height: 126,
    width: 126,
  },
  homeListingBody: {
    flex: 1,
    gap: 6,
  },
  homeListingTitle: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21,
  },
  sellerLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  sellerAvatar: {
    backgroundColor: "#edf0f4",
    borderRadius: 10,
    color: "#374151",
    fontSize: 11,
    fontWeight: "800",
    height: 20,
    lineHeight: 20,
    textAlign: "center",
    width: 20,
  },
  homeMeta: {
    color: "#5f6875",
    fontSize: 12,
    lineHeight: 17,
  },
  homePrice: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "800",
  },
  notVerifiedPill: {
    alignSelf: "flex-start",
    backgroundColor: "#edf0f4",
    borderRadius: 4,
    color: "#596273",
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  homeProofGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
    flexDirection: "row",
    gap: 8,
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
  verifierButton: {
    alignItems: "flex-start",
  },
  snapshotPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#d6dbe2",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  snapshotHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  snapshotStatus: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "800",
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  proofDetail: {
    backgroundColor: "#f9fbff",
    borderBottomColor: "#edf0f4",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#edf0f4",
    flexBasis: "48%",
    flexGrow: 1,
    gap: 3,
    minHeight: 66,
    padding: 10,
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
  solanaAction: {
    alignItems: "center",
    backgroundColor: "#3665f3",
    borderRadius: 8,
    minHeight: 42,
    justifyContent: "center",
  },
  solanaActionDisabled: {
    alignItems: "center",
    backgroundColor: "#edf0f4",
    borderRadius: 8,
    minHeight: 42,
    justifyContent: "center",
  },
  solanaActionText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  solanaActionTextDisabled: {
    color: "#596273",
    fontSize: 14,
    fontWeight: "800",
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
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
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
  evidenceStatusRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
  },
  evidenceStatusText: {
    color: "#374151",
    flex: 1,
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
