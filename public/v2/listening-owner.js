// Same-origin owner interface. This file contains no Spotify account credentials.
const $ = (id) => document.getElementById(id);
const label = (id, value) => {
  const node = $(id);
  if (node) node.textContent = value;
};
let account = null;
let processing = false;
function message(value) {
  label("notice", value);
}
async function requestJSON(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
  });
  if (!response.headers.get("Content-Type")?.includes("application/json"))
    throw new Error("Owner access is not configured");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Connection request failed");
  return body;
}
const fmt = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";
};
function render(data) {
  account = data;
  const connected = !!data.connected;
  const allowed = !!data.publishingAllowed;
  const appReady = data.spotifyAppConfigured === true;
  $("spotify-setup").hidden = appReady;
  label("connection-state", connected ? "CONNECTED" : appReady ? "NOT CONNECTED" : "SETUP REQUIRED");
  label(
    "detail-status",
    connected
      ? data.reauthorizationRequired
        ? "Reconnect required"
        : "Connected"
      : "Not connected",
  );
  label(
    "connection-description",
    connected
      ? data.reauthorizationRequired
        ? "Your connection needs Spotify authorization again."
        : "Connected securely. Playback can be read regardless of the device you are using."
      : appReady
        ? "Authorize Spotify to read your currently playing track from any supported device."
        : "Create and configure your Spotify developer app before connecting.",
  );
  label("reauth-date", fmt(data.reauthorizeBy));
  label(
    "public-state",
    data.publicEnabled ? "Broadcasting enabled" : "Private",
  );
  label(
    "release-message",
    allowed
      ? "You're in control. The public indicator remains hidden until you save an enabled setting."
      : "Public broadcasting is locked pending the owner-approved release.",
  );
  $("connect").textContent = connected
    ? "Reconnect Spotify"
    : "Connect Spotify";
  $("connect").disabled = processing || !appReady;
  $("disconnect").disabled = processing || !connected;
  $("preview-playback").disabled = processing || !connected || !!data.reauthorizationRequired;
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
    else
      message(
        result.connected
          ? "Connection ready. Sharing is under your control."
          : result.spotifyAppConfigured
            ? "Connect Spotify when you are ready."
            : "Spotify developer app setup is required before connecting.",
      );
  } catch {
    message(
      "Private owner access or the listening database is not yet configured.",
    );
    [
      "connect",
      "disconnect",
      "public-status",
      "track-details",
      "save-settings",
      "preview-playback",
    ].forEach((id) => ($(id).disabled = true));
  }
}
async function action(work, error) {
  if (processing) return;
  processing = true;
  if (account) render(account);
  try {
    await work();
  } catch {
    message(error);
  } finally {
    processing = false;
    if (account) render(account);
  }
}
$("connect").addEventListener("click", () =>
  action(async () => {
    message("Opening Spotify authorization…");
    const data = await requestJSON("/api/listening/oauth/start", {
      method: "POST",
    });
    const target = new URL(data.authorizeUrl);
    if (
      target.origin !== "https://accounts.spotify.com" ||
      target.pathname !== "/authorize"
    )
      throw new Error("Unexpected Spotify authorization destination");
    location.assign(target.href);
  }, "Spotify authorization could not start. Check your owner connection."),
);
$("disconnect").addEventListener("click", () => {
  if (!confirm("Disconnect Spotify and clear the stored account credentials?"))
    return;
  void action(async () => {
    await requestJSON("/api/listening/admin/disconnect", { method: "POST" });
    message("Spotify disconnected. Public listening is disabled.");
    await refresh();
  }, "Disconnect was not completed.");
});
$("save-settings").addEventListener("click", () =>
  action(async () => {
    const publicEnabled = $("public-status").checked;
    const showDetails = $("track-details").checked;
    if (
      publicEnabled &&
      !confirm("Share your Spotify playback status publicly?")
    )
      return;
    const result = await requestJSON("/api/listening/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicEnabled, showDetails }),
    });
    render(result);
    message(
      publicEnabled
        ? "Public listening signal enabled by your choice."
        : "Public listening signal disabled.",
    );
  }, "Your visibility settings could not be saved."),
);
$("preview-playback").addEventListener("click", () =>
  action(async () => {
    label("preview-status", "Checking your active Spotify playback privately…");
    let data;
    try {
      data = await requestJSON("/api/listening/admin/preview", { method: "POST" });
    } catch (error) {
      label("preview-status", "Private check unavailable. Playback may need to be restarted, or Spotify may be temporarily limiting requests.");
      throw error;
    }
    if (data.private !== true)
      throw new Error("Private preview response invalid");
    if (data.mode === "playing" && data.track) {
      label("preview-status", `Now playing: ${data.track.title} — ${data.track.artist}. Private check only; nothing was published.`);
    } else if (data.mode === "off_air") {
      label("preview-status", "No active Spotify track was reported. Start a song on your phone or another device and check again in a minute.");
    } else {
      label("preview-status", "Spotify playback is not available for this private check.");
    }
  }, "Private playback check could not be completed. Try again shortly."),
);
void refresh();

let collections = null;
function renderCollections(value) {
  collections = value;
  $("collections-ids").value = value.ids
    .map((id) => "https://open.spotify.com/playlist/" + id)
    .join("\n");
  $("collections-enabled").checked = value.enabled;
  $("collections-enabled").disabled =
    !value.publishingAllowed || !account?.connected;
  $("collections-ids").disabled = false;
  $("collections-save").disabled = false;
}
async function refreshCollections() {
  try {
    renderCollections(await requestJSON("/api/listening/admin/collections"));
    label(
      "collections-status",
      "Choose public playlists deliberately. Nothing is shared until you enable it.",
    );
  } catch {
    label(
      "collections-status",
      "Playlist controls become available after private integration setup.",
    );
  }
}
$("collections-save").onclick = async () => {
  if (!collections || processing) return;
  $("collections-save").disabled = true;
  try {
    const values = $("collections-ids")
      .value.split(/[\s,]+/)
      .filter(Boolean);
    const ids = values.map((value) => {
      if (/^[A-Za-z0-9]{22}$/.test(value)) return value;
      const url = new URL(value);
      if (
        url.origin !== "https://open.spotify.com" ||
        !/^\/playlist\/[A-Za-z0-9]{22}\/?$/.test(url.pathname)
      )
        throw Error("Use a Spotify playlist link or ID.");
      return url.pathname.split("/")[2];
    });
    const enabled = $("collections-enabled").checked;
    const result = await requestJSON("/api/listening/admin/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: collections.revision, ids, enabled }),
    });
    renderCollections(result);
    label(
      "collections-status",
      enabled
        ? "Public playlist choices verified and saved."
        : "Playlist choices saved privately.",
    );
  } catch (error) {
    label(
      "collections-status",
      error.message || "Playlists could not be saved.",
    );
  } finally {
    $("collections-save").disabled = false;
  }
};
void refreshCollections();
