import { projectPublicGithubEvents, unavailablePublicGithub, projectPublicTelemetry, validPublicGithubSignal, githubCooldownMs } from "./public-telemetry.mjs";
export const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Strict-Transport-Security": "max-age=31536000",
};
export function createHandler(assets, release, options = {}) {
  const decoded = new Map();
  const now = options.now || (() => new Date());
  const githubFetch = options.githubFetch || fetch;
  const successfulTtlMs = 5 * 60_000;
  const failureTtlMs = 10 * 60_000;
  const maxTtlMs = 4 * 60 * 60_000;
  // Bump cache key when the sanitized format or validation contract changes.
  const cacheKey = new Request("https://devonakins.com/__cache/public-github-v3");
  let lastGithub = null;
  let pendingGithub = null;
  let failureStreak = 0;
  let historicalSnapshot = null;
  const githubSignal = async (at) => {
    const atMs = at.getTime();
    if (lastGithub && lastGithub.expiresAt > atMs)
      return lastGithub.value;
    if (pendingGithub) return pendingGithub;
    pendingGithub = (async () => {
      const edgeCache = options.cache === undefined
        ? (typeof caches !== "undefined" ? caches.default : null)
        : options.cache;
      if (edgeCache) {
        try {
          const hit = await edgeCache.match(cacheKey);
          if (hit?.ok) {
            const saved = await hit.json();
            const expiresAt = Date.parse(saved?.expiresAt);
            if (saved?.version === 3 && Number.isFinite(expiresAt) &&
                expiresAt > atMs && expiresAt <= atMs + maxTtlMs &&
                validPublicGithubSignal(saved.value, at) &&
                atMs - Date.parse(saved.value.checkedAt) <= maxTtlMs) {
              lastGithub = {expiresAt, value: saved.value};
              return saved.value;
            }
          }
        } catch { /* Cache is never a trusted source of data or availability. */ }
      }
      let value;
      let ttlMs = successfulTtlMs;
      try {
        const response = await githubFetch(
          "https://api.github.com/users/devonalanakins/events/public?per_page=30",
          {
            headers: {
              "Accept": "application/vnd.github+json",
              "User-Agent": "devonakins-public-signal",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            signal: AbortSignal.timeout(5000),
          },
        );
        if (!response.ok) {
          ttlMs = response.status === 403 || response.status === 429
            ? githubCooldownMs(response, at, failureStreak + 1)
            : failureTtlMs;
          throw new Error("Public activity provider unavailable");
        }
        value = projectPublicGithubEvents(await response.json(), at);
        failureStreak = 0;
      } catch {
        value = unavailablePublicGithub(at);
        failureStreak = Math.min(failureStreak + 1, 6);
        if (ttlMs === successfulTtlMs) ttlMs = failureTtlMs;
      }
      const expiresAt = atMs + ttlMs;
      lastGithub = {expiresAt, value};
      if (edgeCache) {
        try {
          await edgeCache.put(cacheKey, new Response(JSON.stringify({
            version: 3, expiresAt: new Date(expiresAt).toISOString(), value,
          }), {
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=" + Math.ceil(ttlMs / 1000),
            },
          }));
        } catch { /* Neither a cache write nor a denied cache service can fail the read. */ }
      }
      return value;
    })();
    try {
      return await pendingGithub;
    } finally {
      pendingGithub = null;
    }
  };
  const snapshot = async () => {
    if (!historicalSnapshot) {
      historicalSnapshot = (async () => {
        const bundled = assets["/v2/usage-snapshot.json"];
        if (!bundled) throw new Error("Historical source missing");
        const bytes = Uint8Array.from(atob(bundled.gzip), (c) => c.charCodeAt(0));
        return await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
        ).json();
      })();
    }
    return historicalSnapshot;
  };
  return {
    async fetch(request) {
      const url = new URL(request.url);
      const redirect = (target, status = 308) =>
        new Response(null, {
          status,
          headers: {
            ...securityHeaders,
            Location: target,
            "Cache-Control": "public, max-age=3600",
          },
        });
      if (url.hostname === "www.devonakins.com") {
        url.hostname = "devonakins.com";
        url.protocol = "https:";
        return redirect(url.href);
      }
      if (
        url.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(url.hostname)
      ) {
        url.protocol = "https:";
        return redirect(url.href);
      }
      if (!["GET", "HEAD"].includes(request.method))
        return new Response("Method not allowed", {
          status: 405,
          headers: {
            ...securityHeaders,
            Allow: "GET, HEAD",
            "Cache-Control": "no-store",
          },
        });
      if (url.pathname === "/_health")
        return new Response(
          request.method === "HEAD"
            ? null
            : JSON.stringify({ site: "devonakins.com", ...release }),
          {
            headers: {
              ...securityHeaders,
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            },
          },
        );
      if (url.pathname === "/api/telemetry/public") {
        const headers = {
          ...securityHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=0, must-revalidate",
        };
        if (request.method === "HEAD")
          return new Response(null, {headers});
        try {
          const at = now();
          const data = projectPublicTelemetry(await snapshot(), await githubSignal(at), at);
          return new Response(JSON.stringify(data), {headers});
        } catch {
          return new Response(JSON.stringify({error: "Telemetry unavailable"}), {
            status: 503, headers: {...headers, "Cache-Control": "no-store"},
          });
        }
      }
      if (url.pathname === "/favicon.ico") return redirect("/favicon-32.png");
      let path;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        return new Response("Bad request", {
          status: 400,
          headers: securityHeaders,
        });
      }
      if (path.includes("\\") || path.includes("\0"))
        return new Response("Bad request", {
          status: 400,
          headers: securityHeaders,
        });
      // Preserve the previous public project URLs when rebranding.
      const renamedProjects = new Map([
        ["aiei", "merit"],
        ["isl", "rhen-language"],
      ]);
      const legacyMatch = /^\/work\/([a-z-]+)(?:\/|\/index\.html)?$/.exec(path);
      const currentProject = legacyMatch && renamedProjects.get(legacyMatch[1]);
      if (currentProject) {
        url.pathname = "/work/" + currentProject + "/";
        return redirect(url.href);
      }
      // Preserve old public project bookmarks without serving the retired identity.
      if (["/work/phatcake", "/work/phatcake/", "/work/phatcake/index.html"].includes(path)) {
        url.pathname = "/work/squelch/";
        return redirect(url.href);
      }
      const index = path.endsWith("/")
        ? path + "index.html"
        : path + "/index.html";
      if (assets[index] && !path.endsWith("/")) {
        url.pathname += "/";
        return redirect(url.href);
      }
      if (path.endsWith("/index.html")) {
        url.pathname = url.pathname.slice(0, -10);
        return redirect(url.href);
      }
      const asset = assets[index] || assets[path];
      const selected = asset || assets["/404/index.html"];
      const status = asset ? 200 : 404;
      const isHtml = selected.type.startsWith("text/html");
      const headers = new Headers({
        ...securityHeaders,
        "Content-Type": selected.type,
        "Cache-Control": isHtml || (path.startsWith("/v2/") && path.endsWith(".css"))
          // Mutable styles are revalidated: cached mobile Safari CSS must not
          // outlive a newer HTML shell that introduces additional class names.
          ? "public, max-age=0, must-revalidate"
          : path.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600",
        ETag: selected.etag,
        Vary: "Accept-Encoding",
      });
      if (status === 404) headers.set("Cache-Control", "no-store");
      if (
        status === 200 &&
        request.headers.get("If-None-Match") === selected.etag
      )
        return new Response(null, { status: 304, headers });
      if (request.method === "HEAD")
        return new Response(null, { status, headers });
      let bytes = decoded.get(selected.etag);
      if (!bytes) {
        bytes = Uint8Array.from(atob(selected.gzip), (c) => c.charCodeAt(0));
        decoded.set(selected.etag, bytes);
      }
      const acceptsGzip =
        /(?:^|,)\s*gzip(?:\s*;\s*q=(?!0(?:\.0*)?(?:\s*,|$))[\d.]+)?(?:\s*,|$)/i.test(
          request.headers.get("Accept-Encoding") || "",
        );
      if (acceptsGzip) {
        headers.set("Content-Encoding", "gzip");
        return new Response(bytes, { status, headers, encodeBody: "manual" });
      }
      const body = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
      return new Response(body, { status, headers });
    },
  };
}
