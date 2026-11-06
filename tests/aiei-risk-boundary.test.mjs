import test from 'node:test';
import assert from 'node:assert/strict';
import { minimumPathRisk, validateContract } from '../scripts/aiei-pr-contract.mjs';

const contract = (tier) => [
  '## Purpose',
  'Classify changes to production-serving code and release trust boundaries.',
  '## Scope and boundaries',
  'This synthetic review contains no authorized changes to deployed services or production data.',
  '## Risk tier', tier,
  '## Acceptance evidence',
  'Independent regression tests check intended risk levels against the prior implementation.',
  '## Negative cases',
  'An understated risk tier must fail when the named source file controls deployment or serving.',
  '## Risks and unknowns',
  'This structural check does not certify source correctness or the truth of evidence claims.',
  '## Release intent', 'REVIEW_ONLY',
].join('\n\n');

for (const path of ['src/worker.mjs', 'src/worker.ts', 'src/worker/index.ts',
  'worker/main.mjs', 'functions/route.ts', 'api/send.ts']) {
  test(`backend serving path ${path} has at least R2 floor`, () => {
    assert.equal(minimumPathRisk([path]), 2);
  });
}
for (const path of ['scripts/build-worker.mjs', 'scripts/verify-live.mjs',
  '.github/actions/release/action.yml', '.github/dependabot.yml',
  'wrangler.toml', 'wrangler.json', 'wrangler.jsonc', 'vite.config.ts', 'package.json']) {
  test(`release/governance path ${path} has R3 floor`, () => {
    assert.equal(minimumPathRisk([path]), 3);
  });
}

test('a production Worker edit cannot be accepted as an R1 PR', () => {
  const report = validateContract(contract('R1'), ['src/worker.mjs']);
  assert.equal(report.ok, false);
  assert.match(report.errors.join(' '), /understates changed-file minimum R2/);
  assert.equal(validateContract(contract('R2'), ['src/worker.mjs']).ok, true);
});

test('editing deployment verifier or Worker builder cannot be accepted at R2', () => {
  for (const path of ['scripts/verify-live.mjs', 'scripts/build-worker.mjs']) {
    const report = validateContract(contract('R2'), [path]);
    assert.equal(report.ok, false, path);
    assert.match(report.errors.join(' '), /understates changed-file minimum R3/);
  }
});

test('highest floor applies across mixed documentation and critical code', () => {
  const report = validateContract(contract('R2'), ['README.md', 'src/worker.mjs', 'scripts/verify-live.mjs']);
  assert.equal(report.ok, false);
  assert.match(report.errors.join(' '), /minimum R3/);
});

test('retain proportional floors for documentation, UI, and dependency locks', () => {
  for (const path of ['README.md', 'docs/architecture.md', '.gitignore'])
    assert.equal(minimumPathRisk([path]), 0, path);
  for (const path of ['src/terminal.ts', 'tests/site.test.mjs', 'public/v2/terminal.css'])
    assert.equal(minimumPathRisk([path]), 1, path);
  assert.equal(minimumPathRisk(['package-lock.json']), 2);
});
