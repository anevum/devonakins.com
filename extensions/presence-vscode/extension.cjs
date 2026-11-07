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
    lastSharedEdit = 0,
    enabled = false,
    inFlight = null,
    generation = 0,
    lastObserved = 0,
    forgetting = false,
    disposed = false,
    secretOperations = Promise.resolve(),
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
    if (!disposed) status.text = "Presence: " + text;
  };
  // Keep a delayed credential save ahead of a later Forget Pairing deletion.
  const changeSecret = (operation) => {
    const next = secretOperations.then(operation);
    secretOperations = next.catch(() => {});
    return next;
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
    const currentGeneration = generation;
    const bearer = token;
    // A stop must follow a pending active request. Aborting it does not prove
    // that the server did not accept it, and skipping it leaves activity live.
    if (!active) while (inFlight) await inFlight;
    if (
      disposed ||
      currentGeneration !== generation ||
      token !== bearer ||
      !token ||
      expires <= clock() ||
      (active &&
        (!enabled ||
          inFlight ||
          !lastEdit ||
          lastEdit <= Math.max(lastSharedEdit, lastObserved)))
    )
      return false;
    // The server rejects replayed timestamps, including a pause in the same
    // millisecond as the last edit. Only stop signals may advance by one ms.
    const observed = active ? lastEdit : Math.max(clock(), lastObserved + 1);
    lastObserved = observed;
    const current = () =>
      !disposed && generation === currentGeneration && token === bearer;
    const request = (async () => {
      try {
        await post(
          "/api/presence/editor/heartbeat",
          {
            version: 1,
            active,
            projectSlug: project,
            observedAt: new Date(observed).toISOString(),
          },
          bearer,
        );
        if (current()) {
          lastSent = clock();
          if (active) lastSharedEdit = observed;
          say(active ? "editor active" : "paused");
        }
        return true;
      } catch {
        if (current()) say("not connected");
        return false;
      }
    })();
    inFlight = request;
    try {
      return await request;
    } finally {
      if (inFlight === request) inFlight = null;
    }
  }
  const actions = {
    async pair() {
      if (disposed || forgetting) return;
      const currentGeneration = ++generation;
      enabled = false;
      lastEdit = 0;
      say("pairing, paused");
      await send(false);
      if (disposed || generation !== currentGeneration) return;
      const code = await api.window.showInputBox({
        prompt: "Paste the one-time code from your private presence controls",
        password: true,
        ignoreFocusOut: true,
      });
      if (disposed || generation !== currentGeneration) return;
      if (!code) {
        say(token ? "paired, paused" : "pairing required");
        return;
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
        await api.window.showErrorMessage("Invalid pairing code.");
        return;
      }
      try {
        const data = await post("/api/presence/editor/claim", {
          pairCode: code,
        });
        if (disposed || generation !== currentGeneration) return;
        if (
          typeof data.token !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(data.token) ||
          !Array.isArray(data.projects)
        )
          throw Error("Invalid pairing");
        const nextExpires = Date.parse(data.expiresAt);
        const nextProjects = data.projects.filter(
          (v) => typeof v === "string" && /^[a-z0-9-]{1,40}$/.test(v),
        );
        if (!Number.isFinite(nextExpires) || nextExpires <= clock())
          throw Error("Expired pairing");
        await changeSecret(() => {
          if (disposed || generation !== currentGeneration) return;
          return context.secrets.store(
            SECRET,
            JSON.stringify({
              token: data.token,
              expires: nextExpires,
              projects: nextProjects,
            }),
          );
        });
        if (disposed || generation !== currentGeneration) return;
        token = data.token;
        expires = nextExpires;
        projects = nextProjects;
        if (!projects.includes(project)) project = null;
        enabled = false;
        lastSharedEdit = 0;
        lastObserved = 0;
        say("paired, paused");
        await api.window.showInformationMessage(
          "Paired. Enable editor activity in the private website controls, then choose Resume Sharing here.",
        );
      } catch {
        if (disposed || generation !== currentGeneration) return;
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
      if (disposed || forgetting || !token || expires <= clock()) {
        say("pairing required");
        return;
      }
      generation++;
      enabled = true;
      lastEdit = 0;
      say("waiting for edit");
    },
    async pause() {
      if (disposed || forgetting) return;
      const currentGeneration = ++generation;
      enabled = false;
      lastEdit = 0;
      say("paused");
      await send(false);
      if (generation === currentGeneration)
        say("paused; public signal expires within two minutes if disconnected");
    },
    async disconnect() {
      if (disposed || forgetting) return;
      forgetting = true;
      generation++;
      enabled = false;
      lastEdit = 0;
      say("forgetting pairing");
      await send(false);
      token = null;
      expires = 0;
      try {
        await changeSecret(() => context.secrets.delete(SECRET));
        say("pairing forgotten");
      } catch {
        say("pairing removal failed");
        await api.window.showErrorMessage(
          "Could not remove the saved pairing. Try Forget Pairing again.",
        );
      } finally {
        forgetting = false;
      }
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
      generation++;
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
    const currentGeneration = generation;
    try {
      const data = JSON.parse((await context.secrets.get(SECRET)) || "null");
      if (disposed || generation !== currentGeneration) return;
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
      if (generation === currentGeneration) say("pairing required");
    }
  }
  const dispose = () => {
    disposed = true;
    generation++;
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
