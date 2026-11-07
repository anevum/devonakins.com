import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");

test("CI activity token is confined to trusted main pushes, never pull requests", () => {
  assert.match(workflow, /^on:\n  push:\n  pull_request:/m);
  assert.doesNotMatch(workflow, /pull_request_target|workflow_run:/);
  assert.match(workflow, /persist-credentials: false/);
  const reporting = workflow.match(
    /      - name: Test and report private CI activity \(trusted main push\)\n([\s\S]*?)(?=      - name:|\n\s*$)/,
  )?.[1];
  assert.ok(reporting, "expected dedicated guarded reporting step");
  assert.match(
    reporting,
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/,
    "only the trusted main push can receive the secret",
  );
  assert.match(
    reporting,
    /DEVON_ACTIVITY_SOURCE_TOKEN: \$\{\{ secrets\.DEVON_ACTIVITY_SOURCE_TOKEN \}\}/,
  );
  assert.match(reporting, /run: node scripts\/activity-run\.mjs -- npm test/);

  const fallback = workflow.match(
    /      - name: Test without reporter credentials \(PRs and other branches\)\n([\s\S]*?)(?=      - name:|\n\s*$)/,
  )?.[1];
  assert.ok(fallback, "expected ordinary credential-free tests for untrusted refs");
  assert.match(fallback, /if: github\.event_name != 'push' \|\| github\.ref != 'refs\/heads\/main'/);
  assert.match(fallback, /run: npm test/);
  assert.doesNotMatch(fallback, /secrets\.|DEVON_ACTIVITY_SOURCE_TOKEN|activity-run\.mjs/);
  assert.equal(
    (workflow.match(/secrets\.DEVON_ACTIVITY_SOURCE_TOKEN/g) || []).length,
    1,
    "reporter secret must be referenced by only one guarded workflow step",
  );
});
