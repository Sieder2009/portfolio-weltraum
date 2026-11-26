import { about, githubSince, projects, skillCount } from "../content";
import { sections } from "../config/sections";
import type { LabelFrame } from "../three/universe";
import { ICON, chars, coarsePointer, esc, initials, pad2, prettyUrl, reducedMotion, roll } from "./util";

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
  // (the ships of the background battle open a mini game; without motion there are no ships, only the link)
  const game = reducedMotion.matches ? "Minispiel starten" : `${coarsePointer.matches ? "Raumschiff antippen" : "Raumschiff anklicken"}: Minispiel`;
  const hint =
    (coarsePointer.matches
      ? "Wischen fliegt zum nächsten Planeten · Planet antippen springt direkt hin"
      : `Scrollen fliegt zum nächsten Planeten · <kbd>←</kbd><kbd>→</kbd> springen · Ziehen dreht das System`) +
    ` · <a class="hint-link" href="#/spiel">${game}</a>`;
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

/** pictures of the real planets, once the scene has drawn them (for parts rendered later, like the 404 overlay) */
let thumbs: string[] = [];

/** Swaps the CSS stand-ins for pictures of the real planets. */
export function setThumbnails(urls: string[], root: ParentNode = document) {
  thumbs = urls;
  root.querySelectorAll<HTMLElement>("[data-thumb]").forEach((el) => {
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
        <a href="#/spiel">Minispiel <span>Sternenschwarm</span></a>
      </div>
    </div>`;
}

// ---------- Loader ----------
// The loading screen is in index.html from the first paint (sun, name, bar). Once the scripts are there, the planets
// join on their orbits and light up one after another while the scene is built.

interface LoaderState {
  target: number;
  shown: number;
  last: number;
  pct: string;
  orbits: HTMLElement[];
}

const loaders = new WeakMap<HTMLElement, LoaderState>();

export function renderLoader(el: HTMLElement) {
  const system = el.querySelector<HTMLElement>(".loader-system");
  if (system && !system.querySelector(".lo-orbit")) {
    const orbits = sections.map((s) => s.body.orbit);
    const sizes = sections.map((s) => s.body.radius);
    const [o0, o1] = [Math.min(...orbits), Math.max(...orbits)];
    const [s0, s1] = [Math.min(...sizes), Math.max(...sizes)];
    system.insertAdjacentHTML(
      "beforeend",
      sections
        .map((s, i) => {
          // (the real orbits and sizes, scaled down; inner planets turn faster, as with Kepler)
          const r = 64 + ((s.body.orbit - o0) / Math.max(1e-6, o1 - o0)) * 90;
          const size = 5 + ((s.body.radius - s0) / Math.max(1e-6, s1 - s0)) * 5;
          const period = 5.5 * Math.pow(r / 64, 1.5);
          const phase = (i * 0.618034) % 1;
          return `<span class="lo-orbit" style="--r:${r.toFixed(1)}px;--s:${size.toFixed(1)}px;--t:${period.toFixed(2)}s;--o:${(-phase * period).toFixed(2)}s;--angle:${(phase * 360).toFixed(1)}deg;--a:${s.accent};--n:${i}"><i class="lo-ring"></i><i class="lo-path"><i class="lo-spin"><b class="lo-planet"></b></i></i></span>`;
        })
        .join(""),
    );
  }
  const state: LoaderState = { target: 0, shown: 0, last: 0, pct: "", orbits: [...el.querySelectorAll<HTMLElement>(".lo-orbit")] };
  loaders.set(el, state);
  requestAnimationFrame(() => el.classList.add("is-built"));

  const pct = el.querySelector<HTMLElement>(".loader-pct");
  const tick = (now: number) => {
    const dt = state.last ? Math.min((now - state.last) / 1000, 0.1) : 0.016;
    state.last = now;
    state.shown += (state.target - state.shown) * (1 - Math.exp(-dt * 4.5));
    if (state.target - state.shown < 0.003) state.shown = state.target;
    const text = `${Math.round(state.shown * 100)} %`;
    if (pct && text !== state.pct) pct.textContent = state.pct = text;
    // (planet n of 8 lights up at n/9 of the way)
    const lit = Math.floor(state.shown * (state.orbits.length + 1) + 1e-6);
    state.orbits.forEach((o, i) => o.classList.toggle("is-on", i < lit));
    if (el.isConnected && !el.classList.contains("is-done")) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function setLoaderProgress(el: HTMLElement, p: number, label: string) {
  const state = loaders.get(el);
  const target = Math.max(state?.target ?? 0, Math.min(1, p));
  if (state) state.target = target;
  const fill = el.querySelector<HTMLElement>(".lb-fill");
  const creep = el.querySelector<HTMLElement>(".lb-creep");
  if (fill) fill.style.transform = `scaleX(${target})`;
  // While a step runs, a paler bar inches on toward the next one: a long CSS transition, so it keeps moving while
  // the page is busy building the scene.
  if (creep) creep.style.transform = `scaleX(${target >= 1 ? 1 : Math.min(0.97, target + 0.16)})`;
  const status = el.querySelector(".loader-status");
  if (status) status.textContent = label;
  el.classList.toggle("is-ready", target >= 1);
}

/** The start went wrong: the loading screen says so and offers to reload (index.html handles the button). */
export function setLoaderFailed(el: HTMLElement | null) {
  if (!el || !document.documentElement.classList.contains("is-loading")) return;
  document.documentElement.classList.add("load-failed");
  el.removeAttribute("aria-hidden");
  const status = el.querySelector(".loader-status");
  if (status) status.textContent = "Start fehlgeschlagen";
}

// ---------- 404 inside the page: an address "#/…" that leads nowhere ----------

export function renderLost(el: HTMLElement, address: string) {
  el.innerHTML = `
    <div class="lost-inner">
      <button class="icon-btn lost-close" type="button"><span class="ib-icon">${ICON.close}</span><span class="ib-label">Schließen</span></button>
      <div class="lost-code" aria-hidden="true">
        <span class="lc-digit">4</span>
        <span class="lc-zero"><span class="lc-ring"></span><span class="lc-ghost"></span><span class="lc-path"><span class="lc-spin"><span class="lc-moon"></span></span></span></span>
        <span class="lc-digit">4</span>
      </div>
      <p class="kicker" data-r><span class="kdot"></span>Fehler 404 · Signal verloren</p>
      <h2 class="lost-title" id="lost-title" tabindex="-1">${chars("Hier ist nur leerer Raum.")}</h2>
      <p class="lost-text" data-r>Unter <code>${esc(address)}</code> gibt es keinen Planeten – vielleicht ein Tippfehler oder ein veralteter Link.</p>
      <div class="lost-actions" data-r>
        <a class="btn btn-primary" href="#/"><span>Zurück zur Sonne</span>${ICON.arrowRight}</a>
        <a class="btn" href="#/spiel"><span>Minispiel spielen</span></a>
      </div>
      <nav class="lost-dest" aria-labelledby="lost-dest-title" data-r>
        <p class="lost-dest-title" id="lost-dest-title">Oder Kurs setzen auf</p>
        <ul>${sections
          .map(
            (s) => `<li><a href="#/${s.slug}" style="--accent:${s.accent}">
              <span class="ld-orb" aria-hidden="true" data-thumb="${s.number - 1}" style="background:${s.fallback}"></span>
              <span class="ld-num">${pad2(s.number)}</span>${esc(s.name)}</a></li>`,
          )
          .join("")}</ul>
      </nav>
    </div>`;
  if (thumbs.length) setThumbnails(thumbs, el);
}
