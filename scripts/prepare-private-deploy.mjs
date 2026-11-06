/** Derive an ephemeral release config from the live, approved Worker deployment. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const privateGates = [
  "PRESENCE_PUBLIC_RELEASE_APPROVED",
  "LISTENING_PUBLIC_RELEASE_APPROVED",
  "GPT_USAGE_READ_ENABLED",
  "GPT_USAGE_WRITE_ENABLED",
];
const plainNames = new Set([
  "LISTENING_OWNER_EMAIL",
  "LISTENING_ACCESS_AUD",
  "LISTENING_ACCESS_AUDS",
  "SPOTIFY_CLIENT_ID",
  "PRESENCE_ENABLED",
  "PRESENCE_EDITOR_ENABLED",
  "LISTENING_COLLECTIONS_ENABLED",
  ...privateGates,
]);
export function privateDeploymentConfig(base, settings, database) {
  const bindings = settings?.bindings;
  if (!Array.isArray(bindings) || !bindings.length)
    throw Error("Deployed private runtime settings unavailable");
  const names = bindings.map((b) => b.name);
  if (new Set(names).size !== names.length)
    throw Error("Duplicate deployed binding requires review");
  for (const b of bindings) {
    if (b.type === "plain_text" &&
        (typeof b.text !== "string" || b.text.length > 1024 ||
         /[\u0000-\u001f\u007f]/.test(b.text)))
      throw Error("Invalid deployed plain-text binding");
  }
  const dbs = bindings.filter((b) => b.type === "d1");
  if (
    dbs.length !== 1 ||
    dbs[0].name !== "LISTENING_DB" ||
    !/^[a-f0-9-]{36}$/.test(dbs[0].id || "")
  )
    throw Error("Dedicated database binding required");
  if (
    database?.uuid !== dbs[0].id ||
    database.name !== "devonakins-listening-private" ||
    database.read_replication?.mode !== "disabled"
  )
    throw Error("Dedicated database identity or replication differs");
  if (
    bindings.some(
      (b) =>
        !(
          b.type === "d1" ||
          (b.type === "secret_text" && b.name === "LISTENING_TOKEN_KEY") ||
          (b.type === "plain_text" && plainNames.has(b.name))
        ),
    )
  )
    throw Error("Unexpected runtime binding requires review");
  if (
    !bindings.some(
      (b) => b.type === "secret_text" && b.name === "LISTENING_TOKEN_KEY",
    )
  )
    throw Error("Encryption key must be configured privately");
  for (const name of ["LISTENING_OWNER_EMAIL", "LISTENING_ACCESS_AUD"]) {
    if (
      !bindings.some(
        (b) =>
          b.type === "plain_text" &&
          b.name === name &&
          typeof b.text === "string" &&
          b.text.length,
      )
    )
      throw Error("Owner identity configuration required");
  }
  for (const name of privateGates) {
    const value = bindings.find((b) => b.name === name);
    if (value && value.text !== "false")
      throw Error("Private deployment requires disclosure gates off");
  }
  if (
    !base.includes('"name": "devonakins-personal"') ||
    !/\n}\s*$/.test(base) ||
    /"(?:d1_databases|vars|keep_vars)"\s*:/.test(base)
  )
    throw Error("Base deployment configuration changed; review required");
  let prefix = base.replace(/}\s*$/, "").trimEnd();
  if (!prefix.endsWith(",")) prefix += ",";
  // An upload-only Cloudflare build may be newer than production yet omit D1
  // and nonsecret variables. Explicitly carry the approved *deployed* vars;
  // keep_vars retains the server-side encryption key without reading it.
  const vars = Object.fromEntries(
    bindings.filter((b) => b.type === "plain_text")
      .map((b) => [b.name, b.text]),
  );
  for (const name of privateGates) vars[name] = "false";
  const extra = {
    d1_databases: [
      {
        binding: "LISTENING_DB",
        database_name: database.name,
        database_id: database.uuid,
        migrations_dir: "migrations",
      },
    ],
    keep_vars: true,
    vars,
  };
  return prefix + "\n" + JSON.stringify(extra, null, 2).slice(1, -1) + "\n}\n";
}
export async function preparePrivateDeployment({
  env = process.env,
  fetcher = fetch,
  read = readFile,
  write = writeFile,
} = {}) {
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!/^[a-f0-9]{32}$/.test(account || "") || !token)
    throw Error("Dedicated Cloudflare CI credentials required");
  async function get(path) {
    const response = await fetcher(
      "https://api.cloudflare.com/client/v4/accounts/" + account + path,
      {
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      throw Error("Private deployment preflight request failed");
    const data = await response.json();
    if (data.success !== true)
      throw Error("Private deployment preflight unavailable");
    return data.result;
  }
  // /settings follows the most recently *uploaded* version, which is not
  // necessarily deployed. A CI upload can lack private bindings entirely.
  const script = "/workers/scripts/devonakins-personal";
  const deployments = await get(script + "/deployments");
  const active = deployments?.deployments?.[0];
  if (active?.versions?.length !== 1 ||
      active.versions[0].percentage !== 100 ||
      !/^[a-f0-9-]{36}$/.test(active.versions[0].version_id || ""))
    throw Error("A single fully deployed Worker version is required");
  const version = await get(
    script + "/versions/" + active.versions[0].version_id,
  );
  const settings = { bindings: version?.resources?.bindings };
  const binding = settings?.bindings?.find(
    (b) => b.type === "d1" && b.name === "LISTENING_DB",
  );
  if (!/^[a-f0-9-]{36}$/.test(binding?.id || ""))
    throw Error("Dedicated database binding required");
  const database = await get("/d1/database/" + binding.id);
  const base = await read("wrangler.jsonc", "utf8");
  await write(
    "wrangler.deploy.jsonc",
    privateDeploymentConfig(base, settings, database),
    { mode: 0o600 },
  );
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  preparePrivateDeployment()
    .then(() =>
      console.log(
        "Private deployment configuration prepared; sharing remains off.",
      ),
    )
    .catch(() => {
      console.error(
        "Private deployment preflight failed. Verify the dedicated runtime binding, owner settings, disclosure gates and CI permissions.",
      );
      process.exitCode = 1;
    });
}
