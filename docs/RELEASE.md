# Release 1.0.0

Session: `DEVONAKINS.BUILD.2026-10-29.001`.

## Scope

A dedicated personal website for Devon Akins, using the recovered V2 interface
and two approved cinematic identity references. The old design remains intact
in the recovery archive. Production changes are confined to the new
`devonakins-personal` Worker and `devonakins.com` / `www.devonakins.com`.

## Implemented

15 server-rendered HTML pages: Home, Work, Lab, Open Source, Notes, About,
Contact, four project overviews, three short notes, and a genuine 404.

Original extruded DA identity, procedural Three.js scene, desktop reflective
floor, orbital motion, terrain, spires, procedural cloud/planet shaders,
particles and adaptive detail. An original layered vector environment covers
WebGL failure. Custom SVG icons and project illustrations, searchable page
navigation, project filters, three accent themes, quiet motion, responsive safe
areas, contact/copy links, installable manifest and share metadata are included.

Lab instruments: wave superposition, a geometric orbital sketch, and a local
question generator. Model limitations are written next to the instruments.

## Verification

- TypeScript check and production build pass.
- 11 Node tests pass: superposition and periodicity, ellipse geometry, safe
  question selection, full HTML routes, canonical redirects, genuine 404s,
  method handling, ETags/HEAD/cache behavior, gzip negotiation, all local links,
  public-content privacy scan, and PNG/manifest consistency.
- Chromium UI checks passed for navigation, frequency changes, pause state,
  eccentricity changes, tab switching, question selection, page search,
  theme changes and quiet motion.
- Home responsive viewport checks at 320, 375, 390, 430, 768, 1024 and 1440 px
  found no document horizontal overflow. These are Chromium frame viewports,
  not physical iPhone/Safari acceptance.
- Home mobile axe-core scan: zero automated violations, 40 passes and two
  incomplete checks requiring judgment. Work mobile: zero automated violations,
  40 passes and one incomplete check after correcting its heading order. The
  project category filter was also verified in the 390 px viewport.

## Performance design

HTML is generated ahead of time, without a client-side rendering dependency.
The primary client bundle is about 8 KiB gzip and CSS about 12 KiB gzip.
The Home-only Three.js bundle is about 168 KiB gzip and is requested only after
useful content paints and WebGL 2 is available. Other pages never load it.
No external fonts, image hosts, analytics or runtime API calls are required.
High-resolution download artwork is not requested by the site interface.

No Lighthouse score or field Core Web Vitals is claimed. The preview browser
has WebGL disabled. Fallback behavior was observed; the actual WebGL environment
cannot be visually verified in that browser. Physical iPhone, touch/haptic
behavior and on-device GPU performance remain unverified. The site does not
promise unavailable iOS web haptics.

## Release boundary

No changes to ANEVUM, DevonStation, private Lab, Cristy's applications,
authentication policies, databases, recordings, billing plans or secrets.
No new domain or recurring service was purchased. Station remains reserved
in documentation only; no public DNS/application binding was created for it.

## Release 1.1.0 — portrait homepage cutover (deployment pending)

The previously tested crossed-arms portrait interface is generated as the
indexable canonical `/` homepage. The V2 source remains independently visible
at `/v2/` with `noindex,nofollow` for review. Existing `/work/`, `/about/`,
`/source/` and `/contact/` pages and project URLs remain unchanged. The
previous homepage source is retained in `src/views.mjs` for an emergency
source-level rollback, and Cloudflare retains the previously active Worker
version for rapid provider rollback.

The promotion is fail-closed: `src/portrait-home.mjs` transforms only expected
preview metadata and text; changes to that source must be deliberately reviewed
before a build can succeed. The build version is 1.1.0. The Node suite checks
canonical metadata, portrait media, preserved legacy pages and noindex preview;
PR-level Chromium and WebKit suites check root plus preview.

**Deployment is not automatic on merge.** Before describing this release as
LIVE, successfully upload the exact merged Worker build, verify Cloudflare's
active version and rollback candidate, and inspect public routes, canonical
redirects, security headers and portrait assets over HTTPS. The release must
not be marked live based on GitHub CI alone. No other domains or Workers are
touched by this release.

## Manual production deployment for 1.1.0

Only the verified main branch may be deployed. The dedicated workflow is
Actions > Deploy DevonAkins.com (manual). It requires an exact 40-character
commit input, builds from source, runs Node tests and publishes only the
existing devonakins-personal Worker. There is no automatic release on merge.

Before the first run, configure the production GitHub Actions environment and
two repository/environment secrets: CLOUDFLARE_API_TOKEN and
CLOUDFLARE_ACCOUNT_ID. Create a dedicated Cloudflare API token for this
personal site with the minimum Workers deployment and existing route
permissions required by Wrangler. Never reuse another project's build token,
and never commit the token or account ID to source.

Record the active production Worker version and source before each deployment.
If the release fails the post-deployment check, use the immediately preceding
Cloudflare version as rollback, then verify the public routes again. The
workflow's scripts/verify-live.mjs checks the exact deployed commit in
/_health, the canonical indexable portrait home, CSP, old project pages,
the noindex V2 preview, portrait asset, true 404, and www redirect.

Workflows are source preparation until a manually dispatched run reports
success and the intended live site is independently observed.


## V1.1.1 ambient motion refinement — source candidate

The original static-looking 24–35-second smoke gradients are replaced by
three moving, layered colored vapor volumes and independently folding wisps.
Translucent amber, cyan and violet drift is visible without adding video,
WebGL, third-party services or permanent browser loops. Small movement extends
to portrait halo/orbit, telemetry ring, status pulse and the entrance timing
of newly selected panels. Desktop fine-pointer movement adds a small
requestAnimationFrame-throttled portrait offset; touch does not incur it.

The homepage HTML begins with data-motion="off" to prevent animation before
the preference is read. In the absence of a site preference, motion follows
prefers-reduced-motion. The MOTION ON/OFF button allows an **explicit visitor
opt-in**, even if the device's Reduce Motion setting is enabled; motion OFF
suppresses animations and transitions for the whole interface. Only the
preference ("on" or "off") is stored locally and no telemetry is collected.

Cross-browser PR acceptance must verify that reduced-motion defaults off,
changing the simulated system preference updates the UI, deliberate opt-in
enables genuinely changing smoke transforms, an off toggle removes animations,
and site opt-in persists across reloads on the local test origin. Check the
actual iPhone Safari appearance/performance separately before production
release. This candidate is not live merely because code is committed.

## V1.1.2 — unified immersive navigation and deep links

Every public same-origin HTML route now uses the same crossed-arms portrait,
ambient smoke, five-section navigation, responsive design and motion controls
as the canonical homepage. The Work archive, all five published project
detail routes, About, Source, Contact and real 404 document retain their
existing public URLs, canonical metadata and essential content. The root and
the protected noindex /v2/ preview remain unchanged.

Public deep links are real pages, not redirects to the old site: they use a
single source generator (src/immersive-routes.mjs) and supplemental
/v2/routes.css; the old src/views.mjs templates remain in source history
but are no longer emitted as public pages. On deep pages a main navigation
tab returns to /#section instead of placing unrelated content behind a
misleading project URL. Direct links, canonical metadata, breadcrumb
navigation and detailed public project descriptions are preserved.

Release checks: all generated HTML pages must have the new shell, a single
nonlegacy stylesheet system, correct canonical route and functional internal
links. Chromium/WebKit browser acceptance visits all nine old destinations
on mobile and checks panel state, canonical navigation, reflow and selected
automated WCAG cases. Capture rollback version before release and verify live
Worker /_health, all URLs and assets afterward. No DNS or secrets changed.
