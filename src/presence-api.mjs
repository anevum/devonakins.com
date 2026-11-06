import { approvedProjects } from "./presence-preferences.mjs";
/** One expiring record. Authenticated writes and a separately gated public view. */
import {
  projectPublicPresence,
  PRESENCE_PROJECTOR_POLICY,
  PUBLIC_PRESENCE_PROJECTS,
  validManualLabel,
} from "./presence-model.mjs";
import {
  isListeningOwner,
  validOwnerOrigin,
  readSmallJson,
  ownerJson,
  ownerError,
} from "./listening-owner-core.mjs";
import { renderPresenceOwner } from "./presence-owner-page.mjs";

const manualStates = [
  "writing",
  "researching",
  "family-time",
  "sleeping",
  "away",
  "custom",
];
const rowQuery = "SELECT * FROM presence_state WHERE id=1";
export const presenceConfigured = (env) =>
  env.PRESENCE_ENABLED === "true" &&
  typeof env.LISTENING_DB?.prepare === "function";
// Direct D1 queries use the primary (no replica session). Every disclosure check
// is a new query, including after awaiting an external Spotify request.
export const presenceRow = (env) => env.LISTENING_DB.prepare(rowQuery).first();
const publicApproved = (env) => env.PRESENCE_PUBLIC_RELEASE_APPROVED === "true";
const iso = (time) => new Date(time).toISOString();

export function presenceInput(row, env, at) {
  const active =
    !!row &&
    row.session_until > at &&
    row.session_at <= at + 10_000 &&
    !row.paused;
  const manual =
    !!row?.manual_state &&
    row.manual_until > at &&
    row.manual_at <= at + 10_000;
  return {
    publicEnabled: publicApproved(env) && row?.public_enabled === 1,
    shareListening: row?.share_listening === 1,
    allowedProjects: approvedProjects(row),
    privateOverride: row?.private_work === 1 && (active || manual),
    manual: manual
      ? {
          approved: true,
          state: row.manual_state,
          asOf: iso(row.manual_at),
          ...(row.manual_state === "custom"
            ? { label: row.manual_label, labelApproved: true }
            : {}),
        }
      : null,
    session: row?.session_at
      ? {
          approved: true,
          source: row.session_source,
          // The projector expires stale heartbeats independently as a second gate.
          asOf: iso(
            active
              ? row.session_at
              : Math.min(row.session_at, at - 31 * 60_000),
          ),
          publicProject: !row.private_work,
          projectSlug: row.project_slug,
        }
      : null,
  };
}
export async function listeningDisclosure(env) {
  if (env.PRESENCE_ENABLED !== "true") return { allowed: true, revision: null };
  if (!presenceConfigured(env) || !publicApproved(env))
    return { allowed: false };
  try {
    const row = await presenceRow(env);
    return {
      allowed:
        row?.public_enabled === 1 &&
        row.share_listening === 1 &&
        !row.private_work,
      revision: row?.revision,
    };
  } catch {
    return { allowed: false };
  }
}
export async function publicPresence(env, readListening, clock = Date.now) {
  const hidden = () => projectPublicPresence(null, clock());
  if (!presenceConfigured(env) || !publicApproved(env)) return hidden();
  try {
    const row = await presenceRow(env);
    if (!row || row.public_enabled !== 1) return hidden();
    const input = presenceInput(row, env, clock());
    if (input.shareListening && !row.private_work) {
      const response = await readListening(env);
      const playback = await response.json();
      input.playback = {
        approved: true,
        playing: playback?.version === 1 && playback.mode === "playing",
        asOf: playback?.updatedAt,
      };
    }
    // Fence in-flight reads against kill/private changes from another request.
    const current = await presenceRow(env);
    if (!current || current.revision !== row.revision) return hidden();
    return projectPublicPresence(input, clock());
  } catch {
    return hidden();
  }
}

export function nextPresenceState(row, data, at) {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).some(
      (k) =>
        ![
          "action",
          "revision",
          "projectSlug",
          "status",
          "minutes",
          "enabled",
          "privateWork",
          "shareListening",
          "projects",
          "label",
          "labelApproved",
          "editorEnabled",
        ].includes(k),
    ) ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0
  )
    throw new Error("Invalid request");
  const next = {
    manual_label: null,
    public_projects_json: null,
    editor_enabled: 0,
    ...row,
  };
  if (data.action === "off") {
    return {
      ...next,
      public_enabled: 0,
      share_listening: 0,
      private_work: 0,
      editor_enabled: 0,
      session_source: null,
      session_at: 0,
      session_until: 0,
      paused: 0,
      project_slug: null,
      manual_state: null,
      manual_label: null,
      manual_at: 0,
      manual_until: 0,
    };
  }
  if (data.action === "projects") {
    if (
      !Array.isArray(data.projects) ||
      data.projects.length > PRESENCE_PROJECTOR_POLICY.publicProjects.length ||
      new Set(data.projects).size !== data.projects.length ||
      !data.projects.every((slug) =>
        Object.hasOwn(PUBLIC_PRESENCE_PROJECTS, slug),
      )
    )
      throw new Error("Invalid projects");
    return {
      ...next,
      public_projects_json: JSON.stringify(data.projects),
      project_slug: data.projects.includes(row.project_slug)
        ? row.project_slug
        : null,
    };
  }
  if (data.action === "settings") {
    if (
      typeof data.enabled !== "boolean" ||
      typeof data.privateWork !== "boolean" ||
      typeof data.shareListening !== "boolean"
    )
      throw new Error("Invalid settings");
    if (
      data.editorEnabled !== undefined &&
      typeof data.editorEnabled !== "boolean"
    )
      throw new Error("Invalid editor setting");
    return {
      ...next,
      public_enabled: Number(data.enabled),
      private_work: Number(data.privateWork),
      share_listening: Number(data.shareListening),
      editor_enabled:
        data.editorEnabled === undefined
          ? next.editor_enabled
          : Number(data.editorEnabled),
    };
  }
  if (data.action === "start" || data.action === "resume") {
    if (
      ![15, 30].includes(data.minutes) ||
      !(
        data.projectSlug === null ||
        approvedProjects(row).includes(data.projectSlug)
      )
    )
      throw new Error("Invalid session");
    return {
      ...next,
      session_source: "owner-declared",
      session_at: at,
      session_until: at + data.minutes * 60_000,
      paused: 0,
      project_slug: data.projectSlug,
      manual_state: null,
      manual_label: null,
      manual_at: 0,
      manual_until: 0,
    };
  }
  if (data.action === "pause") return { ...next, paused: 1 };
  if (data.action === "end")
    return {
      ...next,
      session_source: null,
      session_at: 0,
      session_until: 0,
      paused: 0,
      project_slug: null,
    };
  if (data.action === "manual") {
    if (!manualStates.includes(data.status) || ![15, 30].includes(data.minutes))
      throw new Error("Invalid status");
    if (
      data.status === "custom" &&
      (data.labelApproved !== true || !validManualLabel(data.label))
    )
      throw new Error("Review the public label first");
    // Manual mode ends any old session so it cannot unexpectedly reappear.
    return {
      ...next,
      session_source: null,
      session_at: 0,
      session_until: 0,
      paused: 0,
      project_slug: null,
      manual_state: data.status,
      manual_label: data.status === "custom" ? data.label : null,
      manual_at: at,
      manual_until: at + data.minutes * 60_000,
    };
  }
  if (data.action === "clear-manual")
    return {
      ...next,
      manual_state: null,
      manual_label: null,
      manual_at: 0,
      manual_until: 0,
    };
  throw new Error("Invalid action");
}
const columns = [
  "public_enabled",
  "share_listening",
  "private_work",
  "session_source",
  "session_at",
  "session_until",
  "paused",
  "project_slug",
  "manual_state",
  "manual_at",
  "manual_until",
  "manual_label",
  "public_projects_json",
  "editor_enabled",
];
function status(row, env, at) {
  return {
    revision: row.revision,
    publishingAllowed: publicApproved(env),
    enabled: row.public_enabled === 1,
    shareListening: row.share_listening === 1,
    privateWork: row.private_work === 1,
    editorEnabled: row.editor_enabled === 1,
    paused: row.paused === 1,
    sessionExpiresAt: row.session_until > at ? iso(row.session_until) : null,
    projectSlug: row.project_slug,
    manualState: row.manual_state,
    serverTime: iso(at),
    preview: projectPublicPresence(presenceInput(row, env, at), at),
    projects: approvedProjects(row),
    projectCatalog: PUBLIC_PRESENCE_PROJECTS,
  };
}
export function createPresenceOwnerApi({
  clock = Date.now,
  readListening = async () => ownerJson({ version: 1, mode: "hidden" }),
} = {}) {
  return async (request, env = {}, ctx = {}) => {
    if (env.PRESENCE_ENABLED !== "true") return ownerError("Not found", 404);
    if (!(await isListeningOwner(env, ctx)))
      return ownerError("Owner authentication required", 403);
    const path = new URL(request.url).pathname;
    if (
      (path === "/owner/presence/" || path === "/owner/presence") &&
      request.method === "GET"
    ) {
      return new Response(renderPresenceOwner(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-store",
          "CDN-Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        },
      });
    }
    if (!presenceConfigured(env))
      return ownerError("Private integration is not configured");
    if (path !== "/api/presence/owner") return ownerError("Not found", 404);
    if (!["GET", "POST"].includes(request.method))
      return ownerError("Method not allowed", 405);
    if (request.method === "POST" && !validOwnerOrigin(request))
      return ownerError("Cross-site operation denied", 403);
    try {
      const at = clock();
      const row = await presenceRow(env);
      if (!row) return ownerError("Database migration required");
      if (request.method === "GET")
        return ownerJson({
          ...status(row, env, at),
          preview: await publicPresence(env, readListening, clock),
        });
      let data, next;
      try {
        data = await readSmallJson(request);
        next = nextPresenceState(row, data, at);
      } catch {
        return ownerError("Invalid request", 400);
      }
      const off = data.action === "off";
      if (!off && data.revision !== row.revision)
        return ownerError("State changed. Refresh before trying again.", 409);
      if (next.public_enabled && !publicApproved(env))
        return ownerError("Public release is not approved", 403);
      if (!off && row.changed_at > at - 1000)
        return ownerJson({ error: "Please wait a moment" }, 429, {
          "Retry-After": "1",
        });
      // Off is idempotent and bypasses rate/revision checks. Any concurrent old
      // settings write loses its CAS; a stale browser cannot re-enable sharing.
      const query =
        "UPDATE presence_state SET revision=revision+1," +
        columns.map((k) => k + "=?").join(",") +
        (off ? ",editor_generation=editor_generation+1" : "") +
        ",changed_at=? WHERE id=1" +
        (off ? "" : " AND revision=?");
      const values = [
        ...columns.map((k) => next[k]),
        at,
        ...(off ? [] : [row.revision]),
      ];
      const result = await env.LISTENING_DB.prepare(query)
        .bind(...values)
        .run();
      if (result.meta?.changes !== 1)
        return ownerError("State changed. Refresh before trying again.", 409);
      return ownerJson({
        ...status(await presenceRow(env), env, at),
        preview: await publicPresence(env, readListening, clock),
      });
    } catch {
      return ownerError("Owner request unavailable");
    }
  };
}
