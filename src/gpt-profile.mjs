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

export function validatePublicGptSnapshot(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      data.version !== 1 || data.metric !== "work-codex-tokens" ||
      data.approximate !== true || data.attestation !== "owner-published" ||
      !Number.isSafeInteger(data.count) || data.count < 0 ||
      !validText(data.source, 100) ||
      typeof data.asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.asOf)) {
    throw new Error("Invalid public GPT activity snapshot");
  }
  const date = Date.parse(data.asOf + "T00:00:00Z");
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== data.asOf ||
      date > Date.now() + 86400000) {
    throw new Error("Invalid public GPT snapshot date");
  }
  const p = data.profile;
  if (!p || typeof p !== "object" || Array.isArray(p) ||
      !validText(p.displayName, 100) || !validText(p.username, 80) ||
      !publicHttpsUrl(p.publicProfileUrl) ||
      p.publicProfileUrl !== "https://chatgpt.com/u/" + p.username ||
      !validText(p.scope, 260) ||
      !p.stats || typeof p.stats !== "object" || Array.isArray(p.stats)) {
    throw new Error("Invalid public GPT profile metadata");
  }
  const { peakDailyTokens, longestTaskHours, recordedStreakDays,
    currentStreakDays, chatMessages, weeklyTokens } = p.stats;
  if (![peakDailyTokens, longestTaskHours, recordedStreakDays,
    currentStreakDays, chatMessages, weeklyTokens].every(validOptionalInteger)) {
    throw new Error("Invalid public GPT statistic");
  }
  for (const [items, limit, validator] of [
    [p.skills, 16, (x) => x && validText(x.name, 110) && validText(x.description, 260)],
    [p.showcaseSites, 12, (x) => x && validText(x.name, 110) &&
      validText(x.description, 260) && publicHttpsUrl(x.url)],
    [p.topPlugins, 12, (x) => x && validText(x.name, 110) && validText(x.description, 260)],
  ]) {
    if (!Array.isArray(items) || items.length > limit || !items.every(validator))
      throw new Error("Invalid public GPT profile collection");
  }
  return data;
}

const compact = (value) => new Intl.NumberFormat("en-US", {
  notation: "compact", maximumFractionDigits: 1,
}).format(value);
const displayCount = (value, suffix = "") => value === null
  ? "—" : compact(value) + suffix;
const metric = (label, value, caption) =>
  '<div class="gpt-stat"><span class="gpt-stat-label">' + esc(label) + '</span>' +
  '<strong class="gpt-stat-value">' + esc(value) + '</strong>' +
  '<small class="gpt-stat-caption">' + esc(caption) + '</small></div>';
const heading = (id, number, title, subtitle) =>
  '<header class="gpt-section-head"><span class="gpt-section-index">' + esc(number) + '</span>' +
  '<div><h2 id="' + esc(id) + '">' + esc(title) + '</h2><p>' + esc(subtitle) + '</p></div></header>';

export function renderPublicGptProfile(input) {
  const s = validatePublicGptSnapshot(input);
  const p = s.profile;
  const dateLabel = new Date(s.asOf + "T12:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC", month: "long", day: "numeric", year: "numeric",
  });
  const skills = p.skills.length
    ? '<div class="gpt-skill-grid">' + p.skills.map((skill, i) =>
        '<article class="gpt-skill"><span class="gpt-skill-num">' + String(i + 1).padStart(2, "0") +
        ' / WORKFLOW</span><h3>' + esc(skill.name) + '</h3><p>' +
        esc(skill.description) + '</p></article>').join("") + '</div>'
    : '<p class="gpt-empty">No skills have been added to the approved public snapshot.</p>';
  const sites = p.showcaseSites.length
    ? '<div class="gpt-showcase-grid">' + p.showcaseSites.map((site, i) =>
        '<a class="gpt-showcase-card" href="' + esc(site.url) +
        '" target="_blank" rel="noopener noreferrer"><span>' +
        String(i + 1).padStart(2, "0") + ' / SITE</span><strong>' +
        esc(site.name) + '</strong><small>' + esc(site.description) +
        '</small><em>VISIT SITE ↗</em></a>').join("") + '</div>'
    : '<p class="gpt-empty">Showcase links are awaiting an owner-approved snapshot. No private or unverified Sites are published here.</p>';
  const plugins = p.topPlugins.length
    ? '<div class="gpt-skill-grid">' + p.topPlugins.map((plugin) =>
        '<article class="gpt-skill"><span class="gpt-skill-num">PUBLIC PLUGIN</span><h3>' +
        esc(plugin.name) + '</h3><p>' + esc(plugin.description) +
        '</p></article>').join("") + '</div>'
    : '<p class="gpt-empty">Top-plugin rankings have not been verified for this snapshot.</p>';
  return '<div class="gpt-profile" id="gpt-profile">' +
    '<div class="gpt-profile-identity"><img class="gpt-profile-avatar" src="/v2/crossed-arms.webp" alt="" width="62" height="62" loading="lazy">' +
    '<div class="gpt-profile-person"><span class="gpt-profile-eyebrow">PUBLIC WORKFLOW PROFILE</span>' +
    '<strong>' + esc(p.displayName) + '</strong><span>@' + esc(p.username) + '</span></div>' +
    '<a class="gpt-profile-original" href="' + esc(p.publicProfileUrl) +
    '" target="_blank" rel="noopener noreferrer">Open ChatGPT profile ↗</a></div>' +
    '<div class="gpt-primary-stat" aria-label="Owner-reported cumulative Work and Codex token activity">' +
    '<span class="gpt-primary-label">WORK / CODEX · RECORDED TOKEN ACTIVITY</span>' +
    '<strong>≈' + esc(compact(s.count)) + '</strong><span class="gpt-primary-date">Owner-reported snapshot · ' +
    '<time datetime="' + esc(s.asOf) + '">' + esc(dateLabel) + '</time></span>' +
    '<p>' + esc(p.scope) + ' No automatic account connection; historical figures do not update in real time.</p></div>' +
    '<section class="gpt-section" aria-labelledby="gpt-activity-heading">' +
    heading("gpt-activity-heading", "01 / ACTIVITY", "By the numbers",
      "Dated figures from the supplied ChatGPT profile snapshot, with missing metrics left unreported.") +
    '<div class="gpt-stats-grid">' +
    metric("PEAK DAILY TOKENS", displayCount(p.stats.peakDailyTokens), "Recorded peak; not current-day usage") +
    metric("LONGEST TASK", p.stats.longestTaskHours === null ? "—" :
      String(p.stats.longestTaskHours) + "h", "Owner-reported duration") +
    metric("LONGEST STREAK", p.stats.recordedStreakDays === null ? "—" :
      String(p.stats.recordedStreakDays) + " days", "Longest streak recorded in dated snapshot") +
    metric("CHAT MESSAGES", displayCount(p.stats.chatMessages),
      p.stats.chatMessages === null ? "Not in approved snapshot" : "Messages, not tokens") +
    metric("WEEKLY TOKENS", displayCount(p.stats.weeklyTokens), "Not in approved snapshot if blank") +
    metric("CURRENT STREAK AT SNAPSHOT", p.stats.currentStreakDays === null ? "—" :
      String(p.stats.currentStreakDays) + " days", "As reported on snapshot date, not live") +
    '</div></section>' +
    '<section class="gpt-section" aria-labelledby="gpt-graph-heading">' +
    heading("gpt-graph-heading", "02 / ACTIVITY", "Activity graph",
      "Daily, weekly and historical graph data require multiple dated, owner-approved samples.") +
    '<p class="gpt-empty">No approved daily activity series is available yet. A single November 2 snapshot cannot establish a trend.</p></section>' +
    '<section class="gpt-section" aria-labelledby="gpt-skills-heading">' +
    heading("gpt-skills-heading", "03 / METHODS", "Skills & workflows",
      "Selected personal workflow skills. These are curated descriptions, not publicly shared ChatGPT skill packages.") +
    skills + '</section>' +
    '<section class="gpt-section" aria-labelledby="gpt-sites-heading">' +
    heading("gpt-sites-heading", "04 / SHOWCASE", "Showcase Sites",
      "Only owner-approved, publicly reachable Sites are listed.") + sites + '</section>' +
    '<section class="gpt-section" aria-labelledby="gpt-plugins-heading">' +
    heading("gpt-plugins-heading", "05 / TOOLS", "Top plugins",
      "Profile rankings are published only when captured in an approved snapshot.") + plugins + '</section>' +
    '<section class="gpt-section" aria-labelledby="gpt-insights-heading">' +
    heading("gpt-insights-heading", "06 / INSIGHTS", "Profile insights",
      "Only observations explicitly captured or approved by the profile owner are shown.") +
    '<p class="gpt-empty">No public insights have been included in the approved manual snapshot.</p></section>' +
    '<footer class="gpt-profile-foot"><strong>MANUAL SNAPSHOT / NO ACCOUNT ACCESS</strong>' +
    '<p>Snapshot as of <time datetime="' + esc(s.asOf) + '">' + esc(dateLabel) +
    '</time>. Updates are reviewed and published through this site repository, not inferred from browser sessions or private ChatGPT APIs.</p>' +
    '<a href="' + esc(p.publicProfileUrl) + '" target="_blank" rel="noopener noreferrer">View original profile ↗</a>' +
    '</footer></div>';
}
