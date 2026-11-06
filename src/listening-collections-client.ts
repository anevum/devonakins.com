/** Modest first-party reads; provider validation occurs server-side at most every 15 min. */
export function startCollections() {
  const list = document.querySelector<HTMLElement>("#listening-playlists");
  const note = document.querySelector<HTMLElement>("#listening-playlist-note");
  const state = document.querySelector<HTMLElement>(
    "#listening-playlist-state",
  );
  if (!list || !note || !state) return;
  let busy = false;
  const clear = (message = "No public playlists are being shared.") => {
    list.replaceChildren();
    list.hidden = true;
    note.textContent = message;
    state.textContent = "NOT SHARING";
  };
  async function refresh() {
    if (busy || document.hidden || !list || !note || !state) return;
    busy = true;
    try {
      const response = await fetch("/api/listening/collections", {
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
      const value = await response.json();
      if (document.hidden) {
        clear();
        return;
      }
      if (
        value.version !== 1 ||
        !["hidden", "unavailable", "empty", "available"].includes(value.status)
      )
        throw Error("Invalid source");
      if (value.status !== "available") {
        clear(
          value.status === "unavailable"
            ? "Playlists are temporarily unavailable."
            : undefined,
        );
        return;
      }
      const checked = Date.parse(value.checkedAt);
      if (
        !Number.isFinite(checked) ||
        checked > Date.now() + 10000 ||
        Date.now() - checked > 15 * 60000 ||
        !Array.isArray(value.playlists) ||
        value.playlists.length > 12
      )
        throw Error("Stale source");
      const fragment = document.createDocumentFragment();
      for (const p of value.playlists) {
        if (
          !p ||
          typeof p.id !== "string" ||
          !/^[A-Za-z0-9]{22}$/.test(p.id) ||
          typeof p.title !== "string" ||
          !p.title.trim() ||
          p.title.length > 200 ||
          p.url !== "https://open.spotify.com/playlist/" + p.id
        )
          throw Error("Invalid playlist");
        const link = document.createElement("a");
        link.className = "listening-playlist-link";
        link.href = p.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        if (
          typeof p.image === "string" &&
          /^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]+$/.test(p.image)
        ) {
          const image = document.createElement("img");
          image.src = p.image;
          image.alt = "";
          image.loading = "lazy";
          image.referrerPolicy = "no-referrer";
          link.append(image);
        }
        const title = document.createElement("span");
        title.textContent = p.title + " · Listen on Spotify ↗";
        link.append(title);
        fragment.append(link);
      }
      list.replaceChildren(fragment);
      list.hidden = false;
      state.textContent = "OWNER SELECTED";
      note.textContent =
        "Public ownership checked " +
        new Date(checked).toLocaleString() +
        ". No playback on this website.";
    } catch {
      clear("Playlists could not be verified.");
    } finally {
      busy = false;
    }
  }
  void refresh();
  const timer = window.setInterval(() => {
    void refresh();
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    clear();
    if (!document.hidden) void refresh();
  });
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) clearInterval(timer);
  });
}
