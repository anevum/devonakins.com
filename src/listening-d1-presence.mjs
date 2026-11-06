/** Privacy-first, cross-isolate Spotify projection backed by a single D1 row. */
import { secureRandom } from "./listening-crypto.mjs";
import { SpotifyPause, probeSpotify } from "./listening-playback-probe.mjs";
import { presenceResponse } from "./spotify-presence.mjs";

const hidden = () => ({ version: 1, mode: "hidden", detailsVisible: false });
const unavailable = now => ({
  version: 1, mode: "unavailable", detailsVisible: false, updatedAt: new Date(now).toISOString(),
});
function publishable(account, env, now) {
  return env.LISTENING_PUBLIC_RELEASE_APPROVED === "true" &&
    !!account?.public_enabled && !!account?.refresh_cipher &&
    !account.reauth_required && account.reauth_due > now;
}
function validProjection(raw, now) {
  try {
    const data = JSON.parse(raw);
    const observed = Date.parse(data.updatedAt || "");
    if (data.version !== 1 || !["playing","off_air"].includes(data.mode) ||
        !Number.isFinite(observed) || now - observed > 150_000 || now < observed - 30_000)
      return null;
    return data;
  } catch { return null; }
}
export function createD1PresenceReader({ fetcher = fetch, clock = Date.now } = {}) {
  return async function readD1Presence(env = {}) {
    const now = clock();
    if (!env.LISTENING_DB || !env.LISTENING_TOKEN_KEY ||
        !env.SPOTIFY_CLIENT_ID || env.LISTENING_PUBLIC_RELEASE_APPROVED !== "true")
      return presenceResponse(hidden());
    const db = env.LISTENING_DB;
    let account;
    try {
      account = await db.prepare("SELECT * FROM listening_account WHERE id=1").first();
      if (!publishable(account, env, now)) return presenceResponse(hidden());
      if (account.blocked_until > now) return presenceResponse(unavailable(now));
      if (account.projection_json && account.checked_at > now - 60_000) {
        const existing = validProjection(account.projection_json, now);
        if (existing) return presenceResponse(existing);
      }

      const lease = secureRandom(16);
      const claim = await db.prepare(
        "UPDATE listening_account SET lease_id=?, lease_until=? WHERE id=1 AND revision=? AND public_enabled=1 AND reauth_required=0 AND (lease_id IS NULL OR lease_until<?)"
      ).bind(lease, now + 22_000, account.revision, now).run();
      if (claim.meta?.changes !== 1) return presenceResponse(unavailable(now));
      try {
        const result = await probeSpotify(account, env, now, fetcher);
        const update = await db.prepare(
          "UPDATE listening_account SET revision=revision+1, projection_json=?, checked_at=?, access_cipher=?, refresh_cipher=?, access_expires=?, blocked_until=0, lease_id=NULL, lease_until=0 WHERE id=1 AND revision=? AND lease_id=? AND public_enabled=1 AND reauth_required=0"
        ).bind(JSON.stringify(result.projection), now, result.accessCipher,
          result.refreshCipher, result.expiresAt, account.revision, lease).run();
        if (update.meta?.changes !== 1) return presenceResponse(hidden());
        return presenceResponse(result.projection);
      } catch (error) {
        const pause = error instanceof SpotifyPause ? error : new SpotifyPause();
        const reconnect = pause.reconnect ? 1 : 0;
        await db.prepare(
          "UPDATE listening_account SET revision=revision+1, blocked_until=?, reauth_required=CASE WHEN ?=1 THEN 1 ELSE reauth_required END, public_enabled=CASE WHEN ?=1 THEN 0 ELSE public_enabled END, projection_json=NULL, checked_at=0, lease_id=NULL, lease_until=0 WHERE id=1 AND revision=? AND lease_id=?"
        ).bind(now + pause.delayMs, reconnect, reconnect, account.revision, lease).run();
        return presenceResponse(reconnect ? hidden() : unavailable(now));
      }
    } catch {
      return presenceResponse(unavailable(now));
    }
  };
}
