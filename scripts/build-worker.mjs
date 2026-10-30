import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? walk(dir + "/" + e.name) : dir + "/" + e.name,
      ),
    )
  ).flat();
}
const files = await walk("dist");
const assets = {};
let original = 0,
  compressed = 0;
for (const f of files) {
  const bytes = await readFile(f);
  const zipped = gzipSync(bytes, { level: 9 });
  const ext = f.slice(f.lastIndexOf("."));
  original += bytes.length;
  compressed += zipped.length;
  assets[f.slice(4)] = {
    type: mime[ext] || "application/octet-stream",
    etag:
      '"' + createHash("sha256").update(bytes).digest("hex").slice(0, 24) + '"',
    gzip: zipped.toString("base64"),
  };
}
let commit = "uncommitted";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {}
const release = {
  version: "1.0.0",
  session: "DEVONAKINS.BUILD.2026-10-29.001",
  commit,
};
await mkdir(".release", { recursive: true });
await writeFile(
  ".release/assets.mjs",
  "export default " + JSON.stringify(assets) + ";\n",
);
await writeFile(".release/handler.mjs", await readFile("src/worker.mjs"));
await writeFile(
  ".release/worker.mjs",
  `import assets from './assets.mjs';import {createHandler} from './handler.mjs';export default createHandler(assets,${JSON.stringify(release)});\n`,
);
await writeFile(
  ".release/release.json",
  JSON.stringify(
    {
      ...release,
      assetCount: files.length,
      originalBytes: original,
      compressedBytes: compressed,
    },
    null,
    2,
  ),
);
console.log(
  `Worker bundle: ${files.length} assets, ${(original / 1024).toFixed(0)} KiB original, ${(compressed / 1024).toFixed(0)} KiB compressed.`,
);
