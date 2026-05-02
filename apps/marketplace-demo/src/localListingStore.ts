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
const STORAGE_LIST_KEY = "ebay_argus.local_listings";
let memoryDraft: LocalListingDraft | null = null;
let memoryDrafts: LocalListingDraft[] = [];

type LocalStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function loadLocalListingDraft(): LocalListingDraft | null {
  const drafts = loadLocalListingDrafts();

  if (drafts.length > 0) {
    return drafts[0];
  }

  return memoryDraft;
}

export function loadLocalListingDrafts(): LocalListingDraft[] {
  const storage = getLocalStorage();
  const rawDrafts = storage?.getItem(STORAGE_LIST_KEY);

  if (rawDrafts) {
    try {
      const parsedDrafts = JSON.parse(rawDrafts) as LocalListingDraft[];
      memoryDrafts = parsedDrafts;
      memoryDraft = parsedDrafts[0] ?? null;
      return parsedDrafts;
    } catch {
      return memoryDrafts;
    }
  }

  const rawDraft = storage?.getItem(STORAGE_KEY);

  if (!rawDraft) {
    return memoryDrafts;
  }

  try {
    const parsedDraft = JSON.parse(rawDraft) as LocalListingDraft;
    memoryDraft = parsedDraft;
    memoryDrafts = [parsedDraft];
    return memoryDrafts;
  } catch {
    return memoryDrafts;
  }
}

export function saveLocalListingDraft(draft: LocalListingDraft): LocalListingDraft {
  memoryDraft = draft;
  const nextDrafts = upsertDraft(memoryDrafts.length > 0 ? memoryDrafts : loadLocalListingDrafts(), draft);
  saveLocalListingDrafts(nextDrafts);
  return draft;
}

export function saveLocalListingDrafts(drafts: LocalListingDraft[]): LocalListingDraft[] {
  memoryDrafts = drafts;
  memoryDraft = drafts[0] ?? null;
  const storage = getLocalStorage();
  storage?.setItem(STORAGE_LIST_KEY, JSON.stringify(drafts));
  if (memoryDraft) {
    storage?.setItem(STORAGE_KEY, JSON.stringify(memoryDraft));
  }
  return drafts;
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
    photoUri: listing.photoUrl || photoDataUri(proof.photoBytesBase64),
    proof,
    savedAt: new Date().toISOString(),
    uploadSource,
  };
}

function upsertDraft(drafts: LocalListingDraft[], draft: LocalListingDraft): LocalListingDraft[] {
  const existingIndex = drafts.findIndex((item) => item.listing.id === draft.listing.id);

  if (existingIndex === -1) {
    return [draft, ...drafts];
  }

  const nextDrafts = [...drafts];
  nextDrafts[existingIndex] = draft;
  return nextDrafts;
}

function photoDataUri(photoBytesBase64?: string): string {
  return photoBytesBase64 ? `data:image/jpeg;base64,${photoBytesBase64}` : "";
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
