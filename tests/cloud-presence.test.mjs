import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, lstat, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler } from "../src/worker.mjs";
import {
  createCloudPresenceApi,
  publicCloudPresence,
} from "../src/cloud-presence-api.mjs";
import {
  createPresenceOwnerApi,
  publicPresence,
} from "../src/presence-api.mjs";
import { reportCloud } from "../scripts/cloud-presence.mjs";

const START = Date.parse("2026-11-07T02:00:00.000Z");
const ctx = {
  access: {
    aud: "fixture",
    getIdentity: async () => ({ email: "owner@example.test" }),
  },
};
const endpoint = "/api/presence/owner?channel=cloud";
const hidden = async () => Response.json({ version: 1, mode: "hidden" });
function fixture() {
  const sql = new DatabaseSync(":memory:");
  for (const name of [
    "0002_presence.sql",
    "0003_presence_preferences.sql",
    "0004_editor_pairing.sql",
    "0006_cloud_presence.sql",
  ])
    sql.exec(
      readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
    );
  let at = START,
    hook = null;
  const db = {
    prepare(query) {
      const statement = sql.prepare(query);
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async first() {
          const result = statement.get(...values) || null;
          if (hook) await hook(query);
          return result;
        },
        async run() {
          return {
            meta: { changes: Number(statement.run(...values).changes) },
          };
        },
      };
    },
  };
  const env = {
    PRESENCE_ENABLED: "true",
    PRESENCE_PUBLIC_RELEASE_APPROVED: "false",
    LISTENING_DB: db,
    LISTENING_ACCESS_AUD: "fixture",
    LISTENING_OWNER_EMAIL: "owner@example.test",
  };
  const clock = () => at;
  const api = createCloudPresenceApi({ clock }),
    owner = createPresenceOwnerApi({ clock });
  const handler = createHandler(
    {},
    { version: "test" },
    { now: () => new Date(at) },
  );
  const req = (path, method = "GET", body, headers = {}) =>
    new Request("https://devonakins.com" + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const admin = (method = "GET", body) =>
    api(
      req(endpoint, method, body, { Origin: "https://devonakins.com" }),
      env,
      ctx,
    );
  const change = async (action, extra = {}) =>
    owner(
      req(
        "/api/presence/owner",
        "POST",
        {
          action,
          revision: sql.prepare("SELECT revision FROM presence_state").get()
            .revision,
          ...extra,
        },
        { Origin: "https://devonakins.com" },
      ),
      env,
      ctx,
    );
  async function pair(source = "codex") {
    const response = await admin("POST", { action: "pair", source });
    assert.equal(response.status, 200);
    const { pairCode } = await response.json();
    const claim = await api(
      req("/api/presence/cloud/claim", "POST", { pairCode }),
      env,
    );
    assert.equal(claim.status, 200);
    return { pairCode, ...(await claim.json()) };
  }
  const signal = (token, extra = {}) =>
    api(
      req(
        "/api/presence/cloud/signal",
        "POST",
        {
          version: 1,
          sequence: 1,
          state: "running",
          projectSlug: "mizvo",
          checkpoint: null,
          observedAt: new Date(at).toISOString(),
          ...extra,
        },
        { Authorization: "Bearer " + token },
      ),
      env,
    );
  const publicView = () => publicCloudPresence(env, clock);
  async function publish() {
    env.PRESENCE_PUBLIC_RELEASE_APPROVED = "true";
    assert.equal(
      (
        await change("settings", {
          enabled: true,
          privateWork: false,
          shareListening: false,
        })
      ).status,
      200,
    );
    const state = await (await admin()).json();
    assert.equal(
      (
        await admin("POST", {
          action: "settings",
          enabled: true,
          revision: state.revision,
        })
      ).status,
      200,
    );
  }
  return {
    sql,
    db,
    env,
    api,
    handler,
    req,
    admin,
    change,
    pair,
    signal,
    clock,
    publicView,
    publish,
    advance(ms = 21000) {
      at += ms;
    },
    hook(fn) {
      hook = fn;
    },
  };
}
test("cloud pairing requires Access identity and same-origin, grants no owner privileges, and is private by default", async () => {
  const f = fixture();
  for (const context of [
    {},
    { access: { ...ctx.access, aud: "other" } },
    {
      access: {
        ...ctx.access,
        getIdentity: async () => ({ email: "other@example.test" }),
      },
    },
  ])
    assert.equal((await f.api(f.req(endpoint), f.env, context)).status, 403);
  assert.equal(
    (
      await f.api(
        f.req(endpoint, "POST", { action: "pair", source: "codex" }),
        f.env,
        ctx,
      )
    ).status,
    403,
  );
  const { token } = await f.pair();
  assert.equal((await f.signal(token)).status, 200);
  assert.equal((await f.publicView()).visibility, "hidden");
  const state = await (await f.admin()).json();
  assert.equal(state.privatePreview.state, "running");
  assert.equal(state.paired, true);
  assert.equal(state.privatePreview.project, "Mizvo");
  assert.equal(state.enabled, false);
  assert.equal(
    (
      await f.admin("POST", {
        action: "settings",
        enabled: true,
        revision: state.revision,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.api(
        f.req(endpoint, "GET", null, { Authorization: "Bearer " + token }),
        f.env,
        {},
      )
    ).status,
    403,
  );
  assert.doesNotMatch(JSON.stringify(state), new RegExp(token));
});
test("pairing is one-use, expires, stores hashes, and concurrent claims have one winner", async () => {
  const f = fixture();
  const { token, pairCode } = await f.pair();
  const row = f.sql.prepare("SELECT * FROM presence_cloud").get();
  assert.notEqual(row.token_hash, token);
  assert.equal(row.pair_hash, null);
  assert.equal(
    (
      await f.api(
        f.req("/api/presence/cloud/claim", "POST", { pairCode }),
        f.env,
      )
    ).status,
    403,
  );
  const response = await f.admin("POST", {
    action: "pair",
    source: "chatgpt-work",
  });
  const code = (await response.json()).pairCode;
  const claims = await Promise.all(
    [1, 2].map(() =>
      f.api(
        f.req("/api/presence/cloud/claim", "POST", { pairCode: code }),
        f.env,
      ),
    ),
  );
  assert.deepEqual(claims.map((r) => r.status).sort(), [200, 403]);
  const expired = await f.admin("POST", { action: "pair", source: "codex" });
  const next = (await expired.json()).pairCode;
  f.advance(300000);
  assert.equal(
    (
      await f.api(
        f.req("/api/presence/cloud/claim", "POST", { pairCode: next }),
        f.env,
      )
    ).status,
    403,
  );
});
test("cloud task and human session stay independent; project and privacy preferences apply to both", async () => {
  const f = fixture();
  const { token } = await f.pair();
  await f.publish();
  assert.equal((await f.signal(token, { checkpoint: "testing" })).status, 200);
  assert.equal((await f.publicView()).state, "running");
  assert.equal((await publicPresence(f.env, hidden, f.clock)).state, "offline");
  f.advance();
  await f.change("start", { minutes: 15, projectSlug: "merit" });
  assert.equal((await publicPresence(f.env, hidden, f.clock)).project, "Merit");
  assert.equal((await f.publicView()).project, "Mizvo");
  f.advance();
  await f.change("projects", { projects: ["merit"] });
  assert.equal((await f.publicView()).project, null);
  assert.equal((await f.signal(token, { sequence: 2 })).status, 400);
  f.advance();
  await f.change("settings", {
    enabled: true,
    privateWork: true,
    shareListening: false,
  });
  assert.equal((await f.publicView()).visibility, "hidden");
  assert.equal(
    (await (await f.admin()).json()).privatePreview.state,
    "running",
  );
});
test("timestamps expire independently of receipt; waiting and completion never imply success evidence or human activity", async () => {
  const f = fixture();
  const { token } = await f.pair();
  await f.publish();
  assert.equal(
    (
      await f.signal(token, {
        observedAt: new Date(f.clock() - 110000).toISOString(),
      })
    ).status,
    200,
  );
  assert.equal(Date.parse((await f.publicView()).expiresAt), START + 10000);
  f.advance(10000);
  assert.equal((await f.publicView()).state, "unknown");
  assert.equal(
    (await f.signal(token, { sequence: 2, state: "waiting" })).status,
    200,
  );
  assert.equal((await f.publicView()).state, "waiting");
  assert.equal(
    (
      await f.signal(token, {
        sequence: 3,
        state: "completed",
        checkpoint: "tests-passed",
      })
    ).status,
    200,
  );
  assert.equal((await f.publicView()).checkpoint, "tests-passed");
  f.advance();
  assert.equal(
    (await f.signal(token, { sequence: 4 })).status,
    409,
    "a finished task cannot silently restart",
  );
  f.advance(120000);
  assert.equal((await f.publicView()).state, "unknown");
  assert.equal((await f.publicView()).project, null);
});
test("strict signals reject extra fields, private titles/paths, unknown projects, invalid times, stale sequence and cooldown", async () => {
  const f = fixture();
  const { token } = await f.pair();
  for (const extra of [
    { title: "private task" },
    { path: "/private/file" },
    { projectSlug: "clinical-client" },
    { sequence: 0 },
    { sequence: Infinity },
    { state: "idle" },
    { checkpoint: "deployed" },
    { observedAt: new Date(START - 120000).toISOString() },
    { observedAt: new Date(START + 10001).toISOString() },
    { observedAt: "2026-11-07" },
    { version: 2 },
  ])
    assert.equal(
      (await f.signal(token, extra)).status,
      400,
      JSON.stringify(extra),
    );
  assert.equal((await f.signal("x".repeat(43))).status, 401);
  assert.equal((await f.signal(token)).status, 200);
  assert.equal((await f.signal(token)).status, 409);
  assert.equal((await f.signal(token, { sequence: 2 })).status, 429);
  assert.equal(
    (await f.signal(token, { sequence: 2, state: "cancelled" })).status,
    200,
    "terminal events bypass cooldown",
  );
});
test("concurrent out-of-order events cannot overwrite a newer checkpoint", async () => {
  const f = fixture();
  const { token } = await f.pair();
  assert.equal((await f.signal(token)).status, 200);
  f.advance();
  const responses = await Promise.all([
    f.signal(token, { sequence: 3, checkpoint: "reviewing" }),
    f.signal(token, { sequence: 2, checkpoint: "testing" }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    f.sql.prepare("SELECT sequence FROM presence_cloud").get().sequence,
    3,
  );
});
test("master stop, disconnect and pairing rotation revoke tokens; re-enabling public sharing cannot resurrect old signals", async () => {
  const f = fixture();
  const { token } = await f.pair();
  await f.publish();
  await f.signal(token);
  assert.equal((await f.change("off")).status, 200);
  assert.equal(
    (await f.signal(token, { sequence: 2, state: "waiting" })).status,
    401,
  );
  f.advance();
  await f.change("settings", {
    enabled: true,
    privateWork: false,
    shareListening: false,
  });
  assert.equal((await f.publicView()).state, "no-signal");
  const paired = await f.pair();
  await f.signal(paired.token);
  assert.equal((await f.admin("DELETE")).status, 200);
  assert.equal(
    (await f.signal(paired.token, { sequence: 2, state: "waiting" })).status,
    401,
  );
  const rotated = await f.pair();
  await f.pair();
  assert.equal((await f.signal(rotated.token)).status, 401);
});
test("a delayed public read and an in-flight signal are fenced by master stop", async () => {
  const f = fixture();
  const { token } = await f.pair();
  await f.publish();
  await f.signal(token);
  let stopped = false;
  f.hook(async (query) => {
    if (!stopped && query === "SELECT * FROM presence_cloud WHERE id=1") {
      stopped = true;
      await f.change("off");
    }
  });
  assert.equal((await f.publicView()).visibility, "hidden");
  f.hook(null);
  const next = await f.pair();
  stopped = false;
  f.hook(async (query) => {
    if (!stopped && query === "SELECT * FROM presence_cloud WHERE id=1") {
      stopped = true;
      await f.change("off");
    }
  });
  assert.equal((await f.signal(next.token)).status, 409);
  assert.equal(
    f.sql.prepare("SELECT state FROM presence_cloud").get().state,
    null,
  );
});
test("Worker routes enforce auth, methods, hidden/no-store defaults, and gracefully handle unapplied migration", async () => {
  const f = fixture();
  assert.equal((await f.handler.fetch(f.req(endpoint), f.env)).status, 403);
  const result = await f.handler.fetch(f.req("/api/presence/cloud"), f.env);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).visibility, "hidden");
  assert.match(result.headers.get("Cache-Control"), /no-store/);
  assert.equal(
    (await f.handler.fetch(f.req("/api/presence/cloud", "POST", {}), f.env))
      .status,
    405,
  );
  assert.equal(
    await (
      await f.handler.fetch(f.req("/api/presence/cloud", "HEAD"), f.env)
    ).text(),
    "",
  );
  f.sql.exec("DROP TABLE presence_cloud");
  assert.equal((await f.admin()).status, 503);
  f.env.PRESENCE_PUBLIC_RELEASE_APPROVED = "true";
  assert.equal((await f.publicView()).visibility, "hidden");
  assert.equal(
    (await f.api(f.req(endpoint), { ...f.env, PRESENCE_ENABLED: "false" }, ctx))
      .status,
    404,
  );
});
test("additive migration preserves existing owner session and editor configuration", () => {
  const db = new DatabaseSync(":memory:");
  for (const name of [
    "0002_presence.sql",
    "0003_presence_preferences.sql",
    "0004_editor_pairing.sql",
  ])
    db.exec(
      readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
    );
  db.exec(
    "UPDATE presence_state SET session_source='owner-declared',session_at=42,session_until=99,editor_generation=7,editor_enabled=1",
  );
  const before = db.prepare("SELECT * FROM presence_state").get();
  db.exec(
    readFileSync(
      new URL("../migrations/0006_cloud_presence.sql", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(db.prepare("SELECT * FROM presence_state").get(), before);
  assert.equal(
    db.prepare("SELECT public_enabled FROM presence_cloud").get()
      .public_enabled,
    0,
  );
});
test("real reporter pairs, stores private credentials, reports ordered events, never returns tokens, and tolerates ambiguous delivery", async (t) => {
  const f = fixture();
  const dir = await mkdtemp(join(tmpdir(), "cloud-reporter-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "credential.json");
  const pair = await f.admin("POST", { action: "pair", source: "codex" });
  const { pairCode } = await pair.json();
  let networkFailure = false;
  const fetcher = async (url, options) => {
    assert.equal(new URL(url).origin, "https://devonakins.com");
    assert.equal(options.redirect, "error");
    const result = await f.handler.fetch(new Request(url, options), f.env);
    if (networkFailure) throw Error("synthetic network failure after write");
    return result;
  };
  const config = { file, clock: f.clock, fetcher };
  const paired = await reportCloud({ ...config, command: "pair", pairCode });
  assert.equal(paired.paired, true);
  assert.equal(Object.hasOwn(paired, "token"), false);
  assert.equal((await lstat(file)).mode & 0o077, 0);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.token.length, 43);
  assert.equal(
    (
      await reportCloud({
        ...config,
        command: "signal",
        state: "running",
        projectSlug: "mizvo",
      })
    ).accepted,
    true,
  );
  f.advance();
  networkFailure = true;
  await assert.rejects(
    reportCloud({ ...config, command: "signal", state: "waiting" }),
  );
  networkFailure = false;
  f.advance();
  assert.equal(
    (
      await reportCloud({
        ...config,
        command: "signal",
        state: "completed",
        checkpoint: "tests-passed",
      })
    ).accepted,
    true,
  );
  assert.equal(
    f.sql.prepare("SELECT sequence FROM presence_cloud").get().sequence,
    3,
  );
  await chmod(file, 0o644);
  await assert.rejects(
    reportCloud({ ...config, command: "signal", state: "running" }),
    /private regular file/,
  );
  await reportCloud({ ...config, command: "forget" });
  await assert.rejects(readFile(file));
});
