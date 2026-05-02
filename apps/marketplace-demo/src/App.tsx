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
  TextInput,
  View,
  type ImageStyle,
  type ImageSourcePropType,
  type StyleProp,
} from "react-native";
import Svg, { Path } from "react-native-svg";
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
import { listing, type MarketplaceListing } from "./data/listing";
import { FigmaIcon, type FigmaIconName } from "./FigmaIcon";
import {
  buildListingDraft,
  loadLocalListingDraft,
  loadLocalListingDrafts,
  saveLocalListingDraft,
  type ListingBackendStatus,
  type LocalListingDraft,
} from "./localListingStore";

type TabId = "home" | "myEbay" | "search" | "inbox" | "selling";
type UploadSource = "argus_camera" | "local_upload";
type ListingForm = {
  condition: string;
  location: string;
  price: string;
  title: string;
};
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

const emptyListingForm: ListingForm = {
  condition: "",
  location: "",
  price: "",
  title: "",
};

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
  const [drafts, setDrafts] = useState<LocalListingDraft[]>(() => loadLocalListingDrafts());
  const [activeDraftId, setActiveDraftId] = useState<string | null>(
    () => loadLocalListingDraft()?.listing.id ?? null,
  );
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [draftListingId, setDraftListingId] = useState(() => createListingId());
  const [listingForm, setListingForm] = useState<ListingForm>(emptyListingForm);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [registeringDraftId, setRegisteringDraftId] = useState<string | null>(null);

  const activeDraft = drafts.find((item) => item.listing.id === activeDraftId) ?? drafts[0] ?? null;
  const proof = activeDraft?.proof ?? null;
  const backendStatus = activeDraft?.backendStatus ?? "pending";
  const isRegistering = Boolean(activeDraft && registeringDraftId === activeDraft.listing.id);
  const isSimulatorFallback = Boolean(
    activeDraft?.uploadSource === "local_upload" && activeDraft.backendStatus === "local_only",
  );
  const isProductionProof = isArgusProductionProof(proof);
  const isLocalOnlyProof = isArgusLocalDemoProof(proof);
  const isSimulatorPreview = isMarketplaceSimulatorPreviewProof(proof, isSimulatorFallback);
  const hasVerifiedOrPreviewProof = isProductionProof || isLocalOnlyProof || isSimulatorPreview;
  const activeListing = activeDraft?.listing ?? buildListingFromForm(listingForm, "preview-listing");
  const canCreateListing = Boolean(listingForm.title.trim() && listingForm.price.trim());

  useEffect(() => {
    configure({
      partnerId: ARGUS_DEMO_PARTNER_ID,
      relayerUrl: ARGUS_DEMO_BACKEND_URL,
      verifierBaseUrl: ARGUS_DEMO_BACKEND_URL,
    });
  }, []);

  function handleNativeError(error: Error) {
    setCaptureError(`SDK camera failed: ${error.message}`);
  }

  function handleProofCreated(createdProof: ArgusProof) {
    const listingForProof = createListingFromCurrentForm();
    setCaptureError(null);
    resetListingForm();
    void persistAndRegisterProof(createdProof, listingForProof);
  }

  async function persistAndRegisterProof(createdProof: ArgusProof, listingForProof: MarketplaceListing) {
    setCaptureError(null);
    persistDraft(createdProof, {
      backendMessage: "Registering proof",
      backendStatus: "registering",
      listing: listingForProof,
      uploadSource: "argus_camera",
    });

    setRegisteringDraftId(listingForProof.id);
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
        listing: listingForProof,
        uploadSource: "argus_camera",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Backend registration failed";
      persistDraft(createdProof, {
        backendMessage: `Registration pending: ${message}`,
        backendStatus: "local_only",
        listing: listingForProof,
        uploadSource: "argus_camera",
      });
    } finally {
      setRegisteringDraftId(null);
    }
  }

  function persistDraft(
    nextProof: ArgusProof,
    options: {
      backendMessage: string;
      backendStatus: ListingBackendStatus;
      listing: MarketplaceListing;
      uploadSource: UploadSource;
    },
  ) {
    const nextDraft = saveLocalListingDraft(
      buildListingDraft({
        backendMessage: options.backendMessage,
        backendStatus: options.backendStatus,
        listing: options.listing,
        proof: nextProof,
        uploadSource: options.uploadSource,
      }),
    );
    setDrafts(loadLocalListingDrafts());
    setActiveDraftId(nextDraft.listing.id);
  }

  function createListingFromCurrentForm(): MarketplaceListing {
    return buildListingFromForm(listingForm, draftListingId);
  }

  function resetListingForm() {
    setListingForm(emptyListingForm);
    setDraftListingId(createListingId());
  }

  function handleOpenVerifier(url: string) {
    void Linking.openURL(url).catch(() => Alert.alert("Argus verifier", url));
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.appShell}>
        <ScrollView contentContainerStyle={styles.screen} style={styles.scrollView}>
          <View style={styles.topBar}>
            <EbayWordmark />
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
              drafts={drafts}
              registeringDraftId={registeringDraftId}
            />
          ) : activeTab === "selling" ? (
            <>
              <View style={styles.sellingHero}>
                <Text style={styles.eyebrow}>Selling</Text>
                <Text style={styles.sellingHeroTitle}>List an item</Text>
                <View style={styles.flowSteps}>
                  <FlowStep index="1" title="Details" copy={canCreateListing ? "Ready" : "Title and price"} active />
                  <FlowStep index="2" title="Capture" copy={proof ? "Photo saved" : "Use Argus SDK"} active={Boolean(proof)} />
                  <FlowStep
                    index="3"
                    title="Verify"
                    copy={statusCopy(backendStatus, isRegistering)}
                    active={backendStatus === "registering" || backendStatus === "registered"}
                  />
                </View>
              </View>

              <View style={styles.panel}>
                <Text style={styles.panelTitle}>New listing</Text>
                <ListingInput
                  label="Title"
                  onChangeText={(title) => setListingForm((current) => ({ ...current, title }))}
                  placeholder="What are you selling?"
                  value={listingForm.title}
                />
                <View style={styles.formRow}>
                  <ListingInput
                    label="Price"
                    onChangeText={(price) => setListingForm((current) => ({ ...current, price }))}
                    placeholder="$"
                    value={listingForm.price}
                  />
                  <ListingInput
                    label="Condition"
                    onChangeText={(condition) => setListingForm((current) => ({ ...current, condition }))}
                    placeholder="Used"
                    value={listingForm.condition}
                  />
                </View>
                <ListingInput
                  label="Ships from"
                  onChangeText={(location) => setListingForm((current) => ({ ...current, location }))}
                  placeholder="City, state"
                  value={listingForm.location}
                />

                {canCreateListing ? (
                  <ArgusCamera
                    partnerId={ARGUS_DEMO_PARTNER_ID}
                    useCase={ARGUS_DEMO_USE_CASE}
                    metadata={{
                      condition: listingForm.condition.trim() || "Unspecified",
                      listingId: draftListingId,
                      location: listingForm.location.trim() || "Unspecified",
                      price: listingForm.price.trim(),
                      title: listingForm.title.trim(),
                    }}
                    onProofCreated={handleProofCreated}
                    onError={handleNativeError}
                  />
                ) : (
                  <View style={styles.disabledAction}>
                    <Text style={styles.disabledActionText}>Enter title and price first</Text>
                  </View>
                )}
                {captureError ? <Text style={styles.fallbackNote}>{captureError}</Text> : null}
              </View>

              {activeDraft ? (
                <>
                  <View style={styles.photoStage}>
                    <ListingPhoto draft={activeDraft} imageStyle={styles.itemPhoto} />
                    <View style={styles.photoBadge}>
                      <ArgusBadge proof={proof} />
                    </View>
                  </View>

                  <View style={styles.titleBlock}>
                    <Text style={styles.eyebrow}>
                      {activeListing.condition || "Condition not set"} - {activeListing.seller.location || "Location not set"}
                    </Text>
                    <Text style={styles.title}>{activeListing.title}</Text>
                    <View style={styles.badgeRow}>
                      <Text style={styles.conditionPill}>{activeListing.condition || "Condition not set"}</Text>
                      <Text style={isProductionProof ? styles.verifiedPill : styles.pendingPill}>
                        {getListingStatus(activeDraft, isRegistering)}
                      </Text>
                    </View>
                    <Text style={styles.price}>{activeListing.price}</Text>
                    <Text style={styles.shipping}>{activeListing.offerLabel} - {activeListing.shipping}</Text>
                  </View>

                  <View style={styles.panel}>
                    <Text style={styles.panelTitle}>Argus proof</Text>
                    {activeDraft.backendMessage ? (
                      <Text style={styles.fallbackNote}>{activeDraft.backendMessage}</Text>
                    ) : null}
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

                  <ListingPreview draft={activeDraft} isRegistering={isRegistering} />
                  <ProductPreview draft={activeDraft} />

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
              ) : null}

              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Your listings</Text>
                {drafts.length > 0 ? (
                  drafts.map((item) => (
                    <SellingDraftCard
                      draft={item}
                      isActive={item.listing.id === activeDraft?.listing.id}
                      isRegistering={registeringDraftId === item.listing.id}
                      key={item.listing.id}
                      onPress={() => setActiveDraftId(item.listing.id)}
                    />
                  ))
                ) : (
                  <Text style={styles.panelCopy}>No Argus listings yet.</Text>
                )}
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

function EbayWordmark() {
  return (
    <Svg height={42} viewBox="0 0 300 120.32412" width={105}>
      <Path
        d="M38.866 26.308C17.721 26.308.1 35.28.1 62.345c0 21.442 11.849 34.944 39.312 34.944 32.327 0 34.399-21.294 34.399-21.294H58.147s-3.358 11.466-19.69 11.466c-13.302 0-22.87-8.986-22.87-21.58H75.45v-7.904c0-12.46-7.91-31.669-36.583-31.669zM38.32 36.41c12.663 0 21.295 7.758 21.295 19.384h-43.68c0-12.343 11.266-19.384 22.385-19.384z"
        fill="#e53238"
      />
      <Path
        d="M75.438.1v83.597c0 4.745-.339 11.408-.339 11.408h14.94s.536-4.785.536-9.159c0 0 7.381 11.548 27.451 11.548 21.135 0 35.49-14.673 35.49-35.695 0-19.557-13.186-35.286-35.456-35.286-20.854 0-27.334 11.262-27.334 11.262V.1zm38.766 36.753c14.352 0 23.478 10.652 23.478 24.946 0 15.328-10.54 25.355-23.375 25.355-15.318 0-23.581-11.96-23.581-25.219 0-12.354 7.414-25.082 23.478-25.082z"
        fill="#0064d2"
      />
      <Path
        d="M190.645 26.308c-31.812 0-33.852 17.42-33.852 20.203h15.834s.83-10.17 16.926-10.17c10.46 0 18.564 4.788 18.564 13.992v3.276h-18.564c-24.645 0-37.674 7.21-37.674 21.84 0 14.398 12.038 22.233 28.307 22.233 22.171 0 29.313-12.251 29.313-12.251 0 4.872.376 9.674.376 9.674h14.076s-.546-5.952-.546-9.76V52.431c0-21.58-17.407-26.123-32.76-26.123zm17.472 37.129v4.368c0 5.697-3.515 19.86-24.212 19.86-11.333 0-16.192-5.655-16.192-12.216 0-11.935 16.364-12.012 40.404-12.012z"
        fill="#f5af02"
      />
      <Path
        d="M214.879 29.041h17.813l25.565 51.218 25.507-51.218H299.9l-46.46 91.183h-16.925l13.406-25.418z"
        fill="#86b817"
      />
    </Svg>
  );
}

function HomeScreen({
  drafts,
  registeringDraftId,
}: {
  drafts: LocalListingDraft[];
  registeringDraftId: string | null;
}) {
  return (
    <>
      <View style={styles.homeHeader}>
        <Text style={styles.homeSubtitle}>ebay listings</Text>
      </View>

      {homeListings.map((item) => (
        <HomeListingCard item={item} key={item.title} />
      ))}

      {drafts.length > 0 ? (
        <View style={styles.homeSection}>
          <Text style={styles.panelTitle}>Your Argus listings</Text>
          {drafts.map((draft) => (
            <ArgusHomeListing
              draft={draft}
              isRegistering={registeringDraftId === draft.listing.id}
              key={draft.listing.id}
            />
          ))}
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

function ListingInput({
  label,
  onChangeText,
  placeholder,
  value,
}: {
  label: string;
  onChangeText(value: string): void;
  placeholder: string;
  value: string;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        autoCapitalize="sentences"
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8b95a1"
        style={styles.textInput}
        value={value}
      />
    </View>
  );
}

function ListingPhoto({
  draft,
  imageStyle,
}: {
  draft: LocalListingDraft;
  imageStyle: StyleProp<ImageStyle>;
}) {
  const photoUri = getDraftPhotoUri(draft);

  if (!photoUri) {
    return (
      <View style={[imageStyle, styles.photoPlaceholder]}>
        <FigmaIcon color="#596273" name="camera" size={24} />
        <Text style={styles.photoPlaceholderText}>Argus photo</Text>
      </View>
    );
  }

  return <Image source={{ uri: photoUri }} style={imageStyle} resizeMode="cover" />;
}

function SellingDraftCard({
  draft,
  isActive,
  isRegistering,
  onPress,
}: {
  draft: LocalListingDraft;
  isActive: boolean;
  isRegistering: boolean;
  onPress(): void;
}) {
  const proof = draft.proof;
  const level = getArgusEvidenceLevelLabel(proof) ?? proof.proofRecord?.proofLevel ?? proof.proofLevel ?? "Pending";

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={isActive ? styles.sellingDraftCardActive : styles.sellingDraftCard}
    >
      <ListingPhoto draft={draft} imageStyle={styles.sellingDraftThumb} />
      <View style={styles.sellingDraftBody}>
        <Text style={styles.listingTitle}>{draft.listing.title}</Text>
        <Text style={styles.listingPrice}>{draft.listing.price}</Text>
        <View style={styles.badgeRow}>
          <Text style={isArgusProductionProof(proof) ? styles.verifiedPill : styles.pendingPill}>
            {getListingStatus(draft, isRegistering)}
          </Text>
          <Text style={styles.pendingPill}>{level}</Text>
        </View>
        <Text style={styles.proofTiny}>
          {proof.solanaTx ? `Solana ${shortenHash(proof.solanaTx)}` : "Solana pending"}
        </Text>
      </View>
    </Pressable>
  );
}

function ArgusHomeListing({
  draft,
  isRegistering,
}: {
  draft: LocalListingDraft;
  isRegistering: boolean;
}) {
  const proof = draft.proof;
  const solanaUrl = getSolanaExplorerUrl(proof);
  const level = getArgusEvidenceLevelLabel(proof) ?? proof.proofRecord?.proofLevel ?? proof.proofLevel;
  const statusLabel = getListingStatus(draft, isRegistering);

  return (
    <View style={styles.argusHomeCard}>
      <ListingPhoto draft={draft} imageStyle={styles.homeListingImage} />
      <View style={styles.homeListingBody}>
        <View style={styles.snapshotHeader}>
          <ArgusBadge proof={proof} />
          <Text style={isArgusProductionProof(proof) ? styles.verifiedPill : styles.pendingPill}>{statusLabel}</Text>
        </View>
        <Text style={styles.homeListingTitle}>{draft.listing.title}</Text>
        <Text style={styles.homePrice}>{draft.listing.price}</Text>
        <View style={styles.homeProofGrid}>
          <ProofDetail label="Level" value={level ?? "Pending"} />
          <ProofDetail label="Registry" value={proof.proofRecord?.status ?? "pending"} />
          <ProofDetail label="Solana" value={proof.solanaTx ? shortenHash(proof.solanaTx) : "Pending"} />
          <ProofDetail label="Backend" value={statusCopy(draft.backendStatus, isRegistering)} />
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

function ListingPreview({ draft, isRegistering }: { draft: LocalListingDraft; isRegistering: boolean }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Listing preview</Text>
      <View style={styles.listingRow}>
        <ListingPhoto draft={draft} imageStyle={styles.listingThumb} />
        <View style={styles.listingCopy}>
          <Text style={styles.listingTitle}>{draft.listing.title}</Text>
          <Text style={styles.listingPrice}>{draft.listing.price}</Text>
          <Text style={styles.shipping}>{getListingStatus(draft, isRegistering)}</Text>
          <Text style={styles.proofTiny}>Proof {shortenHash(draft.proof.proofId)}</Text>
        </View>
      </View>
    </View>
  );
}

function ProductPreview({ draft }: { draft: LocalListingDraft }) {
  const proof = draft.proof;

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Item page preview</Text>
      <ListingPhoto draft={draft} imageStyle={styles.productPhoto} />
      <Text style={styles.titleSmall}>{draft.listing.title}</Text>
      <Text style={styles.priceSmall}>{draft.listing.price}</Text>
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

function buildListingFromForm(form: ListingForm, listingId: string): MarketplaceListing {
  const title = form.title.trim() || "Untitled item";
  const price = form.price.trim() || "$0.00";
  const condition = form.condition.trim() || "Condition not set";
  const location = form.location.trim() || "Seller location not set";

  return {
    ...listing,
    listingId,
    id: listingId,
    title,
    condition,
    price,
    shipping: `Ships from ${location}`,
    seller: {
      ...listing.seller,
      location,
    },
  };
}

function createListingId(): string {
  return `argus-listing-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function getDraftPhotoUri(draft: LocalListingDraft | null): string {
  if (!draft) {
    return "";
  }

  if (isMarketplaceSimulatorPreviewProof(draft.proof, draft.uploadSource === "local_upload")) {
    return "";
  }

  return draft.photoUri;
}

function getListingStatus(draft: LocalListingDraft, isRegistering: boolean): string {
  if (isRegistering || draft.backendStatus === "registering") {
    return "Registering";
  }

  if (isArgusProductionProof(draft.proof)) {
    return "Argus verified";
  }

  if (draft.backendStatus === "registered" || draft.proof.proofRecord?.status === "active") {
    return "Devnet integration";
  }

  if (
    isArgusLocalDemoProof(draft.proof) ||
    isMarketplaceSimulatorPreviewProof(draft.proof, draft.uploadSource === "local_upload")
  ) {
    return "Argus demo preview";
  }

  if (draft.backendStatus === "local_only") {
    return "Saved locally";
  }

  return "Capture proof pending";
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
  topIconButton: {
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    marginLeft: "auto",
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
  uploadActionDisabled: {
    alignItems: "center",
    backgroundColor: "#edf0f4",
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
  uploadActionTextDisabled: {
    color: "#596273",
    fontSize: 15,
    fontWeight: "800",
  },
  disabledAction: {
    alignItems: "center",
    backgroundColor: "#edf0f4",
    borderRadius: 22,
    minHeight: 44,
    justifyContent: "center",
  },
  disabledActionText: {
    color: "#596273",
    fontSize: 15,
    fontWeight: "800",
  },
  formRow: {
    flexDirection: "row",
    gap: 10,
  },
  inputGroup: {
    flex: 1,
    gap: 6,
  },
  inputLabel: {
    color: "#374151",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  textInput: {
    backgroundColor: "#ffffff",
    borderColor: "#d6dbe2",
    borderRadius: 8,
    borderWidth: 1,
    color: "#111827",
    fontSize: 16,
    minHeight: 46,
    paddingHorizontal: 12,
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
  photoPlaceholder: {
    alignItems: "center",
    gap: 6,
    justifyContent: "center",
  },
  photoPlaceholderText: {
    color: "#596273",
    fontSize: 13,
    fontWeight: "800",
  },
  sellingDraftCard: {
    backgroundColor: "#ffffff",
    borderColor: "#d6dbe2",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 10,
  },
  sellingDraftCardActive: {
    backgroundColor: "#ffffff",
    borderColor: "#3665f3",
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: "row",
    gap: 12,
    padding: 10,
  },
  sellingDraftThumb: {
    backgroundColor: "#edf0f4",
    borderRadius: 8,
    height: 92,
    width: 92,
  },
  sellingDraftBody: {
    flex: 1,
    gap: 5,
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
