/** Privacy-first, cross-isolate Spotify projection backed by a single D1 row. */
import { secureRandom } from "./listening-crypto.mjs";
import {
  SpotifyPause,
  SpotifyProbeSuperseded,
  probeSpotify,
} from "./listening-playback-probe.mjs";
import { presenceResponse } from "./spotify-presence.mjs";

const hidden = () => ({ version: 1, mode: "hidden", detailsVisible: false });
const unavailable = (now) => ({
  version: 1,
  mode: "unavailable",
  detailsVisible: false,
  updatedAt: new Date(now).toISOString(),
});
function publishable(account, env, now) {
  return (
    env.LISTENING_PUBLIC_RELEASE_APPROVED === "true" &&
    account?.public_enabled === 1 &&
    !!account.refresh_cipher &&
    !account.reauth_required &&
    account.reauth_due > now
  );
}
function validProjection(raw, now, showDetails) {
  try {
    if (typeof raw !== "string" || raw.length > 4096) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const observed = Date.parse(data.updatedAt || "");
    const keys = ["version", "mode", "detailsVisible", "updatedAt"];
    if (
      data.version !== 1 ||
      !["playing", "off_air"].includes(data.mode) ||
      typeof data.detailsVisible !== "boolean" ||
      !Number.isFinite(observed) ||
      new Date(observed).toISOString() !== data.updatedAt ||
      now - observed >= 120_000 ||
      now < observed - 10_000
    )
      return null;
    if (data.playback !== undefined) {
      const p=data.playback;
      if(data.mode!=="playing" || !data.detailsVisible || !p || Object.keys(p).sort().join('|')!=="durationMs|progressMs" || !Number.isSafeInteger(p.durationMs) || p.durationMs<=0 || p.durationMs>86400000 || !Number.isSafeInteger(p.progressMs) || p.progressMs<0 || p.progressMs>p.durationMs) return null;
      keys.push("playback");
    }
    if (data.detailsVisible) {
      if (data.mode !== "playing" || !showDetails) return null;
      keys.push("track");
      const track = data.track;
      const text = (value, max, empty = false) =>
        typeof value === "string" &&
        value.length <= max &&
        (empty || value.trim().length > 0);
      if (
        !track ||
        Object.keys(track).sort().join("|") !==
          "album|artist|image|title|url" ||
        !text(track.title, 120) ||
        !text(track.artist, 358) ||
        !text(track.album, 120, true) ||
        typeof track.url !== "string" ||
        !/^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]{22}$/.test(
          track.url,
        ) ||
        !(
          track.image === null ||
          (typeof track.image === "string" &&
            track.image.length <= 256 &&
            /^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]+$/.test(track.image))
        )
      )
        return null;
    }
    if (Object.keys(data).sort().join("|") !== keys.sort().join("|"))
      return null;
    return data;
  } catch {
    return null;
  }
}
export function createD1PresenceReader({
  fetcher = fetch,
  clock = Date.now,
} = {}) {
  return async function readD1Presence(env = {}) {
    const now = clock();
    if (
      !env.LISTENING_DB ||
      !env.LISTENING_TOKEN_KEY ||
      !env.SPOTIFY_CLIENT_ID ||
      env.LISTENING_PUBLIC_RELEASE_APPROVED !== "true"
    )
      return presenceResponse(hidden());
    const db = env.LISTENING_DB;
    let account;
    try {
      account = await db
        .prepare("SELECT * FROM listening_account WHERE id=1")
        .first();
      if (!publishable(account, env, now)) return presenceResponse(hidden());
      if (account.blocked_until > now)
        return presenceResponse(unavailable(now));
      if (account.projection_json && account.checked_at > now - 60_000) {
        const existing = validProjection(
          account.projection_json,
          now,
          account.show_details === 1,
        );
        if (existing) return presenceResponse(existing);
      }

      const lease = secureRandom(16);
      const claim = await db
        .prepare(
          "UPDATE listening_account SET lease_id=?, lease_until=? WHERE id=1 AND revision=? AND public_enabled=1 AND reauth_required=0 AND (lease_id IS NULL OR lease_until<?)",
        )
        .bind(lease, now + 22_000, account.revision, now)
        .run();
      if (claim.meta?.changes !== 1) return presenceResponse(unavailable(now));
      const releaseLease = () =>
        db
          .prepare(
            "UPDATE listening_account SET lease_id=NULL, lease_until=0 WHERE id=1 AND lease_id=?",
          )
          .bind(lease)
          .run();
      try {
        const result = await probeSpotify(
          account,
          env,
          now,
          fetcher,
          async (credentials) => {
            // Credential persistence and public projection have different fences.
            // Visibility may change while a token rotates; that must not lose the
            // new token. Disconnect/reconnect clears the lease and prevents this
            // old request from restoring or replacing another connection.
            const saved = await db
              .prepare(
                "UPDATE listening_account SET access_cipher=?, refresh_cipher=?, access_expires=? WHERE id=1 AND lease_id=? AND refresh_cipher=? AND connected_at=? AND reauth_required=0",
              )
              .bind(
                credentials.accessCipher,
                credentials.refreshCipher,
                credentials.expiresAt,
                lease,
                account.refresh_cipher,
                account.connected_at,
              )
              .run();
            if (saved.meta?.changes !== 1) return false;
            const current = await db
              .prepare("SELECT * FROM listening_account WHERE id=1")
              .first();
            return (
              current?.lease_id === lease &&
              current.revision === account.revision &&
              publishable(current, env, clock())
            );
          },
        );
        const update = await db
          .prepare(
            "UPDATE listening_account SET revision=revision+1, projection_json=?, checked_at=?, access_cipher=?, refresh_cipher=?, access_expires=?, blocked_until=0, lease_id=NULL, lease_until=0 WHERE id=1 AND revision=? AND lease_id=? AND public_enabled=1 AND reauth_required=0",
          )
          .bind(
            JSON.stringify(result.projection),
            now,
            result.accessCipher,
            result.refreshCipher,
            result.expiresAt,
            account.revision,
            lease,
          )
          .run();
        if (update.meta?.changes !== 1) {
          await releaseLease();
          return presenceResponse(hidden());
        }
        return presenceResponse(result.projection);
      } catch (error) {
        if (error instanceof SpotifyProbeSuperseded) {
          await releaseLease();
          return presenceResponse(hidden());
        }
        const pause =
          error instanceof SpotifyPause ? error : new SpotifyPause();
        const reconnect = pause.reconnect ? 1 : 0;
        const held = await db
          .prepare(
            "UPDATE listening_account SET revision=revision+1, blocked_until=?, reauth_required=CASE WHEN ?=1 THEN 1 ELSE reauth_required END, public_enabled=CASE WHEN ?=1 THEN 0 ELSE public_enabled END, projection_json=NULL, checked_at=0, lease_id=NULL, lease_until=0 WHERE id=1 AND revision=? AND lease_id=?",
          )
          .bind(
            now + pause.delayMs,
            reconnect,
            reconnect,
            account.revision,
            lease,
          )
          .run();
        if (held.meta?.changes !== 1) {
          await releaseLease();
          return presenceResponse(hidden());
        }
        return presenceResponse(reconnect ? hidden() : unavailable(now));
      }
    } catch {
      return presenceResponse(unavailable(now));
    }
  };
}
