export function buildRelayerEndpointUrl(relayerBaseUrl: string, endpointPath: string): string | null {
  try {
    // kr: relayer URL은 session nonce와 proof bundle이 나가는 trust root입니다. parser가 `https:host/path`를 고치게 두지 않습니다.
    // en: The relayer URL is the trust root for nonce and proof-bundle submission; do not let the parser repair `https:host/path`.
    if (!hasAbsoluteUrlAuthority(relayerBaseUrl) || hasRawPathTraversalSegments(relayerBaseUrl)) {
      return null;
    }

    const parsed = new URL(relayerBaseUrl);
    if (!isSafeRelayerBaseUrl(parsed)) {
      return null;
    }

    const basePath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${basePath}${endpointPath}`;
  } catch {
    return null;
  }
}

function isSafeRelayerBaseUrl(url: URL): boolean {
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    return false;
  }

  return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function hasAbsoluteUrlAuthority(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function hasRawPathTraversalSegments(value: string): boolean {
  const path = rawPathFromAbsoluteUrl(value);
  if (path === null) {
    return false;
  }

  // kr: raw slash/backslash path가 relayer endpoint 경계입니다. URL parser/proxy normalization 전에 traversal을 막습니다.
  // en: The raw slash/backslash path is the relayer endpoint boundary; block traversal before URL parser/proxy normalization.
  return [path, path.replace(/%2f|%5c/gi, "/")].some((candidatePath) =>
    candidatePath.split(/[\\/]/).some((segment) => {
      const normalizedSegment = segment.replace(/%2e/gi, ".");
      return normalizedSegment === "." || normalizedSegment === "..";
    }),
  );
}

function rawPathFromAbsoluteUrl(value: string): string | null {
  const schemeSeparatorIndex = value.indexOf("://");
  if (schemeSeparatorIndex === -1) {
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

function rawPathFromIndex(value: string, pathStartIndex: number): string {
  const queryStartIndex = value.indexOf("?", pathStartIndex);
  const hashStartIndex = value.indexOf("#", pathStartIndex);
  const pathEndIndex = [queryStartIndex, hashStartIndex]
    .filter((index) => index !== -1)
    .reduce((lowest, index) => Math.min(lowest, index), value.length);

  return value.slice(pathStartIndex, pathEndIndex);
}
