// Access-protected, same-origin owner management. Never stores credentials in localStorage.
const byId = (id) => document.getElementById(id);
const api = "/api/presence/owner?channel=tasks";
let taskBusy = false,
  taskEpoch = 0;
async function request(method = "GET", body) {
  const r = await fetch(api, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok || !r.headers.get("Content-Type")?.includes("application/json"))
    throw Error("Connection unavailable (HTTP " + r.status + ").");
  return r.json();
}
function clearToken() {
  byId("task-token").value = "";
  byId("task-credential").hidden = true;
}
async function refresh() {
  if (taskBusy) return;
  taskBusy = true;
  const epoch = taskEpoch;
  try {
    const [data, ownerResponse] = await Promise.all([
      request(),
      fetch("/api/presence/owner", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    ]);
    if (epoch !== taskEpoch) return;
    if (!ownerResponse.ok) throw Error("Owner session unavailable.");
    const owner = await ownerResponse.json(),
      projects = owner.projects || {};
    const select = byId("task-project"),
      previous = select.value;
    select.replaceChildren();
    for (const item of Array.isArray(projects) ? projects : []) {
      const slug = typeof item === "string" ? item : item.slug;
      if (!slug) continue;
      const option = document.createElement("option");
      option.value = slug;
      option.textContent = owner.projectCatalog?.[slug] || slug;
      select.append(option);
    }
    if (!select.options.length && owner.projectCatalog) {
      for (const [slug, label] of Object.entries(owner.projectCatalog)) {
        const option = document.createElement("option");
        option.value = slug;
        option.textContent = String(label);
        select.append(option);
      }
    }
    if ([...select.options].some((o) => o.value === previous))
      select.value = previous;
    byId("task-connect").disabled = !select.options.length;
    const list = byId("task-sources");
    list.replaceChildren();
    for (const s of data.sources || []) {
      const row = document.createElement("div");
      row.className = "task-owner-row";
      const title = document.createElement("strong");
      title.textContent = s.projectSlug + " · " + s.source;
      row.append(title);
      const enabled = document.createElement("button");
      enabled.type = "button";
      enabled.className = "secondary";
      enabled.textContent = s.enabled
        ? "Hide publicly"
        : "Share approved project";
      enabled.disabled = !data.publishingAllowed;
      enabled.onclick = () =>
        mutate("POST", {
          action: "settings",
          id: s.id,
          revision: s.revision,
          enabled: !s.enabled,
        });
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.textContent = "Revoke workspace";
      revoke.onclick = () => mutate("DELETE", { kind: "source", id: s.id });
      row.append(enabled, revoke);
      list.append(row);
    }
    const tasks = byId("task-running");
    tasks.replaceChildren();
    for (const t of data.preview?.tasks || []) {
      const row = document.createElement("div");
      row.className = "task-owner-row";
      const title = document.createElement("span");
      title.textContent =
        t.project +
        " · " +
        t.state +
        " · " +
        new Date(t.asOf).toLocaleTimeString();
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.textContent = "Revoke task";
      revoke.onclick = () => mutate("DELETE", { kind: "task", id: t.id });
      row.append(title, revoke);
      tasks.append(row);
    }
    byId("task-notice").textContent =
      (data.sources || []).length +
      " connected workspaces. " +
      (data.publishingAllowed
        ? "Project sharing is controlled independently."
        : "Public release gate is off. Private preview only.");
  } catch (e) {
    byId("task-notice").textContent = e.message;
  } finally {
    taskBusy = false;
  }
}
async function mutate(method, body) {
  if (taskBusy) return;
  taskBusy = true;
  const epoch = taskEpoch;
  byId("task-connect").disabled = true;
  try {
    const data = await request(method, body);
    if (epoch !== taskEpoch) return;
    if (data.token) {
      byId("task-token").value = data.token;
      byId("task-credential").hidden = false;
    }
    byId("task-notice").textContent = "Saved.";
  } catch (e) {
    byId("task-notice").textContent = e.message;
  } finally {
    taskBusy = false;
    void refresh();
  }
}
byId("task-connect").onclick = () =>
  mutate("POST", {
    action: "connect",
    source: byId("task-source").value,
    projectSlug: byId("task-project").value,
  });
byId("task-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(byId("task-token").value);
    byId("task-notice").textContent =
      "Copied. Save only in trusted runner secret settings.";
  } catch {
    byId("task-token").focus();
    byId("task-token").select();
    byId("task-notice").textContent = "Select and copy the token.";
  }
};
byId("task-dismiss").onclick = clearToken;
byId("task-refresh").onclick = () => void refresh();
byId("presence-off")?.addEventListener("click", () => {
  taskEpoch++;
  clearToken();
  byId("task-sources").replaceChildren();
  byId("task-running").replaceChildren();
});
document.addEventListener("visibilitychange", () => {
  taskEpoch++;
  clearToken();
  if (!document.hidden) void refresh();
});
window.addEventListener("pagehide", clearToken);
void refresh();

window.setInterval(() => {
  if (!document.hidden) void refresh();
}, 30000);
