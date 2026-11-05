/**
 * Local-only Spotify PKCE authorization. Run on the OWNER'S computer.
 *
 * No public callback or token exchange endpoint is added to the website.
 * Secrets are saved only to mode-0600 files under .local/ (gitignored).
 * Nothing is sent to Cloudflare or publicly enabled by this utility.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, open, lstat, rename, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export const SPOTIFY_SCOPE = "user-read-currently-playing";
export const DEFAULT_PORT = 8787;
const MAX_WAIT_MS = 300_000;

export function redirectURI(port = DEFAULT_PORT) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid local callback port");
  return "http://127.0.0.1:" + port + "/callback";
}
export function makeVerifier() {
  return randomBytes(48).toString("base64url");
}
export function makeState() {
  return randomBytes(32).toString("base64url");
}
export function challengeFromVerifier(verifier) {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier))
    throw new Error("Invalid PKCE verifier");
  return createHash("sha256").update(verifier).digest("base64url");
}
export function authorizationURL({ clientId, port = DEFAULT_PORT, verifier, state }) {
  if (typeof clientId !== "string" || !/^[A-Za-z0-9]{16,64}$/.test(clientId))
    throw new Error("Invalid Spotify client ID");
  if (typeof state !== "string" || !/^[A-Za-z0-9_-]{40,96}$/.test(state))
    throw new Error("Invalid OAuth state");
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectURI(port),
    scope: SPOTIFY_SCOPE,
    state,
    code_challenge_method: "S256",
    code_challenge: challengeFromVerifier(verifier),
  }).toString();
  return url.href;
}
function stateMatches(actual, expected) {
  if (typeof actual !== "string" || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual, "utf8"), Buffer.from(expected, "utf8"));
}
export function parseCallback(target, expectedState, port = DEFAULT_PORT) {
  if (typeof target !== "string" || target.length > 4800)
    throw new Error("Invalid callback");
  const callback = new URL(target, redirectURI(port));
  if (callback.origin !== new URL(redirectURI(port)).origin ||
      callback.pathname !== "/callback" || callback.searchParams.getAll("state").length !== 1)
    throw new Error("Invalid callback");
  if (!stateMatches(callback.searchParams.get("state"), expectedState))
    throw new Error("OAuth state mismatch");
  if (callback.searchParams.has("error"))
    throw new Error("Spotify authorization declined");
  if (callback.searchParams.getAll("code").length !== 1)
    throw new Error("Authorization code missing");
  const code = callback.searchParams.get("code");
  if (!code || code.length > 4000)
    throw new Error("Authorization code invalid");
  return code;
}
export async function exchangeCode({ clientId, code, verifier, port = DEFAULT_PORT, fetcher = fetch }) {
  if (typeof code !== "string" || code.length === 0 || code.length > 4000)
    throw new Error("Invalid authorization code");
  if (typeof clientId !== "string" || !/^[A-Za-z0-9]{16,64}$/.test(clientId))
    throw new Error("Invalid Spotify client ID");
  challengeFromVerifier(verifier);
  const response = await fetcher("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      code_verifier: verifier,
      redirect_uri: redirectURI(port),
    }).toString(),
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error("Spotify token exchange rejected");
  const body = await response.json();
  if (!body || typeof body.refresh_token !== "string" ||
      !/^[^\s]{10,8192}$/.test(body.refresh_token))
    throw new Error("Spotify did not supply a usable refresh token");
  if (typeof body.scope !== "string" ||
      !body.scope.split(/\s+/).includes(SPOTIFY_SCOPE))
    throw new Error("Spotify did not grant the required playback scope");
  if (body.token_type !== "Bearer" || typeof body.access_token !== "string")
    throw new Error("Invalid Spotify token response");
  return { refreshToken: body.refresh_token, scope: SPOTIFY_SCOPE };
}

function sixMonthsLater(authorizedAt) {
  const date = new Date(authorizedAt);
  date.setUTCMonth(date.getUTCMonth() + 6);
  return date.toISOString();
}
async function secureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Credential directory is not a real directory");
  if (info.mode & 0o077) await chmod(directory, 0o700);
}
async function writeSecret(path, contents, replace = false) {
  // Refuse overwriting a prior authorization unless the owner requests it.
  // 'wx' avoids following a pre-existing credential symlink.
  const destination = replace ? path + "." + randomBytes(8).toString("hex") + ".tmp" : path;
  const file = await open(destination, "wx", 0o600);
  try {
    await file.writeFile(contents, { encoding: "utf8" });
  } finally {
    await file.close();
  }
  if (replace) await rename(destination, path);
}
export async function saveCredentials({ directory, clientId, refreshToken, scope, replace = false, now = new Date() }) {
  if (typeof refreshToken !== "string" || !/^[^\s]{10,8192}$/.test(refreshToken))
    throw new Error("Invalid refresh token");
  if (scope !== SPOTIFY_SCOPE) throw new Error("Unexpected Spotify scope");
  await secureDirectory(directory);
  const secretPath = join(directory, "spotify-refresh-token");
  const metadataPath = join(directory, "spotify-connection.json");
  if (!replace) {
    // Prevent a half-complete previous authorization being silently reused.
    for (const path of [secretPath, metadataPath]) {
      try { await lstat(path); throw new Error("Spotify credentials already exist. Use --replace to reauthorize."); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  // Keep metadata non-secret. Never print token content or store access tokens.
  await writeSecret(secretPath, refreshToken + "\n", replace);
  const metadata = {
    clientId, scope, authorizedAt: now.toISOString(),
    reauthorizationDueBy: sixMonthsLater(now),
    publicBroadcastEnabled: false,
  };
  await writeSecret(metadataPath, JSON.stringify(metadata, null, 2) + "\n", replace);
  return { secretPath, metadataPath, reauthorizationDueBy: metadata.reauthorizationDueBy };
}

function response(request, status, message) {
  request.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'",
  });
  request.end(message + "\n");
}
export async function runLocalAuthorization({ clientId, port = DEFAULT_PORT, replace = false, output = console, fetcher = fetch, directory = resolve(process.cwd(), ".local") } = {}) {
  const verifier = makeVerifier();
  const state = makeState();
  const url = authorizationURL({ clientId, port, verifier, state });
  const localDirectory = directory;
  let rejectWait;
  let resolveWait;
  let attempts = 0;
  let processing = false;
  const finished = new Promise((resolve, reject) => { resolveWait = resolve; rejectWait = reject; });
  const server = createServer(async (request, reply) => {
    const expectedHost = "127.0.0.1:" + port;
    if (request.method !== "GET" || request.headers.host !== expectedHost) {
      response(reply, 400, "Invalid local callback request");
      return;
    }
    if (!request.url?.startsWith("/callback?")) {
      response(reply, 404, "Not found");
      return;
    }
    if (processing) {
      response(reply, 409, "Authorization already processing");
      return;
    }
    let code;
    try {
      code = parseCallback(request.url, state, port);
    } catch {
      attempts += 1;
      response(reply, 400, "Authorization was rejected. Check Spotify consent and try again.");
      if (attempts >= 10) rejectWait(new Error("Too many invalid authorization attempts"));
      return;
    }
    processing = true;
    try {
      const token = await exchangeCode({ clientId, code, verifier, port, fetcher });
      const paths = await saveCredentials({
        directory: localDirectory,
        clientId,
        refreshToken: token.refreshToken,
        scope: token.scope,
        replace,
      });
      response(reply, 200, "Spotify authorization saved locally. Return to your terminal.");
      resolveWait(paths);
    } catch {
      response(reply, 502, "Spotify authorization could not be saved. Check your terminal.");
      rejectWait(new Error("Local Spotify authorization failed; no credentials were published"));
    }
  });
  server.on("error", (error) => rejectWait(error));
  await new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const timeout = setTimeout(() => rejectWait(new Error("Spotify authorization timed out")), MAX_WAIT_MS);
  output.log("Register this exact Spotify redirect URI: " + redirectURI(port));
  output.log("Open this authorization link on this computer:");
  output.log(url);
  output.log("Only " + SPOTIFY_SCOPE + " will be requested. No public sharing is enabled.");
  try {
    const saved = await finished;
    output.log("Stored refresh token in a private local file: " + saved.secretPath);
    output.log("Six-month reauthorization due by: " + saved.reauthorizationDueBy);
    output.log("Only after separate owner approval, install the token as a Cloudflare secret.");
    return saved;
  } finally {
    clearTimeout(timeout);
    server.close();
  }
}
export function parseArgs(args) {
  const options = { port: DEFAULT_PORT, replace: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--client-id") options.clientId = args[++i];
    else if (args[i] === "--port") options.port = Number(args[++i]);
    else if (args[i] === "--replace") options.replace = true;
    else if (args[i] === "--help") options.help = true;
    else throw new Error("Unknown argument (use --help)");
  }
  return options;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/spotify-connect.mjs --client-id <Spotify Client ID> [--port 8787] [--replace]");
    console.log("Default callback: " + redirectURI());
    console.log("Keep .local/ out of Git and never share refresh tokens in chat.");
  } else {
    runLocalAuthorization(options).catch(() => {
      console.error("Spotify setup was not completed. No public sharing was enabled.");
      process.exitCode = 1;
    });
  }
}
