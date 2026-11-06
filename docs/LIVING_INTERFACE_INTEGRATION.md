# Living Interface integration — November 6, 2026

## Scope and preserved site

Review source, **not a production release**. The existing portrait/smoke homepage,
original assets, typography, navigation, portfolio identities, deep links, legacy
redirects, historical GPT snapshot, and public GitHub telemetry remain the base.
The V3 demo is a reference, not the homepage. No framework/vendor migration,
new account permission, cloud resource, secret, or public disclosure is applied.

Baseline: remote main `e1b0a4b46756e54896287d99bd08881abef93b65`.
Local recovery was checked against every blob in its GitHub recursive manifest.
Only the reconciled final tree is published; local recovery commits are not
part of the remote implementation history.

| Track | Source retained | Integration |
| --- | --- | --- |
| Spotify | PR #35 `71cefb5`, stacked PR #38 `e6ffcfa` | Encrypted D1/OAuth, Listening UI, owner page; no account connected |
| GitHub | Main already includes PR #39/#40 | Current v4 cache, failure diagnostics, timeline/filter/clipboard preserved |
| GPT | PR #42 `9b201a4` | Disabled observation bridge/panel; source feasibility PR #41 stays separate |
| Presence | PR #43 `4fec05a` | Pure model plus new D1 owner/public APIs, shell dock and Studio |

## New functioning source paths

- `GET /api/presence/public`: six-field allowlisted projection, no-store, safe
  hidden default, independent playback/session source and TTL validation.
- `GET /owner/presence/`: iPhone-capable private controller using the existing
  Listening control-room styling and Cloudflare Access identity boundary.
- `GET/POST /api/presence/owner`: start/pause/resume/end, fixed manual statuses,
  project selector, 15/30-minute sessions, private-work and music preferences,
  release-gated opt-in and emergency stop. No filenames or free text accepted.
- `/studio/`: expanded presence window inside the existing portrait shell.
  Links lead to Listening, the existing public timeline/GPT profile, and Work.
- Footer dock: minimal unified presence with distinct owner-declared provenance.
  Spotify by itself never says In the Zone or Developing.

The controller preview uses the same public projector and gated playback as
visitors. Track details remain on Listening. The public poll interval is 60 s
while visible, with local source-age checks every 5 s. Those local checks do
not represent new provider measurements. Paused/stale/offline/private data
does not retain an active project. Sleep and family time are manual only.

## Privacy and concurrency

`migrations/0002_presence.sql` adds one row in the same website's **dedicated
private** D1 used by Spotify. Never bind another project's database. There is
no event history or raw activity archive. Direct D1 queries use the primary;
no eventually consistent KV/cache is used for presence revocation.

Owner authorization uses the trusted runtime `ctx.access`, audience allowlist
and exact owner email. User-supplied identity headers alone are rejected.
POST requires same-origin Origin, JSON, bounded body and strict field choices.
Ordinary mutations have a 1 s database cooldown and revision CAS. Replay or a
concurrent stale write returns 409. Emergency off bypasses cooldown/stale
revision and increments revision; older writes cannot re-enable broadcasting.
The UI keeps emergency stop usable during a slower save and ignores older
responses. Provider reads recheck revision after await, so a late response
cannot republish after private/off. Public listening is also fenced by the
master presence preference when the presence feature is enabled.

Privacy off prevents subsequent server disclosures after the committed check.
It cannot recall data a visitor already received. A connected visible page
clears on its next poll (up to 60 s plus network timeout); playback and presence
also expire locally. Hidden tabs clear their prior state before resuming reads.

## Configuration and owner action — not performed

Existing live Worker had **no bindings** when inspected. Its active version was
`7ad334a8-06d8-4019-9663-f302912c7e27`; previous version was
`2efbc3e5-a3dc-419b-a478-b1b4c27b5860`. This is provider configuration evidence,
not a verified live HTTP user journey or a refreshed rollback authorization.

1. Review the source/CI and synthetic mobile preview before a staging release.
2. Authorize the dedicated D1 binding and apply both migrations only there;
   configure protected Access paths for `/owner/listening*`,
   `/api/listening/admin/*`, `/api/listening/oauth/*`, `/owner/presence*`, and
   `/api/presence/owner`. Verify trusted `ctx.access` with real owner login.
3. Follow `LISTENING-MOBILE.md` for Spotify app/client ID, encryption secret and
   owner identity. The exact Spotify redirect is
   `https://devonakins.com/api/listening/oauth/callback`. The owner must finish
   Spotify consent on their account and test playback on two devices.
4. `PRESENCE_ENABLED=true` enables the private source path after setup.
   Keep `PRESENCE_PUBLIC_RELEASE_APPROVED` and
   `LISTENING_PUBLIC_RELEASE_APPROVED` unset/false until separate disclosure
   approval. Each also needs the owner's corresponding opt-in.
5. GPT read/write/binding gates remain unset. No working personal OpenAI account
   analytics API or real selected usage reading has been established.

Do not paste credentials into chat, GitHub or project notes. No action here
requires a laptop running continuously for account-level Spotify or a manually
declared remote session. An **editor-observed heartbeat adapter is not yet
implemented**: the backend only creates owner-declared sessions. The pure model
supports the future distinction; its existence is not evidence of a collector.

## Verification and release gate

The repository build/type check and Node suite cover pure projection, actual
SQLite migration/SQL mutations, anonymous/header-spoof rejection, Origin,
release gates, replay, CAS races, cooldown bypass for stop, body limits,
manual/session expiry, private behavior, delayed-provider revocation, actual
Worker routing, and the existing Spotify/GPT/telemetry regression tests.
Browser acceptance covers the existing route shell, keyboard/history, 320,
390, 768, 1024 and 1440 widths, short landscape, reduced motion and axe; new
checks cover owner session request payloads, shutdown and presence provenance.
Fixtures are synthetic. Tests do not establish real account integration.

Focused integrity review found and corrected case-duplicated security headers
when wrapping module responses, legacy music-as-coding claims, missing body
cancellation, and the owner stop button being disabled during ordinary saves.

**RELEASE NO-GO** until real Access/OAuth, token renewal/revocation and private
database runtime tests, real source eligibility, exact-head CI, human visual/
usability review, production diagnostics, rollback validation and release
approval. Local WebKit compatibility remains a separate environment result;
CI must run its pinned Chromium/WebKit binaries. A qualified human independent
review is not supplied by this automated review.

Open work: real GitHub upstream failure has not been diagnosed or fixed here;
selected public playlists and custom free-text statuses are not implemented;
the GPT local collector is not a verified account connection; no editor adapter.
Spotify refresh-token rotation during simultaneous owner visibility changes
requires real-provider/concurrency acceptance before a release claim.

### Credential and shutdown race hardening

The next source increment reproduces and fixes refresh-token loss when playback
fails after a successful token rotation, or when owner visibility changes while
the refresh is in flight. Encrypted rotated credentials are now saved before
playback is requested. Owner visibility changes retain the refresh lease but
invalidate publication. A separate credential fence checks lease ownership and
the original connection; disconnect/reconnect cannot be undone by a late refresh.
An obsolete probe releases only its own lease and suppresses its projection.

Cache reads now validate the complete bounded playback envelope, track field and
URL allowlists, canonical timestamps and the current owner detail preference.
Extra cached fields cannot enter the public response. Valid playing/paused cache
entries remain reusable across isolates without extra provider polling.

The private controller's confirmed shutdown message now survives late successes
and failures from an earlier save. Chromium/WebKit regression scenarios hold an
ordinary request open, stop broadcasting, and then deliver the older response.

Deterministic SQLite/provider-fixture tests cover these races; the full Node
suite now contains 105 tests. A failing-before/passing-after cache reproduction
and browser shutdown-message reproduction were observed locally. These are
source/runtime-fixture checks, not a genuine Spotify account connection. Real
Access, encrypted D1 and Spotify authorization/renewal acceptance remain open.

OAuth callbacks now retain a consumed, single-use in-flight marker. Disconnect
invalidates all such attempts before erasing credentials; the callback's SQL
commit requires its marker still to exist. Starting another authorization also
invalidates earlier attempts. Regression tests reproduce and prevent an old
callback reconnecting after disconnect or replacing a newer connection. No
schema migration or new credential/permission is introduced by these fixes.

Human usability protocol: ask a first-time nontechnical reviewer to identify
Devon, open a project, find Listening, and explain the source of a status;
ask the owner to start a 15-minute iPhone session, switch to private, then stop.
Record confusion and verify the observed public result. No actual nonexpert
user review or physical iPhone testing is claimed.

## Rollback

This PR does not alter Wrangler production bindings or flags. Before any
release, record the then-current Worker version and binding configuration.
Disable both public release flags to stop all provider disclosure; use owner
stop when available. Revert the Worker version only after validating the
configured bindings. Retain the private D1 for authorized recovery; do not
delete it or regenerate its token key as a rollback step. An old version lacks
the master presence gate, so both Spotify and presence release flags must stay
off during rollback.
