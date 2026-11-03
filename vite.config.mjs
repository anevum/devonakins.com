import { defineConfig } from "vite";
import { resolve } from "node:path";
import { pages, projects } from "./src/content.mjs";
const paths = [
  ...pages.map((p) => p.path),
  ...projects.map((p) => `/work/${p.slug}/`),
  "/404/",
  "/v2/", // Isolated immersive preview, not the production homepage.
];
export default defineConfig({
  build: {
    target: "es2022",
    // Keep legacy site styles out of the portrait interface. Its global
    // reduced-motion rules otherwise override visitor-selected animation.
    cssCodeSplit: true,
    rollupOptions: {
      input: Object.fromEntries(
        paths.map((p, i) => ["page" + i, resolve("." + p + "index.html")]),
      ),
    },
  },
  server: { host: "0.0.0.0", allowedHosts: ["terminal.local"] },
});
