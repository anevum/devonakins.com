/** No credentials stored here. Cloudflare Access authenticates same-origin requests. */
const el = (id) => document.getElementById(id);
let state = null;
let busy = false;
let pending = 0;
let operationSequence = 0;
let confirmedStopOperation = 0;
let cloudState = null;
let cloudGeneration = 0;
function notice(text) {
  el("presence-notice").textContent = text;
}
function lock(value) {
  document.querySelectorAll("button,input,select").forEach((node) => {
    // Concurrent workspace controls own their request lock and disclosure gate.
    if (node.closest('[aria-labelledby="reporters-title"]')) return;
    node.disabled = value;
  });
  if (!value && state && !state.publishingAllowed)
    el("presence-enabled").disabled = true;
  if (!value && (!cloudState || !cloudState.publishingAllowed))
    el("cloud-enabled").disabled = true;
  // Emergency stop stays available while a slower ordinary save is pending.
  if (state) el("presence-off").disabled = false;
}
function render(data) {
  if (state && data.revision < state.revision) return false;
  state = data;
  const project = el("presence-project");
  project.replaceChildren(new Option("No public project", ""));
  const catalog =
    data.projectCatalog ||
    Object.fromEntries(data.projects.map((slug) => [slug, slug]));
  for (const slug of data.projects)
    project.add(new Option(catalog[slug] || slug, slug));
  const choices = el("presence-project-choices");
  choices.replaceChildren();
  for (const [slug, label] of Object.entries(catalog)) {
    const item = document.createElement("label");
    item.className = "setting";
    const text = document.createElement("span");
    text.textContent = label;
    const check = document.createElement("input");
    check.type = "checkbox";
    check.value = slug;
    check.checked = data.projects.includes(slug);
    check.dataset.publicProject = "true";
    item.append(text, check);
    choices.append(item);
  }
  project.value = data.projectSlug || "";
  el("presence-enabled").checked = data.enabled;
  el("presence-private").checked = data.privateWork;
  el("presence-music").checked = data.shareListening;
  el("presence-editor-enabled").checked = data.editorEnabled === true;
  const preview = data.preview;
  el("presence-preview").textContent =
    (preview.state === "custom"
      ? preview.label
      : preview.state.replaceAll("-", " ")) +
    (preview.project ? " · " + preview.project : "") +
    " · " +
    preview.source;
  el("session-expiry").textContent = data.sessionExpiresAt
    ? (data.paused ? "Paused. " : "") +
      "Expires " +
      new Date(data.sessionExpiresAt).toLocaleTimeString()
    : "No active session.";
  return true;
}
async function load() {
  const response = await fetch("/api/presence/owner", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (
    !response.ok ||
    !response.headers.get("Content-Type")?.includes("application/json")
  )
    throw new Error(
      "Private controls unavailable. Check owner sign-in and deployment setup.",
    );
  render(await response.json());
}
async function mutate(action, extra = {}) {
  if ((busy && action !== "off") || !state) return;
  const operation = ++operationSequence;
  pending++;
  busy = true;
  lock(true);
  notice(action === "off" ? "Stopping broadcasting…" : "Saving…");
  try {
    const response = await fetch("/api/presence/owner", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ action, revision: state.revision, ...extra }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.headers.get("Content-Type")?.includes("application/json"))
      throw new Error(
        "Owner sign-in may have expired. Reload and sign in again.",
      );
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 409) await load();
      throw new Error(data.error || "Change was not saved.");
    }
    const current = render(data);
    if (current && action === "off") {
      confirmedStopOperation = Math.max(confirmedStopOperation, operation);
      cloudGeneration++;
      clearCloudCode();
      cloudState = null;
      el("cloud-preview").textContent =
        "Task disconnected by Stop all broadcasting.";
      el("cloud-confirmed").textContent = "No current task signal.";
      el("cloud-enabled").checked = false;
    }
    if (current && operation >= confirmedStopOperation)
      notice(
        action === "off"
          ? "Broadcasting stopped. Presence and Spotify are hidden."
          : "Saved.",
      );
  } catch (error) {
    if (operation >= confirmedStopOperation)
      notice(error.message || "Change was not saved.");
  } finally {
    pending--;
    busy = pending > 0;
    lock(busy || !state);
  }
}
const session = () => ({
  projectSlug: el("presence-project").value || null,
  minutes: Number(el("presence-duration").value),
});
el("session-start").onclick = () => mutate("start", session());
el("session-resume").onclick = () => mutate("resume", session());
el("session-pause").onclick = () => mutate("pause");
el("session-end").onclick = () => mutate("end");
el("manual-set").onclick = () =>
  mutate("manual", {
    status: el("presence-manual").value,
    minutes: Number(el("presence-duration").value),
    ...(el("presence-manual").value === "custom"
      ? {
          label: el("presence-custom-label").value,
          labelApproved: el("presence-label-approved").checked,
        }
      : {}),
  });
el("presence-manual").onchange = () => {
  el("custom-status-fields").hidden = el("presence-manual").value !== "custom";
};
el("projects-save").onclick = () =>
  mutate("projects", {
    projects: [
      ...document.querySelectorAll("[data-public-project]:checked"),
    ].map((input) => input.value),
  });
el("manual-clear").onclick = () => mutate("clear-manual");
el("presence-save").onclick = () =>
  mutate("settings", {
    enabled: el("presence-enabled").checked,
    privateWork: el("presence-private").checked,
    shareListening: el("presence-music").checked,
    editorEnabled: el("presence-editor-enabled").checked,
  });
el("presence-off").onclick = () => mutate("off");
lock(true);
load()
  .then(() => {
    lock(false);
    notice(
      state.publishingAllowed
        ? "Controls ready. Public sharing requires your opt-in."
        : "Controls ready. Public release approval is still disabled.",
    );
  })
  .catch((error) => notice(error.message));

async function editorPairing(method) {
  if (busy) return;
  busy = true;
  lock(true);
  el("editor-code-wrap").hidden = true;
  el("editor-pair-code").value = "";
  try {
    const response = await fetch("/api/presence/editor/pairing", {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (
      !response.ok ||
      !response.headers.get("Content-Type")?.includes("application/json")
    )
      throw Error(
        "Editor pairing is unavailable until private setup is complete.",
      );
    const data = await response.json();
    if (method === "POST" && typeof data.pairCode === "string") {
      el("editor-pair-code").value = data.pairCode;
      el("editor-code-wrap").hidden = false;
      el("editor-pair-code").focus();
      el("editor-pair-code").select();
      el("editor-pair-status").textContent =
        "Paste this code only into the VS Code pairing command. It expires in five minutes.";
      window.setTimeout(() => {
        el("editor-code-wrap").hidden = true;
        el("editor-pair-code").value = "";
      }, 300000);
    } else el("editor-pair-status").textContent = "Editor disconnected.";
  } catch (error) {
    el("editor-pair-status").textContent = error.message;
  } finally {
    busy = false;
    lock(!state);
  }
}
el("editor-pair").onclick = () => editorPairing("POST");
el("editor-unpair").onclick = () => editorPairing("DELETE");

const cloudEndpoint = "/api/presence/owner?channel=cloud";
function clearCloudCode() {
  el("cloud-code-wrap").hidden = true;
  el("cloud-pair-code").value = "";
}
function renderCloud(data) {
  cloudState = data;
  el("cloud-enabled").checked = data.enabled;
  el("cloud-enabled").disabled = busy || !data.publishingAllowed;
  const view = data.privatePreview;
  const names = {
    running: "Task running",
    waiting: "Waiting for input",
    completed: "Task completed",
    failed: "Task failed",
    cancelled: "Task cancelled",
    unknown: "Signal expired — task state unknown",
    "no-signal": "No current task signal",
  };
  const source =
    view.source === "codex"
      ? "Codex"
      : view.source === "chatgpt-work"
        ? "ChatGPT Work"
        : null;
  const fresh = view.expiresAt && Date.parse(view.expiresAt) > Date.now();
  el("cloud-preview").textContent =
    (view.expiresAt && !fresh
      ? names.unknown
      : names[view.state] || names["no-signal"]) +
    (fresh && source ? " · " + source : "") +
    (fresh && view.project ? " · " + view.project : "");
  el("cloud-confirmed").textContent =
    (view.asOf
      ? "Last confirmed " + new Date(view.asOf).toLocaleTimeString() + ". "
      : "") +
    (fresh && view.checkpoint
      ? "Task-reported checkpoint: " +
        view.checkpoint.replaceAll("-", " ") +
        ". "
      : "") +
    "Task reports are separate from verified test results and your own presence.";
  el("cloud-notice").textContent = data.paired
    ? "Task paired. Public sharing " +
      (data.enabled && data.publishingAllowed
        ? "selected; global visibility also applies."
        : "off.")
    : "No cloud task is connected.";
}
async function cloudRequest(method = "GET", body) {
  if (busy && method !== "GET") return;
  const generation = cloudGeneration;
  if (method !== "GET") {
    pending++;
    busy = true;
    lock(true);
    clearCloudCode();
  }
  try {
    const response = await fetch(cloudEndpoint, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.headers.get("Content-Type")?.includes("application/json"))
      throw Error("Reload and sign in to use cloud controls.");
    const data = await response.json();
    if (!response.ok)
      throw Error(data.error || "Cloud connection unavailable.");
    if (generation !== cloudGeneration) return;
    if (data.pairCode) {
      el("cloud-pair-code").value = data.pairCode;
      el("cloud-code-wrap").hidden = false;
      el("cloud-pair-code").focus();
      el("cloud-pair-code").select();
      const code = data.pairCode;
      window.setTimeout(() => {
        if (el("cloud-pair-code").value === code) clearCloudCode();
      }, 300000);
    }
    if (method === "GET") renderCloud(data);
    else await cloudRequest();
  } catch (error) {
    if (generation === cloudGeneration)
      el("cloud-notice").textContent =
        error.message || "Cloud connection unavailable.";
  } finally {
    if (method !== "GET") {
      pending--;
      busy = pending > 0;
      lock(busy || !state);
    }
  }
}
el("cloud-pair").onclick = () =>
  cloudRequest("POST", { action: "pair", source: el("cloud-source").value });
el("cloud-disconnect").onclick = () => {
  cloudGeneration++;
  return cloudRequest("DELETE");
};
el("cloud-refresh").onclick = () => cloudRequest();
el("cloud-save").onclick = () =>
  cloudState &&
  cloudRequest("POST", {
    action: "settings",
    enabled: el("cloud-enabled").checked,
    revision: cloudState.revision,
  });
void cloudRequest();
window.setInterval(() => {
  if (cloudState) renderCloud(cloudState);
  if (!document.hidden && !busy) void cloudRequest();
}, 30000);
