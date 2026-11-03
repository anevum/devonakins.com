#!/usr/bin/env node
/**
 * Read-only, independent post-release checks for the public Worker.
 * This script sends no credentials or private metadata to the website.
 */
import assert from "node:assert/strict";

const origin = (process.env.VERIFY_ORIGIN || "https://devonakins.com").replace(/\/+$/, "");
const expectedCommit = process.env.EXPECTED_COMMIT || process.env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/.test(expectedCommit || "")) {
  throw new Error("EXPECTED_COMMIT must be the exact deployed 40-character Git SHA");
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = (path, options = {}) =>
  fetch(origin + path, { signal: AbortSignal.timeout(15000), ...options });

let active;
for (let attempt = 1; attempt <= 10; attempt++) {
  try {
    const response = await request("/_health", { cache: "no-store" });
    assert.equal(response.status, 200, "health endpoint HTTP status");
    const data = await response.json();
    if (data.commit === expectedCommit && data.version === "1.1.0") {
      active = data;
      break;
    }
  } catch (err) {
    if (attempt === 10) throw err;
  }
  if (attempt < 10) await sleep(4000);
}
if (!active) throw new Error("Cloudflare has not served the expected exact-commit 1.1.0 release");

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

for (const path of ["/v2/", "/work/", "/about/", "/source/", "/contact/"]) {
  const response = await request(path);
  assert.equal(response.status, 200, path + " status");
  if (path === "/v2/") {
    assert.match(await response.text(), /name="robots" content="noindex,nofollow"/);
  }
}
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
console.log("Verified live release " + active.version + " at exact commit " + expectedCommit);
console.log("Passed: canonical portrait, security headers, legacy pages, noindex preview, image, 404 and www redirect");
