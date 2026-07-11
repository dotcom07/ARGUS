import { timingSafeEqual } from "node:crypto";

const DEFAULT_RATE_LIMITS = Object.freeze({
  "capture-session": { limit: 10, windowMs: 60_000 },
  "mcu-capture": { limit: 10, windowMs: 60_000 },
  "register-proof": { limit: 6, windowMs: 60_000 },
  "proof-read": { limit: 60, windowMs: 60_000 },
});
const buckets = new Map();

export class ArgusHttpError extends Error {
  constructor(statusCode, message, headers = {}) {
    super(message);
    this.name = "ArgusHttpError";
    this.statusCode = statusCode;
    this.headers = headers;
  }
}

export function assertApiAuthentication(request) {
  const expectedToken = process.env.ARGUS_API_AUTH_TOKEN || process.env.ARGUS_CAPTURE_SESSION_API_TOKEN;
  const production = process.env.NODE_ENV?.trim().toLowerCase() === "production";

  if (!expectedToken) {
    if (production) {
      throw new ArgusHttpError(500, "ARGUS_API_AUTH_TOKEN is required in production");
    }
    return;
  }

  const provided = request.headers.authorization;
  const prefix = "Bearer ";
  if (typeof provided !== "string" || !provided.startsWith(prefix)) {
    throw new ArgusHttpError(401, "Argus API authentication is required", {
      "www-authenticate": "Bearer",
    });
  }

  const candidate = Buffer.from(provided.slice(prefix.length), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
    throw new ArgusHttpError(401, "Argus API authentication failed", {
      "www-authenticate": "Bearer",
    });
  }
}

export function assertRateLimit(request, routeName) {
  const policy = rateLimitPolicy(routeName);
  const key = `${routeName}:${clientAddress(request)}`;
  const nowMs = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAtMs <= nowMs) {
    buckets.set(key, { count: 1, resetAtMs: nowMs + policy.windowMs });
    return;
  }

  bucket.count += 1;
  if (bucket.count <= policy.limit) {
    return;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / 1000));
  throw new ArgusHttpError(429, "Argus relayer rate limit exceeded", {
    "retry-after": `${retryAfterSeconds}`,
  });
}

export function clearRateLimits() {
  buckets.clear();
}

function rateLimitPolicy(routeName) {
  const defaults = DEFAULT_RATE_LIMITS[routeName] || DEFAULT_RATE_LIMITS["proof-read"];
  const envPrefix = `ARGUS_RATE_LIMIT_${routeName.toUpperCase().replaceAll("-", "_")}`;
  const limit = Number.parseInt(process.env[`${envPrefix}_COUNT`] || `${defaults.limit}`, 10);
  const windowMs = Number.parseInt(process.env[`${envPrefix}_WINDOW_MS`] || `${defaults.windowMs}`, 10);
  if (!Number.isSafeInteger(limit) || limit <= 0 || !Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new ArgusHttpError(500, `${envPrefix} configuration is invalid`);
  }
  return { limit, windowMs };
}

function clientAddress(request) {
  if (process.env.ARGUS_TRUST_PROXY === "true") {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",", 1)[0].trim();
    }
  }
  return request.socket.remoteAddress || "unknown";
}
