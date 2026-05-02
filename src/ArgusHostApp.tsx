import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MarketplaceDemoApp from "../apps/marketplace-demo/src/App";
import VerifierApp from "../apps/verifier-web/src/App";

type DemoMode = "marketplace" | "verifier";

export default function ArgusHostApp() {
  const [mode, setMode] = useState<DemoMode>("marketplace");
  const CurrentDemo = mode === "marketplace" ? MarketplaceDemoApp : VerifierApp;

  return (
    <View style={styles.host}>
      <View style={styles.switcher}>
        <DemoButton
          label="Marketplace"
          isActive={mode === "marketplace"}
          onPress={() => setMode("marketplace")}
        />
        <DemoButton
          label="Verifier"
          isActive={mode === "verifier"}
          onPress={() => setMode("verifier")}
        />
      </View>
      <View style={styles.demo}>
        <CurrentDemo />
      </View>
    </View>
  );
}

function DemoButton({
  label,
  isActive,
  onPress,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={isActive ? styles.activeButton : styles.button}
    >
      <Text style={isActive ? styles.activeButtonText : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: {
    backgroundColor: "#ffffff",
    flex: 1,
  },
  switcher: {
    borderBottomColor: "#d9dee7",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 10,
  },
  button: {
    alignItems: "center",
    borderColor: "#d9dee7",
    borderRadius: 6,
    borderWidth: 1,
    flex: 1,
    minHeight: 40,
    justifyContent: "center",
  },
  activeButton: {
    alignItems: "center",
    backgroundColor: "#111827",
    borderColor: "#111827",
    borderRadius: 6,
    borderWidth: 1,
    flex: 1,
    minHeight: 40,
    justifyContent: "center",
  },
  buttonText: {
    color: "#374151",
    fontSize: 14,
    fontWeight: "800",
  },
  activeButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  demo: {
    flex: 1,
  },
});
