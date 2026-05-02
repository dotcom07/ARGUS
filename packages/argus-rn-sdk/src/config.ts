import type { ArgusConfig } from "./types";

let activeConfig: ArgusConfig | null = null;

// kr: configure는 파트너 앱이 relayer/verifier 주소를 한 번 설정하는 SDK 함수입니다.
// en: configure lets a partner app set relayer and verifier endpoints once.
export function configure(config: ArgusConfig): void {
  activeConfig = config;
}

// kr: getConfig는 capture/verify helper가 현재 SDK 설정을 읽는 내부 함수입니다.
// en: getConfig is an internal helper used by capture/verify helpers to read SDK configuration.
export function getConfig(): ArgusConfig {
  if (!activeConfig) {
    throw new Error("Argus SDK is not configured");
  }

  return activeConfig;
}
