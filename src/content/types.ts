// Shape of src/content/portfolio.json (written by scripts/content/parse.mjs from portfolio-daten.txt).

export interface Link {
  label: string;
  url: string;
}

export interface ImageRef {
  alt: string;
  src: string;
  /** whether the file exists in public/ (checked when the JSON is generated) */
  available: boolean;
}

export interface LabelValue {
  label: string;
  value: string;
}

export interface ExtraField {
  label: string;
  text?: string;
  items?: string[];
}

export interface Project {
  id: string;
  number: number;
  title: string;
  shortTitle: string;
  subtitle: string;
  category: string;
  period: string;
  /** "YYYY-MM", only used for sorting */
  start: string;
  status: string;
  summary: string;
  description: string[];
  tech: string[];
  features: string[];
  links: Link[];
  images: ImageRef[];
  metrics: LabelValue[];
  palette: string[];
  circuits: string[];
  /** fields the text file marks as "Noch leer" */
  missing: string[];
  extra: ExtraField[];
}

export interface SkillGroup {
  group: string;
  items: string[];
}

export interface About {
  name: string;
  githubName: string;
  siteTitle: string;
  greeting: string;
  intro: string;
  text: string[];
  facts: LabelValue[];
  skills: SkillGroup[];
  links: Link[];
  images: ImageRef[];
}

export interface PortfolioData {
  updated: string;
  about: About;
  projects: Project[];
}
