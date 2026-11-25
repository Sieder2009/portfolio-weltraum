import { about, githubSince, projects, skillCount } from "../content";
import { sections } from "../config/sections";
import type { LabelFrame } from "../three/universe";
import { ICON, chars, coarsePointer, esc, initials, pad2, prettyUrl, roll } from "./util";

// ---------- Top bar ----------

export function renderTopbar(el: HTMLElement) {
  el.innerHTML = `
    <a class="brand" href="#/" aria-label="${esc(about.name)} – Start">
      <span class="brand-mark" aria-hidden="true">${esc(initials(about.name))}</span>
      <span class="brand-name">${roll(about.name)}</span>
    </a>
    <div class="topbar-actions">
      <button class="icon-btn sound-btn" type="button" aria-pressed="false">
        <span class="ib-icon">${ICON.soundOff}</span><span class="ib-label">Ton aus</span>
      </button>
      <button class="icon-btn menu-btn" type="button" aria-expanded="false" aria-controls="menu">
        <span class="ib-icon">${ICON.menu}</span><span class="ib-label">Menü</span>
      </button>
    </div>`;
}

export function setSoundButton(el: HTMLElement, on: boolean) {
  const btn = el.querySelector<HTMLButtonElement>(".sound-btn");
  if (!btn) return;
  btn.setAttribute("aria-pressed", String(on));
  btn.querySelector(".ib-icon")!.innerHTML = on ? ICON.soundOn : ICON.soundOff;
  btn.querySelector(".ib-label")!.textContent = on ? "Ton an" : "Ton aus";
}

// ---------- Hero (the sun / start) ----------

export function renderHero(el: HTMLElement) {
  const words = about.name.split(" ");
  const last = words.pop() ?? "";
  const first = words.join(" ");
  const since = githubSince();
  const firstSection = sections[0];
  const timelineSection = sections.find((s) => s.kind === "timeline");
  const hint = coarsePointer.matches
    ? "Wischen fliegt zum nächsten Planeten · Planet antippen springt direkt hin"
    : `Scrollen fliegt zum nächsten Planeten · <kbd>←</kbd><kbd>→</kbd> springen · Ziehen dreht das System`;
  el.innerHTML = `
    <div class="hero-inner">
      <p class="kicker" data-r><span class="kdot"></span>${esc(about.githubName || "Portfolio")} · Portfolio</p>
      <h1 class="hero-title" id="hero-title">
        ${first ? `<span class="hero-line">${chars(first)}</span>` : ""}
        <span class="hero-line">${chars(last, first.length)}</span>
      </h1>
      ${about.greeting ? `<p class="hero-greeting" data-r>${esc(about.greeting)}</p>` : ""}
      ${about.intro ? `<p class="hero-intro" data-r>${esc(about.intro)}</p>` : ""}
      <ul class="hero-stats" data-r>
        <li><b>${projects.length}</b> Projekte</li>
        <li><b>${skillCount}</b> Skills</li>
        ${since ? `<li>auf GitHub seit <b>${esc(since)}</b></li>` : ""}
      </ul>
      <div class="hero-actions" data-r>
        <a class="btn btn-primary" href="#/${firstSection.slug}"><span>System erkunden</span>${ICON.arrowRight}</a>
        ${timelineSection ? `<a class="btn" href="#/${timelineSection.slug}"><span>Alle Projekte</span></a>` : ""}
      </div>
      <p class="hero-hint" data-r>${hint}</p>
      <p class="hero-swipe" data-r aria-hidden="true"><span class="hs-line"></span>${coarsePointer.matches ? "Wischen" : "Scrollen"} zum Losfliegen</p>
    </div>
    <div class="scroll-cue" aria-hidden="true">
      <span class="scroll-cue-text">${coarsePointer.matches ? "Wischen" : "Scrollen"} zum Losfliegen</span>
      <span class="scroll-cue-line"></span>
    </div>`;
}

// ---------- The journey: a stretch of travel, then a stop with its card, per planet ----------

export function renderStops(el: HTMLElement, card: (index: number) => string) {
  el.insertAdjacentHTML(
    "beforeend",
    sections
      .map(
        (s, i) => `
      <div class="travel" data-travel="${s.number}" aria-hidden="true">
        <div class="travel-sign" style="--accent:${s.accent}">
          <span class="ts-kicker">Nächster Halt</span>
          <span class="ts-name"><span class="ts-num">${pad2(s.number)}</span>${esc(s.name)}</span>
          <span class="ts-world">${esc(s.world)}</span>
        </div>
      </div>
      <section class="stop stop-planet" id="stop-${s.slug}" data-stop="${s.number}" style="--accent:${s.accent}" aria-labelledby="title-${s.slug}">
        <div class="stop-card">${card(i)}</div>
      </section>`,
      )
      .join("") + `<div class="journey-end" aria-hidden="true"></div>`,
  );
}

// ---------- Dock: one button per planet ----------

export function renderDock(el: HTMLElement) {
  const items = [
    `<li><a class="dock-item is-home" href="#/" data-index="0" style="--accent:#ffb86b">
        <span class="dock-orb sun-orb" aria-hidden="true"></span>
        <span class="dock-label"><span class="dl-num">00</span>Start</span>
      </a></li>`,
    ...sections.map(
      (s) => `<li><a class="dock-item" href="#/${s.slug}" data-index="${s.number}" style="--accent:${s.accent}">
        <span class="dock-orb" aria-hidden="true" data-thumb="${s.number - 1}" style="background:${s.fallback}"></span>
        <span class="dock-label"><span class="dl-num">${pad2(s.number)}</span>${esc(s.name)}</span>
      </a></li>`,
    ),
  ];
  el.innerHTML = `<ol class="dock-list">${items.join("")}</ol>`;
}

export function setDockActive(el: HTMLElement, index: number) {
  el.querySelectorAll<HTMLElement>(".dock-item").forEach((a) => {
    const on = Number(a.dataset.index) === index;
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

/** Swaps the CSS stand-ins for pictures of the real planets. */
export function setThumbnails(urls: string[]) {
  document.querySelectorAll<HTMLElement>("[data-thumb]").forEach((el) => {
    const url = urls[Number(el.dataset.thumb)];
    if (!url) return;
    let img = el.querySelector("img");
    if (!img) {
      img = document.createElement("img");
      img.alt = "";
      el.appendChild(img);
    }
    img.src = url;
    img.hidden = false;
    el.classList.add("has-thumb");
  });
}

// ---------- Labels that follow the planets and moons ----------

export class Labels {
  private planets: HTMLButtonElement[] = [];
  private moons = new Map<string, HTMLAnchorElement>();
  private focused: number | null = null;
  private overview = true;

  constructor(
    private el: HTMLElement,
    handlers: { select: (index: number) => void; hover: (index: number | null) => void; hoverMoon: (id: string | null) => void },
  ) {
    sections.forEach((s, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "plabel";
      b.style.setProperty("--accent", s.accent);
      b.setAttribute("aria-label", `Planet ${s.number}: ${s.name}`);
      b.innerHTML = `<span class="plabel-ring"></span><span class="plabel-text"><span class="plabel-num">${pad2(s.number)}</span><span class="plabel-name">${esc(s.name)}</span></span>`;
      b.addEventListener("click", () => handlers.select(i));
      b.addEventListener("pointerenter", () => handlers.hover(i));
      b.addEventListener("pointerleave", () => handlers.hover(null));
      b.addEventListener("focus", () => handlers.hover(i));
      b.addEventListener("blur", () => handlers.hover(null));
      this.el.appendChild(b);
      this.planets.push(b);
      for (const p of s.projects) {
        const a = document.createElement("a");
        a.className = "mlabel";
        a.href = `#/${s.slug}/${p.id}`;
        a.style.setProperty("--accent", s.accent);
        a.innerHTML = `<span class="mlabel-ring"></span><span class="mlabel-text">${esc(p.shortTitle)}</span>`;
        a.addEventListener("pointerenter", () => handlers.hoverMoon(p.id));
        a.addEventListener("pointerleave", () => handlers.hoverMoon(null));
        a.addEventListener("focus", () => handlers.hoverMoon(p.id));
        a.addEventListener("blur", () => handlers.hoverMoon(null));
        this.el.appendChild(a);
        this.moons.set(p.id, a);
      }
    });
  }

  /** Planet labels belong to the overview; moon labels to the planet the camera is at. */
  private setState(focused: number | null, overview: boolean) {
    if (focused === this.focused && overview === this.overview) return;
    this.focused = focused;
    this.overview = overview;
    this.el.classList.toggle("is-focus", !overview);
    this.planets.forEach((b) => (b.tabIndex = overview ? 0 : -1));
    const ids = new Set(focused !== null ? sections[focused].projects.map((p) => p.id) : []);
    this.moons.forEach((a, id) => {
      const on = ids.has(id);
      a.classList.toggle("is-on", on);
      a.tabIndex = on ? 0 : -1;
    });
  }

  /** The project that is open: its moon keeps its label on small screens. */
  setCurrent(projectId: string | null) {
    this.moons.forEach((a, id) => a.classList.toggle("is-current", id === projectId));
  }

  setHover(planet: number | null, moon: string | null) {
    this.planets.forEach((b, i) => b.classList.toggle("is-hover", i === planet));
    this.moons.forEach((a, id) => a.classList.toggle("is-hover", id === moon));
  }

  /** Right edge of the free space beside the cards (labels past it turn to the left). */
  private planetRight = Infinity;

  setPlanetRight(px: number) {
    this.planetRight = px;
  }

  update(frame: LabelFrame) {
    this.setState(frame.focused, frame.closeness < 0.35);
    // Near the right edge (of the screen, or of the space left beside the card) the text goes to the left of
    // its planet, so it never runs off the screen or under the card.
    const right = frame.closeness > 0.5 ? Math.min(this.planetRight, window.innerWidth) : window.innerWidth;
    const flipAt = right - 170;
    frame.planets.forEach((p, i) => {
      const b = this.planets[i];
      const show = p.visible && this.overview;
      b.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
      b.style.setProperty("--d", `${Math.max(p.r * 2 + 14, 28).toFixed(1)}px`);
      b.classList.toggle("is-hidden", !show);
      b.classList.toggle("is-left", p.x > flipAt);
    });
    for (const m of frame.moons) {
      const a = this.moons.get(m.projectId);
      if (!a) continue;
      a.style.transform = `translate3d(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px, 0)`;
      a.style.setProperty("--d", `${Math.max(m.r * 2 + 12, 22).toFixed(1)}px`);
      a.classList.toggle("is-hidden", !m.visible);
      a.classList.toggle("is-left", m.x > flipAt);
    }
  }
}

// ---------- Menu overlay ----------

export function renderMenu(el: HTMLElement) {
  const rows = [
    `<li><a class="menu-link" href="#/" style="--i:0;--accent:#ffb86b">
      <span class="ml-num">00</span><span class="ml-orb sun-orb" aria-hidden="true"></span>
      <span class="ml-name">${roll("Start")}</span><span class="ml-world">Sonne</span></a></li>`,
    ...sections.map(
      (s) => `<li><a class="menu-link" href="#/${s.slug}" style="--i:${s.number};--accent:${s.accent}">
        <span class="ml-num">${pad2(s.number)}</span>
        <span class="ml-orb" aria-hidden="true" data-thumb="${s.number - 1}" style="background:${s.fallback}"></span>
        <span class="ml-name">${roll(s.name)}</span>
        <span class="ml-world">${esc(s.world)}${s.projects.length ? ` · ${s.projects.length} ${s.projects.length === 1 ? "Projekt" : "Projekte"}` : ""}</span>
      </a></li>`,
    ),
  ];
  el.innerHTML = `
    <div class="menu-inner">
      <div class="menu-head">
        <p class="kicker"><span class="kdot"></span>Navigation</p>
        <button class="icon-btn menu-close" type="button"><span class="ib-icon">${ICON.close}</span><span class="ib-label">Schließen</span></button>
      </div>
      <nav aria-label="Alle Bereiche"><ol class="menu-list">${rows.join("")}</ol></nav>
      <div class="menu-foot">
        ${about.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} <span>${esc(prettyUrl(l.url))}</span></a>`).join("")}
      </div>
    </div>`;
}

// ---------- Loader ----------

export function renderLoader(el: HTMLElement) {
  el.innerHTML = `
    <div class="loader-center">
      <div class="loader-orbit" aria-hidden="true"><span class="lo-sun"></span><span class="lo-ring"><span class="lo-planet"></span></span></div>
      <p class="loader-name">${chars(about.name)}</p>
      <div class="loader-bar"><span></span></div>
      <p class="loader-status">Sonnensystem wird geladen</p>
    </div>`;
  requestAnimationFrame(() => el.classList.add("is-in"));
}

export function setLoaderProgress(el: HTMLElement, p: number, label: string) {
  el.querySelector<HTMLElement>(".loader-bar span")!.style.transform = `scaleX(${p})`;
  el.querySelector(".loader-status")!.textContent = label;
}
