# Live Signal V4 — release 1.3.0

Preserves the original portrait, atmospheric shell, six navigation views, public project pages, Listening, Studio and GPT archive. Replaces the selected Merit/Rhen home cards with In motion and a persistent three-group work/Spotify/GPT ribbon. The static November 4 2.7B estimate is confined to the dated GPT archive. No current count is inferred from it.

## Evidence and data boundaries

- Editor: actual focused-edit timestamp, 120-second expiry. Automatic local matching of the built-in VS Code Git API's origin remote to the fixed public catalog. No filenames, paths, command output or Git metadata are sent. Unknown remotes produce no project name. SecretStorage credential lasts 30 days, remains revocable, and startup remembers explicit Resume/Pause consent without inventing an edit. Initial pairing stays paused. Codespaces using VS Code's Git API can use the same companion; its real host still requires acceptance.
- Participating remote work: persistent workspace identity (one fixed approved project and source, 30 days) can create separate 24-hour task identities. Each task has its own random token, ordered checkpoints, terminal state and revocation. Evidence expires after 120 seconds. One source/task ending cannot end another. A running remote task never proves human presence.
- GitHub: only catalog-mapped public push/PR/release event kinds, approved project names, time and official repository URL. Commit messages, authors and task titles are never projected. History never establishes active coding. Reuses the existing five-minute GitHub provider cache, cooldown and failure classification. Account-wide event sampling may be delayed or incomplete.
- Spotify: the existing account-level PKCE OAuth, encrypted D1 credentials, refresh rotation leases, 60-second provider cache, rate-limit cooldown and independent consent are retained. Adds bounded progress/duration metadata. Original artwork, Spotify attribution and links remain. Local progress stops at duration or evidence expiry. Paused/204/private/ad playback clears current track. Playback alone cannot establish development activity. No audio playback.
- GPT: the homepage is disconnected with scope personal Work/Codex. No supported authorized website feed has been verified. Historical profile captures remain dated, owner-published estimates in `/gpt/`. Existing opt-in observation bridge remains separately gated and is not promoted as an independently verified provider total.

## Participating runner connection

Open `/owner/presence/` through the existing Cloudflare Access boundary, then **Connected workspaces**. Choose the trusted environment and an approved public project, connect, and save the one-time displayed token into that runner's private secret settings as `DEVON_ACTIVITY_SOURCE_TOKEN`. It is source/project scoped and has no owner, Spotify, GPT or database privileges. Copy/hide works on phones and credentials clear when the page is hidden. Do not save this credential in source, issues, chats or public logs.

Instrument the runner's normal execution once:

```sh
node scripts/activity-run.mjs -- npm test
```

The wrapper starts a separate task, emits throttled checkpoints only when the real child process produces output, then completed/failed/cancelled on exit. No output contents leave the runner; no timer fabricates activity for silent commands. Telemetry failure cannot prevent the requested command. Commands longer than two minutes without observable progress become stale. Repository origin metadata is matched locally to the fixed public catalog and checked against source scope before any task is created. Unknown repositories do not report. Source metadata binds project selection when no Git metadata is available. For one runner shared across projects, `DEVON_ACTIVITY_SOURCE_TOKENS` may hold a private JSON map of approved project slug to its source token; the wrapper selects the correct credential automatically and removes both credential variables from the child environment. Ordinary runs need no repeated pairing or manual project choice. A participating Work/Codex runner can invoke the same wrapper; there is no verified provider-wide background hook for arbitrary conversations/tasks. This session did not install a credential into such a runner.

## Trusted GitHub Actions reporter (opt-in private acceptance)

The existing `Verify website` workflow now invokes the in-repository task wrapper only on a push to `main`. It reads the owner-provisioned `DEVON_ACTIVITY_SOURCE_TOKEN` GitHub Actions repository secret for that one step and runs the real `npm test` command. The wrapper restricts repository/project identity to the fixed allowlist, never sends test logs/commands as telemetry, and strips the credential from the child process environment. All pull requests and non-main branch pushes still run `npm test` with **no** reporter secret. Both paths have an automated workflow-gating regression test.

The reporter creates a fixed-field private task on the existing site and emits a verified terminal test result. Very short CI executions may finish before any 30-second progress checkpoint; the final private signal expires 120 seconds after its timestamp. The token is stored only as a GitHub Actions secret, never in the repository, website JavaScript, artifacts, or logs. If the secret is absent or rejected, the CI tests still execute normally and the reporter logs a generic unavailable message. The owner's private Connected workspaces preview is the acceptance surface; a successful CI run alone does not prove the task was accepted by the Worker. The first trusted main run after merge plus the private owner preview or safe server-side row counts should confirm the connection before labeling it integrated.

This does **not** install a universal GitHub/ChatGPT agent observer or enable public sharing. All release/owner/project gates stay unchanged; the optional source can be revoked from the existing owner page.

## API and retention

- `GET/HEAD /api/activity/v4`: same-origin, no-store aggregate, no credentials. Fresh editor, independent tasks, permitted Spotify, catalog history and disconnected GPT contract. Existing endpoints remain compatible.
- `GET/POST/DELETE /api/presence/owner?channel=tasks`: Access-owner boundary plus same-origin mutations. Lists sanitized source metadata and private projections; creates sources, toggles source publication, revokes source or task. Creation is bounded to 32 sources.
- `POST /api/activity/tasks/start`: source bearer token; returns an independent task token; 64-task storage cap and 20-second source start cooldown.
- `POST /api/activity/tasks/signal`: task bearer token; fixed keys/enums, timestamps, sequence, CAS and 20-second nonterminal update cooldown. Terminal tasks cannot restart. State writes fence source revision and global generation.

Credential hashes only, no provider IDs or free text. Expired/revoked/generation-invalid reporter metadata is removed opportunistically. Tasks expire after at most 24 hours and sources after 30 days. Expired task rows may remain inert until the next source connection or task start; storage remains capped. Global stop invalidates reporter generation, clears disclosure and fences delayed responses. Private mode remains in effect until explicitly cleared. Each public source also requires existing global approval, owner opt-in, source approval and project allowlist. Deployment does not turn those gates on.

## Migration, backup and rollback

`0007_activity_tasks.sql` creates two dedicated tables and one index. It does not modify existing Spotify, editor or cloud singleton data. Before applying: inspect the active serving Worker binding, ensure it is the dedicated private D1 with replication off, obtain a Time Travel bookmark, verify migrations 0001–0006 and take boolean-only connection/privacy state counts. Apply the SQL once and register the exact filename in `d1_migrations` within the reviewed migration operation. Verify table SQL, counts and original connection/gate booleans afterward. Never copy OAuth ciphertext into logs.

Application rollback: redeploy the previous fully bound serving Worker version through the established production procedure. Leave the additive tables in place; old code does not reference them. No down migration or data deletion is needed. Revoke new sources before rollback if any have been paired. Time Travel restore is a recovery operation requiring review because restoring the whole database can rewind Spotify credentials; it is not the normal rollback path.

## Official GPT reporting investigation (November 6, 2026)

- https://learn.chatgpt.com/docs/enterprise/analytics-api — unified Daily Usage Analytics API reports daily workspace ChatGPT/Codex/Work aggregates; workspace-scoped Admin key needs `enterprise.analytics.usage.read` and endpoint enablement. It is not a universal lifetime personal profile feed. Use the Admin API reference for the exact enabled contract before implementing an adapter.
- https://help.openai.com/en/articles/20001478-reviewing-work-and-codex-usage-and-using-personal-analytics-in-chatgpt-desktop — eligible Enterprise/Edu personal analytics and in-app Work/Codex usage views, with scope/reporting-delay qualifications. Regular Chat is excluded from those Work/Codex views. This is not evidence of an authorized external personal publication API.
- API Platform organization usage, workspace daily aggregates, personal Work/Codex credits and token counts are different categories. Never add them together silently. No relevant authorized OpenAI analytics credential or first-party usage tool is present in this session. No protected screen scraping or private backend endpoint is used.

Resolution for an automatic GPT adapter: confirm an eligible workspace and enabled endpoint, provision its least-privilege read-only Admin key in server-side secrets, approve a specific personal/aggregate public metric scope, inspect the official current schema, then implement/test its actual daily cadence and timestamp. Until then the honest state is disconnected. Existing optional manual observation imports require their own unchanged gates.

## Release verification

Source checks, real SQLite concurrency/auth/privacy tests, participating-runner tests, responsive browser/axe acceptance and CI must pass on the PR head before merge. Production deploy remains the manual exact-main-SHA GitHub Actions workflow and preserves active private bindings with all disclosure gates off. Check actual `/_health` SHA and Cloudflare 100%-serving version, public V4 no-store projection and unauthenticated owner denial. Real Spotify playback and editor/remote-host pairing remain separate authenticated acceptance steps; fixture tests are not account integration evidence. Physical iPhone testing is not replaced by desktop WebKit.
