# DevonAkins.com — immersive interface V2 preview

Status: **isolated source preview**. This is not the production homepage. The existing
11-page public site and Cloudflare Worker remain in place. Preview route: \`/v2/\`.

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
selected state. Mobile navigation tabs retain a minimum 44px tall hit target
apart from the extreme short-landscape density adjustment. This is still not
a substitute for physical iPhone VoiceOver/Safari acceptance.
