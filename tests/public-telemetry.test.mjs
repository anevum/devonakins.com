import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {gzipSync} from "node:zlib";
import {createHandler} from "../src/worker.mjs";
import {
  projectHistoricalGpt,
  projectPublicGithubEvents,
  unavailablePublicGithub,
  validPublicGithubSignal,
  githubCooldownMs,
} from "../src/public-telemetry.mjs";

const snapshot = JSON.parse(await readFile(
  new URL("../public/v2/usage-snapshot.json", import.meta.url), "utf8",
));
const date = new Date("2026-11-05T08:00:00.000Z");
const now = () => date;
const publicEvent = {
  type: "PushEvent",
  public: true,
  created_at: "2026-11-05T07:58:00Z",
  payload: {commits: [{message: "do not publish commit messages"}]},
  repo: {name: "devonalanakins/example-private-filename"},
  actor: {login: "do-not-publish"},
};
const publicAssets = {
  "/v2/usage-snapshot.json": {
    gzip: gzipSync(JSON.stringify(snapshot)).toString("base64"),
  },
};
const request = (site, method = "GET") =>
  site.fetch(new Request("https://devonakins.com/api/telemetry/public", {method}));

test("historical GPT projection cannot accidentally publish private profile content", () => {
  const projected = projectHistoricalGpt(snapshot);
  assert.deepEqual(Object.keys(projected).sort(),
    ["approximate", "asOf", "count", "freshness", "metric", "scope", "source"]);
  assert.equal(projected.asOf, "2026-11-04");
  assert.equal(projected.count, 2700000000);
  assert.equal(projected.freshness, "historical");
  for (const changed of [
    {...snapshot, count: "2700000000"},
    {...snapshot, attestation: "api-verified"},
    {...snapshot, asOf: "2026-11-31"},
  ]) assert.throws(() => projectHistoricalGpt(changed));
});

test("public activity reduces event payload to allowlisted kind and UTC time", () => {
  const result = projectPublicGithubEvents([
    {...publicEvent, type: "IssuesEvent", created_at: "2026-11-05T07:59:00Z"},
    {...publicEvent, public: false, created_at: "2026-11-05T07:59:00Z"},
    publicEvent,
  ], date);
  assert.equal(result.latestActivityKind, "push");
  assert.equal(result.latestActivityAt, "2026-11-05T07:58:00.000Z");
  assert.equal(result.status, "available");
  assert.doesNotMatch(JSON.stringify(result), /do-not-publish|example-private|commit messages|payload|actor/);
  assert.equal(result.checkedAt, date.toISOString());
  assert.equal(projectPublicGithubEvents([], date).status, "no-recent-public-development");
  assert.throws(() => projectPublicGithubEvents({events: []}, date));
});

test("same-origin telemetry endpoint caches a provider read while preserving sources", async () => {
  let providerCalls = 0;
  const site = createHandler(publicAssets, {version:"test"}, {
    now, cache: null,
    githubFetch: async (url, options) => {
      providerCalls++;
      assert.match(url, /^https:\/\/api\.github\.com\/users\/devonalanakins\/events\/public\?/);
      assert.equal(options.headers.Accept, "application/vnd.github+json");
      return new Response(JSON.stringify([publicEvent]), {
        headers: {"Content-Type": "application/json"},
      });
    },
  });
  const first = await request(site);
  assert.equal(first.status, 200);
  assert.match(first.headers.get("Content-Type"), /application\/json/);
  const result = await first.json();
  assert.equal(result.version, 1);
  assert.equal(result.gpt.count, snapshot.count);
  assert.equal(result.gpt.asOf, snapshot.asOf);
  assert.equal(result.gpt.freshness, "historical");
  assert.equal(result.development.freshness, "current");
  assert.equal(result.development.latestActivityKind, "push");
  assert.equal(result.development.source, "GitHub public events API");
  assert.equal(result.development.checkedAt, date.toISOString());
  assert.doesNotMatch(JSON.stringify(result), /skills|topPlugins|actor|commit messages|example-private/);
  assert.equal((await request(site)).status, 200);
  assert.equal(providerCalls, 1, "in-isolate cache prevents repeat fetch");
  assert.equal((await request(site, "HEAD")).status, 200);
  assert.equal(providerCalls, 1, "HEAD does not call provider");
  assert.equal((await request(site, "POST")).status, 405);
});

test("provider errors and malformed responses fail closed and never fabricate GPT usage", async () => {
  for (const response of [
    new Response("rate limited", {status: 403}),
    new Response('{"error":"invalid response"}'),
  ]) {
    const site = createHandler(publicAssets, {version:"test"}, {
      now, cache: null, githubFetch: async () => response.clone(),
    });
    const result = await (await request(site)).json();
    assert.deepEqual(result.development, unavailablePublicGithub(date));
    assert.equal(result.gpt.freshness, "historical");
    assert.equal(result.gpt.asOf, "2026-11-04");
    assert.doesNotMatch(JSON.stringify(result), /rate limited|invalid response/);
  }
});

test("cross-isolate edge cache reuses sanitized provider values", async () => {
  let remoteCalls = 0;
  let stored = null;
  const cache = {
    match: async () => stored?.clone() ?? null,
    put: async (_key, response) => {stored = response.clone();},
  };
  const options = {
    now, cache,
    githubFetch: async () => {
      remoteCalls++;
      return new Response(JSON.stringify([publicEvent]));
    },
  };
  const first = createHandler(publicAssets, {version:"test"}, options);
  await request(first);
  const second = createHandler(publicAssets, {version:"test"}, options);
  const result = await (await request(second)).json();
  assert.equal(remoteCalls, 1);
  assert.equal(result.development.latestActivityKind, "push");
});

test("integrated Worker keeps Spotify private and owner routes protected while serving public telemetry", async () => {
  const site = createHandler(publicAssets, {version:"test"}, {
    now,
    cache: null,
    githubFetch: async () => new Response(JSON.stringify([publicEvent])),
  });
  const [telemetry, listening, owner] = await Promise.all([
    request(site),
    site.fetch(new Request("https://devonakins.com/api/listening/now")),
    site.fetch(new Request("https://devonakins.com/api/listening/admin/status")),
  ]);
  assert.equal(telemetry.status, 200);
  assert.equal((await telemetry.json()).gpt.freshness, "historical");
  assert.equal(listening.status, 200);
  assert.equal(listening.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.deepEqual(await listening.json(),
    {version:1, mode:"hidden", detailsVisible:false},
    "no credentials, bindings or owner opt-in means no broadcast");
  assert.equal(owner.status, 403,
    "new public telemetry must not weaken Spotify's owner authentication");
  const ownerText = await owner.text();
  assert.doesNotMatch(ownerText, /refresh_cipher|access_cipher|secret/);
});

test("packaged Cloudflare Worker resolves both telemetry and Listening modules", async () => {
  const [{createHandler: builtHandler}, {default: builtAssets}] = await Promise.all([
    import("../.release/handler.mjs"),
    import("../.release/assets.mjs"),
  ]);
  assert.ok(builtAssets["/v2/usage-snapshot.json"], "historical bundled source is present");
  const builtSite = builtHandler(builtAssets, {version: "test"}, {
    now, cache: null,
    githubFetch: async () => new Response(JSON.stringify([publicEvent])),
  });
  const t = await builtSite.fetch(new Request("https://devonakins.com/api/telemetry/public"));
  assert.equal(t.status, 200);
  assert.equal((await t.json()).gpt.asOf, "2026-11-04");
  const listening = await builtSite.fetch(new Request("https://devonakins.com/api/listening/now"));
  assert.deepEqual(await listening.json(), {version:1, mode:"hidden", detailsVisible:false});
});

test("taller mobile Observatory exposes sanitized public activity without replacing GPT statistics", async () => {
  const html = await readFile(new URL("../v2/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/v2/terminal.css", import.meta.url), "utf8");
  const client = await readFile(new URL("../src/terminal.ts", import.meta.url), "utf8");
  assert.match(html, /id="mobile-development-activity" role="status" aria-live="polite"/);
  assert.match(html, /id="usage-value"/, "retain independent GPT count");
  assert.match(css, /@media \(max-width: 960px\) and \(min-height: 761px\)/);
  assert.match(css, /\.readout-development \{[^}]*display: block/s);
  assert.match(client, /mobile\.textContent = brief/);
});

test("bounded GitHub cooldown honors Retry-After and rate limit reset without leaking headers", () => {
  const retry = new Response(null, {
    status: 429, headers: {"Retry-After": "1800"},
  });
  assert.equal(githubCooldownMs(retry, date), 30 * 60_000);
  const resetTime = Math.floor((date.getTime() + 45 * 60_000) / 1000);
  const reset = new Response(null, {
    status: 403, headers: {"X-RateLimit-Reset": String(resetTime)},
  });
  assert.equal(githubCooldownMs(reset, date), 45 * 60_000);
  const extreme = new Response(null, {
    status: 429, headers: {"Retry-After": "99999999"},
  });
  assert.equal(githubCooldownMs(extreme, date), 4 * 60 * 60_000);
  const noHeaders = new Response(null, {status: 403});
  assert.equal(githubCooldownMs(noHeaders, date, 1), 10 * 60_000);
  assert.equal(githubCooldownMs(noHeaders, date, 3), 40 * 60_000);
});

test("unavailable public source is negatively cached through provider cooldown", async () => {
  let clock = date.getTime();
  let remoteCalls = 0;
  let stored = null;
  const cache = {
    match: async () => stored?.clone() ?? null,
    put: async (_key, response) => { stored = response.clone(); },
  };
  const options = {
    now: () => new Date(clock), cache,
    githubFetch: async () => {
      remoteCalls++;
      return remoteCalls === 1
        ? new Response("too many requests", {status: 429, headers: {"Retry-After": "1800"}})
        : new Response(JSON.stringify([publicEvent]));
    },
  };
  const first = createHandler(publicAssets, {version: "test"}, options);
  const firstResult = await (await request(first)).json();
  assert.equal(firstResult.development.status, "unavailable");
  assert.equal(remoteCalls, 1);
  clock += 20 * 60_000;
  const laterIsolate = createHandler(publicAssets, {version: "test"}, options);
  const delayed = await (await request(laterIsolate)).json();
  assert.equal(delayed.development.status, "unavailable");
  assert.equal(remoteCalls, 1, "edge cache must share a limited provider cooldown");
  clock += 11 * 60_000;
  const afterReset = createHandler(publicAssets, {version: "test"}, options);
  const recovered = await (await request(afterReset)).json();
  assert.equal(recovered.development.status, "available");
  assert.equal(remoteCalls, 2);
  assert.doesNotMatch(JSON.stringify(recovered), /too many requests/i);
});

test("invalid cached values cannot inject extra fields or silently appear fresh", async () => {
  let calls = 0;
  const projected = projectPublicGithubEvents([publicEvent], date);
  assert.equal(validPublicGithubSignal(projected, date), true);
  assert.equal(validPublicGithubSignal({...projected, actor: {token: "leak"}}, date), false);
  assert.equal(validPublicGithubSignal({...projected, latestActivityKind: "unknown"}, date), false);
  assert.equal(validPublicGithubSignal({...projected, checkedAt: "tomorrow"}, date), false);
  const poison = new Response(JSON.stringify({
    version: 2,
    expiresAt: new Date(date.getTime() + 240_000).toISOString(),
    value: {...projected, repository: "private-repository-name"},
  }), {headers: {"Content-Type":"application/json"}});
  const site = createHandler(publicAssets, {version: "test"}, {
    now, cache: {match: async () => poison.clone(), put: async () => {}},
    githubFetch: async () => {
      calls++;
      return new Response(JSON.stringify([publicEvent]));
    },
  });
  const result = await (await request(site)).json();
  assert.equal(calls, 1, "invalid edge cache is rejected and provider consulted");
  assert.equal(result.development.status, "available");
  assert.doesNotMatch(JSON.stringify(result), /private-repository-name|repository/);
});

test("concurrent first requests deduplicate upstream provider calls", async () => {
  let calls = 0;
  const site = createHandler(publicAssets, {version: "test"}, {
    now, cache: null,
    githubFetch: async () => {
      calls++;
      await Promise.resolve();
      return new Response(JSON.stringify([publicEvent]));
    },
  });
  const responses = await Promise.all([request(site), request(site), request(site)]);
  const payloads = await Promise.all(responses.map(x => x.json()));
  assert.ok(payloads.every(x => x.development.status === "available"));
  assert.equal(calls, 1);
});
