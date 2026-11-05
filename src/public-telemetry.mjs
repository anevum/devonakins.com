/**
 * Public, privacy-reduced telemetry projection.
 *
 * This is NOT an OpenAI account connection. Historical ChatGPT figures retain
 * their original capture date. GitHub is a separate public development signal.
 */
const types = new Map([
  ["PushEvent", "push"],
  ["PullRequestEvent", "pull request"],
  ["ReleaseEvent", "release"],
]);
const iso = value => typeof value === "string" && !Number.isNaN(Date.parse(value))
  ? new Date(value).toISOString() : null;
const safeDay = value => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;

export function projectHistoricalGpt(snapshot) {
  if (!snapshot || snapshot.version !== 1 ||
    snapshot.metric !== "work-codex-tokens" ||
    snapshot.attestation !== "owner-published" ||
    snapshot.approximate !== true ||
    !Number.isSafeInteger(snapshot.count) || snapshot.count < 0 ||
    !safeDay(snapshot.asOf) ||
    Date.parse(snapshot.asOf + "T00:00:00Z") > Date.now() + 86400000) {
    throw new Error("Invalid historical GPT source");
  }
  // An explicit allowlist prevents private profile fields ever crossing the API.
  return {
    metric: "work-codex-tokens",
    count: snapshot.count,
    approximate: true,
    asOf: snapshot.asOf,
    source: "owner-published ChatGPT profile capture",
    scope: "historical Work/Codex profile tokens; not API usage or live messages",
    freshness: "historical",
  };
}

export function projectPublicGithubEvents(events, now = new Date()) {
  if (!Array.isArray(events) || events.length > 100)
    throw new Error("Unexpected public GitHub response");
  const until = now.getTime() + 60_000;
  const earliest = now.getTime() - 30 * 86400000;
  const observed = events
    .filter(e => e && e.public === true && types.has(e.type))
    .map(e => ({at: iso(e.created_at), kind: types.get(e.type)}))
    .filter(e => e.at && Date.parse(e.at) >= earliest && Date.parse(e.at) <= until)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  return {
    source: "GitHub public events API",
    scope: "latest event found among up to 30 public profile events; not all work",
    freshness: "current",
    checkedAt: now.toISOString(),
    status: observed ? "available" : "no-recent-public-development",
    latestActivityAt: observed?.at ?? null,
    latestActivityKind: observed?.kind ?? null,
  };
}

export function unavailablePublicGithub(now = new Date()) {
  return {
    source: "GitHub public events API",
    scope: "latest event found among up to 30 public profile events; not all work",
    freshness: "unavailable",
    checkedAt: now.toISOString(),
    status: "unavailable",
    latestActivityAt: null,
    latestActivityKind: null,
  };
}

/**
 * Validate the exact public envelope before reusing an edge-cached record.
 * GitHub API event payloads and cache entries must never become arbitrary HTML
 * or carry raw account/repository content into a public response.
 */
export function validPublicGithubSignal(value, now = new Date()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = [
    "checkedAt", "freshness", "latestActivityAt", "latestActivityKind",
    "scope", "source", "status",
  ].sort();
  if (Object.keys(value).sort().join("|") !== keys.join("|") ||
      value.source !== "GitHub public events API" ||
      value.scope !== "latest event found among up to 30 public profile events; not all work" ||
      typeof value.checkedAt !== "string" ||
      !Number.isFinite(Date.parse(value.checkedAt)) ||
      new Date(value.checkedAt).toISOString() !== value.checkedAt ||
      Date.parse(value.checkedAt) > now.getTime() + 60_000) return false;
  if (value.freshness === "unavailable") {
    return value.status === "unavailable" &&
      value.latestActivityAt === null && value.latestActivityKind === null;
  }
  if (value.freshness !== "current") return false;
  if (value.status === "no-recent-public-development") {
    return value.latestActivityAt === null && value.latestActivityKind === null;
  }
  if (value.status !== "available" ||
      !["push", "pull request", "release"].includes(value.latestActivityKind) ||
      typeof value.latestActivityAt !== "string" ||
      !Number.isFinite(Date.parse(value.latestActivityAt))) return false;
  const time = Date.parse(value.latestActivityAt);
  return new Date(value.latestActivityAt).toISOString() === value.latestActivityAt &&
    time >= now.getTime() - 30 * 86400000 - 4 * 60 * 60 * 1000 &&
    time <= now.getTime() + 60_000;
}

/**
 * Back off without additional traffic if GitHub returns 403/429. Honour
 * Retry-After / x-ratelimit-reset, clamp abusive server headers, and extend
 * the cooldown after repeated throttles. No credentials are required.
 */
export function githubCooldownMs(response, at = new Date(), failures = 1) {
  const base = 10 * 60 * 1000;
  const max = 4 * 60 * 60 * 1000;
  const count = Number.isSafeInteger(failures) ? Math.max(1, failures) : 1;
  let requested = base * Math.pow(2, Math.min(count - 1, 5));
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = /^\\d{1,8}$/.test(retryAfter) ? Number(retryAfter) : NaN;
    const until = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - at.getTime();
    if (Number.isFinite(until)) requested = Math.max(requested, until);
  }
  const reset = response.headers.get("x-ratelimit-reset");
  if (reset && /^\\d{9,12}$/.test(reset)) {
    requested = Math.max(requested, Number(reset) * 1000 - at.getTime());
  }
  return Math.min(max, Math.max(base, requested));
}

export function projectPublicTelemetry(snapshot, github, now = new Date()) {
  return {
    version: 1,
    generatedAt: now.toISOString(),
    gpt: projectHistoricalGpt(snapshot),
    development: github,
  };
}
