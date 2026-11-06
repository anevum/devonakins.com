import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  privateDeploymentConfig,
  preparePrivateDeployment,
} from "../scripts/prepare-private-deploy.mjs";
const base = readFileSync(
  new URL("../wrangler.jsonc", import.meta.url),
  "utf8",
);
const id = "00000000-0000-0000-0000-000000000001";
const database = {
  uuid: id,
  name: "devonakins-listening-private",
  read_replication: { mode: "disabled" },
};
const settings = () => ({
  bindings: [
    { type: "d1", name: "LISTENING_DB", id },
    { type: "secret_text", name: "LISTENING_TOKEN_KEY" },
    {
      type: "plain_text",
      name: "LISTENING_OWNER_EMAIL",
      text: "owner@example.test",
    },
    {
      type: "plain_text",
      name: "LISTENING_ACCESS_AUD",
      text: "synthetic-audience",
    },
  ],
});
test("private release carries only the dedicated D1 and forces disclosure off without copying private values", () => {
  const config = privateDeploymentConfig(base, settings(), database);
  const parsed = JSON.parse(config.replace(/,\s*([}\]])/g, "$1"));
  assert.equal(parsed.name, "devonakins-personal");
  assert.equal(parsed.d1_databases[0].database_id, id);
  assert.equal(parsed.keep_vars, true);
  assert.deepEqual(Object.values(parsed.vars), [
    "false",
    "false",
    "false",
    "false",
  ]);
  assert.doesNotMatch(
    config,
    /owner@example|synthetic-audience|LISTENING_TOKEN_KEY/,
  );
});
test("foreign database, extra bindings, missing key and enabled disclosure stop a release", () => {
  assert.throws(() =>
    privateDeploymentConfig(base, settings(), {
      ...database,
      name: "other-project",
    }),
  );
  assert.throws(() =>
    privateDeploymentConfig(base, settings(), {
      ...database,
      read_replication: { mode: "auto" },
    }),
  );
  const extra = settings();
  extra.bindings.push({ type: "kv_namespace", name: "OTHER" });
  assert.throws(() => privateDeploymentConfig(base, extra, database));
  const key = settings();
  key.bindings = key.bindings.filter((b) => b.type !== "secret_text");
  assert.throws(() => privateDeploymentConfig(base, key, database));
  const publicSettings = settings();
  publicSettings.bindings.push({
    type: "plain_text",
    name: "PRESENCE_PUBLIC_RELEASE_APPROVED",
    text: "true",
  });
  assert.throws(() => privateDeploymentConfig(base, publicSettings, database));
});
test("a competing checked-in binding is not silently overwritten", () => {
  assert.throws(() =>
    privateDeploymentConfig(
      base.replace('"routes":', '"vars": {}, "routes":'),
      settings(),
      database,
    ),
  );
});
test("deployment preflight uses bounded authenticated provider reads and writes an untracked private config", async () => {
  const calls = [];
  let written;
  await preparePrivateDeployment({
    env: {
      CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
      CLOUDFLARE_API_TOKEN: "synthetic-ci-credential",
    },
    read: async () => base,
    write: async (...args) => {
      written = args;
    },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return Response.json({
        success: true,
        result: url.endsWith("/settings") ? settings() : database,
      });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.redirect, "error");
  assert.ok(calls[0].options.signal);
  assert.equal(written[0], "wrangler.deploy.jsonc");
  assert.equal(written[2].mode, 0o600);
  assert.doesNotMatch(written[1], /synthetic-ci-credential/);
});
test("provider failures create no deployment file and expose no provider response or credential", async () => {
  let writes = 0;
  await assert.rejects(
    preparePrivateDeployment({
      env: {
        CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
        CLOUDFLARE_API_TOKEN: "synthetic-ci-credential",
      },
      write: async () => {
        writes++;
      },
      fetcher: async () =>
        new Response("PRIVATE_PROVIDER_DETAIL", { status: 403 }),
    }),
    (e) =>
      !e.message.includes("PRIVATE_PROVIDER_DETAIL") &&
      !e.message.includes("synthetic-ci-credential"),
  );
  assert.equal(writes, 0);
});
