import React from "react";
import { Text, View } from "react-native";
import {
  getArgusEvidenceLevelLabel,
  getArgusProofLevel,
  isArgusLocalDemoProof,
  isArgusProductionProof,
} from "./proofStatus";
import type { ArgusProof } from "./types";

type ArgusProofSummaryProps = {
  proof?: ArgusProof | null;
};

// kr: ArgusProofSummary는 proof가 없으면 pending으로 두고, production/demo/unverified claim마다 다른 요약 라벨을 사용합니다.
// en: ArgusProofSummary stays pending without a proof and uses separate labels for production, demo, and unverified claims.
export function ArgusProofSummary({ proof }: ArgusProofSummaryProps) {
  if (!proof) {
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ color: "#667085", fontSize: 13 }}>No capture proof yet.</Text>
      </View>
    );
  }

  const proofLevel = getArgusProofLevel(proof);
  const evidenceLevel = getArgusEvidenceLevelLabel(proof);
  const evidenceLevelValue = evidenceLevel ?? proofLevel;
  const isProductionVerified = isArgusProductionProof(proof);
  const isLocalDemoProof = isArgusLocalDemoProof(proof);
  const isTrustedOrPreviewProof = isProductionVerified || isLocalDemoProof;

  return (
    <View style={{ gap: 10 }}>
      <ProofRow
        label={
          isLocalDemoProof
            ? "Local demo preview proof ID"
            : isProductionVerified
              ? "Proof ID"
              : "Claimed proof ID"
        }
        value={shorten(proof.proofId)}
      />
      <ProofRow
        label={
          isProductionVerified
            ? "Manifest hash"
            : isLocalDemoProof
              ? "Preview manifest hash"
              : "Claimed manifest hash"
        }
        value={shorten(proof.manifestHash)}
      />
      <ProofRow
        label={
          isProductionVerified
            ? "Reported transaction reference"
            : isLocalDemoProof
              ? "Simulated preview transaction reference"
              : "Claimed transaction reference"
        }
        value={shorten(proof.solanaTx)}
      />
      <ProofRow
        label={
          isProductionVerified
            ? "Evidence level"
            : isLocalDemoProof
              ? "Preview evidence level"
              : "Claimed evidence level"
        }
        value={
          isTrustedOrPreviewProof
            ? evidenceLevelValue ?? "missing"
            : evidenceLevelValue
              ? `${evidenceLevelValue} (not verified)`
              : "missing"
        }
      />
    </View>
  );
}

function ProofRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ borderTopColor: "#d9dee7", borderTopWidth: 1, paddingTop: 8 }}>
      <Text style={{ color: "#667085", fontSize: 12, fontWeight: "700" }}>{label}</Text>
      <Text style={{ color: "#111827", fontFamily: "monospace", fontSize: 13 }}>{value}</Text>
    </View>
  );
}

function shorten(value?: string): string {
  if (!value) {
    return "pending";
  }

  if (value.length <= 24) {
    return value;
  }

  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}
