import React from "react";
import { Platform, StatusBar, StyleSheet, View } from "react-native";
import MarketplaceDemoApp from "../apps/marketplace-demo/src/App";

const androidStatusBarOffset = Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0;

export default function ArgusHostApp() {
  return (
    <View style={styles.host}>
      <MarketplaceDemoApp />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    backgroundColor: "#ffffff",
    flex: 1,
    paddingTop: androidStatusBarOffset,
  },
});
