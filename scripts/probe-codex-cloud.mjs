#!/usr/bin/env node
/** Read-only Codex cloud capability probe. Raw task data never leaves memory. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const exec = promisify(execFile);
const MAX_BYTES = 65536;
const STATUS_CODES = new Set([
  "pending", "queued", "running", "in_progress", "waiting",
  "completed", "complete", "succeeded", "success", "failed",
  "error", "cancelled", "canceled",
]);
const LIMITATION =
  "CLI task visibility is account-specific. An empty list does not prove no Codex or ChatGPT Work task is running.";

/** Shell-less, bounded execution: never forward CLI stdout/stderr on failure. */
export async function runCodex(args) {
  try {
    const { stdout } = await exec("codex", args, {
      encoding: "utf8",
      timeout: 12000,
      maxBuffer: MAX_BYTES,
      shell: false,
      windowsHide: true,
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false };
  }
}

/** Never include identifiers, titles, summaries, URLs or unknown status strings. */
export function summarizeCloudList(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_BYTES)
    return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !data || typeof data !== "object" || Array.isArray(data) ||
    !Array.isArray(data.tasks) || data.tasks.length > 20 ||
    !(data.cursor === null || data.cursor === undefined ||
      (typeof data.cursor === "string" && data.cursor.length <= 4096))
  ) return null;
  const statuses = Object.create(null);
  for (const task of data.tasks) {
    if (!task || typeof task !== "object" || Array.isArray(task) ||
        typeof task.status !== "string") return null;
    const normalized = task.status.toLowerCase();
    const status = STATUS_CODES.has(normalized) ? normalized : "unmapped";
    statuses[status] = (statuses[status] || 0) + 1;
  }
  return {
    result: data.tasks.length ? "tasks-visible" : "empty-unverified",
    visibleTaskCount: data.tasks.length,
    statusCounts: Object.fromEntries(Object.entries(statuses).sort()),
    hasMorePages: typeof data.cursor === "string" && data.cursor.length > 0,
  };
}

export async function probeCodexCloud({ runner = runCodex } = {}) {
  const auth = await runner(["login", "status"]);
  if (!auth || auth.ok !== true) {
    return { cliAuth: "unavailable", list: "not-checked", limitation: LIMITATION };
  }
  const response = await runner(["cloud", "list", "--json", "--limit", "20"]);
  if (!response || response.ok !== true) {
    return { cliAuth: "present", list: "unavailable", limitation: LIMITATION };
  }
  const summary = summarizeCloudList(response.stdout);
  if (!summary) {
    return { cliAuth: "present", list: "unsupported-shape", limitation: LIMITATION };
  }
  return { cliAuth: "present", list: "readable", ...summary, limitation: LIMITATION };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Do not log errors or raw CLI output, which may contain private task details.
  probeCodexCloud().then((result) => {
    process.stdout.write(JSON.stringify(result) + "\n");
  }).catch(() => {
    process.stdout.write(JSON.stringify({ cliAuth: "unknown", list: "unavailable", limitation: LIMITATION }) + "\n");
    process.exitCode = 1;
  });
}
