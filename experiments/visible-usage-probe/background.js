/* Trusted extension service worker: validates and holds only allowlisted metrics. */
importScripts("metric-schema.js");
(() => {
  "use strict";
  const KEY = "devon-visible-usage-probe-v1";
  const schema = globalThis.__devonVisibleUsageSchema;
  const states = new Set(["idle", "selecting", "observing", "paused", "stale", "stopped"]);
  const allowedMessages = new Set([
    "Selection not started", "Stopped locally; no usage data is being collected",
    "Selection cancelled", "Tab hidden; collection paused",
    "Selected number disappeared; select it again",
    "Selected element is no longer a recognized numeric reading",
    "Click the digits themselves, not a whole panel or a label",
    "Click the visible number on the usage page; Esc cancels",
    "Visible reading sampled; provider update time unknown",
  ]);
  const validTime = text => typeof text === "string" &&
    Number.isFinite(Date.parse(text)) && new Date(text).toISOString() === text;
  const exactKeys = (obj, keys) => Object.keys(obj).sort().join("|") === keys.sort().join("|");
  const allowedOrigin = url => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" &&
        ["chatgpt.com", "chat.openai.com"].includes(parsed.hostname);
    } catch { return false; }
  };
  function sanitizedRecord(data, tabId) {
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        !exactKeys(data, ["version","state","message","metric","reading","statusAt"]) ||
        data.version !== 1 || !states.has(data.state) ||
        !allowedMessages.has(data.message) ||
        !validTime(data.statusAt) || !Number.isSafeInteger(tabId) || tabId < 0) return null;
    const metric = data.metric;
    if (metric !== null && !schema.allowedMetrics.includes(metric)) return null;
    let reading = null;
    if (data.reading !== null) {
      const r = data.reading;
      if (!r || typeof r !== "object" || Array.isArray(r) ||
          !exactKeys(r,["source","scope","metric","unit","value","observedAt","lastChangedAt","sourceUpdatedAt"]) ||
          r.source !== "user-selected-visible-usage-text" ||
          r.scope !== "work-codex" || r.metric !== metric ||
          r.sourceUpdatedAt !== null ||
          !schema.createReading(metric, {value:r.value,unit:r.unit}, r.observedAt, r.lastChangedAt) ||
          Date.parse(r.observedAt) > Date.parse(data.statusAt)) return null;
      reading = schema.createReading(metric, {value:r.value,unit:r.unit},r.observedAt,r.lastChangedAt);
    }
    if (data.state === "observing" && !reading) return null;
    if (["idle","selecting","stopped"].includes(data.state) && reading !== null) return null;
    return {version:1,state:data.state,message:data.message,metric,reading,statusAt:data.statusAt,tabId};
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message || message.type !== "USAGE_PROBE_RECORD") return;
    if (!sender.tab?.id || !allowedOrigin(sender.url)) {
      respond({ok:false});
      return;
    }
    const record = sanitizedRecord(message.data,sender.tab.id);
    if (!record) {
      respond({ok:false});
      return;
    }
    // No remote transmission and no persistent local storage.
    chrome.storage.session.set({[KEY]:record}).then(() => respond({ok:true}), () => respond({ok:false}));
    return true;
  });
})();
