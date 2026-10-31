# Targeted Git history credential check

The existing website verification workflow runs a **non-deploying** Git history
credential guard before the Node build and tests. It uses the synthetic tests
and selected credential patterns already proven in `anevum/brandle`.

The workflow checks out full Git history and explicitly fetches current remote
branch heads before scanning text blobs reachable from local refs. A match
fails verification and reports only its Git object ID and detection rule;
the matched value is **never printed**.

Run locally from a clone with all remote heads fetched:

```sh
git fetch --no-tags origin '+refs/heads/*:refs/remotes/origin/*'
python3 -m unittest scripts/security/test_scan_git_history.py
python3 scripts/security/scan-git-history.py
```

## Scope and limitations

- This is **not** a comprehensive secrets, privacy or patient-data audit.
  Only eight selected credential-format patterns in text Git blobs are checked.
- Binary blobs, unknown formats, unreachable/dangling objects and refs that
  were not fetched are **not** covered; remote branches deleted before a scan
  are not recovered by the workflow.
- The checks report potential matches, not credential validity. If a real
  credential is discovered, rotate or revoke it through a private incident
  process; do not paste values or private data into public issues, PRs or logs.
- A passing check does **not** authorize Cloudflare deployment. Production
  remains under the existing separately controlled release process.
- The scanner and tests are copied from `anevum/brandle`, licensed
  Apache-2.0; see `scripts/security/LICENSE`. The personal website remains
  MIT-licensed under its root license, except this explicitly licensed tool.

This job changes repository verification only. It does not change the Worker,
Cloudflare settings, live domains, protected data or deployment automation.
