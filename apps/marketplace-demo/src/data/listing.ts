export type MarketplaceListing = {
  listingId: string;
  id: string;
  title: string;
  category: string;
  condition: string;
  price: string;
  photoUrl: string;
  offerLabel: string;
  shipping: string;
  seller: {
    name: string;
    score: string;
    positiveRate: string;
    location: string;
  };
};

export type CaptureProof = {
  proofId: string;
  manifestHash: string;
  solanaTx: string;
  evidence: string[];
  limitations: string[];
};

// kr: listing은 marketplace 화면에 표시할 중고 상품 정보를 담습니다.
// en: listing holds the used-item details shown on the marketplace screen.
export const listing: MarketplaceListing = {
  listingId: "ebay-argus-camera-001",
  id: "ebay-argus-camera-001",
  title: "Vintage Kodak Instamatic camera and 35mm film set",
  category: "Cameras & Photo",
  condition: "Used - Excellent",
  price: "$74.00",
  photoUrl: "https://images.unsplash.com/photo-1602140829587-6ec082f87e49?auto=format&fit=crop&w=900&q=80",
  offerLabel: "Buy It Now or Best Offer",
  shipping: "Free 3 day shipping from Portland, OR",
  seller: {
    name: "PDXCameraShelf",
    score: "1,842 sales",
    positiveRate: "99.2% positive",
    location: "Portland, OR",
  },
};

// kr: captureProof는 RN preview 상태를 설명하기 위한 고정 demo 예시이며 production Verified Capture로 표시하면 안 됩니다.
// en: captureProof is a fixed demo example for the RN preview state and must not be shown as production Verified Capture.
export const captureProof: CaptureProof = {
  proofId: "argus-proof-7f91b7a0c38e",
  manifestHash: "92b71b4a0df53890d688ff201ea95af6e2bcbf4b65a621b347e2e086e9c1a4bd",
  solanaTx: "5mJ9B3QqkQdYxwC8vVc1rgxAx7Kg6GkWSCJ5vArLxkYt",
  evidence: [
    "Native camera evidence commitment required; local previews simulate it",
    "Motion snapshot commitment required; local previews simulate it",
    "App identity hash required; local previews simulate it",
    "Public key evidence required for Level 3 verification; local previews omit it",
    "Trusted device attestation (Level 4) requires a configured and validated trusted root/fingerprint; local previews keep Level 2/3 fallback labeled",
    "Authorized production relayer fee payer, sponsored gas, and production-pinned registry record required; local previews do not create them",
  ],
  limitations: [
    "Does not prove seller ownership",
    "Does not prove the physical scene was not staged",
    "Does not perform image forensics or detect AI images submitted outside Argus capture",
    "Does not fully prevent rooted, emulated, or mock-camera environments",
    "Does not store the raw image on-chain",
  ],
};
