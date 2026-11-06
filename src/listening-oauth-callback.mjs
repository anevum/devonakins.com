/** Complete Spotify PKCE entirely on the Worker, never in browser JS. */
import {
  digest,
  importEncryptionKey,
  seal,
  unseal,
} from "./listening-crypto.mjs";
import {
  SPOTIFY_CALLBACK,
  SPOTIFY_SCOPE,
  oauthCookie,
  constantEqual,
  clearOAuthCookie,
  ownerRedirect,
  ownerRow,
} from "./listening-owner-core.mjs";

const failed = (code) =>
  ownerRedirect("/owner/listening/?error=" + code, {
    "Set-Cookie": clearOAuthCookie,
  });

export function sixMonthsFrom(now) {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() + 6);
  return date.getTime();
}
export async function completeSpotifyAuth(request, env, now, fetcher = fetch) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const nonce = oauthCookie(request.headers.get("Cookie"));
  if (
    !state ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    !nonce ||
    !/^[A-Za-z0-9_-]{43}$/.test(nonce) ||
    !code ||
    code.length > 4096 ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.getAll("code").length !== 1
  )
    return failed("callback");

  const stateHash = await digest(state);
  const attempt = await env.LISTENING_DB.prepare(
    "SELECT nonce_hash,verifier_cipher,expires_at FROM listening_oauth_attempt WHERE state_hash=?",
  )
    .bind(stateHash)
    .first();
  if (
    !attempt ||
    Number(attempt.expires_at) <= now ||
    !constantEqual(await digest(nonce), attempt.nonce_hash)
  )
    return failed("expired");

  // Atomically consume the state but retain an in-flight marker until commit.
  // Disconnect or a newer authorization deletes the marker, preventing this
  // older token exchange from reconnecting the account later.
  const consumed = await env.LISTENING_DB.prepare(
    "UPDATE listening_oauth_attempt SET expires_at=0 WHERE state_hash=? AND nonce_hash=? AND expires_at>? RETURNING verifier_cipher",
  )
    .bind(stateHash, attempt.nonce_hash, now)
    .first();
  if (!consumed) return failed("reused");

  try {
    const key = await importEncryptionKey(env.LISTENING_TOKEN_KEY);
    const verifier = await unseal(
      consumed.verifier_cipher,
      key,
      "oauth-verifier",
    );
    const response = await fetcher("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: env.SPOTIFY_CLIENT_ID,
        redirect_uri: SPOTIFY_CALLBACK,
        code_verifier: verifier,
      }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Spotify authorization rejected");
    const data = await response.json();
    if (
      data?.token_type !== "Bearer" ||
      typeof data.scope !== "string" ||
      !data.scope.split(/\s+/).includes(SPOTIFY_SCOPE) ||
      typeof data.access_token !== "string" ||
      data.access_token.length < 10 ||
      typeof data.refresh_token !== "string" ||
      data.refresh_token.length < 10 ||
      !Number.isFinite(Number(data.expires_in)) ||
      Number(data.expires_in) <= 0
    )
      throw new Error("Invalid Spotify authorization response");

    const account = await ownerRow(env.LISTENING_DB);
    if (!account) throw new Error("Listening migration missing");
    const [refreshCipher, accessCipher] = await Promise.all([
      seal(data.refresh_token, key, "refresh"),
      seal(data.access_token, key, "access"),
    ]);
    const refreshedUntil =
      now + Math.max(0, Number(data.expires_in) - 60) * 1000;
    const saved = await env.LISTENING_DB.prepare(
      "UPDATE listening_account SET revision=revision+1, refresh_cipher=?, access_cipher=?, access_expires=?, connected_at=?, reauth_due=?, public_enabled=0, show_details=0, projection_json=NULL, checked_at=0, lease_id=NULL, lease_until=0, blocked_until=0, reauth_required=0 WHERE id=1 AND EXISTS (SELECT 1 FROM listening_oauth_attempt WHERE state_hash=? AND nonce_hash=? AND expires_at=0)",
    )
      .bind(
        refreshCipher,
        accessCipher,
        refreshedUntil,
        now,
        sixMonthsFrom(now),
        stateHash,
        attempt.nonce_hash,
      )
      .run();
    if (saved.meta?.changes !== 1) return failed("expired");
    // Always reset public controls on reconnect.
    return ownerRedirect("/owner/listening/?connected=1", {
      "Set-Cookie": clearOAuthCookie,
    });
  } catch {
    // No provider error or token value is written to logs, URL or response.
    return failed("spotify");
  } finally {
    await env.LISTENING_DB.prepare(
      "DELETE FROM listening_oauth_attempt WHERE state_hash=? AND nonce_hash=? AND expires_at=0",
    )
      .bind(stateHash, attempt.nonce_hash)
      .run();
  }
}
