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
