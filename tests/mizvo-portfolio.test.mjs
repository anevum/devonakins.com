import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Mizvo is a distinct portfolio identity with accurate prelaunch status", async () => {
  const [archive, detail, homepage, sitemap, styles, svg] = await Promise.all([
    readFile("dist/work/index.html", "utf8"),
    readFile("dist/work/mizvo/index.html", "utf8"),
    readFile("dist/index.html", "utf8"),
    readFile("dist/sitemap.xml", "utf8"),
    readFile("dist/v2/routes.css", "utf8"),
    readFile("dist/v2/identity/mizvo.svg", "utf8"),
  ]);

  assert.match(archive, /class="route-project route-project-mizvo" data-identity="mizvo"/);
  assert.match(archive, /href="\/work\/mizvo\/"/);
  assert.match(archive, /src="\/v2\/identity\/mizvo\.svg" alt="Mizvo"/);
  assert.match(archive, /AGPL review build · not deployed/);
  assert.match(detail, /class="route-header route-header-with-brand"/);
  assert.match(detail, /src="\/v2\/identity\/mizvo\.svg" alt=""/);
  assert.match(detail, /class="route-title">Mizvo/);
  assert.match(detail, /https:\/\/github\.com\/devonalanakins\/mizvo/);
  assert.match(detail, /No collaborators are represented as employees/);
  assert.match(detail, /has not been deployed for real clients/);
  assert.match(detail, /AGPL-3\.0-only/);
  assert.match(sitemap, /https:\/\/devonakins\.com\/work\/mizvo\//);
  assert.match(styles, /\.route-project\.route-project-mizvo/);
  assert.match(styles, /prefers-reduced-motion: reduce/);

  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="570" height="112"/);
  assert.match(svg, /<title>Mizvo/);
  assert.ok((svg.match(/<path\b/g) || []).length >= 7);
  assert.doesNotMatch(svg, /<text\b|<image\b|<script\b|foreignObject|@import|href="https?:/i);
  // This change must not accidentally reintroduce the retired DJ brand or alter
  // the Merit/Rhen homepage focus.
  assert.doesNotMatch(homepage, /Phatcake/);
  assert.match(homepage, /href="\/work\/merit\/"/);
  assert.match(homepage, /href="\/work\/rhen-language\/"/);
  const historic = await readFile("dist/work/rhen/index.html", "utf8");
  assert.doesNotMatch(historic, /data-identity="rhen"/);
  assert.match(historic, /vesper-legacy/);
});


test("production verifier covers every published project and no stale finance title", async () => {
  const { projects } = await import("../src/content.mjs");
  const verifier = await readFile("scripts/verify-live.mjs", "utf8");
  assert.match(verifier, /import \{ projects \} from "\.\.\/src\/content\.mjs"/);
  assert.match(verifier, /projects\.map\(\(\{ slug, title \}\) =>/);
  assert.doesNotMatch(verifier, /RHEN — Market Research/);
  assert.match(verifier, /Vesper Legacy — Market Research/);
  assert.match(verifier, /AGPL review build · not deployed/);
  for (const project of projects) {
    const html = await readFile("dist/work/" + project.slug + "/index.html", "utf8");
    assert.ok(html.includes('class="route-title">' + project.title), project.slug + " title");
    assert.ok(html.includes('rel="canonical" href="https://devonakins.com/work/' + project.slug + '/"'),
      project.slug + " canonical route");
  }
  assert.ok(projects.some((project) => project.slug === "mizvo"));
  assert.ok(projects.some((project) => project.slug === "vesper"));
  assert.ok(projects.some((project) => project.slug === "rhen" && project.title.includes("Vesper Legacy")));
});
