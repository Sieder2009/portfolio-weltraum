import type { BodyDef } from "../three/bodies";
import { projectsIn, skillCount, type Project, type ProjectGroup } from "../content";

export type SectionKind = "about" | "skills" | "projects" | "timeline" | "contact";

export interface Section {
  /** 1-based position in the system (0 is the sun / start) */
  number: number;
  slug: string;
  name: string;
  kind: SectionKind;
  accent: string;
  /** what kind of world it is, shown as a small caption */
  world: string;
  group?: ProjectGroup;
  projects: Project[];
  body: BodyDef;
  /** CSS stand-in for the planet when WebGL isn't available */
  fallback: string;
}

type SectionSeed = Omit<Section, "number" | "projects" | "body"> & {
  body: Omit<BodyDef, "key" | "accent" | "moons">;
};

const seeds: SectionSeed[] = [
  {
    slug: "ueber-mich",
    name: "Über mich",
    kind: "about",
    accent: "#5aa9ff",
    world: "Heimatwelt",
    fallback: "radial-gradient(circle at 35% 35%, #7cc4ff, #1f6fb0 45%, #0a2a5e 75%)",
    body: {
      kind: "terran",
      radius: 1.7,
      orbit: 17,
      colors: ["#0a2a5e", "#1f6fb0", "#3f7d3a", "#b59a6a", "#eef4ff"],
      atmo: "#6fb6ff",
      atmoStrength: 1.1,
      seed: 3.1,
      tilt: 0.38,
      view: 0.95,
    },
  },
  {
    slug: "skills",
    name: "Skills",
    kind: "skills",
    accent: "#4ff0c0",
    world: "Kristallwelt",
    fallback: "radial-gradient(circle at 35% 35%, #e8fffb, #3fd6c6 40%, #0f4f5c 80%)",
    body: {
      kind: "crystal",
      radius: 1.4,
      orbit: 24,
      colors: ["#0f4f5c", "#3fd6c6", "#e8fffb", "#6bffe0"],
      atmo: "#59f5d0",
      atmoStrength: 0.8,
      seed: 7.7,
      tilt: 0.2,
      crystals: skillCount,
      view: -0.9,
    },
  },
  {
    slug: "apps-spiele",
    name: "Apps & Spiele",
    kind: "projects",
    group: "apps",
    accent: "#ff7a4d",
    world: "Lavawelt",
    fallback: "radial-gradient(circle at 35% 35%, #ffb347, #c22a0a 35%, #17100e 75%)",
    body: {
      kind: "lava",
      radius: 1.55,
      orbit: 31,
      colors: ["#17100e", "#4a3a34", "#c22a0a", "#ffb347"],
      atmo: "#ff6a3d",
      atmoStrength: 0.9,
      seed: 1.9,
      tilt: 0.1,
      view: 0.9,
    },
  },
  {
    slug: "web",
    name: "Web",
    kind: "projects",
    group: "web",
    accent: "#a48bff",
    world: "Gasriese",
    fallback: "repeating-linear-gradient(170deg, #2b1d5c 0 8%, #8d7bd9 8% 15%, #e0d6ff 15% 19%, #5a2b7a 19% 27%)",
    body: {
      kind: "gas",
      radius: 2.7,
      orbit: 40.5,
      colors: ["#2b1d5c", "#8d7bd9", "#e0d6ff", "#ff9ad5", "#5a2b7a"],
      atmo: "#a28cff",
      atmoStrength: 1.0,
      seed: 4.4,
      tilt: 0.16,
      view: -0.85,
    },
  },
  {
    slug: "minecraft",
    name: "Minecraft",
    kind: "projects",
    group: "minecraft",
    accent: "#8ee05c",
    world: "Blockwelt",
    fallback: "conic-gradient(from 45deg, #5aa83a 0 25%, #2f5fd0 0 50%, #d9c78a 0 75%, #7d7d7d 0)",
    body: {
      kind: "voxel",
      radius: 1.75,
      orbit: 50,
      colors: ["#2f5fd0", "#d9c78a", "#5aa83a", "#7d7d7d", "#f2f6f8"],
      atmo: "#8fd7ff",
      atmoStrength: 0.9,
      seed: 12.3,
      tilt: 0.3,
      view: 0.95,
    },
  },
  {
    slug: "schule-hardware",
    name: "Schule & Hardware",
    kind: "projects",
    group: "school",
    accent: "#ffc14d",
    world: "Platinenwelt",
    fallback: "radial-gradient(circle at 35% 35%, #ffc14d 0 6%, #0c2a22 7% 60%, #06140f)",
    body: {
      kind: "circuit",
      radius: 1.6,
      orbit: 58.5,
      colors: ["#0c2a22", "#b07a3a", "#16191e", "#ffc14d"],
      atmo: "#ffc66b",
      atmoStrength: 0.7,
      seed: 5.5,
      tilt: 0.24,
      view: -0.95,
    },
  },
  {
    slug: "zeitleiste",
    name: "Zeitleiste",
    kind: "timeline",
    accent: "#ff8fbf",
    world: "Ringplanet",
    fallback: "repeating-linear-gradient(175deg, #e8c9b0 0 10%, #c98a8f 10% 18%, #fff0e0 18% 24%)",
    body: {
      kind: "ringed",
      radius: 2.2,
      orbit: 67,
      colors: ["#e8c9b0", "#c98a8f", "#fff0e0", "#8a5a7a"],
      atmo: "#ffb3cf",
      atmoStrength: 0.8,
      seed: 9.2,
      tilt: 0.42,
      ring: { inner: 1.45, outer: 2.5, colors: ["#f3d6c8", "#b9849a"], tilt: 0.12 },
      view: 0.8,
    },
  },
  {
    slug: "kontakt",
    name: "Kontakt",
    kind: "contact",
    accent: "#8fe9ff",
    world: "Eiswelt",
    fallback: "radial-gradient(circle at 35% 35%, #ffffff, #8fb3d9 45%, #2b5f8f 80%)",
    body: {
      kind: "aurora",
      radius: 1.3,
      orbit: 75,
      colors: ["#dfefff", "#8fb3d9", "#2b5f8f", "#49ffb0", "#ff5fd2"],
      atmo: "#8fe9ff",
      atmoStrength: 1.0,
      seed: 2.6,
      tilt: 0.28,
      view: -0.9,
    },
  },
];

export const sections: Section[] = seeds.map((s, i) => {
  const projects = s.group ? projectsIn(s.group) : [];
  return {
    ...s,
    number: i + 1,
    projects,
    body: { ...s.body, key: s.slug, accent: s.accent, moons: projects.map((p) => p.id) },
  };
});

export const sectionBySlug = (slug: string) => sections.find((s) => s.slug === slug);

/** The planet a project orbits. */
export const sectionOfProject = (projectId: string) => sections.find((s) => s.projects.some((p) => p.id === projectId));

export const HOME_ACCENT = "#ffb86b";
