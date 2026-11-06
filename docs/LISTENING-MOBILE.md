# iPhone Spotify connection — deployment and acceptance gate

**Source-only implementation. NOT DEPLOYED. No Spotify account has been connected. Public broadcasting is OFF.**

The original local `scripts/spotify-connect.mjs` remains an optional development utility. The recommended iPhone flow is now the **private owner control room** at `https://devonakins.com/owner/listening/`.

## Architecture

1. Owner visits `/owner/listening/` in Safari and authenticates through **Cloudflare Access**.
2. The Worker verifies `ctx.access.aud` against an allowlist and the authenticated email against `LISTENING_OWNER_EMAIL`. Absent/failed Access always returns 403.
3. **Connect Spotify** makes a same-origin POST. Worker creates 5-minute OAuth state and nonce, hashes them in dedicated D1, AES-256-GCM encrypts a PKCE verifier, and sets a Secure/HttpOnly/SameSite=Lax nonce cookie.
4. Safari follows Spotify's login/consent page, requesting only `user-read-currently-playing`. Spotify returns to the HTTPS callback on devonakins.com.
5. Worker checks the same owner identity, one-use state and browser cookie, claims the state atomically, exchanges the code server-side using PKCE, encrypts access and refresh tokens in dedicated D1 and **forces public sharing back to OFF**. A consumed marker must still exist at commit: disconnect or a newer authorization cancels older callbacks, including an exchange already in flight. The marker is removed after completion.
6. Later, any site's public visitor reads `GET /api/listening/now`. Only when the owner has enabled sharing AND `LISTENING_PUBLIC_RELEASE_APPROVED=true`, one D1-coordinated probe reads Spotify at most once per 60 seconds (under normal operation) across Worker isolates. Public output contains no tokens, device identifiers, account identity or full Spotify response.
7. Disabling sharing or disconnecting increments a database revision, erases the published projection and fences off in-flight probe results. Visibility changes retain the token-refresh lease while invalidating the projection. If Spotify returns an updated refresh token, it is encrypted and saved before playback is requested, even if the playback read later fails. Disconnect/reconnect cancels the lease and fences out any older credential write. Authorization expires after six months and must then be renewed.

This is *Spotify account-level* playback: supported iPhones, Macs/PCs, tablets and Spotify Connect devices use the same authorized account. The website never needs device Bluetooth, microphone, local network access, or an open iPhone browser tab. Spotify cannot guarantee offline/private playback visibility, and Spotify is an independent listening signal, not proof of IDE activity. In the Zone additionally requires a current development session with explicit provenance.

## Configuration prerequisites — NOT performed in this PR

**Never apply these directly to the existing live Worker without separate acceptance.**

1. Create or select a Spotify Developer app. In Spotify Developer Dashboard add this exact redirect URI:
   `https://devonakins.com/api/listening/oauth/callback`. Confirm the current Spotify Development Mode/Premium conditions.
2. Configure **path-scoped Cloudflare Access** on each owner surface, rather than on the entire public Worker:
   - `devonakins.com/owner/listening*`
   - `devonakins.com/api/listening/oauth/*`
   - `devonakins.com/api/listening/admin/*`

   Use an identity-based Allow rule for the single verified owner. Review whether these are managed under one Access app/audience or multiple; the Worker accepts an explicit comma-separated `LISTENING_ACCESS_AUDS` or one `LISTENING_ACCESS_AUD`. Verify on a real authenticated callback: `ctx.access` must be present in the Worker invocation, not a spoofable request header. The current Worker embeds static assets itself; **do not migrate it to a separate Workers Static Assets router without reassessing ctx.access**, which may be unavailable to that Worker.
3. Create a **dedicated** D1 database (do not reuse Cristy's, ANEVUM's, DevonStation's or another product's data). Apply `migrations/0001_listening.sql` only to that new database. The proposed name is `devonakins-listening-private`.
4. Add to the intended Worker Wrangler configuration after the dedicated database has been created:

   ```jsonc
   "d1_databases": [{
     "binding": "LISTENING_DB",
     "database_name": "devonakins-listening-private",
     "database_id": "<verified database UUID>"
   }]
   ```

   The existing `wrangler.jsonc` is deliberately unchanged because no new database UUID has been verified.
5. Supply the runtime settings `LISTENING_OWNER_EMAIL`, `LISTENING_ACCESS_AUD` or `LISTENING_ACCESS_AUDS`, and `SPOTIFY_CLIENT_ID`. Use an owner-reviewed, randomly generated 32-byte **base64url** AES key stored as the `LISTENING_TOKEN_KEY` Worker secret. Do **not** send any key, Spotify token, login cookie or auth code into a chat, ticket, Git commit or ordinary Notion page.
6. Set `LISTENING_PUBLIC_RELEASE_APPROVED` to `false` or leave unset. It must only be switched to the exact string `true` after a real-account test and explicit public-sharing acceptance. The owner must separately enable the publishing checkbox in the control room after that gate is open.

## Request contracts

- `GET /owner/listening/`: protected private owner page, noindex and no-store.
- `GET /api/listening/admin/status`: public-safe private status, no tokens.
- `POST /api/listening/oauth/start`: generates a five-minute PKCE authorization link and secure browser nonce.
- `GET /api/listening/oauth/callback`: one-use code exchange; redirects without exposing credential values.
- `POST /api/listening/admin/settings`: strict JSON booleans `publicEnabled` and `showDetails`, same-origin only.
- `POST /api/listening/admin/disconnect`: disables publishing, removes encrypted tokens and in-flight state.
- `GET /api/listening/now`: public default `hidden`; after explicit release approval, validated `playing`, `off_air` or `unavailable`.

## Tests, hazards and rollback

Run `npm run build && npm test` on the exact PR SHA. Browser acceptance must include Chromium and WebKit, 320–1440 px, keyboard/focus, the sixth Listening tab, /listening/ and existing deep links. The new Node tests exercise owner authentication, PKCE state replay, encrypted persistence, privacy controls and a disconnect race. **Passing synthetic tests does not prove production Access callback cookies or a real Spotify account.**

Before production: prove Cloudflare Access protects all three path families (including OAuth callback) without blocking the public homepage. Verify the D1 binding, never log tokens, exercise real Spotify player states on iPhone and a second device, verify 204/401/403/429 behavior and account reconnect, confirm cache/lease behavior under concurrent visitors, and inspect an actual iPhone Safari display. Record the public owner approval before enabling broadcasting.

Security caveats: Spotify album art may be loaded from Spotify's CDN when track sharing is enabled; that CDN receives the viewer's image request. Spotify Private Sessions are not guaranteed to be reported by the currently-playing API. Loss of the private encryption key makes tokens unreadable and requires reconnecting; do not silently generate replacement keys for an existing database.

Rollback: keep the current live Worker unchanged while PR #35 is draft. If a future release fails, disable `LISTENING_PUBLIC_RELEASE_APPROVED` and/or the owner sharing switch, revert the Worker version after reviewing connected-resource rollback limitations, and leave the dedicated D1 database intact for authorized recovery. **Deleting a database is not part of rollback.**
