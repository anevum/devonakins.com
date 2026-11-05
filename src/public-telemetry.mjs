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

export function projectPublicTelemetry(snapshot, github, now = new Date()) {
  return {
    version: 1,
    generatedAt: now.toISOString(),
    gpt: projectHistoricalGpt(snapshot),
    development: github,
  };
}
