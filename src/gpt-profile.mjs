/**
 * Owner-approved, public GPT profile snapshot rendering.
 * This file never authenticates to ChatGPT, scrapes a page or reads private data.
 */
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

const validText = (value, max = 220) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

const publicHttpsUrl = (value) => {
  if (!validText(value, 1024)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) &&
      !url.username && !url.password &&
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
};

const validOptionalInteger = (n) => n === null || (Number.isSafeInteger(n) && n >= 0);

const validDate = (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date + "T00:00:00Z")) &&
  new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;

export function validatePublicGptSnapshot(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      data.version !== 1 || data.metric !== "work-codex-tokens" ||
      data.approximate !== true || data.attestation !== "owner-published" ||
      !Number.isSafeInteger(data.count) || data.count < 0 ||
      !validText(data.source, 120) || !validDate(data.asOf)) {
    throw new Error("Invalid public GPT activity snapshot");
  }
  if (Date.parse(data.asOf + "T00:00:00Z") > Date.now() + 86400000)
    throw new Error("Future snapshot date");
  const p = data.profile;
  if (!p || typeof p !== "object" || Array.isArray(p) ||
      !validText(p.displayName, 100) || !validText(p.username, 80) ||
      !publicHttpsUrl(p.publicProfileUrl) ||
      p.publicProfileUrl !== "https://chatgpt.com/u/" + p.username ||
      !validText(p.scope, 260) ||
      !p.stats || typeof p.stats !== "object" || Array.isArray(p.stats) ||
      Object.hasOwn(p, "showcaseSites") || Object.hasOwn(p, "featuredSite")) {
    throw new Error("Invalid public GPT profile metadata");
  }
  const {peakTokens, longestTaskHours, recordedStreakDays,
    currentStreakDays, chatMessages, weeklyTokens} = p.stats;
  if (![peakTokens, longestTaskHours, recordedStreakDays,
    currentStreakDays, chatMessages, weeklyTokens].every(validOptionalInteger))
    throw new Error("Invalid public GPT statistic");
  const w = p.weeklyActivity;
  if (!w || typeof w !== "object" || Array.isArray(w) ||
      !validDate(w.startDate) || !validDate(w.endDate) ||
      w.endDate !== data.asOf || w.days !== 7 ||
      (Date.parse(w.endDate) - Date.parse(w.startDate)) / 86400000 !== 6 ||
      ![w.tokens, w.messages, w.pluginCalls, w.skillUses].every(
        n => Number.isSafeInteger(n) && n >= 0) ||
      weeklyTokens !== w.tokens || chatMessages !== w.messages)
    throw new Error("Invalid seven-day GPT analytics");
  const insights = p.profileInsights;
  if (!insights || typeof insights !== "object" || Array.isArray(insights) ||
      !Number.isInteger(insights.fastModePercent) ||
      insights.fastModePercent < 0 || insights.fastModePercent > 100 ||
      !validText(insights.mostUsedReasoning, 40) ||
      ![insights.skillsExplored, insights.totalSkillUses].every(
        n => Number.isSafeInteger(n) && n >= 0))
    throw new Error("Invalid GPT profile insights");
  for (const [items, limit, validate] of [
    [p.skills, 16, x => x && validText(x.name, 110) &&
      validText(x.description, 260) && typeof x.featured === "boolean"],
    [p.topPlugins, 12, x => x && validText(x.name, 110) &&
      validText(x.description, 260)],
  ]) {
    if (!Array.isArray(items) || items.length > limit || !items.every(validate))
      throw new Error("Invalid public GPT collection");
  }
  return data;
}

const compact = value => new Intl.NumberFormat("en-US", {
  notation: "compact", maximumFractionDigits: 1,
}).format(value);
const full = value => new Intl.NumberFormat("en-US").format(value);
const displayCount = value => value === null ? "\u2014" : compact(value);
const metric = (label, value, caption) =>
  '<div class="gpt-stat"><span class="gpt-stat-label">' + esc(label) + '</span>' +
  '<strong class="gpt-stat-value">' + esc(value) + '</strong>' +
  '<small class="gpt-stat-caption">' + esc(caption) + '</small></div>';
const heading = (id, number, title, subtitle) =>
  '<header class="gpt-section-head"><span class="gpt-section-index">' + esc(number) + '</span>' +
  '<div><h2 id="' + esc(id) + '">' + esc(title) + '</h2><p>' + esc(subtitle) + '</p></div></header>';
const dateLabel = (day, opts = {month:"short", day:"numeric", year:"numeric"}) =>
  new Date(day + "T12:00:00Z").toLocaleDateString("en-US", {timeZone:"UTC", ...opts});

export function renderPublicGptProfile(input) {
  const s = validatePublicGptSnapshot(input);
  const p = s.profile;
  const w = p.weeklyActivity;
  const ins = p.profileInsights;
  const longDate = dateLabel(s.asOf, {month:"long", day:"numeric", year:"numeric"});
  const periodLabel = dateLabel(w.startDate, {month:"short", day:"numeric"}) +
    " - " + dateLabel(w.endDate);
  const weeklyMetric = (label, value, units) =>
    '<div class="gpt-weekly-metric" role="listitem"><span>' + esc(label) + '</span>' +
    '<strong aria-label="' + esc(full(value) + " " + units) + '">' +
    esc(compact(value)) + '</strong><small>7-day ' + esc(units) + '</small></div>';
  const weekly = '<section class="gpt-weekly" aria-labelledby="gpt-weekly-title">' +
    '<div class="gpt-weekly-heading"><span class="gpt-signal-overline">07 DAY SIGNAL / WORKSPACE ANALYTICS</span>' +
    '<h2 id="gpt-weekly-title">This week in motion</h2>' +
    '<p><time datetime="' + esc(w.startDate) + '">' + esc(periodLabel) + '</time> | Captured ' +
    esc(longDate) + '</p></div><div class="gpt-weekly-grid" role="list" aria-label="Seven day analytics totals">' +
    weeklyMetric("TOKEN ACTIVITY", w.tokens, "tokens") +
    weeklyMetric("MESSAGES SENT", w.messages, "messages") +
    weeklyMetric("PLUGIN CALLS", w.pluginCalls, "plugin calls") +
    weeklyMetric("SKILL USES", w.skillUses, "skill uses") +
    '</div><p class="gpt-weekly-note">Seven-day Usage Analytics totals, separate from the cumulative profile figures. This is a dated snapshot, not a live account connection.</p></section>';
  const skills = p.skills.length
    ? '<div class="gpt-skill-grid">' + p.skills.map((skill, i) =>
        '<article class="gpt-skill"' + (skill.featured ? ' data-featured="true"' : '') + '>' +
        '<span class="gpt-skill-num">' + String(i + 1).padStart(2, "0") +
        (skill.featured ? ' / PROFILE FEATURED' : ' / PERSONAL WORKFLOW') + '</span>' +
        '<h3>' + esc(skill.name) + '</h3><p>' + esc(skill.description) + '</p></article>').join("") + '</div>'
    : '<p class="gpt-empty">No approved skills in this snapshot.</p>';
  const plugins = p.topPlugins.length
    ? '<div class="gpt-skill-grid">' + p.topPlugins.map(plugin =>
        '<article class="gpt-skill"><span class="gpt-skill-num">PROFILE INTEGRATION</span>' +
        '<h3>' + esc(plugin.name) + '</h3><p>' + esc(plugin.description) +
        '</p></article>').join("") + '</div>'
    : '<p class="gpt-empty">No integrations listed in the current snapshot.</p>';
  return '<div class="gpt-profile" id="gpt-profile">' +
    '<div class="gpt-profile-identity"><img class="gpt-profile-avatar" src="/v2/crossed-arms.webp" alt="" width="62" height="62" loading="lazy">' +
    '<div class="gpt-profile-person"><span class="gpt-profile-eyebrow">PUBLIC WORKFLOW PROFILE</span>' +
    '<strong>' + esc(p.displayName) + '</strong><span>@' + esc(p.username) + '</span></div>' +
    '<a class="gpt-profile-original" href="' + esc(p.publicProfileUrl) +
    '" target="_blank" rel="noopener noreferrer">Open ChatGPT profile</a></div>' +
    '<div class="gpt-primary-stat" aria-label="Cumulative Work and Codex token snapshot">' +
    '<span class="gpt-primary-label">WORK / CODEX · RECORDED CUMULATIVE TOKENS</span>' +
    '<strong>≈' + esc(compact(s.count)) + '</strong><span class="gpt-primary-date">SNAPSHOT / ' +
    '<time datetime="' + esc(s.asOf) + '">' + esc(longDate) + '</time></span>' +
    '<p>' + esc(p.scope) + ' Manually captured; historical figures are not updated in real time.</p></div>' +
    weekly +
    '<section class="gpt-section" aria-labelledby="gpt-activity-heading">' +
    heading("gpt-activity-heading", "01 / PROFILE", "By the numbers",
      "Profile-level figures from November 3, separate from the seven-day activity above.") +
    '<div class="gpt-stats-grid">' +
    metric("PEAK TOKENS", displayCount(p.stats.peakTokens), "Profile peak; interval not independently determined") +
    metric("LONGEST TASK", p.stats.longestTaskHours === null ? "\u2014" :
      p.stats.longestTaskHours + "h", "Longest task duration") +
    metric("LONGEST STREAK", p.stats.recordedStreakDays === null ? "\u2014" :
      p.stats.recordedStreakDays + " days", "Recorded streak") +
    metric("CURRENT STREAK AT SNAPSHOT", p.stats.currentStreakDays === null ? "\u2014" :
      p.stats.currentStreakDays + " days", "As of November 3; not live") +
    metric("SKILLS EXPLORED", full(ins.skillsExplored), "Profile insight") +
    metric("TOTAL SKILL USES", full(ins.totalSkillUses), "Profile total; not the seven-day figure") +
    '</div></section>' +
    '<section class="gpt-section" aria-labelledby="gpt-graph-heading">' +
    heading("gpt-graph-heading", "02 / SIGNAL", "Activity graph",
      "Seven-day totals were captured; exact daily values were not available for publication.") +
    '<div class="gpt-signal-context"><span class="gpt-signal-overline">ANALYTICS / 7D</span>' +
    '<p>The source includes model, plugin, skill and message charts. This snapshot publishes the recorded totals rather than inventing daily data.</p>' +
    '<div class="gpt-period-rail" aria-label="Reporting period October 28 through November 3, 2026">' +
    '<span>OCT 28</span><span class="gpt-period-track" aria-hidden="true"></span><span>NOV 03</span></div></div></section>' +
    '<section class="gpt-section" aria-labelledby="gpt-skills-heading">' +
    heading("gpt-skills-heading", "03 / METHODS", "Skills & workflows",
      "Four skills featured on the captured profile, plus an engineering review workflow.") +
    skills + '</section>' +
    '<section class="gpt-section" aria-labelledby="gpt-plugins-heading">' +
    heading("gpt-plugins-heading", "04 / TOOLS", "Top plugins",
      "Integrations shown on the November 3 profile, not seven-day call rankings.") +
    plugins + '</section>' +
    '<section class="gpt-section" aria-labelledby="gpt-insights-heading">' +
    heading("gpt-insights-heading", "05 / INSIGHTS", "Profile insights",
      "Profile observations captured alongside the activity snapshot.") +
    '<div class="gpt-insights-grid">' +
    metric("FAST MODE", ins.fastModePercent + "%", "Profile-reported proportion") +
    metric("MOST USED REASONING", ins.mostUsedReasoning, "Profile insight; not a benchmark") +
    '</div></section>' +
    '<footer class="gpt-profile-foot"><strong>DATED PUBLIC SNAPSHOT / NO PRIVATE ACCOUNT ACCESS</strong>' +
    '<p>As of <time datetime="' + esc(s.asOf) + '">' + esc(longDate) + '</time>. ' +
    'Reconciled from two supplied recordings. Updates are published through this repository; ' +
    'no authenticated ChatGPT API, account cookies, or estimated daily values.</p>' +
    '<a href="' + esc(p.publicProfileUrl) + '" target="_blank" rel="noopener noreferrer">View original profile</a>' +
    '</footer></div>';
}
