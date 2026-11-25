import { about, projectsUsing, skillCount, timeline, updated, type Project } from "../content";
import type { ImageRef } from "../content/types";
import { sections, sectionOfProject, type Section } from "../config/sections";
import { ICON, chars, esc, pad2, prettyUrl } from "./util";

const route = (section: Section, project?: Project) => `#/${section.slug}${project ? `/${project.id}` : ""}`;

const external = (url: string, label: string, cls = "btn") =>
  `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span>${esc(label)}</span>${ICON.external}</a>`;

function head(section: Section, sub: string) {
  return `
    <header class="sec-head" data-r>
      <p class="kicker"><span class="kdot"></span>Planet ${pad2(section.number)} · ${esc(section.world)}</p>
      <h2 class="sec-title" id="title-${section.slug}" tabindex="-1">${chars(section.name)}</h2>
      ${sub ? `<p class="sec-sub">${esc(sub)}</p>` : ""}
    </header>`;
}

function block(title: string, body: string, extraClass = "") {
  return `<section class="block ${extraClass}" data-r><h3 class="block-title">${esc(title)}</h3>${body}</section>`;
}

function nextPlanet(section: Section) {
  const next = sections[section.number];
  if (!next) {
    return `
    <a class="next-planet" href="#/" data-r style="--next:#ffb86b">
      <span class="np-label">Ende der Reise</span>
      <span class="np-name"><span class="np-num">00</span>Zurück zur Sonne</span>
      <span class="np-arrow">${ICON.arrowRight}</span>
    </a>`;
  }
  return `
    <a class="next-planet" href="${route(next)}" data-r style="--next:${next.accent}">
      <span class="np-label">Weiterfliegen – oder einfach weiterscrollen</span>
      <span class="np-name"><span class="np-num">${pad2(next.number)}</span>${esc(next.name)}</span>
      <span class="np-arrow">${ICON.arrowRight}</span>
    </a>`;
}

/** Images named in the text file: shown when the files are there, otherwise clearly marked as missing. */
function images(list: ImageRef[]) {
  if (!list.length) return "";
  const present = list.filter((i) => i.available);
  const missing = list.filter((i) => !i.available);
  let html = "";
  if (present.length) {
    html += block(
      "Bilder",
      `<div class="gallery">${present
        .map((i) => `<figure><img src="${esc(i.src)}" alt="${esc(i.alt)}" loading="lazy" decoding="async"><figcaption>${esc(i.alt)}</figcaption></figure>`)
        .join("")}</div>`,
    );
  }
  if (missing.length) {
    html += block(
      present.length ? "Weitere Bilder" : "Bilder",
      `<p class="open-note"><span class="badge-open">Noch nicht hinterlegt</span>
        ${missing.length === 1 ? "Ein Bild ist" : `${missing.length} Bilder sind`} in der Textdatei beschrieben, die Datei${missing.length === 1 ? "" : "en"} fehl${missing.length === 1 ? "t" : "en"} noch.</p>
       <details class="open-details"><summary>Beschreibungen anzeigen</summary>
         <ul>${missing.map((i) => `<li>${esc(i.alt)}${i.src ? ` <code>public/${esc(i.src)}</code>` : ""}</li>`).join("")}</ul>
       </details>`,
      "is-open-block",
    );
  }
  return html;
}

// ---------- Über mich ----------

function factValue(label: string, value: string) {
  const link = about.links.find((l) => l.label.toLowerCase() === label.toLowerCase());
  if (link) return external(link.url, value, "inline-link");
  // "Kilo", "Gameboy mit Raspberry Pi (2026/27, …)": a project of the same name gets a link to it.
  // (Not for names and handles: the Minecraft name only happens to match a project title.)
  if (/name/i.test(label)) return esc(value);
  const project = [...sectionProjects()].sort((a, b) => b.shortTitle.length - a.shortTitle.length).find((p) => value === p.shortTitle || value.startsWith(p.shortTitle + " "));
  if (project) {
    const s = sectionOfProject(project.id)!;
    const rest = value.slice(project.shortTitle.length);
    return `<a class="inline-link" href="${route(s, project)}">${esc(project.shortTitle)}</a>${esc(rest)}`;
  }
  return esc(value);
}

function sectionProjects() {
  return sections.flatMap((s) => s.projects);
}

function aboutView(section: Section) {
  const facts = about.facts
    .map((f) => `<div class="fact"><dt>${esc(f.label)}</dt><dd>${factValue(f.label, f.value)}</dd></div>`)
    .join("");
  return `
    ${head(section, about.name)}
    ${about.text.length ? `<div class="lead" data-r>${about.text.map((t) => `<p>${esc(t)}</p>`).join("")}</div>` : ""}
    ${facts ? block("Fakten", `<dl class="facts">${facts}</dl>`) : ""}
    ${about.links.length ? block("Links", `<div class="actions">${about.links.map((l) => external(l.url, l.label)).join("")}</div>`) : ""}
    ${images(about.images)}
    ${nextPlanet(section)}`;
}

// ---------- Skills ----------

function skillsView(section: Section) {
  const groups = about.skills
    .map((g, gi) => {
      const chips = g.items
        .map((item) => {
          const used = projectsUsing(item);
          if (!used.length) return `<li><span class="chip">${esc(item)}</span></li>`;
          return `<li><button class="chip chip-skill" type="button" data-skill="${esc(item)}" data-group="${gi}" aria-expanded="false">${esc(item)}<span class="chip-n" aria-label="${used.length} Projekte">${used.length}</span></button></li>`;
        })
        .join("");
      return `
        <section class="skill-group" data-r>
          <h3 class="block-title">${esc(g.group)} <span class="count">${pad2(g.items.length)}</span></h3>
          <ul class="chips">${chips}</ul>
          <div class="skill-uses" id="skill-uses-${gi}" hidden></div>
        </section>`;
    })
    .join("");
  return `
    ${head(section, `${skillCount} Skills in ${about.skills.length} Bereichen`)}
    <p class="hint" data-r>Die Zahl am Skill zeigt, in wie vielen Projekten er unter „Technik“ steht – antippen für die Liste.</p>
    <div class="skill-groups">${groups}</div>
    ${nextPlanet(section)}`;
}

/** Shows (or hides) the projects that use a skill, below its group. */
export function toggleSkill(button: HTMLButtonElement) {
  const group = button.closest(".skill-group");
  const box = group?.querySelector<HTMLElement>(".skill-uses");
  if (!group || !box) return;
  const open = button.getAttribute("aria-expanded") === "true";
  group.querySelectorAll(".chip-skill").forEach((b) => b.setAttribute("aria-expanded", "false"));
  if (open) {
    box.hidden = true;
    return;
  }
  const skill = button.dataset.skill!;
  const used = projectsUsing(skill);
  button.setAttribute("aria-expanded", "true");
  button.setAttribute("aria-controls", box.id);
  box.innerHTML = `<p class="uses-title">${esc(skill)} in</p><ul class="uses">${used
    .map((p) => {
      const s = sectionOfProject(p.id)!;
      return `<li><a href="${route(s, p)}" style="--c:${s.accent}"><span class="uses-dot"></span>${esc(p.shortTitle)}<span class="uses-planet">${esc(s.name)}</span></a></li>`;
    })
    .join("")}</ul>`;
  box.hidden = false;
}

// ---------- Project planets ----------

function projectsView(section: Section) {
  const items = section.projects
    .map(
      (p, i) => `
      <li data-r>
        <a class="proj-card" href="${route(section, p)}" data-project="${esc(p.id)}">
          <span class="pc-index">${pad2(i + 1)}</span>
          <span class="pc-body">
            <span class="pc-title">${esc(p.shortTitle)}${p.subtitle ? ` <span class="pc-sub">${esc(p.subtitle)}</span>` : ""}</span>
            <span class="pc-meta">${esc(p.category)}${p.period ? ` · ${esc(p.period)}` : ""}</span>
            ${p.summary ? `<span class="pc-summary">${esc(p.summary)}</span>` : ""}
          </span>
          <span class="pc-arrow">${ICON.arrowRight}</span>
        </a>
      </li>`,
    )
    .join("");
  const n = section.projects.length;
  return `
    ${head(section, `${n} ${n === 1 ? "Projekt" : "Projekte"} · jeder Mond ist eines davon`)}
    <ol class="proj-list">${items}</ol>
    ${nextPlanet(section)}`;
}

export function projectView(section: Section, p: Project) {
  const list = section.projects;
  const i = list.indexOf(p);
  const prev = list[(i - 1 + list.length) % list.length];
  const next = list[(i + 1) % list.length];

  const meta = [
    p.period ? `<div><dt>Zeitraum</dt><dd>${esc(p.period)}</dd></div>` : "",
    p.status ? `<div><dt>Status</dt><dd>${esc(p.status)}</dd></div>` : "",
  ].join("");

  const extra = p.extra
    .map((x) =>
      block(x.label, x.items ? `<ul class="features">${x.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<p>${esc(x.text ?? "")}</p>`),
    )
    .join("");

  return `
    <a class="back" href="${route(section)}" data-r>${ICON.arrowLeft}<span>${esc(section.name)}</span></a>
    <header class="sec-head proj-head" data-r>
      <p class="kicker"><span class="kdot"></span>Projekt ${pad2(i + 1)} / ${pad2(list.length)} · ${esc(p.category)}</p>
      <h2 class="sec-title" id="panel-title" tabindex="-1">${chars(p.shortTitle)}</h2>
      ${p.subtitle ? `<p class="sec-sub">${esc(p.subtitle)}</p>` : ""}
    </header>
    ${meta ? `<dl class="meta" data-r>${meta}</dl>` : ""}
    ${p.summary ? `<p class="lead" data-r>${esc(p.summary)}</p>` : ""}
    ${p.links.length ? `<div class="actions" data-r>${p.links.map((l, n) => external(l.url, l.label, n === 0 ? "btn btn-primary" : "btn")).join("")}</div>` : ""}
    ${
      p.metrics.length
        ? `<div class="metrics" data-r>${p.metrics.map((m) => `<div class="metric"><span class="metric-value">${esc(m.value)}</span><span class="metric-label">${esc(m.label)}</span></div>`).join("")}</div>`
        : ""
    }
    ${p.description.length ? block("Beschreibung", p.description.map((t) => `<p>${esc(t)}</p>`).join("")) : ""}
    ${p.features.length ? block("Features", `<ul class="features">${p.features.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`) : ""}
    ${p.tech.length ? block("Technik", `<ul class="chips">${p.tech.map((t) => `<li><span class="chip">${esc(t)}</span></li>`).join("")}</ul>`) : ""}
    ${
      p.palette.length
        ? block(
            "Farbpalette",
            `<ul class="swatches">${p.palette.map((c) => `<li style="--c:${esc(c)}" title="${esc(c)}"><span class="sr-only">${esc(c)}</span></li>`).join("")}</ul>`,
          )
        : ""
    }
    ${p.circuits.length ? block("Schaltungen", `<ul class="chips">${p.circuits.map((t) => `<li><span class="chip">${esc(t)}</span></li>`).join("")}</ul>`) : ""}
    ${extra}
    ${images(p.images)}
    ${
      p.missing.length
        ? block(
            "Noch offen",
            `<p class="open-note">In der Textdatei noch nicht eingetragen:</p><ul class="chips">${p.missing.map((m) => `<li><span class="chip chip-open">${esc(m)}</span></li>`).join("")}</ul>`,
            "is-open-block",
          )
        : ""
    }
    ${
      list.length > 1
        ? `<nav class="pager" data-r aria-label="Weitere Projekte">
            <a href="${route(section, prev)}"><span class="pager-dir">${ICON.arrowLeft} Vorheriges</span><span class="pager-name">${esc(prev.shortTitle)}</span></a>
            <a href="${route(section, next)}" class="is-next"><span class="pager-dir">Nächstes ${ICON.arrowRight}</span><span class="pager-name">${esc(next.shortTitle)}</span></a>
          </nav>`
        : ""
    }`;
}

// ---------- Zeitleiste ----------

function timelineView(section: Section) {
  const entries = timeline();
  const years = [...new Set(entries.map((e) => e.year))];
  const count = entries.filter((e) => e.project).length;
  const ghLink = about.links.find((l) => /github/i.test(l.label));
  let html = "";
  for (const year of years) {
    html += `<li class="tl-year" data-r><span>${esc(year)}</span></li>`;
    for (const e of entries.filter((x) => x.year === year)) {
      const s = e.project ? sectionOfProject(e.project.id) : undefined;
      const href = s && e.project ? route(s, e.project) : ghLink?.url;
      const ext = !s && href ? ` target="_blank" rel="noopener noreferrer"` : "";
      const inner = `
        <span class="tl-when">${esc(e.when)}</span>
        <span class="tl-title">${esc(e.project ? e.project.shortTitle : e.title)}${e.project?.subtitle ? ` <span class="tl-sub">${esc(e.project.subtitle)}</span>` : ""}</span>
        <span class="tl-detail">${esc(e.detail)}${s ? ` · <span class="tl-planet">${esc(s.name)}</span>` : ""}</span>`;
      html += `<li class="tl-item" data-r style="--c:${s?.accent ?? "#ffffff"}">${href ? `<a class="tl-link" href="${esc(href)}"${ext}>${inner}</a>` : `<div class="tl-link">${inner}</div>`}</li>`;
    }
  }
  const span = years.length > 1 ? `${years[years.length - 1]}–${years[0]}` : years[0] ?? "";
  return `
    ${head(section, `${count} Projekte · ${span} · neueste zuerst`)}
    <ol class="timeline">${html}</ol>
    ${nextPlanet(section)}`;
}

// ---------- Kontakt ----------

function contactView(section: Section) {
  const links = about.links
    .map(
      (l) => `
      <li data-r>
        <a class="contact-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
          <span class="cl-label">${/github/i.test(l.label) ? ICON.github : ""}${esc(l.label)}</span>
          <span class="cl-url">${esc(prettyUrl(l.url))}</span>
          <span class="cl-arrow">${ICON.external}</span>
        </a>
      </li>`,
    )
    .join("");
  // Handles from the facts that are not links themselves (e.g. the Minecraft name): copy to the clipboard.
  const handles = about.facts.filter((f) => /name/i.test(f.label) && !about.links.some((l) => l.label.toLowerCase() === f.label.toLowerCase()));
  const copy = handles
    .map(
      (h) => `<button class="copy-handle" type="button" data-copy="${esc(h.value)}" data-r>
        <span class="ch-label">${esc(h.label)}</span><span class="ch-value">${esc(h.value)}</span><span class="ch-icon">${ICON.copy}<span>Kopieren</span></span>
      </button>`,
    )
    .join("");
  const year = new Date().getFullYear();
  return `
    ${head(section, about.name)}
    <ul class="contact-links">${links}</ul>
    ${copy ? `<div class="handles">${copy}</div>` : ""}
    <footer class="panel-foot" data-r>
      <span>© ${year} ${esc(about.name)}</span>
      ${updated ? `<span>Datenstand ${esc(updated)}</span>` : ""}
    </footer>
    ${nextPlanet(section)}`;
}

export function sectionView(section: Section) {
  switch (section.kind) {
    case "about":
      return aboutView(section);
    case "skills":
      return skillsView(section);
    case "projects":
      return projectsView(section);
    case "timeline":
      return timelineView(section);
    case "contact":
      return contactView(section);
  }
}
