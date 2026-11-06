# GPT observation bridge — source-only release candidate

**Status:** Opt-in backend and browser projection; disabled by default. No personal ChatGPT source, Cloudflare namespace, secret, or public disclosure has been authorized or configured by this code. It is not a live ChatGPT API integration.

## Source and limits

The optional integration uses the existing DevonAkins.com Worker and a **single record** in a future, separately approved Cloudflare Workers KV namespace. The last authorized Work/Codex credits observation can remain readable when the laptop is off, but **no new observations are collected while the source is offline**. All source timestamps are truthful; OpenAI's actual update time remains unknown.

OpenAI Work/Codex Usage & billing typically refreshes about once per minute and excludes regular Chat. Personal Analytics is an in-product read-only plugin, not a documented third-party account-wide export API. Documentation: https://help.openai.com/en/articles/20001478-reviewing-work-and-codex-usage-and-using-personal-analytics-in-chatgpt-desktop

The historical November 4 token snapshot, GitHub events and Spotify remain separate. Nothing in this implementation changes them.

## Runtime gates (not configured by this PR)

| Route | Method | Required conditions |
| --- | --- | --- |
| /api/gpt-observation/ingest | POST | KV binding, GPT_USAGE_WRITE_ENABLED=true, high-entropy GPT_USAGE_INGEST_SECRET |
| /api/gpt-observation/latest | GET, HEAD | KV binding, GPT_USAGE_READ_ENABLED=true |

Unconfigured routes return 404. The read gate is separate because making a personal usage amount publicly visible is a disclosure requiring owner approval. No bindings are added to wrangler.jsonc, no secrets set, and no production changes performed.

Before enablement, separately review a dedicated KV namespace and Worker binding named GPT_USAGE_STORE, a 32+ character randomly generated Cloudflare secret, public-versus-private metric disclosure approval, a single consented upload client with local credential storage, a revocation/deletion path, and a testable rollback. The upload client and public authorization flow are **not implemented**.

## Strict observation format

A write accepts exactly these fields (synthetic example, NOT actual account values):

    {
      "version": 1,
      "metric": "work_codex_credits_remaining",
      "value": 42.5,
      "unit": "credits",
      "source": "user-selected-visible-usage-text",
      "scope": "work-codex",
      "observedAt": "2026-11-06T12:00:00.000Z",
      "lastChangedAt": "2026-11-06T11:50:00.000Z",
      "sourceUpdatedAt": null
    }

Allowed metrics: Work/Codex credits used, credits remaining, percent used and percent remaining. No tokens, streaks, account IDs, emails, chat transcripts, URLs, screenshots, conversations, credentials, or device identifiers. Unexpected keys, invalid units, malformed/old/future observations, and oversized bodies are rejected. The server reconstructs the public response from approved fields only.

A Bearer secret is compared via constant-time digest matching. Requests have a 1024-byte body limit. All API responses use Cache-Control: no-store, and no cross-origin write permission is added.

## Refresh and storage

The visible site's *age label* updates every **5 seconds**, while its first-party endpoint is fetched every **60 seconds**. The server enforces a 5-minute minimum time between accepted writes to the same KV key and an observation no more than 15 minutes old on ingestion. A display labels readings older than 15 minutes **STALE**; it never extrapolates increased usage or calls the observation a provider-verified live update. The latest KV record expires after 30 days without a write, and there is no full-history database.

Cloudflare KV is eventually consistent. The monotonic check is not a globally atomic transaction, so this phase assumes one authorized writer. Cloudflare's current Free KV limits include 1,000 writes/day and 100,000 reads/day: https://developers.cloudflare.com/kv/platform/limits/ . Operations share account-level allowances; no zero-cost guarantee is made.

## Acceptance and open blocker

Tests must cover disabled gates, bad credentials, malformed/extra fields, replay and cooldown, stale projection, generic failure states, unchanged historic snapshot, and no public leakage. Browser tests use synthetic observations and check recent/stale/no-data states at mobile and desktop sizes. Full CI must pass before review, and no merge or deploy is implied by a passing test.

The real source remains unresolved. Draft PR #41 is a local browser-only probe; it has NOT demonstrated a real usage reading from this account or the native ChatGPT Desktop app. Do not authorize an uploader or public disclosure until the genuine source and owner consent are confirmed. See issue #36: https://github.com/devonalanakins/devonakins.com/issues/36 .
