import test from "node:test";
import assert from "node:assert/strict";
import assets from "../.release/assets.mjs";
import { createHandler } from "../src/worker.mjs";
import { createPresenceReader, projectPlayback, retryDelayMs } from "../src/spotify-presence.mjs";

const site = createHandler(assets, { version: "test", commit: "synthetic" });
const url = (path, init) => site.fetch(new Request("https://devonakins.com" + path, init));

const sample = () => ({
  is_playing: true,
  currently_playing_type: "track",
  item: {
    id: "1234567890123456789012",
    type: "track",
    name: "Test track",
    artists: [{ name: "Test artist" }],
    album: { name: "Test album", images: [
      { url: "https://example.org/tracker.gif" },
      { url: "https://i.scdn.co/image/abc123DEF456" },
    ] },
    external_urls: { spotify: "https://attacker.example.org" },
  },
});

test("Spotify status projection never trusts provider-supplied links or artwork hosts", () => {
  const current = projectPlayback(sample(), true, "2026-11-05T00:00:00.000Z");
  assert.equal(current.mode, "playing");
  assert.equal(current.detailsVisible, true);
  assert.equal(current.track.title, "Test track");
  assert.equal(current.track.artist, "Test artist");
  assert.equal(current.track.album, "Test album");
  assert.equal(current.track.url, "https://open.spotify.com/track/1234567890123456789012");
  assert.equal(current.track.image, "https://i.scdn.co/image/abc123DEF456");

  const withoutDetails = projectPlayback(sample(), false, "2026-11-05T00:00:00.000Z");
  assert.equal(withoutDetails.mode, "playing");
  assert.equal(withoutDetails.detailsVisible, false);
  assert.equal(Object.hasOwn(withoutDetails, "track"), false);

  const unsafeId = sample(); unsafeId.item.id = "../../secret";
  assert.equal(projectPlayback(unsafeId, true, "").mode, "off_air");
  const unsafeArt = sample(); unsafeArt.item.album.images = [{ url: "https://bad.example.org/cover" }];
  assert.equal(projectPlayback(unsafeArt, true, "").track.image, null);
});

test("paused, private and non-track playback never activates coding signal", () => {
  assert.equal(projectPlayback(null, true, "").mode, "off_air");
  const paused = sample(); paused.is_playing = false;
  assert.equal(projectPlayback(paused, true, "").mode, "off_air");
  const privatePlay = sample(); privatePlay.device = { is_private_session: true };
  assert.equal(projectPlayback(privatePlay, true, "").mode, "off_air");
  const advert = sample(); advert.currently_playing_type = "ad";
  assert.equal(projectPlayback(advert, true, "").mode, "off_air");
});

test("public API defaults to hidden and does not accept write methods", async () => {
  const response = await url("/api/listening/now");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /application\/json/);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("CDN-Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    version: 1, mode: "hidden", detailsVisible: false,
  });
  const head = await url("/api/listening/now", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await url("/api/listening/now", { method: "POST" })).status, 405);
  assert.equal((await url("/api/listening/private")).status, 404);
});

test("enabled presence caches Spotify reads, returns sanitized track and respects kill switch", async () => {
  const calls = [];
  let t = Date.parse("2026-11-05T00:00:00.000Z");
  let playing = true;
  const fetcher = async (href, options = {}) => {
    calls.push([href, options.method ?? "GET"]);
    if (href === "https://accounts.spotify.com/api/token")
      return new Response(JSON.stringify({ access_token: "mock_access_token_12345", expires_in: 3600 }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    assert.match(options.headers.Authorization, /^Bearer /);
    if (!playing) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(sample()), { status: 200 });
  };
  const read = createPresenceReader({ fetcher, now: () => t, ttlMs: 60_000 });
  const env = {
    SPOTIFY_PUBLIC_NOW_PLAYING: "true",
    SPOTIFY_SHARE_TRACK_DETAILS: "true",
    SPOTIFY_CLIENT_ID: "test-client",
    SPOTIFY_CLIENT_SECRET: "test-secret",
    SPOTIFY_REFRESH_TOKEN: "test-refresh",
  };
  const first = await (await read(env)).json();
  assert.equal(first.mode, "playing");
  assert.equal(first.detailsVisible, true);
  assert.equal(first.track.title, "Test track");
  assert.equal(calls.length, 2);
  const second = await (await read(env)).json();
  assert.deepEqual(second, first);
  assert.equal(calls.length, 2, "cached response must not trigger Spotify requests");

  t += 60_001;
  playing = false;
  const paused = await (await read(env)).json();
  assert.equal(paused.mode, "off_air");
  assert.equal(Object.hasOwn(paused, "track"), false);
  assert.equal(calls.length, 3, "reuse access token; refresh playback only");

  const hidden = await (await read({ ...env, SPOTIFY_PUBLIC_NOW_PLAYING: "false" })).json();
  assert.deepEqual(hidden, { version: 1, mode: "hidden", detailsVisible: false });
  assert.equal(calls.length, 3);
  const detailsOff = await (await read({ ...env, SPOTIFY_SHARE_TRACK_DETAILS: "false" })).json();
  assert.equal(detailsOff.mode, "off_air");
  assert.equal(Object.hasOwn(detailsOff, "track"), false);
});

test("concurrent privacy shutoff suppresses a previously in-flight public track", async () => {
  let releaseSpotify;
  let beganSpotify;
  const spotifyStarted = new Promise((resolve) => { beganSpotify = resolve; });
  const fetcher = async (href) => {
    if (href === "https://accounts.spotify.com/api/token") {
      return new Response(JSON.stringify({ access_token: "mock_access_token_12345", expires_in: 3600 }), {
        status: 200,
      });
    }
    beganSpotify();
    return new Promise((resolve) => { releaseSpotify = resolve; });
  };
  const read = createPresenceReader({ fetcher });
  const activeEnv = {
    SPOTIFY_PUBLIC_NOW_PLAYING: "true",
    SPOTIFY_SHARE_TRACK_DETAILS: "true",
    SPOTIFY_CLIENT_ID: "client",
    SPOTIFY_CLIENT_SECRET: "secret",
    SPOTIFY_REFRESH_TOKEN: "refresh",
  };
  const inFlight = read(activeEnv);
  await spotifyStarted;
  const off = await (await read({ ...activeEnv, SPOTIFY_PUBLIC_NOW_PLAYING: "false" })).json();
  assert.deepEqual(off, { version: 1, mode: "hidden", detailsVisible: false });
  releaseSpotify(new Response(JSON.stringify(sample()), { status: 200 }));
  const priorRequest = await (await inFlight).json();
  assert.equal(priorRequest.mode, "hidden", "in-flight public response must not resume after kill switch");
});

test("provider errors, missing configuration and malformed responses fail closed", async () => {
  const env = {
    SPOTIFY_PUBLIC_NOW_PLAYING: "true",
    SPOTIFY_SHARE_TRACK_DETAILS: "true",
    SPOTIFY_CLIENT_ID: "test-client",
    SPOTIFY_CLIENT_SECRET: "test-secret",
    SPOTIFY_REFRESH_TOKEN: "test-refresh",
  };
  const missing = await (await createPresenceReader()( { SPOTIFY_PUBLIC_NOW_PLAYING: "true" } )).json();
  assert.equal(missing.mode, "unavailable");
  const read429 = createPresenceReader({ fetcher: async (url) => {
    if (url.includes("/api/token"))
      return new Response(JSON.stringify({ access_token: "mock_access_token_12345", expires_in: 3600 }), { status: 200 });
    return new Response("rate limited", { status: 429 });
  }});
  const unavailable = await (await read429(env)).json();
  assert.equal(unavailable.mode, "unavailable");
  assert.equal(JSON.stringify(unavailable).includes("test-secret"), false);
  assert.equal(Object.hasOwn(unavailable, "track"), false);
});

test("Listening panel, canonical route and persistent navigation are available across pages", async () => {
  const home = await (await url("/")).text();
  const listeningResponse = await url("/listening/");
  assert.equal(listeningResponse.status, 200);
  const listening = await listeningResponse.text();
  assert.match(listening, /href="https:\/\/devonakins.com\/listening\/"/);
  for (const html of [home, listening, await (await url("/gpt/")).text(), await (await url("/work/merit/")).text()]) {
    assert.match(html, /id="presence-ticker"/);
    assert.match(html, /href="\/listening\/"/);
    assert.match(html, /id="tab-listening"/);
    assert.match(html, /id="panel-listening"/);
    assert.match(html, /id="listening-track-title"/);
    assert.match(html, /\/v2\/listening\.css\?v=1/);
  }
  assert.match(listening, /data-initial-view="listening"/);
  assert.match(listening, /id="tab-listening"[^>]*aria-selected="true"/);
  assert.match(listening, /data-panel="listening">/);
  assert.equal((await url("/listening")).status, 308);
  const siteMap = await (await url("/sitemap.xml")).text();
  assert.match(siteMap, /https:\/\/devonakins.com\/listening\//);
});


test("PKCE refresh omits the client secret; rate limiting respects Retry-After", async () => {
  let timestamp = Date.parse("2026-11-05T00:00:00.000Z");
  let refreshCount = 0, playerCount = 0;
  const fetcher = async (url, options) => {
    if (url.includes("accounts.spotify.com")) {
      refreshCount++;
      const body = new URLSearchParams(options.body);
      assert.equal(body.get("client_id"), "sample-client");
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(options.headers.Authorization, undefined);
      return new Response(JSON.stringify({ access_token: "placeholder_access_12345", expires_in: 3600 }), { status: 200 });
    }
    playerCount++;
    if (playerCount === 1)
      return new Response("429", { status: 429, headers: { "Retry-After": "120" } });
    return new Response(JSON.stringify(sample()), { status: 200 });
  };
  const reader = createPresenceReader({ fetcher, now: () => timestamp, ttlMs: 60_000 });
  const env = { SPOTIFY_PUBLIC_NOW_PLAYING: "true", SPOTIFY_SHARE_TRACK_DETAILS: "true",
    SPOTIFY_CLIENT_ID: "sample-client", SPOTIFY_REFRESH_TOKEN: "placeholder_refresh" };
  assert.equal((await (await reader(env)).json()).mode, "unavailable");
  timestamp += 65_000;
  assert.equal((await (await reader(env)).json()).mode, "unavailable");
  assert.equal(playerCount, 1, "cooldown must prevent a repeated rate-limited call");
  timestamp += 56_000;
  assert.equal((await (await reader(env)).json()).mode, "playing");
  assert.equal(playerCount, 2);
  assert.equal(refreshCount, 1, "cached access token must be reused");
  assert.equal(retryDelayMs("120"), 120_000);
  assert.equal(retryDelayMs("not-a-delay"), 60_000);
  assert.equal(retryDelayMs("9999999"), 900_000);
});
