import test from "node:test";
import assert from "node:assert/strict";
import { probeCodexCloud, summarizeCloudList } from "../scripts/probe-codex-cloud.mjs";

const privateData = {
  tasks: [
    { id: "private-task-id-123", title: "Private clinical file", url: "https://example.test/private", summary: "secret", status: "running", updated_at: "2026-11-06T20:00:00Z" },
    { id: "different-task", title: "family", status: "Completed" },
    { status: "PRIVATE_PATIENT_SECRET" },
  ], cursor: "private-pagination-token"
};
test("read-only probe reports only bounded status counts and no private data", async () => {
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    return { ok: true, stdout: args[0] === "cloud" ? JSON.stringify(privateData) : "Logged in using ChatGPT" };
  };
  const result = await probeCodexCloud({ runner });
  assert.deepEqual(calls, [["login", "status"], ["cloud", "list", "--json", "--limit", "20"]]);
  assert.equal(result.cliAuth, "present");
  assert.equal(result.result, "tasks-visible");
  assert.equal(result.visibleTaskCount, 3);
  assert.deepEqual(result.statusCounts, { completed: 1, running: 1, unmapped: 1 });
  assert.equal(result.hasMorePages, true);
  const report = JSON.stringify(result);
  for (const privateValue of ["private-task-id-123", "Private clinical file", "private-pagination-token", "secret", "PRIVATE_PATIENT_SECRET", "https://example.test/private"])
    assert.equal(report.includes(privateValue), false, privateValue);
});
test("empty CLI results must not be classified as an idle or verified state", async () => {
  const result = await probeCodexCloud({ runner: async (args) =>
    ({ ok: true, stdout: args[0] === "cloud" ? '{"tasks":[],"cursor":null}' : "Logged in" }) });
  assert.equal(result.result, "empty-unverified");
  assert.equal(result.visibleTaskCount, 0);
  assert.match(result.limitation, /does not prove/);
  assert.equal(JSON.stringify(result).includes("idle"), false);
});
test("missing authentication never queries the cloud task list", async () => {
  const calls = [];
  const result = await probeCodexCloud({ runner: async args => { calls.push(args); return { ok: false, stdout: "token-secret" }; } });
  assert.equal(result.cliAuth, "unavailable");
  assert.equal(result.list, "not-checked");
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(result).includes("token-secret"), false);
});
test("command failure, unsupported JSON and malformed task records fail closed", async () => {
  const unavailable = await probeCodexCloud({ runner: async args => ({ ok: args[0] !== "cloud" }) });
  assert.equal(unavailable.list, "unavailable");
  for (const input of [
    "not-json", "{}", "[]", '{"tasks":[{}]}',
    JSON.stringify({ tasks: Array.from({length:21},()=>({ status:"running" })) }),
    JSON.stringify({ tasks:[{status:8}] }),
    JSON.stringify({ tasks:[], cursor:{ token:"private" } }),
    "x".repeat(65537)
  ]) assert.equal(summarizeCloudList(input), null);
});
test("prototype-looking statuses are safely counted", () => {
  const result = summarizeCloudList(JSON.stringify({ tasks: [
    { status: "__proto__" }, { status: "constructor" }, { status:"running" }
  ] }));
  assert.deepEqual(result.statusCounts, { running: 1, unmapped: 2 });
});
