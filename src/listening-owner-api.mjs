/** Cloudflare-Access-protected administrative routes for Spotify owner. */
import { renderListeningOwner } from "./listening-owner-page.mjs";
import { startSpotifyAuth } from "./listening-oauth-start.mjs";
import { completeSpotifyAuth } from "./listening-oauth-callback.mjs";
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
async function removeConnection(env) {
  // Privacy kill switch first; then discard any unused OAuth attempts.
  await env.LISTENING_DB.prepare(
    "UPDATE listening_account SET revision=revision+1, refresh_cipher=NULL, access_cipher=NULL, access_expires=0, connected_at=0, reauth_due=0, public_enabled=0, show_details=0, projection_json=NULL, checked_at=0, lease_id=NULL, lease_until=0, blocked_until=0, reauth_required=0 WHERE id=1",
  ).run();
  await env.LISTENING_DB.prepare("DELETE FROM listening_oauth_attempt").run();
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
