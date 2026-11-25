import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
// @ts-expect-error plain ES module without type declarations
import { generateContent, resolveTxtPath, OUTPUT_FILE } from "./scripts/content/generate.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

/** Keeps src/content/portfolio.json in sync with portfolio-daten.txt and fills the page title. */
function portfolioContent(): Plugin {
  const regenerate = () => {
    try {
      generateContent(root);
    } catch (err) {
      console.error("[content] Fehler beim Lesen der Textdatei:", (err as Error).message);
    }
  };
  return {
    name: "portfolio-content",
    buildStart() {
      regenerate();
    },
    configureServer(server) {
      const txt = resolveTxtPath(root);
      if (!fs.existsSync(txt)) return;
      server.watcher.add(txt);
      server.watcher.on("change", (file) => {
        if (path.resolve(file) === path.resolve(txt)) regenerate();
      });
    },
    transformIndexHtml(html) {
      const data = JSON.parse(fs.readFileSync(path.join(root, OUTPUT_FILE), "utf8"));
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      const title = data.about.siteTitle || data.about.name;
      const description = data.about.intro || "";
      return html.replaceAll("%SITE_TITLE%", esc(title)).replaceAll("%SITE_DESCRIPTION%", esc(description));
    },
  };
}

export default defineConfig({
  // Relative paths: the build runs from any folder or sub path (also opened via a static file server).
  base: "./",
  plugins: [portfolioContent()],
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
  },
  build: {
    target: "es2020",
    // "assets/" stays free for the images named in the text file (public/assets/...).
    assetsDir: "static",
    chunkSizeWarningLimit: 900,
  },
});
