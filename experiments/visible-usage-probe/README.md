# Visible Usage Probe (experimental, local only)

**Status: source-only feasibility experiment, not a ChatGPT analytics integration.**

This optional, open-source Chrome/Edge Manifest V3 extension samples **one
visible number** that the user explicitly selects from a signed-in ChatGPT
usage view every five seconds. It does not call OpenAI APIs, inspect hidden
endpoints, scrape conversations, use cookies, capture screens, or upload data.
It is intended for a Windows laptop browser; it cannot inspect the standalone
ChatGPT Desktop application or run on iPhone.

## Trial on a Windows laptop

1. Open Chrome or Edge Extensions and enable Developer mode.
2. Use **Load unpacked** and choose this directory.
3. Open the official ChatGPT usage view in the browser, if available to your
   plan/workspace. Do not assume the desktop-only Usage & billing page exists on
   the website.
4. Click the extension icon, choose exactly which metric the visible digits
   represent (credits used, credits remaining, or a percentage), then select
   **Select visible number**. Return to the usage page and click the digits.
5. Reopen the extension popup to see the numeric reading, observation time and
   last *numeric* change. Use **Copy local reading** to export the allowed JSON
   manually, or **Stop and clear** to end the session and remove stored data.

Selection targets only a numeric element, not an entire panel. If no numbers
are displayed on the web page, this experiment **cannot** obtain usage.
Press `Esc` to cancel selection. A hidden tab pauses recording; navigation,
closed tab or removed element makes the reading stale. Chromium may throttle
background timers, so five seconds is a target cadence, not guaranteed.

## Privacy and correctness guarantees

- Permissions: `activeTab`, `scripting`, and `storage` only; no broad host
  permissions, network destinations, tabs history, video or screen capture.
- The extension does nothing until clicked on a recognized ChatGPT hostname.
- Only one user-selected numeric element is inspected. Full text is neither
  saved nor copied. The output is limited to one metric, value, unit, source,
  scope, last observation time, and last numeric change time.
- Values are held in Chrome's **session** storage, not a public server or a
  persistent account store. No files are written automatically.
- A visible numeric change is **not proof** of OpenAI billing reconciliation;
  `sourceUpdatedAt` is deliberately `null`. ChatGPT Work/Codex credits must not
  be mixed with regular Chat or OpenAI API billing.
- The extension is **not** a background agent, a complete usage recorder, or
  a verified live pipeline to `devonakins.com`. It must not be relabeled as
  such until real source and public privacy/consent gates are verified.

## Testing

From the repository root: `node --test tests/visible-usage-probe.test.mjs`.
No API token, account session, external dependency, or production deployment
is needed. Real-account compatibility requires a separate manual test on a
user-open eligible Usage & billing view.

## Road to synchronization

Verify a genuine source increment, then design and review a private bridge
that transmits only explicitly authorized and allowlisted metrics to a secure
first-party storage/reader path. No cloud endpoint or background upload is
included in this experiment.

## Session revocation (v0.2 source hardening)

Each capture starts only after the trusted extension popup authorizes one browser tab with a random, session-scoped key. The background worker serializes writes, authorizations, and revocations. **Stop and clear** revokes the active session and clears ephemeral local storage before acknowledging completion; delayed messages from previous sessions or other tabs are rejected. This does not improve source access or provide cloud synchronization. Real signed-in Chrome/Edge source compatibility remains unverified.
