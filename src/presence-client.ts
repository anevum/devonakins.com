import {startCloudPresence} from "./cloud-presence-client";
// Public rendering only. This does not collect development activity.
const labels: Record<string, string> = {
  "not-broadcasting": "Not broadcasting",
  offline: "No current signal",
  idle: "Away",
  developing: "Developing",
  "in-the-zone": "In the Zone",
  listening: "Listening",
  "working-privately": "Working privately",
  writing: "Writing",
  researching: "Researching",
  "family-time": "Family time",
  sleeping: "Sleeping",
  away: "Away",
  custom: "Owner status",
};
type Presence = {
  version: 1;
  visibility: "hidden" | "public";
  state: string;
  asOf: string | null;
  source: string;
  project: string | null;
  label?: string;
};
const hidden: Presence = {
  version: 1,
  visibility: "hidden",
  state: "not-broadcasting",
  asOf: null,
  source: "none",
  project: null,
};
let latest: Presence = hidden;
let busy = false;
export function validPresence(value: unknown, at = Date.now()): Presence {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return hidden;
  const v = value as Presence;
  const keys =
    v.state === "custom"
      ? "asOf|label|project|source|state|version|visibility"
      : "asOf|project|source|state|version|visibility";
  if (
    Object.keys(v).sort().join("|") !== keys ||
    v.version !== 1 ||
    !Object.hasOwn(labels, v.state) ||
    !["hidden", "public"].includes(v.visibility) ||
    ![
      "none",
      "owner-manual",
      "owner-declared",
      "editor-heartbeat",
      "spotify-playback",
    ].includes(v.source) ||
    !(
      v.project === null ||
      [
        "Merit",
        "Rhen",
        "Mizvo",
        "DevonStation",
        "Squelch",
        "Anevum",
        "Brandicade",
        "Vesper",
        "Knowledge",
        "DevonAkins.com",
      ].includes(v.project)
    )
  )
    return hidden;
  if (
    v.state === "custom" &&
    (typeof v.label !== "string" ||
      !v.label.trim() ||
      v.label !== v.label.trim() ||
      v.label.length > 60 ||
      /[\p{Cc}\p{Cf}]/u.test(v.label))
  )
    return hidden;
  if (v.visibility === "hidden") return hidden;
  const noEvidence = ["offline", "idle", "working-privately"];
  if (noEvidence.includes(v.state))
    return v.source === "none" && v.asOf === null && v.project === null
      ? v
      : hidden;
  const active = ["developing", "in-the-zone"].includes(v.state);
  if (active && !["owner-declared", "editor-heartbeat"].includes(v.source))
    return hidden;
  if (v.state === "listening" && v.source !== "spotify-playback") return hidden;
  if (!active && v.state !== "listening" && v.source !== "owner-manual")
    return hidden;
  if (!active && v.project !== null) return hidden;
  const time = typeof v.asOf === "string" ? Date.parse(v.asOf) : NaN;
  const ttl = ["editor-heartbeat", "spotify-playback"].includes(v.source)
    ? 120_000
    : 30 * 60_000;
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString() !== v.asOf ||
    time > at + 10_000 ||
    at - time >= ttl
  )
    return hidden;
  return v;
}
export function renderLivePresence() {
  const value = validPresence(latest);
  const label = value.state === "custom" ? value.label! : labels[value.state];
  const source =
    value.source === "owner-declared"
      ? "Owner-declared session"
      : value.source === "editor-heartbeat"
        ? "Editor-observed activity"
        : value.source === "spotify-playback"
          ? "Spotify playback"
          : value.source === "owner-manual"
            ? "Owner-selected status"
            : "No authorized current signal";
  const time = value.asOf
    ? new Date(value.asOf).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const detail = [
    value.project,
    value.source === "owner-declared" ? "OWNER-DECLARED" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const ticker = document.querySelector<HTMLElement>("#presence-ticker");
  if (ticker) {
    ticker.dataset.mode = ["developing", "in-the-zone", "listening"].includes(
      value.state,
    )
      ? "active"
      : value.state === "working-privately"
        ? "private"
        : "hidden";
    ticker.setAttribute(
      "aria-label",
      label + (detail ? ". " + detail : "") + ". Open Live Studio.",
    );
  }
  const title = document.querySelector("#presence-ticker-label");
  if (title) title.textContent = label.toUpperCase();
  const sub = document.querySelector<HTMLElement>("#presence-ticker-detail");
  if (sub) {
    sub.hidden = !detail;
    sub.textContent = detail;
  }
  document.querySelectorAll("[data-live-presence]").forEach((el) => {
    el.textContent = label + (value.project ? " · " + value.project : "");
  });
  document.querySelectorAll("[data-live-source]").forEach((el) => {
    el.textContent = source + (time ? " · Source observed " + time : "") + ".";
  });
}
async function refresh() {
  if (busy || document.hidden) return;
  busy = true;
  try {
    const response = await fetch("/api/presence/public", {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (
      !response.ok ||
      !response.headers.get("Content-Type")?.includes("application/json")
    )
      throw new Error("Unavailable");
    latest = document.hidden ? hidden : validPresence(await response.json());
  } catch {
    latest = hidden;
  } finally {
    busy = false;
    renderLivePresence();
  }
}
export function startLivePresence() {
  startCloudPresence();
  void refresh();
  const poll = window.setInterval(() => {
    void refresh();
  }, 60_000);
  const age = window.setInterval(renderLivePresence, 5000);
  document.addEventListener("visibilitychange", () => {
    latest = hidden;
    renderLivePresence();
    if (!document.hidden) void refresh();
  });
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      clearInterval(poll);
      clearInterval(age);
    }
  });
}
