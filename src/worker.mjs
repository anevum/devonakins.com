import {createGitHubPublicSignal} from './public-github.mjs';

export const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Strict-Transport-Security": "max-age=31536000",
};
export function createHandler(assets, release, publicSignalDependencies = {}) {
  const decoded = new Map();
  const githubPublicSignal = createGitHubPublicSignal(publicSignalDependencies);
  return {
    async fetch(request, env, ctx) {
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
      if (url.pathname === "/v2/github-profile.json") {
        if (url.search) {
          return new Response(JSON.stringify({error:"unsupported_query"}), {
            status: 400,
            headers: {...securityHeaders, "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store"},
          });
        }
        const edgeCache = Object.hasOwn(publicSignalDependencies, "cache")
          ? publicSignalDependencies.cache
          : globalThis.caches?.default;
        const snapshot = await githubPublicSignal.load(
          edgeCache, ctx?.waitUntil?.bind(ctx)
        );
        return new Response(request.method === "HEAD" ? null :
          JSON.stringify(snapshot ?? {error:"github_public_signal_unavailable"}), {
          status: snapshot ? 200 : 503,
          headers: {
            ...securityHeaders,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": snapshot ? "public, max-age=300, must-revalidate" : "no-store",
            ...(snapshot ? {} : {"Retry-After":"60"}),
          },
        });
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
        "Cache-Control": isHtml
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
