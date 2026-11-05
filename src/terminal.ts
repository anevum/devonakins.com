/**
 * DevonAkins.com V2 preview controls.
 * Public display only: no account credentials, private telemetry, analytics,
 * third-party requests, or implicit collection of browser data.
 */
type UsageSnapshot = {
  version: 1;
  metric: "work-codex-tokens";
  approximate: true;
  count: number;
  asOf: string;
  source: string;
  attestation: "owner-published";
  profile?: { stats?: { peakTokens?: number | null; currentStreakDays?: number | null } };
};

const shell = document.querySelector<HTMLElement>("#interface-shell");
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.rail-tab[role="tab"]')];
const panelByName = new Map(
  [...document.querySelectorAll<HTMLElement>("[data-panel]")].map((panel) => [
    panel.dataset.panel!,
    panel,
  ]),
);
const tablist = document.querySelector<HTMLElement>(".rail[role='tablist']");
const announcement = document.querySelector<HTMLElement>("#announcement");
const motionButton = document.querySelector<HTMLButtonElement>("#motion-toggle");
const clock = document.querySelector<HTMLTimeElement>("#system-clock");
const lightButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-light-control]")];
const engineStatus = document.querySelector<HTMLElement>("#scene-caption");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

if (!shell || !tabs.length || !tablist) {
  throw new Error("V2 interface markup is incomplete");
}

const interfaceShell = shell;
const isRoutePage = interfaceShell.dataset.routePage === "true";
const routeInitialView = interfaceShell.dataset.initialView ?? "home";
let announcementTimer = 0;
let motionPreference: "auto" | "on" | "off" = "auto";
let pointerFrame = 0;
let polling = false;

try {
  const saved = localStorage.getItem("devon-v2-motion");
  if (saved === "on" || saved === "off") motionPreference = saved;
} catch {
  // Private browsing can restrict persistent storage.
}

function announce(message: string) {
  if (!announcement) return;
  announcement.textContent = message;
  announcement.classList.add("visible");
  window.clearTimeout(announcementTimer);
  announcementTimer = window.setTimeout(() => announcement.classList.remove("visible"), 2800);
}

function validView(name: string | undefined | null): name is string {
  return Boolean(name && panelByName.has(name) && tabs.some((tab) => tab.dataset.viewTarget === name));
}

// URL fragments are untrusted input. A malformed %-escape must not break navigation.
function viewFromLocation(): string | null {
  try {
    const name = decodeURIComponent(location.hash.slice(1));
    return validView(name) ? name : null;
  } catch {
    return null;
  }
}

function activate(name: string, focus: "tab" | "panel" | "none" = "none", updateHash = true) {
  if (!validView(name)) return;
  interfaceShell.dataset.view = name;
  for (const tab of tabs) {
    const selected = tab.dataset.viewTarget === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const [key, panel] of panelByName) panel.hidden = key !== name;
  if (updateHash && location.hash !== "#" + name) {
    // Preserve Back/Forward history when navigating between interface sections.
    history.pushState(null, "", "#" + name);
  }
  if (focus === "tab") tabs.find((tab) => tab.dataset.viewTarget === name)?.focus();
  if (focus === "panel") panelByName.get(name)?.focus();
}

function navigateView(name: string, focus: "tab" | "panel") {
  // A deep-linked project or article has its own canonical URL. The main
  // navigation always returns to the actual immersive homepage sections,
  // instead of showing an unrelated tab under the deep-link URL.
  if (isRoutePage) {
    if (validView(name)) location.assign("/#" + name);
    return;
  }
  activate(name, focus);
}
for (const tab of tabs) {
  tab.addEventListener("click", () => navigateView(tab.dataset.viewTarget!, "tab"));
  tab.addEventListener("keydown", (event) => {
    const horizontal = tablist.getAttribute("aria-orientation") === "horizontal";
    const previousKey = horizontal ? "ArrowLeft" : "ArrowUp";
    const nextKey = horizontal ? "ArrowRight" : "ArrowDown";
    let index = tabs.indexOf(tab);
    if (event.key === previousKey) index = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === nextKey) index = (index + 1) % tabs.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = tabs.length - 1;
    else return;
    event.preventDefault();
    navigateView(tabs[index].dataset.viewTarget!, "tab");
  });
}
document.querySelectorAll<HTMLButtonElement>(".action[data-view-target]").forEach((button) => {
  button.addEventListener("click", () => navigateView(button.dataset.viewTarget!, "panel"));
});
function syncLocationView() {
  // #main and other native anchors must not replace deep-link content.
  if (isRoutePage) return;
  const name = viewFromLocation();
  if (name) activate(name, "none", false);
  else if (!location.hash) activate("home", "none", false);
  // Non-panel fragments, such as #main, remain valid native anchor targets.
}
window.addEventListener("hashchange", syncLocationView);
window.addEventListener("popstate", syncLocationView);
activate(isRoutePage ? (validView(routeInitialView) ? routeInitialView : "home") : (viewFromLocation() ?? "home"), "none", false);

const navLayout = matchMedia("(max-width: 960px)");
function syncOrientation() {
  tablist?.setAttribute("aria-orientation", navLayout.matches ? "horizontal" : "vertical");
}
syncOrientation();
navLayout.addEventListener("change", syncOrientation);

function motionAllowed() {
  return motionPreference === "on" || (motionPreference === "auto" && !reducedMotion.matches);
}
function resetPointerDepth() {
  if (pointerFrame) cancelAnimationFrame(pointerFrame);
  pointerFrame = 0;
  interfaceShell.style.setProperty("--scene-shift-x", "0px");
  interfaceShell.style.setProperty("--scene-shift-y", "0px");
}
function syncMotion() {
  const enabled = motionAllowed();
  interfaceShell.dataset.motion = enabled ? "on" : "off";
  if (!enabled) resetPointerDepth();
  if (motionButton) {
    // A visitor can explicitly opt into motion even when iOS Reduce Motion is on.
    // The default still follows the device's accessibility preference.
    motionButton.disabled = false;
    motionButton.textContent = enabled ? "MOTION ON" : "MOTION OFF";
    motionButton.setAttribute("aria-pressed", String(enabled));
    motionButton.title = reducedMotion.matches && motionPreference === "auto"
      ? "System Reduce Motion is on. Activate to opt into ambient animation on this site."
      : "Toggle ambient animation";
  }
}
syncMotion();
motionButton?.addEventListener("click", () => {
  motionPreference = motionAllowed() ? "off" : "on";
  try {
    localStorage.setItem("devon-v2-motion", motionPreference);
  } catch {
    // The interface works without browser storage.
  }
  syncMotion();
  announce(motionAllowed() ? "Ambient motion enabled." : "Ambient motion paused.");
});
reducedMotion.addEventListener("change", syncMotion);

// Desktop-only portrait depth. Only compositor transforms change, at most
// once per animation frame. Touch and reduced-motion sessions do no work.
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
window.addEventListener("pointermove", (event) => {
  if (!motionAllowed() || !finePointer.matches || event.pointerType !== "mouse" || document.hidden || pointerFrame)
    return;
  const x = ((event.clientX / window.innerWidth) - .5) * -16;
  const y = ((event.clientY / window.innerHeight) - .5) * -10;
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = 0;
    interfaceShell.style.setProperty("--scene-shift-x", x.toFixed(1) + "px");
    interfaceShell.style.setProperty("--scene-shift-y", y.toFixed(1) + "px");
  });
}, { passive: true });
window.addEventListener("blur", resetPointerDepth);
window.addEventListener("pointerout", (event) => {
  if (!event.relatedTarget) resetPointerDepth();
});

function refreshClock() {
  if (!clock) return;
  const now = new Date();
  clock.dateTime = now.toISOString();
  clock.textContent = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}
refreshClock();
const clockTimer = window.setInterval(() => {
  if (!document.hidden) refreshClock();
}, 30_000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshClock();
});

document.querySelector<HTMLButtonElement>("#copy-email")?.addEventListener("click", async () => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText("devon@anevum.com");
    announce("Email address copied.");
  } catch {
    announce("Clipboard unavailable. Select the address to copy.");
  }
});

function parseSnapshot(input: unknown): UsageSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Snapshot must be an object");
  const record = input as Record<string, unknown>;
  if (
    record.version !== 1 ||
    record.metric !== "work-codex-tokens" ||
    record.approximate !== true ||
    record.attestation !== "owner-published" ||
    typeof record.count !== "number" ||
    !Number.isSafeInteger(record.count) ||
    record.count < 0 ||
    typeof record.asOf !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(record.asOf) ||
    !Number.isFinite(Date.parse(record.asOf + "T00:00:00Z")) ||
    typeof record.source !== "string" ||
    !record.source.trim() ||
    record.source.length > 100
  ) throw new Error("Invalid snapshot schema");
  const date = Date.parse(record.asOf + "T00:00:00Z");
  if (new Date(date).toISOString().slice(0, 10) !== record.asOf || date > Date.now() + 86_400_000)
    throw new Error("Invalid snapshot date");
  // Optional secondary metrics must not be displayed without type validation.
  if (record.profile !== undefined) {
    if (!record.profile || typeof record.profile !== "object" || Array.isArray(record.profile))
      throw new Error("Invalid profile");
    const stats = (record.profile as Record<string, unknown>).stats;
    if (!stats || typeof stats !== "object" || Array.isArray(stats))
      throw new Error("Invalid profile metrics");
    const fields = stats as Record<string, unknown>;
    for (const key of ["peakTokens", "currentStreakDays"]) {
      const value = fields[key];
      if (value !== null && (!Number.isSafeInteger(value) || Number(value) < 0))
        throw new Error("Invalid secondary profile metric");
    }
  }
  return record as UsageSnapshot;
}

function showUsage(snapshot: UsageSnapshot) {
  const compact = new Intl.NumberFormat("en-US", {
    notation: "compact", maximumFractionDigits: 2,
  }).format(snapshot.count);
  const count = document.querySelector<HTMLElement>("#usage-value");
  if (count) {
    count.textContent = "≈" + compact;
    count.setAttribute("aria-label", "Approximately " +
      snapshot.count.toLocaleString("en-US") +
      " Work and Codex tokens in the dated profile snapshot");
  }
  const dateLabel = new Date(snapshot.asOf + "T12:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC", month: "short", day: "2-digit", year: "numeric",
  }).toUpperCase();
  const stats = snapshot.profile?.stats;
  const status = document.querySelector<HTMLElement>("#usage-status");
  const date = document.querySelector<HTMLElement>("#usage-date");
  const streak = stats?.currentStreakDays;
  const peak = stats?.peakTokens;
  if (status) {
    status.textContent = typeof streak === "number" && typeof peak === "number"
      ? streak + "D STREAK  ·  " + new Intl.NumberFormat("en-US", {
          notation: "compact", maximumFractionDigits: 1,
        }).format(peak) + " PEAK"
      : "PROFILE SNAPSHOT LOADED";
  }
  if (date) date.textContent = dateLabel + " · SNAPSHOT";
  document.querySelector<HTMLElement>(".telemetry-readout")?.setAttribute("data-feed-state", "ready");
}
async function checkUsage() {
  if (polling) return;
  const button = document.querySelector<HTMLButtonElement>("#refresh-usage");
  const status = document.querySelector<HTMLElement>("#usage-status");
  const date = document.querySelector<HTMLElement>("#usage-date");
  polling = true;
  if (button) button.disabled = true;
  document.querySelector<HTMLElement>(".telemetry-readout")?.setAttribute("data-feed-state", "loading");
  try {
    // Optional owner-maintained public file, never a private account API.
    const response = await fetch("/v2/usage-snapshot.json", {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) {
      throw new Error("Snapshot unavailable");
    }
    const snapshot = parseSnapshot(await response.json());
    showUsage(snapshot);
  } catch {
    // One public readout. Clear stale values when the snapshot is invalid.
    const count = document.querySelector<HTMLElement>("#usage-value");
    if (count) {
      count.textContent = "—";
      count.removeAttribute("aria-label");
    }
    if (status) status.textContent = "SNAPSHOT UNAVAILABLE";
    if (date) date.textContent = "CHECK SOURCE";
    document.querySelector<HTMLElement>(".telemetry-readout")?.setAttribute("data-feed-state", "unavailable");
  } finally {
    polling = false;
    if (button) button.disabled = false;
  }
}
document.querySelector<HTMLButtonElement>("#refresh-usage")?.addEventListener("click", checkUsage);
// Load a public, static first-party snapshot once at startup; no private API or polling.
void checkUsage();

// Public GitHub events remain strictly separate from historical GPT usage.
type PublicActivity = {at: string; kind: "push" | "pull request" | "release"};
type PublicActivityState = "ready" | "empty" | "unavailable";
const activityKinds = ["push", "pull request", "release"] as const;
let publicTelemetryBusy = false;
let lastPublicTelemetryCheck = 0;
let publicActivity: PublicActivity[] = [];
let publicActivityState: PublicActivityState = "unavailable";
let publicActivityFilter: "all" | PublicActivity["kind"] = "all";
let lastPublicTelemetryCheckedAt: string | null = null;

function validPublicActivity(value: unknown, now = Date.now()): value is PublicActivity[] {
  if (!Array.isArray(value) || value.length > 8) return false;
  let previous = Infinity;
  for (const event of value) {
    if (!event || typeof event !== "object" || Array.isArray(event)) return false;
    const record = event as Record<string, unknown>;
    if (Object.keys(record).sort().join("|") !== "at|kind" ||
        !activityKinds.includes(record.kind as PublicActivity["kind"]) ||
        typeof record.at !== "string") return false;
    const time = Date.parse(record.at);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== record.at ||
        time > now + 60_000 || time < now - 30 * 86400000 - 4 * 60 * 60_000 ||
        time > previous) return false;
    previous = time;
  }
  return true;
}

function renderPublicActivity() {
  const list = document.querySelector<HTMLElement>("#gpt-event-list");
  const status = document.querySelector<HTMLElement>("#gpt-event-state");
  document.querySelectorAll<HTMLButtonElement>("[data-gpt-event-filter]").forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.gptEventFilter === publicActivityFilter)));
  if (!list || !status) return;
  const panel = list.closest<HTMLElement>(".gpt-live-panel");
  if (panel) panel.dataset.sourceState = publicActivityState;
  const visible = publicActivity.filter((event) =>
    publicActivityFilter === "all" || event.kind === publicActivityFilter);
  const fragment = document.createDocumentFragment();
  for (const event of visible) {
    const row = document.createElement("div");
    row.className = "gpt-event-card";
    row.setAttribute("role", "listitem");
    const label = document.createElement("span");
    label.className = "gpt-event-kind";
    label.textContent = event.kind === "push" ? "PUBLIC PUSH" :
      event.kind === "pull request" ? "PULL REQUEST" : "RELEASE";
    const time = document.createElement("time");
    time.dateTime = event.at;
    time.textContent = new Date(event.at).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });
    row.append(label, time);
    fragment.append(row);
  }
  list.replaceChildren(fragment);
  const checkedAtLabel = lastPublicTelemetryCheckedAt
    ? " Source checked " + new Date(lastPublicTelemetryCheckedAt).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }) + "."
    : "";
  status.textContent = (publicActivityState === "unavailable"
    ? "GitHub source unavailable. No event data is presented as live."
    : publicActivityState === "empty"
      ? "No qualifying public events among the latest 30 public GitHub profile events."
      : visible.length === 0
        ? "No events match this filter within the current public sample."
        : "Showing " + visible.length + " of " + publicActivity.length +
          " qualifying events in this bounded public sample. GPT usage remains a historical snapshot.") + checkedAtLabel;
}

document.querySelectorAll<HTMLButtonElement>("[data-gpt-event-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    const value = button.dataset.gptEventFilter;
    if (value === "all" || activityKinds.some((kind) => kind === value)) {
      publicActivityFilter = value as typeof publicActivityFilter;
      renderPublicActivity();
    }
  });
});

async function checkPublicTelemetry() {
  const note = document.querySelector<HTMLElement>("#development-activity");
  const detail = document.querySelector<HTMLElement>("#gpt-public-activity");
  const mobile = document.querySelector<HTMLElement>("#mobile-development-activity");
  if ((!note && !detail && !mobile) || publicTelemetryBusy || document.hidden) return;
  publicTelemetryBusy = true;
  lastPublicTelemetryCheck = Date.now();
  let brief = "PUBLIC GITHUB / SIGNAL UNAVAILABLE - GPT STATS ARE DATED";
  let expanded = "Public GitHub activity is temporarily unavailable. The ChatGPT figures on this page are historical.";
  let nextEvents: PublicActivity[] = [];
  let nextState: PublicActivityState = "unavailable";
  let nextCheckedAt: string | null = null;
  try {
    const response = await fetch("/api/telemetry/public", {
      cache: "no-store", credentials: "omit",
      headers: {Accept: "application/json"},
    });
    if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json"))
      throw new Error("Telemetry unavailable");
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new Error("Unexpected payload");
    const data = payload as Record<string, unknown>;
    const gpt = data.gpt as Record<string, unknown> | undefined;
    const dev = data.development as Record<string, unknown> | undefined;
    if (data.version !== 1 || !gpt || gpt.freshness !== "historical" ||
        typeof gpt.asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(gpt.asOf) ||
        !dev || dev.source !== "GitHub public events API" ||
        !["current", "unavailable"].includes(String(dev.freshness)) ||
        !["available", "no-recent-public-development", "unavailable"].includes(String(dev.status)) ||
        !validPublicActivity(dev.recentActivity))
      throw new Error("Invalid public telemetry");
    const checkedAt = dev.checkedAt;
    const checkedTime = typeof checkedAt === "string" ? Date.parse(checkedAt) : NaN;
    if (!Number.isFinite(checkedTime) ||
        new Date(checkedTime).toISOString() !== checkedAt ||
        checkedTime > Date.now() + 60_000 ||
        checkedTime < Date.now() - 4 * 60 * 60_000 - 60_000)
      throw new Error("Stale or invalid public source check time");
    nextCheckedAt = checkedAt as string;
    if (dev.freshness === "current" && dev.status === "available") {
      const kind = dev.latestActivityKind;
      const when = dev.latestActivityAt;
      if (!activityKinds.includes(kind as PublicActivity["kind"]) ||
          typeof when !== "string" || !Number.isFinite(Date.parse(when)) ||
          Date.parse(when) > Date.now() + 60_000 ||
          (dev.recentActivity as PublicActivity[]).length === 0 ||
          (dev.recentActivity as PublicActivity[])[0].kind !== kind ||
          (dev.recentActivity as PublicActivity[])[0].at !== when)
        throw new Error("Invalid public development event");
      nextEvents = dev.recentActivity as PublicActivity[];
      nextState = "ready";
      const time = new Date(when).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
      brief = "PUBLIC GITHUB / " + String(kind).toUpperCase() + " - " + time + " - GPT STATS DATED";
      expanded = "Latest qualifying public GitHub " + String(kind) + " observed " + time +
        ". This is not ChatGPT activity or proof of all coding work. GPT statistics remain historical.";
    } else if (dev.freshness === "current" && dev.status === "no-recent-public-development" &&
        (dev.recentActivity as PublicActivity[]).length === 0) {
      nextState = "empty";
      brief = "PUBLIC GITHUB / NO RECENT VISIBLE EVENT - GPT STATS DATED";
      expanded = "No recent qualifying public GitHub event in the latest 30 public profile events. Private development and ChatGPT usage are not represented.";
    } else if (!(dev.freshness === "unavailable" && dev.status === "unavailable" &&
        (dev.recentActivity as PublicActivity[]).length === 0)) {
      throw new Error("Contradictory public source state");
    }
  } catch {
    // Invalid/stale provider results must never masquerade as current usage.
  } finally {
    publicActivity = nextEvents;
    publicActivityState = nextState;
    lastPublicTelemetryCheckedAt = nextCheckedAt;
    renderPublicActivity();
    if (note && note.textContent !== brief) note.textContent = brief;
    if (mobile && mobile.textContent !== brief) mobile.textContent = brief;
    if (detail && detail.textContent !== expanded) detail.textContent = expanded;
    publicTelemetryBusy = false;
  }
}
void checkPublicTelemetry();
const publicTelemetryTimer = window.setInterval(() => {
  if (!document.hidden) void checkPublicTelemetry();
}, 5 * 60_000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastPublicTelemetryCheck >= 60_000)
    void checkPublicTelemetry();
});

// Lighting changes are a purely local visual preference. No network or GPU calls.
const portraitLights = ["amber", "teal", "violet"] as const;
function syncLightControls() {
  const current = interfaceShell.dataset.light ?? "amber";
  for (const button of lightButtons) {
    button.setAttribute("aria-label", (button.id === "shift-light" ? "Shift light. Current: " : "Cycle portrait lighting. Current: ") + current);
    button.title = "Portrait lighting: " + current;
  }
  if (engineStatus) engineStatus.textContent = current.toUpperCase() + " / EDITORIAL";
}
syncLightControls();
for (const button of lightButtons) {
  button.addEventListener("click", () => {
    const index = portraitLights.indexOf(interfaceShell.dataset.light as typeof portraitLights[number]);
    const next = portraitLights[(index + 1) % portraitLights.length];
    interfaceShell.dataset.light = next;
    syncLightControls();
    announce("Portrait lighting: " + next + ".");
  });
}

window.addEventListener("pagehide", (event) => {
  resetPointerDepth();
  if (event.persisted) return;
  window.clearInterval(clockTimer);
  window.clearInterval(publicTelemetryTimer);
  window.clearTimeout(announcementTimer);
});
