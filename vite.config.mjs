import { defineConfig } from "vite";
import { resolve } from "node:path";
import { pages, projects, notes } from "./src/content.mjs";
const paths = [
  ...pages.map((p) => p.path),
  ...projects.map((p) => `/work/${p.slug}/`),
  ...notes.map((p) => `/notes/${p.slug}/`),
  "/404/",
];
export default defineConfig({
  build: {
    target: "es2022",
    cssCodeSplit: false,
    rollupOptions: {
      input: Object.fromEntries(
        paths.map((p, i) => ["page" + i, resolve("." + p + "index.html")]),
      ),
    },
  },
  server: { host: "0.0.0.0", allowedHosts: ["terminal.local"] },
});
