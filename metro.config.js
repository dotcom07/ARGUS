import { getDefaultConfig, mergeConfig } from "@react-native/metro-config";
import path from "node:path";

const config = {
  watchFolders: [
    path.resolve("apps"),
    path.resolve("packages"),
  ],
};

export default mergeConfig(getDefaultConfig(import.meta.dirname), config);
