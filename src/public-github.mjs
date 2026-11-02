/**
 * DevonAkins.com public GitHub signal. Only the public user endpoint is fetched.
 * Never forwards GitHub's raw profile (emails, links, identifiers), secrets,
 * browser cookies or visitor request metadata to the upstream service.
 */
export const GITHUB_SIGNAL_URL = "https://api.github.com/users/anevum";
export const GITHUB_SIGNAL_CACHE_KEY = "https://devonakins.com/v2/github-profile.json";
export const GITHUB_SIGNAL_MAX_AGE_MS = 60 * 60 * 1000;
const RETRY_DELAY_MS = 60 * 1000;
const MAX_PROFILE_BYTES = 64_000;
const MAX_SAFE_COUNT = 1_000_000;

export function normalizeGitHubProfile(raw, observedAt) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      raw.login !== "anevum" || raw.type !== "User" ||
      !Number.isSafeInteger(raw.public_repos) ||
      raw.public_repos < 0 || raw.public_repos > MAX_SAFE_COUNT) {
    throw new Error("Unexpected GitHub public profile");
  }
  if (typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error("Invalid observation time");
  }
  return {
    version: 1,
    account: "anevum",
    metric: "public-repositories",
    count: raw.public_repos,
    asOf: observedAt,
    source: "GitHub REST API",
    attestation: "public-provider-response",
  };
}

export function validGitHubSignal(value, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "account,asOf,attestation,count,metric,source,version" ||
      value.version !== 1 || value.account !== "anevum" ||
      value.metric !== "public-repositories" ||
      value.source !== "GitHub REST API" ||
      value.attestation !== "public-provider-response" ||
      !Number.isSafeInteger(value.count) ||
      value.count < 0 || value.count > MAX_SAFE_COUNT ||
      typeof value.asOf !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.asOf)) return false;
  const observed = Date.parse(value.asOf);
  return Number.isFinite(observed) && observed <= now + 300_000 &&
    now - observed >= -300_000 && now - observed < GITHUB_SIGNAL_MAX_AGE_MS;
}

export function createGitHubPublicSignal({
  fetchProfile = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  let current = null;
  let pending = null;
  let retryAfter = 0;
  async function load(cache, waitUntil) {
    const timestamp = now();
    if (current && validGitHubSignal(current, timestamp)) return current;
    if (cache?.match) {
      try {
        const hit = await cache.match(GITHUB_SIGNAL_CACHE_KEY);
        if (hit?.ok && Number(hit.headers.get("content-length") || 0) < 2048) {
          const text = await hit.text();
          if (text.length < 2048) {
            const parsed = JSON.parse(text);
            if (validGitHubSignal(parsed, now())) {
              current = parsed;
              return parsed;
            }
          }
        }
      } catch {
        // A missing or incompatible edge cache never prevents a fresh read.
      }
    }
    if (now() < retryAfter) return null;
    if (!pending) {
      pending = (async () => {
        try {
          const response = await fetchProfile(GITHUB_SIGNAL_URL, {
            method: "GET",
            headers: {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "DevonAkins-Public-Observatory",
            },
            redirect: "error",
            signal: AbortSignal.timeout(4500),
          });
          if (!response.ok || !response.headers.get("content-type")?.includes("json") ||
              Number(response.headers.get("content-length") || 0) > MAX_PROFILE_BYTES) {
            throw new Error("GitHub public response unavailable");
          }
          const body = await response.text();
          if (body.length > MAX_PROFILE_BYTES) throw new Error("GitHub public response too large");
          const normalized = normalizeGitHubProfile(JSON.parse(body), new Date(now()).toISOString());
          current = normalized;
          if (cache?.put) {
            const publicResponse = new Response(JSON.stringify(normalized), {
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "public, max-age=3600",
              },
            });
            try {
              const operation = cache.put(GITHUB_SIGNAL_CACHE_KEY, publicResponse);
              if (typeof waitUntil === "function") waitUntil(Promise.resolve(operation).catch(() => {}));
              else await operation;
            } catch {
              // The in-isolate cache still protects bursts when edge caching fails.
            }
          }
          return normalized;
        } catch {
          retryAfter = now() + RETRY_DELAY_MS;
          return null;
        } finally {
          pending = null;
        }
      })();
    }
    return pending;
  }
  return {load};
}
