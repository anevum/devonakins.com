# DevonAkins.com — Living Interface V3

**November 6, 2026 · design system + executable prototype + initial presence projector**  
**Owner:** Devon Alan Akins · **Repository:** `devonalanakins/devonakins.com` · **Hosting:** existing `devonakins-personal` Cloudflare Worker

## 0. Scope and truth

This is an original V3 **review prototype**, not a deployment or a production data integration. The included `index.html` is a completely interactive and responsive browser demonstration. Its statuses and charts are deliberately synthetic. The accompanying pure `presence-model.mjs` is executable and tested, but is not an authenticated public API, an editor agent, or a Spotify connection. This design does not merge PRs, update production secrets or change who can view private data.

**Core proposition:** A personal website should be a living, human-readable portrait of ongoing creative and engineering work. Visitors see useful, accurate, opt-in signals, can navigate to evidence, and never mistake a private development session for a public screen stream. This is not a “vibe coder” brand or an always-on surveillance dashboard.

## 1. Information architecture and visitor journey

| Destination | Visitor's primary question | Key content | Live requirement |
| --- | --- | --- | --- |
| **Overview /** | Who is Devon, and what's he working on? | Name, human introduction, compact current status, independent listening/GitHub signals, selected works | Presence projected when authorized, otherwise neutral |
| **Live Studio /studio/** | Is development underway right now? | Sanitized session state, explicitly authorized project, source provenance, public milestones, activity timeline | Separate editor / owner session inputs; no files or code |
| **Work /work/** | What actually exists? | Original identities, evidence-anchored project cards, maturity/status, source/public releases | Public GitHub updates may augment; never drive claims of currently editing |
| **GPT /gpt/** | How is ChatGPT being used? | Historical owner-attested data, authorized measured observations, source and report windows | Historical values remain historical; conditional opt-in sources only |
| **Listening /listening/** | What music is being shared? | Opt-in currently playing, curated playlists, official Spotify attribution/links | Spotify independent of development status |
| **Writing /writing/** | What stories and original worlds exist? | Books, Anevum/Transcosmic, linked public work | Optional manual writing presence only |
| **About /about/** | What motivates the work and how to connect? | Human story, values, public links, contact | No live tracking required |

Canonical existing routes must be preserved, including `/source/`, `/contact/`, portfolio deep links, and legacy redirects. The demo's nav is a design-study grouping, not a proposal to break extant URLs. Public owner controls are **not part of the visitor nav** and must be authenticated behind Cloudflare Access.

### Audience split

- **First-time visitor:** understands Devon's purpose and sees what is actually active, without decoding a terminal.
- **Technical reviewer:** finds source evidence, freshness, status, release notes and clear claims.
- **Friend, family or collaborator:** sees a human creative practice without private schedule, location, family status inference, or sensitive information.
- **Owner on iPhone:** switches public visibility and remote-session mode without laptop access.

## 2. Visual identity (V3 review direction)

**Existing identity retained:** Devon Alan Akins; original mark and portrait; midnight/graphite palette, copper accents, cool cyan, restrained orbital/atmospheric detail. The hero must remain visibly human. No anonymous stock photos, heavy dashboard widgets, emoji navigation, or giant decorative 3D canvas displacing the content.

| Token | Value | Use |
| --- | --- | --- |
| Deep background | `#080a0e` | Full shell |
| Raised glass | `#11151c` | Panels |
| Raised glass 2 | `#151b24` | Hover/control surfaces |
| Copper | `#dea87c` | Primary CTA, authorial/creative accent |
| Cyan | `#8ec5d3` | Technical source and focal details |
| Green | `#9bcba6` | Verified positive/live states only |
| Lilac | `#b6a9e8` | Writing/manual creative states |
| Primary text | `#f3f2ed` | Main titles/content |
| Muted text | `#8d98a9` | Provenance and secondary labels |
| Panel radius | `19px` | Friendly but precise architecture |
| Typography | local/system sans + Georgia italic accent | Avoid font third-party requests |

**Motion:** Static by default under `prefers-reduced-motion`; tiny status LED and ambient orbit for enabled motion. Never animate while a signal is stale, unavailable or private. No flashing, sound, autoplay, simulated code typing or motion-heavy loading. Layers should be compositor-friendly; imagery stays lazy except portrait/hero.

**Responsive:** Desktop: vertical rail + editorial two-column content; tablet: one-column data sections; mobile: sticky horizontal scrollable nav, content cards, narrow persistent status dock, safe-area padding. Targets: 320, 390, 768, 1024 and 1440 px; 200% zoom; landscape and short heights. Fixed dock must not obstruct buttons or content.

**Quality target:** WCAG 2.2 AA, keyboard focus visibility, reduced-motion, semantic headings, meaningful empty states, source/provenance labels, screenshot-based review. Targets (not measured claims): LCP under 2.5 seconds on typical mobile, CLS below 0.1, INP under 200 ms.

## 3. Presence semantics — strict rules

“**In the Zone**” appears only when (A) approved current development session and (B) independently authorized current music playback are both fresh. Spotify **does not** prove coding. A recent GitHub commit **does not** prove that the user is editing at that moment.

| State | Condition | Visitor representation |
| --- | --- | --- |
| In the Zone | Fresh approved development session + fresh shared Spotify playing | Presence active + music independently sourced |
| Developing | Fresh editor heartbeat or manually declared remote session, music not shared | Source explicitly marked as editor-observed or owner-declared |
| Listening | Authorized current Spotify playback only | Music only; no coding claim |
| Working privately | Explicit owner private override | No project, repository or source detail |
| Writing / Researching / Family time / Sleeping / Away | Explicit manual owner status with expiry | User-selected label, never inferred automatically |
| Idle | Prior approved session has expired | No false live activity |
| Offline | Nothing currently known | No assertion about physical state |
| Not broadcasting | Sharing disabled or unavailable | Public data withheld |

**Priority:** hard kill switch > privacy override > valid manual status > valid development session > independent music > idle/offline. When a source is unavailable, it becomes *unknown*, not “false evidence” and not an invented current state. Project labels use an explicit, owner-approved slug allowlist. `presence-model.mjs` demonstrates this policy without raw provider metadata or any external network calls.

**Timing starting design:** development heartbeat every 60 s, stale at 120 s; explicitly declared remote sessions expire in 30 min without renewal; playback state stale after 120 s; client public polling 30–60 s while visible (refetch on visibility return); public GitHub events remain on the current approximately five-minute refresh. These are *engineering starting assumptions*, not provider SLAs and not guaranteed exact UI refresh intervals.

## 4. Integration into the existing codebase (do not rebuild it)

**Actual current stack inspected:** Vite 8, TypeScript 7, Three 0.186, static deep-link page generator, canonical `v2/index.html` promoted to `/`, `src/terminal.ts` for client interactions, `src/immersive-routes.mjs` for route panels and `src/worker.mjs` for Cloudflare Worker routing. Existing tests check semantic links, HTTPS redirects, security headers, generated routes, privacy boundaries, TypeScript and responsive behavior.

1. **Create source-of-truth public projection** in `src/presence-model.mjs` (included here as tested first slice). Deploy only after security and source adapters are complete. Versioned envelope: `version`, `visibility`, `state`, `asOf`, `source`, `project`; no user or private metadata.
2. **Authenticated owner controls:** `POST /api/presence/owner` available only behind validated Cloudflare Access + CSRF defenses. Actions: publish on/off, manual mode, private override, one approved project slug, status expiry, emergency stop. No anonymous write endpoint.
3. **Opt-in source adapters:** local editor companion sends **only a boolean active signal, allowlisted project slug and time**, never filenames, window titles, code, diffs, prompts, key events or environment variables. A separate verified owner-controlled remote-session command supports iPhone/ChatGPT Work sessions; mark as owner-declared, not editor-observed. Authenticated writes are rate-limited and payload-size bounded. No indiscriminate machine monitoring.
4. **Storage:** evaluate a minimal first-party Cloudflare D1 record or strongly consistent equivalent already authorized under the existing Worker; do not reuse Spotify credential rows. Persist only sanitized public projection, owner preferences and expiring session metadata. Store no raw activity history by default. Prefer simple time-based expiration and direct no-store responses; avoid eventually consistent KV for an *instant* privacy-off guarantee.
5. **Public API:** `GET /api/presence/public` returns only the projector envelope. No-store for revocation-sensitive personal state; no public paths for private API reads. Browser obtains Spotify music from separately gated `GET /api/listening/now` and public events from existing `/api/telemetry/public`. Do not silently combine their data scopes. If Spotify is hidden, public UI cannot infer from playback.
6. **Frontend composition:** replace only the static Observatory's *presentation layer* in the canonical shell after the content contract is tested. Use a shared status component across homepage and deep links. V3 `/studio/` should be a generated route from `src/immersive-routes.mjs`, added via `src/content.mjs` / `scripts/pages.mjs` without breaking old routes. `src/terminal.ts` owns one visible-page poller per source; no third-party client JS. Keep ChatGPT historical fallback intact.
7. **Spotify work:** do not merge or overwrite draft PR #35 and stacked PR #38 by blind cherry-pick. Rebase/reconcile paths against main, review Cloudflare Access/D1/Spotify OAuth/consent with explicit owner approval; preserve status-only and track-detail toggle independence. Curated public playlists are a distinct milestone. Official Spotify attribution and unchanged content are required.
8. **GPT integration:** preserve immutable November 4 profile as historical. PRs #41/#42 are *experimental*, with no verified full personal ChatGPT analytics feed. Any owner-visible Work/Codex observation must show `observedAt` and unknown provider refresh time when applicable. Do not publish ChatGPT cookies or capture chat content.
9. **GitHub:** live public events PR #39 is deployed but the source failure reported after it is not resolved by UI design. First diagnose production with the source-safe PR #40 diagnostics. Never classify commits, PRs or Spotify activity alone as an editor heartbeat.
10. **Release:** one integration PR against current main after branch reconciliation; preview visual regression and synthetic tests, security audit, owner review, explicit merge/deploy approval, rollback version identified, live HTTP and physical iPhone verification. No direct production switch in a design review.

### Suggested public API shapes (design, not currently deployed)

```json
{
  "version": 1,
  "visibility": "public",
  "state": "developing",
  "asOf": "2026-11-06T17:00:00.000Z",
  "source": "editor-heartbeat",
  "project": "Merit"
}
```

The project label is from a **server-side allowlist**. It is never a path, repo URL, commit message, client name, code fragment or free-form content. Owner-only mutations require a separate authenticated API contract; never extend the public GET handler with state-changing query parameters.

## 5. Verification and privacy acceptance

**Already performed on included source:** Node's built-in test runner: 9/9 pure projector cases passed. Local Playwright/Chromium rendered the standalone prototype with zero page errors at 390, 768 and 1440 px. Screenshot review revealed a nested-title display bug; corrected in the latest artifact. This does **not** prove integrated site CI, live OAuth behavior, Cloudflare security or physical iPhone suitability.

**Must pass before any public data connection:** no auth bypass, no raw source text accepted in public schemas, private switch precedes every source, expire/clock-skew invalidation, replay and rate limits, CSP and SSR escaping, stale and disconnected provider states, source data ownership checks, mobile reflow/keyboard/focus/contrast/axe, both manual and automatic activity labeling, removal of accidentally cached personalized data, no leaked Spotify tokens or project/client context, verification on live exact SHA and Cloudflare rollback.

## 6. Decisions, status and next change

- **LOCKED intent:** Public living developer profile; no real development video stream; independently sourced Spotify, GitHub, GPT; private-by-default; human-centered and cinematic.
- **PROPOSED aesthetic:** V3 editorial-cinematic UI demonstrated by `index.html` with original orbit artwork, typography, status dock and seven visitor views. Owner must review desktop and mobile before locking the visual contract.
- **IMPLEMENTED locally:** Interactive design prototype and a first-party pure presence projection model with tests.
- **NOT IMPLEMENTED:** authenticated remote/local ingest, privacy controls in Cloudflare, new public presence API, real Spotify credentials, official full live GPT analytics and production site overhaul.
- **NEXT MERGEABLE UNIT:** Review this design; integrate the pure projector plus permission-gated synthetic API route and one truthful minimal shell status in the existing `devonakins.com` repository, independently tested. Keep PR #35 and #38 untouched until reconciliation.