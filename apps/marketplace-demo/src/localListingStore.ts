import type { ArgusProof } from "../../../packages/argus-rn-sdk/src";
import type { MarketplaceListing } from "./data/listing";

export type ListingBackendStatus = "pending" | "registering" | "registered" | "local_only";

export type LocalListingDraft = {
  backendMessage: string;
  backendStatus: ListingBackendStatus;
  listing: MarketplaceListing;
  metadataJson: string;
  photoBytesBase64: string;
  photoUri: string;
  proof: ArgusProof;
  savedAt: string;
  uploadSource: "argus_camera" | "local_upload";
};

const STORAGE_KEY = "ebay_argus.local_listing";
let memoryDraft: LocalListingDraft | null = null;

type LocalStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function loadLocalListingDraft(): LocalListingDraft | null {
  const storage = getLocalStorage();
  const rawDraft = storage?.getItem(STORAGE_KEY);

  if (!rawDraft) {
    return memoryDraft;
  }

  try {
    const parsedDraft = JSON.parse(rawDraft) as LocalListingDraft;
    memoryDraft = parsedDraft;
    return parsedDraft;
  } catch {
    return memoryDraft;
  }
}

export function saveLocalListingDraft(draft: LocalListingDraft): LocalListingDraft {
  memoryDraft = draft;
  getLocalStorage()?.setItem(STORAGE_KEY, JSON.stringify(draft));
  return draft;
}

export function buildListingDraft({
  backendMessage,
  backendStatus,
  listing,
  proof,
  uploadSource,
}: {
  backendMessage: string;
  backendStatus: ListingBackendStatus;
  listing: MarketplaceListing;
  proof: ArgusProof;
  uploadSource: "argus_camera" | "local_upload";
}): LocalListingDraft {
  return {
    backendMessage,
    backendStatus,
    listing,
    metadataJson: proof.metadataJson ?? "{}",
    photoBytesBase64: proof.photoBytesBase64 ?? "",
    photoUri: listing.photoUrl,
    proof,
    savedAt: new Date().toISOString(),
    uploadSource,
  };
}

function getLocalStorage(): LocalStorageLike | undefined {
  try {
    const storage = (globalThis as { localStorage?: Partial<LocalStorageLike> }).localStorage;
    return typeof storage?.getItem === "function" && typeof storage.setItem === "function"
      ? (storage as LocalStorageLike)
      : undefined;
  } catch {
    return undefined;
  }
}
