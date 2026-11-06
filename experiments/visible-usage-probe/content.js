/* Only injected after the owner presses Start on a permitted tab. */
(() => {
  "use strict";
  if (globalThis.__devonVisibleUsageProbe) return;
  const schema = globalThis.__devonVisibleUsageSchema;
  if (!schema) return;
  const POLL_MS = 5_000;
  let target = null;
  let metric = null;
  let reading = null;
  let timer = null;
  let selecting = false;
  let state = "idle";
  let message = "Selection not started";

  function publish() {
    const data = {
      version: 1,
      state,
      message,
      metric,
      reading,
      // A visibility check is not proof the underlying provider updated.
      statusAt: new Date().toISOString(),
    };
    // Session storage is deliberately written only by the trusted extension worker.
    return chrome.runtime.sendMessage({type:"USAGE_PROBE_RECORD", data}).catch(() => {});
  }

  function removeSelection() {
    if (!selecting) return;
    selecting = false;
    document.removeEventListener("click", choose, true);
    document.removeEventListener("keydown", cancelOnEscape, true);
  }
  function stop(quiet = false) {
    removeSelection();
    if (timer !== null) clearInterval(timer);
    timer = null;
    target = null;
    metric = null;
    reading = null;
    state = "stopped";
    message = "Stopped locally; no usage data is being collected";
    return quiet ? Promise.resolve() : publish();
  }
  function cancelOnEscape(event) {
    if (event.key !== "Escape") return;
    removeSelection();
    state = "idle";
    message = "Selection cancelled";
    publish();
  }
  function visible(node) {
    if (!node || !node.isConnected || document.hidden) return false;
    if (typeof node.getClientRects === "function" && node.getClientRects().length === 0) return false;
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden";
  }
  function capture() {
    if (!target) return;
    if (document.hidden) {
      state = "paused";
      message = "Tab hidden; collection paused";
      publish();
      return;
    }
    if (!visible(target)) {
      if (timer !== null) clearInterval(timer);
      timer = null;
      target = null;
      state = "stale";
      message = "Selected number disappeared; select it again";
      publish();
      return;
    }
    const parsed = schema.parseVisibleNumber(target.textContent ?? "", metric);
    if (!parsed) {
      if (timer !== null) clearInterval(timer);
      timer = null;
      target = null;
      state = "stale";
      message = "Selected element is no longer a recognized numeric reading";
      publish();
      return;
    }
    const at = new Date().toISOString();
    const lastChangedAt = reading && reading.value === parsed.value && reading.unit === parsed.unit
      ? reading.lastChangedAt : at;
    reading = schema.createReading(metric, parsed, at, lastChangedAt);
    state = "observing";
    message = "Visible reading sampled; provider update time unknown";
    publish();
  }
  function choose(event) {
    // During explicit selection, prevent accidental navigation or form submission.
    event.preventDefault();
    event.stopImmediatePropagation();
    // Never inspect the entire page, forms, hidden panels, or arbitrary URLs.
    let node = event.target;
    let parsed = null;
    for (let i = 0; i < 3 && node && node.nodeType === 1; i++, node = node.parentElement) {
      parsed = schema.parseVisibleNumber(node.textContent ?? "", metric);
      if (parsed && visible(node)) break;
      parsed = null;
    }
    if (!parsed || !node) {
      state = "selecting";
      message = "Click the digits themselves, not a whole panel or a label";
      publish();
      return;
    }
    removeSelection();
    target = node;
    capture();
    timer = setInterval(capture, POLL_MS);
  }
  function begin(nextMetric) {
    if (!schema.allowedMetrics.includes(nextMetric)) return {ok:false};
    void stop(true);
    metric = nextMetric;
    reading = null;
    selecting = true;
    state = "selecting";
    message = "Click the visible number on the usage page; Esc cancels";
    document.addEventListener("click", choose, true);
    document.addEventListener("keydown", cancelOnEscape, true);
    publish();
    return {ok:true};
  }
  function visibilityChanged() {
    if (target) capture();
  }
  document.addEventListener("visibilitychange", visibilityChanged);
  chrome.runtime.onMessage.addListener((data, _sender, respond) => {
    if (!data || typeof data !== "object") return;
    if (data.type === "USAGE_PROBE_SELECT") respond(begin(data.metric));
    if (data.type === "USAGE_PROBE_STOP") {
      void stop().then(() => respond({ok:true}), () => respond({ok:false}));
      return true;
    }
    if (data.type === "USAGE_PROBE_STATUS") respond({ok:true,state,message});
  });
  globalThis.__devonVisibleUsageProbe = Object.freeze({version:1});
})();
