import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pages, projects } from "../src/content.mjs";
import { promotePortraitHome } from "../src/portrait-home.mjs";
import { renderImmersiveRoute } from "../src/immersive-routes.mjs";

// All public routes use one independently audited cinematic shell. No legacy
// homepage, navbar or old global CSS is generated for deep-linked pages.
const home = promotePortraitHome(await readFile("v2/index.html", "utf8"));
await writeFile("index.html", home);
const all = [
  ...pages.map(({ path }) => path),
  ...projects.map((project) => "/work/" + project.slug + "/"),
  "/404/",
];
for (const path of all) {
  if (path === "/") continue;
  const dir = "." + path;
  await mkdir(dir, { recursive: true });
  await writeFile(dir + "index.html", renderImmersiveRoute(home, path, projects));
}
await writeFile(
  "public/sitemap.xml",
  '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    all
      .filter((path) => path !== "/404/")
      .map((path) => '<url><loc>https://devonakins.com' + path + "</loc></url>")
      .join("") +
    "</urlset>",
);
console.log("Generated " + all.length + " public HTML routes with one immersive visual system.");
