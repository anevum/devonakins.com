import { writeFile, mkdir } from "node:fs/promises";
import sharp from "sharp";
import { markSVG, dPath, aPath } from "../src/identity.mjs";
await mkdir("public", { recursive: true });
await writeFile("public/brand-mark.svg", markSVG());
await writeFile("public/brand-mark-mono.svg", markSVG({ mono: true }));
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#21313e"/><stop offset=".5" stop-color="#09121c"/><stop offset="1" stop-color="#16232c"/></linearGradient><linearGradient id="edge" x2="1" y2="1"><stop stop-color="#8af3df"/><stop offset=".4" stop-color="#20384a"/><stop offset=".75" stop-color="#b5a1e3"/><stop offset="1" stop-color="#d9b39a"/></linearGradient><linearGradient id="metal" x2="1" y2=".8"><stop stop-color="#dcfff8"/><stop offset=".3" stop-color="#84d9dd"/><stop offset=".56" stop-color="#e7f4f5"/><stop offset=".82" stop-color="#b5a0dd"/><stop offset="1" stop-color="#f4be9b"/></linearGradient><radialGradient id="bloom"><stop stop-color="#6bcdc2" stop-opacity=".19"/><stop offset="1" stop-color="#6bcdc2" stop-opacity="0"/></radialGradient></defs><rect width="512" height="512" rx="106" fill="url(#bg)"/><rect x="4" y="4" width="504" height="504" rx="102" fill="none" stroke="url(#edge)" stroke-width="7"/><circle cx="155" cy="162" r="270" fill="url(#bloom)"/><ellipse cx="262" cy="275" rx="211" ry="95" fill="none" stroke="#8edcd9" stroke-opacity=".24" transform="rotate(-27 262 275)"/><g transform="translate(40 92) scale(3.27)"><g transform="translate(1.6 2.6)" fill="#253f50"><path d="${dPath}" fill-rule="evenodd"/><path d="${aPath}" fill-rule="evenodd"/></g><g fill="url(#metal)" stroke="#c3eef3" stroke-width=".35"><path d="${dPath}" fill-rule="evenodd"/><path d="${aPath}" fill-rule="evenodd"/></g></g></svg>`;
await writeFile("public/favicon.svg", icon);
for (const [file, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
  ["favicon-32.png", 32],
  ["da-icon-1024.png", 1024],
])
  await sharp(Buffer.from(icon))
    .resize(size, size)
    .png()
    .toFile("public/" + file);
const mask = icon
  .replace(/rx="106"/, 'rx="0"')
  .replace(/<rect x="4".*?\/>/, "");
await sharp(Buffer.from(mask))
  .resize(512, 512)
  .png()
  .toFile("public/icon-maskable-512.png");
const stars = Array.from({ length: 85 }, (_, i) => {
  let x = (i * 593 + 29) % 2400,
    y = (i * i * 97 + 17) % 1000;
  return `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 2 : 1}" fill="#c0e9ee" opacity="${0.18 + (i % 5) * 0.09}"/>`;
}).join("");
const landscape = Array.from({ length: 26 }, (_, i) => {
  const x = 1050 + i * 58,
    h = 40 + ((i * 131) % 200);
  return `<rect x="${x}" y="${1010 - h}" width="${8 + (i % 13)}" height="${h}" fill="#172b3b"/><path d="M${x + 4} ${1010 - h + 20}v${h / 2}" stroke="${i % 3 === 0 ? "#cb9471" : "#78bbb6"}" stroke-opacity=".4"/>`;
}).join("");
const social = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1260" viewBox="0 0 2400 1260"><defs><linearGradient id="sky" x2="1" y2="1"><stop stop-color="#070d16"/><stop offset=".6" stop-color="#172d42"/><stop offset="1" stop-color="#433c40"/></linearGradient><radialGradient id="glow"><stop stop-color="#8af3df" stop-opacity=".22"/><stop offset="1" stop-color="#8af3df" stop-opacity="0"/></radialGradient><linearGradient id="type"><stop stop-color="#8af3df"/><stop offset=".55" stop-color="#9bd8ed"/><stop offset="1" stop-color="#b9a0ed"/></linearGradient><linearGradient id="da" x2="1" y2=".6"><stop stop-color="#cefff6"/><stop offset=".2" stop-color="#78b5c1"/><stop offset=".47" stop-color="#e8faff"/><stop offset=".75" stop-color="#b4a0d9"/><stop offset="1" stop-color="#e9bf9f"/></linearGradient></defs><rect width="2400" height="1260" fill="url(#sky)"/>${stars}<circle cx="2005" cy="154" r="352" fill="#37526b" stroke="#a8d8ed" stroke-opacity=".5" stroke-width="3"/><circle cx="1930" cy="115" r="340" fill="#17273d"/>${landscape}<path d="m950 1020 150-220 150 170 170-290 190 310 130-170 230 200 170-270 260 300H950" fill="#10202e"/><rect y="1020" width="2400" height="240" fill="#080f19"/><ellipse cx="1730" cy="900" rx="650" ry="440" fill="url(#glow)"/><ellipse cx="1750" cy="1023" rx="480" ry="95" fill="#0c1924" stroke="#526e7a" stroke-width="3"/><ellipse cx="1750" cy="1012" rx="450" ry="65" fill="#152734" stroke="#8af3df" stroke-opacity=".75" stroke-width="2"/><ellipse cx="1750" cy="615" rx="530" ry="150" fill="none" stroke="#84d7d5" stroke-opacity=".65" stroke-width="2" transform="rotate(-15 1750 615)"/><g transform="translate(1330 278) scale(6.4)"><g transform="translate(2 3)" fill="#223d50"><path d="${dPath}" fill-rule="evenodd"/><path d="${aPath}" fill-rule="evenodd"/></g><g fill="url(#da)" stroke="#c3e6ec" stroke-width=".25"><path d="${dPath}" fill-rule="evenodd"/><path d="${aPath}" fill-rule="evenodd"/></g></g><ellipse cx="1750" cy="615" rx="530" ry="150" fill="none" stroke="#bd9bd8" stroke-opacity=".4" stroke-width="2" transform="rotate(20 1750 615)"/><text x="130" y="134" fill="#edf4f4" font-family="DejaVu Sans,sans-serif" font-size="33" letter-spacing="9">DEVON AKINS</text><path d="M130 212h65" stroke="#8af3df" stroke-width="3"/><text x="130" y="451" fill="#f0f5f4" font-family="DejaVu Sans,sans-serif" font-weight="bold" font-size="131" letter-spacing="-7">I build things</text><text x="130" y="603" fill="#f0f5f4" font-family="DejaVu Sans,sans-serif" font-weight="bold" font-size="131" letter-spacing="-7">to</text><text x="305" y="603" fill="url(#type)" font-family="DejaVu Sans,sans-serif" font-weight="bold" font-size="131" letter-spacing="-7">understand</text><text x="130" y="755" fill="#f0f5f4" font-family="DejaVu Sans,sans-serif" font-weight="bold" font-size="131" letter-spacing="-7">them.</text><text x="136" y="860" fill="#b4c6d2" font-family="DejaVu Sans,sans-serif" font-size="30">Ideas. Systems. Experiments. A personal workshop.</text><path d="M130 1110h2130" stroke="#8abac4" stroke-opacity=".3"/><text x="136" y="1176" fill="#a4b9c7" font-family="DejaVu Sans Mono,monospace" font-size="20" letter-spacing="4">DEVONAKINS.COM</text><text x="1580" y="1176" fill="#8ab7c5" font-family="DejaVu Sans Mono,monospace" font-size="17" letter-spacing="4">ALWAYS LEARNING.</text></svg>`;
await writeFile("public/social-card.svg", social);
await sharp(Buffer.from(social))
  .resize(1200, 630)
  .jpeg({ quality: 92 })
  .toFile("public/social-card.jpg");
await sharp(Buffer.from(social)).png().toFile("public/da-social-2400.png");
await writeFile(
  "public/manifest.webmanifest",
  JSON.stringify(
    {
      id: "/",
      name: "Devon Akins",
      short_name: "Devon",
      description: "A personal workshop for ideas, systems, and experiments.",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#080d14",
      theme_color: "#090e16",
      icons: [
        {
          src: "/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    null,
    2,
  ),
);
await writeFile(
  "public/robots.txt",
  "User-agent: *\nAllow: /\n\nSitemap: https://devonakins.com/sitemap.xml\n",
);
console.log(
  "Created vector identity, raster icons, manifest and social artwork.",
);
