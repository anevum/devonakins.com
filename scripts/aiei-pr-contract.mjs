/**
 * AIEI PR-description format checker. This is not a code-quality, security, or
 * evidence-authenticity certification. GitHub Actions runs this script from
 * the trusted BASE branch only, never from an untrusted PR head.
 */
const REQUIRED = [
  'Purpose',
  'Scope and boundaries',
  'Acceptance evidence',
  'Negative cases',
  'Risks and unknowns',
  'Release intent',
];
const DECISIONS = new Set(['REVIEW_ONLY','RELEASE_NO_GO','READY_FOR_REVIEW']);

export function validateContract(input) {
  const errors=[];
  if (typeof input !== 'string' || !input.trim()) return {ok:false,errors:['Pull-request description is missing.']};
  if (Buffer.byteLength(input, 'utf8') > 65536) return {ok:false,errors:['Pull-request description exceeds 64 KiB.']};
  // Ignore HTML comments; the template's instructions are not actual evidence.
  const text=input.replace(/<!--[\s\S]*?-->/g,'');
  const matches=[...text.matchAll(/^##\s+(.+?)\s*$/gm)];
  const sections=new Map();
  for (let i=0;i<matches.length;i++) {
    const title=matches[i][1].trim().toLowerCase();
    const from=matches[i].index+matches[i][0].length;
    const to=matches[i+1]?.index??text.length;
    if (sections.has(title)) errors.push(`Duplicate section: ${matches[i][1].trim()}.`);
    sections.set(title,text.slice(from,to).trim());
  }
  for (const label of REQUIRED) {
    const content=sections.get(label.toLowerCase());
    if (content===undefined) {errors.push(`Missing section: ${label}.`);continue;}
    const substantive=content.replace(/^[-*\s]+/gm,'').replace(/\[[ xX]\]/g,'').trim();
    if (!substantive || /^(?:n\/?a|none|tbd|todo|pending|\.\.\.|\[.*?\]|<.*?>)$/i.test(substantive)) {
      errors.push(`Incomplete section: ${label}.`);
    } else if (label !== 'Release intent' && substantive.length < 15) {
      errors.push(`Section needs a specific explanation: ${label}.`);
    }
  }
  const decision=sections.get('release intent');
  if (decision!==undefined) {
    const meaningful=decision.split('\n').map(x=>x.trim()).filter(Boolean);
    if (meaningful.length!==1 || !DECISIONS.has(meaningful[0])) {
      errors.push('Release intent must be exactly REVIEW_ONLY, RELEASE_NO_GO, or READY_FOR_REVIEW.');
    }
  }
  return {ok:errors.length===0,errors};
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const report=validateContract(process.env.AIEI_PR_BODY);
  if (report.ok) {
    console.log('AIEI PR description has required review fields. This does not verify their truth.');
  } else {
    for (const e of report.errors) console.error(`AIEI contract: ${e}`);
    process.exitCode=1;
  }
}