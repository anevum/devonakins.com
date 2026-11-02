/**
 * DevonAkins.com V2 preview controls.
 * Public display only: no account credentials, private telemetry, analytics,
 * third-party requests, or implicit collection of browser data.
 */
type SceneHandle = {
  setMotion: (enabled: boolean) => void;
  turn: () => void;
  dispose: () => void;
};
type UsageSnapshot = {
  version: 1;
  metric: "tokens";
  count: number;
  asOf: string;
  source: string;
  attestation: "owner-published";
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
const renderContainer = document.querySelector<HTMLElement>("#scene");
const engineStatus = document.querySelector<HTMLElement>("#scene-caption");
const turnButton = document.querySelector<HTMLButtonElement>("#turn-scene");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

if (!shell || !tabs.length || !tablist || !renderContainer) {
  throw new Error("V2 interface markup is incomplete");
}

const interfaceShell = shell;
const sceneContainer = renderContainer;
let scene: SceneHandle | undefined;
let announcementTimer = 0;
let fallbackRotation = 0;
let motionWanted = true;
let polling = false;

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
    history.replaceState(null, "", "#" + name);
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
window.addEventListener("hashchange", () => {
  const name = decodeURIComponent(location.hash.slice(1));
  if (validView(name)) activate(name, "none", false);
});
activate(validView(location.hash.slice(1)) ? location.hash.slice(1) : "home", "none", false);

const navLayout = matchMedia("(max-width: 760px)");
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
    motionButton.setAttribute("aria-label", "Toggle ambient motion");
    motionButton.title = reducedMotion.matches ? "System reduced-motion preference is respected" : "Toggle ambient animation";
  }
  scene?.setMotion(enabled);
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
    record.version !== 1 ||
    record.metric !== "tokens" ||
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
  if (count) {
    count.textContent = new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(snapshot.count);
    count.setAttribute("aria-label", snapshot.count.toLocaleString("en-US") + " owner-reported tokens");
  }
  if (status) status.textContent = "Owner-published estimate, not live tracking.";
  if (date) date.textContent = "As of " + snapshot.asOf + " · Source: " + snapshot.source.trim();
}
async function checkUsage() {
  if (polling) return;
  const button = document.querySelector<HTMLButtonElement>("#refresh-usage");
  const status = document.querySelector<HTMLElement>("#usage-status");
  const date = document.querySelector<HTMLElement>("#usage-date");
  polling = true;
  if (button) button.disabled = true;
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
    const count = document.querySelector<HTMLElement>("#usage-value");
    if (count) {
      count.textContent = "—";
      count.removeAttribute("aria-label");
    }
    if (status) status.textContent = "No verified public snapshot available.";
    if (date) date.textContent = "No tokens or account data were retrieved.";
  } finally {
    polling = false;
    if (button) button.disabled = false;
  }
}
document.querySelector<HTMLButtonElement>("#refresh-usage")?.addEventListener("click", checkUsage);
// Do not check automatically: no monitoring requests without a deliberate click.

function turnFallback() {
  fallbackRotation += 35;
  const image = sceneContainer.querySelector<HTMLElement>(".vector-fallback img");
  if (image) {
    image.style.transform = "rotate(" + fallbackRotation + "deg)";
    image.style.transition = motionAllowed() ? "transform .7s ease" : "none";
  }
}
turnButton?.addEventListener("click", () => {
  if (scene) scene.turn();
  else turnFallback();
});

function fallback() {
  sceneContainer.dataset.status = "fallback";
  if (engineStatus) engineStatus.textContent = "VECTOR FALLBACK";
  sceneContainer.querySelector("canvas")?.remove();
}
function startScene() {
  if (new URLSearchParams(location.search).get("render") === "fallback") {
    fallback();
    return;
  }
  const canvas = document.createElement("canvas");
  let context: WebGL2RenderingContext | null = null;
  try {
    context = canvas.getContext("webgl2", { antialias: false, powerPreference: "low-power" });
  } catch {
    // An unavailable or blocked GPU is a supported state.
  }
  if (!context) {
    fallback();
    return;
  }
  const validContext = context;
  import("./scene").then(({ createScene }) => {
    scene = createScene(sceneContainer, {
      canvas,
      context: validContext,
      motion: motionAllowed(),
      quality: "auto",
      onFailure: fallback,
    });
    sceneContainer.dataset.status = "ready";
    if (engineStatus) engineStatus.textContent = "REAL-TIME THREE.JS";
  }).catch(fallback);
}
if ("requestIdleCallback" in window)
  window.requestIdleCallback(startScene, { timeout: 1700 });
else
  setTimeout(startScene, 110);

window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  window.clearInterval(clockTimer);
  window.clearTimeout(announcementTimer);
  scene?.dispose();
});
