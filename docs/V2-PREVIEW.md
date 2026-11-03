# DevonAkins.com — immersive interface V2 preview

Status: **the portrait interface is the canonical 1.1.1 homepage in release source**;
the independent `/v2/` route remains a noindex review preview. These Observatory
features are source-only until their integration PR is approved and deployed.
Previous project pages, accessible ambient motion controls, separated CSS and the guarded release process remain intact. The public Observatory is still a review-only source candidate, not deployed.

## Scope

- Five tabbed views: Home, Work, Writing, Research, Contact.
- Single-viewport shell on desktop; pane-local scrolling only when content
  requires it on narrow or short displays.
- Responsive horizontal navigation on phones and portrait tablets (960px and below); vertical navigation on wider screens.
- A compact small-height layout ensures the main hero actions are visible at 320×568 CSS pixels without scrolling at default text settings.
- Keyboard Arrow/Home/End navigation, visible focus, appropriate tab/tabpanel
  semantics, reduced-motion preference, skip link, and no-JavaScript escape.
- Crossed-arms cinematic portrait replaces the large DA hero centerpiece; only the small
  original DA identity in the header remains. The portrait is a local compressed WebP.
- CSS-only layered colored smoke, portrait halo and three-state lighting control
  replace the preview WebGL background; the legacy site's Three.js scene remains untouched.
- No external fonts, third-party trackers, credentials, analytics, or private
  integrations. This is a personal presentation, not an authenticated workspace.

## Public ChatGPT activity observatory (owner-reported snapshot)

The isolated V2 Observatory now displays an **approximately 2.6 billion lifetime
Work/Codex tokens** value, as reported by Devon from his ChatGPT profile on
November 2, 2026. This is **not** a measured live API total, a cumulative
count of ordinary ChatGPT chat messages, a follower count or a measure of
audience reach. It is intentionally marked approximate and dated.

The only source is the public, same-origin owner-published
`public/v2/usage-snapshot.json` asset. The V2 preview retrieves it once on
load and lets visitors explicitly refresh the file. It displays:

- the accessible **≈2.6B** result with the correct Work/Codex unit;
- a visible abbreviated observation date and **Not live** status on phones;
- the full date and source on larger displays.

The actual public snapshot schema is:

```json
{
  "version": 1,
  "metric": "work-codex-tokens",
  "count": 2600000000,
  "approximate": true,
  "asOf": "2026-11-02",
  "source": "Owner-reported ChatGPT profile",
  "attestation": "owner-published"
}
```

**Updating the number requires owner approval, a revised dated public JSON
asset and a new site deployment.** Merely clicking Refresh reloads the latest
published file; no counter increments between releases. The formatter
requires known keys, a safe nonnegative integer, an actual date and the
approximate marker. Missing/malformed/unavailable data restores an explicit
unavailable state instead of showing stale numbers.

No ChatGPT token, cookie, session identifier or account API is read from the
visitor or the owner's browser. The site does not scrape a logged-in account.
An official personal creator-profile stats API has not been verified and
must not be inferred from OpenAI's separate developer API usage data.
Future real social-platform public milestones need a separately sourced,
consented, privacy-reviewed publication pipeline. No social metrics are
fabricated in this increment.

## Public GitHub signal (proposed release addition)

The V2 Observatory now offers two explicitly identified and separate sources:

- **ChatGPT** — an approximate lifetime Work/Codex usage snapshot recorded
  November 2, 2026, published in a dated JSON file; not live.
- **GitHub** — an opt-in, periodically refreshed **public repository count**
  from the publicly documented GitHub REST `GET /users/devonalanakins` endpoint;
  not followers, commits, contributions, stars, private repositories,
  published products, or verified ownership of every repository.

Selecting GitHub causes the *website's own Worker* to request the exact fixed
`https://api.github.com/users/devonalanakins` public endpoint. No account token,
OAuth grant, visitor IP address or visitor request metadata is intentionally
sent from the browser to GitHub. Visitors only access the first-party
`GET /v2/github-profile.json` endpoint.

The Worker validates the returned username, account type and nonnegative
integer `public_repos`; only a narrow, explicitly whitelisted JSON envelope
is returned. The upstream profile's email, follower/following totals and
other fields are never forwarded. The connection has a 4.5-second timeout,
64-KiB response limit, single-flight request deduplication and a one-minute
failure cooldown. A successful result is cached in the warm Worker isolate
for up to an hour and opportunistically in Cloudflare's Cache API when
available. Different edge locations can refresh at different times. Browser
responses can be cached for five minutes. On errors, the Worker returns a
non-cacheable **503** with no fabricated zero or stale metric.

The Observatory identifies this as **cached GitHub public data**, exposes its
UTC observation time and links to the public GitHub profile. Source buttons
remain local to the existing portrait/smoke V2 interface and are keyboard-
and touch-operable. Unsupported values, future/stale timestamps and failure
responses are hidden behind an explicit unavailable state. The ChatGPT
snapshot still loads on site visit, and only selecting GitHub initiates a
GitHub data request. The site makes no outbound provider request from the
visitor's browser.

This is a source-only increment. No production Cloudflare Worker deployment,
paid service, new credential, analytics tracker, GitHub permission grant, or
change to other DevonStation/Cristy/Anevum projects is included. Actual
Cloudflare API reachability, its cache behavior under production traffic,
and physical iPhone acceptance require separate verification before release.

## Recent Public Code in the Work panel

The existing Work panel now contains an optional **Recent public code**
spotlight. It is a source-backed project link, not another invented
engagement metric. This uses the same first-party GitHub signal as the
Observatory when a visitor opens Work, rather than automatically exposing
any private development record.

The Worker makes an optional fixed, public, unauthenticated request to
`GET https://api.github.com/users/devonalanakins/repos?per_page=10&sort=pushed&type=owner`.
Only records for the `devonalanakins` owner that are public, original (not forks),
nonarchived and enabled are eligible. It selects at most one valid repo,
uses only its bounded name and normalized last-pushed timestamp, and constructs
the GitHub URL itself. Untrusted URLs, descriptions, HTML, scripts, email,
repository permissions, collaborators, private metadata and star counts are
never copied to the site.

The public signal schema is now version 2, with a nullable `recent` field
containing `{name,pushedAt,url}`. Both server and browser validate its
exact fields, canonical URL and timestamp. A missing, rejected or failed
optional repository request keeps the supported public repository **count**
available and displays a clear fallback in Work. The outer first-party
source remains hourly cached; each GitHub provider fetch is bounded and
rate-limit failures do not invent project updates.

`pushedAt` is explicitly labeled **Last pushed**, never a verified
release, public deploy, merged PR, or personal daily contribution count.
The link opens the canonical public repo in a new tab. The feature remains
source-only until the existing stacked PRs are reviewed and release
approval is granted. No additional credentials, paid tooling, deployment,
visitor tracking, or automatic changes to GitHub have been introduced.

## Build and tests

\`\`\`sh
npm ci
npm run build
npm test
\`\`\`

These must pass at the actual PR head. Follow up with a device/browser QA pass,
including 320×568, 375, 390, 560, 760/761, 768, 820, 912, 1024 and 1440 px viewports, iOS Safari safe
areas, keyboard panel switching, portrait visibility and contrast, reduced motion, lighting toggle, and tab focus.
The browser's WebGL result is environment-dependent. No production release or
reported Lighthouse metric is implied by green unit/CI tests.

## Release gate

This branch must not be merged or deployed without reviewing its PR, checking
CI, observing mobile/desktop visual rendering, and confirming the established
Cloudflare release path. The outdated open visual PR #4 should not be merged on
top of this design without reconciliation; its improvements are represented in
merged PR #5. Retain an identified rollback version before any actual cutover.

## Tablet/compact viewport acceptance

The preview header logo selects the preview Home panel (rather than silently navigating to the existing public site); Contact includes an explicit link back to the public website. Navigation switches to a horizontal bottom rail at 960px and below and keeps matching `aria-orientation`. The layout has viewport-safe-area padding and an enhanced-contrast fallback. At 320×568 CSS pixels, the hero title, description, and both primary actions fit without inner-panel scrolling at the default text size. Accessibility settings and larger type may require accessible pane-local scrolling instead of clipping. Physical iOS Safari still needs on-device verification.

## Very short viewports and browser zoom

The interface uses `100dvh` without a 390px minimum. At usable viewport
heights below 380px (for example, a phone in landscape with browser chrome),
the navigation rail and footer remain inside the viewport and active content
scrolls inside its panel. Headings, contact links, and cards reflow rather than
requiring horizontal scrolling within the panel. Large text may require
vertical scrolling; do not suppress it or shrink accessibility text globally.

Verification target: 568×300, 667×320, 844×320, 320×320, 320×568,
390×844, 761×900, and 1440×900 in an offline Chromium artifact. Test
tab switches and the panel's scrollability. WebKit/Safari is a distinct
unverified gate: the available local environment does not provide a WebKit
browser binary. This must not be presented as physical iPhone acceptance.

## Production rollback and cutover checklist

Do not publish from this draft automatically. Record the **observed active**
Cloudflare Worker deployment and 100%-active version in the private operations
checkpoint, along with the source commit matching that version; these may
change before cutover. On release day, re-query deployments and custom domains,
confirm no unrelated worker changes, note the currently active version as the
rollback candidate, and verify a prior version remains deployable. Prepare the
release only from an exact green PR head after visual, accessibility and owner
publication sign-off.

After an approved deployment, validate `/`, `/work/`, `/v2/`, `/_health`,
404, canonical `www` redirection, security response headers, and actual
portrait/media assets over HTTPS. If the live site breaks, restore the
**verified immediate prior active version** using the Cloudflare version
deployment controls (not a guessed or unrelated version) and recheck those
routes. Do not treat green CI, PR merge or a deploy request as proof of a
successful production release. Never put credentials or private deployment
inventory in the public repository.

## Navigation and mobile lighting parity

Section selections add same-document browser history so Back/Forward returns to
previous tabs; a direct `#work` link remains supported. Malformed URL fragments
and unrelated native anchors (such as `#main` for the skip link) do not throw
or hijack navigation. Both desktop and mobile lighting controls share the same
three-stage portrait palette, update their accessible labels, and announce the
selected state. Mobile navigation tabs retain a minimum 44px tall hit target (except the short-landscape rail at 44px due to its fixed display geometry). The mobile portrait-light control has a 44×44px tap target at all viewport widths, including landscape. This is still not
a substitute for physical iPhone VoiceOver/Safari acceptance.

## Automated compiled-preview browser acceptance

Draft PR verification installs pinned Python Playwright 1.57.0 and the Chromium and
WebKit browser engines on GitHub Actions, then runs
`python3 tests/browser_acceptance.py --axe --out browser-qa` against the
exact Vite-built `dist/` artifact. The suite exercises mobile, tablet,
landscape and desktop viewports, primary navigation, browser Back handling,
keyboard focus, panel overflow, portrait presence, reduced motion and the
44×44 mobile light target. It also runs axe-core 4.14 against WCAG 2.0/2.1/
2.2 A/AA tags and fails on automated violations. This gate runs on PRs, not
push builds, to avoid redundant browser downloads. Failing snapshots and the
browser QA report are attached to the CI run; no external service is visited
and no private data is collected.

CI serves the actual compiled `dist/` assets on a loopback-only HTTP origin
and blocks every other browser request. This exercises real browser navigation,
native Back/Forward history, static HTML, bundled scripts and media without
contacting production. The explicit `--offline-document` fallback supports
local sandboxes that block all loopback navigation; do not use that weaker
mode for CI WebKit history acceptance. These tests do not replace a hosted
production Worker/CSP check or physical iPhone VoiceOver/Safari acceptance.
A passing Linux WebKit run is evidence for that engine, not proof of
mobile Safari/device acceptance. Keep production unchanged pending approval.

## Accessible names and visible labels

The preview's header-home link inherits its accessible name from its visible
brand text, and the Motion toggle inherits its name from the displayed
MOTION ON / MOTION OFF / REDUCED MOTION state. Do not override those with
inconsistent `aria-label` values: axe-core's WCAG 2.5.3
`label-content-name-mismatch` rule must pass. The lighting controls have state-aware accessible names; the desktop name
explicitly begins with the visible SHIFT LIGHT label, while mobile uses a
full descriptive label for the otherwise unlabeled orb.
