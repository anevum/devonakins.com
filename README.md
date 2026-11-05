<p align="center"><img src=".github/assets/readme-hero.svg" alt="Original DevonAkins.com project illustration" width="100%" /></p>

# Devon Akins — personal website

> **Public documentation note · November 4, 2026:** The source contains a public personal website and a manually maintained ChatGPT profile mirror. Screenshot-derived statistics are snapshots, not an authenticated live analytics feed. Deployment status must be verified against the actual Cloudflare Worker.

[Website](https://devonakins.com) · [Current reviews](https://github.com/devonalanakins/devonakins.com/pulls)

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

`npm run build` generates the canonical crossed-arms portrait homepage and the
existing project pages, checks TypeScript, and creates a self-contained
Cloudflare Worker in `.release/`. The former dimensional DA homepage remains
in source but is not loaded at `/`. The portrait navigation needs JavaScript;
without it, the Home page provides links to the server-rendered work and about
pages, which remain usable without JavaScript.

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
- `scripts/pages.mjs`: static page generation and canonical portrait promotion.
- `src/portrait-home.mjs`: guarded public homepage metadata transformation.
- `v2/index.html`: unchanged noindex preview source; root generated from it.
- `scripts/assets.mjs`: reproducible vector, icon and sharing asset generation.
- `scripts/build-worker.mjs`: self-contained release packaging.
- `tests/site.test.mjs`: routing, delivery, model, icon and privacy checks.

## Project names and source boundaries

The public portfolio now uses **Merit** (formerly AIEI) for the engineering-integrity toolkit at [devonalanakins/merit](https://github.com/devonalanakins/merit). The unchanged `aiei` CLI and evidence schemas remain compatibility identifiers during a separately reviewed migration.

**Rhen** now has its own new [programming-language repository](https://github.com/devonalanakins/rhen), with an experimental M0 compiler, JSON IR and JS/Python emitters in [draft PR #1](https://github.com/devonalanakins/rhen/pull/1). This is not a released language. The former trading RHEN source was renamed [Vesper Legacy](https://github.com/devonalanakins/vesper-legacy), while [Vesper](https://github.com/devonalanakins/vesper) is the independent clean rebuild. Portfolio routes are `/work/rhen-language/` for Rhen, `/work/vesper/` for the finance redesign and historical `/work/rhen/` for Vesper Legacy. Historical `/work/isl/` and `/work/aiei/` routes redirect to the current identities.

This site presents source development status, not proof that Rhen has been released as a compiler or that any financial project is live. No trading, financial, or release controls were changed for the identity update.

## Update content

Edit `src/content.mjs` and rebuild. Add a project only when its status,
public-safe description, links, and media rights are checked. Public summaries
of private projects must not contain access links or private screenshots.

The sample notes are new website copy, not exports of private correspondence.
Project illustrations are original symbolic diagrams, not screenshots of the
private applications. The reference concept images are not distributed.

## Manual GPT profile snapshot

The canonical, public owner-approved GPT profile snapshot is
`public/v2/usage-snapshot.json`. It supplies both the single compact
Work/Codex token signal in the homepage Observatory and the detailed
`/gpt/` page. **There is no authenticated ChatGPT integration.**

To update the mirror, review the visible ChatGPT profile in the correct
workspace (especially if a personal and a Business workspace differ), then
edit only values actually shown there. Set `asOf` to the date of that
capture. Do not interpolate token activity, infer a current streak from
historical data, or combine Work/Codex tokens with ChatGPT messages or
API billing. Unknown counts stay `null`. Curate `profile.skills` as public-safe descriptions of independently
authored workflows. The public GPT mirror excludes Showcase Sites and
lists only profile-captured integrations in `profile.topPlugins`.

Run `npm run build && npm test` and review the updated
`/gpt/` page and mobile homepage stream before merging. The existing
GitHub/Cloudflare pipeline releases merged changes. Do not put
screenshots containing private content, cookies, API credentials, or
nonpublic Sites into this repository. Automated daily syncing or
authenticated scraping is **not** enabled.

November 4, 2026: `profile.weeklyActivity` records seven-day token, message,
plugin-call and skill-use totals for October 29 through November 4.
`profile.profileInsights` and cumulative token activity are separate scopes.
The unchanged profile insight figures retain `profile.profileInsightsAsOf` of
November 3, 2026; the November 4 recording did not refresh those insights.
The public skills and plugin descriptions are retained from an earlier
owner-approved profile capture and are not presented as November 4 measurements.
The detailed `/gpt/` page excludes Showcase Sites entirely; the homepage
retains its single activity stream. Exact daily values are not inferred from
screen recordings. Each new capture requires a reviewed static file update.

## Identity assets

Original paths are shared between the SVG identity and the extruded Three.js
geometry. Public assets include monochrome and colored SVGs, square icons at
32/180/192/512/1024 px, a maskable icon, and 1200×630 JPG and 2400×1260 PNG
sharing artwork. Run `node scripts/assets.mjs` after changing identity paths.

## Motion and rendering

The portrait home supports amber, teal and violet lighting and quiet motion,
with system reduced motion taking priority. Older pages retain Tide, Iris and
Ember appearance controls with local preferences.
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

See `docs/RELEASE.md` for verification evidence, the 1.1.0 homepage cutover and
known limits. GitHub merge does not deploy this Worker automatically. For rollback,
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
Apache-2.0 license of their source repository (`devonalanakins/brandle`); see
[`scripts/security/LICENSE`](scripts/security/LICENSE).
Names and personal identity are not a grant of trademark rights or endorsement.
Three.js and its included addons: MIT. TypeScript, Vite, sharp, and axe-core are
build or verification dependencies under their respective open-source licenses;
`package-lock.json` records exact resolved versions. Do not replace a dependency's
own license or notices. See `THIRD_PARTY_NOTICES.md`.
