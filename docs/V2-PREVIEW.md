# DevonAkins.com — immersive interface V2 preview

Status: **isolated source preview**. This is not the production homepage. The existing
15-page site and Cloudflare Worker remain in place. Preview route: \`/v2/\`.

## Scope

- Five tabbed views: Home, Work, Writing, Research, Contact.
- Single-viewport shell on desktop; pane-local scrolling only when content
  requires it on narrow or short displays.
- Responsive horizontal navigation on phones; vertical navigation on desktop.
- Keyboard Arrow/Home/End navigation, visible focus, appropriate tab/tabpanel
  semantics, reduced-motion preference, skip link, and no-JavaScript escape.
- Crossed-arms cinematic portrait replaces the large DA hero centerpiece; only the small
  original DA identity in the header remains. The portrait is a local compressed WebP.
- CSS-only layered colored smoke, portrait halo and three-state lighting control
  replace the preview WebGL background; the legacy site\u0027s Three.js scene remains untouched.
- No external fonts, third-party trackers, credentials, analytics, or private
  integrations. This is a personal presentation, not an authenticated workspace.

## Optional usage-snapshot contract

There is **no live ChatGPT usage API connection** and **no figure is shipped**.
The observatory begins with a dash and an honest unavailable status. On explicit
click, it attempts a same-origin, optional static publication at
\`/v2/usage-snapshot.json\`. A missing or malformed response is never displayed
as a valid metric.

Only after Devon authorizes publication of a sourced public figure, an editor
can add \`public/v2/usage-snapshot.json\` with this contract:

\`\`\`json
{
  "version": 1,
  "metric": "tokens",
  "count": 0,
  "asOf": "2026-11-02",
  "source": "Owner-maintained reporting record",
  "attestation": "owner-published"
}
\`\`\`

**This is a schema example, not a measurement.** \`count\` must be a
nonnegative safe integer, \`asOf\` a real YYYY-MM-DD date not in the future,
and \`source\` a short nonempty text (maximum 100 characters). User-supplied
numbers should be identified as estimates. The UI explicitly states that
the snapshot is not live tracking and makes no request until the button is
pressed. Do not place API keys, account IDs, exports, or private metadata in
the JSON or browser bundle. Do not scrape authenticated ChatGPT pages or use
undocumented account endpoints.

## Build and tests

\`\`\`sh
npm ci
npm run build
npm test
\`\`\`

These must pass at the actual PR head. Follow up with a device/browser QA pass,
including 320, 375, 390, 768, 1024, and 1440 px widths, iOS Safari safe
areas, keyboard panel switching, portrait visibility and contrast, reduced motion, lighting toggle, and tab focus.
The browser's WebGL result is environment-dependent. No production release or
reported Lighthouse metric is implied by green unit/CI tests.

## Release gate

This branch must not be merged or deployed without reviewing its PR, checking
CI, observing mobile/desktop visual rendering, and confirming the established
Cloudflare release path. The outdated open visual PR #4 should not be merged on
top of this design without reconciliation; its improvements are represented in
merged PR #5. Retain an identified rollback version before any actual cutover.
