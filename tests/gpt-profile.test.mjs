import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validatePublicGptSnapshot, renderPublicGptProfile } from "../src/gpt-profile.mjs";

const input = JSON.parse(await readFile("public/v2/usage-snapshot.json", "utf8"));
const clone = () => structuredClone(input);

test("dated owner-supplied snapshot validates without access to private ChatGPT data", () => {
  const s = validatePublicGptSnapshot(clone());
  assert.equal(s.count, 2600000000);
  assert.equal(s.profile.publicProfileUrl, "https://chatgpt.com/u/devonakins");
  assert.equal(s.profile.stats.chatMessages, null);
  assert.equal(s.profile.stats.currentStreakDays, 24, "historical current streak as of snapshot date");
  assert.deepEqual(s.profile.showcaseSites, []);
});

test("manual snapshot rejects invalid dates, forged metrics, credentials and unsafe links", () => {
  for (const mutate of [
    s => { s.asOf = "2026-02-30"; },
    s => { s.count = -1; },
    s => { s.attestation = "api-verified"; },
    s => { s.profile.stats.recordedStreakDays = "24"; },
    s => { s.profile.stats.peakDailyTokens = -100; },
    s => { s.profile.showcaseSites.push({name:"Bad", description:"Unsafe",url:"javascript:alert(1)"}); },
    s => { s.profile.showcaseSites.push({name:"Bad", description:"Unsafe",url:"https://name:password@example.com"}); },
    s => { s.profile.showcaseSites = Array.from({length:13},(_,i)=>({name:"Site "+i,description:"Test",url:"https://example.com/"+i})); },
    s => { s.profile.publicProfileUrl = "https://chatgpt.com/u/other"; },
  ]) {
    const s=clone(); mutate(s);
    assert.throws(() => validatePublicGptSnapshot(s));
  }
});

test("public renderer escapes all curated text, and never invents showcase or plugin entries", () => {
  const html = renderPublicGptProfile(clone());
  assert.match(html, /id="gpt-profile"/);
  assert.match(html, /314\.2M/);
  assert.match(html, /23h/);
  assert.match(html, /24 days/);
  assert.match(html, /CURRENT STREAK AT SNAPSHOT/);
  assert.match(html, /Activity graph/);
  assert.match(html, /Profile insights/);
  assert.match(html, /Showcase links are awaiting/);
  assert.match(html, /Top-plugin rankings have not been verified/);
  assert.doesNotMatch(html, /<script|private account credentials|current 24-day streak/i);
  const injected=clone();
  injected.profile.skills[0].name = "<img src=x onerror=alert(1)>";
  injected.profile.showcaseSites.push({name:"<script>alert(1)</script>",description:"Public title",url:"https://public.example.com/"});
  const safe=renderPublicGptProfile(injected);
  assert.doesNotMatch(safe, /<script>|<img src=x/);
  assert.match(safe, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(safe, /rel="noopener noreferrer"/);
});
