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
    assert.ok((svg.match(/<path\b/g) || []).length >= 3, file + " needs original vector geometry");
    assert.doesNotMatch(svg, /<text\b|<image\b|https?:\/\//g,
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
