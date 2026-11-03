/**
 * AIEI pull-request description format checker. Validates the presence of a
 * readable review contract, not source quality or the truth of supplied evidence.
 * Run in a read-only pull_request workflow; never give it production secrets.
 */
import {execFileSync} from 'node:child_process';

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

// This is a conservative risk floor based on changed file paths. It does not
// prove a change is safe; reviewers must still classify behavior independently.
export function minimumPathRisk(paths) {
  if (!Array.isArray(paths)) throw new TypeError('Changed paths must be an array.');
  let floor = 0;
  for (const path of paths) {
    if (typeof path !== 'string' || !path.length) throw new TypeError('Changed paths must be non-empty strings.');
    if (/^(?:\.github\/(?:workflows\/|CODEOWNERS$|PULL_REQUEST_TEMPLATE\.md$)|AGENTS\.md$|wrangler\.jsonc$|scripts\/(?:aiei-|security\/)|tests\/aiei-|LICENSE(?:\..*)?$)/i.test(path) ||
        /(?:^|\/)(?:auth|security|permissions)\//i.test(path) || /(?:^|\/)\.env(?:\.|$)/i.test(path)) {
      floor = Math.max(floor, 3);
    } else if (/^(?:worker\/|package(?:-lock)?\.json$)/i.test(path) || /\.sql$/i.test(path)) {
      floor = Math.max(floor, 2);
    } else if (!/(?:^|\/)(?:[^/]+\.)?(?:md|txt)$|^\.gitignore$/i.test(path)) {
      floor = Math.max(floor, 1);
    }
  }
  return floor;
}

// The GitHub workflow provides exact commits and a full checkout. Inspect both
// old and new names of renames (--no-renames) to detect removed guard files.
function changedPathsFromGit() {
  const base = process.env.AIEI_BASE_SHA;
  const head = process.env.AIEI_HEAD_SHA;
  if (!/^[0-9a-f]{40}$/.test(base || '') || !/^[0-9a-f]{40}$/.test(head || '')) {
    throw new Error('AIEI_BASE_SHA and AIEI_HEAD_SHA must be exact 40-character commit hashes.');
  }
  const data = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', `${base}...${head}`],
    {encoding:'utf8',maxBuffer:1024*1024});
  const paths = data.split('\0').filter(Boolean);
  if (!paths.length) throw new Error('No changed files found; refusing to approve an unverified PR diff.');
  return paths;
}

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

export function validateContract(input, changedPaths) {
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
  if (changedPaths !== undefined && /^(R0|R1|R2|R3)$/.test(tier || '')) {
    const floor = minimumPathRisk(changedPaths);
    if (Number(tier[1]) < floor) errors.push(`Risk tier ${tier} understates changed-file minimum R${floor}.`);
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
  let report;
  try {
    report = validateContract(process.env.AIEI_PR_BODY, changedPathsFromGit());
  } catch (error) {
    console.error(`AIEI contract: ${error.message}`);
    process.exitCode=1;
  }
  if (report?.ok) {
    console.log('AIEI PR description has required review fields. This does not verify their truth.');
  } else if (report) {
    for (const e of report.errors) console.error(`AIEI contract: ${e}`);
    process.exitCode=1;
  }
}