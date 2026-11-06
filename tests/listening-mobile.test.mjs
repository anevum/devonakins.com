import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
  base64url,
  importEncryptionKey,
  unseal,
} from "../src/listening-crypto.mjs";
import { createListeningOwnerApi } from "../src/listening-owner-api.mjs";
import { createD1PresenceReader } from "../src/listening-d1-presence.mjs";
import assets from "../.release/assets.mjs";
import { createHandler } from "../src/worker.mjs";

const now = Date.parse("2026-11-05T08:00:00.000Z");
const clientId = "0123456789abcdef0123456789abcdef";
const access = "mock_access_01234";
const refresh = "mock_refresh_01234";
const headers = {
  Origin: "https://devonakins.com",
  "Sec-Fetch-Site": "same-origin",
};
const ctx = {
  access: {
    aud: "owner-audience-test",
    getIdentity: async () => ({ email: "owner@example.invalid" }),
  },
};
const track = () => ({
  is_playing: true,
  currently_playing_type: "track",
  item: {
    type: "track",
    id: "1234567890123456789012",
    name: "Fixture song",
    artists: [{ name: "Fixture artist" }],
    album: { name: "Fixture album", images: [] },
  },
});
async function fixture() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(
    await readFile(
      new URL("../migrations/0001_listening.sql", import.meta.url),
      "utf8",
    ),
  );
  raw.exec(await readFile(new URL("../migrations/0005_listening_collections.sql", import.meta.url), "utf8"));
  const db = {
    prepare(query) {
      const stmt = raw.prepare(query);
      const use = (args) => ({
        first: async () => stmt.get(...args) ?? null,
        run: async () => ({
          meta: { changes: Number(stmt.run(...args).changes) },
        }),
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
const ownerPost = (path) => req(path, { method: "POST", headers });
async function connect(api, env) {
  const started = await api(ownerPost("/api/listening/oauth/start"), env, ctx);
  assert.equal(started.status, 200);
  const { authorizeUrl } = await started.json();
  const spotifyUrl = new URL(authorizeUrl);
  assert.equal(spotifyUrl.origin, "https://accounts.spotify.com");
  assert.equal(
    spotifyUrl.searchParams.get("scope"),
    "user-read-currently-playing",
  );
  assert.equal(
    spotifyUrl.searchParams.get("redirect_uri"),
    "https://devonakins.com/api/listening/oauth/callback",
  );
  const cookie = started.headers.get("set-cookie").split(";")[0];
  const state = spotifyUrl.searchParams.get("state");
  const result = await api(
    req("/api/listening/oauth/callback?state=" + state + "&code=fixture-code", {
      headers: { Cookie: cookie },
    }),
    env,
    ctx,
  );
  assert.equal(result.status, 303);
  assert.equal(result.headers.get("Location"), "/owner/listening/?connected=1");
  return { state, cookie };
}

test("owner Spotify readiness is private and missing app setup cannot start OAuth", async () => {
  const { env, db, close } = await fixture();
  const api = createListeningOwnerApi();
  const statusRequest = req("/api/listening/admin/status");
  try {
    assert.equal((await api(statusRequest, env, {})).status, 403);
    const configured = await (await api(statusRequest, env, ctx)).json();
    assert.equal(configured.spotifyAppConfigured, true);
    assert.equal(configured.connected, false);
    assert.doesNotMatch(JSON.stringify(configured), new RegExp(clientId));
    delete env.SPOTIFY_CLIENT_ID;
    const missing = await (await api(statusRequest, env, ctx)).json();
    assert.equal(missing.spotifyAppConfigured, false);
    assert.equal(missing.connected, false);
    assert.equal(
      (await api(ownerPost("/api/listening/oauth/start"), env, ctx)).status,
      503,
    );
    const queued = await db
      .prepare("SELECT COUNT(*) AS total FROM listening_oauth_attempt")
      .first();
    assert.equal(queued.total, 0);
    env.SPOTIFY_CLIENT_ID = "invalid";
    const invalid = await (await api(statusRequest, env, ctx)).json();
    assert.equal(invalid.spotifyAppConfigured, false);
    const page = await api(req("/owner/listening/"), env, ctx);
    const html = await page.text();
    assert.match(html, /id="spotify-setup" hidden/);
    assert.match(html, /https:\/\/devonakins.com\/api\/listening\/oauth\/callback/);
    assert.match(html, /developer.spotify.com\/dashboard/);
  } finally {
    close();
  }
});

test("manual owner playback check never enables or persists public listening", async () => {
  const f = await fixture();
  let playbackCalls = 0;
  const fetcher = async (url) => {
    if (url.includes("accounts.spotify.com")) {
      return Response.json({
        token_type: "Bearer", scope: "user-read-currently-playing",
        access_token: access, refresh_token: refresh, expires_in: 3600,
      });
    }
    playbackCalls++;
    return Response.json(track());
  };
  const api = createListeningOwnerApi({ fetcher, clock: () => now });
  try {
    await connect(api, f.env);
    assert.equal((await api(ownerPost("/api/listening/admin/preview"), f.env, {})).status, 403);
    assert.equal((await api(req("/api/listening/admin/preview"), f.env, ctx)).status, 405);
    assert.equal((await api(req("/api/listening/admin/preview", {
      method: "POST", headers: { Origin: "https://other.example" },
    }), f.env, ctx)).status, 403);
    const preview = await api(ownerPost("/api/listening/admin/preview"), f.env, ctx);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("Cache-Control"), "private, no-store, max-age=0");
    assert.equal(preview.headers.get("CDN-Cache-Control"), "no-store");
    const body = await preview.json();
    assert.equal(body.private, true);
    assert.equal(body.mode, "playing");
    assert.equal(body.track.title, "Fixture song");
    assert.equal(body.track.artist, "Fixture artist");
    assert.doesNotMatch(JSON.stringify(body), /mock_(access|refresh)/);
    const state = await f.db.prepare(
      "SELECT public_enabled,show_details,projection_json,checked_at,refresh_cipher FROM listening_account WHERE id=1",
    ).first();
    assert.equal(state.public_enabled, 0);
    assert.equal(state.show_details, 0);
    assert.equal(state.projection_json, null);
    assert.equal(state.checked_at, now);
    assert.ok(state.refresh_cipher);
    const anotherIsolate = createListeningOwnerApi({ fetcher, clock: () => now });
    assert.equal((await anotherIsolate(ownerPost("/api/listening/admin/preview"), f.env, ctx)).status, 429);
    assert.equal(playbackCalls, 1);
  } finally {
    f.close();
  }
});

test("manual owner playback check handles no current Spotify track without publishing", async () => {
  const f = await fixture();
  const api = createListeningOwnerApi({
    clock: () => now,
    fetcher: async (url) => url.includes("accounts.spotify.com")
      ? Response.json({
          token_type: "Bearer", scope: "user-read-currently-playing",
          access_token: access, refresh_token: refresh, expires_in: 3600,
        })
      : new Response(null, { status: 204 }),
  });
  try {
    assert.equal((await api(ownerPost("/api/listening/admin/preview"), f.env, ctx)).status, 409);
    await connect(api, f.env);
    const result = await api(ownerPost("/api/listening/admin/preview"), f.env, ctx);
    assert.equal(result.status, 200);
    assert.deepEqual(Object.keys(await result.json()).sort(), ["mode","private","track","updatedAt"]);
    const row = await f.db.prepare(
      "SELECT public_enabled,projection_json,refresh_cipher FROM listening_account WHERE id=1",
    ).first();
    assert.equal(row.public_enabled, 0);
    assert.equal(row.projection_json, null);
    assert.ok(row.refresh_cipher);
  } finally {
    f.close();
  }
});

test("disconnect invalidates in-flight private playback and never returns a stale track", async () => {
  const f = await fixture();
  let resolvePlayback, notify;
  const entered = new Promise(resolve => { notify = resolve; });
  const fetcher = async (url) => {
    if (url.includes("accounts.spotify.com")) {
      return Response.json({
        token_type: "Bearer", scope: "user-read-currently-playing",
        access_token: access, refresh_token: refresh, expires_in: 3600,
      });
    }
    notify();
    return new Promise(resolve => { resolvePlayback = resolve; });
  };
  const api = createListeningOwnerApi({ fetcher, clock: () => now });
  try {
    await connect(api, f.env);
    const pending = api(ownerPost("/api/listening/admin/preview"), f.env, ctx);
    await entered;
    assert.equal((await api(ownerPost("/api/listening/admin/disconnect"), f.env, ctx)).status, 200);
    resolvePlayback(Response.json(track()));
    const preview = await pending;
    assert.equal(preview.status, 409);
    assert.doesNotMatch(JSON.stringify(await preview.json()), /Fixture song|mock_refresh/);
    const row = await f.db.prepare(
      "SELECT refresh_cipher,projection_json,public_enabled,lease_id FROM listening_account WHERE id=1",
    ).first();
    assert.equal(row.refresh_cipher, null);
    assert.equal(row.projection_json, null);
    assert.equal(row.public_enabled, 0);
    assert.equal(row.lease_id, null);
  } finally {
    f.close();
  }
});

test("only matching Cloudflare Access identity can reach the owner UI", async () => {
  const { env, close } = await fixture();
  const api = createListeningOwnerApi();
  try {
    const page = req("/owner/listening/");
    assert.equal((await api(page, env, {})).status, 403);
    assert.equal(
      (
        await api(page, env, {
          access: {
            aud: ctx.access.aud,
            getIdentity: async () => ({ email: "other@example.invalid" }),
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (await api(page, { ...env, LISTENING_ACCESS_AUD: "wrong" }, ctx)).status,
      403,
    );
    const allowed = await api(page, env, ctx);
    assert.equal(allowed.status, 200);
    assert.match(
      allowed.headers.get("Content-Security-Policy"),
      /frame-ancestors 'none'/,
    );
    assert.match(await allowed.text(), /Connect Spotify/);
    assert.equal(
      (await api(req("/api/listening/admin/status"), env, {})).status,
      403,
    );
    assert.equal(
      (await api(ownerPost("/api/listening/oauth/start"), env, {})).status,
      403,
    );
    assert.equal(
      (
        await api(
          req("/api/listening/oauth/start", { method: "POST" }),
          env,
          ctx,
        )
      ).status,
      403,
    );
  } finally {
    close();
  }
});

test("iPhone PKCE callback stores encrypted tokens and resets public sharing", async () => {
  const { env, db, close } = await fixture();
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push([url, new URLSearchParams(init.body)]);
    return new Response(
      JSON.stringify({
        token_type: "Bearer",
        scope: "user-read-currently-playing",
        access_token: access,
        refresh_token: refresh,
        expires_in: 3600,
      }),
      { status: 200 },
    );
  };
  const api = createListeningOwnerApi({ fetcher, clock: () => now });
  try {
    const { state, cookie } = await connect(api, env);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "https://accounts.spotify.com/api/token");
    assert.equal(calls[0][1].get("grant_type"), "authorization_code");
    assert.equal(calls[0][1].get("code"), "fixture-code");
    assert.ok(calls[0][1].get("code_verifier"));
    const account = await db
      .prepare("SELECT * FROM listening_account WHERE id=1")
      .first();
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
    const repeated = await api(
      req(
        "/api/listening/oauth/callback?state=" + state + "&code=fixture-code",
        { headers: { Cookie: cookie } },
      ),
      env,
      ctx,
    );
    assert.equal(
      repeated.headers.get("Location"),
      "/owner/listening/?error=expired",
    );
    assert.equal(calls.length, 1);
  } finally {
    close();
  }
});

test("owner privacy controls are locked by default and disconnect removes credentials", async () => {
  const { env, db, close } = await fixture();
  const auth = createListeningOwnerApi({
    clock: () => now,
    fetcher: async () =>
      new Response(
        JSON.stringify({
          token_type: "Bearer",
          scope: "user-read-currently-playing",
          access_token: access,
          refresh_token: refresh,
          expires_in: 3600,
        }),
        { status: 200 },
      ),
  });
  const setting = (publicEnabled, showDetails) =>
    req("/api/listening/admin/settings", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ publicEnabled, showDetails }),
    });
  try {
    await connect(auth, env);
    assert.equal((await auth(setting(true, true), env, ctx)).status, 403);
    const read = createD1PresenceReader({
      clock: () => now,
      fetcher: () => {
        throw Error("Spotify must not be contacted while hidden");
      },
    });
    assert.equal((await (await read(env)).json()).mode, "hidden");
    env.LISTENING_PUBLIC_RELEASE_APPROVED = "true";
    const updated = await auth(setting(true, true), env, ctx);
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).publicEnabled, true);
    const reader = createD1PresenceReader({
      clock: () => now,
      fetcher: async (url) => {
        assert.equal(
          url,
          "https://api.spotify.com/v1/me/player/currently-playing",
        );
        return new Response(JSON.stringify(track()), { status: 200 });
      },
    });
    const live = await (await reader(env)).json();
    assert.equal(live.mode, "playing");
    assert.equal(live.track.title, "Fixture song");
    assert.equal((await (await reader(env)).json()).mode, "playing");
    const off = await auth(setting(false, false), env, ctx);
    assert.equal(off.status, 200);
    assert.equal((await (await reader(env)).json()).mode, "hidden");
    assert.equal((await auth(setting(true, false), env, {})).status, 403);
    assert.equal(
      (
        await auth(
          req("/api/listening/admin/disconnect", {
            method: "POST",
            headers: { Origin: "https://cross-site.invalid" },
          }),
          env,
          ctx,
        )
      ).status,
      403,
    );
    assert.equal(
      (await auth(ownerPost("/api/listening/admin/disconnect"), env, ctx))
        .status,
      200,
    );
    const row = await db
      .prepare("SELECT * FROM listening_account WHERE id=1")
      .first();
    assert.equal(row.refresh_cipher, null);
    assert.equal(row.public_enabled, 0);
    assert.equal(row.projection_json, null);
  } finally {
    close();
  }
});

test("single DB lease prevents concurrent probes from resurrecting disabled playback", async () => {
  const { env, db, close } = await fixture();
  const api = createListeningOwnerApi({
    clock: () => now,
    fetcher: async () =>
      new Response(
        JSON.stringify({
          token_type: "Bearer",
          scope: "user-read-currently-playing",
          access_token: access,
          refresh_token: refresh,
          expires_in: 3600,
        }),
        { status: 200 },
      ),
  });
  const setting = req("/api/listening/admin/settings", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ publicEnabled: true, showDetails: true }),
  });
  let releaseRequest;
  let started;
  const pending = new Promise((resolve) => {
    started = resolve;
  });
  const fetcher = async () => {
    started();
    return new Promise((resolve) => {
      releaseRequest = resolve;
    });
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
    assert.equal(
      (await api(ownerPost("/api/listening/admin/disconnect"), env, ctx))
        .status,
      200,
    );
    releaseRequest(new Response(JSON.stringify(track()), { status: 200 }));
    assert.equal((await (await first).json()).mode, "hidden");
    const account = await db
      .prepare("SELECT * FROM listening_account WHERE id=1")
      .first();
    assert.equal(account.projection_json, null);
    assert.equal(account.refresh_cipher, null);
  } finally {
    close();
  }
});

test("real Worker entrypoint fails closed on owner paths and exposes private assets only as inert code", async () => {
  const site = createHandler(assets, { version: "test", commit: "synthetic" });
  const { env, close } = await fixture();
  try {
    assert.equal((await site.fetch(req("/owner/listening/"))).status, 403);
    assert.equal(
      (await site.fetch(ownerPost("/api/listening/oauth/start"))).status,
      403,
    );
    assert.equal(
      (await site.fetch(req("/api/listening/admin/status"))).status,
      403,
    );
    assert.equal(
      (await site.fetch(req("/api/listening/oauth/callback?state=x&code=y")))
        .status,
      403,
    );
    assert.equal(
      (await site.fetch(ownerPost("/api/listening/admin/disconnect"), env, {}))
        .status,
      403,
    );
    const authorized = await site.fetch(req("/owner/listening/"), env, ctx);
    assert.equal(authorized.status, 200);
    assert.match(authorized.headers.get("X-Robots-Tag"), /noindex/);
    assert.match(await authorized.text(), /Spotify connection/);
    assert.equal(
      (await site.fetch(req("/v2/listening-owner.css"))).status,
      200,
    );
    assert.equal((await site.fetch(req("/v2/listening-owner.js"))).status, 200);
    for (const path of ["/v2/listening-owner.js", "/v2/presence-owner.js"]) {
      const script = await site.fetch(req(path));
      assert.equal(script.status, 200);
      assert.equal(
        script.headers.get("Cache-Control"),
        "public, max-age=0, must-revalidate",
      );
    }
    assert.equal(
      (await (await site.fetch(req("/api/listening/now"), env)).json()).mode,
      "hidden",
    );
  } finally {
    close();
  }
});

test("expired access token refreshes through Spotify and stores a rotated refresh credential", async () => {
  const { env, db, close } = await fixture();
  const authorization = createListeningOwnerApi({
    clock: () => now,
    fetcher: async () =>
      new Response(
        JSON.stringify({
          token_type: "Bearer",
          scope: "user-read-currently-playing",
          access_token: access,
          refresh_token: refresh,
          expires_in: 3600,
        }),
        { status: 200 },
      ),
  });
  try {
    await connect(authorization, env);
    env.LISTENING_PUBLIC_RELEASE_APPROVED = "true";
    const settings = req("/api/listening/admin/settings", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ publicEnabled: true, showDetails: false }),
    });
    assert.equal((await authorization(settings, env, ctx)).status, 200);
    await db
      .prepare("UPDATE listening_account SET access_expires=? WHERE id=1")
      .bind(now - 1000)
      .run();
    const rotated = "rotated_refresh_01234";
    let refreshed = 0;
    const read = createD1PresenceReader({
      clock: () => now,
      fetcher: async (url, options) => {
        if (url.includes("accounts.spotify.com")) {
          refreshed += 1;
          const body = new URLSearchParams(options.body);
          assert.equal(body.get("client_id"), clientId);
          assert.equal(body.get("refresh_token"), refresh);
          return new Response(
            JSON.stringify({
              token_type: "Bearer",
              access_token: "new_access_01234",
              refresh_token: rotated,
              expires_in: 3600,
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(track()), { status: 200 });
      },
    });
    const projected = await (await read(env)).json();
    assert.equal(projected.mode, "playing");
    assert.equal(projected.detailsVisible, false);
    assert.equal(Object.hasOwn(projected, "track"), false);
    assert.equal(refreshed, 1);
    const account = await db
      .prepare("SELECT * FROM listening_account WHERE id=1")
      .first();
    const key = await importEncryptionKey(env.LISTENING_TOKEN_KEY);
    assert.equal(await unseal(account.refresh_cipher, key, "refresh"), rotated);
    assert.equal(account.public_enabled, 1);
  } finally {
    close();
  }
});

test("Spotify rate limit holds public requests without disclosing an old song", async () => {
  const { env, db, close } = await fixture();
  const api = createListeningOwnerApi({
    clock: () => now,
    fetcher: async () =>
      new Response(
        JSON.stringify({
          token_type: "Bearer",
          scope: "user-read-currently-playing",
          access_token: access,
          refresh_token: refresh,
          expires_in: 3600,
        }),
        { status: 200 },
      ),
  });
  try {
    await connect(api, env);
    env.LISTENING_PUBLIC_RELEASE_APPROVED = "true";
    const setting = req("/api/listening/admin/settings", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ publicEnabled: true, showDetails: true }),
    });
    await api(setting, env, ctx);
    let requestCount = 0;
    const read = createD1PresenceReader({
      clock: () => now,
      fetcher: async () => {
        requestCount += 1;
        return new Response("", {
          status: 429,
          headers: { "Retry-After": "120" },
        });
      },
    });
    assert.equal((await (await read(env)).json()).mode, "unavailable");
    assert.equal((await (await read(env)).json()).mode, "unavailable");
    assert.equal(requestCount, 1);
    const account = await db
      .prepare("SELECT * FROM listening_account WHERE id=1")
      .first();
    assert.ok(account.blocked_until >= now + 120000);
    assert.equal(account.projection_json, null);
  } finally {
    close();
  }
});

async function connectedFixture() {
  const f = await fixture();
  const api = createListeningOwnerApi({
    clock: () => now,
    fetcher: async () =>
      Response.json({
        token_type: "Bearer",
        scope: "user-read-currently-playing",
        access_token: access,
        refresh_token: refresh,
        expires_in: 3600,
      }),
  });
  await connect(api, f.env);
  f.env.LISTENING_PUBLIC_RELEASE_APPROVED = "true";
  const settings = (enabled, details) =>
    api(
      req("/api/listening/admin/settings", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ publicEnabled: enabled, showDetails: details }),
      }),
      f.env,
      ctx,
    );
  assert.equal((await settings(true, true)).status, 200);
  await f.db
    .prepare("UPDATE listening_account SET access_expires=? WHERE id=1")
    .bind(now - 1000)
    .run();
  return { ...f, api, settings };
}
const rotatedResponse = () =>
  Response.json({
    token_type: "Bearer",
    access_token: "new_access_01234",
    refresh_token: "rotated_refresh_01234",
    expires_in: 3600,
  });
async function savedRefresh(f) {
  const row = await f.db
    .prepare("SELECT * FROM listening_account WHERE id=1")
    .first();
  return row.refresh_cipher
    ? unseal(
        row.refresh_cipher,
        await importEncryptionKey(f.env.LISTENING_TOKEN_KEY),
        "refresh",
      )
    : null;
}

test("rotated credentials survive a playback failure and are reused on the next refresh", async () => {
  const f = await connectedFixture();
  let time = now;
  let sentRefresh;
  try {
    const reader = createD1PresenceReader({
      clock: () => time,
      fetcher: async (url, options) => {
        if (url.includes("accounts.spotify.com")) return rotatedResponse();
        return new Response("", {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      },
    });
    assert.equal((await (await reader(f.env)).json()).mode, "unavailable");
    assert.equal(await savedRefresh(f), "rotated_refresh_01234");
    time += 61_000;
    await f.db
      .prepare("UPDATE listening_account SET access_expires=? WHERE id=1")
      .bind(now - 1000)
      .run();
    const later = createD1PresenceReader({
      clock: () => time,
      fetcher: async (url, options) => {
        if (url.includes("accounts.spotify.com")) {
          sentRefresh = new URLSearchParams(options.body).get("refresh_token");
          return rotatedResponse();
        }
        return Response.json(track());
      },
    });
    assert.equal((await (await later(f.env)).json()).mode, "playing");
    assert.equal(sentRefresh, "rotated_refresh_01234");
  } finally {
    f.close();
  }
});

test("visibility changes retain the refresh lease and rotated token but suppress the old projection", async () => {
  const f = await connectedFixture();
  let release, enter;
  let playbackCalls = 0;
  const started = new Promise((r) => {
    enter = r;
  });
  try {
    const reader = createD1PresenceReader({
      clock: () => now,
      fetcher: async (url) => {
        if (url.includes("accounts.spotify.com")) {
          enter();
          return new Promise((r) => {
            release = r;
          });
        }
        playbackCalls++;
        return Response.json(track());
      },
    });
    const pending = reader(f.env);
    await started;
    const before = await f.db
      .prepare("SELECT * FROM listening_account WHERE id=1")
      .first();
    await f.settings(false, false);
    const off = await f.db
      .prepare("SELECT * FROM listening_account WHERE id=1")
      .first();
    assert.equal(off.lease_id, before.lease_id);
    release(rotatedResponse());
    assert.equal((await (await pending).json()).mode, "hidden");
    assert.equal(await savedRefresh(f), "rotated_refresh_01234");
    assert.equal(playbackCalls, 0);
    const final = await f.db
      .prepare("SELECT * FROM listening_account WHERE id=1")
      .first();
    assert.equal(final.public_enabled, 0);
    assert.equal(final.projection_json, null);
    assert.equal(final.lease_id, null);
  } finally {
    f.close();
  }
});

test("late refresh cannot restore a disconnected account or overwrite a new connection", async () => {
  for (const reconnect of [false, true]) {
    const f = await connectedFixture();
    let release, enter;
    let playbackCalls = 0;
    const started = new Promise((r) => {
      enter = r;
    });
    try {
      const reader = createD1PresenceReader({
        clock: () => now,
        fetcher: async (url) => {
          if (url.includes("accounts.spotify.com")) {
            enter();
            return new Promise((r) => {
              release = r;
            });
          }
          playbackCalls++;
          return Response.json(track());
        },
      });
      const pending = reader(f.env);
      await started;
      await f.api(ownerPost("/api/listening/admin/disconnect"), f.env, ctx);
      if (reconnect) await connect(f.api, f.env);
      const expected = await savedRefresh(f);
      release(rotatedResponse());
      assert.equal((await (await pending).json()).mode, "hidden");
      assert.equal(await savedRefresh(f), expected);
      assert.equal(playbackCalls, 0);
    } finally {
      f.close();
    }
  }
});

test("owner detail changes do not allow a second refresh while the old probe owns the lease", async () => {
  const f = await connectedFixture();
  let release, enter;
  let tokenCalls = 0;
  const started = new Promise((r) => {
    enter = r;
  });
  try {
    const fetcher = async (url) => {
      if (url.includes("accounts.spotify.com")) {
        tokenCalls++;
        enter();
        return new Promise((r) => {
          release = r;
        });
      }
      return Response.json(track());
    };
    const pending = createD1PresenceReader({ clock: () => now, fetcher })(
      f.env,
    );
    await started;
    await f.settings(true, false);
    assert.equal(
      (
        await (
          await createD1PresenceReader({ clock: () => now, fetcher })(f.env)
        ).json()
      ).mode,
      "unavailable",
    );
    assert.equal(tokenCalls, 1);
    release(rotatedResponse());
    assert.equal((await (await pending).json()).mode, "hidden");
    assert.equal(await savedRefresh(f), "rotated_refresh_01234");
  } finally {
    f.close();
  }
});

test("cached projections reject extra fields and cannot bypass the owner track-detail preference", async () => {
  for (const privateDetails of [false, true]) {
    const f = await connectedFixture();
    try {
      if (privateDetails) await f.settings(true, false);
      const cached = {
        version: 1,
        mode: "playing",
        detailsVisible: privateDetails,
        updatedAt: new Date(now).toISOString(),
        ...(privateDetails
          ? {
              track: {
                title: "Old track",
                artist: "Old artist",
                album: "",
                image: null,
                url: "https://open.spotify.com/track/1234567890123456789012",
              },
            }
          : { filename: "patient.md", unapproved: "must-not-publish" }),
      };
      await f.db
        .prepare(
          "UPDATE listening_account SET projection_json=?,checked_at=? WHERE id=1",
        )
        .bind(JSON.stringify(cached), now)
        .run();
      let calls = 0;
      const read = createD1PresenceReader({
        clock: () => now,
        fetcher: async (url) => {
          calls++;
          return url.includes("accounts.spotify.com")
            ? rotatedResponse()
            : Response.json(track());
        },
      });
      const result = await (await read(f.env)).json();
      assert.ok(calls > 0, "untrusted cache must not be reused");
      assert.doesNotMatch(
        JSON.stringify(result),
        /patient\.md|must-not-publish|Old track|unapproved/,
      );
      if (privateDetails) {
        assert.equal(result.detailsVisible, false);
        assert.equal(Object.hasOwn(result, "track"), false);
      }
    } finally {
      f.close();
    }
  }
});

test("disconnect and a newer authorization fence out an older in-flight OAuth callback", async () => {
  for (const reconnect of [false, true]) {
    const f = await fixture();
    let release, enter;
    let calls = 0;
    const started = new Promise((r) => {
      enter = r;
    });
    const api = createListeningOwnerApi({
      clock: () => now,
      fetcher: async () => {
        calls++;
        if (calls === 1) {
          enter();
          return new Promise((r) => {
            release = r;
          });
        }
        return Response.json({
          token_type: "Bearer",
          scope: "user-read-currently-playing",
          access_token: access,
          refresh_token: refresh,
          expires_in: 3600,
        });
      },
    });
    try {
      const begin = await api(
        ownerPost("/api/listening/oauth/start"),
        f.env,
        ctx,
      );
      const { authorizeUrl } = await begin.json();
      const cookie = begin.headers.get("Set-Cookie").split(";")[0];
      const state = new URL(authorizeUrl).searchParams.get("state");
      const old = api(
        req(
          "/api/listening/oauth/callback?state=" +
            state +
            "&code=old-synthetic-code",
          { headers: { Cookie: cookie } },
        ),
        f.env,
        ctx,
      );
      await started;
      assert.equal(
        (await api(ownerPost("/api/listening/admin/disconnect"), f.env, ctx))
          .status,
        200,
      );
      if (reconnect) await connect(api, f.env);
      const expected = await savedRefresh(f);
      release(
        Response.json({
          token_type: "Bearer",
          scope: "user-read-currently-playing",
          access_token: "old_access_01234",
          refresh_token: "old_refresh_01234",
          expires_in: 3600,
        }),
      );
      const result = await old;
      assert.equal(
        result.headers.get("Location"),
        "/owner/listening/?error=expired",
      );
      assert.equal(await savedRefresh(f), expected);
      assert.equal(
        (
          await f.db
            .prepare("SELECT * FROM listening_account WHERE id=1")
            .first()
        ).public_enabled,
        0,
      );
    } finally {
      f.close();
    }
  }
});

test("a new owner authorization invalidates an older unconsumed attempt", async () => {
  const f = await fixture();
  let exchanges = 0;
  const api = createListeningOwnerApi({
    clock: () => now,
    fetcher: async () => {
      exchanges++;
      throw Error("old exchange must not run");
    },
  });
  try {
    const first = await api(
      ownerPost("/api/listening/oauth/start"),
      f.env,
      ctx,
    );
    const { authorizeUrl } = await first.json();
    const cookie = first.headers.get("Set-Cookie").split(";")[0];
    const state = new URL(authorizeUrl).searchParams.get("state");
    assert.equal(
      (await api(ownerPost("/api/listening/oauth/start"), f.env, ctx)).status,
      200,
    );
    const old = await api(
      req(
        "/api/listening/oauth/callback?state=" +
          state +
          "&code=old-synthetic-code",
        { headers: { Cookie: cookie } },
      ),
      f.env,
      ctx,
    );
    assert.equal(
      old.headers.get("Location"),
      "/owner/listening/?error=expired",
    );
    assert.equal(exchanges, 0);
    assert.equal(
      (
        await f.db
          .prepare("SELECT COUNT(*) AS count FROM listening_oauth_attempt")
          .first()
      ).count,
      1,
    );
  } finally {
    f.close();
  }
});

test("validated playback projections are reused across isolates without extra provider polling", async () => {
  for (const mode of ["playing", "off_air"]) {
    const f = await connectedFixture();
    let calls = 0;
    try {
      const fetcher = async (url) => {
        calls++;
        if (url.includes("accounts.spotify.com")) return rotatedResponse();
        return mode === "playing"
          ? Response.json(track())
          : new Response(null, { status: 204 });
      };
      const first = await (
        await createD1PresenceReader({ clock: () => now, fetcher })(f.env)
      ).json();
      assert.equal(first.mode, mode);
      assert.equal(calls, 2);
      const second = await (
        await createD1PresenceReader({ clock: () => now, fetcher })(f.env)
      ).json();
      assert.deepEqual(second, first);
      assert.equal(calls, 2);
    } finally {
      f.close();
    }
  }
});
