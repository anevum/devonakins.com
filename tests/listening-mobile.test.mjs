import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { base64url, importEncryptionKey, unseal } from "../src/listening-crypto.mjs";
import { createListeningOwnerApi } from "../src/listening-owner-api.mjs";
import { createD1PresenceReader } from "../src/listening-d1-presence.mjs";

const now = Date.parse("2026-11-05T08:00:00.000Z");
const clientId = "0123456789abcdef0123456789abcdef";
const access = "mock_access_01234";
const refresh = "mock_refresh_01234";
const headers = { Origin: "https://devonakins.com", "Sec-Fetch-Site": "same-origin" };
const ctx = {
  access: {
    aud: "owner-audience-test",
    getIdentity: async () => ({ email: "owner@example.invalid" }),
  },
};
const track = () => ({
  is_playing: true, currently_playing_type: "track",
  item: { type: "track", id: "1234567890123456789012", name: "Fixture song",
    artists: [{ name: "Fixture artist" }], album: { name: "Fixture album", images: [] } },
});
async function fixture() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(await readFile(new URL("../migrations/0001_listening.sql", import.meta.url), "utf8"));
  const db = {
    prepare(query) {
      const stmt = raw.prepare(query);
      const use = args => ({
        first: async () => stmt.get(...args) ?? null,
        run: async () => ({ meta: { changes: Number(stmt.run(...args).changes) } }),
      });
      return { ...use([]), bind: (...values) => use(values) };
    },
  };
  const env = {
    LISTENING_DB: db,
    LISTENING_TOKEN_KEY: base64url(new Uint8Array(32).fill(9)),
    LISTENING_ACCESS_AUD: ctx.access.aud,
    LISTENING_OWNER_EMAIL: "owner@example.invalid",
    LISTENING_PUBLIC_RELEASE_APPROVED: "false",
    SPOTIFY_CLIENT_ID: clientId,
  };
  return { env, db, raw, close: () => raw.close() };
}
const req = (path, options = {}) =>
  new Request("https://devonakins.com" + path, options);
const ownerPost = path => req(path, { method: "POST", headers });
async function connect(api, env) {
  const started = await api(ownerPost("/api/listening/oauth/start"), env, ctx);
  assert.equal(started.status, 200);
  const { authorizeUrl } = await started.json();
  const spotifyUrl = new URL(authorizeUrl);
  assert.equal(spotifyUrl.origin, "https://accounts.spotify.com");
  assert.equal(spotifyUrl.searchParams.get("scope"), "user-read-currently-playing");
  assert.equal(spotifyUrl.searchParams.get("redirect_uri"), "https://devonakins.com/api/listening/oauth/callback");
  const cookie = started.headers.get("set-cookie").split(";")[0];
  const state = spotifyUrl.searchParams.get("state");
  const result = await api(req("/api/listening/oauth/callback?state=" + state + "&code=fixture-code",
    { headers: { Cookie: cookie } }), env, ctx);
  assert.equal(result.status, 303);
  assert.equal(result.headers.get("Location"), "/owner/listening/?connected=1");
  return { state, cookie };
}

test("only matching Cloudflare Access identity can reach the owner UI", async () => {
  const { env, close } = await fixture();
  const api = createListeningOwnerApi();
  try {
    const page = req("/owner/listening/");
    assert.equal((await api(page, env, {})).status, 403);
    assert.equal((await api(page, env, { access: { aud: ctx.access.aud, getIdentity: async () => ({ email: "other@example.invalid" }) } })).status, 403);
    assert.equal((await api(page, { ...env, LISTENING_ACCESS_AUD: "wrong" }, ctx)).status, 403);
    const allowed = await api(page, env, ctx);
    assert.equal(allowed.status, 200);
    assert.match(allowed.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
    assert.match(await allowed.text(), /Connect Spotify/);
    assert.equal((await api(req("/api/listening/admin/status"), env, {})).status, 403);
    assert.equal((await api(ownerPost("/api/listening/oauth/start"), env, {})).status, 403);
    assert.equal((await api(req("/api/listening/oauth/start", { method: "POST" }), env, ctx)).status, 403);
  } finally { close(); }
});

test("iPhone PKCE callback stores encrypted tokens and resets public sharing", async () => {
  const { env, db, close } = await fixture();
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push([url, new URLSearchParams(init.body)]);
    return new Response(JSON.stringify({
      token_type: "Bearer", scope: "user-read-currently-playing",
      access_token: access, refresh_token: refresh, expires_in: 3600,
    }), { status: 200 });
  };
  const api = createListeningOwnerApi({ fetcher, clock: () => now });
  try {
    const { state, cookie } = await connect(api, env);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "https://accounts.spotify.com/api/token");
    assert.equal(calls[0][1].get("grant_type"), "authorization_code");
    assert.equal(calls[0][1].get("code"), "fixture-code");
    assert.ok(calls[0][1].get("code_verifier"));
    const account = await db.prepare("SELECT * FROM listening_account WHERE id=1").first();
    assert.ok(account.refresh_cipher);
    assert.doesNotMatch(account.refresh_cipher, /mock_refresh/);
    const key = await importEncryptionKey(env.LISTENING_TOKEN_KEY);
    assert.equal(await unseal(account.refresh_cipher, key, "refresh"), refresh);
    assert.equal(account.public_enabled, 0);
    const status = await api(req("/api/listening/admin/status"), env, ctx);
    assert.equal(status.status, 200);
    const body = await status.json();
    assert.equal(body.connected, true);
    assert.equal(body.publicEnabled, false);
    assert.doesNotMatch(JSON.stringify(body), /mock_refresh|mock_access/);
    const repeated = await api(req("/api/listening/oauth/callback?state=" + state + "&code=fixture-code",
      { headers: { Cookie: cookie } }), env, ctx);
    assert.equal(repeated.headers.get("Location"), "/owner/listening/?error=expired");
    assert.equal(calls.length, 1);
  } finally { close(); }
});


test("owner privacy controls are locked by default and disconnect removes credentials", async () => {
  const { env, db, close } = await fixture();
  const auth = createListeningOwnerApi({ clock: () => now, fetcher: async () => new Response(
    JSON.stringify({ token_type: "Bearer", scope: "user-read-currently-playing",
      access_token: access, refresh_token: refresh, expires_in: 3600 }), { status: 200 }) });
  const setting = (publicEnabled, showDetails) => req("/api/listening/admin/settings", {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ publicEnabled, showDetails }),
  });
  try {
    await connect(auth, env);
    assert.equal((await auth(setting(true, true), env, ctx)).status, 403);
    const read = createD1PresenceReader({ clock: () => now,
      fetcher: () => { throw Error("Spotify must not be contacted while hidden"); } });
    assert.equal((await (await read(env)).json()).mode, "hidden");
    env.LISTENING_PUBLIC_RELEASE_APPROVED = "true";
    const updated = await auth(setting(true, true), env, ctx);
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).publicEnabled, true);
    const reader = createD1PresenceReader({ clock: () => now, fetcher: async (url) => {
      assert.equal(url, "https://api.spotify.com/v1/me/player/currently-playing");
      return new Response(JSON.stringify(track()), { status: 200 });
    } });
    const live = await (await reader(env)).json();
    assert.equal(live.mode, "playing");
    assert.equal(live.track.title, "Fixture song");
    assert.equal((await (await reader(env)).json()).mode, "playing");
    const off = await auth(setting(false, false), env, ctx);
    assert.equal(off.status, 200);
    assert.equal((await (await reader(env)).json()).mode, "hidden");
    assert.equal((await auth(setting(true, false), env, {})).status, 403);
    assert.equal((await auth(req("/api/listening/admin/disconnect", { method:"POST", headers: { Origin: "https://cross-site.invalid" } }), env, ctx)).status, 403);
    assert.equal((await auth(ownerPost("/api/listening/admin/disconnect"), env, ctx)).status, 200);
    const row = await db.prepare("SELECT * FROM listening_account WHERE id=1").first();
    assert.equal(row.refresh_cipher, null);
    assert.equal(row.public_enabled, 0);
    assert.equal(row.projection_json, null);
  } finally { close(); }
});

test("single DB lease prevents concurrent probes from resurrecting disabled playback", async () => {
  const { env, db, close } = await fixture();
  const api = createListeningOwnerApi({ clock: () => now, fetcher: async () => new Response(
    JSON.stringify({ token_type: "Bearer", scope: "user-read-currently-playing",
      access_token: access, refresh_token: refresh, expires_in: 3600 }), { status: 200 }) });
  const setting = req("/api/listening/admin/settings", {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ publicEnabled: true, showDetails: true }),
  });
  let releaseRequest;
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const fetcher = async () => {
    started();
    return new Promise(resolve => { releaseRequest = resolve; });
  };
  try {
    await connect(api, env);
    env.LISTENING_PUBLIC_RELEASE_APPROVED = "true";
    assert.equal((await api(setting, env, ctx)).status, 200);
    const firstReader = createD1PresenceReader({ fetcher, clock: () => now });
    const secondReader = createD1PresenceReader({ fetcher, clock: () => now });
    const first = firstReader(env);
    await pending;
    assert.equal((await (await secondReader(env)).json()).mode, "unavailable");
    assert.equal((await api(ownerPost("/api/listening/admin/disconnect"), env, ctx)).status, 200);
    releaseRequest(new Response(JSON.stringify(track()), { status: 200 }));
    assert.equal((await (await first).json()).mode, "hidden");
    const account = await db.prepare("SELECT * FROM listening_account WHERE id=1").first();
    assert.equal(account.projection_json, null);
    assert.equal(account.refresh_cipher, null);
  } finally { close(); }
});
