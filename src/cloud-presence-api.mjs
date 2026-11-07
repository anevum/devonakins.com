import { digest, secureRandom } from "./listening-crypto.mjs";
import {
  isListeningOwner,
  validOwnerOrigin,
  readSmallJson,
  ownerJson,
  ownerError,
} from "./listening-owner-core.mjs";
import { approvedProjects } from "./presence-preferences.mjs";
import {
  CLOUD_SOURCES,
  CLOUD_TTL_MS,
  cloudTerminal,
  exactCloudKeys,
  validCloudSignal,
  projectCloudPresence,
} from "./cloud-presence-model.mjs";

const credential = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const current = (db) =>
  db.prepare("SELECT * FROM presence_cloud WHERE id=1").first();
const ownerState = (db) =>
  db.prepare("SELECT * FROM presence_state WHERE id=1").first();
const approved = (env) => env.PRESENCE_PUBLIC_RELEASE_APPROVED === "true";
const hidden = () => projectCloudPresence(null, null, Date.now());
export async function publicCloudPresence(env, clock = Date.now) {
  if (env.PRESENCE_ENABLED !== "true" || !approved(env) || !env.LISTENING_DB)
    return hidden();
  try {
    const owner = await ownerState(env.LISTENING_DB);
    if (owner?.public_enabled !== 1 || owner.private_work === 1)
      return hidden();
    const cloud = await current(env.LISTENING_DB);
    const result = projectCloudPresence(cloud, owner, clock(), {
      releaseApproved: true,
    });
    const after = await ownerState(env.LISTENING_DB);
    const latest = await current(env.LISTENING_DB);
    if (
      !after ||
      after.revision !== owner.revision ||
      latest?.revision !== cloud?.revision
    )
      return hidden();
    return result;
  } catch {
    return hidden();
  }
}

export function createCloudPresenceApi({ clock = Date.now } = {}) {
  return async (request, env = {}, ctx = {}) => {
    if (env.PRESENCE_ENABLED !== "true" || !env.LISTENING_DB)
      return ownerError("Not found", 404);
    const url = new URL(request.url);
    const owner =
      url.pathname === "/api/presence/owner" && url.search === "?channel=cloud";
    if (owner && !(await isListeningOwner(env, ctx)))
      return ownerError("Owner authentication required", 403);
    if (owner && !["GET", "POST", "DELETE"].includes(request.method))
      return ownerError("Method not allowed", 405);
    if (owner && request.method !== "GET" && !validOwnerOrigin(request))
      return ownerError("Cross-site operation denied", 403);
    if (!owner && request.method !== "POST")
      return ownerError("Method not allowed", 405);
    const db = env.LISTENING_DB;
    try {
      const at = clock();
      const state = await ownerState(db);
      const cloud = await current(db);
      if (!state || !cloud) return ownerError("Database migration required");
      if (owner) {
        if (request.method === "GET")
          return ownerJson({
            revision: cloud.revision,
            enabled:
              cloud.public_enabled === 1 &&
              cloud.generation === state.editor_generation,
            publishingAllowed: approved(env),
            paired:
              !!cloud.token_hash &&
              cloud.token_until > at &&
              cloud.generation === state.editor_generation,
            privatePreview: projectCloudPresence(cloud, state, at, {
              privateView: true,
            }),
            publicPreview: await publicCloudPresence(env, clock),
          });
        if (request.method === "DELETE") {
          await db
            .prepare(
              "UPDATE presence_cloud SET revision=revision+1,public_enabled=0,pair_hash=NULL,pair_until=0,token_hash=NULL,token_until=0,state=NULL,checkpoint=NULL,project_slug=NULL,observed_at=0,received_at=0 WHERE id=1",
            )
            .run();
          return ownerJson({ disconnected: true });
        }
        let data;
        try {
          data = await readSmallJson(request);
        } catch {
          return ownerError("Invalid request", 400);
        }
        if (
          exactCloudKeys(data, ["action", "source"]) &&
          data.action === "pair" &&
          CLOUD_SOURCES.includes(data.source)
        ) {
          const code = secureRandom(32);
          const result = await db
            .prepare(
              "UPDATE presence_cloud SET revision=revision+1,generation=?,public_enabled=0,source=?,pair_hash=?,pair_until=?,token_hash=NULL,token_until=0,sequence=0,state=NULL,checkpoint=NULL,project_slug=NULL,observed_at=0,received_at=0 WHERE id=1 AND revision=? AND EXISTS (SELECT 1 FROM presence_state WHERE id=1 AND editor_generation=?)",
            )
            .bind(
              state.editor_generation,
              data.source,
              await digest(code),
              at + 300_000,
              cloud.revision,
              state.editor_generation,
            )
            .run();
          if (result.meta?.changes !== 1)
            return ownerError("State changed. Refresh first.", 409);
          return ownerJson({
            pairCode: code,
            expiresAt: new Date(at + 300_000).toISOString(),
          });
        }
        if (
          !exactCloudKeys(data, ["action", "enabled", "revision"]) ||
          data.action !== "settings" ||
          typeof data.enabled !== "boolean" ||
          !Number.isSafeInteger(data.revision)
        )
          return ownerError("Invalid request", 400);
        if (data.enabled && !approved(env))
          return ownerError("Public release is not approved", 403);
        const result = await db
          .prepare(
            "UPDATE presence_cloud SET revision=revision+1,public_enabled=? WHERE id=1 AND revision=? AND generation=? AND EXISTS (SELECT 1 FROM presence_state WHERE id=1 AND editor_generation=?)",
          )
          .bind(
            Number(data.enabled),
            data.revision,
            state.editor_generation,
            state.editor_generation,
          )
          .run();
        if (result.meta?.changes !== 1)
          return ownerError("State changed. Refresh first.", 409);
        return ownerJson({ saved: true });
      }
      let data;
      try {
        data = await readSmallJson(request);
      } catch {
        return ownerError("Invalid cloud request", 400);
      }
      if (url.pathname === "/api/presence/cloud/claim") {
        if (!exactCloudKeys(data, ["pairCode"]) || !credential(data.pairCode))
          return ownerError("Invalid pairing", 400);
        const token = secureRandom(32);
        const result = await db
          .prepare(
            "UPDATE presence_cloud SET revision=revision+1,token_hash=?,token_until=?,pair_hash=NULL,pair_until=0 WHERE id=1 AND pair_hash=? AND pair_until>? AND generation=(SELECT editor_generation FROM presence_state WHERE id=1) RETURNING source",
          )
          .bind(
            await digest(token),
            at + 24 * 60 * 60_000,
            await digest(data.pairCode),
            at,
          )
          .first();
        if (!result) return ownerError("Pairing expired or unavailable", 403);
        return ownerJson({
          token,
          expiresAt: new Date(at + 24 * 60 * 60_000).toISOString(),
          source: result.source,
          projects: approvedProjects(state),
        });
      }
      if (url.pathname !== "/api/presence/cloud/signal")
        return ownerError("Not found", 404);
      const auth = request.headers.get("Authorization") || "";
      if (!auth.startsWith("Bearer ") || !credential(auth.slice(7)))
        return ownerError("Cloud authentication required", 401);
      const hash = await digest(auth.slice(7));
      if (
        cloud.token_hash !== hash ||
        cloud.token_until <= at ||
        cloud.generation !== state.editor_generation
      )
        return ownerError("Cloud authentication required", 401);
      if (
        !validCloudSignal(data, at) ||
        !(
          data.projectSlug === null ||
          approvedProjects(state).includes(data.projectSlug)
        )
      )
        return ownerError("Invalid cloud signal", 400);
      if (
        data.sequence <= cloud.sequence ||
        Date.parse(data.observedAt) < cloud.observed_at ||
        cloudTerminal(cloud.state) ||
        (!cloud.state && data.state !== "running")
      )
        return ownerError(
          "Outdated signal or finished task. Pair a new task to restart.",
          409,
        );
      if (
        data.state === cloud.state &&
        !cloudTerminal(data.state) &&
        cloud.received_at > at - 20_000
      )
        return ownerJson({ error: "Signal cooldown" }, 429, {
          "Retry-After": "20",
        });
      const result = await db
        .prepare(
          "UPDATE presence_cloud SET revision=revision+1,sequence=?,state=?,checkpoint=?,project_slug=?,observed_at=?,received_at=? WHERE id=1 AND token_hash=? AND token_until>? AND revision=? AND generation=? AND EXISTS (SELECT 1 FROM presence_state WHERE id=1 AND editor_generation=? AND revision=?)",
        )
        .bind(
          data.sequence,
          data.state,
          data.checkpoint,
          data.projectSlug,
          Date.parse(data.observedAt),
          at,
          hash,
          at,
          cloud.revision,
          state.editor_generation,
          state.editor_generation,
          state.revision,
        )
        .run();
      if (result.meta?.changes !== 1)
        return ownerError("State changed. Refresh first.", 409);
      return ownerJson({
        accepted: true,
        expiresAt: new Date(
          Math.min(
            Date.parse(data.observedAt) + CLOUD_TTL_MS,
            cloud.token_until,
          ),
        ).toISOString(),
      });
    } catch {
      return ownerError("Cloud connection unavailable");
    }
  };
}
