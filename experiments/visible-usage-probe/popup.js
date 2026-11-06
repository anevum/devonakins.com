/* All data stays within the browser extension session unless the user copies it. */
(() => {
  "use strict";
  const KEY = "devon-visible-usage-probe-v1";
  const byId = id => document.getElementById(id);
  const msg = value => {byId("status").textContent = value;};
  const permitted = raw => {
    try {
      const url = new URL(raw);
      return url.protocol === "https:" &&
        ["chatgpt.com", "chat.openai.com"].includes(url.hostname);
    } catch { return false; }
  };
  async function activeTab() {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id || !permitted(tab.url)) throw new Error("Open a ChatGPT usage page in Chrome or Edge first");
    return tab;
  }
  async function send(tabId, data) {
    return await chrome.tabs.sendMessage(tabId, data);
  }
  async function render() {
    const record = (await chrome.storage.session.get(KEY))[KEY];
    if (!record || typeof record !== "object") {
      msg("Not recording. Select a visible number to begin.");
      byId("reading").textContent = "No value collected";
      byId("timestamps").textContent = "";
      byId("copy").disabled = true;
      return;
    }
    const date = Date.parse(record.statusAt || "");
    const stale = record.state === "observing" &&
      (!Number.isFinite(date) || Date.now() - date > 20_000);
    msg(stale ? "Stale: no recent sample, tab may be closed or suspended" : String(record.message || record.state));
    const reading = record.reading;
    const eligible = Boolean(reading && Number.isFinite(reading.value) &&
      ["credits", "percent"].includes(reading.unit));
    byId("reading").textContent = eligible
      ? String(reading.value) + (reading.unit === "percent" ? "%" : " credits")
      : "No value collected";
    byId("timestamps").textContent = eligible
      ? "Observed: " + reading.observedAt + " | Number changed: " + reading.lastChangedAt +
        " | Provider update time: unknown"
      : "";
    byId("copy").disabled = !eligible;
  }
  byId("begin").addEventListener("click", async () => {
    try {
      const tab = await activeTab();
      // Stop prior session (if any) so only one number is monitored.
      const previous = (await chrome.storage.session.get(KEY))[KEY];
      if (previous?.tabId && previous.tabId !== tab.id) {
        try { await send(previous.tabId, {type:"USAGE_PROBE_STOP"}); } catch { /* Old tab closed. */ }
      }
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:["metric-schema.js", "content.js"]});
      const selected = await send(tab.id, {
        type:"USAGE_PROBE_SELECT", metric:byId("metric").value,
      });
      if (!selected?.ok) throw new Error("Unable to select the metric");
      msg("Return to the page and click the visible digits. Esc cancels.");
    } catch (error) { msg(error instanceof Error ? error.message : "Selection unavailable"); }
  });
  byId("stop").addEventListener("click", async () => {
    const previous = (await chrome.storage.session.get(KEY))[KEY];
    if (previous?.tabId) {
      try { await send(previous.tabId, {type:"USAGE_PROBE_STOP"}); } catch { /* Tab closed. */ }
    }
    await chrome.storage.session.remove(KEY);
    byId("manual").hidden = true;
    await render();
  });
  byId("copy").addEventListener("click", async () => {
    const record = (await chrome.storage.session.get(KEY))[KEY];
    if (!record?.reading) return;
    const reading = record.reading;
    const report = JSON.stringify({
      version:1, metric:reading.metric, value:reading.value, unit:reading.unit,
      source:reading.source, scope:reading.scope,
      observedAt:reading.observedAt, lastChangedAt:reading.lastChangedAt,
      sourceUpdatedAt:null,
    }, null, 2);
    try {
      await navigator.clipboard.writeText(report);
      msg("Local numeric reading copied. Nothing was uploaded.");
    } catch {
      const manual = byId("manual");
      manual.hidden = false;
      manual.value = report;
      manual.focus();
      manual.select();
      msg("Clipboard blocked. Select and copy the report below.");
    }
  });
  void render();
  window.setInterval(() => { void render(); }, 1_000);
})();
