# Devon Akins — personal website

A personal workshop for ideas, systems, fictional worlds, and small experiments.
Production: https://devonakins.com

Session: `DEVONAKINS.BUILD.2026-10-29.001`.

## Run it

Requires Node.js 22.12+ and npm. All browser dependencies are bundled locally.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. In the managed development environment, use
`sites-preview start /absolute/path/to/checkout` instead of launching another server.

## Build and verify

```sh
npm run build
npm test
```

`npm run build` generates complete HTML for 15 pages, checks TypeScript,
bundles the client, and creates a self-contained Cloudflare Worker in `.release/`.
HTML content and navigation work with JavaScript disabled. Three.js is loaded
only on Home after useful content paints and a WebGL 2 context is available.

## Structure

- `src/content.mjs`: public project descriptions, note text, page metadata.
- `src/views.mjs`: semantic page templates and custom project illustrations.
- `src/identity.mjs`: original DA paths, dimensional vector fallback and scenery.
- `src/icons.mjs`: custom icon family informed by the recovered V2 prototype.
- `src/scene.ts`: procedural Three.js environment, extruded DA, orbital traces,
  terrain, architectural spires, particles, procedural sky, and adaptive effects.
- `src/lab.ts` / `src/lab-model.mjs`: instruments and their mathematical models.
- `src/main.ts`: search, filtering, theme, motion, copy controls and scene lifecycle.
- `src/style.css`: responsive layout and motion system.
- `src/worker.mjs`: canonical routing, asset delivery and security headers.
- `scripts/pages.mjs`: static page generation.
- `scripts/assets.mjs`: reproducible vector, icon and sharing asset generation.
- `scripts/build-worker.mjs`: self-contained release packaging.
- `tests/site.test.mjs`: routing, delivery, model, icon and privacy checks.

## Update content

Edit `src/content.mjs` and rebuild. Add a project only when its status,
public-safe description, links, and media rights are checked. Public summaries
of private projects must not contain access links or private screenshots.

The sample notes are new website copy, not exports of private correspondence.
Project illustrations are original symbolic diagrams, not screenshots of the
private applications. The reference concept images are not distributed.

## Identity assets

Original paths are shared between the SVG identity and the extruded Three.js
geometry. Public assets include monochrome and colored SVGs, square icons at
32/180/192/512/1024 px, a maskable icon, and 1200×630 JPG and 2400×1260 PNG
sharing artwork. Run `node scripts/assets.mjs` after changing identity paths.

## Motion and rendering

Appearance controls select Tide, Iris, or Ember and store preferences locally.
System reduced motion takes priority over the on-site switch. Hidden or
out-of-view WebGL scenes stop rendering. Phone/low-detail rendering lowers
pixel density, frame rate and effects. WebGL failure displays an original
layered SVG environment with restrained CSS motion; no WebGL library is
fetched when context creation fails. All meaningful content remains readable.

The Lab is a mathematical illustration. The orbital sketch has uniform
parameter speed and is not a Keplerian physical simulation. No input is sent
to an AI service or analytics provider. Clipboard features report failure if
the browser does not allow clipboard access.

## Deployment

Use the existing Cloudflare account, Worker `devonakins-personal`.
`wrangler.jsonc` documents the two custom domains. With an independently
configured least-privilege Cloudflare credential, a maintainer may use:

```sh
npx wrangler deploy
```

The build command is configured in `wrangler.jsonc`. Credentials belong in the
maintainer's environment, never this repository. No paid service, database,
email service, or runtime secret is needed. Hosting remains subject to the
account's actual Cloudflare Workers limits; this release does not change plans.

The deployment package embeds gzip asset representations in Worker modules
so the release can be uploaded atomically through the connected Cloudflare API.
Hashed assets cache for one year; HTML revalidates. Directories normalize to
trailing-slash URLs. `www` redirects to the canonical HTTPS apex. Unknown paths
return an actual 404. `/_health` exposes only the release identifier.

See `docs/RELEASE.md` for verification evidence and known limits. For rollback,
redeploy a prior Cloudflare version or rebuild the prior tagged source commit.
Keep the deployed version ID with the source commit in private release records.

## Boundaries

This site does not migrate or expose DevonStation. `station.devonakins.com`
remains unbound. ANEVUM and clinical/business applications are independent and
are not modified by this repository. No recordings, transcripts, patient or
family records, account details, infrastructure inventories, or credentials
belong in the public repository or deployed assets.

## License and dependencies

Site code and original vector assets: MIT, copyright Devon Akins.
The standalone Git-history scanner and its tests in `scripts/security/` retain the
Apache-2.0 license of their source repository (`anevum/brandle`); see
[`scripts/security/LICENSE`](scripts/security/LICENSE).
Names and personal identity are not a grant of trademark rights or endorsement.
Three.js and its included addons: MIT. TypeScript, Vite, sharp, and axe-core are
build or verification dependencies under their respective open-source licenses;
`package-lock.json` records exact resolved versions. Do not replace a dependency's
own license or notices. See `THIRD_PARTY_NOTICES.md`.
