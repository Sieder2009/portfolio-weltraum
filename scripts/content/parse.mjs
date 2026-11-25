// Turns portfolio-daten.txt into the data the site renders.
//
// The text file is the single source of truth. Its layout:
//   ====== / "1. ÜBER MICH" / ======          major sections
//   ------ / "PROJEKT 3: Title" / ------      one block per project
//   Key: value                                fields start in column 0
//     indented text / "- list items"          field bodies
//
// Only "Über mich" and "Projekte" are read. Everything else in the file
// (the header's source notes, the "Noch offen" section) stays private and
// never ends up in the generated JSON or in the bundle.

const KNOWN_KEYS = new Set([
  "Name",
  "GitHub-Name",
  "Seitentitel",
  "Begrüßung",
  "Intro",
  "Text",
  "Fakten",
  "Skills",
  "Links",
  "Bilder",
  "Übersicht",
  "Kategorie",
  "Zeitraum",
  "Status",
  "Kurzbeschreibung",
  "Beschreibung",
  "Technik",
  "Features",
  "Kennzahlen",
  "Farbpalette",
  "Schaltungen",
  "Schaltungen (3D-Insel)",
  "Noch leer",
]);

const SEPARATOR_MAJOR = /^={8,}\s*$/;
const SEPARATOR_MINOR = /^-{8,}\s*$/;

const MONTHS = {
  jan: 1,
  feb: 2,
  mär: 3,
  mae: 3,
  mar: 3,
  apr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  okt: 10,
  oct: 10,
  nov: 11,
  dez: 12,
  dec: 12,
};

/** Joins wrapped lines back into one string. "Scheiben-" + "und" keeps its space, "Muskel-" + "Diagramm" does not. */
function joinWrapped(lines) {
  let out = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) {
      out = line;
    } else if (/[A-Za-zÄÖÜäöüß]-$/.test(out) && /^[A-ZÄÖÜ]/.test(line)) {
      out += line;
    } else {
      out += " " + line;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Splits wrapped lines into paragraphs at blank lines. */
function paragraphs(lines) {
  const out = [];
  let buf = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (buf.length) out.push(joinWrapped(buf));
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) out.push(joinWrapped(buf));
  return out.filter(Boolean);
}

/** "- item" lines (with indented continuation lines) into a list of strings. */
function listItems(lines) {
  const items = [];
  let cur = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = /^\s*-\s+(.*)$/.exec(line);
    if (m) {
      cur = [m[1]];
      items.push(cur);
    } else if (cur) {
      cur.push(line);
    }
  }
  return items.map(joinWrapped);
}

/** Splits at commas that are not inside parentheses: "Fabric (Loader, API, Loom), Gradle" → 2 items. */
function splitTopLevel(text, sep = ",") {
  const out = [];
  let depth = 0;
  let buf = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function labelValue(item) {
  const i = item.indexOf(": ");
  if (i < 0) return { label: "", value: item };
  return { label: item.slice(0, i).trim(), value: item.slice(i + 2).trim() };
}

function parseLink(item) {
  const m = /^(.*?):?\s*(https?:\/\/\S+)\s*$/.exec(item);
  if (!m) return null;
  return { label: m[1].replace(/:$/, "").trim(), url: m[2] };
}

function parseImage(item, exists) {
  const m = /^(.*?)\s*\(((?:assets|media|img|images)\/[^)\s]+)\)\s*$/.exec(item);
  if (!m) return { alt: item, src: "", available: false };
  const src = m[2];
  return { alt: m[1].trim(), src, available: Boolean(exists && exists(src)) };
}

function isKeyLine(line, prevBlank) {
  if (/^\s/.test(line)) return null;
  const m = /^([^:]{1,48}?):(?:\s+(.*))?\s*$/.exec(line);
  if (!m) return null;
  const key = m[1].trim();
  if (KNOWN_KEYS.has(key)) return { key, inline: (m[2] || "").trim() };
  // Unknown keys are accepted after a blank line, if they look like a label (no digits, starts uppercase).
  if (prevBlank && /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß \-()&/.]*$/.test(key)) return { key, inline: (m[2] || "").trim() };
  return null;
}

/** Splits a block of lines into { key, inline, body } fields. */
function parseFields(lines) {
  const fields = [];
  let cur = null;
  let prevBlank = true;
  for (const line of lines) {
    if (!line.trim()) {
      if (cur) cur.body.push("");
      prevBlank = true;
      continue;
    }
    const key = isKeyLine(line, prevBlank);
    if (key) {
      cur = { key: key.key, inline: key.inline, body: [] };
      fields.push(cur);
    } else if (cur) {
      cur.body.push(line);
    }
    prevBlank = false;
  }
  return fields;
}

function fieldText(f) {
  return joinWrapped([f.inline, ...f.body]);
}

function fieldParagraphs(f) {
  return paragraphs([f.inline, ...f.body]);
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "Kilo (ehemals Ironpeak Fitness)" → { short: "Kilo", sub: "ehemals Ironpeak Fitness" } */
function splitTitle(title) {
  const dash = title.split(/\s+[–—]\s+/);
  if (dash.length > 1) return { short: dash[0].trim(), sub: dash.slice(1).join(" – ").trim() };
  const paren = /^(.*?)\s*\((.*)\)\s*$/.exec(title);
  if (paren) return { short: paren[1].trim(), sub: paren[2].trim() };
  return { short: title.trim(), sub: "" };
}

function monthOf(text) {
  const words = text.toLowerCase().match(/[a-zäöü]+/g) || [];
  for (const w of words) {
    const key = w.slice(0, 3);
    if (key in MONTHS) return MONTHS[key];
  }
  return null;
}

/** A sortable "YYYY-MM" for the start of a period such as "Sep. – Nov. 2026" or "Schuljahr 2026/27". */
export function periodStart(text) {
  if (!text) return "";
  const main = text.split("(")[0];
  const school = /Schuljahr\s+(\d{4})/.exec(main);
  if (school) return `${school[1]}-09`;
  const parts = main.split(/\s+[–—-]\s+/);
  const first = parts[0] || "";
  const rest = parts.slice(1).join(" ");
  const year = (/(\d{4})/.exec(first) || /(\d{4})/.exec(rest) || [])[1];
  if (!year) return "";
  const month = monthOf(first) || 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function splitSections(lines) {
  const header = [];
  const sections = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SEPARATOR_MAJOR.test(line)) {
      const title = lines[i + 1];
      const close = lines[i + 2];
      if (title && title.trim() && close !== undefined && SEPARATOR_MAJOR.test(close)) {
        cur = { title: title.trim(), lines: [] };
        sections.push(cur);
        i += 2;
      }
      continue;
    }
    (cur ? cur.lines : header).push(line);
  }
  return { header, sections };
}

function splitProjects(lines) {
  const blocks = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SEPARATOR_MINOR.test(line)) {
      const title = lines[i + 1];
      const close = lines[i + 2];
      if (title && close !== undefined && SEPARATOR_MINOR.test(close)) {
        const m = /^PROJEKT\s+(\d+)\s*:\s*(.+)$/i.exec(title.trim());
        cur = { number: m ? Number(m[1]) : blocks.length + 1, title: m ? m[2].trim() : title.trim(), lines: [] };
        blocks.push(cur);
        i += 2;
      }
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  return blocks;
}

function parseAbout(lines, exists) {
  const about = {
    name: "",
    githubName: "",
    siteTitle: "",
    greeting: "",
    intro: "",
    text: [],
    facts: [],
    skills: [],
    links: [],
    images: [],
  };
  for (const f of parseFields(lines)) {
    switch (f.key) {
      case "Name":
        about.name = fieldText(f);
        break;
      case "GitHub-Name":
        about.githubName = fieldText(f);
        break;
      case "Seitentitel":
        about.siteTitle = fieldText(f);
        break;
      case "Begrüßung":
        about.greeting = fieldText(f);
        break;
      case "Intro":
        about.intro = fieldText(f);
        break;
      case "Text":
        about.text = fieldParagraphs(f);
        break;
      case "Fakten":
        about.facts = listItems(f.body).map(labelValue);
        break;
      case "Skills":
        about.skills = listItems(f.body).map((item) => {
          const { label, value } = labelValue(item);
          return { group: label, items: splitTopLevel(value) };
        });
        break;
      case "Links":
        about.links = listItems(f.body).map(parseLink).filter(Boolean);
        break;
      case "Bilder":
        about.images = listItems(f.body).map((item) => parseImage(item, exists));
        break;
      default:
        break;
    }
  }
  return about;
}

function parseProject(block, exists) {
  const { short, sub } = splitTitle(block.title);
  const p = {
    id: slugify(short) || `projekt-${block.number}`,
    number: block.number,
    title: block.title,
    shortTitle: short,
    subtitle: sub,
    category: "",
    period: "",
    start: "",
    status: "",
    summary: "",
    description: [],
    tech: [],
    features: [],
    links: [],
    images: [],
    metrics: [],
    palette: [],
    circuits: [],
    missing: [],
    extra: [],
  };
  for (const f of parseFields(block.lines)) {
    switch (f.key) {
      case "Kategorie":
        p.category = fieldText(f);
        break;
      case "Zeitraum":
        p.period = fieldText(f);
        p.start = periodStart(p.period);
        break;
      case "Status":
        p.status = fieldText(f);
        break;
      case "Kurzbeschreibung":
        p.summary = fieldText(f);
        break;
      case "Beschreibung":
        p.description = fieldParagraphs(f);
        break;
      case "Technik":
        p.tech = splitTopLevel(fieldText(f));
        break;
      case "Features":
        p.features = listItems(f.body);
        break;
      case "Links":
        p.links = listItems(f.body).map(parseLink).filter(Boolean);
        break;
      case "Bilder":
        p.images = listItems(f.body).map((item) => parseImage(item, exists));
        break;
      case "Kennzahlen":
        p.metrics = listItems(f.body).map(labelValue);
        break;
      case "Farbpalette":
        p.palette = fieldText(f).match(/#[0-9a-fA-F]{6}\b/g) || [];
        break;
      case "Schaltungen":
      case "Schaltungen (3D-Insel)":
        p.circuits = listItems(f.body);
        break;
      case "Noch leer":
        p.missing = splitTopLevel(fieldText(f));
        break;
      default: {
        const items = listItems(f.body);
        p.extra.push(items.length ? { label: f.key, items } : { label: f.key, text: fieldText(f) });
      }
    }
  }
  return p;
}

/**
 * @param {string} raw  contents of portfolio-daten.txt
 * @param {{ exists?: (src: string) => boolean }} [opts]  tells whether an image file is present in public/
 */
export function parsePortfolio(raw, opts = {}) {
  const lines = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const { header, sections } = splitSections(lines);

  const standLine = header.find((l) => /^Stand:/.test(l.trim()));
  const updated = standLine ? standLine.replace(/^\s*Stand:\s*/, "").trim() : "";

  const aboutSection = sections.find((s) => /ÜBER\s+MICH/i.test(s.title));
  const projectSection = sections.find((s) => /PROJEKTE/i.test(s.title));
  if (!aboutSection) throw new Error('Abschnitt "ÜBER MICH" nicht gefunden.');
  if (!projectSection) throw new Error('Abschnitt "PROJEKTE" nicht gefunden.');

  const about = parseAbout(aboutSection.lines, opts.exists);
  const projects = splitProjects(projectSection.lines).map((b) => parseProject(b, opts.exists));

  const seen = new Map();
  for (const p of projects) {
    const n = seen.get(p.id) || 0;
    seen.set(p.id, n + 1);
    if (n) p.id = `${p.id}-${n + 1}`;
  }

  return { updated, about, projects };
}
