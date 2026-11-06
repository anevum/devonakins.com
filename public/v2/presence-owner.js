/** No credentials stored here. Cloudflare Access authenticates same-origin requests. */
const el = (id) => document.getElementById(id);
let state = null;
let busy = false;
let pending = 0;
let operationSequence = 0;
let confirmedStopOperation = 0;
function notice(text) {
  el("presence-notice").textContent = text;
}
function lock(value) {
  document.querySelectorAll("button,input,select").forEach((node) => {
    node.disabled = value;
  });
  if (!value && state && !state.publishingAllowed)
    el("presence-enabled").disabled = true;
  // Emergency stop stays available while a slower ordinary save is pending.
  if (state) el("presence-off").disabled = false;
}
function render(data) {
  if (state && data.revision < state.revision) return false;
  state = data;
  const project = el("presence-project");
  project.replaceChildren(new Option("No public project", ""));
  for (const slug of data.projects) project.add(new Option(slug, slug));
  project.value = data.projectSlug || "";
  el("presence-enabled").checked = data.enabled;
  el("presence-private").checked = data.privateWork;
  el("presence-music").checked = data.shareListening;
  const preview = data.preview;
  el("presence-preview").textContent =
    preview.state.replaceAll("-", " ") +
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
    if (current && action === "off")
      confirmedStopOperation = Math.max(confirmedStopOperation, operation);
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
  });
el("manual-clear").onclick = () => mutate("clear-manual");
el("presence-save").onclick = () =>
  mutate("settings", {
    enabled: el("presence-enabled").checked,
    privateWork: el("presence-private").checked,
    shareListening: el("presence-music").checked,
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
