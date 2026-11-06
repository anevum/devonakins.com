/**
 * Disabled-by-default, single-record bridge for an explicitly approved
 * Work/Codex *observation*. No OpenAI API, account login, or screen collection.
 *
 * Runtime gates are intentionally separate:
 *   GPT_USAGE_STORE (KV binding)
 *   GPT_USAGE_WRITE_ENABLED = "true"
 *   GPT_USAGE_READ_ENABLED = "true"
 *   GPT_USAGE_INGEST_SECRET (>=32-character random secret)
 *
 * These bindings are NOT configured in wrangler.jsonc. Until separately
 * approved and provisioned, both routes return 404 without accessing KV.
 */
export const OBSERVATION_READ_PATH = "/api/gpt-observation/latest";
export const OBSERVATION_WRITE_PATH = "/api/gpt-observation/ingest";
const STORAGE_KEY = "owner-approved-work-codex-reading-v1";
const RETENTION_SECONDS = 30 * 24 * 60 * 60;
const MIN_WRITE_INTERVAL_MS = 5 * 60_000;
const MAX_OBSERVATION_AGE_MS = 15 * 60_000;
const FRESH_MS = 15 * 60_000;
const MAX_BODY_BYTES = 1024;
const metrics = Object.freeze({
  work_codex_credits_used: "credits",
  work_codex_credits_remaining: "credits",
  work_codex_used_percent: "percent",
  work_codex_remaining_percent: "percent",
});
const exactKeys = (obj, expected) =>
  !!obj && typeof obj === "object" && !Array.isArray(obj) &&
  Object.keys(obj).sort().join("|") === [...expected].sort().join("|");
const isIso = value => typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const isNumber = value => typeof value === "number" &&
  Number.isFinite(value) && value >= 0;

export function validateObservation(input, at = new Date()) {
  if (!exactKeys(input, ["version","metric","value","unit","source","scope",
    "observedAt","lastChangedAt","sourceUpdatedAt"]) ||
      input.version !== 1 || !Object.hasOwn(metrics, input.metric) ||
      input.unit !== metrics[input.metric] || !isNumber(input.value) ||
      input.value > (input.unit === "percent" ? 100 : 1_000_000) ||
      input.source !== "user-selected-visible-usage-text" ||
      input.scope !== "work-codex" ||
      input.sourceUpdatedAt !== null ||
      !isIso(input.observedAt) || !isIso(input.lastChangedAt) ||
      Date.parse(input.lastChangedAt) > Date.parse(input.observedAt) ||
      !Number.isFinite(at.getTime())) return null;
  const age = at.getTime() - Date.parse(input.observedAt);
  if (age < -60_000 || age > MAX_OBSERVATION_AGE_MS) return null;
  // Reconstruction is intentional: never persist raw unexpected properties.
  return {
    version: 1, metric: input.metric, value: input.value, unit: input.unit,
    source: input.source, scope: input.scope, observedAt: input.observedAt,
    lastChangedAt: input.lastChangedAt, sourceUpdatedAt: null,
  };
}

function validateStored(value, at = new Date()) {
  if (!exactKeys(value, ["version", "reading", "receivedAt"]) ||
      value.version !== 1 || !isIso(value.receivedAt) ||
      Date.parse(value.receivedAt) > at.getTime() + 60_000) return null;
  // Stored observations can be old and still usable as explicitly stale.
  const observation = validateObservation(value.reading,
    new Date(Date.parse(value.reading?.observedAt) + 60_000));
  if (!observation || Date.parse(value.receivedAt) <
      Date.parse(observation.observedAt) - 60_000) return null;
  return {version:1,reading:observation,receivedAt:value.receivedAt};
}

function json(value, status, securityHeaders, additional = {}) {
  return new Response(JSON.stringify(value), {
    status, headers: {
      ...securityHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...additional,
    },
  });
}
function unavailableResponse(securityHeaders) {
  return json({error:"Source unavailable"},503,securityHeaders);
}
function disabledResponse(securityHeaders) {
  return json({error:"Not found"},404,securityHeaders);
}
async function readLimitedJson(request) {
  const size = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(size) && size > MAX_BODY_BYTES) return {error:413};
  if (!/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("Content-Type") || "")) return {error:415};
  if (!request.body) return {error:400};
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        return {error:413};
      }
      chunks.push(value);
    }
  } catch {
    return {error:400};
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk,offset);
      offset += chunk.length;
    }
    return {value: JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes))};
  } catch {
    return {error:400};
  }
}
async function validBearer(request, expected) {
  if (typeof expected !== "string" || expected.length < 32 ||
      expected.length > 256) return false;
  const supplied = request.headers.get("Authorization") || "";
  if (!/^Bearer [\x21-\x7e]{32,256}$/.test(supplied)) return false;
  const actual = supplied.slice(7);
  const text = new TextEncoder();
  const [a,b] = await Promise.all([
    crypto.subtle.digest("SHA-256",text.encode(actual)),
    crypto.subtle.digest("SHA-256",text.encode(expected)),
  ]);
  const x=new Uint8Array(a), y=new Uint8Array(b);
  let mismatch=0;
  for(let i=0;i<x.length;i++) mismatch |= x[i]^y[i];
  return mismatch === 0;
}

/** Public projection contains only the one approved numeric observation. */
export function projectObservation(stored, at = new Date()) {
  const valid = validateStored(stored,at);
  if (!valid) return null;
  const r=valid.reading;
  const ageSeconds=Math.max(0,Math.floor(
    (at.getTime()-Date.parse(r.observedAt))/1000));
  return {
    version:1,
    status: ageSeconds * 1000 <= FRESH_MS ? "recent" : "stale",
    metric:r.metric,
    value:r.value,
    unit:r.unit,
    scope:r.scope,
    source:r.source,
    observedAt:r.observedAt,
    lastChangedAt:r.lastChangedAt,
    sourceUpdatedAt:null,
    receivedAt:valid.receivedAt,
  };
}

/**
 * The Worker passes env only at request time, never as a module constant.
 * KV is eventually consistent: the monotonic guard below prevents ordinary
 * replay but is not a global transaction. Use a single authorized writer.
 */
export async function handleObservationRequest(
  request, env = {}, at = new Date(), securityHeaders = {},
) {
  const path = new URL(request.url).pathname;
  const isRead=path===OBSERVATION_READ_PATH;
  const isWrite=path===OBSERVATION_WRITE_PATH;
  if (!isRead && !isWrite) return null;
  const store = env?.GPT_USAGE_STORE;
  if (!store || typeof store.get !== "function" ||
      typeof store.put !== "function") return disabledResponse(securityHeaders);
  if (isRead) {
    if (env.GPT_USAGE_READ_ENABLED !== "true")
      return disabledResponse(securityHeaders);
    if (!["GET","HEAD"].includes(request.method))
      return json({error:"Method not allowed"},405,securityHeaders,
        {Allow:"GET, HEAD"});
    if (request.method==="HEAD")
      return new Response(null,{status:200,headers:{
        ...securityHeaders,"Cache-Control":"no-store",
        "Content-Type":"application/json; charset=utf-8",
      }});
    try {
      const raw=await store.get(STORAGE_KEY,"text");
      if (raw===null) return json({
        version:1,status:"no-data",observation:null,
      },200,securityHeaders);
      const projection=projectObservation(JSON.parse(raw),at);
      return projection
        ? json({version:1,status:projection.status,observation:projection},
            200,securityHeaders)
        : unavailableResponse(securityHeaders);
    } catch {
      return unavailableResponse(securityHeaders);
    }
  }
  if (env.GPT_USAGE_WRITE_ENABLED !== "true" ||
      typeof env.GPT_USAGE_INGEST_SECRET !== "string" ||
      env.GPT_USAGE_INGEST_SECRET.length < 32)
    return disabledResponse(securityHeaders);
  if (request.method!=="POST")
    return json({error:"Method not allowed"},405,securityHeaders,{Allow:"POST"});
  if (!(await validBearer(request,env.GPT_USAGE_INGEST_SECRET)))
    return json({error:"Unauthorized"},401,securityHeaders);
  const parsed=await readLimitedJson(request);
  if (parsed.error)
    return json({error:"Invalid observation request"},parsed.error,securityHeaders);
  const reading=validateObservation(parsed.value,at);
  if (!reading)
    return json({error:"Invalid observation"},400,securityHeaders);
  try {
    const previous=await store.get(STORAGE_KEY,"text");
    if (previous!==null) {
      let saved;
      try { saved=validateStored(JSON.parse(previous),at); }
      catch { saved=null; }
      if (!saved) return unavailableResponse(securityHeaders);
      if (Date.parse(reading.observedAt)<=
          Date.parse(saved.reading.observedAt)) return json({
        accepted:false,reason:"outdated-reading",
      },409,securityHeaders);
      const since=at.getTime()-Date.parse(saved.receivedAt);
      if (since<MIN_WRITE_INTERVAL_MS) return json({
        accepted:false,reason:"write-cooldown",
      },429,securityHeaders,
        {"Retry-After":String(Math.ceil((MIN_WRITE_INTERVAL_MS-since)/1000))});
    }
    const value={version:1,reading,receivedAt:at.toISOString()};
    await store.put(STORAGE_KEY,JSON.stringify(value),
      {expirationTtl:RETENTION_SECONDS});
    return json({accepted:true,receivedAt:value.receivedAt},202,securityHeaders);
  } catch {
    return unavailableResponse(securityHeaders);
  }
}
