import { PUBLIC_PRESENCE_PROJECTS } from "./presence-model.mjs";
import { approvedProjects } from "./presence-preferences.mjs";

export const CLOUD_TTL_MS = 120_000;
export const CLOUD_STATES = Object.freeze([
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);
export const CLOUD_CHECKPOINTS = Object.freeze([
  "testing",
  "tests-passed",
  "building",
  "reviewing",
]);
export const CLOUD_SOURCES = Object.freeze(["codex", "chatgpt-work"]);
export const cloudTerminal = (state) =>
  ["completed", "failed", "cancelled"].includes(state);
export const exactCloudKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");
export function validCloudSignal(data, at) {
  if (
    !exactCloudKeys(data, [
      "version",
      "sequence",
      "state",
      "checkpoint",
      "projectSlug",
      "observedAt",
    ]) ||
    data.version !== 1 ||
    !Number.isSafeInteger(data.sequence) ||
    data.sequence < 1 ||
    !CLOUD_STATES.includes(data.state) ||
    !(
      data.checkpoint === null || CLOUD_CHECKPOINTS.includes(data.checkpoint)
    ) ||
    !(
      data.projectSlug === null ||
      Object.hasOwn(PUBLIC_PRESENCE_PROJECTS, data.projectSlug)
    )
  )
    return false;
  const time =
    typeof data.observedAt === "string" ? Date.parse(data.observedAt) : NaN;
  return (
    Number.isFinite(time) &&
    new Date(time).toISOString() === data.observedAt &&
    time <= at + 10_000 &&
    time > at - CLOUD_TTL_MS
  );
}
const empty = (visibility, state) => ({
  version: 1,
  visibility,
  state,
  source: null,
  project: null,
  checkpoint: null,
  asOf: null,
  expiresAt: null,
});
/** Agent-reported evidence is independent of human presence and test verification. */
export function projectCloudPresence(
  row,
  owner,
  at,
  { privateView = false, releaseApproved = false } = {},
) {
  const visibility = privateView ? "private" : "public";
  if (
    !privateView &&
    (!releaseApproved ||
      owner?.public_enabled !== 1 ||
      owner.private_work === 1 ||
      row?.public_enabled !== 1)
  )
    return empty("hidden", "not-broadcasting");
  if (
    !row ||
    row.generation !== owner?.editor_generation ||
    !row.token_hash ||
    row.token_until <= at
  )
    return empty(visibility, "no-signal");
  if (!CLOUD_SOURCES.includes(row.source) || !CLOUD_STATES.includes(row.state))
    return empty(visibility, "no-signal");
  const fresh =
    row.observed_at > at - CLOUD_TTL_MS && row.observed_at <= at + 10_000;
  if (!fresh)
    return {
      ...empty(visibility, "unknown"),
      ...(privateView ? { asOf: new Date(row.observed_at).toISOString() } : {}),
    };
  const project =
    approvedProjects(owner).includes(row.project_slug) &&
    Object.hasOwn(PUBLIC_PRESENCE_PROJECTS, row.project_slug)
      ? PUBLIC_PRESENCE_PROJECTS[row.project_slug]
      : null;
  return {
    version: 1,
    visibility,
    state: row.state,
    source: row.source,
    project,
    checkpoint: CLOUD_CHECKPOINTS.includes(row.checkpoint)
      ? row.checkpoint
      : null,
    asOf: new Date(row.observed_at).toISOString(),
    expiresAt: new Date(
      Math.min(row.observed_at + CLOUD_TTL_MS, row.token_until),
    ).toISOString(),
  };
}
