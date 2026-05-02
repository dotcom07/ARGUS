import React from "react";
import { Pressable, Text } from "react-native";
import { getSafeArgusVerificationUrl, isArgusLocalDemoProof, isArgusProductionProof } from "./proofStatus";
import type { ArgusProof } from "./types";

type ArgusProofLinkProps = {
  proof?: ArgusProof | null;
  onOpen(url: string): void;
};

// kr: ArgusProofLink는 proof가 없으면 pending, proof/URL이 맞지 않으면 unavailable로 나눠 링크 오픈을 막습니다.
// en: ArgusProofLink separates no-proof pending from unsafe/unverified links and opens only matched verifier URLs.
export function ArgusProofLink({ proof, onOpen }: ArgusProofLinkProps) {
  const safeVerificationUrl = getSafeArgusVerificationUrl(proof);
  const isProductionVerified = isArgusProductionProof(proof);
  const isDemo = isArgusLocalDemoProof(proof);
  const hasProof = Boolean(proof);
  const isDisabled = !safeVerificationUrl || (!isProductionVerified && !isDemo);
  const label = !hasProof
    ? "Verifier pending"
    : isDisabled
      ? "Verifier unavailable"
      : isDemo
        ? "Open demo verifier"
        : "Open verifier";

  return (
    <Pressable
      disabled={isDisabled}
      onPress={() => {
        if (!isDisabled && safeVerificationUrl) {
          onOpen(safeVerificationUrl);
        }
      }}
      style={{
        backgroundColor: isDisabled ? "#9aa3af" : isDemo ? "#7c5c2e" : "#0f7b5f",
        borderRadius: 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <Text style={{ color: "white", fontSize: 14, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}
