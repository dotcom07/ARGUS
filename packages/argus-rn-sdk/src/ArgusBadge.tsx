import React from "react";
import { Text, View } from "react-native";
import { isArgusLocalDemoProof, isArgusProductionProof } from "./proofStatus";
import type { ArgusProof } from "./types";

type ArgusBadgeProps = {
  proof?: ArgusProof | null;
};

// kr: ArgusBadge는 proof가 없을 때 pending을 보여주고, production app_capture만 Verified Capture로 표시합니다.
// en: ArgusBadge shows pending before any proof exists and labels only production app_capture as Verified Capture.
export function ArgusBadge({ proof }: ArgusBadgeProps) {
  const isVerified = isArgusProductionProof(proof);
  const isDemo = isArgusLocalDemoProof(proof);
  const hasProof = Boolean(proof);
  const label = isVerified
    ? "Verified Capture"
    : isDemo
      ? "Demo Preview"
      : hasProof
        ? "Capture Not Verified"
        : "Capture Pending";
  const backgroundColor = isVerified ? "#0f7b5f" : isDemo ? "#7c5c2e" : "#6b7280";

  return (
    <View style={{ backgroundColor, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4 }}>
      <Text style={{ color: "white", fontSize: 12, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}
