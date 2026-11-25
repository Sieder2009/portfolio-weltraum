import raw from "./portfolio.json";
import type { About, PortfolioData, Project } from "./types";

export type { About, Project, PortfolioData } from "./types";

const source = raw as PortfolioData;

// The text file was written for an earlier version of the site, where every project was an island. These three
// sentences say so; on this site they talk about planets instead. Only the exact original sentences are
// replaced: once the text file says something else, its own wording is used.
const WORDING: Record<string, string> = {
  "Willkommen auf meinen Inseln!": "Willkommen in meinem Sonnensystem!",
  "Flutter-Apps, Web & Minecraft: Hier sind meine Projekte – jede Insel ist eines davon.":
    "Flutter-Apps, Web & Minecraft: Hier sind meine Projekte – jeder Planet ist ein Bereich, jeder Mond ein Projekt.",
  "Jede Insel in der 3D-Welt ist eines meiner Projekte – die Schnellansicht zeigt alle auf einen Blick.":
    "Jeder Planet in diesem Sonnensystem ist ein Bereich meines Portfolios – die Zeitleiste zeigt alle Projekte auf einen Blick.",
};

const adapt = (s: string) => WORDING[s] ?? s;

export const about: About = {
  ...source.about,
  greeting: adapt(source.about.greeting),
  intro: adapt(source.about.intro),
  text: source.about.text.map(adapt),
};

export const projects: Project[] = source.projects;
export const updated = source.updated;

export const projectById = (id: string) => projects.find((p) => p.id === id);

// ---------- Project groups (one planet each) ----------

export type ProjectGroup = "apps" | "web" | "minecraft" | "school";

/** Which planet a project orbits, from its category in the text file. */
export function groupOf(p: Project): ProjectGroup {
  const c = p.category.toLowerCase();
  if (/website|präsentation|\bweb\b/.test(c)) return "web";
  if (/minecraft/.test(c)) return "minecraft";
  if (/\bapp\b|spiel|flutter/.test(c)) return "apps";
  return "school";
}

export const projectsIn = (group: ProjectGroup) => projects.filter((p) => groupOf(p) === group);

// ---------- Skills: which projects list a skill under "Technik" ----------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function projectsUsing(skill: string): Project[] {
  const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(skill)}(?![A-Za-z0-9])`, "i");
  return projects.filter((p) => p.tech.some((t) => re.test(t)));
}

export const skillCount = about.skills.reduce((n, g) => n + g.items.length, 0);

// ---------- Timeline ----------

export interface TimelineEntry {
  sort: string;
  year: string;
  when: string;
  title: string;
  detail: string;
  project?: Project;
}

const MONTH_NAMES: Record<string, string> = {
  januar: "01",
  februar: "02",
  märz: "03",
  april: "04",
  mai: "05",
  juni: "06",
  juli: "07",
  august: "08",
  september: "09",
  oktober: "10",
  november: "11",
  dezember: "12",
};

/** Newest first. Projects by their start; the GitHub account from the facts ("seit Februar 2024"). */
export function timeline(): TimelineEntry[] {
  const entries: TimelineEntry[] = projects
    .filter((p) => p.start)
    .map((p) => ({ sort: p.start, year: p.start.slice(0, 4), when: p.period, title: p.title, detail: p.category, project: p }));

  const gh = about.facts.find((f) => /^github$/i.test(f.label));
  const since = gh && /seit\s+([A-Za-zäöüÄÖÜ]+)\s+(\d{4})/.exec(gh.value);
  if (since) {
    const month = MONTH_NAMES[since[1].toLowerCase()] ?? "01";
    entries.push({
      sort: `${since[2]}-${month}`,
      year: since[2],
      when: `seit ${since[1]} ${since[2]}`,
      title: `GitHub-Konto ${about.githubName || gh.value.split(" ")[0]}`,
      detail: "GitHub",
    });
  }
  return entries.sort((a, b) => (a.sort === b.sort ? (a.project?.number ?? 99) - (b.project?.number ?? 99) : a.sort < b.sort ? 1 : -1));
}

/** "seit Februar 2024" → "Feb. 2024" for the hero's facts line. */
export function githubSince(): string | null {
  const gh = about.facts.find((f) => /^github$/i.test(f.label));
  const m = gh && /seit\s+([A-Za-zäöüÄÖÜ]+)\s+(\d{4})/.exec(gh.value);
  return m ? `${m[1]} ${m[2]}` : null;
}
