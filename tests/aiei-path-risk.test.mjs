import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {minimumPathRisk, validateContract} from '../scripts/aiei-pr-contract.mjs';

const body=(tier='R1')=>`## Purpose\nShip a small bounded technical change with clear acceptance criteria.\n\n## Scope and boundaries\nChanges are limited to this repository and have no authorized production side effects.\n\n## Risk tier\n${tier}\n\n## Acceptance evidence\nLocal Node tests were run; remote GitHub Actions CI and production are not verified.\n\n## Negative cases\nWe tested a deliberately misclassified change to guard code and verified that it was rejected.\n\n## Risks and unknowns\nRemote CI has not run and the owner has not approved merging or deploying this candidate.\n\n## Release intent\nREVIEW_ONLY`;

const expectRisk=(path,level)=>assert.equal(minimumPathRisk([path]),level,path);
test('documentation-only change has R0 floor',()=>expectRisk('README.md',0));
test('UI and ordinary scripts have R1 floor',()=>{expectRisk('src/main.ts',1);expectRisk('tests/ui.test.mjs',1);});
test('worker code, SQL migration and dependency lock have R2 floor',()=>{
 for(const p of ['worker/mail.mjs','migrations/0002.sql','package-lock.json'])expectRisk(p,2);
});
test('policy, actions, deployment, security, and AIEI guards have R3 floor',()=>{
 for(const p of ['.github/workflows/verify.yml','.github/CODEOWNERS','.github/PULL_REQUEST_TEMPLATE.md','AGENTS.md','wrangler.jsonc','scripts/aiei-pr-contract.mjs','tests/aiei-path-risk.test.mjs','scripts/security/scanner.py','src/auth/session.ts','.env.production','LICENSE','package.json']) expectRisk(p,3);
});
test('rejects understated risk for guard and CI changes',()=>{
 for(const tier of ['R0','R1','R2']) {
  const v=validateContract(body(tier),['.github/workflows/aiei-review-contract.yml']);
  assert.equal(v.ok,false);
  assert(v.errors.some(x=>x.includes(`Risk tier ${tier} understates`)));
 }
});
test('accepts correctly declared high risk without treating review intent as publication',()=>{
 assert.deepEqual(validateContract(body('R3'),['.github/workflows/aiei-review-contract.yml']),{ok:true,errors:[]});
});
test('highest changed-path floor applies; documentation cannot disguise code',()=>{
 const v=validateContract(body('R1'),['README.md','worker/mail.mjs','.github/PULL_REQUEST_TEMPLATE.md']);
 assert.equal(v.ok,false);
 assert(v.errors.some(x=>x.includes('R3')));
});
test('rejects malformed changed paths in independent API',()=>{
 assert.throws(()=>minimumPathRisk('README.md'),TypeError);
 assert.throws(()=>minimumPathRisk([null]),TypeError);
 assert.throws(()=>minimumPathRisk(['']),TypeError);
});
test('risk path checker workflow uses full-history, trusted SHA inputs and no secrets',()=>{
 const yml=readFileSync(new URL('../.github/workflows/aiei-review-contract.yml',import.meta.url),'utf8');
 assert.match(yml,/fetch-depth: 0/);
 assert.match(yml,/AIEI_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
 assert.match(yml,/AIEI_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
 assert.doesNotMatch(yml,/pull_request_target:/);
 assert.doesNotMatch(yml,/secrets\./);
 assert.match(yml,/persist-credentials: false/);
});

test('CLI inspects real Git diff and fails closed on understated risk or missing SHA',()=>{
 const dir=mkdtempSync(join(tmpdir(),'aiei-risk-test-'));
 const source=fileURLToPath(new URL('../scripts/aiei-pr-contract.mjs',import.meta.url));
 const git=(...a)=>execFileSync('git',a,{cwd:dir,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.invalid'}}).trim();
 try {
  git('init','-q');
  writeFileSync(join(dir,'README.md'),'Base state\n');
  git('add','.');git('commit','-qm','base');
  const base=git('rev-parse','HEAD');
  mkdirSync(join(dir,'.github/workflows'),{recursive:true});
  writeFileSync(join(dir,'.github/workflows/guard.yml'),'name: guard\n');
  git('add','.');git('commit','-qm','change security control');
  const head=git('rev-parse','HEAD');
  const run=(risk,envOverride={})=>spawnSync(process.execPath,[source],{cwd:dir,encoding:'utf8',env:{...process.env,AIEI_PR_BODY:body(risk),AIEI_BASE_SHA:base,AIEI_HEAD_SHA:head,...envOverride}});
  const understated=run('R0');
  assert.notEqual(understated.status,0);
  assert.match(understated.stderr,/understates changed-file minimum R3/);
  const valid=run('R3');
  assert.equal(valid.status,0,valid.stderr);
  const noSha=run('R3',{AIEI_BASE_SHA:''});
  assert.notEqual(noSha.status,0);
  assert.match(noSha.stderr,/40-character commit hashes/);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
