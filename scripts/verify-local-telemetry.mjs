#!/usr/bin/env node
/**
 * Exercise the built Worker under local workerd, not an emulated handler.
 * The GitHub source may be unavailable, but the response must still preserve
 * truthfulness, privacy and the historical owner-captured GPT value.
 * No deployment, credentials, secret values or hosted resources are involved.
 */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const origin = "http://localhost:8787";
const snapshot = JSON.parse(await readFile(
  new URL("../public/v2/usage-snapshot.json", import.meta.url), "utf8",
));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = (path, options = {}) => fetch(origin + path, {
  signal: AbortSignal.timeout(12_000), redirect: "manual", ...options,
});

let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    const response = await read("/_health", {signal: AbortSignal.timeout(1_500)});
    if (response.ok) {
      const body = await response.json();
      assert.equal(body.site, "devonakins.com");
      ready = true;
      break;
    }
  } catch { /* Worker is still starting. */ }
  await delay(500);
}
assert.ok(ready, "local workerd did not serve the expected site");

const [result, historical, profile, head, denied] = await Promise.all([
  read("/api/telemetry/public"),
  read("/v2/usage-snapshot.json"),
  read("/gpt/"),
  read("/api/telemetry/public", {method: "HEAD"}),
  read("/api/telemetry/public", {method: "POST"}),
]);
assert.equal(result.status, 200, "real Worker public telemetry HTTP status");
assert.match(result.headers.get("content-type") || "", /application\/json/);
assert.equal(historical.status, 200, "static snapshot remains available");
assert.deepEqual(await historical.json(), snapshot, "historical GPT artifact unchanged");
assert.equal(profile.status, 200, "independent GPT profile HTML is available");
assert.match(await profile.text(), /id="gpt-profile"/);
assert.equal(head.status, 200, "HEAD accepted without provider work");
assert.equal((await head.text()).length, 0, "HEAD response has no body");
assert.equal(denied.status, 405, "write method denied");
assert.equal(denied.headers.get("allow"), "GET, HEAD");

const publicValue = await result.json();
assert.deepEqual(Object.keys(publicValue).sort(),
  ["development", "generatedAt", "gpt", "version"]);
assert.equal(publicValue.version, 1);
assert.deepEqual(Object.keys(publicValue.gpt).sort(),
  ["approximate", "asOf", "count", "freshness", "metric", "scope", "source"]);
assert.equal(publicValue.gpt.freshness, "historical");
assert.equal(publicValue.gpt.metric, snapshot.metric);
assert.equal(publicValue.gpt.asOf, snapshot.asOf);
assert.equal(publicValue.gpt.count, snapshot.count);
assert.equal(publicValue.gpt.approximate, true);
assert.deepEqual(Object.keys(publicValue.development).sort(),
  ["checkedAt", "freshness", "latestActivityAt", "latestActivityKind",
   "recentActivity", "scope", "source", "status"]);
assert.equal(publicValue.development.source, "GitHub public events API");
assert.equal(publicValue.development.scope, "Up to eight qualifying events from the latest 30 public GitHub profile events; excludes private activity");
assert.ok(Array.isArray(publicValue.development.recentActivity));
assert.ok(publicValue.development.recentActivity.length <= 8);
let lastEventTime = Infinity;
for (const entry of publicValue.development.recentActivity) {
  assert.deepEqual(Object.keys(entry).sort(), ["at", "kind"], "only allowlisted event fields");
  assert.ok(["push", "pull request", "release"].includes(entry.kind));
  const at = Date.parse(entry.at);
  assert.ok(Number.isFinite(at) && new Date(at).toISOString() === entry.at);
  assert.ok(at <= lastEventTime, "recent events must be newest-first");
  lastEventTime = at;
}
assert.ok(["current", "unavailable"].includes(publicValue.development.freshness));
const timestamp = Date.parse(publicValue.development.checkedAt);
assert.ok(Number.isFinite(timestamp));
assert.ok(Math.abs(Date.now() - timestamp) < 10 * 60_000,
  "provider check time must be recent");
if (publicValue.development.freshness === "unavailable") {
  assert.equal(publicValue.development.status, "unavailable");
  assert.equal(publicValue.development.latestActivityAt, null);
  assert.equal(publicValue.development.latestActivityKind, null);
  assert.deepEqual(publicValue.development.recentActivity, []);
} else {
  assert.ok(["available", "no-recent-public-development"]
    .includes(publicValue.development.status));
  if (publicValue.development.status === "available") {
    assert.ok(publicValue.development.recentActivity.length > 0);
    assert.equal(publicValue.development.latestActivityAt,
      publicValue.development.recentActivity[0].at);
    assert.equal(publicValue.development.latestActivityKind,
      publicValue.development.recentActivity[0].kind);
  } else {
    assert.deepEqual(publicValue.development.recentActivity, []);
  }
}
assert.doesNotMatch(JSON.stringify(publicValue),
  /access_token|refresh_token|api_key|password|repository_name|commits|actor|payload/i,
  "public Worker must not expose raw provider content or credentials");
console.log("Local workerd HTTP smoke: PASS; Github public source status:",
  publicValue.development.status, "; GPT snapshot remains historical.");
