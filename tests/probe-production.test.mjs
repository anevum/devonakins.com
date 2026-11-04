import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeProduction, verifySourceAncestry } from '../scripts/probe-production.mjs';

const expectedCommit = '3'.repeat(40);
const origin = 'https://devonakins.com';
const fixtures = {
  '/_health': { code: 200, type: 'application/json', body: JSON.stringify({ site: 'devonakins.com', version: '1.2.4', commit: expectedCommit }) },
  '/': { code: 200, type: 'text/html', body: '<a href="/work/merit/">Merit</a><a href="/work/rhen-language/">Rhen</a>' },
  '/work/merit/': { code: 200, type: 'text/html', body: '<link rel="canonical" href="https://devonakins.com/work/merit/">Merit' },
  '/work/rhen-language/': { code: 200, type: 'text/html', body: '<link rel="canonical" href="https://devonakins.com/work/rhen-language/">Rhen is not a released compiler' },
  '/work/rhen/': { code: 200, type: 'text/html', body: '<link rel="canonical" href="https://devonakins.com/work/rhen/">RHEN — Market Research' },
  '/work/aiei/?from=release-probe': { code: 308, type: '', redirect: 'https://devonakins.com/work/merit/?from=release-probe' },
  '/work/isl/?from=release-probe': { code: 308, type: '', redirect: 'https://devonakins.com/work/rhen-language/?from=release-probe' },
};
function mock(overrides = {}) {
  const data = { ...fixtures, ...overrides };
  const seen = [];
  const fetchImpl = async (url, options) => {
    assert.ok(url.startsWith(origin + '/'));
    assert.equal(options.redirect, 'manual');
    seen.push(url);
    const x = data[url.slice(origin.length)];
    if (!x) throw new Error('Unknown fixture');
    return new Response(x.body || null, {
      status: x.code,
      headers: {
        ...(x.type ? { 'content-type': x.type } : {}),
        ...(x.redirect ? { location: x.redirect } : {}),
        ...(url === origin + '/' ? { 'content-security-policy': "default-src 'self'", 'x-content-type-options': 'nosniff' } : {}),
      },
    });
  };
  return { fetchImpl, seen };
}
test('fixed-origin observations validate health, home, canonical pages and query-preserving redirects', async () => {
  const { fetchImpl, seen } = mock();
  const result = await probeProduction({ fetchImpl, expectedCommit });
  assert.equal(result.observation, 'LIVE_HTTP_VERIFIED');
  assert.equal(result.checks.length, 7);
  assert.equal(seen.length, 7);
});
test('reject stale deployment source commit', async () => {
  const { fetchImpl } = mock();
  await assert.rejects(probeProduction({ fetchImpl, expectedCommit: '4'.repeat(40) }), /does not match expected source/);
});
test('reject malformed caller commit and deployed health commit', async () => {
  const { fetchImpl } = mock();
  await assert.rejects(probeProduction({ fetchImpl, expectedCommit: 'not-a-sha' }), /40 lowercase/);
  const x = { ...fixtures['/_health'], body: '{"site":"devonakins.com","version":"1.2.4","commit":"invalid"}' };
  await assert.rejects(probeProduction({ fetchImpl: mock({ '/_health': x }).fetchImpl }), /release must expose/);
});
test('reject missing canonical metadata, missing language disclosure and incorrect market identity', async () => {
  for (const [path, body] of [
    ['/work/merit/', 'Merit'],
    ['/work/rhen-language/', '<link rel="canonical" href="https://devonakins.com/work/rhen-language/">Rhen'],
    ['/work/rhen/', '<link rel="canonical" href="https://devonakins.com/work/rhen/">Rhen language'],
  ]) {
    const x = { ...fixtures[path], body };
    await assert.rejects(probeProduction({ fetchImpl: mock({ [path]: x }).fetchImpl }), /canonical|maturity disclosure|expected identity/);
  }
});
test('reject incorrect redirect, missing CSP and oversized response', async () => {
  await assert.rejects(probeProduction({ fetchImpl: mock({ '/work/isl/?from=release-probe': { ...fixtures['/work/isl/?from=release-probe'], redirect: 'https://evil.test/path' } }).fetchImpl }), /query-preserving redirect/);
  const old = mock().fetchImpl;
  const noCsp = async (url, options) => {
    const response = await old(url, options);
    if (url === origin + '/') return new Response(await response.text(), { headers: { 'content-type': 'text/html' } });
    return response;
  };
  await assert.rejects(probeProduction({ fetchImpl: noCsp }), /default-src/);
  const huge = { ...fixtures['/'], body: 'X'.repeat(2_097_153) };
  await assert.rejects(probeProduction({ fetchImpl: mock({ '/': huge }).fetchImpl }), /size limit/);
});
test('source ancestry checks require exact known committed SHA', () => {
  const calls = [];
  const run = (...args) => { calls.push(args); };
  assert.equal(verifySourceAncestry(expectedCommit, 'HEAD', run), true);
  assert.deepEqual(calls.map(x => x[1][0]), ['cat-file', 'merge-base']);
  assert.throws(() => verifySourceAncestry('invalid', 'HEAD', run));
});
