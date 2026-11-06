/** Spotify account playback probe; never called without a DB owner opt-in. */
import { importEncryptionKey, seal, unseal } from "./listening-crypto.mjs";
import { projectPlayback, retryDelayMs } from "./spotify-presence.mjs";

export class SpotifyPause extends Error {
  constructor(delayMs = 60_000, reconnect = false) {
    super("Spotify unavailable");
    this.delayMs = delayMs;
    this.reconnect = reconnect;
  }
}
export async function probeSpotify(account, env, now, fetcher = fetch) {
  if (!account?.refresh_cipher || account.reauth_due <= now)
    throw new SpotifyPause(900_000, true);
  const key = await importEncryptionKey(env.LISTENING_TOKEN_KEY);
  let access, accessCipher = account.access_cipher, refreshCipher = account.refresh_cipher;
  let expiresAt = Number(account.access_expires || 0);
  if (accessCipher && expiresAt > now + 30_000) {
    try { access = await unseal(accessCipher, key, "access"); }
    catch { access = undefined; }
  }
  if (!access) {
    const refresh = await unseal(account.refresh_cipher, key, "refresh");
    const response = await fetcher("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: env.SPOTIFY_CLIENT_ID,
        refresh_token: refresh,
      }).toString(),
      signal: AbortSignal.timeout(7000),
    });
    if (response.status === 429)
      throw new SpotifyPause(retryDelayMs(response.headers.get("Retry-After"), now));
    if (response.status === 400 || response.status === 401)
      throw new SpotifyPause(900_000, true);
    if (!response.ok) throw new SpotifyPause();
    const values = await response.json();
    if (values.token_type !== "Bearer" ||
        typeof values.access_token !== "string" || values.access_token.length < 10 ||
        !Number.isFinite(Number(values.expires_in)) || Number(values.expires_in) <= 0)
      throw new SpotifyPause();
    access = values.access_token;
    expiresAt = now + Math.max(0, Number(values.expires_in) - 60) * 1000;
    accessCipher = await seal(access, key, "access");
    if (typeof values.refresh_token === "string" && values.refresh_token.length >= 10)
      refreshCipher = await seal(values.refresh_token, key, "refresh");
  }
  const result = await fetcher("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: "Bearer " + access, Accept: "application/json" },
    signal: AbortSignal.timeout(7000),
  });
  if (result.status === 429)
    throw new SpotifyPause(retryDelayMs(result.headers.get("Retry-After"), now));
  if (result.status === 401 || result.status === 403)
    throw new SpotifyPause(300_000, true);
  if (result.status !== 204 && !result.ok) throw new SpotifyPause();
  const playback = result.status === 204 ? null : await result.json();
  const projection = projectPlayback(playback, account.show_details === 1, new Date(now).toISOString());
  return { projection, accessCipher, refreshCipher, expiresAt };
}
