#!/usr/bin/env node
/** Wrap real work once; no timer heartbeats and no command/output content leaves this process. */
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
const ORIGIN = "https://devonakins.com";
const secret = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
export async function activityRequest(path, body, token, fetcher = fetch) {
  if (!secret(token)) throw Error("A valid workspace credential is required.");
  const response = await fetcher(ORIGIN + path, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (
    !response.ok ||
    !response.headers.get("Content-Type")?.includes("application/json")
  )
    throw Error("Activity request rejected (HTTP " + response.status + ").");
  return response.json();
}
export async function runParticipatingTask(
  command,
  {
    sourceToken = process.env.DEVON_ACTIVITY_SOURCE_TOKEN,
    fetcher = fetch,
    clock = Date.now,
    spawnProcess = spawn,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {},
) {
  if (
    !Array.isArray(command) ||
    !command.length ||
    command.some((v) => typeof v !== "string")
  )
    throw Error("Pass the real command after --.");
  const category = command.some((v) => /^(test|check|lint)$/.test(v))
    ? "testing"
    : command.includes("build")
      ? "building"
      : "reviewing";
  let task = null,
    sequence = 0,
    lastSent = 0,
    pending = Promise.resolve(),
    terminal = false;
  const enqueue = (state, checkpoint = null) => {
    if (!task) return Promise.resolve();
    const observed = clock();
    const next = () =>
      activityRequest(
        "/api/activity/tasks/signal",
        {
          version: 1,
          sequence: ++sequence,
          state,
          checkpoint,
          observedAt: new Date(observed).toISOString(),
        },
        task.token,
        fetcher,
      );
    pending = pending.then(next).catch(() => {
      stderr.write(
        "Activity checkpoint unavailable; source will expire automatically.\n",
      );
    });
    return pending;
  };
  if (sourceToken) {
    try {
      task = await activityRequest(
        "/api/activity/tasks/start",
        { version: 1 },
        sourceToken,
        fetcher,
      );
      if (!secret(task.token) || !Number.isFinite(Date.parse(task.expiresAt)))
        throw Error();
      lastSent = clock();
    } catch {
      task = null;
      stderr.write(
        "Activity connection unavailable; continuing the requested command.\n",
      );
    }
  }
  const child = spawnProcess(command[0], command.slice(1), {
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key !== "DEVON_ACTIVITY_SOURCE_TOKEN",
      ),
    ),
  });
  const progress = () => {
    if (!terminal && task && clock() - lastSent >= 30000) {
      lastSent = clock();
      void enqueue("running", category);
    }
  };
  child.stdout?.on("data", (data) => {
    stdout.write(data);
    progress();
  });
  child.stderr?.on("data", (data) => {
    stderr.write(data);
    progress();
  });
  const forward = (signal) => {
    terminal = true;
    child.kill(signal);
  };
  const int = () => forward("SIGINT"),
    term = () => forward("SIGTERM");
  process.once("SIGINT", int);
  process.once("SIGTERM", term);
  const result = await new Promise((resolve) => {
    child.once("error", () => resolve({ code: 1, signal: null }));
    child.once("exit", (code, signal) => resolve({ code: code ?? 1, signal }));
  });
  process.removeListener("SIGINT", int);
  process.removeListener("SIGTERM", term);
  const cancelled = terminal || !!result.signal;
  terminal = true;
  await enqueue(
    cancelled ? "cancelled" : result.code === 0 ? "completed" : "failed",
    !cancelled && result.code === 0 && category === "testing"
      ? "tests-passed"
      : null,
  );
  return result.code;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const index = process.argv.indexOf("--");
  runParticipatingTask(index < 0 ? [] : process.argv.slice(index + 1))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error(
        "Usage: DEVON_ACTIVITY_SOURCE_TOKEN=<runner secret> node scripts/activity-run.mjs -- <command> [args]",
      );
      process.exitCode = 1;
    });
}
