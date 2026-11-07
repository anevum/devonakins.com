# Participating cloud-task presence

One cloud task can report a reviewed public project and a small progress state
without a laptop, editor extension, screen capture, or conversation access.
Human sessions and Spotify remain independent. This bridge is **task-reported**,
not a provider-wide activity monitor or independent test-verification service.

## Connect privately

1. Sign in at `/owner/presence/` using the existing owner Access policy.
2. Under Cloud work, select Codex or ChatGPT Work and create a pairing code.
   This invalidates the previous task and resets cloud sharing to off.
3. In the trusted participating cloud workspace, run
   `node scripts/cloud-presence.mjs pair`. Supply the code on stdin and end input.
   Never put codes in prompts, source, command arguments, logs, or GitHub.
4. Send explicit checkpoints when work starts or actually changes:

   ```sh
   node scripts/cloud-presence.mjs signal running --project=mizvo
   node scripts/cloud-presence.mjs signal running --project=mizvo --checkpoint=testing
   node scripts/cloud-presence.mjs signal waiting --project=mizvo
   node scripts/cloud-presence.mjs signal completed --project=mizvo --checkpoint=tests-passed
   ```

   Repeated same-state checkpoints have a 20-second cooldown. Waiting and
   terminal events can interrupt running immediately. `tests-passed` is a task
   report; retain real test evidence in the normal engineering record.
5. Refresh task in the private dashboard. It works while public sharing is off.
   Disconnect there to revoke the token. The reporter's `forget` command only
   removes its local credential.

The Node 22+ reporter stores a 0600 credential file in the user's private state
directory. `DEVON_PRESENCE_FILE` selects a task-specific private path; keep it
outside repositories and shared artifacts. Concurrent invocations on the same
file fail rather than race. An interrupted process may leave `.lock`/`.new`
files for owner review; never remove another running process's lock.
Success output and fixed CLI errors contain no credentials. Pairing lasts 24
hours; its code expires in five minutes and can be claimed once. Pair a new
task after completion, failure, or cancellation.

The reporter sends **only when invoked**. It does not run a background timer,
infer success from an idle process, intercept conversations, fetch account task
lists, or add hooks to other repositories. Calls must be wired into a trusted
participating workflow. This release does not automatically connect every
existing ChatGPT or Codex conversation. Reporter failure must not stop the
engineering task. After ambiguous delivery, send the current genuine state
again; reserved increasing sequences prevent replay of old events.

## Contract and privacy

`POST /api/presence/cloud/claim` accepts exactly `{pairCode}`. It returns the
short-lived credential only to the paired client. Only its hash is stored in
D1. The credential cannot access owner controls or Spotify.

`POST /api/presence/cloud/signal` requires the bearer token and exactly:

```json
{"version":1,"sequence":1,"state":"running","checkpoint":null,"projectSlug":"mizvo","observedAt":"2026-11-07T02:00:00.000Z"}
```

States: running, waiting, completed, failed, cancelled. Checkpoints: null,
testing, tests-passed, building, reviewing. Projects: null or an existing
owner-approved public slug. No free-text titles, task/account IDs, prompts,
paths, repositories, transcripts, code, or error messages are accepted.
Unknown fields and noncanonical/stale/future timestamps fail closed.

Source is chosen during owner-authenticated pairing, never by an event.
It identifies the reporter; it does not attest that an OpenAI server verified
the report. The first event must be running. Sequences must increase; SQL CAS
rejects concurrent stale writes. A finished task cannot silently restart.

Signals expire two minutes after observation, capped by token expiry. Receiving
an old event does not extend its lifetime. The browser independently expires
signals. Missing evidence becomes unknown or no current signal. A task report
never proves the owner is at the screen or actively typing.

Owner operations reuse `/api/presence/owner?channel=cloud`, already covered by
the existing Access path. Writes also require same-origin proof. The public
`/api/presence/cloud` projection is no-store and requires the existing presence
release approval, global presence opt-in, cloud-task sharing opt-in, and no
Work privately override. Project removals apply immediately. Stop all
broadcasting invalidates task pairing through the existing generation counter,
even after sharing is enabled again. In-flight reads/writes are fenced against
stop, re-pairing, and disconnect.

## Delivery and rollback

Migration `0006_cloud_presence.sql` adds one singleton table to the existing
private D1. It does not alter Spotify, human sessions, editor credentials, or
flags. Apply the reviewed migration before the exact-SHA Worker release and
record its name in `d1_migrations`. No new service, domain, binding, provider
credential, Access policy, or paid API is required. An unapplied migration gives
an unavailable private cloud panel and hidden public response; existing controls
continue working.

Rollback uses the previously recorded configured Worker version. The old Worker
ignores the added table; retain it rather than deleting data. Public disclosure
stays off unless separately approved. Real cloud-workspace pairing and account
polling are separate acceptance items from SQLite/handler/reporter/browser tests.

[Official Codex cloud commands](https://learn.chatgpt.com/docs/cli/reference)
describe a possible future list/status adapter. Its account authorization and
status mapping are unvalidated here. No account-wide polling or general
ChatGPT typing feed is claimed.
