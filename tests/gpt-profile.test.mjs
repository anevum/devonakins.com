import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validatePublicGptSnapshot, renderPublicGptProfile } from "../src/gpt-profile.mjs";

const input = JSON.parse(await readFile(new URL("../public/v2/usage-snapshot.json", import.meta.url), "utf8"));
const clone = () => structuredClone(input);

test("one November 4 profile and seven-day analytics share a date but not a reporting scope", () => {
  const s = validatePublicGptSnapshot(clone());
  assert.equal(s.count, 2700000000);
  assert.equal(s.approximate, true);
  assert.equal(s.asOf, "2026-11-04");
  assert.equal(s.profile.stats.chatMessages, 325);
  assert.equal(s.profile.stats.weeklyTokens, 621712155);
  assert.deepEqual(s.profile.weeklyActivity, {
    startDate:"2026-10-29", endDate:"2026-11-04", days:7,
    tokens:621712155, messages:325, pluginCalls:299, skillUses:114,
  });
  assert.equal(s.profile.profileInsightsAsOf, "2026-11-03");
  assert.deepEqual(s.profile.profileInsights, {
    fastModePercent:2, mostUsedReasoning:"Light", skillsExplored:78, totalSkillUses:2152,
  });
  assert.equal(Object.hasOwn(s.profile, "showcaseSites"), false);
  assert.equal(Object.hasOwn(s.profile, "featuredSite"), false);
  assert.deepEqual(s.profile.skills.filter(x => x.featured).map(x => x.name), [
    "Fresh Chat Continuity", "Visual Briefing & Design Review",
    "Verified Software Delivery", "Rigorous Inquiry",
  ]);
  assert.deepEqual(s.profile.topPlugins.map(x => x.name), ["GitHub", "Notion", "Slack"]);
});

test("invalid snapshots, mismatched periods and forbidden Site fields cannot publish", () => {
  const cases = [
    s => { s.asOf = "2026-02-30"; },
    s => { s.count = -1; },
    s => { s.attestation = "api-verified"; },
    s => { s.profile.publicProfileUrl = "https://chatgpt.com/u/another"; },
    s => { s.profile.weeklyActivity.endDate = "2026-11-02"; },
    s => { s.profile.weeklyActivity.startDate = "2026-10-27"; },
    s => { s.profile.weeklyActivity.days = 8; },
    s => { s.profile.weeklyActivity.tokens = -5; },
    s => { s.profile.weeklyActivity.pluginCalls = "297"; },
    s => { s.profile.stats.weeklyTokens = 0; },
    s => { s.profile.stats.chatMessages = null; },
    s => { s.profile.profileInsights.fastModePercent = 102; },
    s => { s.profile.profileInsights.totalSkillUses = -1; },
    s => { s.profile.profileInsightsAsOf = "2026-11-05"; },
    s => { s.profile.profileInsightsAsOf = "2026-02-30"; },
    s => { s.profile.skills[0].featured = "yes"; },
    s => { s.profile.showcaseSites = []; },
    s => { s.profile.featuredSite = { name:"unapproved" }; },
  ];
  for (const mutate of cases) {
    const s=clone(); mutate(s);
    assert.throws(() => validatePublicGptSnapshot(s));
  }
});

test("shows true seven-day figures and profile insights, but no Site module or fake chart", () => {
  const html=renderPublicGptProfile(clone());
  for (const token of ["This week in motion", "621.7M", "325", "299", "114",
    "Oct 29 - Nov 4, 2026", "314.2M", "23h", "25 days", "78",
    "2,152", "2%", "Light", "GitHub", "Notion", "Slack",
    "Skills &amp; workflows", "Activity graph", "Profile insights",
    "previously captured featured skills", "Owner-curated integrations",
    "November 4, 2026; not live", "November 3, 2026"]) assert.ok(html.includes(token), token);
  assert.match(html, /datetime="2026-11-04"/);
  assert.match(html, /role="list" aria-label="Seven day analytics totals"/);
  assert.match(html, /data-featured="true"/);
  assert.doesNotMatch(html, /Showcase Sites|gpt-sites-heading|gpt-showcase-card|Anevum/);
  assert.doesNotMatch(html, /backend-api\/wham|2\.6B tokens this week|data-private/);
  assert.ok(!html.includes('id="home-usage-value"'));
});

test("renderer escapes all curated text and retains secure links", () => {
  const s=clone();
  s.profile.skills[0].name="<img src=x onerror=alert(1)>";
  s.profile.skills[1].description="<script>alert(1)</script>";
  s.profile.topPlugins[0].description="<b>test</b>";
  s.profile.profileInsights.mostUsedReasoning="<i>foo</i>";
  const html=renderPublicGptProfile(s);
  assert.doesNotMatch(html, /<script>|<img src=x|<b>test<\/b>|<i>foo<\/i>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("filtered public activity panel stays distinct from dated GPT profile", () => {
  const html = renderPublicGptProfile(clone());
  assert.match(html, /id="gpt-event-list"[^>]*role="list"/);
  assert.match(html, /data-gpt-event-filter="all" aria-pressed="true"/);
  assert.match(html, /data-gpt-event-filter="pull request" aria-pressed="false"/);
  assert.match(html, /id="gpt-event-state"[^>]*role="status"/);
  assert.ok(html.indexOf("gpt-public-development-heading") < html.indexOf("gpt-activity-heading"));
  assert.match(html, /not ChatGPT usage, private development/);
});
