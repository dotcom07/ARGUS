import { NativeModules, Platform } from "react-native";
import type { ArgusProof, CreateCaptureProofOptions } from "./types";

type NativeCreateCaptureProofOptions = CreateCaptureProofOptions & {
  appIdentityHash?: string;
  captureSessionId?: string;
  sessionNonce?: string;
};

type ArgusNativeModule = {
  createCaptureProof(options: NativeCreateCaptureProofOptions): Promise<ArgusProof>;
  getAppIdentityHash?(): Promise<string>;
};

const nativeArgus = NativeModules.Argus as ArgusNativeModule | undefined;

// kr: callNativeCreateCaptureProof는 React Native와 Kotlin Android 모듈 사이의 얇은 경계입니다.
// en: callNativeCreateCaptureProof is the thin boundary between React Native and the Kotlin Android module.
export async function callNativeCreateCaptureProof(
  options: NativeCreateCaptureProofOptions,
): Promise<ArgusProof> {
  if (Platform.OS !== "android") {
    throw new Error("Argus verified capture is Android-only for the MVP");
  }

  if (!nativeArgus) {
    throw new Error("Native Argus module is not linked");
  }

  return nativeArgus.createCaptureProof(options);
}

// kr: callNativeGetAppIdentityHash는 relayer nonce 세션을 열기 전에 Android signing digest를 읽습니다.
// en: callNativeGetAppIdentityHash reads the Android signing digest before opening a relayer nonce session.
export async function callNativeGetAppIdentityHash(): Promise<string> {
  if (Platform.OS !== "android") {
    throw new Error("Argus app identity is Android-only for the MVP");
  }

  if (!nativeArgus?.getAppIdentityHash) {
    throw new Error("Native Argus module does not expose app identity");
  }

  return nativeArgus.getAppIdentityHash();
}
