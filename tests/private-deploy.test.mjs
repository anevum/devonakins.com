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
const activeVersion = "11111111-1111-4111-8111-111111111111";
const uploadedVersion = "22222222-2222-4222-8222-222222222222";
const database = {
  uuid: id,
  name: "devonakins-listening-private",
  read_replication: { mode: "disabled" },
};
const gates = [
  "PRESENCE_PUBLIC_RELEASE_APPROVED",
  "LISTENING_PUBLIC_RELEASE_APPROVED",
  "GPT_USAGE_READ_ENABLED",
  "GPT_USAGE_WRITE_ENABLED",
];
const settings = () => ({
  bindings: [
    { type: "d1", name: "LISTENING_DB", id },
    { type: "secret_text", name: "LISTENING_TOKEN_KEY" },
    { type: "plain_text", name: "LISTENING_OWNER_EMAIL", text: "owner@example.test" },
    { type: "plain_text", name: "LISTENING_ACCESS_AUD", text: "synthetic-audience" },
    { type: "plain_text", name: "SPOTIFY_CLIENT_ID", text: "syntheticspotifyclientid0123456789" },
    { type: "plain_text", name: "PRESENCE_ENABLED", text: "true" },
    { type: "plain_text", name: "PRESENCE_EDITOR_ENABLED", text: "true" },
    { type: "plain_text", name: "LISTENING_COLLECTIONS_ENABLED", text: "true" },
    ...gates.map(name => ({ type: "plain_text", name, text: "false" })),
  ],
});
const installed = ({ percent = 100, versions = [{
  version_id: activeVersion, percentage: percent,
}] } = {}) => ({ deployments: [{ versions }] });
const provider = (url) => {
  if (url.endsWith("/deployments")) return installed();
  if (url.endsWith("/versions/" + activeVersion))
    return { resources: settings() };
  if (url.endsWith("/settings"))
    return { bindings: [{ name: "LISTENING_TOKEN_KEY", type: "secret_text" }] };
  if (url.endsWith("/d1/database/" + id)) return database;
  throw Error("Unapproved test provider path");
};
const clean = (config) => JSON.parse(config.replace(/,\s*([}\]])/g, "$1"));

test("private release retains active owner/Spotify vars, dedicated D1, and closed gates without exporting encryption secret", () => {
  const config = privateDeploymentConfig(base, settings(), database);
  const parsed = clean(config);
  assert.equal(parsed.name, "devonakins-personal");
  assert.equal(parsed.d1_databases[0].database_id, id);
  assert.equal(parsed.keep_vars, true);
  assert.equal(parsed.vars.LISTENING_OWNER_EMAIL, "owner@example.test");
  assert.equal(parsed.vars.LISTENING_ACCESS_AUD, "synthetic-audience");
  assert.equal(parsed.vars.SPOTIFY_CLIENT_ID, "syntheticspotifyclientid0123456789");
  assert.equal(parsed.vars.PRESENCE_ENABLED, "true");
  assert.equal(parsed.vars.PRESENCE_EDITOR_ENABLED, "true");
  assert.equal(parsed.vars.LISTENING_COLLECTIONS_ENABLED, "true");
  assert.ok(gates.every(name => parsed.vars[name] === "false"));
  assert.doesNotMatch(config, /LISTENING_TOKEN_KEY|synthetic-ci-credential/);
});

test("foreign database, extra bindings, missing key, duplicate vars and public disclosure reject release", () => {
  assert.throws(() =>
    privateDeploymentConfig(base, settings(), {
      ...database, name: "other-project",
    }),
  );
  assert.throws(() =>
    privateDeploymentConfig(base, settings(), {
      ...database, read_replication: { mode: "auto" },
    }),
  );
  const extra = settings();
  extra.bindings.push({ type: "kv_namespace", name: "OTHER" });
  assert.throws(() => privateDeploymentConfig(base, extra, database));
  const key = settings();
  key.bindings = key.bindings.filter(b => b.type !== "secret_text");
  assert.throws(() => privateDeploymentConfig(base, key, database));
  const exposed = settings();
  exposed.bindings.find(b => b.name === "PRESENCE_PUBLIC_RELEASE_APPROVED").text = "true";
  assert.throws(() => privateDeploymentConfig(base, exposed, database));
  const duplicate = settings();
  duplicate.bindings.push({ type: "plain_text", name: "SPOTIFY_CLIENT_ID", text: "duplicate" });
  assert.throws(() => privateDeploymentConfig(base, duplicate, database));
  const malformed = settings();
  malformed.bindings.find(b => b.name === "LISTENING_OWNER_EMAIL").text = "owner@example.test\nFORGED_FIELD";
  assert.throws(() => privateDeploymentConfig(base, malformed, database));
});

test("a competing checked-in binding is not silently overwritten", () => {
  assert.throws(() =>
    privateDeploymentConfig(
      base.replace('"routes":', '"vars": {}, "routes":'),
      settings(), database,
    ),
  );
});

test("preflight uses the deployed version, not an unbound latest upload, and writes an untracked private config", async () => {
  const calls = [];
  let written;
  await preparePrivateDeployment({
    env: {
      CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
      CLOUDFLARE_API_TOKEN: "synthetic-ci-credential",
    },
    read: async () => base,
    write: async (...args) => { written = args; },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ success: true, result: provider(url) });
    },
  });
  assert.equal(calls.length, 3);
  assert.ok(calls[0].url.endsWith("/deployments"));
  assert.ok(calls[1].url.endsWith("/versions/" + activeVersion));
  assert.ok(calls[2].url.endsWith("/d1/database/" + id));
  assert.ok(calls.every(c => !c.url.endsWith("/settings")));
  assert.ok(calls.every(c => c.options.redirect === "error" && c.options.signal));
  assert.equal(written[0], "wrangler.deploy.jsonc");
  assert.equal(written[2].mode, 0o600);
  assert.equal(clean(written[1]).vars.SPOTIFY_CLIENT_ID, "syntheticspotifyclientid0123456789");
  assert.doesNotMatch(written[1], /synthetic-ci-credential|LISTENING_TOKEN_KEY/);
});

test("missing, split, and partial production deployments create no deployment config", async () => {
  for (const deployment of [
    { deployments: [] },
    installed({ percent: 75 }),
    installed({ versions: [
      { version_id: activeVersion, percentage: 50 },
      { version_id: uploadedVersion, percentage: 50 },
    ] }),
  ]) {
    let writes = 0;
    await assert.rejects(preparePrivateDeployment({
      env: { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_TOKEN: "synthetic" },
      read: async () => base,
      write: async () => { writes++; },
      fetcher: async url => Response.json({
        success: true,
        result: url.endsWith("/deployments") ? deployment : provider(url),
      }),
    }));
    assert.equal(writes, 0);
  }
});

test("active version missing private DB is not replaced by the staged upload or silently deployed", async () => {
  let writes = 0;
  await assert.rejects(preparePrivateDeployment({
    env: { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_TOKEN: "synthetic" },
    read: async () => base,
    write: async () => { writes++; },
    fetcher: async url => Response.json({
      success: true,
      result: url.endsWith("/versions/" + activeVersion)
        ? { resources: { bindings: [{ type: "secret_text", name: "LISTENING_TOKEN_KEY" }] } }
        : provider(url),
    }),
  }));
  assert.equal(writes, 0);
});

test("public GitHub workflow masks inherited owner values before generating the temporary deployment configuration", async () => {
  const events = [];
  await preparePrivateDeployment({
    env: {
      CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
      CLOUDFLARE_API_TOKEN: "synthetic-ci-credential",
      GITHUB_ACTIONS: "true",
    },
    read: async () => base,
    write: async () => { events.push({ event: "written" }); },
    mask: value => { events.push({ event: "mask", value }); },
    fetcher: async url => Response.json({ success: true, result: provider(url) }),
  });
  const marked = events.filter(x => x.event === "mask").map(x => x.value);
  assert.ok(marked.includes("owner@example.test"));
  assert.ok(marked.includes("synthetic-audience"));
  assert.ok(marked.includes("syntheticspotifyclientid0123456789"));
  assert.equal(events.at(-1).event, "written");
  assert.ok(events.slice(0, -1).every(x => x.event === "mask"));
  assert.ok(!marked.includes("false"));
});

test("provider failures create no deployment file and expose no provider response or credential", async () => {
  let writes = 0;
  await assert.rejects(
    preparePrivateDeployment({
      env: {
        CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
        CLOUDFLARE_API_TOKEN: "synthetic-ci-credential",
      },
      write: async () => { writes++; },
      fetcher: async () =>
        new Response("PRIVATE_PROVIDER_DETAIL", { status: 403 }),
    }),
    e =>
      !e.message.includes("PRIVATE_PROVIDER_DETAIL") &&
      !e.message.includes("synthetic-ci-credential"),
  );
  assert.equal(writes, 0);
});
