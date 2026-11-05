// Same-origin owner interface. This file contains no Spotify account credentials.
const $ = (id) => document.getElementById(id);
const label = (id, value) => { const node = $(id); if (node) node.textContent = value; };
let account = null;
let processing = false;
function message(value) { label("notice", value); }
async function requestJSON(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
  if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("Owner access is not configured");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Connection request failed");
  return body;
}
const fmt = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, {year:"numeric",month:"long",day:"numeric"}) : "—";
};
function render(data) {
  account = data;
  const connected = !!data.connected;
  const allowed = !!data.publishingAllowed;
  label("connection-state", connected ? "CONNECTED" : "NOT CONNECTED");
  label("detail-status", connected ? data.reauthorizationRequired ? "Reconnect required" : "Connected" : "Not connected");
  label("connection-description", connected ?
    data.reauthorizationRequired ? "Your connection needs Spotify authorization again." :
    "Connected securely. Playback can be read regardless of the device you are using." :
    "Authorize Spotify to read your currently playing track from any supported device.");
  label("reauth-date", fmt(data.reauthorizeBy));
  label("public-state", data.publicEnabled ? "Broadcasting enabled" : "Private");
  label("release-message", allowed ?
    "You're in control. The public indicator remains hidden until you save an enabled setting." :
    "Public broadcasting is locked pending the owner-approved release.");
  $("connect").textContent = connected ? "Reconnect Spotify" : "Connect Spotify";
  $("connect").disabled = processing;
  $("disconnect").disabled = processing || !connected;
  $("public-status").checked = !!data.publicEnabled;
  $("track-details").checked = !!data.showDetails;
  $("public-status").disabled = processing || !connected || !allowed;
  $("track-details").disabled = processing || !connected || !allowed;
  $("save-settings").disabled = processing || !connected || !allowed;
}
async function refresh() {
  try {
    const result = await requestJSON("/api/listening/admin/status");
    render(result);
    if (new URL(location.href).searchParams.get("connected") === "1")
      message("Spotify connected. Your listening data is still private.");
    else message(result.connected ? "Connection ready. Sharing is under your control." : "Connect Spotify when you are ready.");
  } catch {
    message("Private owner access or the listening database is not yet configured.");
    ["connect","disconnect","public-status","track-details","save-settings"].forEach(id => $(id).disabled = true);
  }
}
async function action(work, error) {
  if (processing) return;
  processing = true;
  if (account) render(account);
  try { await work(); } catch { message(error); }
  finally { processing = false; if (account) render(account); }
}
$("connect").addEventListener("click", () => action(async () => {
  message("Opening Spotify authorization…");
  const data = await requestJSON("/api/listening/oauth/start", { method: "POST" });
  const target = new URL(data.authorizeUrl);
  if (target.origin !== "https://accounts.spotify.com" || target.pathname !== "/authorize")
    throw new Error("Unexpected Spotify authorization destination");
  location.assign(target.href);
}, "Spotify authorization could not start. Check your owner connection."));
$("disconnect").addEventListener("click", () => {
  if (!confirm("Disconnect Spotify and clear the stored account credentials?")) return;
  void action(async () => {
    await requestJSON("/api/listening/admin/disconnect", { method: "POST" });
    message("Spotify disconnected. Public listening is disabled.");
    await refresh();
  }, "Disconnect was not completed.");
});
$("save-settings").addEventListener("click", () => action(async () => {
  const publicEnabled = $("public-status").checked;
  const showDetails = $("track-details").checked;
  if (publicEnabled && !confirm("Show your coding-mode status publicly whenever Spotify reports playback?")) return;
  const result = await requestJSON("/api/listening/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicEnabled, showDetails }),
  });
  render(result);
  message(publicEnabled ? "Public listening signal enabled by your choice." : "Public listening signal disabled.");
}, "Your visibility settings could not be saved."));
void refresh();
