# Listening on mobile

The existing personal interface now includes a Listening view and an optional
private controller. Spotify playback is independent of development activity:
listening to music alone never means that the owner is coding.

The owner can connect Spotify, choose whether to share playback status or track
details, select up to twelve public playlists they created, and stop sharing.
The website links to Spotify; it does not play music itself. Playlist artwork
is displayed unchanged with Spotify attribution.

### Private playback acceptance check

The protected `/owner/listening/` page has an explicit **Check playback privately**
button after Spotify OAuth completes. This is an on-demand, one-request check of
`user-read-currently-playing`; it does not enable the public Listening signal,
public presence, editor activity, or GPT telemetry. The response uses owner-only
Cloudflare Access, same-origin POST, private no-store caching, server-side
cross-isolate throttling and a single short-lived database lease. No song details
are written to the database or shown to other visitors. Spotify can return no
active track when playback is paused or private; this does not indicate that
coding has stopped. Wait at least one minute between checks.

A real iPhone test requires playing a track, tapping the private check, and
confirming its response. The source and synthetic CI cannot substitute for
real-account observation. Public sharing remains disabled unless separately
reviewed and enabled by the owner.

Public sharing stays off until account setup, acceptance testing and the owner's
release decision are complete. Connecting an account does not enable sharing.
Account-level playback can reflect listening on another device; it does not
require keeping the personal website or a laptop continuously open.

Private deployment and account-setup instructions are maintained in the existing
private project record. Do not add credentials or account information here.

See [integration status](LIVING_INTERFACE_INTEGRATION.md) and the optional
[editor companion guide](../extensions/presence-vscode/README.md).
