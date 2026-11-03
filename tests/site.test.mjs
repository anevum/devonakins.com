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
test("public GitHub references use the current account", async () => {
  for (const path of ["src/immersive-routes.mjs", "src/views.mjs", "v2/index.html"]) {
    const source = await readFile(new URL("../" + path, import.meta.url), "utf8");
    assert.equal(source.includes("github.com/anevum"), false, path);
    assert.equal(source.includes("github.com/devonalanakins"), true, path);
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

test("V2 immersive preview is a noindex, accessible, internal-origin-only page", async () => {
  const response = await get("/v2/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /<nav class="rail" role="tablist"/);
  assert.match(html, /id="interface-shell"/);
  assert.match(html, /class="brand" href="#home"/);
  assert.doesNotMatch(html, /class="brand" href="#home" aria-label=/);
  assert.match(html, /Current public website/);
  assert.doesNotMatch(html, /href="\/assets\/[^"]+\.css"/, "portrait route must not include legacy global CSS");
  assert.match(html, /class="portrait-figure"/);
  assert.match(html, /alt="Cinematic portrait of Devon Akins with his arms crossed"/);
  assert.match(html, /id="shift-light"/);
  assert.match(html, /id="mobile-light" data-light-control/);
  assert.match(html, /id="shift-light" data-light-control/);
  assert.doesNotMatch(html, /id="scene"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /<main id="main"/);
  for (const view of ["home", "work", "writing", "research", "contact"]) {
    assert.match(html, new RegExp('id="tab-' + view + '"'));
    assert.match(html, new RegExp('id="panel-' + view + '"'));
  }
  assert.match(html, /No verified snapshot connected/);
  assert.doesNotMatch(html, /api\.openai\.com|sk-[a-zA-Z0-9]{20,}|chatgpt\.com\/api\//);
  assert.match(response.headers.get("Content-Security-Policy"), /connect-src 'self'/);

  const portrait = await get("/v2/crossed-arms.webp");
  assert.equal(portrait.status, 200);
  assert.equal(portrait.headers.get("Content-Type"), "image/webp");
  const portraitBytes = new Uint8Array(await portrait.arrayBuffer());
  assert.deepEqual([...portraitBytes.slice(0, 4)], [82, 73, 70, 70]);
  assert.equal(new TextDecoder().decode(portraitBytes.slice(8, 12)), "WEBP");
  assert.ok(portraitBytes.byteLength < 150000, "portrait must stay lightweight");
  const cssResponse = await get("/v2/terminal.css");
  assert.equal(cssResponse.status, 200);
  assert.match(cssResponse.headers.get("Content-Type"), /text\/css/);
  const v2css = await cssResponse.text();
  assert.match(v2css, /\.interface-shell/);
  assert.match(v2css, /@media\(max-width: 960px\)/);
  assert.match(v2css, /max-height: 640px/);
  assert.match(v2css, /safe-area-inset-top/);
  assert.match(v2css, /height: 100dvh; min-height: 0;/);
  assert.match(v2css, /@media \(max-height: 380px\)/);
  assert.match(v2css, /\.hero-panel h1, \.section-panel h2, \.contact-link/);
  assert.doesNotMatch(v2css, /min-height:\s*390px/);
  assert.match(v2css, /prefers-contrast: more/);
  assert.match(v2css, /@keyframes vapor-wander/);
  assert.match(v2css, /@keyframes smoke-fold/);
  assert.match(v2css, /@keyframes panel-arrive/);
  assert.match(v2css, /\.interface-shell\[data-motion="off"\] \*/);
  assert.doesNotMatch(v2css, /animation-duration: \.001ms !important/);
  assert.match(html, /data-view="home" data-motion="off" data-light="amber"/);
  assert.match(v2css, /\.mobile-light \{/);
  assert.match(v2css, /\.rail-tab \{ min-height: 44px; \}/);
  assert.match(v2css, /\.mobile-light \{ width: 44px; height: 44px; \}/);
  assert.match(v2css, /\.mobile-light \{ display: flex; width: 44px; height: 44px; \}/);
  assert.match(v2css, /\.hero-foot \{ max-width: 100%; flex-wrap: wrap;/);
  const client = await readFile("src/terminal.ts", "utf8");
  assert.match(client, /matchMedia\("\(max-width: 960px\)"\)/);
  assert.match(client, /history\.pushState\(null, "", "#" \+ name\)/);
  assert.match(client, /window\.addEventListener\("popstate", syncLocationView\)/);
  assert.match(client, /function viewFromLocation\(\)/);
  assert.match(client, /motionPreference === "on"/);
  assert.match(client, /requestAnimationFrame/);
  assert.match(client, /window\.addEventListener\("pointermove"/);
  assert.match(client, /syncMotion\(\)/);
  assert.doesNotMatch(client, /motionButton\.setAttribute\("aria-label"/);
  assert.match(client, /button\.id === "shift-light" \? "Shift light\. Current: "/);
  assert.match(client, /"Cycle portrait lighting\. Current: "/);
  const routeHtml = await (await get("/about/")).text();
  assert.match(routeHtml, /href="\/v2\/terminal\.css"/);
  assert.match(routeHtml, /href="\/v2\/routes\.css"/);
  assert.match(routeHtml, /data-route-page="true"/);
  assert.doesNotMatch(routeHtml, /href="\/assets\/[^"]+\.css"/,
    "no deep link may load the previous site stylesheet");
  const routesCss = await get("/v2/routes.css");
  assert.equal(routesCss.status, 200);
  assert.match(await routesCss.text(), /\.route-panel-inner/);
  assert.equal((await get("/v2")).status, 308);
});

test("canonical homepage publishes the portrait, not the noindex preview", async () => {
  const response = await get("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/devonakins\.com\/">/);
  assert.match(html, /Devon Alan Akins — Father, Author and Developer/);
  assert.match(html, /id="interface-shell"/);
  assert.match(html, /class="portrait-figure"/);
  assert.match(html, /\/v2\/crossed-arms\.webp/);
  assert.match(html, /href="\/v2\/terminal\.css"/);
  assert.match(html, /\/ ORIGINAL WORKS/);
  assert.doesNotMatch(html, /noindex|V2 PREVIEW|private-preview/i);
  assert.match(html, /<meta property="og:url" content="https:\/\/devonakins\.com\/">/);
  for (const path of ["/about/", "/work/", "/contact/", "/source/"])
    assert.equal((await get(path)).status, 200, path);
  const preview = await (await get("/v2/")).text();
  assert.match(preview, /name="robots" content="noindex,nofollow"/);
  assert.match(preview, /V2 PREVIEW/);
  assert.doesNotMatch(preview, /rel="canonical" href="https:\/\/devonakins\.com\/"/);
});

test("every canonical internal page uses the immersive portrait shell, never the old design", async () => {
  const deep = [
    "/work/", "/source/", "/about/", "/contact/",
    "/work/operations/", "/work/writing/", "/work/anevum/",
    "/work/ideaflow/", "/work/devonstation/", "/404/",
  ];
  const home = await (await get("/")).text();
  assert.match(home, /id="interface-shell"/);
  assert.doesNotMatch(home, /class="site-header wrap"/);
  for (const path of deep) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /id="interface-shell"/, path);
    assert.match(html, /data-route-page="true"/, path);
    assert.match(html, /class="portrait-figure"/, path);
    assert.match(html, /class="route-content"/, path);
    assert.match(html, /href="\/v2\/terminal\.css"/, path);
    assert.match(html, /href="\/v2\/routes\.css"/, path);
    assert.match(html, /class="rail" role="tablist"/, path);
    assert.match(html, /href="\/#home"/, path);
    assert.doesNotMatch(html, /class="site-header wrap"|class="desktop-nav"|data-open-search|data-open-settings|class="ambient-stars"|src\/style\.css/, path);
    assert.doesNotMatch(html, /href="\/assets\/[^"]+\.css"/, path);
    if (path !== "/404/") {
      assert.ok(html.includes('rel="canonical" href="https://devonakins.com' + path + '"'), path);
      assert.doesNotMatch(html, /name="robots" content="noindex"/, path);
    } else {
      assert.match(html, /name="robots" content="noindex"/);
    }
  }
  for (const [route, phrase] of [
    ["/work/", "DevonStation"],
    ["/work/operations/", "family businesses"],
    ["/work/writing/", "Books &amp; writing"],
    ["/work/anevum/", "ANEVUM"],
    ["/work/ideaflow/", "IdeaFlow"],
    ["/work/devonstation/", "DevonStation"],
    ["/about/", "father of two"],
    ["/source/", "PUBLIC REPOSITORIES"],
    ["/contact/", "devon@anevum.com"],
  ]) assert.match(await (await get(route)).text(), new RegExp(phrase, "i"), route);
  const v2 = await (await get("/v2/")).text();
  assert.match(v2, /name="robots" content="noindex,nofollow"/);
});
test("deep links cannot produce a misleading fragment URL for a different panel", async () => {
  const client = await readFile("src/terminal.ts", "utf8");
  assert.match(client, /const isRoutePage = interfaceShell\.dataset\.routePage === "true"/);
  assert.match(client, /location\.assign\("\/#" \+ name\)/);
  assert.match(client, /if \(isRoutePage\) return;/);
  const source = await readFile("src/immersive-routes.mjs", "utf8");
  assert.match(source, /data-initial-view=/);
  assert.match(source, /renderImmersiveRoute/);
});

test("rendered public source and contact routes contain only current GitHub identity", async () => {
  for (const route of ["/source/", "/contact/"]) {
    const response = await get(route);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.doesNotMatch(html, /https:\/\/github\.com\/anevum(?:\/|["?#])/i, route);
    assert.match(html, /https:\/\/github\.com\/devonalanakins/i, route);
  }
});


test("ChatGPT Work/Codex usage snapshot is dated, first-party and prominent on home", async () => {
  const html = await (await get("/")).text();
  assert.match(html, /class="hero-usage" role="group"/);
  assert.match(html, /class="hero-feature" role="group"/);
  assert.match(html, /<output class="hero-usage-value"/);
  assert.match(html, /id="home-usage-value"[^>]*>≈2\.6B</);
  assert.match(html, /AS OF 2026-11-02 · OWNER-REPORTED · NOT LIVE/);
  const response = await get("/v2/usage-snapshot.json");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /application\/json/);
  assert.deepEqual(await response.json(), {
    version: 1, metric: "work-codex-tokens", count: 2600000000,
    approximate: true, asOf: "2026-11-02",
    source: "Owner-reported ChatGPT profile", attestation: "owner-published",
  });
  const client = await readFile("src/terminal.ts", "utf8");
  assert.match(client, /void checkUsage\(\)/);
  assert.match(client, /record\.metric !== "work-codex-tokens"/);
  assert.match(client, /record\.approximate !== true/);
  assert.doesNotMatch(client, /backend-api\/wham|api\.openai\.com/);
});

test("current engineering showcase is prominently linked and status-qualified", async () => {
  const home = await (await get("/")).text();
  assert.match(home, /class="hero-feature" role="group" aria-label="Featured current projects"/);
  assert.match(home, /href="\/work\/aiei\/"/);
  assert.match(home, /href="\/work\/isl\/"/);
  assert.match(home, /ACTIVE ENGINEERING \/ OPEN SOURCE/);
  assert.match(home, /LANGUAGE RESEARCH \/ PROPOSED/);
  assert.doesNotMatch(home, /Development currently paused/);
  const archive = await (await get("/work/")).text();
  for (const slug of ["aiei", "isl", "phatcake", "brandicade", "rhen"]) {
    assert.match(archive, new RegExp('href="/work/' + slug + '/"'), slug);
    const response = await get("/work/" + slug + "/");
    assert.equal(response.status, 200, slug);
    const html = await response.text();
    assert.match(html, /class="route-content"/);
    assert.match(html, new RegExp("https://devonakins.com/work/" + slug + "/"));
  }
  const aiei = await (await get("/work/aiei/")).text();
  assert.match(aiei, /AIEI/);
  assert.match(aiei, /independent|human review|human release/i);
  assert.match(aiei, /https:\/\/github\.com\/devonalanakins\/aiei/);
  const isl = await (await get("/work/isl/")).text();
  assert.match(isl, /Intent Specification Language/);
  assert.match(isl, /Research concept/);
  assert.match(isl, /not been implemented or demonstrated/);
  assert.doesNotMatch(isl, /https:\/\/github\.com\/devonalanakins\/isl/);
  const source = await (await get("/source/")).text();
  assert.match(source, /AIEI — engineering integrity toolkit/);
  assert.match(source, /ISL — language research/);
  const css = await (await get("/v2/terminal.css")).text();
  assert.match(css, /\.hero-feature-link:focus-visible/);
  assert.match(css, /@media \(max-width: 360px\)/);
});
