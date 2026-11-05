/** Request/identity boundary for private owner Spotify controls. */
export const SPOTIFY_CALLBACK = "https://devonakins.com/api/listening/oauth/callback";
export const SPOTIFY_SCOPE = "user-read-currently-playing";
export const OAUTH_COOKIE = "__Host-listening_oauth";
export const ownerHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
export const ownerJson = (payload, status = 200, more = {}) =>
  new Response(JSON.stringify(payload), { status, headers: {
    ...ownerHeaders, "Content-Type": "application/json; charset=utf-8", ...more,
  } });
export const ownerError = (message = "Operation unavailable", status = 503) =>
  ownerJson({ error: message }, status);
export const ownerRedirect = (path, more = {}) =>
  new Response(null, { status: 303, headers: { ...ownerHeaders, Location: path, ...more } });
export const clearOAuthCookie =
  OAUTH_COOKIE + "=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax";
export const makeOAuthCookie = (nonce) =>
  OAUTH_COOKIE + "=" + nonce + "; Path=/; Max-Age=300; Secure; HttpOnly; SameSite=Lax";
export function oauthCookie(header) {
  const match = (header || "").split(";").map(item => item.trim())
    .find(item => item.startsWith(OAUTH_COOKIE + "="));
  return match?.slice(OAUTH_COOKIE.length + 1) || "";
}
export function constantEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function isListeningOwner(env, ctx) {
  if (typeof env.LISTENING_OWNER_EMAIL !== "string" ||
      typeof env.LISTENING_ACCESS_AUD !== "string" ||
      !ctx?.access || ctx.access.aud !== env.LISTENING_ACCESS_AUD) return false;
  try {
    const identity = await ctx.access.getIdentity();
    return typeof identity?.email === "string" &&
      constantEqual(identity.email.trim().toLowerCase(), env.LISTENING_OWNER_EMAIL.trim().toLowerCase());
  } catch { return false; }
}
export function validOwnerOrigin(request) {
  const origin = new URL(request.url).origin;
  const source = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  return source === origin && (!site || site === "same-origin");
}
export const boundDatabase = env => !!env.LISTENING_DB && typeof env.LISTENING_DB.prepare === "function";
export const ownerRow = db => db.prepare("SELECT * FROM listening_account WHERE id=1").first();
export const publicReleaseApproved = env => env.LISTENING_PUBLIC_RELEASE_APPROVED === "true";
export const ownerStatus = (row, env) => ({
  connected: !!row?.refresh_cipher,
  reauthorizationRequired: !!row?.reauth_required || (!!row?.reauth_due && row.reauth_due <= Date.now()),
  publicEnabled: !!row?.public_enabled && publicReleaseApproved(env),
  showDetails: !!row?.show_details,
  publishingAllowed: publicReleaseApproved(env),
  connectedAt: row?.connected_at ? new Date(row.connected_at).toISOString() : null,
  reauthorizeBy: row?.reauth_due ? new Date(row.reauth_due).toISOString() : null,
});
export async function readSmallJson(request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new Error("Expected JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const pieces = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024) throw new Error("Body too large");
      pieces.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const piece of pieces) { bytes.set(piece, offset); offset += piece.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
