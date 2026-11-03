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
type PublicCode = {name:string; pushedAt:string; url:string};
type GitHubPublicSignal = {
  version: 2;
  account: "anevum";
  metric: "public-repositories";
  count: number;
  asOf: string;
  source: "GitHub REST API";
  attestation: "public-provider-response";
  recent: PublicCode | null;
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
let motionPreference: "auto" | "on" | "off" = "auto";
let pointerFrame = 0;
let activeSignal: SignalSource = "chatgpt";
let signalSequence = 0;
let recentCodeLoaded = false;

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
  if (name === "work") void loadRecentCode();
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
function validPublicCode(project: unknown, observedAt: unknown): project is PublicCode | null {
  if (project === null) return true;
  if (!project || typeof project !== "object" || Array.isArray(project) ||
      Object.keys(project).sort().join(",") !== "name,pushedAt,url")
    return false;
  const p = project as Record<string,unknown>;
  if (typeof p.name !== "string" || p.name.length < 1 || p.name.length > 100 ||
      !/^[A-Za-z0-9_.-]+$/.test(p.name) || p.name === "." || p.name === ".." ||
      p.url !== "https://github.com/anevum/" + encodeURIComponent(p.name) ||
      typeof p.pushedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p.pushedAt))
    return false;
  const pushed = Date.parse(p.pushedAt);
  return Number.isFinite(pushed) && new Date(pushed).toISOString() === p.pushedAt &&
    pushed <= Date.now() + 300_000 &&
    typeof observedAt === "string" && Number.isFinite(Date.parse(observedAt)) &&
    pushed <= Date.parse(observedAt) + 300_000;
}
function showRecentCode(recent: PublicCode | null, unavailable = false) {
  const name = document.querySelector<HTMLElement>("#recent-code-name");
  const status = document.querySelector<HTMLElement>("#recent-code-status");
  const link = document.querySelector<HTMLAnchorElement>("#recent-code-link");
  if (!name || !status || !link) return;
  if (unavailable || !recent) {
    name.textContent = unavailable ? "Update unavailable" : "No eligible recent public project";
    status.textContent = unavailable ? "Could not confirm current public GitHub activity." :
      "No recent original public repository was returned.";
    link.href = "https://github.com/anevum";
    link.textContent = "Browse public repositories ↗";
    return;
  }
  name.textContent = recent.name;
  status.textContent = "Last pushed " + new Date(recent.pushedAt).toLocaleDateString(
    "en-US", {month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}
  ) + " · Public code, not a release announcement.";
  link.href = recent.url;
  link.textContent = "Open repository ↗";
}
async function loadRecentCode() {
  if (recentCodeLoaded) return;
  recentCodeLoaded = true;
  try {
    // First-party public GitHub proxy only; no visitor account context sent.
    const response = await fetch("/v2/github-profile.json", {
      cache:"no-store", credentials:"omit", headers:{Accept:"application/json"},
    });
    if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json"))
      throw new Error("Public source unavailable");
    const signal = parseGitHubSignal(await response.json());
    showRecentCode(signal.recent);
  } catch {
    showRecentCode(null,true);
  }
}

function parseGitHubSignal(input: unknown): GitHubPublicSignal {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid GitHub public response");
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !== "account,asOf,attestation,count,metric,recent,source,version" ||
    value.version !== 2 || value.account !== "anevum" ||
    value.metric !== "public-repositories" ||
    value.source !== "GitHub REST API" ||
    value.attestation !== "public-provider-response" ||
    typeof value.count !== "number" || !Number.isSafeInteger(value.count) ||
    value.count < 0 || value.count > 1_000_000 ||
    !validPublicCode(value.recent, value.asOf) ||
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
  recentCodeLoaded = true;
  showRecentCode(snapshot.recent);
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
  resetPointerDepth();
  if (event.persisted) return;
  window.clearInterval(clockTimer);
  window.clearTimeout(announcementTimer);
});
