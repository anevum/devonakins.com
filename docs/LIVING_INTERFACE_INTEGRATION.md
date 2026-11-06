# Living interface integration

The existing portrait, smoke, navigation, project identities, deep links, public
GitHub activity and historical GPT snapshot remain the foundation. The design
study does not replace the website.

## Implemented in this integration

- Mobile owner controls for expiring development sessions, manual statuses,
  reviewed custom wording, public-project choices and stopping all sharing.
- A compact presence dock and expanded Live Studio that distinguish declared
  sessions, editor activity and independent Spotify playback.
- Spotify account connection, playback display and explicitly selected public
  playlists owned by the connected account, with official attribution.
- An optional paused-by-default VS Code companion, packaged as an installable
  VSIX. It shares a selected public project and recent activity without reading
  document text, filenames or paths. See its
  [guide](../extensions/presence-vscode/README.md).
- A gated GPT observation bridge. A genuine eligible personal usage source has
  not been established; historical figures remain labeled historical.

## Verification

Local build/type checking and 120 Node tests pass. Tests include actual SQLite
operations, synthetic provider responses, authorization boundaries, expiry,
shutdown races, credential renewal, playlist ownership and editor privacy.
The companion packages with the official VSCE tool. Its automated runtime check
uses a simulated VS Code host; native desktop acceptance remains outstanding.

Chromium/WebKit acceptance covers mobile and desktop layout, keyboard use,
navigation, reduced motion, accessibility, private controls and delayed-request
shutdown behavior. Final exact-head CI results and artifacts are recorded on
[PR #44](https://github.com/devonalanakins/devonakins.com/pull/44).
Synthetic tests do not establish real-account or physical-device acceptance.

## Completion boundary

This is reviewable implementation source, not a claim of live integration.
Private runtime configuration, real Spotify consent, genuine GPT source
eligibility, editor pairing on the owner's computer, human mobile review and
release acceptance remain necessary. Public sharing stays off until accepted.
Private deployment details are maintained in the existing private project record.

A read-only live check on November 6 returned healthy HTTP responses and fresh
public GitHub activity. The earlier unavailable feed state was not reproduced;
this does not establish permanent availability.
