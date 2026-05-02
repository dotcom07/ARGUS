type ArgusDemoEnv = {
  ARGUS_DEMO_BACKEND_URL?: string;
  EXPO_PUBLIC_ARGUS_DEMO_BACKEND_URL?: string;
  ARGUS_DEMO_PARTNER_ID?: string;
  ARGUS_DEMO_USE_CASE?: string;
};

declare const __ARGUS_DEMO_ENV__: ArgusDemoEnv | undefined;

const DEFAULT_ARGUS_DEMO_BACKEND_URL = "https://verify.argus.dev";
const DEFAULT_ARGUS_DEMO_PARTNER_ID = "recommerce-demo";
const DEFAULT_ARGUS_DEMO_USE_CASE = "marketplace_listing";
const argusDemoEnv: ArgusDemoEnv =
  typeof __ARGUS_DEMO_ENV__ === "undefined" ? {} : __ARGUS_DEMO_ENV__;

export const ARGUS_DEMO_BACKEND_URL =
  envValue(argusDemoEnv.ARGUS_DEMO_BACKEND_URL) ??
  envValue(argusDemoEnv.EXPO_PUBLIC_ARGUS_DEMO_BACKEND_URL) ??
  DEFAULT_ARGUS_DEMO_BACKEND_URL;
export const ARGUS_DEMO_PARTNER_ID =
  envValue(argusDemoEnv.ARGUS_DEMO_PARTNER_ID) ?? DEFAULT_ARGUS_DEMO_PARTNER_ID;
export const ARGUS_DEMO_USE_CASE =
  envValue(argusDemoEnv.ARGUS_DEMO_USE_CASE) ?? DEFAULT_ARGUS_DEMO_USE_CASE;

function envValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
