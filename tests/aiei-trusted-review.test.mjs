import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateTrustedReview} from '../scripts/aiei-trusted-review.mjs';

const repo='devonalanakins/devonakins.com';
const sha='a'.repeat(40), base='b'.repeat(40);
const body=(risk='R3')=>[
 '## Purpose','Ensure trusted review cannot execute candidate validation code.',
 '## Scope and boundaries','Only process automation changes; no production deployment is authorized.',
 '## Risk tier',risk,
 '## Acceptance evidence','Synthetic local tests exercised successful reviews and deliberately malformed GitHub API responses.',
 '## Negative cases','Checker tampering, incomplete descriptions, stale revisions, and missing file data must fail.',
 '## Risks and unknowns','Candidate evidence is not verified, and branch protection requires explicit authorization.',
 '## Release intent','REVIEW_ONLY',
].join('\n\n');
const event=()=>({number:18,repository:{full_name:repo,default_branch:'main'},pull_request:{number:18,head:{sha}}});
const pr=(patch={})=>({number:18,state:'open',head:{sha},base:{sha:base,ref:'main',repo:{full_name:repo}},body:body(),changed_files:1,updated_at:'2026-11-03T22:00:00Z',...patch});
function run({snapshot=pr(),files=[{filename:'scripts/aiei-pr-contract.mjs',status:'modified'}],later,apiError=false,e=event()}={}) {
 let reads=0;
 const apiGet=async path=>{
  if(apiError) throw Error('API unavailable');
  if(path.endsWith('/files?per_page=100&page=1')) return structuredClone(files);
  if(path.endsWith('/pulls/18')) return structuredClone(++reads===1?snapshot:(later??snapshot));
  throw Error('Unexpected API route');
 };
 return evaluateTrustedReview({event:e,repository:repo,apiGet});
}
test('valid review passes structural checks without release approval',async()=>{
 const r=await run(); assert.equal(r.ok,true); assert.equal(r.headSha,sha); assert.equal(r.minimumRisk,'R3');
});
test('missing required review information fails',async()=>{
 const r=await run({snapshot:pr({body:body().replace('## Negative cases','## Other')})});
 assert.equal(r.ok,false); assert.match(r.errors.join(' '),/Missing section: Negative cases/);
});
test('fake candidate checker cannot bypass base validator',async()=>{
 const e=event(); e.claimedValidator='return {ok:true}';
 const r=await run({e,snapshot:pr({body:body('R0')})});
 assert.equal(r.ok,false); assert.match(r.errors.join(' '),/minimum R3/);
});
test('renamed guard retains R3 and worker code requires R2',async()=>{
 const r=await run({snapshot:pr({body:body('R1')}),files:[{filename:'README.md',status:'renamed',previous_filename:'.github/workflows/aiei.yml'}]});
 assert.equal(r.ok,false); assert.equal(r.minimumRisk,'R3');
 const w=await run({snapshot:pr({body:body('R1')}),files:[{filename:'worker/index.mjs',status:'modified'}]});
 assert.equal(w.ok,false); assert.equal(w.minimumRisk,'R2');
});
test('stale head, changed PR body and wrong base fail closed',async()=>{
 await assert.rejects(run({snapshot:pr({head:{sha:'c'.repeat(40)}})}),/head changed/);
 await assert.rejects(run({later:pr({body:body('R2')})}),/changed during validation/);
 await assert.rejects(run({snapshot:pr({base:{sha:base,ref:'other',repo:{full_name:repo}}})}),/default branch/);
});
test('API failures, incomplete listings, ambiguous renames and excess files fail closed',async()=>{
 await assert.rejects(run({apiError:true}),/API unavailable/);
 await assert.rejects(run({files:[]}),/incomplete or invalid/);
 await assert.rejects(run({snapshot:pr({changed_files:2})}),/does not match/);
 await assert.rejects(run({files:[{filename:'README.md',status:'renamed'}]}),/original path/);
 await assert.rejects(run({snapshot:pr({changed_files:3000})}),/exceeds safe API coverage/);
});
test('missing or malformed event fails closed',async()=>{
 await assert.rejects(run({e:{...event(),number:0}}),/number/);
 await assert.rejects(run({e:{...event(),repository:{full_name:'other/repo',default_branch:'main'}}}),/repository/);
});
test('workflow is base-only, read-only, and reports for drafts',()=>{
 const y=readFileSync(new URL('../.github/workflows/aiei-trusted-review.yml',import.meta.url),'utf8');
 assert.match(y,/pull_request_target:/); assert.match(y,/contents: read/);
 assert.match(y,/pull-requests: read/); assert.match(y,/persist-credentials: false/);
 assert.match(y,/converted_to_draft/); assert.doesNotMatch(y,/if:.*draft|secrets\.|ref:.*head|wrangler deploy/i);
});
