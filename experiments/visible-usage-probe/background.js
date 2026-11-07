/* Trusted extension worker: authorize one explicit capture session at a time. */
importScripts("metric-schema.js");
(() => {
  "use strict";
  const KEY = "devon-visible-usage-probe-v1";
  const ACTIVE_KEY = "devon-visible-usage-active-v1";
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
  const validSession = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
  const validTime = value => typeof value === "string" &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const exactKeys = (obj, keys) => Object.keys(obj).sort().join("|") === [...keys].sort().join("|");
  const allowedOrigin = url => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" &&
        ["chatgpt.com", "chat.openai.com"].includes(parsed.hostname);
    } catch { return false; }
  };
  const popupSender = sender => !sender.tab && sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL("popup.html");
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

  // Serializing authorization, recording and revoke makes Stop a real
  // barrier: old pending writes finish BEFORE the final clear, and any
  // later old-session writes fail even across service-worker restarts.
  let sequence = Promise.resolve();
  function enqueue(action, respond) {
    const result = sequence.then(action);
    sequence = result.catch(() => {});
    result.then(value => respond(value), () => respond({ok:false}));
    return true;
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "USAGE_PROBE_AUTHORIZE") {
      if (!popupSender(sender) || !Number.isSafeInteger(message.tabId) ||
          message.tabId < 0 || !validSession(message.sessionKey)) {
        respond({ok:false}); return;
      }
      return enqueue(async () => {
        await chrome.storage.session.set({
          [ACTIVE_KEY]:{tabId:message.tabId,sessionKey:message.sessionKey},
        });
        await chrome.storage.session.remove(KEY);
        return {ok:true};
      }, respond);
    }
    if (message.type === "USAGE_PROBE_REVOKE") {
      if (!popupSender(sender)) {respond({ok:false}); return;}
      return enqueue(async () => {
        await chrome.storage.session.remove([KEY,ACTIVE_KEY]);
        return {ok:true};
      }, respond);
    }
    if (message.type !== "USAGE_PROBE_RECORD") return;
    if (sender.id !== chrome.runtime.id || !Number.isSafeInteger(sender.tab?.id) ||
        !allowedOrigin(sender.url) || !validSession(message.sessionKey)) {
      respond({ok:false}); return;
    }
    return enqueue(async () => {
      const {[ACTIVE_KEY]:active} = await chrome.storage.session.get(ACTIVE_KEY);
      if (!active || active.tabId !== sender.tab.id ||
          active.sessionKey !== message.sessionKey) return {ok:false};
      const record = sanitizedRecord(message.data,sender.tab.id);
      if (!record) return {ok:false};
      await chrome.storage.session.set({[KEY]:record});
      return {ok:true};
    }, respond);
  });
})();
