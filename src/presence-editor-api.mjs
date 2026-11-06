/** One explicitly paired editor. No document, path, repo, title or account data. */
import { digest, secureRandom } from "./listening-crypto.mjs";
import {
  isListeningOwner,
  validOwnerOrigin,
  readSmallJson,
  ownerJson,
  ownerError,
} from "./listening-owner-core.mjs";
import { approvedProjects } from "./presence-preferences.mjs";
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const secret = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const row = (db) =>
  db.prepare("SELECT * FROM presence_state WHERE id=1").first();
const credential = (db) =>
  db.prepare("SELECT * FROM presence_editor WHERE id=1").first();
export function createPresenceEditorApi({ clock = Date.now } = {}) {
  return async (request, env = {}, ctx = {}) => {
    if (
      env.PRESENCE_ENABLED !== "true" ||
      env.PRESENCE_EDITOR_ENABLED !== "true" ||
      !env.LISTENING_DB
    )
      return ownerError("Not found", 404);
    const path = new URL(request.url).pathname;
    const db = env.LISTENING_DB;
    const owner = path === "/api/presence/editor/pairing";
    if (owner && !(await isListeningOwner(env, ctx)))
      return ownerError("Owner authentication required", 403);
    if (!["POST", "DELETE", "GET"].includes(request.method))
      return ownerError("Method not allowed", 405);
    if (owner && request.method !== "GET" && !validOwnerOrigin(request))
      return ownerError("Cross-site operation denied", 403);
    try {
      const at = clock();
      if (owner) {
        const state = await row(db);
        if (!state) return ownerError("Database migration required");
        if (request.method === "GET") {
          const current = await credential(db);
          return ownerJson({
            paired:
              !!current?.token_hash &&
              current.token_until > at &&
              current.generation === state.editor_generation,
            expiresAt:
              current?.token_until > at
                ? new Date(current.token_until).toISOString()
                : null,
          });
        }
        if (request.method === "DELETE") {
          await db
            .prepare(
              "UPDATE presence_editor SET pair_hash=NULL,pair_until=0,token_hash=NULL,token_until=0,last_at=0,last_received=0 WHERE id=1",
            )
            .run();
          // Clear only editor-observed state, never an owner-declared session.
          await db
            .prepare(
              "UPDATE presence_state SET revision=revision+1,session_source=NULL,session_at=0,session_until=0,project_slug=NULL WHERE id=1 AND session_source='editor-heartbeat'",
            )
            .run();
          return ownerJson({ paired: false });
        }
        const code = secureRandom(32);
        await db
          .prepare(
            "UPDATE presence_editor SET generation=?,pair_hash=?,pair_until=?,token_hash=NULL,token_until=0,last_at=0,last_received=0 WHERE id=1",
          )
          .bind(state.editor_generation, await digest(code), at + 300_000)
          .run();
        return ownerJson({
          pairCode: code,
          expiresAt: new Date(at + 300_000).toISOString(),
        });
      }
      if (request.method !== "POST")
        return ownerError("Method not allowed", 405);
      let data;
      try {
        data = await readSmallJson(request);
      } catch {
        return ownerError("Invalid editor request", 400);
      }
      if (path === "/api/presence/editor/claim") {
        if (!exact(data, ["pairCode"]) || !secret(data.pairCode))
          return ownerError("Invalid pairing", 400);
        const token = secureRandom(32);
        const result = await db
          .prepare(
            "UPDATE presence_editor SET token_hash=?,token_until=?,pair_hash=NULL,pair_until=0,last_at=0,last_received=0 WHERE id=1 AND pair_hash=? AND pair_until>? AND generation=(SELECT editor_generation FROM presence_state WHERE id=1) RETURNING generation",
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
          projects: approvedProjects(await row(db)),
        });
      }
      if (path !== "/api/presence/editor/heartbeat")
        return ownerError("Not found", 404);
      const authorization = request.headers.get("Authorization") || "";
      if (
        !authorization.startsWith("Bearer ") ||
        !secret(authorization.slice(7))
      )
        return ownerError("Editor authentication required", 401);
      if (
        !exact(data, ["version", "active", "projectSlug", "observedAt"]) ||
        data.version !== 1 ||
        typeof data.active !== "boolean"
      )
        return ownerError("Invalid editor signal", 400);
      const observed =
        typeof data.observedAt === "string" ? Date.parse(data.observedAt) : NaN;
      if (
        !Number.isFinite(observed) ||
        new Date(observed).toISOString() !== data.observedAt ||
        observed > at + 10_000 ||
        observed < at - 120_000
      )
        return ownerError("Invalid editor timestamp", 400);
      const state = await row(db);
      if (
        !state ||
        env.PRESENCE_PUBLIC_RELEASE_APPROVED !== "true" ||
        state.public_enabled !== 1 ||
        state.editor_enabled !== 1
      )
        return ownerError("Editor broadcasting is disabled", 409);
      if (!(
        data.projectSlug === null ||
        approvedProjects(state).includes(data.projectSlug)
      ))
        return ownerError("Project is not approved", 400);
      if (state.paused === 1) return ownerError("Owner session is paused", 409);
      const hash = await digest(authorization.slice(7));
      const current = await credential(db);
      if (
        !current ||
        current.token_hash !== hash ||
        current.token_until <= at ||
        current.generation !== state.editor_generation
      )
        return ownerError("Editor authentication required", 401);
      if (current.last_at >= observed)
        return ownerError("Outdated editor signal", 409);
      if (data.active && current.last_received > at - 20_000)
        return ownerJson({ error: "Signal cooldown" }, 429, {
          "Retry-After": "20",
        });
      const claimed = await db
        .prepare(
          "UPDATE presence_editor SET last_at=?,last_received=? WHERE id=1 AND token_hash=? AND token_until>? AND generation=? AND last_at<? AND (?=0 OR last_received<=?) RETURNING generation",
        )
        .bind(
          observed,
          at,
          hash,
          at,
          state.editor_generation,
          observed,
          Number(data.active),
          at - 20_000,
        )
        .first();
      if (!claimed) return ownerError("Outdated editor signal", 409);
      const source = data.active ? "editor-heartbeat" : null;
      const updated = await db
        .prepare(
          "UPDATE presence_state SET session_source=?,session_at=?,session_until=?,project_slug=?,paused=0 WHERE id=1 AND public_enabled=1 AND editor_enabled=1 AND paused=0 AND editor_generation=? AND (session_source IS NULL OR session_source='editor-heartbeat' OR session_until<=?) AND EXISTS (SELECT 1 FROM presence_editor WHERE id=1 AND token_hash=? AND last_at=? AND last_received=? AND token_until>?)",
        )
        .bind(
          source,
          data.active ? observed : 0,
          data.active ? observed + 120_000 : 0,
          data.active ? data.projectSlug : null,
          state.editor_generation,
          at,
          hash,
          observed,
          at,
          at,
        )
        .run();
      if (updated.meta?.changes !== 1)
        return ownerError("Owner session takes precedence", 409);
      return ownerJson({
        accepted: true,
        expiresAt: data.active
          ? new Date(observed + 120_000).toISOString()
          : null,
      });
    } catch {
      return ownerError("Editor request unavailable");
    }
  };
}
