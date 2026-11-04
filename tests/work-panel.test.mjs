import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("selected Work tab has accessible, status-qualified editorial cards and a complete archive link", async () => {
  const homepage = await readFile("dist/index.html", "utf8");
  const source = await readFile("dist/v2/index.html", "utf8");
  const css = await readFile("dist/v2/work-showcase.css", "utf8");
  const template = '<div class="work-cards" role="group" aria-label="Selected projects">';
  for (const html of [homepage, source]) {
    const start = html.indexOf(template);
    assert.ok(start >= 0, "Work group should have a semantic name");
    const end = html.indexOf('</div>', start);
    assert.ok(end > start);
    const section = html.slice(start, end);
    const hrefs = [...section.matchAll(/class="work-card [^"]+" href="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(hrefs, [
      "/work/aiei/", "/work/isl/", "/work/devonstation/",
      "/work/operations/", "/work/ideaflow/", "/work/squelch/"
    ]);
    assert.equal((section.match(/work-card-spotlight/g) || []).length, 2);
    assert.equal((section.match(/work-card-support/g) || []).length, 4);
    assert.match(section, /work-card-status">In development/);
    assert.match(section, /work-card-status">Research concept/);
    assert.doesNotMatch(section, /work-card[^>]*href="\/work\/phatcake\//);
    assert.match(html, /Complete project archive/);
    assert.match(html, /href="\/v2\/work-showcase\.css"/);
  }
  assert.match(css, /#panel-work \.work-card:focus-visible/);
  assert.match(css, /#panel-work \.work-card-spotlight/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  for (const slug of ["aiei", "isl", "devonstation", "operations", "ideaflow", "squelch"]) {
    assert.match(await readFile("dist/work/" + slug + "/index.html", "utf8"),
      new RegExp('rel="canonical" href="https://devonakins.com/work/' + slug + '/"'));
  }
});