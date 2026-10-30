import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHandler } from "../src/worker.mjs";
import assets from "../.release/assets.mjs";
const site = createHandler(assets, { version: "test", commit: "synthetic" });
const get = (path, options = {}) =>
  site.fetch(new Request("https://devonakins.com" + path, options));
test("all public pages have genuine server-rendered content and canonical metadata", async () => {
  for (const path of [
    "/",
    "/work/",
    "/source/",
    "/about/",
    "/contact/",
    "/work/writing/",
    "/work/ideaflow/",
    "/work/devonstation/",
    "/work/anevum/",
  ]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /<h1[ >]/);
    assert.match(
      html,
      new RegExp(
        "https://devonakins.com" + path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ),
    );
    assert.match(
      response.headers.get("Content-Security-Policy"),
      /frame-ancestors 'none'/,
    );
  }
});
test("removed demo content is not published", async () => {
  for (const path of ["/lab/", "/work/field-instruments/", "/notes/a-model-is-a-question/"]) assert.equal((await get(path)).status,404,path);
  for (const path of ["/", "/work/", "/about/"]) { const text = await (await get(path)).text(); assert.doesNotMatch(text,/FIELD INSTRUMENT|Wave interference|Question machine|Superposition/i); }
});
test("www and HTTP redirect to the canonical HTTPS origin without losing path or query", async () => {
  const r = await site.fetch(
    new Request("http://www.devonakins.com/work/?x=1"),
  );
  assert.equal(r.status, 308);
  assert.equal(r.headers.get("Location"), "https://devonakins.com/work/?x=1");
});
test("directory URLs normalize; unknown paths and hidden operational paths return real 404s", async () => {
  assert.equal((await get("/work")).status, 308);
  assert.equal(
    (await get("/work/index.html")).headers.get("Location"),
    "https://devonakins.com/work/",
  );
  for (const path of [
    "/missing/",
    "/.env",
    "/.git/config",
    "/station/",
    "/api/records",
  ])
    assert.equal((await get(path)).status, 404, path);
});
test("HEAD, immutable assets, ETags, and non-GET methods behave correctly", async () => {
  const head = await get("/", { method: "HEAD" });
  assert.equal(await head.text(), "");
  const first = await get("/");
  const revalidated = await get("/", {
    headers: { "If-None-Match": first.headers.get("ETag") },
  });
  assert.equal(revalidated.status, 304);
  const asset = Object.keys(assets).find((x) => x.startsWith("/assets/"));
  assert.match((await get(asset)).headers.get("Cache-Control"), /immutable/);
  assert.equal(
    (await get("/", { method: "POST", body: "not stored" })).status,
    405,
  );
});
test("gzip representation decompresses to identical HTML, including gzip q=0 negotiation", async () => {
  const plain = await get("/");
  const text = await plain.text();
  const gz = await get("/", { headers: { "Accept-Encoding": "br, gzip" } });
  assert.equal(gz.headers.get("Content-Encoding"), "gzip");
  const unzipped = await new Response(
    gz.body.pipeThrough(new DecompressionStream("gzip")),
  ).text();
  assert.equal(unzipped, text);
  const q0 = await get("/", { headers: { "Accept-Encoding": "gzip;q=0" } });
  assert.equal(q0.headers.get("Content-Encoding"), null);
  assert.equal(await q0.text(), text);
});
test("every same-site link and script in every generated page resolves", async () => {
  for (const [path, asset] of Object.entries(assets)) {
    if (!path.endsWith(".html")) continue;
    const html = await (
      await get(path === "/" ? path : path.replace(/index\.html$/, ""))
    ).text();
    for (const m of html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)) {
      const response = await get(m[1]);
      assert.ok(
        response.status === 200 || response.status === 308,
        `${path} → ${m[1]} (${response.status})`,
      );
    }
  }
});
test("public artifacts exclude private app destinations, credential patterns and approved reference images", async () => {
  for (const path of Object.keys(assets).filter((p) =>
    /\.(?:html|js|json|txt)$/.test(p),
  )) {
    const body = await (await get(path.replace(/index\.html$/, ""))).text();
    assert.doesNotMatch(
      body,
      /family-idea-[a-z0-9-]+\.devonakins\.workers\.dev|station\.devonakins\.com|cristybreathe\.devonakins\.workers\.dev|sk-[a-zA-Z0-9]{30,}|ghp_[a-zA-Z0-9]{20,}|BEGIN (?:RSA |EC )?PRIVATE KEY|8D29BF5F|00246725/,
    );
  }
});
test("manifest has correctly sized PNG assets and a single-origin scope", async () => {
  const m = JSON.parse(await (await get("/manifest.webmanifest")).text());
  assert.equal(m.scope, "/");
  assert.equal(m.start_url, "/");
  for (const i of m.icons) {
    const response = await get(i.src);
    assert.equal(response.status, 200);
    const png = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(png.buffer);
    const [w, h] = i.sizes.split("x").map(Number);
    assert.equal(dv.getUint32(16), w);
    assert.equal(dv.getUint32(20), h);
  }
});
