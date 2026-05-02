const DEFAULT_PARTNER_APP_ALLOWLIST = Object.freeze([
  {
    partnerId: "recommerce-demo",
    useCases: ["marketplace_listing"],
    appIdentityHashes: [
      "c5f00555103b31cc35ccbd6119db30b93d1a8244302361acca205c01ff7d247e",
    ],
  },
]);

export function assertPartnerAppAuthorized({
  partnerId,
  useCase,
  appIdentityHash,
  allowDefaultPolicy = true,
}) {
  const policies = loadPartnerPolicies({ allowDefaultPolicy });
  const partnerPolicy = policies.get(partnerId);
  if (!partnerPolicy) {
    throw new Error("partnerId is not authorized by this relayer");
  }

  if (!partnerPolicy.useCases.has(useCase)) {
    throw new Error("useCase is not authorized for partnerId");
  }

  if (!partnerPolicy.appIdentityHashes.has(appIdentityHash.toLowerCase())) {
    throw new Error("appIdentityHash is not authorized for partnerId");
  }
}

function loadPartnerPolicies({ allowDefaultPolicy } = { allowDefaultPolicy: true }) {
  const configuredAllowlist = process.env.ARGUS_PARTNER_APP_ALLOWLIST;
  if (!configuredAllowlist) {
    if (!allowDefaultPolicy || !isDemoRelayerMode() || isProductionRuntime()) {
      throw new Error("ARGUS_PARTNER_APP_ALLOWLIST is required outside the demo relayer");
    }

    return buildPartnerPolicies(DEFAULT_PARTNER_APP_ALLOWLIST);
  }

  let parsedAllowlist;
  try {
    parsedAllowlist = JSON.parse(configuredAllowlist);
  } catch {
    throw new Error("ARGUS_PARTNER_APP_ALLOWLIST must be valid JSON");
  }

  if (!Array.isArray(parsedAllowlist)) {
    throw new Error("ARGUS_PARTNER_APP_ALLOWLIST must be a JSON array");
  }

  return buildPartnerPolicies(parsedAllowlist);
}

function buildPartnerPolicies(entries) {
  const policies = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("partner allowlist entries must be objects");
    }

    const partnerId = assertText("partnerId", entry.partnerId);
    // kr: array field도 policy trust root라서 Set이 중복을 조용히 합치기 전에 config 오류로 처리합니다.
    // en: Array fields are policy trust roots too; reject duplicates before Set silently merges them.
    const useCases = assertUniqueTextArray(
      "useCases",
      assertTextArray("useCases", entry.useCases),
    );
    const appIdentityHashes = assertUniqueTextArray(
      "appIdentityHashes",
      assertTextArray("appIdentityHashes", entry.appIdentityHashes).map((hash) => {
        assertHex32("appIdentityHash", hash);
        return hash.toLowerCase();
      }),
    );
    const status = entry.status ?? "active";

    if (policies.has(partnerId)) {
      // kr: partner policy는 server-side trust root라서 중복 entry가 기존 제한을 덮어쓰게 두지 않습니다.
      // en: Partner policy is a server-side trust root, so duplicate entries must not shadow earlier restrictions.
      throw new Error("partnerId appears more than once in ARGUS_PARTNER_APP_ALLOWLIST");
    }

    if (status !== "active") {
      // kr: 운영자가 disabled/revoked 상태를 적어둔 policy를 SDK session이나 registration 허가로 해석하지 않습니다.
      // en: A policy marked disabled/revoked must not be interpreted as authorizing SDK sessions or registrations.
      throw new Error("partner allowlist status must be active");
    }

    policies.set(partnerId, {
      appIdentityHashes: new Set(appIdentityHashes),
      useCases: new Set(useCases),
    });
  }

  return policies;
}

function assertText(field, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }

  return value;
}

function assertTextArray(field, value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error(`${field} must be a non-empty string array`);
  }

  return value;
}

function assertUniqueTextArray(field, value) {
  if (new Set(value).size !== value.length) {
    throw new Error(`${field} must not contain duplicate entries`);
  }

  return value;
}

function assertHex32(field, value) {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value) || /^0{64}$/.test(value)) {
    throw new Error(`${field} must be a non-zero 32-byte hex string`);
  }
}

function isProductionRuntime() {
  return process.env.NODE_ENV?.trim().toLowerCase() === "production";
}

function isDemoRelayerMode() {
  const mode = process.env.ARGUS_RELAYER_MODE;
  return mode === undefined || mode === "" || mode === "demo";
}
