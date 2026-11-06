import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateContract} from '../scripts/aiei-pr-contract.mjs';

const sample=`## Purpose\nMake the user's current page readable on narrow phones.\n\n## Scope and boundaries\nOnly the website stylesheet changes; no accounts, APIs, or deployments.\n\n## Risk tier\nR1\n\n## Acceptance evidence\nNode test output and screenshots for 320 and 390 pixel viewports; live iPhone not checked.\n\n## Negative cases\nEnsure reduced-motion preference still disables animated transitions and all links remain keyboard-accessible.\n\n## Risks and unknowns\nPhysical device test and source-to-production commit are unverified, so do not deploy.\n\n## Release intent\nREVIEW_ONLY\n`;
test('accepts a specific review-only contract without asserting that evidence is true',()=>{
 assert.deepEqual(validateContract(sample),{ok:true,errors:[]});
});
test('requires all seven sections',()=>{
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
test('rejects a complete spoofed review contract entirely inside a markdown code fence',()=>{
 const r=validateContract('```markdown\n'+sample+'\n```');
 assert(!r.ok && r.errors.some(x=>x.includes('Missing section: Purpose')));
});
test('ignores duplicate headings inside literal fenced examples',()=>{
 const r=validateContract('```text\n## Purpose\nNot part of the review.\n```\n'+sample);
 assert.deepEqual(r,{ok:true,errors:[]});
});
test('rejects acceptance evidence that is only an illustrative code block',()=>{
 const r=validateContract(sample.replace('Node test output and screenshots for 320 and 390 pixel viewports; live iPhone not checked.','~~~text\nFake test results and screenshots from a template example.\n~~~'));
 assert(!r.ok && r.errors.some(x=>x.includes('Acceptance evidence')));
});
test('ignores tilde-fenced headings and preserves real sections',()=>{
 const r=validateContract(sample.replace('Make the user\'s current page readable on narrow phones.','Make narrow screens readable for users.\n\n~~~markdown\n## Risks and unknowns\nFake second heading not part of the contract.\n~~~'));
 assert.deepEqual(r,{ok:true,errors:[]});
});
test('rejects a contract that only appears inside an unterminated HTML comment',()=>{
 const r=validateContract('<!--\n'+sample);
 assert(!r.ok && r.errors.some(x=>x.includes('Missing section: Purpose')));
});
test('code fence comment markers do not hide real review content',()=>{
 const r=validateContract('```text\n<!-- fake comment opener\n```\n'+sample);
 assert.deepEqual(r,{ok:true,errors:[]});
});
test('AIEI workflow remains read-only and reports status for draft PRs',async()=>{
 const yml=await readFile(new URL('../.github/workflows/aiei-review-contract.yml',import.meta.url),'utf8');
 assert.match(yml,/^  pull_request:/m);
 assert.doesNotMatch(yml,/^  pull_request_target:/m);
 assert.match(yml,/permissions:\s*\n\s+contents: read/);
 assert.doesNotMatch(yml,/^    if:.*\.draft/m);
 assert.match(yml,/persist-credentials: false/);
 assert.doesNotMatch(yml,/\$\{\{\s*secrets\./);
});

test('requires an explicit risk tier even when other review fields are complete',()=>{
 const r=validateContract(sample.replace('## Risk tier\nR1\n\n',''));
 assert(!r.ok && r.errors.some(x=>x.includes('Missing section: Risk tier')));
});
test('rejects unknown, duplicate or embellished risk tier values',()=>{
 for (const invalid of ['Unknown','R4','R3 - important','R1\nR2','r2','TBD']) {
   const r=validateContract(sample.replace('## Risk tier\nR1','## Risk tier\n'+invalid));
   assert(!r.ok && r.errors.some(x=>x.includes('Risk tier must')),invalid);
 }
});
test('accepts high-risk R3 reviews without treating it as release approval',()=>{
 const r=validateContract(sample.replace('## Risk tier\nR1','## Risk tier\nR3').replace('REVIEW_ONLY','RELEASE_NO_GO'));
 assert.deepEqual(r,{ok:true,errors:[]});
});
test('uncompleted PR template blocks acceptance until risk tier is selected',async()=>{
 const template=await readFile(new URL('../.github/PULL_REQUEST_TEMPLATE.md',import.meta.url),'utf8');
 assert.match(template,/SELECT_RISK_TIER/);
 const r=validateContract(template);
 assert(!r.ok && r.errors.some(x=>x.includes('Risk tier must')));
});

const contract = [
  '## Purpose',
  'This is a complete description only inside a raw HTML code example.',
  '## Scope and boundaries',
  'This change should not affect any persistent state or production behavior.',
  '## Risk tier', 'R1',
  '## Acceptance evidence',
  'This mentions a supposed test that is not actually performed.',
  '## Negative cases',
  'This claims negative scenarios were tested but this is just an HTML example.',
  '## Risks and unknowns',
  'This pretends to disclose all relevant limitations and missing evidence.',
  '## Release intent', 'REVIEW_ONLY',
].join('\n');
test('raw pre HTML literal is not treated as a valid PR description', () => {
  const r = validateContract('<pre>\n' + contract.replace('## Release intent\nREVIEW_ONLY','') + '\n</pre>\n## Release intent\nREVIEW_ONLY');
  assert.equal(r.ok, false, JSON.stringify(r));
});
test('raw code HTML literal is not treated as a valid PR description', () => {
  const r = validateContract('<code>\n' + contract.replace('## Release intent\nREVIEW_ONLY','') + '\n</code>\n## Release intent\nREVIEW_ONLY');
  assert.equal(r.ok, false, JSON.stringify(r));
});
test('raw HTML tags in a fenced example do not suppress a genuine review', () => {
  const r = validateContract('```html\n<pre>\n```\n' + contract);
  assert.equal(r.ok, true, JSON.stringify(r));
});