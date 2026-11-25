import fs from "node:fs";
import path from "node:path";
import { parsePortfolio } from "./parse.mjs";

export const OUTPUT_FILE = "src/content/portfolio.json";

/** Where the text file lives: $PORTFOLIO_TXT, else content/portfolio-daten.txt, else ../portfolio-daten.txt. */
export function resolveTxtPath(root) {
  if (process.env.PORTFOLIO_TXT) return path.resolve(root, process.env.PORTFOLIO_TXT);
  const candidates = [path.join(root, "content", "portfolio-daten.txt"), path.resolve(root, "..", "portfolio-daten.txt")];
  return candidates.find((p) => fs.existsSync(p)) || candidates[candidates.length - 1];
}

/**
 * Reads the text file, writes src/content/portfolio.json (only when something changed).
 * Returns null when the text file is missing: the committed JSON is used as it is.
 */
export function generateContent(root, { log = console.log } = {}) {
  const txtPath = resolveTxtPath(root);
  if (!fs.existsSync(txtPath)) {
    log(`[content] ${path.relative(root, txtPath)} nicht gefunden – vorhandene ${OUTPUT_FILE} wird verwendet.`);
    return null;
  }
  const raw = fs.readFileSync(txtPath, "utf8");
  const data = parsePortfolio(raw, {
    exists: (src) => fs.existsSync(path.join(root, "public", src)),
  });
  const json = JSON.stringify(data, null, 2) + "\n";
  const out = path.join(root, OUTPUT_FILE);
  const before = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (before !== json) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json);
  }
  const images = data.projects.reduce((n, p) => n + p.images.length, data.about.images.length);
  const present = data.projects.reduce((n, p) => n + p.images.filter((i) => i.available).length, data.about.images.filter((i) => i.available).length);
  log(
    `[content] ${path.relative(root, txtPath) || txtPath} → ${OUTPUT_FILE}: ${data.projects.length} Projekte, ` +
      `${data.about.skills.reduce((n, g) => n + g.items.length, 0)} Skills, Bilder ${present}/${images} vorhanden` +
      (before === json ? " (unverändert)" : ""),
  );
  return { txtPath, data };
}
