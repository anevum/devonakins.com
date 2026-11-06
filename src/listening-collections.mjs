/** Explicitly selected, owner-created public playlists. No private library scan. */
import {
  spotifyCredentials,
  SpotifyPause,
  SpotifyProbeSuperseded,
} from "./listening-playback-probe.mjs";
import { secureRandom } from "./listening-crypto.mjs";
import {
  isListeningOwner,
  validOwnerOrigin,
  readSmallJson,
  ownerJson,
  ownerError,
} from "./listening-owner-core.mjs";
import { retryDelayMs } from "./spotify-presence.mjs";
const row = (db) =>
  db.prepare("SELECT * FROM listening_collections WHERE id=1").first();
const account = (db) =>
  db.prepare("SELECT * FROM listening_account WHERE id=1").first();
const validId = (v) => typeof v === "string" && /^[A-Za-z0-9]{22}$/.test(v);
const validIds = (v) =>
  Array.isArray(v) &&
  v.length <= 12 &&
  new Set(v).size === v.length &&
  v.every(validId);
const hidden = () =>
  ownerJson({ version: 1, status: "hidden", checkedAt: null, playlists: [] });
const unavailable = () =>
  ownerJson({
    version: 1,
    status: "unavailable",
    checkedAt: null,
    playlists: [],
  });
class CollectionsBusy extends Error {}
function enabled(env) {
  return env.LISTENING_COLLECTIONS_ENABLED === "true" && !!env.LISTENING_DB;
}
async function disclosure(env) {
  if (env.LISTENING_PUBLIC_RELEASE_APPROVED !== "true") return false;
  if (env.PRESENCE_ENABLED !== "true") return true;
  const p = await env.LISTENING_DB.prepare(
    "SELECT public_enabled,private_work FROM presence_state WHERE id=1",
  ).first();
  return (
    env.PRESENCE_PUBLIC_RELEASE_APPROVED === "true" &&
    p?.public_enabled === 1 &&
    p.private_work === 0
  );
}
export function projectPlaylist(value, id, ownerId) {
  if (
    !value ||
    value.id !== id ||
    value.type !== "playlist" ||
    value.public !== true ||
    typeof ownerId !== "string" ||
    !ownerId ||
    value.owner?.id !== ownerId ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 200
  )
    return null;
  const image = Array.isArray(value.images)
    ? value.images.find(
        (v) =>
          typeof v?.url === "string" &&
          /^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]+$/.test(v.url),
      )?.url
    : null;
  return {
    id,
    title: value.name.trim(),
    url: "https://open.spotify.com/playlist/" + id,
    image: image || null,
  };
}
function cached(raw, ids) {
  if (typeof raw !== "string" || raw.length > 16000) return null;
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length !== ids.length) return null;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (
        !p ||
        Object.keys(p).sort().join("|") !== "id|image|title|url" ||
        p.id !== ids[i] ||
        typeof p.title !== "string" ||
        !p.title.trim() ||
        p.title.length > 200 ||
        p.url !== "https://open.spotify.com/playlist/" + ids[i] ||
        !(
          p.image === null ||
          (typeof p.image === "string" &&
            /^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]+$/.test(p.image))
        )
      )
        return null;
    }
    return list;
  } catch {
    return null;
  }
}
async function verifySelections(env, ids, { clock, fetcher }) {
  const db = env.LISTENING_DB;
  const at = clock();
  const original = await account(db);
  if (
    !original?.refresh_cipher ||
    !original.connection_key ||
    original.reauth_due <= at ||
    original.reauth_required
  )
    throw new Error("Connection required");
  if (original.blocked_until > at)
    throw new SpotifyPause(original.blocked_until - at);
  const lease = secureRandom(16);
  const claim = await db
    .prepare(
      "UPDATE listening_account SET lease_id=?,lease_until=? WHERE id=1 AND revision=? AND reauth_required=0 AND refresh_cipher IS NOT NULL AND (lease_id IS NULL OR lease_until<?)",
    )
    .bind(lease, at + 45_000, original.revision, at)
    .run();
  if (claim.meta?.changes !== 1) throw new CollectionsBusy();
  const release = () =>
    db
      .prepare(
        "UPDATE listening_account SET lease_id=NULL,lease_until=0 WHERE id=1 AND lease_id=?",
      )
      .bind(lease)
      .run();
  try {
    const credentials = await spotifyCredentials(
      original,
      env,
      at,
      fetcher,
      async (next) => {
        const saved = await db
          .prepare(
            "UPDATE listening_account SET access_cipher=?,refresh_cipher=?,access_expires=? WHERE id=1 AND lease_id=? AND refresh_cipher=? AND connection_key=?",
          )
          .bind(
            next.accessCipher,
            next.refreshCipher,
            next.expiresAt,
            lease,
            original.refresh_cipher,
            original.connection_key,
          )
          .run();
        return saved.meta?.changes === 1;
      },
    );
    const read = async (path) => {
      const response = await fetcher("https://api.spotify.com/v1" + path, {
        headers: {
          Authorization: "Bearer " + credentials.access,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(7000),
      });
      if (response.status === 429)
        throw new SpotifyPause(
          retryDelayMs(response.headers.get("Retry-After"), clock()),
        );
      if (response.status === 401) throw new SpotifyPause(300000, true);
      if (!response.ok) throw new Error("Playlist verification unavailable");
      if (!response.headers.get("Content-Type")?.includes("application/json")) {
        await response.body?.cancel();
        throw new Error("Unexpected playlist response");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing playlist response");
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 65536) {
            await reader.cancel();
            throw new Error("Playlist response too large");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    };
    const profile = await read("/me");
    if (
      typeof profile.id !== "string" ||
      !profile.id ||
      profile.id.length > 128
    )
      throw new Error("Owner verification unavailable");
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const metadata = await read(
          "/playlists/" +
            id +
            "?fields=id,type,name,public,owner(id),images(url)",
        );
        const projection = projectPlaylist(metadata, id, profile.id);
        if (!projection)
          throw new Error("Only owner-created public playlists are permitted");
        return projection;
      }),
    );
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected) throw rejected.reason;
    const playlists = results.map((result) => result.value);
    const current = await account(db);
    if (
      !current?.refresh_cipher ||
      current.connection_key !== original.connection_key ||
      current.lease_id !== lease
    )
      throw new SpotifyProbeSuperseded();
    return { playlists, connectionKey: original.connection_key };
  } catch (error) {
    if (error instanceof SpotifyPause) {
      await db
        .prepare(
          "UPDATE listening_account SET blocked_until=?,reauth_required=CASE WHEN ?=1 THEN 1 ELSE reauth_required END,public_enabled=CASE WHEN ?=1 THEN 0 ELSE public_enabled END,projection_json=NULL,checked_at=0 WHERE id=1 AND lease_id=? AND connection_key=?",
        )
        .bind(
          clock() + error.delayMs,
          Number(error.reconnect),
          Number(error.reconnect),
          lease,
          original.connection_key,
        )
        .run();
    }
    throw error;
  } finally {
    await release();
  }
}
export function createListeningCollections({
  clock = Date.now,
  fetcher = fetch,
} = {}) {
  const ownerStatus = async (value, env) => {
    const acc = await account(env.LISTENING_DB);
    return {
      revision: value.revision,
      enabled:
        value.enabled === 1 &&
        !!acc?.refresh_cipher &&
        value.connection_key === acc.connection_key,
      ids: JSON.parse(value.ids_json),
      publishingAllowed: env.LISTENING_PUBLIC_RELEASE_APPROVED === "true",
      checkedAt: value.checked_at
        ? new Date(value.checked_at).toISOString()
        : null,
    };
  };
  return {
    async owner(request, env = {}, ctx = {}) {
      if (!enabled(env)) return ownerError("Not found", 404);
      if (!(await isListeningOwner(env, ctx)))
        return ownerError("Owner authentication required", 403);
      if (!["GET", "POST"].includes(request.method))
        return ownerError("Method not allowed", 405);
      if (request.method === "POST" && !validOwnerOrigin(request))
        return ownerError("Cross-site operation denied", 403);
      try {
        const current = await row(env.LISTENING_DB);
        if (!current) return ownerError("Database migration required");
        if (request.method === "GET")
          return ownerJson(await ownerStatus(current, env));
        let data;
        try {
          data = await readSmallJson(request);
        } catch {
          return ownerError("Invalid selection", 400);
        }
        if (
          !data ||
          Object.keys(data).sort().join("|") !== "enabled|ids|revision" ||
          typeof data.enabled !== "boolean" ||
          !validIds(data.ids) ||
          !Number.isSafeInteger(data.revision)
        )
          return ownerError("Invalid selection", 400);
        if (data.revision !== current.revision)
          return ownerError("Selections changed. Reload first.", 409);
        if (data.enabled && env.LISTENING_PUBLIC_RELEASE_APPROVED !== "true")
          return ownerError("Public release is not approved", 403);
        let verified = null;
        if (data.enabled && data.ids.length)
          verified = await verifySelections(env, data.ids, { clock, fetcher });
        const result = await env.LISTENING_DB.prepare(
          "UPDATE listening_collections SET revision=revision+1,enabled=?,ids_json=?,projection_json=?,checked_at=?,connection_key=?,blocked_until=0 WHERE id=1 AND revision=? AND (? IS NULL OR EXISTS (SELECT 1 FROM listening_account WHERE id=1 AND connection_key=? AND refresh_cipher IS NOT NULL))",
        )
          .bind(
            Number(data.enabled),
            JSON.stringify(data.ids),
            verified ? JSON.stringify(verified.playlists) : null,
            verified ? clock() : 0,
            verified?.connectionKey || null,
            current.revision,
            verified?.connectionKey || null,
            verified?.connectionKey || null,
          )
          .run();
        if (result.meta?.changes !== 1)
          return ownerError(
            "Selections or connection changed. Reload first.",
            409,
          );
        return ownerJson(await ownerStatus(await row(env.LISTENING_DB), env));
      } catch {
        return ownerError(
          "Playlist selection unavailable. Verify the Spotify connection and public ownership.",
        );
      }
    },
    async public(env = {}) {
      if (!enabled(env)) return hidden();
      try {
        if (!(await disclosure(env))) return hidden();
        const current = await row(env.LISTENING_DB);
        const acc = await account(env.LISTENING_DB);
        if (
          current?.enabled !== 1 ||
          !acc?.refresh_cipher ||
          acc.reauth_required ||
          acc.reauth_due <= clock()
        )
          return hidden();
        // A new OAuth connection never inherits a prior account's selection
        // consent. The owner must verify and save that selection again.
        if (current.connection_key !== acc.connection_key) return hidden();
        const ids = JSON.parse(current.ids_json);
        if (!validIds(ids)) return unavailable();
        if (!ids.length)
          return ownerJson({
            version: 1,
            status: "empty",
            checkedAt: null,
            playlists: [],
          });
        if (current.blocked_until > clock()) return unavailable();
        let list =
          current.connection_key === acc.connection_key &&
          current.checked_at <= clock() &&
          current.checked_at > clock() - 15 * 60_000
            ? cached(current.projection_json, ids)
            : null;
        if (!list) {
          const verified = await verifySelections(env, ids, { clock, fetcher });
          const result = await env.LISTENING_DB.prepare(
            "UPDATE listening_collections SET projection_json=?,checked_at=?,connection_key=?,blocked_until=0 WHERE id=1 AND revision=? AND enabled=1 AND EXISTS (SELECT 1 FROM listening_account WHERE id=1 AND connection_key=? AND refresh_cipher IS NOT NULL)",
          )
            .bind(
              JSON.stringify(verified.playlists),
              clock(),
              verified.connectionKey,
              current.revision,
              verified.connectionKey,
            )
            .run();
          if (result.meta?.changes !== 1) return hidden();
          list = verified.playlists;
        }
        const final = await row(env.LISTENING_DB);
        const finalAccount = await account(env.LISTENING_DB);
        if (
          final.revision !== current.revision ||
          !finalAccount?.refresh_cipher ||
          finalAccount.reauth_required ||
          finalAccount.connection_key !== acc.connection_key ||
          !(await disclosure(env))
        )
          return hidden();
        return ownerJson({
          version: 1,
          status: "available",
          checkedAt: new Date(final.checked_at).toISOString(),
          playlists: list,
        });
      } catch (error) {
        if (error instanceof CollectionsBusy) return unavailable();
        try {
          await env.LISTENING_DB.prepare(
            "UPDATE listening_collections SET projection_json=NULL,checked_at=0,blocked_until=? WHERE id=1",
          )
            .bind(clock() + 60_000)
            .run();
        } catch {}
        return unavailable();
      }
    },
  };
}
