import React, { useEffect, useState } from "react";
import { AppRegistry, Linking } from "react-native";
import App from "./src/App";
import { name as appName } from "./app.json";

const ARGUS_PROOF_ID_PATTERN = /^[0-9a-f]{64}$/;
const ARGUS_DEFAULT_VERIFIER_ORIGIN = "https://verify.argus.dev";
const ARGUS_LOCAL_ORIGIN = "https://argus.local";
const PROOF_ID_QUERY_PREFIX = "?proofId=";
const LOCAL_DEMO_QUERY_ROUTE_PREFIX = "../verifier-web/index.html?proofId=";

function VerifierRoot() {
  const [proofRoute, setProofRoute] = useState({});

  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      const initialProofRoute = extractProofRoute(url);
      if (initialProofRoute) {
        setProofRoute(initialProofRoute);
      }
    });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      const nextProofRoute = extractProofRoute(url);
      if (nextProofRoute) {
        setProofRoute(nextProofRoute);
      }
    });

    return () => subscription.remove();
  }, []);

  return React.createElement(App, proofRoute);
}

export function extractProofId(url) {
  return extractProofRoute(url)?.proofId;
}

export function extractProofRoute(url) {
  if (!url) {
    return undefined;
  }

  const rawUrl = String(url);

  if (hasRawPathTraversalSegments(rawUrl) && !isExactLocalDemoQueryRoute(rawUrl)) {
    return undefined;
  }

  // kr: deep link에 scheme이 있으면 `scheme://authority` 형태만 받습니다. parser가 고쳐 준 URL은 사용자가 연 trust root를 숨길 수 있습니다.
  // en: Deep links with a scheme must use `scheme://authority`; parser-repaired URLs can hide the trust root the user actually opened.
  if (hasSchemeWithoutAuthority(rawUrl)) {
    return undefined;
  }

  try {
    const parsed = new URL(rawUrl, "https://argus.local");
    const proofRoute = proofRouteFromUrl(parsed);
    return isArgusProofId(proofRoute?.proofId) ? proofRoute : undefined;
  } catch {
    return undefined;
  }
}

function proofRouteFromUrl(parsed) {
  if (parsed.hash !== "" || parsed.username !== "" || parsed.password !== "") {
    return undefined;
  }

  if (parsed.protocol === "argus:" && parsed.hostname === "verify") {
    if (parsed.search !== "") {
      return undefined;
    }

    const directProofId = proofIdFromExactPath(parsed.pathname, "/");
    if (directProofId) {
      return { proofId: directProofId };
    }

    const localSimulatorProofId = proofIdFromExactPath(parsed.pathname, "/local-simulator/");
    if (localSimulatorProofId) {
      return { proofId: localSimulatorProofId };
    }

    return undefined;
  }

  if (!isTrustedWebVerifierUrl(parsed)) {
    return undefined;
  }

  const queryProofId = proofIdFromQueryRoute(parsed);
  if (queryProofId) {
    return { proofId: queryProofId };
  }

  if (parsed.search !== "") {
    return undefined;
  }

  const proofId = proofIdFromExactPath(parsed.pathname, "/proof/");
  if (proofId) {
    return { proofId, verifierBaseUrl: parsed.origin };
  }

  const currentBasePath = currentVerifierBasePathForOrigin(parsed.origin);
  if (!currentBasePath) {
    return undefined;
  }

  const basePathProofId = proofIdFromExactPath(parsed.pathname, `${currentBasePath}/proof/`);
  if (basePathProofId) {
    return { proofId: basePathProofId, verifierBaseUrl: `${parsed.origin}${currentBasePath}` };
  }

  return undefined;
}

function proofIdFromQueryRoute(parsed) {
  if (
    parsed.origin === ARGUS_LOCAL_ORIGIN &&
    parsed.pathname === "/verifier-web/index.html" &&
    parsed.search.startsWith(PROOF_ID_QUERY_PREFIX)
  ) {
    return parsed.search.slice(PROOF_ID_QUERY_PREFIX.length);
  }

  return undefined;
}

function isTrustedWebVerifierUrl(parsed) {
  return (
    parsed.username === "" &&
    parsed.password === "" &&
    (parsed.origin === ARGUS_DEFAULT_VERIFIER_ORIGIN ||
      parsed.origin === ARGUS_LOCAL_ORIGIN ||
      ((parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopbackHost(parsed.hostname)))
  );
}

function proofIdFromExactPath(pathname, prefix) {
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }

  const proofId = pathname.slice(prefix.length);
  return proofId !== "" && !proofId.includes("/") ? proofId : undefined;
}

function currentVerifierBasePathForOrigin(origin) {
  const location = globalThis.location;
  if (!location || location.origin !== origin || typeof location.pathname !== "string") {
    return undefined;
  }

  const routeBasePath = basePathFromProofRoutePath(location.pathname);
  if (routeBasePath !== undefined) {
    return routeBasePath;
  }

  if (location.pathname.endsWith("/index.html")) {
    return location.pathname.slice(0, -"/index.html".length).replace(/\/+$/, "");
  }

  return location.pathname.replace(/\/+$/, "");
}

function basePathFromProofRoutePath(pathname) {
  const routeMarker = "/proof/";
  const routeMarkerIndex = pathname.lastIndexOf(routeMarker);
  if (routeMarkerIndex <= 0) {
    return undefined;
  }

  const proofId = pathname.slice(routeMarkerIndex + routeMarker.length);
  return isArgusProofId(proofId) && !proofId.includes("/") ? pathname.slice(0, routeMarkerIndex) : undefined;
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function hasSchemeWithoutAuthority(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) && !hasAbsoluteUrlAuthority(value);
}

function hasAbsoluteUrlAuthority(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function hasRawPathTraversalSegments(value) {
  const path = rawPathFromAbsoluteUrl(value);
  if (path === null) {
    return false;
  }

  // kr: raw slash/backslash path가 trust boundary입니다. parser가 정규화하기 전에 traversal만 fail-closed로 막습니다.
  // en: The raw slash/backslash path is the trust boundary; fail closed on traversal before parser normalization.
  return [path, path.replace(/%2f|%5c/gi, "/")].some((candidatePath) =>
    candidatePath.split(/[\\/]/).some((segment) => {
      const normalizedSegment = segment.replace(/%2e/gi, ".");
      return normalizedSegment === "." || normalizedSegment === "..";
    }),
  );
}

function rawPathFromAbsoluteUrl(value) {
  const schemeSeparatorIndex = value.indexOf("://");
  if (schemeSeparatorIndex === -1) {
    // No-`://` verifier links still pass through WHATWG URL normalization, so inspect their raw path too.
    return rawPathFromIndex(value, 0);
  }

  const authorityStartIndex = schemeSeparatorIndex + 3;
  const slashPathStartIndex = value.indexOf("/", authorityStartIndex);
  const backslashPathStartIndex = value.indexOf("\\", authorityStartIndex);
  const pathStartCandidates = [slashPathStartIndex, backslashPathStartIndex].filter(
    (index) => index !== -1,
  );
  if (pathStartCandidates.length === 0) {
    return "";
  }

  const pathStartIndex = Math.min(...pathStartCandidates);
  return rawPathFromIndex(value, pathStartIndex);
}

function rawPathFromIndex(value, pathStartIndex) {
  const queryStartIndex = value.indexOf("?", pathStartIndex);
  const hashStartIndex = value.indexOf("#", pathStartIndex);
  const pathEndIndex = [queryStartIndex, hashStartIndex]
    .filter((index) => index !== -1)
    .reduce((lowest, index) => Math.min(lowest, index), value.length);

  return value.slice(pathStartIndex, pathEndIndex);
}

function isArgusProofId(value) {
  return typeof value === "string" && ARGUS_PROOF_ID_PATTERN.test(value) && !/^0{64}$/.test(value);
}

function isExactLocalDemoQueryRoute(value) {
  if (!value.startsWith(LOCAL_DEMO_QUERY_ROUTE_PREFIX)) {
    return false;
  }

  return isArgusProofId(value.slice(LOCAL_DEMO_QUERY_ROUTE_PREFIX.length));
}

AppRegistry.registerComponent(appName, () => VerifierRoot);
