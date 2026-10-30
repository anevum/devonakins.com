import { mkdir, writeFile } from "node:fs/promises";
import { pages, projects, notes } from "../src/content.mjs";
import { icon } from "../src/icons.mjs";
import { fallbackEnvironment } from "../src/identity.mjs";
import * as views from "../src/views.mjs";
const nav = [
  ["work", "Work"],
  ["source", "Open source"],
  ["about", "About"],
];
const all = [
  ...pages.map((p) => ({
    ...p,
    content: views[p.key === "notes" ? "notesPage" : p.key](),
  })),
  ...projects.map((p) => ({
    path: `/work/${p.slug}/`,
    key: "work",
    title: p.title + " — Devon Akins",
    description: p.summary,
    content: views.project(p),
  })),
  ...notes.map((n) => ({
    path: `/notes/${n.slug}/`,
    key: "notes",
    title: n.title + " — Devon Akins",
    description: n.excerpt,
    content: views.note(n),
  })),
  {
    path: "/404/",
    key: "404",
    title: "Page not found — Devon Akins",
    description: "That page is not here.",
    content: views.notFound(),
  },
];
for (const p of all) {
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#090e16"><meta name="color-scheme" content="dark"><title>${p.title}</title><meta name="description" content="${p.description}"><link rel="canonical" href="https://devonakins.com${p.path}"><meta property="og:type" content="website"><meta property="og:site_name" content="Devon Akins"><meta property="og:title" content="${p.title}"><meta property="og:description" content="${p.description}"><meta property="og:url" content="https://devonakins.com${p.path}"><meta property="og:image" content="https://devonakins.com/social-card.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="https://devonakins.com/social-card.jpg"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/src/style.css">${p.key === "404" ? '<meta name="robots" content="noindex">' : ""}</head><body data-page="${p.key}"><a class="skip-link" href="#main">Skip to content</a><div class="ambient" aria-hidden="true"><div class="ambient-stars"></div><div class="ambient-horizon"></div></div>${p.key === "home" ? '<div id="scene" class="scene" aria-hidden="true">' + fallbackEnvironment() + "</div>" : ""}<header class="site-header wrap"><a class="brand" href="/" aria-label="Devon Akins home"><span class="brand-icon"><img src="/brand-mark-mono.svg" alt="" width="38" height="30"></span><span class="brand-name">DEVON AKINS<small>FATHER · WRITER · BUILDER</small></span></a><nav class="desktop-nav" aria-label="Main navigation">${nav.map(([k, l]) => `<a class="nav-link ${k === "lab" ? "nav-lab" : ""}" href="/${k}/" ${p.key === k ? 'aria-current="page"' : ""}>${icon(k)}${l}</a>`).join("")}</nav><div class="header-actions"><button class="jump-trigger" data-open-search aria-label="Jump to a page">${icon("search")}<span>Jump anywhere</span><kbd>⌘ K</kbd></button><button class="icon-button" data-open-settings aria-label="Appearance and motion settings">${icon("tune")}</button></div></header><main id="main" tabindex="-1">${p.content}</main><footer class="site-footer wrap"><div><a href="/" class="footer-name">DEVON AKINS</a><p>Father, writer, and software builder.</p></div><div class="footer-links"><a href="/contact/">Contact</a><a href="https://github.com/anevum">GitHub ${icon("external")}</a><a href="/source/">Open source</a><button data-open-settings>Appearance ${icon("tune")}</button></div><div class="footer-bottom"><span>WRITING · BUILDING · FAMILY</span><span>© ${new Date().getUTCFullYear()} Devon Akins</span></div></footer><nav class="mobile-nav" aria-label="Mobile navigation">${[
    ["home", "Home"],
    ["work", "Work"],
    ["source", "Source"],
    ["about", "About"],
    ["contact", "Contact"],
  ]
    .map(
      ([k, l]) =>
        `<a href="${k === "home" ? "/" : "/" + k + "/"}" ${p.key === k ? 'aria-current="page"' : ""}>${icon(k)}<span>${l}</span></a>`,
    )
    .join(
      "",
    )}<button data-open-search aria-label="More pages">${icon("menu")}<span>More</span></button></nav><dialog id="search-dialog" aria-labelledby="search-title"><div class="dialog-top"><h2 id="search-title">Where to?</h2><button class="icon-button" data-close-dialog aria-label="Close page search">${icon("close")}</button></div><label class="search-field">${icon("search")}<input id="search-input" placeholder="Find a page or project…" type="search" autocomplete="off" aria-label="Search pages and projects"></label><div id="search-results"></div><p class="dialog-foot">Arrows to move · Enter to open · Escape to close</p></dialog><dialog id="settings-dialog" aria-labelledby="settings-title"><div class="dialog-top"><h2 id="settings-title">Make yourself at home.</h2><button class="icon-button" data-close-dialog aria-label="Close appearance settings">${icon("close")}</button></div><p class="settings-label">ACCENT LIGHT</p><div class="theme-options" role="group" aria-label="Accent color"><button data-theme="tide" aria-pressed="true"><i></i>Tide</button><button data-theme="iris" aria-pressed="false"><i></i>Iris</button><button data-theme="ember" aria-pressed="false"><i></i>Ember</button></div><div class="setting-row"><div><label for="motion-setting">Ambient motion</label><p id="motion-description">Slow, continuous environmental animation.</p></div><input type="checkbox" role="switch" id="motion-setting" aria-describedby="motion-description" checked></div><div class="setting-row"><div><label for="quality-setting">Scene detail</label><p>Auto adapts to your screen and device.</p></div><select id="quality-setting"><option value="auto">Auto</option><option value="low">Low</option><option value="high">High</option></select></div><p class="settings-note">Preferences stay on this device. System reduced motion always takes priority.</p></dialog><div id="toast" role="status" aria-live="polite"></div><noscript><div class="noscript-note">All pages and project notes work without JavaScript. The animated environment needs JavaScript.</div></noscript><script type="module" src="/src/main.ts"></script></body></html>`;
  const dir = "." + p.path;
  await mkdir(dir, { recursive: true });
  await writeFile(dir + "index.html", html);
}
await writeFile(
  "public/sitemap.xml",
  '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    all
      .filter((p) => p.key !== "404")
      .map((p) => `<url><loc>https://devonakins.com${p.path}</loc></url>`)
      .join("") +
    "</urlset>",
);
console.log(`Generated ${all.length} complete HTML pages.`);
