/**
 * A public projection of one owner's Spotify playback. No account data is
 * published until the owner explicitly enables the corresponding Worker
 * settings. This module never persists listening history or refresh tokens.
 */
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function presenceResponse(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: JSON_HEADERS });
}

const safeText = (value, max = 120) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const trackIdPattern = /^[A-Za-z0-9]{22}$/;
const artworkPattern = /^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]+$/;

export function projectPlayback(payload, showDetails, checkedAt) {
  const base = { version: 1, mode: "off_air", detailsVisible: false, updatedAt: checkedAt };
  // The playback endpoint can return a 204, a paused session, an advert, or
  // a private session. None of those means the owner stopped coding.
  if (!payload || payload.is_playing !== true || payload.device?.is_private_session === true)
    return base;
  if (payload.currently_playing_type !== "track" || payload.item?.type !== "track")
    return base;

  const item = payload.item;
  if (!trackIdPattern.test(item.id || "")) return base;
  if (!showDetails) return { ...base, mode: "playing" };

  const title = safeText(item.name);
  const artists = Array.isArray(item.artists)
    ? item.artists.map((artist) => safeText(artist?.name, 70)).filter(Boolean).slice(0, 5).join(", ")
    : "";
  if (!title || !artists) return base;

  const art = Array.isArray(item.album?.images)
    ? item.album.images.find((image) => artworkPattern.test(image?.url || ""))?.url || null
    : null;
  return {
    ...base,
    mode: "playing",
    detailsVisible: true,
    track: {
      title,
      artist: artists,
      album: safeText(item.album?.name),
      url: "https://open.spotify.com/track/" + item.id,
      image: art,
    },
  };
}

const withTimeout = () => AbortSignal.timeout(6500);
// Retry-After may be seconds or an HTTP date. Clamp extreme values.
export function retryDelayMs(value, checkedAt = Date.now()) {
  const seconds = typeof value === "string" && /^[0-9]+$/.test(value.trim())
    ? Number(value.trim()) * 1000
    : typeof value === "string" ? Date.parse(value) - checkedAt : Number.NaN;
  return Number.isFinite(seconds)
    ? Math.max(60_000, Math.min(900_000, seconds))
    : 60_000;
}
class HoldRequest extends Error {
  constructor(delayMs) {
    super("Spotify temporarily unavailable");
    this.delayMs = delayMs;
  }
}
const unavailable = (checkedAt) => ({
  version: 1, mode: "unavailable", detailsVisible: false, updatedAt: checkedAt,
});

/**
 * fetcher and now are injectable for deterministic negative-path tests.
 * Caches are isolated to one Worker instance, never a browser or CDN cache.
 */
export function createPresenceReader({ fetcher = fetch, now = Date.now, ttlMs = 60_000 } = {}) {
  let token = null;
  let tokenPending = null;
  let cached = null;
  let inFlight = null;
  let generation = 0;
  let blockedUntil = 0;
  let blockedKey = null;

  async function accessToken(env, key) {
    if (token?.key === key && token.expires > now()) return token.value;
    if (tokenPending?.key === key) return tokenPending.promise;
    const promise = (async () => {
      const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: env.SPOTIFY_REFRESH_TOKEN,
      });
      const headers = { "Content-Type": "application/x-www-form-urlencoded" };
      // A PKCE refresh uses client_id without a client secret.
      if (env.SPOTIFY_CLIENT_SECRET) {
        headers.Authorization = "Basic " + btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET);
      } else {
        params.set("client_id", env.SPOTIFY_CLIENT_ID);
      }
      const result = await fetcher("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers,
        body: params.toString(),
        signal: withTimeout(),
      });
      if (result.status === 429)
        throw new HoldRequest(retryDelayMs(result.headers.get("Retry-After"), now()));
      if (result.status === 400 || result.status === 401)
        throw new HoldRequest(900_000);
      if (!result.ok) throw new Error("Spotify token request unavailable");
      const body = await result.json();
      if (typeof body.access_token !== "string" || body.access_token.length < 10)
        throw new Error("Invalid Spotify token response");
      const lifetimeMs = Math.max(0, Number(body.expires_in || 3600) * 1000 - 60_000);
      token = { key, value: body.access_token, expires: now() + lifetimeMs };
      return body.access_token;
    })();
    tokenPending = { key, promise };
    try {
      return await promise;
    } finally {
      if (tokenPending?.promise === promise) tokenPending = null;
    }
  }

  async function load(env, key) {
    const checkedAt = new Date(now()).toISOString();
    try {
      const value = await accessToken(env, key);
      const result = await fetcher("https://api.spotify.com/v1/me/player/currently-playing", {
        headers: { Authorization: "Bearer " + value, Accept: "application/json" },
        signal: withTimeout(),
      });
      if (result.status === 204) {
        return { version: 1, mode: "off_air", detailsVisible: false, updatedAt: checkedAt };
      }
      if (result.status === 429)
        throw new HoldRequest(retryDelayMs(result.headers.get("Retry-After"), now()));
      if (result.status === 401 || result.status === 403) {
        token = null;
        throw new HoldRequest(300_000);
      }
      if (!result.ok) return unavailable(checkedAt);
      const body = await result.json();
      return projectPlayback(body, env.SPOTIFY_SHARE_TRACK_DETAILS === "true", checkedAt);
    } catch (error) {
      if (error instanceof HoldRequest) {
        blockedKey = key;
        blockedUntil = Math.max(blockedUntil, now() + error.delayMs);
      }
      // Never include provider error text, credentials or account identifiers
      // in a public response.
      return unavailable(checkedAt);
    }
  }

  return async function readPresence(env = {}) {
    if (env.SPOTIFY_PUBLIC_NOW_PLAYING !== "true") {
      // Clearing state on disable prevents a later re-enable from restoring an
      // old public track. A pending older read cannot repopulate the cache.
      generation += 1;
      cached = null;
      inFlight = null;
      token = null;
      tokenPending = null;
      blockedKey = null;
      blockedUntil = 0;
      return presenceResponse({ version: 1, mode: "hidden", detailsVisible: false });
    }
    const key = [
      env.SPOTIFY_CLIENT_ID, env.SPOTIFY_CLIENT_SECRET,
      env.SPOTIFY_REFRESH_TOKEN, env.SPOTIFY_SHARE_TRACK_DETAILS,
    ].join("\u0000");
    if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_REFRESH_TOKEN)
      return presenceResponse(unavailable(new Date(now()).toISOString()));

    if (blockedKey === key && blockedUntil > now())
      return presenceResponse(unavailable(new Date(now()).toISOString()));
    if (cached?.key === key && cached.expires > now())
      return presenceResponse(cached.data);
    if (inFlight?.key === key) return presenceResponse(await inFlight.promise);

    const stamp = generation;
    const promise = load(env, key);
    inFlight = { key, promise };
    try {
      const data = await promise;
      if (stamp !== generation) {
        // A concurrent privacy-off request invalidated this in-flight result.
        return presenceResponse({ version: 1, mode: "hidden", detailsVisible: false });
      }
      cached = { key, data, expires: now() + ttlMs };
      return presenceResponse(data);
    } finally {
      if (inFlight?.promise === promise) inFlight = null;
    }
  };
}
