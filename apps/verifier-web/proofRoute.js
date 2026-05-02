const ARGUS_PROOF_ID_PATTERN = /^[0-9a-f]{64}$/;
const PROOF_ID_QUERY_PREFIX = "?proofId=";

export function resolveBrowserDemoProofId(location) {
  const search = typeof location?.search === "string" ? location.search : "";
  const hash = typeof location?.hash === "string" ? location.hash : "";

  if (hash !== "") {
    return undefined;
  }

  if (search === "") {
    return undefined;
  }

  return proofIdFromExactQuery(search);
}

function proofIdFromExactQuery(search) {
  if (!search.startsWith(PROOF_ID_QUERY_PREFIX)) {
    return undefined;
  }

  const proofId = search.slice(PROOF_ID_QUERY_PREFIX.length);
  return isArgusProofId(proofId) ? proofId : undefined;
}

function isArgusProofId(value) {
  return typeof value === "string" && ARGUS_PROOF_ID_PATTERN.test(value) && !/^0{64}$/.test(value);
}
