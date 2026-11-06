/** No workspace paths, titles, text, repo names or window metadata are read. */
const vscode = require("vscode");
const ORIGIN = "https://devonakins.com";
const SECRET = "devon-presence-pairing-v1";
let cleanup;
function createCompanion(
  api,
  context,
  {
    fetcher = fetch,
    clock = Date.now,
    setTimer = setInterval,
    clearTimer = clearInterval,
  } = {},
) {
  let token = null,
    expires = 0,
    lastEdit = 0,
    lastSent = 0,
    enabled = false,
    busy = false,
    project = null,
    projects = [];
  const status = api.window.createStatusBarItem(
    api.StatusBarAlignment.Right,
    1,
  );
  status.command = "devonPresence.project";
  status.text = "Presence: paused";
  status.show();
  const say = (text) => {
    status.text = "Presence: " + text;
  };
  async function post(path, body, bearer) {
    const response = await fetcher(ORIGIN + path, {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (
      !response.ok ||
      !response.headers.get("Content-Type")?.includes("application/json")
    )
      throw Error("Presence request declined");
    return response.json();
  }
  async function send(active) {
    if (busy || !token || expires <= clock()) return false;
    busy = true;
    try {
      await post(
        "/api/presence/editor/heartbeat",
        {
          version: 1,
          active,
          projectSlug: project,
          observedAt: new Date(clock()).toISOString(),
        },
        token,
      );
      lastSent = clock();
      say(active ? "editor active" : "paused");
      return true;
    } catch {
      say("not connected");
      return false;
    } finally {
      busy = false;
    }
  }
  const actions = {
    async pair() {
      const code = await api.window.showInputBox({
        prompt: "Paste the one-time code from your private presence controls",
        password: true,
        ignoreFocusOut: true,
      });
      if (!code) return;
      if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
        await api.window.showErrorMessage("Invalid pairing code.");
        return;
      }
      try {
        const data = await post("/api/presence/editor/claim", {
          pairCode: code,
        });
        if (
          typeof data.token !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(data.token) ||
          !Array.isArray(data.projects)
        )
          throw Error("Invalid pairing");
        token = data.token;
        expires = Date.parse(data.expiresAt);
        projects = data.projects.filter(
          (v) => typeof v === "string" && /^[a-z0-9-]{1,40}$/.test(v),
        );
        if (!Number.isFinite(expires) || expires <= clock())
          throw Error("Expired pairing");
        await context.secrets.store(
          SECRET,
          JSON.stringify({ token, expires, projects }),
        );
        enabled = false;
        say("paired, paused");
        await api.window.showInformationMessage(
          "Paired. Enable editor activity in the private website controls, then choose Resume Sharing here.",
        );
      } catch {
        token = null;
        enabled = false;
        say("pairing failed");
        await api.window.showErrorMessage(
          "Pairing failed or expired. Create a new code in the private controls.",
        );
      }
    },
    async project() {
      const choice = await api.window.showQuickPick(
        [
          { label: "No public project", slug: null },
          ...projects.map((slug) => ({ label: slug, slug })),
        ],
        {
          placeHolder:
            "Choose an explicitly public project. No workspace names are detected.",
        },
      );
      if (choice) {
        project = choice.slug;
        await context.globalState.update("publicProject", project);
      }
    },
    async resume() {
      if (!token || expires <= clock()) {
        say("pairing required");
        return;
      }
      enabled = true;
      lastEdit = 0;
      say("waiting for edit");
    },
    async pause() {
      enabled = false;
      lastEdit = 0;
      await send(false);
      say("paused; public signal expires within two minutes if disconnected");
    },
    async disconnect() {
      enabled = false;
      lastEdit = 0;
      await send(false);
      token = null;
      expires = 0;
      await context.secrets.delete(SECRET);
      say("pairing forgotten");
    },
  };
  const subscriptions = Object.entries(actions).map(([name, fn]) =>
    api.commands.registerCommand("devonPresence." + name, fn),
  );
  subscriptions.push(
    api.workspace.onDidChangeTextDocument((event) => {
      // Only the existence of an edit is inspected; no document fields are read.
      if (enabled && api.window.state.focused && event.contentChanges.length) {
        lastEdit = clock();
        if (clock() - lastSent >= 60000) void send(true);
      }
    }),
  );
  const timer = setTimer(() => {
    if (!enabled) return;
    if (expires <= clock()) {
      enabled = false;
      token = null;
      say("pairing expired");
      return;
    }
    if (
      lastEdit &&
      api.window.state.focused &&
      clock() - lastEdit < 120000 &&
      clock() - lastSent >= 60000
    )
      void send(true);
    else if (
      lastEdit &&
      (!api.window.state.focused || clock() - lastEdit >= 120000)
    ) {
      lastEdit = 0;
      void send(false);
    }
  }, 60000);
  async function restore() {
    try {
      const data = JSON.parse((await context.secrets.get(SECRET)) || "null");
      if (
        data &&
        typeof data.token === "string" &&
        /^[A-Za-z0-9_-]{43}$/.test(data.token) &&
        data.expires > clock() &&
        Array.isArray(data.projects)
      ) {
        token = data.token;
        expires = data.expires;
        projects = data.projects;
        const saved = context.globalState.get("publicProject");
        project = projects.includes(saved) ? saved : null;
        say("paired, paused");
      }
    } catch {
      say("pairing required");
    }
  }
  const dispose = () => {
    enabled = false;
    clearTimer(timer);
    for (const s of subscriptions) s.dispose();
    status.dispose();
  };
  context.subscriptions.push({ dispose });
  return { actions, ready: restore(), dispose };
}
exports.createCompanion = createCompanion;
exports.activate = (context) => {
  const companion = createCompanion(vscode, context);
  cleanup = companion.dispose;
  return companion.ready;
};
exports.deactivate = () => {
  if (cleanup) cleanup();
};
