/**
 * DevonAkins.com V2 preview controls.
 * Public display only: no account credentials, private telemetry, analytics,
 * third-party requests, or implicit collection of browser data.
 */
type UsageSnapshot = {
  version: 1;
  metric: "work-codex-tokens";
  count: number;
  approximate: true;
  asOf: string;
  source: string;
  attestation: "owner-published";
};
type GitHubPublicSignal = {
  version: 1;
  account: "anevum";
  metric: "public-repositories";
  count: number;
  asOf: string;
  source: "GitHub REST API";
  attestation: "public-provider-response";
};
type SignalSource = "chatgpt" | "github";

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
let announcementTimer = 0;
let motionWanted = true;
let activeSignal: SignalSource = "chatgpt";
let signalSequence = 0;

try {
  motionWanted = localStorage.getItem("devon-v2-motion") !== "off";
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

for (const tab of tabs) {
  tab.addEventListener("click", () => activate(tab.dataset.viewTarget!, "tab"));
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
    activate(tabs[index].dataset.viewTarget!, "tab");
  });
}
document.querySelectorAll<HTMLButtonElement>(".action[data-view-target]").forEach((button) => {
  button.addEventListener("click", () => activate(button.dataset.viewTarget!, "panel"));
});
function syncLocationView() {
  const name = viewFromLocation();
  if (name) activate(name, "none", false);
  else if (!location.hash) activate("home", "none", false);
  // Non-panel fragments, such as #main, remain valid native anchor targets.
}
window.addEventListener("hashchange", syncLocationView);
window.addEventListener("popstate", syncLocationView);
activate(viewFromLocation() ?? "home", "none", false);

const navLayout = matchMedia("(max-width: 960px)");
function syncOrientation() {
  tablist?.setAttribute("aria-orientation", navLayout.matches ? "horizontal" : "vertical");
}
syncOrientation();
navLayout.addEventListener("change", syncOrientation);

function motionAllowed() {
  return motionWanted && !reducedMotion.matches;
}
function syncMotion() {
  const enabled = motionAllowed();
  interfaceShell.dataset.motion = enabled ? "on" : "off";
  if (motionButton) {
    motionButton.disabled = reducedMotion.matches;
    motionButton.textContent = reducedMotion.matches ? "REDUCED MOTION" : enabled ? "MOTION ON" : "MOTION OFF";
    motionButton.setAttribute("aria-pressed", String(enabled));
    motionButton.title = reducedMotion.matches ? "System reduced-motion preference is respected" : "Toggle ambient animation";
  }
}
syncMotion();
motionButton?.addEventListener("click", () => {
  if (reducedMotion.matches) return;
  motionWanted = !motionWanted;
  try {
    localStorage.setItem("devon-v2-motion", motionWanted ? "on" : "off");
  } catch {
    // The interface works without browser storage.
  }
  syncMotion();
});
reducedMotion.addEventListener("change", syncMotion);

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
    Object.keys(record).sort().join(",") !== "approximate,asOf,attestation,count,metric,source,version" ||
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
  return record as UsageSnapshot;
}

function showUsage(snapshot: UsageSnapshot) {
  const count = document.querySelector<HTMLElement>("#usage-value");
  const status = document.querySelector<HTMLElement>("#usage-status");
  const date = document.querySelector<HTMLElement>("#usage-date");
  const observed = new Date(snapshot.asOf + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
  if (count) {
    count.textContent = "≈" + new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(snapshot.count);
    count.setAttribute("aria-label", "Approximately " + snapshot.count.toLocaleString("en-US") +
      " Work and Codex tokens, owner-reported as of " + observed);
  }
  const shortDate = observed.replace(", " + snapshot.asOf.slice(0, 4), " ’" + snapshot.asOf.slice(2, 4));
  if (status) status.textContent = shortDate + " · Not live";
  if (date) date.textContent = "As of " + observed + " · " + snapshot.source.trim() + " · Approximate";
}
function parseGitHubSignal(input: unknown): GitHubPublicSignal {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid GitHub public response");
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !== "account,asOf,attestation,count,metric,source,version" ||
    value.version !== 1 || value.account !== "anevum" ||
    value.metric !== "public-repositories" ||
    value.source !== "GitHub REST API" ||
    value.attestation !== "public-provider-response" ||
    typeof value.count !== "number" || !Number.isSafeInteger(value.count) ||
    value.count < 0 || value.count > 1_000_000 ||
    typeof value.asOf !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.asOf)
  ) throw new Error("Invalid GitHub public response");
  const timestamp = Date.parse(value.asOf);
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 300_000 ||
      Date.now() - timestamp > 3_900_000) throw new Error("Stale GitHub public response");
  return value as GitHubPublicSignal;
}
function showGitHubSignal(snapshot: GitHubPublicSignal) {
  const count = document.querySelector<HTMLElement>("#usage-value");
  const status = document.querySelector<HTMLElement>("#usage-status");
  const date = document.querySelector<HTMLElement>("#usage-date");
  const observed = new Date(snapshot.asOf);
  if (count) {
    count.textContent = new Intl.NumberFormat("en-US").format(snapshot.count);
    count.setAttribute("aria-label", snapshot.count.toLocaleString("en-US") +
      " public repositories under the anevum GitHub account, observed " + snapshot.asOf);
  }
  const timeLabel = observed.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  });
  if (status) status.textContent = timeLabel + " UTC · Cached";
  if (date) date.textContent = "Updated " + observed.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit",
    minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  }) + " · " + snapshot.source;
}
async function refreshSignal() {
  const sequence = ++signalSequence;
  const source = activeSignal;
  const button = document.querySelector<HTMLButtonElement>("#refresh-usage");
  const value = document.querySelector<HTMLElement>("#usage-value");
  const status = document.querySelector<HTMLElement>("#usage-status");
  const date = document.querySelector<HTMLElement>("#usage-date");
  if (button) button.disabled = true;
  try {
    // A same-origin public file for ChatGPT, a first-party cached Worker for GitHub.
    // Neither request includes private account credentials or browser session data.
    const endpoint = source === "chatgpt" ?
      "/v2/usage-snapshot.json" : "/v2/github-profile.json";
    const response = await fetch(endpoint, {
      cache: "no-store",
      credentials: "omit",
      headers: {Accept: "application/json"},
    });
    if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json"))
      throw new Error("Public signal unavailable");
    const payload: unknown = await response.json();
    const verified = source === "chatgpt" ? parseSnapshot(payload) : parseGitHubSignal(payload);
    if (sequence !== signalSequence) return;
    if (source === "chatgpt") showUsage(verified as UsageSnapshot);
    else showGitHubSignal(verified as GitHubPublicSignal);
  } catch {
    if (sequence !== signalSequence) return;
    if (value) {
      value.textContent = "—";
      value.removeAttribute("aria-label");
    }
    if (status) status.textContent = source === "chatgpt" ?
      "No verified public snapshot available." : "GitHub public data unavailable.";
    if (date) date.textContent = source === "chatgpt" ?
      "No tokens or account data were retrieved." :
      "GitHub could not be reached or its public data was invalid.";
  } finally {
    if (sequence === signalSequence && button) button.disabled = false;
  }
}
function checkUsage() { return refreshSignal(); }
function selectSignal(source: SignalSource) {
  if (source === activeSignal) return;
  activeSignal = source;
  signalSequence++;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-signal]"))
    button.setAttribute("aria-pressed", String(button.dataset.signal === source));
  const isGitHub = source === "github";
  const kicker = document.querySelector<HTMLElement>("#signal-kicker");
  const title = document.querySelector<HTMLElement>("#signal-title");
  const status = document.querySelector<HTMLElement>("#usage-status");
  const date = document.querySelector<HTMLElement>("#usage-date");
  const value = document.querySelector<HTMLElement>("#usage-value");
  const note = document.querySelector<HTMLElement>("#signal-note");
  const link = document.querySelector<HTMLAnchorElement>("#signal-link");
  const button = document.querySelector<HTMLButtonElement>("#refresh-usage");
  if (kicker) kicker.textContent = isGitHub ? "GITHUB / OPEN SOURCE" : "CHATGPT / WORK + CODEX";
  if (title) title.textContent = isGitHub ? "Public repositories" : "Activity in public";
  if (note) note.textContent = isGitHub ?
    "Public repositories on github.com/anevum. First-party proxy, hourly cache and visible observation time. No visitor data is sent to GitHub." :
    "A dated, approximate Work/Codex token total from my ChatGPT profile—not a live feed, follower count, or measure of audience reach. No private account connection.";
  if (link) link.hidden = !isGitHub;
  if (button) {
    button.disabled = false;
    button.textContent = "Refresh snapshot ↻";
  }
  if (value) { value.textContent = "—"; value.removeAttribute("aria-label"); }
  if (status) status.textContent = "Loading public " + (isGitHub ? "GitHub signal…" : "ChatGPT snapshot…");
  if (date) date.textContent = isGitHub ? "Public repository count, not a contribution count." :
    "Work and Codex tokens · owner-reported";
  void refreshSignal();
}
document.querySelectorAll<HTMLButtonElement>("[data-signal]").forEach(button => {
  button.addEventListener("click", () => {
    if (button.dataset.signal === "chatgpt" || button.dataset.signal === "github")
      selectSignal(button.dataset.signal);
  });
});
document.querySelector<HTMLButtonElement>("#refresh-usage")?.addEventListener("click", checkUsage);
// Read only the owner-published public ChatGPT snapshot once per visit.
// GitHub is fetched on demand; no third-party browser requests.
void checkUsage();

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
  if (event.persisted) return;
  window.clearInterval(clockTimer);
  window.clearTimeout(announcementTimer);
});
