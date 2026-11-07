#!/usr/bin/env node
/**
 * Read-only, independent post-release checks for the public Worker.
 * This script sends no credentials or private metadata to the website.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { projects } from "../src/content.mjs";

const origin = (process.env.VERIFY_ORIGIN || "https://devonakins.com").replace(/\/+$/, "");
const expectedCommit = process.env.EXPECTED_COMMIT || process.env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/.test(expectedCommit || "")) {
  throw new Error("EXPECTED_COMMIT must be the exact deployed 40-character Git SHA");
}
// Bind verification to the release produced by this exact build, never an old
// hard-coded version number. A mismatched build must fail before HTTP probes.
const release = JSON.parse(await readFile(new URL("../.release/release.json", import.meta.url), "utf8"));
assert.match(release.version, /^\d+\.\d+\.\d+$/, "valid built version");
assert.equal(release.commit, expectedCommit, "release artifact must match intended commit");
const expectedVersion = release.version;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = (path, options = {}) =>
  fetch(origin + path, { signal: AbortSignal.timeout(15000), ...options });

let active;
for (let attempt = 1; attempt <= 10; attempt++) {
  try {
    const response = await request("/_health", { cache: "no-store" });
    assert.equal(response.status, 200, "health endpoint HTTP status");
    const data = await response.json();
    if (data.commit === expectedCommit && data.version === expectedVersion) {
      active = data;
      break;
    }
  } catch (err) {
    if (attempt === 10) throw err;
  }
  if (attempt < 10) await sleep(4000);
}
if (!active) throw new Error("Cloudflare has not served the expected exact-commit " + expectedVersion + " release");

const home = await request("/");
assert.equal(home.status, 200, "homepage");
assert.match(home.headers.get("content-type") || "", /text\/html/);
assert.match(home.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
assert.equal(home.headers.get("x-content-type-options"), "nosniff");
const markup = await home.text();
assert.match(markup, /rel="canonical" href="https:\/\/devonakins\.com\/"/);
assert.match(markup, /class="portrait-figure"/);
assert.match(markup, /id="interface-shell"/);
assert.doesNotMatch(markup, /V2 PREVIEW|name="robots" content="noindex/);
assert.match(markup, /id="usage-value"/, "compact GPT activity stream is present");
assert.match(markup, /href="\/gpt\/"/, "home stream links to detailed GPT profile");
assert.doesNotMatch(markup, /id="home-usage-value"|class="hero-usage"/, "no duplicate homepage metric");
assert.match(markup, /class="in-motion"/, "live activity feed");
assert.match(markup, /data-signal-work/, "current work in ribbon");
assert.match(markup, /data-signal-track/, "Spotify in ribbon");
assert.match(markup, /data-signal-gpt/, "scoped GPT data state");
assert.doesNotMatch(markup, /≈2\.7B|focus-grid/, "obsolete homepage headline/cards removed");
assert.doesNotMatch(markup, /ACTIVE ENGINEERING \/ OPEN SOURCE|LANGUAGE RESEARCH \/ PROPOSED/, "deprecated cramped copy removed");
assert.match(markup, /aria-label="View profile — full GPT activity and skills"/, "GPT stream has an accessible profile action");
for (const path of ["/work/merit/", "/work/rhen-language/"]) {
  assert.ok(markup.includes('href="' + path + '"'), path + " homepage feature link");
}

// V4 deployment must preserve private defaults; no account data is published by release.
const liveSignalResponse=await request('/api/activity/v4',{cache:'no-store'});
assert.equal(liveSignalResponse.status,200);
assert.match(liveSignalResponse.headers.get('cache-control')||'',/no-store/);
assert.match(liveSignalResponse.headers.get('cdn-cache-control')||'',/no-store/);
const liveSignal=await liveSignalResponse.json();
assert.equal(liveSignal.version,4);
assert.equal(liveSignal.work.visibility,'hidden');
assert.equal(liveSignal.spotify.mode,'hidden');
assert.equal(liveSignal.gpt.count,null);
assert.equal(liveSignal.gpt.state,'disconnected');
assert.deepEqual(liveSignal.remote.tasks,[]);
assert.deepEqual(liveSignal.recent,[]);

// Compare the public snapshot to the exact static artifact included in this
// build. This verifies both the content and the Worker JSON response type.
const expectedSnapshot = JSON.parse(await readFile(new URL("../dist/v2/usage-snapshot.json", import.meta.url), "utf8"));
assert.equal(expectedSnapshot.metric, "work-codex-tokens");
assert.equal(expectedSnapshot.approximate, true);
assert.equal(expectedSnapshot.attestation, "owner-published");
const snapshotResponse = await request("/v2/usage-snapshot.json", { cache: "no-store" });
assert.equal(snapshotResponse.status, 200, "public GPT activity snapshot");
assert.match(snapshotResponse.headers.get("content-type") || "", /application\/json/, "snapshot MIME");
assert.deepEqual(await snapshotResponse.json(), expectedSnapshot, "published snapshot must match tested build");

const telemetryResponse = await request("/api/telemetry/public", {cache: "no-store"});
assert.equal(telemetryResponse.status, 200, "live public telemetry endpoint");
assert.match(telemetryResponse.headers.get("content-type") || "",
  /application\/json/, "public telemetry JSON MIME");
const telemetry = await telemetryResponse.json();
assert.equal(telemetry.version, 1, "public telemetry schema version");
assert.equal(telemetry.gpt.metric, expectedSnapshot.metric, "GPT metric scope preserved");
assert.equal(telemetry.gpt.count, expectedSnapshot.count, "historical token count unchanged");
assert.equal(telemetry.gpt.asOf, expectedSnapshot.asOf, "historical capture date preserved");
assert.equal(telemetry.gpt.freshness, "historical", "no false claim of live ChatGPT data");
assert.equal(telemetry.development.source, "GitHub public events API");
assert.equal(telemetry.development.scope,
  "Up to eight qualifying events from the latest 30 public GitHub profile events; excludes private activity", "source sampling boundaries accurately described");
assert.ok(Array.isArray(telemetry.development.recentActivity) &&
  telemetry.development.recentActivity.length <= 8,
  "bounded public GitHub timeline required");
let previousGitHubTimestamp = Infinity;
for (const event of telemetry.development.recentActivity) {
  assert.deepEqual(Object.keys(event).sort(), ["at", "kind"],
    "only allowlisted timeline fields may be publicly exposed");
  assert.ok(["push", "pull request", "release"].includes(event.kind));
  const time = Date.parse(event.at);
  assert.ok(Number.isFinite(time) && new Date(time).toISOString() === event.at);
  assert.ok(time <= previousGitHubTimestamp, "public timeline must be in descending order");
  previousGitHubTimestamp = time;
}
assert.ok(["current", "unavailable"].includes(telemetry.development.freshness),
  "explicit data source freshness required even if GitHub is rate-limited");
assert.ok(Number.isFinite(Date.parse(telemetry.development.checkedAt)),
  "public GitHub source must include a checked-at timestamp");
if (telemetry.development.freshness === "unavailable") {
  assert.equal(telemetry.development.status, "unavailable");
  assert.ok(["rate-limited", "access-denied", "provider-error",
    "invalid-response", "timeout", "network-error"].includes(telemetry.development.failureReason));
  const retryAt = Date.parse(telemetry.development.retryAt);
  const checkedAt = Date.parse(telemetry.development.checkedAt);
  assert.ok(Number.isFinite(retryAt) && retryAt >= checkedAt &&
    retryAt <= checkedAt + 4 * 60 * 60_000);
  assert.equal(telemetry.development.latestActivityAt, null);
  assert.deepEqual(telemetry.development.recentActivity, []);
} else {
  assert.equal(telemetry.development.failureReason, null);
  assert.equal(telemetry.development.retryAt, null);
  assert.ok(["available", "no-recent-public-development"].includes(telemetry.development.status));
  if (telemetry.development.status === "available") {
    assert.ok(telemetry.development.recentActivity.length > 0);
    assert.equal(telemetry.development.latestActivityAt, telemetry.development.recentActivity[0].at);
    assert.equal(telemetry.development.latestActivityKind, telemetry.development.recentActivity[0].kind);
  } else {
    assert.deepEqual(telemetry.development.recentActivity, []);
  }
}
assert.doesNotMatch(JSON.stringify(telemetry),
  /refresh_cipher|access_token|client_secret|commit_message|repository_name/i,
  "telemetry public response cannot contain provider credentials or private event payloads");


for (const path of ["/v2/", "/gpt/", "/work/", "/about/", "/source/", "/contact/"]) {
  const response = await request(path);
  assert.equal(response.status, 200, path + " status");
  if (path === "/v2/") {
    assert.match(await response.text(), /name="robots" content="noindex,nofollow"/);
  }
  if (path === "/gpt/") {
    const profile = await response.text();
    assert.match(profile, /id="gpt-profile"/);
    assert.match(profile, /class="gpt-section gpt-live-panel"/,
      "public event timeline markup is deployed");
    assert.match(profile, /id="gpt-event-list"[^>]*role="list"/,
      "accessible public event list is deployed");
    assert.match(profile, /id="gpt-event-state"[^>]*role="status"/,
      "source status for public events is present");
    for (const eventFilter of ["all", "push", "pull request", "release"]) {
      assert.ok(profile.includes('data-gpt-event-filter="' + eventFilter + '"'),
        eventFilter + " public activity filter deployed");
    }
    assert.match(profile, /latest 30 public GitHub profile events/,
      "public GitHub sampling limitation shown");
    assert.match(profile, /not ChatGPT usage, private development/,
      "GitHub activity must not be mistaken for personal GPT usage");
    assert.match(profile, /314\.2M|314,200,000/, "peak tokens reflected in published profile");
    assert.match(profile, /Skills &amp; workflows|Skills & workflows/);
    assert.doesNotMatch(profile, /Showcase Sites|gpt-sites-heading|gpt-showcase-card/, "public profile must exclude Sites");
    assert.ok(profile.includes(new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(expectedSnapshot.profile.weeklyActivity.tokens)), "seven-day token total reflected in published profile");
    assert.match(profile, /This week in motion/, "dated weekly analytics panel is present");
    assert.match(profile, /Top plugins/);
  }
}
// Portfolio release-specific acceptance: public project pages must be live,
// indexable, canonically linked, and powered by the same immersive shell.
// These routes and research boundaries must survive an actual Worker deploy.
const portfolio = projects.map(({ slug, title }) => ["/work/" + slug + "/", title]);
assert.equal(new Set(portfolio.map(([path]) => path)).size, portfolio.length, "unique public project routes");
const archiveResponse = await request("/work/", { cache: "no-store" });
assert.equal(archiveResponse.status, 200, "work archive response");
const archiveMarkup = await archiveResponse.text();
for (const [path] of portfolio) {
  assert.ok(archiveMarkup.includes('href="' + path + '"'), path + " must appear in the public archive");
}
for (const [path, title] of portfolio) {
  const response = await request(path, { cache: "no-store" });
  assert.equal(response.status, 200, path + " production status");
  assert.match(response.headers.get("content-type") || "", /text\/html/, path + " HTML MIME");
  const page = await response.text();
  assert.ok(page.includes('rel="canonical" href="https://devonakins.com' + path + '"'),
    path + " canonical metadata");
  assert.match(page, /class="route-content"/, path + " immersive route content");
  assert.match(page, /data-route-page="true"/, path + " immersive route shell");
  const escapedTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\x27/g, "&#39;");
  assert.ok(page.includes('<h1 class="route-title">' + escapedTitle), path + " exact escaped H1 title");
  assert.doesNotMatch(page, /name="robots" content="noindex"/, path + " must be indexable");
  if (path === "/work/rhen-language/") {
    assert.match(page, /Local prototype/, "Rhen language prototype status");
    assert.match(page, /not a released compiler/, "Rhen non-release disclosure");
    assert.match(page, /github\.com\/devonalanakins\/rhen/, "Rhen repository remains a language project");
  }
  if (path === "/work/rhen/") {
    assert.match(page, /Vesper Legacy — Market Research/, "historical market title is preserved");
    assert.match(page, /github\.com\/devonalanakins\/vesper-legacy/, "historic market source has its own repository");
  }
  if (path === "/work/vesper/") {
    assert.match(page, /not a live brokerage service/, "Vesper research is explicitly not live");
    assert.match(page, /github\.com\/devonalanakins\/vesper/, "Vesper source repository");
  }
  if (path === "/work/mizvo/") {
    assert.match(page, /AGPL review build · not deployed/, "Mizvo is not a live service");
    assert.match(page, /github\.com\/devonalanakins\/mizvo/, "Mizvo source repository");
  }
}
// Every first-party identity served by the release must decode and use the
// correct Worker asset MIME, not only render in the offline preview.
for (const name of ["merit", "rhen", "vesper", "squelch", "brandicade", "anevum", "ideaflow-mark", "devonstation-mark", "mizvo"]) {
  const path = "/v2/identity/" + name + ".svg";
  const response = await request(path, { cache: "no-store" });
  assert.equal(response.status, 200, path + " identity asset");
  assert.match(response.headers.get("content-type") || "", /image\/svg\+xml/, path + " correct SVG MIME");
  assert.match(await response.text(), /<svg\b/, path + " actual vector content");
}
for (const [legacy, current] of [["aiei", "merit"], ["isl", "rhen-language"]]) {
  const response = await request("/work/" + legacy + "/?from=bookmark", { redirect: "manual" });
  assert.equal(response.status, 308, legacy + " historical bookmark");
  assert.equal(response.headers.get("location"), origin + "/work/" + current + "/?from=bookmark", legacy + " redirect");
}
const retiredProject = await request("/work/phatcake/?from=bookmark", { redirect: "manual" });
assert.equal(retiredProject.status, 308, "retired project URL redirects permanently");
assert.equal(retiredProject.headers.get("location"), origin + "/work/squelch/?from=bookmark", "legacy project redirect target");
const image = await request("/v2/crossed-arms.webp");
assert.equal(image.status, 200, "portrait asset");
assert.match(image.headers.get("content-type") || "", /image\/webp/);
const missing = await request("/missing-this-page/");
assert.equal(missing.status, 404, "genuine 404");

if (origin === "https://devonakins.com") {
  const www = await fetch("https://www.devonakins.com/", {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(www.status, 308, "canonical www redirect");
  assert.equal(www.headers.get("location"), "https://devonakins.com/");
}
if (telemetry.development.freshness === "unavailable") {
  // A syntactically valid endpoint can still be operationally degraded.
  // The reason and retry timestamp have already passed strict public-schema
  // validation above, and contain no raw upstream response or credentials.
  console.warn("::warning title=Public GitHub feed degraded::" +
    "Reason: " + telemetry.development.failureReason +
    "; retry eligible: " + telemetry.development.retryAt +
    ". The site is deployed, but the GitHub event feed is unavailable.");
}
console.log("Verified live release " + active.version + " at exact commit " + expectedCommit);
console.log("Passed: GPT profile, provenance-aware telemetry API, all " + portfolio.length + " canonical portfolio pages, 9 original identity assets, Rhen/Vesper/Mizvo boundaries, dated snapshot JSON, security headers, preview, image, 404 and www redirect");
