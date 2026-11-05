import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("project wordmarks are first-party, legible vector paths with text alternatives", async () => {
  const files = [
    ["merit.svg", "Merit"], ["rhen.svg", "Rhen"], ["squelch.svg", "Squelch"],
    ["devonstation-mark.svg", "DevonStation"], ["ideaflow-mark.svg", "IdeaFlow"],
  ];
  for (const [file, name] of files) {
    const svg = await readFile("dist/v2/identity/" + file, "utf8");
    assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /viewBox="0 0 \d+ 112"/);
    assert.ok(svg.includes("<title>" + name + " "), file + " needs identifying title");
    assert.ok((svg.match(/<(?:path|circle|polygon|polyline|rect)\b/g) || []).length >= 3, file + " needs original vector geometry");
    assert.doesNotMatch(svg, /<text\b|<image\b|href="https?:|@import/g,
      file + " may not depend on fonts or network imagery");
    assert.doesNotMatch(svg, /<script|onload\s*=|foreignObject/i);
  }

  const css = await readFile("dist/v2/project-identities.css", "utf8");
  assert.match(css, /object-fit:contain/);
  assert.match(css, /@media \(max-width:460px\)/);
  assert.match(css, /prefers-contrast:more/);
  for (const html of [
    await readFile("dist/index.html", "utf8"),
    await readFile("dist/v2/index.html", "utf8"),
  ]) {
    assert.match(html, /href="\/v2\/project-identities\.css\?v=1"/);
    for (const file of ["merit.svg", "rhen.svg", "squelch.svg", "devonstation-mark.svg", "ideaflow-mark.svg"]) {
      assert.ok(html.includes('src="/v2/identity/' + file + '"'), file + " missing from displayed Work");
    }
    for (const name of ["Merit", "Rhen", "Squelch"]) {
      assert.ok(html.includes('alt="' + name + '"'), name + " image must have an accessible alternative");
    }
    assert.doesNotMatch(html, /Phatcake|src="[^"]*phatcake/i);
    assert.equal((html.match(/src="\/v2\/identity\/merit\.svg"/g) || []).length, 2);
    assert.equal((html.match(/src="\/v2\/identity\/rhen\.svg"/g) || []).length, 2);
  }
});


test("public archive and detail routes use correct, independent visual identities", async () => {
  const archive = await readFile("dist/work/index.html", "utf8");
  const routesCss = await readFile("dist/v2/routes.css", "utf8");
  const wordmarks = [
    ["merit", "Merit", "merit.svg"],
    ["rhen-language", "Rhen", "rhen.svg"],
    ["squelch", "Squelch", "squelch.svg"],
    ["brandicade", "Brandicade", "brandicade.svg"],
    ["anevum", "Anevum", "anevum.svg"],
  ];
  for (const [slug, name, file] of wordmarks) {
    assert.ok(archive.includes('class="route-project route-project-' + slug + '" data-identity="' + slug + '"'), slug);
    assert.ok(archive.includes('src="/v2/identity/' + file + '" alt="' + name + '"'), name + " alternative");
    const detail = await readFile("dist/work/" + slug + "/index.html", "utf8");
    assert.ok(detail.includes('class="route-header route-header-with-brand"'), slug);
    assert.ok(detail.includes('src="/v2/identity/' + file + '" alt=""'), "decorative detail accent");
    assert.match(detail, /class="route-title"/);
  }
  for (const [slug, name, file] of [
    ["ideaflow", "IdeaFlow", "ideaflow-mark.svg"],
    ["devonstation", "DevonStation", "devonstation-mark.svg"],
  ]) {
    assert.ok(archive.includes('data-identity="' + slug + '"'), slug);
    assert.ok(archive.includes('src="/v2/identity/' + file + '" alt=""'));
    assert.ok(archive.includes("<span>" + name + "</span>"));
  }
  assert.match(archive, /class="route-project" href="\/work\/rhen\/"/);
  assert.doesNotMatch(archive, /data-identity="rhen"/);
  assert.match(routesCss, /\.route-project\[data-identity\]/);
  assert.match(routesCss, /prefers-reduced-motion: reduce/);
  assert.match(routesCss, /prefers-contrast: more/);
  for (const name of ["anevum","brandicade"]) {
    const svg = await readFile("dist/v2/identity/" + name + ".svg", "utf8");
    assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /<title>/);
    assert.ok((svg.match(/<path\b/g)||[]).length >= 6);
    assert.doesNotMatch(svg, /<text\b|<image\b|<script\b|foreignObject|@import/i);
  }
});
