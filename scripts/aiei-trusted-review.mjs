/**
 * Base-branch-only AIEI checker. Its workflow must run this file from trusted
 * main, NEVER from a candidate PR. The PR body and GitHub API file list are
 * data only: no candidate checkout, dynamic imports, shell, or eval.
 *
 * This is a structural review gate, not a claim that test evidence is true.
 */
import {readFileSync} from 'node:fs';
import {validateContract, minimumPathRisk} from './aiei-pr-contract.mjs';

const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_FILES = 2999; // GitHub's changed-file API can truncate at 3000.

function insist(condition, message) {
  if (!condition) throw new Error(message);
}

function sameRevision(a, b) {
  return a?.head?.sha === b?.head?.sha && a?.base?.sha === b?.base?.sha &&
    a?.body === b?.body && a?.updated_at === b?.updated_at &&
    a?.changed_files === b?.changed_files;
}

/** Testable core; apiGet is a trusted transport returning parsed GitHub JSON. */
export async function evaluateTrustedReview({event, repository, apiGet}) {
  insist(event && typeof event === 'object', 'Missing GitHub pull-request event.');
  insist(REPO.test(repository || '') && event.repository?.full_name === repository,
    'Event repository does not match the trusted runner.');
  const number = event.number;
  insist(Number.isSafeInteger(number) && number > 0 &&
    number === event.pull_request?.number, 'Invalid pull-request number.');
  const eventHead = event.pull_request?.head?.sha;
  insist(SHA.test(eventHead || ''), 'Event lacks an exact candidate head SHA.');
  insist(typeof apiGet === 'function', 'Missing trusted GitHub API transport.');

  const root = `/repos/${repository}/pulls/${number}`;
  const pr = await apiGet(root);
  insist(pr?.number === number && pr?.state === 'open', 'Current pull request is unavailable or closed.');
  insist(pr.base?.repo?.full_name === repository &&
    pr.base.ref === event.repository?.default_branch,
    'Pull-request base is not the repository default branch.');
  insist(SHA.test(pr.base?.sha || '') && SHA.test(pr.head?.sha || ''),
    'Current pull request has invalid commit SHAs.');
  insist(pr.head.sha === eventHead, 'Candidate head changed after this event; refusing stale approval.');
  insist(Number.isSafeInteger(pr.changed_files) && pr.changed_files > 0 &&
    pr.changed_files <= MAX_FILES, 'Changed-file count is missing, zero, or exceeds safe API coverage.');

  const paths = [];
  let listed = 0;
  for (let page = 1; listed < pr.changed_files; page++) {
    insist(page <= 30, 'Changed-file pagination exceeded maximum.');
    const files = await apiGet(`${root}/files?per_page=100&page=${page}`);
    insist(Array.isArray(files) && files.length > 0 && files.length <= 100,
      'GitHub returned an incomplete or invalid changed-file page.');
    listed += files.length;
    insist(listed <= pr.changed_files, 'Changed-file API returned more entries than declared.');
    for (const file of files) {
      insist(typeof file?.filename === 'string' && file.filename.length > 0 &&
        !file.filename.includes('\0'), 'Invalid changed file path.');
      paths.push(file.filename);
      if (file.status === 'renamed') {
        insist(typeof file.previous_filename === 'string' && file.previous_filename.length > 0 &&
          !file.previous_filename.includes('\0'), 'Renamed file lacks its original path.');
        paths.push(file.previous_filename);
      }
    }
    if (files.length < 100) break;
  }

  // GitHub caps results at 3000 entries. Renames add original paths only for
  // risk checks; the API count is still based on changed file entries.
  insist(listed === pr.changed_files, 'Changed-file API result does not match the PR file count.');
  const after = await apiGet(root);
  insist(sameRevision(pr, after), 'Pull request changed during validation; rerun at the new event.');

  const report = validateContract(pr.body, paths);
  return { ...report, headSha: pr.head.sha, minimumRisk: `R${minimumPathRisk(paths)}`,
    changedFiles: listed };
}

async function githubGet(path) {
  const token = process.env.GH_TOKEN;
  insist(typeof token === 'string' && token.length > 0, 'Missing read-only GitHub API token.');
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'},
    signal: AbortSignal.timeout(15000),
  });
  insist(response.ok, `GitHub API returned HTTP ${response.status}; review fails closed.`);
  return response.json();
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    insist(process.env.GITHUB_EVENT_NAME === 'pull_request_target',
      'Trusted review must run from the base-branch pull_request_target event.');
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const result = await evaluateTrustedReview({event,
      repository: process.env.GITHUB_REPOSITORY, apiGet: githubGet});
    if (!result.ok) {
      for (const error of result.errors) console.error(`AIEI trusted review: ${error}`);
      process.exitCode = 1;
    } else {
      console.log(`AIEI trusted format check passed at ${result.headSha}; minimum ${result.minimumRisk}, ${result.changedFiles} files.`);
      console.log('This does NOT validate evidence truth, source security, human approval, or deployment.');
    }
  } catch (error) {
    console.error(`AIEI trusted review failed closed: ${error.message}`);
    process.exitCode = 1;
  }
}
