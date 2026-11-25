// npm run content
// Regenerates src/content/portfolio.json from portfolio-daten.txt.
// (The dev server and the build do this on their own; this is for a manual run.)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateContent } from "./content/generate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = generateContent(root);
if (!result) process.exitCode = 1;
