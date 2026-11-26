import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Connect, type Plugin } from "vite";
// @ts-expect-error plain ES module without type declarations
import { generateContent, resolveTxtPath, OUTPUT_FILE } from "./scripts/content/generate.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** Keeps src/content/portfolio.json in sync with portfolio-daten.txt; fills the page title and the loading screen. */
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
      // The site shows only the family name (see src/content/index.ts).
      const fullName: string = (data.about.name || "").trim();
      const shortName = fullName.split(/\s+/).pop() || fullName;
      const title = fullName ? (data.about.siteTitle || fullName).replaceAll(fullName, shortName) : data.about.siteTitle;
      const description = data.about.intro || "";
      // The name on the loading screen, letter by letter (they rise one after another, before any script runs).
      const letters = Array.from(shortName)
        .map((c, i) => (c.trim() ? `<span class="ln-m"><span class="ln-c" style="--i:${i}">${esc(c)}</span></span>` : " "))
        .join("");
      return html
        .replaceAll("%SITE_TITLE%", esc(title))
        .replaceAll("%SITE_DESCRIPTION%", esc(description))
        .replaceAll("%LOADER_NAME%", letters);
    },
  };
}

/** The display font starts loading with the page, so the loading screen shows the name in it right away. */
function preloadDisplayFont(): Plugin {
  return {
    name: "preload-display-font",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const font = Object.keys(ctx.bundle ?? {}).find((file) => /tektur-latin-wdth-normal-[\w-]+\.woff2$/.test(file));
        if (!font) return;
        return [{ tag: "link", attrs: { rel: "preload", href: `./${font}`, as: "font", type: "font/woff2", crossorigin: "" }, injectTo: "head" }];
      },
    },
  };
}

/**
 * While developing and in `npm run preview`, an unknown path answers with the 404 page, as on the web host.
 * (Vite would otherwise send the start page for any path.)
 */
function notFoundPage(): Plugin {
  const middleware =
    (dirs: string[], page: string): Connect.NextHandleFunction =>
    (req, res, next) => {
      if ((req.method !== "GET" && req.method !== "HEAD") || !req.headers.accept?.includes("text/html")) return next();
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      } catch {
        return next();
      }
      if (pathname === "/" || /^\/(@|__|node_modules\/)/.test(pathname)) return next();
      if (dirs.some((dir) => fs.existsSync(path.join(dir, pathname))) || !fs.existsSync(page)) return next();
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(req.method === "HEAD" ? undefined : fs.readFileSync(page));
    };
  return {
    name: "not-found-page",
    configureServer(server) {
      const { root: dir, publicDir } = server.config;
      server.middlewares.use(middleware([dir, publicDir], path.join(publicDir, "404.html")));
    },
    configurePreviewServer(server) {
      const out = path.resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use(middleware([out], path.join(out, "404.html")));
    },
  };
}

export default defineConfig({
  // Relative paths: the build runs from any folder or sub path (also opened via a static file server).
  base: "./",
  plugins: [portfolioContent(), preloadDisplayFont(), notFoundPage()],
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
