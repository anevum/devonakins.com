#!/usr/bin/env node
/** Read-only production observation. It cannot deploy or approve a release. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://devonakins.com';
const SHA = /^[a-f0-9]{40}$/;
const LIMIT = 2_097_152;

async function boundedText(response, limit = LIMIT) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) throw new Error('Response exceeds size limit');
  if (!response.body) throw new Error('Missing response body');
  const chunks = [];
  let used = 0;
  for await (const chunk of response.body) {
    used += chunk.byteLength;
    if (used > limit) throw new Error('Response exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, used).toString('utf8');
}

export async function probeProduction({ fetchImpl = fetch, expectedCommit = null } = {}) {
  if (expectedCommit !== null && !SHA.test(expectedCommit)) throw new Error('Expected commit must be 40 lowercase hexadecimal characters');
  const results = [];
  async function request(path, expectedStatus, contentType) {
    const response = await fetchImpl(ORIGIN + path, {
      redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, expectedStatus, `${path}: unexpected status`);
    if (contentType) assert.match(response.headers.get('content-type') || '', contentType, `${path}: content type`);
    results.push({ path, status: response.status });
    return response;
  }
  const health = await request('/_health', 200, /application\/json/i);
  const healthData = JSON.parse(await boundedText(health, 65536));
  assert.equal(healthData.site, 'devonakins.com');
  assert.match(healthData.version, /^\d+\.\d+\.\d+$/);
  assert.match(healthData.commit, SHA, 'release must expose its exact source commit');
  if (expectedCommit) assert.equal(healthData.commit, expectedCommit, 'active release does not match expected source');

  const homeResponse = await request('/', 200, /text\/html/i);
  assert.match(homeResponse.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.equal(homeResponse.headers.get('x-content-type-options'), 'nosniff');
  const home = await boundedText(homeResponse);
  for (const href of ['/work/merit/', '/work/rhen-language/']) {
    assert.ok(home.includes(`href="${href}"`), `homepage missing ${href}`);
  }
  for (const [path, marker] of [
    ['/work/merit/', /Merit/],
    ['/work/rhen-language/', /Rhen/],
    ['/work/rhen/', /RHEN — Market Research/],
  ]) {
    const response = await request(path, 200, /text\/html/i);
    const html = await boundedText(response);
    assert.ok(html.includes(`rel="canonical" href="${ORIGIN}${path}"`), `${path}: canonical`);
    assert.match(html, marker, `${path}: expected identity`);
    if (path === '/work/rhen-language/') {
      assert.match(html, /not a released compiler/i, 'language maturity disclosure');
    }
  }
  for (const [oldSlug, currentSlug] of [['aiei', 'merit'], ['isl', 'rhen-language']]) {
    const response = await request(`/work/${oldSlug}/?from=release-probe`, 308);
    assert.equal(response.headers.get('location'), `${ORIGIN}/work/${currentSlug}/?from=release-probe`, 'query-preserving redirect');
  }
  return {
    observation: 'LIVE_HTTP_VERIFIED',
    caveat: 'HTTP response identity and content only; not independent review of source, signing or deployment authorization',
    release: { version: healthData.version, commit: healthData.commit },
    checks: results,
  };
}

export function verifySourceAncestry(commit, head = 'HEAD', exec = execFileSync) {
  assert.match(commit, SHA, 'invalid deployed source commit');
  exec('git', ['cat-file', '-e', `${commit}^{commit}`], { stdio: 'pipe' });
  exec('git', ['merge-base', '--is-ancestor', commit, head], { stdio: 'pipe' });
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const expectedCommit = process.env.EXPECTED_RELEASE_COMMIT || null;
    const result = await probeProduction({ expectedCommit });
    if (process.env.CHECK_SOURCE_ANCESTRY === '1') verifySourceAncestry(result.release.commit);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Production observation failed: ' + error.message);
    process.exitCode = 1;
  }
}
