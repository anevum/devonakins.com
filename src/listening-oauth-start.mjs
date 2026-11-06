/** Begin a one-time Spotify PKCE flow from the authenticated iPhone page. */
import {
  digest,
  importEncryptionKey,
  pkceChallenge,
  seal,
  secureRandom,
} from "./listening-crypto.mjs";
import {
  SPOTIFY_CALLBACK,
  SPOTIFY_SCOPE,
  ownerJson,
  ownerError,
  makeOAuthCookie,
} from "./listening-owner-core.mjs";

export function validSpotifyClientId(value) {
  return typeof value === "string" && /^[A-Za-z0-9]{16,64}$/.test(value);
}

export async function startSpotifyAuth(env, now) {
  if (!validSpotifyClientId(env.SPOTIFY_CLIENT_ID))
    return ownerError("Spotify application is not configured");
  const key = await importEncryptionKey(env.LISTENING_TOKEN_KEY);
  const state = secureRandom(32);
  const nonce = secureRandom(32);
  const verifier = secureRandom(48);
  const [stateHash, nonceHash, cipher, challenge] = await Promise.all([
    digest(state),
    digest(nonce),
    seal(verifier, key, "oauth-verifier"),
    pkceChallenge(verifier),
  ]);
  // This is a single-owner connection: starting again supersedes any previous
  // pending or in-flight flow, including flows opened on another device.
  await env.LISTENING_DB.prepare("DELETE FROM listening_oauth_attempt").run();
  await env.LISTENING_DB.prepare(
    "INSERT INTO listening_oauth_attempt(state_hash,nonce_hash,verifier_cipher,expires_at) VALUES(?,?,?,?)",
  )
    .bind(stateHash, nonceHash, cipher, now + 300_000)
    .run();
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: SPOTIFY_CALLBACK,
    scope: SPOTIFY_SCOPE,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  }).toString();
  return ownerJson({ authorizeUrl: url.href }, 200, {
    "Set-Cookie": makeOAuthCookie(nonce),
  });
}
