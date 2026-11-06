/** Cloudflare-Access-protected administrative routes for Spotify owner. */
import { renderListeningOwner } from "./listening-owner-page.mjs";
import { startSpotifyAuth } from "./listening-oauth-start.mjs";
import { completeSpotifyAuth } from "./listening-oauth-callback.mjs";
import { secureRandom } from "./listening-crypto.mjs";
import {
  probeSpotify,
  SpotifyPause,
  SpotifyProbeSuperseded,
} from "./listening-playback-probe.mjs";
import { validSpotifyClientId } from "./listening-oauth-start.mjs";
import {
  isListeningOwner,
  boundDatabase,
  publicReleaseApproved,
  ownerRow,
  ownerStatus,
  ownerHeaders,
  ownerJson,
  ownerError,
  readSmallJson,
  validOwnerOrigin,
} from "./listening-owner-core.mjs";

function ownerPage() {
  return new Response(renderListeningOwner(), {
    status: 200,
    headers: {
      ...ownerHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
async function updateVisibility(request, env, now) {
  const data = await readSmallJson(request);
  if (
    !data ||
    typeof data.publicEnabled !== "boolean" ||
    typeof data.showDetails !== "boolean" ||
    Object.keys(data).some((k) => !["publicEnabled", "showDetails"].includes(k))
  )
    return ownerError("Invalid sharing settings", 400);
  const account = await ownerRow(env.LISTENING_DB);
  if (!account) return ownerError("Database migration required");
  if (
    data.publicEnabled &&
    (!publicReleaseApproved(env) ||
      !account.refresh_cipher ||
      account.reauth_required ||
      account.reauth_due <= now)
  )
    return ownerError(
      "Broadcasting is not approved or authorization has expired",
      403,
    );
  // Fence publication on every owner change, but retain the refresh lease.
  // A second probe must not reuse a token while Spotify is rotating it.
  await env.LISTENING_DB.prepare(
    "UPDATE listening_account SET revision=revision+1, public_enabled=?, show_details=?, projection_json=NULL, checked_at=0 WHERE id=1",
  )
    .bind(Number(data.publicEnabled), Number(data.showDetails))
    .run();
  return ownerJson(ownerStatus(await ownerRow(env.LISTENING_DB), env));
}
/** Explicit owner-only probe: never publishes, caches, or stores track metadata. */
async function previewPlayback(env, now, fetcher, clock) {
  const db = env.LISTENING_DB;
  const account = await ownerRow(db);
  if (
    !validSpotifyClientId(env.SPOTIFY_CLIENT_ID) ||
    !account?.refresh_cipher ||
    account.reauth_required ||
    account.reauth_due <= now
  )
    return ownerError("Spotify connection needs authorization", 409);
  if (account.blocked_until > now)
    return ownerError("Spotify is temporarily unavailable", 429);
  // Throttle manual checks across Worker isolates without persisting playback metadata.
  if (account.checked_at > now - 60_000 && account.checked_at <= now)
    return ownerError("Private playback was checked recently; try again shortly", 429);
  const lease = secureRandom(16);
  const claimed = await db.prepare(
    "UPDATE listening_account SET lease_id=?,lease_until=? WHERE id=1 AND revision=? AND connection_key=? AND refresh_cipher IS NOT NULL AND reauth_required=0 AND (lease_id IS NULL OR lease_until<?)",
  ).bind(lease, now + 22_000, account.revision, account.connection_key, now).run();
  if (claimed.meta?.changes !== 1)
    return ownerError("Spotify connection is busy; try again", 409);
  try {
    const result = await probeSpotify(
      { ...account, show_details: 1 },
      env,
      now,
      fetcher,
      async (next) => {
        const saved = await db.prepare(
          "UPDATE listening_account SET access_cipher=?,refresh_cipher=?,access_expires=? WHERE id=1 AND lease_id=? AND revision=? AND refresh_cipher=? AND connection_key=?",
        ).bind(
          next.accessCipher, next.refreshCipher, next.expiresAt,
          lease, account.revision, account.refresh_cipher, account.connection_key,
        ).run();
        return saved.meta?.changes === 1;
      },
    );
    // A disconnect or owner preference revision invalidates delayed responses.
    const current = await ownerRow(db);
    if (
      current?.lease_id !== lease ||
      current.revision !== account.revision ||
      current.connection_key !== account.connection_key ||
      !current.refresh_cipher
    )
      return ownerError("Private preview was cancelled", 409);
    const marked = await db.prepare(
      "UPDATE listening_account SET checked_at=? WHERE id=1 AND lease_id=? AND revision=? AND connection_key=? AND refresh_cipher IS NOT NULL",
    ).bind(now, lease, account.revision, account.connection_key).run();
    if (marked.meta?.changes !== 1)
      return ownerError("Private preview was cancelled", 409);
    const projection = result.projection;
    return ownerJson({
      mode: projection.mode,
      updatedAt: projection.updatedAt,
      track: projection.mode === "playing" ? projection.track ?? null : null,
      private: true,
    });
  } catch (error) {
    if (error instanceof SpotifyPause) {
      await db.prepare(
        "UPDATE listening_account SET blocked_until=?,reauth_required=CASE WHEN ?=1 THEN 1 ELSE reauth_required END,public_enabled=CASE WHEN ?=1 THEN 0 ELSE public_enabled END WHERE id=1 AND revision=? AND lease_id=?",
      ).bind(now + error.delayMs, Number(error.reconnect), Number(error.reconnect), account.revision, lease).run();
      return ownerError(
        error.reconnect ? "Reconnect Spotify to continue" : "Spotify is temporarily unavailable",
        error.reconnect ? 409 : 503,
      );
    }
    if (error instanceof SpotifyProbeSuperseded)
      return ownerError("Private preview was cancelled", 409);
    return ownerError("Private Spotify playback test unavailable");
  } finally {
    await db.prepare(
      "UPDATE listening_account SET lease_id=NULL,lease_until=0 WHERE id=1 AND lease_id=?",
    ).bind(lease).run();
  }
}
async function removeConnection(env) {
  // Invalidate unused AND in-flight authorizations before clearing credentials.
  // The callback's conditional commit cannot then restore this connection.
  await env.LISTENING_DB.prepare("DELETE FROM listening_oauth_attempt").run();
  await env.LISTENING_DB.prepare(
    "UPDATE listening_account SET revision=revision+1, refresh_cipher=NULL, access_cipher=NULL, access_expires=0, connected_at=0, reauth_due=0, connection_key=NULL, public_enabled=0, show_details=0, projection_json=NULL, checked_at=0, lease_id=NULL, lease_until=0, blocked_until=0, reauth_required=0 WHERE id=1",
  ).run();
  return ownerJson({ connected: false, publicEnabled: false });
}
export function createListeningOwnerApi({
  fetcher = fetch,
  clock = Date.now,
} = {}) {
  return async function handleOwner(request, env = {}, ctx = {}) {
    if (!(await isListeningOwner(env, ctx)))
      return ownerError("Owner authentication required", 403);
    const path = new URL(request.url).pathname;
    if (
      request.method === "GET" &&
      (path === "/owner/listening/" || path === "/owner/listening")
    )
      return ownerPage();
    if (request.method !== "GET" && request.method !== "POST")
      return ownerError("Method not allowed", 405);
    if (!boundDatabase(env) || typeof env.LISTENING_TOKEN_KEY !== "string")
      return ownerError("Private integration is not configured");
    try {
      const now = clock();
      if (path === "/api/listening/admin/status" && request.method === "GET") {
        const account = await ownerRow(env.LISTENING_DB);
        if (!account) return ownerError("Database migration required");
        return ownerJson(ownerStatus(account, env));
      }
      if (path === "/api/listening/oauth/callback" && request.method === "GET")
        return completeSpotifyAuth(request, env, now, fetcher);
      if (request.method !== "POST")
        return ownerError("Method not allowed", 405);
      if (!validOwnerOrigin(request))
        return ownerError("Cross-site operation denied", 403);
      if (path === "/api/listening/oauth/start")
        return startSpotifyAuth(env, now);
      if (path === "/api/listening/admin/preview")
        return previewPlayback(env, now, fetcher, clock);
      if (path === "/api/listening/admin/settings")
        return updateVisibility(request, env, now);
      if (path === "/api/listening/admin/disconnect")
        return removeConnection(env);
      return ownerError("Not found", 404);
    } catch {
      // No provider or SQL exception text leaks to a public response.
      return ownerError("Owner request unavailable");
    }
  };
}
