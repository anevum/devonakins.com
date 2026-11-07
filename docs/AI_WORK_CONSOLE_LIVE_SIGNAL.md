# DevonStation AI Work Console x Live Signal V4

**Status:** proposed cross-system product contract; optional first source-only adapter verified locally. Not an approved production change. **Date:** 2026-11-06 (America/New_York).

## Product decision

Keep AI execution, private task history, approvals, secrets, tool access and account identity in **DevonStation**. Keep the portrait-led **DevonAkins.com** as a distinct, public, read-only projection of *selected, source-verifiable* activity. Reuse the existing `devonakins-personal` Cloudflare Worker, the owner Access policy, the public-project allowlist, and the source-separated Spotify, human presence, cloud-task presence, GitHub, and historical GPT systems. Do not create another public agent backend or expose the AI console in the public site.

This is an enhancement to Live Signal V4, not a site rebuild. Existing portrait/identity, Work/Writing/Listening routes, mobile layout principles, and owner privacy controls remain intact. **The current single-task cloud presence implementation is already on the website's released source, but sharing remains off.** A multi-task public feed and the private AI Work Console are not yet implemented.

## Experience: private desktop/tablet

- **Header:** `DEVONSTATION / WORK`, model/runtime, available budget, owner session, Work privately, Stop all. The source of each runtime is explicit: `ChatGPT plan (local, if eligible)` versus `OpenAI API (metered cloud)`.
- **Command surface:** one primary prompt plus project selector, trusted repo, source-of-truth references, permission profile (`Investigate`, `Branch and test`, `Prepare PR`, `Protected release`) and Run. Default to the least-privileged profile. One action should start a meaningful safe task without configuration.
- **Parallel task lanes:** each job has a stable private ID, title, project, provenance, phase, started/last-event timestamps, cost/usage when returned by that runtime, current blockers, and owner actions. Show `Running`, `Waiting for me`, `Verifying`, `PR ready`, `Completed`, `Failed`, `Disconnected` distinctly. Do not infer testing success from model-generated prose.
- **Work inspection:** stream of tool events and results behind Access, file diff, test log, CI links, artifact gallery, cancel/retry, change review, and explicit human approval controls. Preserve raw errors and sensitive details only in the authorized private view; never submit them to the public presence bridge.
- **Control rail:** queue, resumable sessions, approved integrations, provenance ledger, per-job spend/cap, project policy and connection status.
- **Mobile:** current jobs and one-tap review/approve/stop first; detailed traces behind deliberate expansion. Do not require a laptop for cloud API sessions, but do not promise plan-based local work when the user-controlled runtime is offline.

## Experience: public Live Signal V4

Initial viewport, without scrolling: compact ribbon **WORK | SPOTIFY | GPT** plus `In motion.` activity window replacing the two static homepage Merit/Rhen links. Preserve the existing portrait/smoke identity. Work and Spotify are independent signals; `In the Zone` only when both fresh, authorized work evidence and a fresh playing signal overlap. Never call music alone proof of coding.

- **WORK:** `Building: [owner-approved public name]`, observed editor activity or explicitly task-reported cloud work, source label (`Editor`/`Cloud task`), age and expiration; parallel publicly permitted jobs after multi-task storage is verified.
- **SPOTIFY:** real authorized song, artist, artwork and playback state only if the existing listening release and owner consent permit; otherwise `Hidden`, `Paused`, or `Unavailable`.
- **GPT:** independently verified current usage *only if a supported account-level source is entitled and connected*. Until then: `Not connected` or historical figures labeled with the capture date. Agent API job token usage is a separate scope, not a personal ChatGPT Work profile total.
- **RECENT:** dated public GitHub activity is clearly historical; a commit does not imply a current working session. Never show source code, filenames, conversation titles, private repo identifiers, clinical/business/family data or prompts.

Appearance: charcoal `#07090f`, copper `#d9a47d` for human editor evidence, cyan `#8cbdc6` for reported remote tasks, restrained violet for historical GitHub events; subtle glass lines, short lines of type, restrained activity pulse only on a fresh signal. 44px controls, reduced-motion support, accessible contrast, keyboard navigation and robust 320px width. No ornamental status text or verbose instructions on the public home.

## Event and data boundaries

```text
Private owner (DevonStation)
  -> Agent dispatcher and isolated execution runtime
  -> Authenticated Agents API events / approved local tool observations
  -> Private task ledger (sensitive results, approvals, source evidence)
  -> Strict activity projection (public project allowlist, state, source, UTC age)
  -> Existing site cloud reporter (v1) / reviewed multi-job endpoint (v2)
  -> Cloudflare Worker privacy gates + TTL + no-store public projection
  -> DevonAkins.com Live Signal V4
```

The standalone `scripts/agent-presence-bridge.mjs` is an **optional source-only adapter** for one authenticated OpenAI Agents API root turn. It consumes only event types and `turn.subagent_id` for lifecycle decisions. It calls the existing `reportCloud` function, never forwards raw event bodies, and reports `running`, `waiting`, `completed`, `failed`, `cancelled` without invented tests-passed claims. If a stream disconnects unexpectedly, it reports no fabricated completion; existing two-minute TTL expires. It sends no idle timer-based heartbeats. The private runner must explicitly submit the turn, receive confirmation, and subscribe to events before invoking the bridge; it must handle turn recovery and actual source verification independently.

Current v1 boundaries: only **one paired cloud task**; one-time owner-issued pair code, task-private file with mode 0600, 24h pairing lifetime, short-lived task status, per-signal sequence/replay protections, permitted project slug, global OFF/private override; no account-wide discovery. Do **not** multiplex many tasks through the singleton or turn on public sharing to test this adapter.

Planned v2: additive D1 table `activity_jobs` keyed by opaque internal job IDs and scoped owner-approved public projects, independent hashed report credentials, revision/sequence CAS, observed-at/received-at/expiry, per-job source, phase and status. Use an internal default-private ledger with short retention and a **separate allowlisted public projection**; public JSON must omit job identifiers, prompts, error messages, file paths, source repo internals, tokens, conversation data and any unapproved project. Max concurrent jobs and TTL should be explicitly bounded, tested, and approved before rollout. `GET /api/activity/v2` should return a versioned view and source-level stale/unavailable states, with `Cache-Control: no-store`, rather than a merged synthetic 'active' value. Aggregate only reviewed signals and ensure stale jobs disappear even if the owner goes offline.

## Provider/auth modes and costs

1. **OpenAI Agents API (cloud runtime):** best fit for cloud jobs continuing when a laptop is off. Own API project key and API billing, hosted or self-controlled sandbox expenses, tool grants and budget caps. The site never receives the key. Agents API sessions have their own logs and usage; no automatic access to arbitrary ChatGPT Work conversations.
2. **Sign in with ChatGPT / plan usage (local or properly user-controlled runtime):** only after verifying enrollment, account eligibility and the permitted SDK flow. OpenAI terms require persistent SIWC credentials locally under user control (not a remote managed database), and require expressly authorized background requests. This is not an interchangeable replacement for an OpenAI API key or a right to process another person's work. A Cloudflare D1 table must **not** store persistent SIWC access/refresh tokens.
3. **Existing ChatGPT Work/Codex tasks outside this console:** supported participating task reporters may send reviewed fixed checkpoints; there is no verified universal ChatGPT account task-list stream or current personal usage API. Never scrape browser cookies or private undocumented endpoints.

## Security and authority

- Preserve Cloudflare Access for the private owner UI and deny non-owner users by default. Use server-verified identity, least-privilege installation tokens, per-job sandbox boundaries, CSRF protections, origin checks, and deny-by-default tool grants.
- Read-only diagnosis may run unattended. Branch writing and tests can be allowed within scoped repos. PR merges, protected deployments, public disclosure, access policy changes, purchases and destructive operations require independent approval and the existing protected workflow. Clinical, client, family and financial records are private by default and excluded from any public activity projection.
- Never trust a model's statement of success as CI proof. Show actual tool response, command exit, artifact/diff, independent test result, final merged hash, and production verification separately.
- Stop all must revoke report credentials and hide existing public jobs, including in-flight requests. Stale event/replay, future timestamps, missing config and provider failures fail closed.
- A trusted runner's telemetry failure must not stop authorized engineering, but must create a private observable warning.

## Delivery gates

**Gate A - first compatible adapter (source only):** Existing v1 reporter remains unchanged. Add adapter, unit tests, and the present contract in a review branch. Test root/subagent outcomes, waiting, disconnect, errors, privacy-safe projections, and no false verification. Do not pair a real task, change migrations, enable public flags, or deploy.

**Gate B - usable private Work Console:** Integrate a single agent-backed job with owner auth, sessions, repo-scoped tool permissions, artifact/test inspection, explicit approvals, clear usage/cost accounting and cancellation. Verify real provider behavior and stopped/disconnected states, with a private pairing smoke test. No silent use of plan credits.

**Gate C - V4 concurrent activity:** Add safely migrated multi-task storage and public allowlisted endpoint, run independent security/multi-device/accessibility tests, merge only with required review, then verify production end to end behind owner-controlled public opt-in. Keep Spotify and GPT metrics independently sourced and independently disabled.

## Links and evidence

- Existing site cloud reporter: [`docs/CLOUD_PRESENCE.md`](./CLOUD_PRESENCE.md)
- Existing main repo: https://github.com/devonalanakins/devonakins.com
- DevonStation implementation repo: https://github.com/devonalanakins/devon-station
- OpenAI Agents API / events: https://developers.openai.com/api/docs/guides/agents-api/overview and https://developers.openai.com/api/docs/guides/agents-api/sessions/events
- Sign in with ChatGPT terms (Nov 4, 2026): https://openai.com/policies/sign-in-with-chatgpt-terms/
- Open-source sign-in guide: https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt