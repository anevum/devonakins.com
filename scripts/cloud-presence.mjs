#!/usr/bin/env node
/** Explicit task checkpoints only. Never reads Codex accounts or conversations. */
import { mkdir, open, readFile, rename, unlink, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validCloudSignal } from "../src/cloud-presence-model.mjs";

const ORIGIN = "https://devonakins.com";
const secret = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
async function post(path, body, token, fetcher) {
  const response = await fetcher(ORIGIN + path, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (
    !response.ok ||
    !response.headers.get("Content-Type")?.includes("application/json")
  )
    throw Error(
      "Cloud request rejected (HTTP " +
        response.status +
        "). Check pairing, signal order, and cooldown.",
    );
  return response.json();
}
export async function reportCloud({
  command,
  file,
  pairCode,
  state,
  projectSlug = null,
  checkpoint = null,
  clock = Date.now,
  fetcher = fetch,
}) {
  if (!["pair", "signal", "forget"].includes(command))
    throw Error("Use pair, signal, or forget.");
  const path = resolve(file);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = await open(path + ".lock", "wx", 0o600);
  } catch {
    throw Error("Reporter is busy or a previous lock needs review.");
  }
  const temporary = path + ".new";
  try {
    if (command === "forget") {
      try {
        await unlink(path);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      return { forgotten: true };
    }
    let next;
    if (command === "pair") {
      if (!secret(pairCode)) throw Error("Invalid one-time pairing code.");
      try {
        await lstat(path);
        throw Error(
          "A reporter is already paired. Forget it before replacing.",
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const data = await post(
        "/api/presence/cloud/claim",
        { pairCode },
        null,
        fetcher,
      );
      if (
        !secret(data.token) ||
        !Number.isFinite(Date.parse(data.expiresAt)) ||
        !["codex", "chatgpt-work"].includes(data.source)
      )
        throw Error("Invalid pairing response.");
      next = {
        version: 1,
        token: data.token,
        expiresAt: data.expiresAt,
        sequence: 0,
      };
    } else {
      const stat = await lstat(path);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        (stat.mode & 0o077) !== 0 ||
        stat.size > 1024
      )
        throw Error("Reporter credential file must be a private regular file.");
      const saved = JSON.parse(await readFile(path, "utf8"));
      const at = clock();
      if (
        !secret(saved.token) ||
        !Number.isSafeInteger(saved.sequence) ||
        saved.sequence < 0 ||
        Date.parse(saved.expiresAt) <= at ||
        !Number.isFinite(Date.parse(saved.expiresAt))
      )
        throw Error("Pairing is invalid or expired.");
      const data = {
        version: 1,
        sequence: saved.sequence + 1,
        state,
        checkpoint,
        projectSlug,
        observedAt: new Date(at).toISOString(),
      };
      if (!validCloudSignal(data, at))
        throw Error("Invalid task state, checkpoint, or public project.");
      // Reserve sequence before sending: ambiguous network failures must never
      // replay an older event on the next invocation.
      next = { ...saved, sequence: data.sequence };
      await save(next);
      const result = await post(
        "/api/presence/cloud/signal",
        data,
        saved.token,
        fetcher,
      );
      if (result.accepted !== true) throw Error("Signal was not accepted.");
      return { accepted: true, expiresAt: result.expiresAt };
    }
    await save(next);
    return { paired: true, expiresAt: next.expiresAt };
  } finally {
    await lock.close();
    await unlink(path + ".lock");
  }

  async function save(value) {
    const output = await open(temporary, "wx", 0o600);
    try {
      await output.writeFile(JSON.stringify(value));
      await output.sync();
    } catch (error) {
      await unlink(temporary);
      throw error;
    } finally {
      await output.close();
    }
    try {
      await rename(temporary, path);
    } catch (error) {
      await unlink(temporary);
      throw error;
    }
  }
}
async function readPairCode() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 128) throw Error("Invalid pairing code input.");
  }
  return input.trim();
}
export async function main(args = process.argv.slice(2)) {
  const [command, state, ...options] = args;
  if (command === "--help" || !command) {
    process.stdout.write(
      "Cloud task reporter: pair (code on stdin), signal <running|waiting|completed|failed|cancelled> [--project=slug] [--checkpoint=testing|tests-passed|building|reviewing], forget.\nUses DEVON_PRESENCE_FILE or a private user-state file. Pair one task at a time.\n",
    );
    return;
  }
  if (command !== "signal" && args.length !== 1)
    throw Error(
      "Pairing codes must be supplied on stdin, never command arguments.",
    );
  const parsed = {};
  for (const value of options) {
    const match = /^--(project|checkpoint)=([a-z0-9-]+)$/.exec(value);
    if (!match || Object.hasOwn(parsed, match[1]))
      throw Error("Invalid reporter option.");
    parsed[match[1]] = match[2];
  }
  const file =
    process.env.DEVON_PRESENCE_FILE ||
    join(homedir(), ".local", "state", "devon-presence", "cloud.json");
  const result = await reportCloud({
    command,
    file,
    state,
    projectSlug: parsed.project || null,
    checkpoint: parsed.checkpoint || null,
    ...(command === "pair" ? { pairCode: await readPairCode() } : {}),
  });
  process.stdout.write(JSON.stringify(result) + "\n");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    process.stderr.write(
      "Cloud reporter failed. Check pairing, private file permissions, signal order, network access, or cooldown.\n",
    );
    process.exitCode = 1;
  });
}
