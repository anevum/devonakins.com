# AI-assisted engineering instructions — devonakins.com

These instructions apply to work in this repository. Follow project-specific rules and the existing workflows; this file does not authorize deployment or access to another project.

## Before changing source
- Inspect the current main branch, target issue/PR, relevant source, existing tests, and deployment workflow.
- Record the intended user outcome, smallest change, non-goals, and checks before generating code.
- Distinguish source changes, local verification, exact-commit CI, and verified production behavior. Never equate them.
- Do not regenerate or replace working applications to satisfy a narrow task.

## Implement and challenge
- Keep patches small. Prefer existing dependencies, patterns, and accessible UI components.
- Write or identify independent negative cases before relying on AI-generated tests. Include authorization and privacy cases when code touches those boundaries.
- Run available checks for changed behavior: `npm run build`, `npm test`, and applicable browser/accessible-device checks. Report exact commands and results; say when a check was not run.
- Inspect diff, generated assets, and public content for secrets, personal data, unauthorized third-party materials, licensing, and unintentional feature changes.
- Explain one input-to-output path, critical invariants, likely failure mode, and a rollback before claiming readiness for consequential changes.

## Review and release
- Describe the PR using `.github/PULL_REQUEST_TEMPLATE.md` and preserve unknowns honestly. The AIEI review-contract check validates format, not whether the claims are true.
- GitHub review, tests, and any AIEI audit are evidence; none is a substitute for human release authority.
- Do not merge, publish, purchase services, change DNS, modify secrets, or initiate Cloudflare deployments without the appropriate authorization and verified gates.
- This repository owns only the personal website. DevonStation, Anevum, and business or clinical systems remain separate.

## Durable handoff
- Link the PR/commit, key evidence, unresolved risks, and next action in the existing owning Notion/GitHub record when substantive. Do not create a duplicate tracker.