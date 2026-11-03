import test from 'node:test';
import assert from 'node:assert/strict';
import {validateContract} from '../scripts/aiei-pr-contract.mjs';

const sample=`## Purpose\nMake the user's current page readable on narrow phones.\n\n## Scope and boundaries\nOnly the website stylesheet changes; no accounts, APIs, or deployments.\n\n## Acceptance evidence\nNode test output and screenshots for 320 and 390 pixel viewports; live iPhone not checked.\n\n## Negative cases\nEnsure reduced-motion preference still disables animated transitions and all links remain keyboard-accessible.\n\n## Risks and unknowns\nPhysical device test and source-to-production commit are unverified, so do not deploy.\n\n## Release intent\nREVIEW_ONLY\n`;
test('accepts a specific review-only contract without asserting that evidence is true',()=>{
 assert.deepEqual(validateContract(sample),{ok:true,errors:[]});
});
test('requires all six sections',()=>{
 const r=validateContract(sample.replace('## Negative cases','## Another section'));
 assert(!r.ok && r.errors.some(x=>x.includes('Missing section: Negative cases')));
});
test('rejects template comments with no content',()=>{
 const r=validateContract(sample.replace('Make the user\'s current page readable on narrow phones.','<!-- Describe the work here. -->'));
 assert(!r.ok && r.errors.some(x=>x.includes('Incomplete section: Purpose')));
});
test('rejects placeholders and unsupported release claims',()=>{
 const r=validateContract(sample.replace('Physical device test and source-to-production commit are unverified, so do not deploy.','TBD').replace('REVIEW_ONLY','LIVE'));
 assert(!r.ok && r.errors.some(x=>x.includes('Risks and unknowns')) && r.errors.some(x=>x.includes('Release intent must')));
});
test('rejects blank description and excessive input',()=>{
 assert.equal(validateContract('').ok,false);
 assert.equal(validateContract('x'.repeat(65537)).ok,false);
});
test('rejects repeated headings',()=>{
 const r=validateContract(sample+'\n## Purpose\nA second, conflicting purpose.\n');
 assert(!r.ok && r.errors.some(x=>x.includes('Duplicate section')));
});
test('accepts release no-go with explicit incomplete evidence',()=>{
 const r=validateContract(sample.replace('REVIEW_ONLY','RELEASE_NO_GO'));
 assert.equal(r.ok,true);
});
test('rejects one-word no-test claims',()=>{
 const r=validateContract(sample.replace('Node test output and screenshots for 320 and 390 pixel viewports; live iPhone not checked.','N/A'));
 assert(!r.ok && r.errors.some(x=>x.includes('Acceptance evidence')));
});