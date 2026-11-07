/* A local-only, explicit-selection schema. Loaded in the extension isolated world. */
((root) => {
  "use strict";
  const definitions = Object.freeze({
    work_codex_credits_used: "credits",
    work_codex_credits_remaining: "credits",
    work_codex_used_percent: "percent",
    work_codex_remaining_percent: "percent",
  });
  const numeric = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;
  const timestamp = value => typeof value === "string" &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

  function parseVisibleNumber(text, metric) {
    const unit = definitions[metric];
    if (!unit || typeof text !== "string" || text.length > 64) return null;
    const normalized = text.trim().replace(/\u00a0/g, " ");
    if (!normalized) return null;
    let candidate;
    if (unit === "percent") {
      const matched = /^(.+?)\s*%$/.exec(normalized);
      if (!matched) return null;
      candidate = matched[1];
    } else {
      const matched = /^(?:(.+?)\s+credits?|credits?\s+(.+?)|(.+?))$/i.exec(normalized);
      if (!matched) return null;
      candidate = matched[1] ?? matched[2] ?? matched[3];
      // Prevent percent displays from being silently treated as credits.
      if (candidate.includes("%")) return null;
    }
    if (!numeric.test(candidate)) return null;
    const value = Number(candidate.replaceAll(",", ""));
    if (!Number.isFinite(value) || value < 0 ||
        (unit === "percent" && value > 100) ||
        (unit === "credits" && value > 1_000_000)) return null;
    return {value, unit};
  }

  function createReading(metric, parsed, observedAt, lastChangedAt) {
    if (!definitions[metric] || !parsed ||
        parsed.unit !== definitions[metric] ||
        !Number.isFinite(parsed.value) || parsed.value < 0 ||
        (parsed.unit === "percent" && parsed.value > 100) ||
        (parsed.unit === "credits" && parsed.value > 1_000_000) ||
        !timestamp(observedAt) || !timestamp(lastChangedAt) ||
        Date.parse(lastChangedAt) > Date.parse(observedAt)) return null;
    // No account IDs, page text, token/cookie values, or page URLs in this record.
    return Object.freeze({
      source: "user-selected-visible-usage-text",
      scope: "work-codex",
      metric,
      unit: parsed.unit,
      value: parsed.value,
      observedAt,
      lastChangedAt,
      sourceUpdatedAt: null, // OpenAI's actual update time cannot be inferred.
    });
  }

  root.__devonVisibleUsageSchema = Object.freeze({
    allowedMetrics: Object.freeze(Object.keys(definitions)),
    parseVisibleNumber,
    createReading,
  });
})(globalThis);
