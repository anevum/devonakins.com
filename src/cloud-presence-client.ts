// Independent cloud-task rendering. Never changes the human-presence ticker.
const states: Record<string, string> = {
  running: "Task running",
  waiting: "Waiting for input",
  completed: "Task completed",
  failed: "Task failed",
  cancelled: "Task cancelled",
  unknown: "Task state unknown",
  "no-signal": "No current task signal",
  "not-broadcasting": "Not broadcasting",
};
type Cloud = {
  version: 1;
  visibility: string;
  state: string;
  source: string | null;
  project: string | null;
  checkpoint: string | null;
  asOf: string | null;
  expiresAt: string | null;
};
const hidden: Cloud = {
  version: 1,
  visibility: "hidden",
  state: "not-broadcasting",
  source: null,
  project: null,
  checkpoint: null,
  asOf: null,
  expiresAt: null,
};
const projects = [
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
];
export function validCloudPresence(value: unknown, at = Date.now()): Cloud {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return hidden;
  const v = value as Cloud;
  if (
    Object.keys(v).sort().join("|") !==
      "asOf|checkpoint|expiresAt|project|source|state|version|visibility" ||
    v.version !== 1 ||
    v.visibility !== "public" ||
    !Object.hasOwn(states, v.state)
  )
    return hidden;
  if (["no-signal", "unknown"].includes(v.state))
    return [v.source, v.project, v.checkpoint, v.asOf, v.expiresAt].every(
      (x) => x === null,
    )
      ? v
      : hidden;
  if (
    !["codex", "chatgpt-work"].includes(v.source || "") ||
    !(v.project === null || projects.includes(v.project)) ||
    !(
      v.checkpoint === null ||
      ["testing", "tests-passed", "building", "reviewing"].includes(
        v.checkpoint,
      )
    )
  )
    return hidden;
  const time = typeof v.asOf === "string" ? Date.parse(v.asOf) : NaN;
  const expiry =
    typeof v.expiresAt === "string" ? Date.parse(v.expiresAt) : NaN;
  if (
    !Number.isFinite(time) ||
    !Number.isFinite(expiry) ||
    new Date(time).toISOString() !== v.asOf ||
    new Date(expiry).toISOString() !== v.expiresAt ||
    time > at + 10000 ||
    expiry <= time ||
    expiry > time + 120000
  )
    return hidden;
  if (expiry <= at || at - time >= 120000)
    return { ...hidden, visibility: "public", state: "unknown" };
  if (
    !["running", "waiting", "completed", "failed", "cancelled"].includes(
      v.state,
    )
  )
    return hidden;
  return v;
}
export function startCloudPresence() {
  if (!document.querySelector("[data-cloud-presence]")) return;
  let latest: Cloud = hidden,
    busy = false;
  function render() {
    const v = validCloudPresence(latest);
    const title = document.querySelector("[data-cloud-presence]");
    const detail = document.querySelector("[data-cloud-source]");
    if (title)
      title.textContent =
        states[v.state] + (v.project ? " · " + v.project : "");
    if (detail)
      detail.textContent = v.source
        ? (v.source === "codex" ? "Codex" : "ChatGPT Work") +
          " · Task-reported · Last confirmed " +
          new Date(v.asOf!).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }) +
          (v.checkpoint
            ? " · Reported: " + v.checkpoint.replaceAll("-", " ")
            : "") +
          "."
        : v.state === "unknown"
          ? "Signal expired. Current task state is unknown."
          : "No authorized task signal.";
  }
  async function refresh() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const response = await fetch("/api/presence/cloud", {
        cache: "no-store",
        credentials: "omit",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (
        !response.ok ||
        !response.headers.get("Content-Type")?.includes("application/json")
      )
        throw Error("Unavailable");
      latest = document.hidden
        ? hidden
        : validCloudPresence(await response.json());
    } catch {
      latest = hidden;
    } finally {
      busy = false;
      render();
    }
  }
  void refresh();
  const poll = window.setInterval(() => {
    void refresh();
  }, 30000);
  const age = window.setInterval(render, 5000);
  document.addEventListener("visibilitychange", () => {
    latest = hidden;
    render();
    if (!document.hidden) void refresh();
  });
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      clearInterval(poll);
      clearInterval(age);
    }
  });
}
