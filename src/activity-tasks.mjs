import { digest, secureRandom } from "./listening-crypto.mjs";
import {
  isListeningOwner,
  validOwnerOrigin,
  readSmallJson,
  ownerJson,
  ownerError,
} from "./listening-owner-core.mjs";
import { approvedProjects } from "./presence-preferences.mjs";
import { PUBLIC_PRESENCE_PROJECTS } from "./presence-model.mjs";
import {
  CLOUD_STATES,
  CLOUD_CHECKPOINTS,
  CLOUD_TTL_MS,
  cloudTerminal,
  exactCloudKeys,
} from "./cloud-presence-model.mjs";

export const ACTIVITY_SOURCES = Object.freeze([
  "codex",
  "chatgpt-work",
  "github-actions",
]);
const secret = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
const identifier = (v) =>
  typeof v === "string" && /^[A-Za-z0-9_-]{22}$/.test(v);
const ownerRow = (db) =>
  db.prepare("SELECT * FROM presence_state WHERE id=1").first();
const sourceRow = (db, id) =>
  db.prepare("SELECT * FROM activity_sources WHERE id=?").bind(id).first();
const rows = async (statement) => (await statement.all()).results || [];
const allowed = (s, o, at) =>
  s &&
  !s.revoked &&
  s.token_until > at &&
  s.generation === o?.editor_generation &&
  approvedProjects(o).includes(s.project_slug) &&
  Object.hasOwn(PUBLIC_PRESENCE_PROJECTS, s.project_slug);
const publicAllowed = (env, o) =>
  env.PRESENCE_PUBLIC_RELEASE_APPROVED === "true" &&
  o?.public_enabled === 1 &&
  o.private_work !== 1;
export const hiddenTasks = () => ({
  version: 1,
  visibility: "hidden",
  tasks: [],
});

// Public task handles are random, contain no provider identifiers or credential material.
export async function activityTasks(env, at, privateView = false) {
  if (env.PRESENCE_ENABLED !== "true" || !env.LISTENING_DB)
    return hiddenTasks();
  try {
    const db = env.LISTENING_DB,
      o = await ownerRow(db);
    if (!privateView && !publicAllowed(env, o)) return hiddenTasks();
    const sources = await rows(
      db.prepare("SELECT * FROM activity_sources LIMIT 32"),
    );
    const tasks = await rows(
      db.prepare(
        "SELECT * FROM activity_tasks ORDER BY observed_at DESC LIMIT 64",
      ),
    );
    const result = [];
    for (const t of tasks) {
      const s = sources.find((s) => s.id === t.source_id);
      if (
        !allowed(s, o, at) ||
        (!privateView && s.public_enabled !== 1) ||
        t.revoked ||
        t.token_until <= at ||
        !CLOUD_STATES.includes(t.state) ||
        t.observed_at <= at - CLOUD_TTL_MS ||
        t.observed_at > at + 10000
      )
        continue;
      result.push({
        id: t.id,
        source: s.source,
        project: PUBLIC_PRESENCE_PROJECTS[s.project_slug],
        state: t.state,
        checkpoint: CLOUD_CHECKPOINTS.includes(t.checkpoint)
          ? t.checkpoint
          : null,
        asOf: new Date(t.observed_at).toISOString(),
        expiresAt: new Date(
          Math.min(t.observed_at + CLOUD_TTL_MS, t.token_until, s.token_until),
        ).toISOString(),
      });
    }
    // Re-read source/task revisions after asynchronous reads; revocation wins.
    const after = await ownerRow(db);
    const s2 = await rows(
      db.prepare("SELECT id,revision FROM activity_sources LIMIT 32"),
    );
    const t2 = await rows(
      db.prepare("SELECT id,revision FROM activity_tasks LIMIT 64"),
    );
    if (
      after?.revision !== o?.revision ||
      after?.editor_generation !== o?.editor_generation ||
      sources.length !== s2.length ||
      tasks.length !== t2.length ||
      sources.some(
        (s) => s2.find((x) => x.id === s.id)?.revision !== s.revision,
      ) ||
      tasks.some((t) => t2.find((x) => x.id === t.id)?.revision !== t.revision)
    )
      return hiddenTasks();
    return {
      version: 1,
      visibility: privateView ? "private" : "public",
      tasks: result.slice(0, 16),
    };
  } catch {
    return hiddenTasks();
  }
}

export function createActivityTasksApi({ clock = Date.now } = {}) {
  return async (request, env = {}, ctx = {}) => {
    if (env.PRESENCE_ENABLED !== "true" || !env.LISTENING_DB)
      return ownerError("Not found", 404);
    const u = new URL(request.url),
      admin =
        u.pathname === "/api/presence/owner" && u.search === "?channel=tasks";
    if (admin && !(await isListeningOwner(env, ctx)))
      return ownerError("Owner authentication required", 403);
    if (admin && request.method !== "GET" && !validOwnerOrigin(request))
      return ownerError("Cross-site operation denied", 403);
    if (
      !["GET", "POST", "DELETE"].includes(request.method) ||
      (!admin && request.method !== "POST")
    )
      return ownerError("Method not allowed", 405);
    try {
      const db = env.LISTENING_DB,
        at = clock(),
        o = await ownerRow(db);
      if (!o) return ownerError("Database migration required");
      if (admin && request.method === "GET") {
        const list = await rows(
          db.prepare(
            "SELECT * FROM activity_sources ORDER BY created_at DESC LIMIT 32",
          ),
        );
        return ownerJson({
          publishingAllowed: env.PRESENCE_PUBLIC_RELEASE_APPROVED === "true",
          sources: list
            .filter((s) => allowed(s, o, at))
            .map((s) => ({
              id: s.id,
              source: s.source,
              projectSlug: s.project_slug,
              revision: s.revision,
              enabled: s.public_enabled === 1,
              expiresAt: new Date(s.token_until).toISOString(),
            })),
          preview: await activityTasks(env, at, true),
        });
      }
      let data;
      try {
        data = await readSmallJson(request);
      } catch {
        return ownerError("Invalid request", 400);
      }
      if (admin) {
        if (
          request.method === "POST" &&
          exactCloudKeys(data, ["action", "source", "projectSlug"]) &&
          data.action === "connect" &&
          ACTIVITY_SOURCES.includes(data.source) &&
          approvedProjects(o).includes(data.projectSlug)
        ) {
          // Bounded retention: delete only expired reporting credentials and fixed-field signals.
          await db
            .prepare(
              "DELETE FROM activity_tasks WHERE token_until<=? OR revoked=1 OR EXISTS(SELECT 1 FROM activity_sources WHERE id=activity_tasks.source_id AND (revoked=1 OR generation<>?))",
            )
            .bind(at, o.editor_generation)
            .run();
          await db
            .prepare(
              "DELETE FROM activity_sources WHERE (token_until<=? OR revoked=1 OR generation<>?) AND NOT EXISTS (SELECT 1 FROM activity_tasks WHERE source_id=activity_sources.id)",
            )
            .bind(at, o.editor_generation)
            .run();
          const id = secureRandom(16),
            token = secureRandom(32),
            until = at + 30 * 86400000;
          const result = await db
            .prepare(
              "INSERT INTO activity_sources(id,source,project_slug,generation,token_hash,token_until,created_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM activity_sources)<32 AND EXISTS(SELECT 1 FROM presence_state WHERE id=1 AND editor_generation=? AND revision=?)",
            )
            .bind(
              id,
              data.source,
              data.projectSlug,
              o.editor_generation,
              await digest(token),
              until,
              at,
              o.editor_generation,
              o.revision,
            )
            .run();
          if (result.meta?.changes !== 1)
            return ownerError("Source limit or state changed", 409);
          return ownerJson({
            id,
            token,
            expiresAt: new Date(until).toISOString(),
            source: data.source,
            projectSlug: data.projectSlug,
          });
        }
        if (
          request.method === "POST" &&
          exactCloudKeys(data, ["action", "id", "revision", "enabled"]) &&
          data.action === "settings" &&
          identifier(data.id) &&
          Number.isSafeInteger(data.revision) &&
          typeof data.enabled === "boolean"
        ) {
          if (data.enabled && env.PRESENCE_PUBLIC_RELEASE_APPROVED !== "true")
            return ownerError("Public release is not approved", 403);
          const r = await db
            .prepare(
              "UPDATE activity_sources SET public_enabled=?,revision=revision+1 WHERE id=? AND revision=? AND generation=? AND revoked=0 AND token_until>? AND EXISTS(SELECT 1 FROM presence_state WHERE id=1 AND editor_generation=? AND revision=?)",
            )
            .bind(
              Number(data.enabled),
              data.id,
              data.revision,
              o.editor_generation,
              at,
              o.editor_generation,
              o.revision,
            )
            .run();
          return r.meta?.changes === 1
            ? ownerJson({ saved: true })
            : ownerError("State changed", 409);
        }
        if (
          request.method === "DELETE" &&
          exactCloudKeys(data, ["kind", "id"]) &&
          ["source", "task"].includes(data.kind) &&
          identifier(data.id)
        ) {
          // Revoked credentials are inert until expiry and retained only as bounded tombstones.
          const table =
            data.kind === "source" ? "activity_sources" : "activity_tasks";
          await db
            .prepare(
              `UPDATE ${table} SET revoked=1,revision=revision+1 WHERE id=?`,
            )
            .bind(data.id)
            .run();
          return ownerJson({ revoked: true });
        }
        return ownerError("Invalid owner request", 400);
      }
      const auth = request.headers.get("Authorization") || "";
      if (!auth.startsWith("Bearer ") || !secret(auth.slice(7)))
        return ownerError("Reporter authentication required", 401);
      const hash = await digest(auth.slice(7));
      if (u.pathname === "/api/activity/tasks/start") {
        if (!exactCloudKeys(data, ["version"]) || data.version !== 1)
          return ownerError("Invalid start", 400);
        const s = await db
          .prepare("SELECT * FROM activity_sources WHERE token_hash=?")
          .bind(hash)
          .first();
        if (!allowed(s, o, at)) return ownerError("Source unavailable", 401);
        await db
          .prepare(
            "DELETE FROM activity_tasks WHERE token_until<=? OR revoked=1 OR EXISTS(SELECT 1 FROM activity_sources WHERE id=activity_tasks.source_id AND (revoked=1 OR generation<>?))",
          )
          .bind(at, o.editor_generation)
          .run();
        const id = secureRandom(16),
          token = secureRandom(32),
          until = Math.min(at + 86400000, s.token_until);
        // Atomic insert: independently concurrent reporters cannot exceed the task cap or cooldown.
        const r = await db
          .prepare(
            "INSERT INTO activity_tasks(id,source_id,token_hash,token_until,state,observed_at,received_at) SELECT ?,?,?,?,'running',?,? WHERE (SELECT COUNT(*) FROM activity_tasks)<64 AND EXISTS(SELECT 1 FROM activity_sources WHERE id=? AND revision=? AND revoked=0 AND token_until>? AND last_created<=?) AND EXISTS(SELECT 1 FROM presence_state WHERE id=1 AND editor_generation=? AND revision=?) AND NOT EXISTS(SELECT 1 FROM activity_tasks WHERE source_id=? AND received_at>?)",
          )
          .bind(
            id,
            s.id,
            await digest(token),
            until,
            at,
            at,
            s.id,
            s.revision,
            at,
            at - 20000,
            o.editor_generation,
            o.revision,
            s.id,
            at - 20000,
          )
          .run();
        if (r.meta?.changes !== 1)
          return ownerJson(
            { error: "Task limit, cooldown or state changed" },
            429,
            { "Retry-After": "20" },
          );
        await db
          .prepare(
            "UPDATE activity_sources SET last_created=? WHERE id=? AND revoked=0",
          )
          .bind(at, s.id)
          .run();
        return ownerJson({
          id,
          token,
          expiresAt: new Date(until).toISOString(),
          projectSlug: s.project_slug,
          source: s.source,
        });
      }
      if (u.pathname !== "/api/activity/tasks/signal")
        return ownerError("Not found", 404);
      if (
        !exactCloudKeys(data, [
          "version",
          "sequence",
          "state",
          "checkpoint",
          "observedAt",
        ]) ||
        data.version !== 1 ||
        !Number.isSafeInteger(data.sequence) ||
        data.sequence < 1 ||
        !CLOUD_STATES.includes(data.state) ||
        !(
          data.checkpoint === null ||
          CLOUD_CHECKPOINTS.includes(data.checkpoint)
        )
      )
        return ownerError("Invalid task signal", 400);
      const observed =
        typeof data.observedAt === "string" ? Date.parse(data.observedAt) : NaN;
      if (
        !Number.isFinite(observed) ||
        new Date(observed).toISOString() !== data.observedAt ||
        observed > at + 10000 ||
        observed <= at - CLOUD_TTL_MS
      )
        return ownerError("Invalid evidence time", 400);
      const t = await db
        .prepare("SELECT * FROM activity_tasks WHERE token_hash=?")
        .bind(hash)
        .first();
      const s = t ? await sourceRow(db, t.source_id) : null;
      if (!allowed(s, o, at) || !t || t.revoked || t.token_until <= at)
        return ownerError("Task unavailable", 401);
      if (
        cloudTerminal(t.state) ||
        data.sequence <= t.sequence ||
        observed < t.observed_at
      )
        return ownerError("Outdated or finished task", 409);
      if (!cloudTerminal(data.state) && at - t.received_at < 20000)
        return ownerJson({ error: "Signal cooldown" }, 429, {
          "Retry-After": "20",
        });
      const r = await db
        .prepare(
          "UPDATE activity_tasks SET revision=revision+1,sequence=?,state=?,checkpoint=?,observed_at=?,received_at=? WHERE id=? AND revision=? AND revoked=0 AND token_until>? AND EXISTS(SELECT 1 FROM activity_sources WHERE id=? AND revision=? AND revoked=0 AND token_until>?) AND EXISTS(SELECT 1 FROM presence_state WHERE id=1 AND editor_generation=? AND revision=?)",
        )
        .bind(
          data.sequence,
          data.state,
          data.checkpoint,
          observed,
          at,
          t.id,
          t.revision,
          at,
          s.id,
          s.revision,
          at,
          o.editor_generation,
          o.revision,
        )
        .run();
      return r.meta?.changes === 1
        ? ownerJson({
            accepted: true,
            expiresAt: new Date(
              Math.min(observed + CLOUD_TTL_MS, t.token_until),
            ).toISOString(),
          })
        : ownerError("State changed", 409);
    } catch {
      return ownerError("Activity connection unavailable");
    }
  };
}
