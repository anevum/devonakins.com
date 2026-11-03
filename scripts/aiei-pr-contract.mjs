/**
 * AIEI pull-request description format checker. Validates the presence of a
 * readable review contract, not source quality or the truth of supplied evidence.
 * Run in a read-only pull_request workflow; never give it production secrets.
 */
const REQUIRED = [
  'Purpose',
  'Scope and boundaries',
  'Risk tier',
  'Acceptance evidence',
  'Negative cases',
  'Risks and unknowns',
  'Release intent',
];
const DECISIONS = new Set(['REVIEW_ONLY','RELEASE_NO_GO','READY_FOR_REVIEW']);

// A literal code example is not a PR section. Strip code fences before HTML
// comments so example text cannot accidentally create real headings or eat
// legitimate content with an unmatched comment marker.
function visibleMarkdown(input) {
  let fence = null;
  const lines = input.split(/\r?\n/).map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.char &&
          marker[1].length >= fence.length && marker[2].trim() === '') fence = null;
      return '';
    }
    if (marker) {
      fence = {char: marker[1][0], length: marker[1].length};
      return '';
    }
    return line;
  });
  // Remove HTML comments only after fenced examples have been suppressed.
  const uncommented = lines.join('\n').replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  // Raw HTML pre/code blocks display literal text, not actual section headings.
  // An unclosed block hides the remaining lines rather than counting them.
  let rawBlock = null;
  const visible = uncommented.split('\n').map(line => {
    if (rawBlock) {
      if (new RegExp(`</${rawBlock}\\s*>`, 'i').test(line)) rawBlock = null;
      return '';
    }
    const open = line.match(/^ {0,3}<(pre|code)\b[^>]*>/i);
    if (open) {
      const tag = open[1].toLowerCase();
      if (!new RegExp(`</${tag}\\s*>`, 'i').test(line.slice(open[0].length))) rawBlock = tag;
      return '';
    }
    return line;
  });
  return visible.join('\n');
}

export function validateContract(input) {
  const errors=[];
  if (typeof input !== 'string' || !input.trim()) return {ok:false,errors:['Pull-request description is missing.']};
  if (Buffer.byteLength(input, 'utf8') > 65536) return {ok:false,errors:['Pull-request description exceeds 64 KiB.']};
  const text = visibleMarkdown(input);
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
    } else if (!['Release intent','Risk tier'].includes(label) && substantive.length < 15) {
      errors.push(`Section needs a specific explanation: ${label}.`);
    }
  }
  const tier = sections.get('risk tier');
  if (tier !== undefined && !/^(R0|R1|R2|R3)$/.test(tier)) {
    errors.push('Risk tier must be exactly R0, R1, R2, or R3.');
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