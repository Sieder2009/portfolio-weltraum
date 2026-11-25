import Lenis from "lenis";
import { about, projectById } from "../content";
import { HOME_ACCENT, sectionBySlug, sectionOfProject, sections } from "../config/sections";
import { Universe, webglAvailable, type PickTarget } from "../three/universe";
import type { Frame, Journey } from "../three/cameraRig";
import {
  Labels,
  renderDock,
  renderHero,
  renderLoader,
  renderMenu,
  renderStops,
  renderTopbar,
  setDockActive,
  setLoaderProgress,
  setSoundButton,
  setThumbnails,
} from "./components";
import { Sound } from "./sound";
import { projectView, sectionView, toggleSkill } from "./views";
import { ICON, coarsePointer, copyText, nextFrame, reducedMotion, reveal, toast, wait } from "./util";

/** stop 0 is the start (the sun), 1…n the planets */
interface Route {
  stop: number;
  projectId: string | null;
}

/** The scroll range in which the camera holds at a stop; between two ranges it travels. */
interface StopRange {
  start: number;
  end: number;
  /** where navigation to this stop scrolls to */
  land: number;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const root = document.documentElement;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerpFrame = (a: Frame, b: Frame, t: number): Frame => ({
  width: b.width,
  height: b.height,
  offsetX: a.offsetX + (b.offsetX - a.offsetX) * t,
  offsetY: a.offsetY + (b.offsetY - a.offsetY) * t,
  freeWidth: a.freeWidth + (b.freeWidth - a.freeWidth) * t,
  freeHeight: a.freeHeight + (b.freeHeight - a.freeHeight) * t,
});

export class App {
  private stage = $("#stage");
  private canvas = $<HTMLCanvasElement>("#webgl");
  private labelsEl = $("#labels");
  private topbar = $("#topbar");
  private journeyEl = $("#journey");
  private hero = $("#hero");
  private panel = $("#panel");
  private scrim = $("#scrim");
  private dock = $("#dock");
  private menu = $("#menu");
  private loader = $("#loader");
  private panelScroll!: HTMLElement;
  private panelContent!: HTMLElement;
  private signs: HTMLElement[] = [];

  private lenis: Lenis;
  private universe: Universe | null = null;
  private labels: Labels | null = null;
  private sound = new Sound();

  private ranges: StopRange[] = [];
  private frames: { overview: Frame; planet: Frame } | null = null;
  private position = 0;
  private current = -1;
  private lastTime = 0;
  private measureQueued = false;
  private drawer: { projectId: string; pushed: boolean; returnFocus: HTMLElement | null } | null = null;
  private keyboardNav = false;
  private hoverPlanet: number | null = null;
  private hoverMoon: string | null = null;
  private started = false;

  constructor() {
    this.lenis = new Lenis({
      autoRaf: false,
      smoothWheel: !reducedMotion.matches,
      lerp: 0.085,
      wheelMultiplier: 0.9,
    });
    // (no scrolling while the loader is up)
    this.lenis.stop();
  }

  async start() {
    renderTopbar(this.topbar);
    renderHero(this.hero);
    renderStops(this.journeyEl, (i) => sectionView(sections[i]));
    this.signs = [...this.journeyEl.querySelectorAll<HTMLElement>(".travel-sign")];
    renderDock(this.dock);
    renderMenu(this.menu);
    renderLoader(this.loader);
    this.buildPanel();
    this.bindEvents();
    this.observeReveals();
    this.measure();

    if (webglAvailable()) {
      try {
        await this.startUniverse();
      } catch (err) {
        console.warn("3D-Szene nicht verfügbar, Textansicht wird verwendet.", err);
        this.universe?.stop();
        this.universe = null;
      }
    }
    if (!this.universe) {
      root.classList.add("no-webgl");
      setLoaderProgress(this.loader, 1, "Bereit");
      const loop = (t: number) => {
        this.frame(t);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    await Promise.race([document.fonts?.ready, wait(1500)]);
    this.measure();
    this.started = true;

    await this.hideLoader(this.parse(location.hash));
  }

  // ---------- 3D ----------

  private async startUniverse() {
    const universe = new Universe({
      canvas: this.canvas,
      bodies: sections.map((s) => s.body),
      reducedMotion: reducedMotion.matches,
      lowPower: coarsePointer.matches || (navigator.hardwareConcurrency ?? 8) <= 4,
      onHover: (t) => this.onSceneHover(t),
      onSelect: (t) => this.onSceneSelect(t),
      onFrame: (f) => this.labels?.update(f),
      beforeFrame: (time) => this.frame(time),
      onProgress: (p, label) => setLoaderProgress(this.loader, p * 0.9, label),
    });
    this.universe = universe;
    this.computeFrames();
    await universe.init();
    setThumbnails(universe.thumbnails(160));
    this.labels = new Labels(this.labelsEl, {
      select: (i) => this.goToStop(i + 1),
      hover: (i) => {
        this.hoverPlanet = i;
        universe.setExternalHover(i === null ? null : { type: "planet", index: i });
        this.labels?.setHover(i, this.hoverMoon);
        if (i !== null) this.sound.blip(1 + i * 0.04);
      },
      hoverMoon: (id) => {
        this.hoverMoon = id;
        const s = id ? sectionOfProject(id) : undefined;
        universe.setExternalHover(id && s ? { type: "moon", index: s.number - 1, projectId: id } : null);
        this.labels?.setHover(this.hoverPlanet, id);
      },
    });
    this.computeFrames();
    setLoaderProgress(this.loader, 1, "Bereit");
    universe.start();
  }

  private onSceneHover(t: PickTarget | null) {
    this.stage.classList.toggle("is-pointing", !!t);
    this.labels?.setHover(t?.type === "planet" ? t.index : null, t?.type === "moon" ? t.projectId : null);
    if (t) this.sound.blip(t.type === "planet" ? 1 + t.index * 0.04 : t.type === "moon" ? 1.5 : 0.8);
  }

  private onSceneSelect(t: PickTarget) {
    if (t.type === "sun") this.goToStop(0);
    else if (t.type === "planet") this.goToStop(t.index + 1);
    else this.open(`#/${sections[t.index].slug}/${t.projectId}`);
  }

  // ---------- The journey: scroll position → where the camera is ----------

  /** Runs every frame, before the 3D scene updates. */
  private frame(time: number) {
    const dt = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.1) : 0.016;
    this.lastTime = time;
    this.lenis.raf(time);
    if (!this.ranges.length) return;

    const j = this.journeyAt(this.lenis.scroll);
    this.universe?.setJourney(j);

    const position = j.from + (j.to - j.from) * j.t;
    this.sound.flight(dt > 0 ? (position - this.position) / dt : 0);
    this.position = position;

    const stop = j.from === j.to ? j.from : j.t < 0.5 ? j.from : j.to;
    if (stop !== this.current) this.onStop(stop);

    // The planet's framing slides from the overview (beside the hero) to beside the card.
    if (this.frames && this.universe) {
      const a = j.from > 0 ? 1 : 0;
      const b = j.to > 0 ? 1 : 0;
      this.universe.setFrame(lerpFrame(this.frames.overview, this.frames.planet, a + (b - a) * smooth(0, 1, j.t)));
    }

    // "Next stop" signs appear while approaching a planet.
    this.signs.forEach((sign) => {
      const n = Number(sign.parentElement!.dataset.travel);
      const show = j.to === n && j.from !== j.to ? smooth(0.12, 0.45, j.t) * (1 - smooth(0.82, 0.97, j.t)) : 0;
      sign.style.opacity = show.toFixed(3);
      sign.style.setProperty("--p", j.to === n ? j.t.toFixed(3) : "0");
    });
    this.dock.style.setProperty("--progress", (position / sections.length).toFixed(4));
  }

  private journeyAt(y: number): Journey {
    const r = this.ranges;
    if (y <= r[0].end) return { from: 0, to: 0, t: 0, hold: clamp01(y / Math.max(1, r[0].end)) };
    for (let i = 1; i < r.length; i++) {
      if (y < r[i].start) {
        return { from: i - 1, to: i, t: clamp01((y - r[i - 1].end) / Math.max(1, r[i].start - r[i - 1].end)), hold: 0 };
      }
      if (y <= r[i].end) return { from: i, to: i, t: 0, hold: clamp01((y - r[i].start) / Math.max(1, r[i].end - r[i].start)) };
    }
    const last = r.length - 1;
    return { from: last, to: last, t: 0, hold: 1 };
  }

  /** Arrived at (or left for) a new stop: colours, dock, address, title. */
  private onStop(stop: number) {
    const first = this.current === -1;
    this.current = stop;
    const section = stop > 0 ? sections[stop - 1] : null;
    root.style.setProperty("--accent", section?.accent ?? HOME_ACCENT);
    setDockActive(this.dock, stop);
    if (!this.drawer && this.started) {
      const hash = section ? `#/${section.slug}` : "#/";
      if (location.hash !== hash && !(hash === "#/" && !location.hash)) history.replaceState(null, "", hash);
      document.title = [section?.name, about.siteTitle || about.name].filter(Boolean).join(" – ");
    }
    if (!first && this.started) this.sound.blip(stop ? 1 + stop * 0.05 : 0.8);
  }

  /** Where each stop's scroll range lies. Measured again whenever the layout changes. */
  private measure() {
    const vh = window.innerHeight;
    const desktop = window.innerWidth >= 900;
    const scrollY = window.scrollY;
    const max = document.documentElement.scrollHeight - vh;
    const ranges: StopRange[] = [{ start: 0, end: this.hero.offsetHeight * 0.1, land: 0 }];
    this.journeyEl.querySelectorAll<HTMLElement>(".stop-planet").forEach((el) => {
      const top = el.getBoundingClientRect().top + scrollY;
      const bottom = top + el.offsetHeight;
      const start = top - vh * (desktop ? 0.7 : 0.55);
      const end = Math.max(bottom - vh * (desktop ? 0.4 : 0.3), start + vh * 0.3);
      const land = Math.min(Math.max(top - vh * (desktop ? 0.16 : 0.5), start), end);
      ranges.push({ start, end, land });
    });
    const last = ranges[ranges.length - 1];
    last.end = Math.max(last.end, max);
    this.ranges = ranges;
  }

  private queueMeasure() {
    if (this.measureQueued) return;
    this.measureQueued = true;
    requestAnimationFrame(() => {
      this.measureQueued = false;
      this.universe?.resize();
      this.computeFrames();
      this.measure();
    });
  }

  /** Which part of the screen the scene gets: beside the hero (overview) and beside the cards (planets). */
  private computeFrames() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const desktop = W >= 900;
    const top = desktop ? 80 : 64;
    const dock = desktop ? 100 : 86;
    const cardW = Math.round(Math.min(600, Math.max(400, W * 0.38)));
    const gutter = Math.min(56, Math.max(20, W * 0.04));
    root.style.setProperty("--card-w", `${cardW}px`);
    const rect = (x0: number, y0: number, x1: number, y1: number): Frame => ({
      width: W,
      height: H,
      offsetX: W / 2 - (x0 + x1) / 2,
      offsetY: H / 2 - (y0 + y1) / 2,
      freeWidth: Math.max(1, x1 - x0),
      freeHeight: Math.max(1, y1 - y0),
    });
    this.labels?.setPlanetRight(desktop ? W - cardW - gutter : W);
    if (desktop) {
      this.frames = {
        overview: rect(W >= 1100 ? W * 0.3 : 0, top, W, H - dock),
        planet: rect(0, top, W - cardW - gutter, H - dock * 0.5),
      };
    } else {
      const inner = this.hero.querySelector<HTMLElement>(".hero-inner");
      const heroTop = inner ? inner.getBoundingClientRect().top + window.scrollY : H * 0.55;
      this.frames = {
        overview: rect(0, top, W, Math.max(top + 180, Math.min(heroTop, H) - 8)),
        planet: rect(0, top, W, H * 0.52),
      };
    }
  }

  // ---------- Navigation ----------

  private parse(hash: string): Route {
    const parts = hash
      .replace(/^#\/?/, "")
      .split("/")
      .filter(Boolean)
      .map((p) => decodeURIComponent(p));
    if (!parts.length) return { stop: 0, projectId: null };
    const section = sectionBySlug(parts[0]);
    if (!section) {
      const s = sectionOfProject(parts[0]);
      return s ? { stop: s.number, projectId: parts[0] } : { stop: 0, projectId: null };
    }
    const projectId = parts[1] && section.projects.some((p) => p.id === parts[1]) ? parts[1] : null;
    return { stop: section.number, projectId };
  }

  /** Every in-page link ("#/…") comes through here. */
  private open(hash: string) {
    const route = this.parse(hash);
    this.closeMenu(false);
    if (route.projectId) {
      if (this.drawer) history.replaceState(null, "", hash);
      else history.pushState(null, "", hash);
      this.showProject(route.stop, route.projectId, this.drawer ? this.drawer.pushed : true);
      return;
    }
    if (this.drawer) this.closeDrawer(false);
    this.goToStop(route.stop);
  }

  /** Flies there: the page scrolls to the stop and the camera follows the scroll. */
  private goToStop(stop: number, onArrive?: () => void) {
    const range = this.ranges[Math.max(0, Math.min(stop, this.ranges.length - 1))];
    if (!range) return;
    const distance = Math.abs(stop - this.position);
    const done = () => {
      if (this.keyboardNav) {
        const title = stop > 0 ? document.getElementById(`title-${sections[stop - 1].slug}`) : document.getElementById("hero-title");
        title?.focus({ preventScroll: true });
      }
      onArrive?.();
    };
    if (reducedMotion.matches || Math.abs(this.lenis.scroll - range.land) < 4) {
      this.lenis.scrollTo(range.land, { immediate: true, force: true });
      done();
      return;
    }
    this.lenis.scrollTo(range.land, {
      duration: Math.min(3.4, 1.2 + distance * 0.4),
      easing: easeInOutCubic,
      force: true,
      onComplete: done,
    });
  }

  private go(dir: 1 | -1) {
    const target = Math.max(0, Math.min(sections.length, Math.round(this.position) + dir));
    this.goToStop(target);
  }

  // ---------- Project drawer ----------

  private buildPanel() {
    this.panel.innerHTML = `
      <div class="panel-bar">
        <span class="pb-name"></span>
        <button class="pb-btn pb-close" type="button" aria-label="Projekt schließen">${ICON.close}</button>
      </div>
      <div class="panel-scroll" tabindex="-1" data-lenis-prevent><div class="panel-content"></div></div>`;
    this.panelScroll = this.panel.querySelector(".panel-scroll")!;
    this.panelContent = this.panel.querySelector(".panel-content")!;
    this.panel.setAttribute("inert", "");
  }

  private showProject(stop: number, projectId: string, pushed: boolean) {
    const section = sections[stop - 1];
    const project = projectById(projectId);
    if (!section || !project) return;
    const opening = !this.drawer;
    this.drawer = { projectId, pushed, returnFocus: opening ? (document.activeElement as HTMLElement | null) : this.drawer!.returnFocus };
    this.universe?.highlightMoon(projectId);
    this.labels?.setCurrent(projectId);
    document.title = [project.shortTitle, section.name, about.siteTitle || about.name].join(" – ");

    const render = () => {
      if (this.drawer?.projectId !== projectId) return;
      this.panel.style.setProperty("--accent", section.accent);
      this.panel.querySelector(".pb-name")!.textContent = section.name;
      this.panelContent.classList.remove("is-in");
      this.panelContent.innerHTML = projectView(section, project);
      this.panelScroll.scrollTop = 0;
      reveal(this.panelContent);
      this.panel.classList.add("is-open");
      this.panel.removeAttribute("inert");
      this.scrim.classList.add("is-on");
      root.classList.add("drawer-open");
      this.lenis.stop();
      this.panel.querySelector<HTMLElement>("#panel-title")?.focus({ preventScroll: true });
    };
    // Far from its planet: fly there first, then open.
    if (opening && Math.abs(this.position - stop) > 0.3) this.goToStop(stop, render);
    else render();
  }

  private closeDrawer(updateHistory: boolean) {
    const d = this.drawer;
    if (!d) return;
    this.drawer = null;
    this.panel.classList.remove("is-open");
    this.panel.setAttribute("inert", "");
    this.scrim.classList.remove("is-on");
    root.classList.remove("drawer-open");
    this.lenis.start();
    this.universe?.highlightMoon(null);
    this.labels?.setCurrent(null);
    const section = this.current > 0 ? sections[this.current - 1] : null;
    if (updateHistory) {
      if (d.pushed) history.back();
      else history.replaceState(null, "", section ? `#/${section.slug}` : "#/");
    }
    document.title = [section?.name, about.siteTitle || about.name].filter(Boolean).join(" – ");
    d.returnFocus?.focus?.({ preventScroll: true });
  }

  // ---------- Menu ----------

  private openMenu() {
    this.menu.hidden = false;
    root.classList.add("menu-open");
    this.lenis.stop();
    this.topbar.querySelector(".menu-btn")?.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      this.menu.classList.add("is-open");
      const slug = this.current > 0 ? sections[this.current - 1].slug : "";
      const current = this.menu.querySelector<HTMLElement>(`.menu-link[href="#/${slug}"]`);
      (current ?? this.menu.querySelector<HTMLElement>(".menu-link"))?.focus({ preventScroll: true });
    });
  }

  private closeMenu(returnFocus = true) {
    if (this.menu.hidden) return;
    this.menu.classList.remove("is-open");
    root.classList.remove("menu-open");
    if (!this.drawer) this.lenis.start();
    this.topbar.querySelector(".menu-btn")?.setAttribute("aria-expanded", "false");
    window.setTimeout(() => {
      if (!this.menu.classList.contains("is-open")) this.menu.hidden = true;
    }, reducedMotion.matches ? 0 : 520);
    if (returnFocus) this.topbar.querySelector<HTMLElement>(".menu-btn")?.focus({ preventScroll: true });
  }

  // ---------- Loader, reveals ----------

  private async hideLoader(route: Route) {
    await wait(reducedMotion.matches ? 0 : 250);
    this.loader.classList.add("is-done");
    root.classList.remove("is-loading");
    // (scrolling only works once the page may scroll again: a stopped Lenis clips the page)
    this.lenis.start();
    // Opened with a link to a planet or a project: start right there, otherwise fly in from far away.
    const intro = route.stop === 0;
    if (!intro) {
      await nextFrame();
      this.measure();
      const land = this.ranges[route.stop].land;
      this.lenis.scrollTo(land, { immediate: true, force: true });
      if (Math.abs(window.scrollY - land) > 2) {
        window.scrollTo(0, land);
        this.lenis.scrollTo(land, { immediate: true, force: true });
      }
    }
    if (route.projectId) this.showProject(route.stop, route.projectId, false);
    if (intro) this.universe?.playIntro();
    window.setTimeout(() => reveal(this.hero.querySelector<HTMLElement>(".hero-inner")!), intro && !reducedMotion.matches ? 900 : 0);
    window.setTimeout(() => this.loader.remove(), 1400);
  }

  /** Card contents fade in as they scroll into view. */
  private observeReveals() {
    const io = new IntersectionObserver(
      (entries) => {
        let n = 0;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          el.style.setProperty("--d", String(n++ % 8));
          el.classList.add("in");
          io.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.04 },
    );
    this.journeyEl.querySelectorAll(".stop [data-r]").forEach((el) => io.observe(el));
  }

  // ---------- Events ----------

  private bindEvents() {
    window.addEventListener("popstate", () => this.onPop());
    window.addEventListener("resize", () => this.queueMeasure());
    new ResizeObserver(() => this.queueMeasure()).observe(this.journeyEl);
    document.addEventListener("visibilitychange", () => {
      if (!this.universe) return;
      if (document.hidden) this.universe.stop();
      else this.universe.start();
    });
    reducedMotion.addEventListener?.("change", () => this.universe?.setReducedMotion(reducedMotion.matches));

    // Pointer input on the 3D scene (vertical swipes stay with the page: they scroll the journey).
    const pos = (e: PointerEvent) => [e.clientX, e.clientY] as const;
    this.stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.universe?.pointerDown(...pos(e), e.pointerType !== "mouse");
      this.stage.classList.add("is-down");
    });
    this.stage.addEventListener("pointermove", (e) => this.universe?.pointerMove(...pos(e), e.pointerType !== "mouse"));
    this.stage.addEventListener("pointerup", (e) => {
      this.stage.classList.remove("is-down");
      this.universe?.pointerUp(...pos(e), e.pointerType !== "mouse");
    });
    this.stage.addEventListener("pointercancel", () => {
      this.stage.classList.remove("is-down");
      this.universe?.pointerCancel();
    });
    this.stage.addEventListener("pointerleave", () => this.universe?.pointerLeave());

    document.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const hit = <T extends HTMLElement>(sel: string) => t.closest<T>(sel);
      // In-page links: the journey and the drawer handle them.
      const link = hit<HTMLAnchorElement>('a[href^="#/"], a[href="#"]');
      if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
        e.preventDefault();
        this.open(link.getAttribute("href") ?? "#/");
        return;
      }
      if (hit(".menu-btn")) return this.menu.hidden ? this.openMenu() : this.closeMenu();
      if (hit(".menu-close")) return this.closeMenu();
      if (hit(".sound-btn")) {
        setSoundButton(this.topbar, this.sound.toggle());
        return;
      }
      if (hit(".pb-close") || t === this.scrim) return this.closeDrawer(true);
      const skill = hit<HTMLButtonElement>(".chip-skill");
      if (skill) return toggleSkill(skill);
      const copy = hit<HTMLButtonElement>(".copy-handle");
      if (copy) {
        void copyText(copy.dataset.copy ?? "").then((ok) => toast(ok ? `„${copy.dataset.copy}“ kopiert` : "Kopieren nicht möglich"));
        return;
      }
      if (e.target === this.menu) this.closeMenu();
    });

    // Project cards point at their moon.
    this.journeyEl.addEventListener("pointerover", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>("[data-project]");
      if (!this.drawer) this.universe?.highlightMoon(card?.dataset.project ?? null);
    });

    // Dock hover lights up its planet.
    this.dock.addEventListener("pointerover", (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>(".dock-item");
      if (!item || !this.universe) return;
      const i = Number(item.dataset.index);
      this.universe.setExternalHover(i === 0 ? { type: "sun" } : { type: "planet", index: i - 1 });
    });
    this.dock.addEventListener("pointerleave", () => this.universe?.setExternalHover(null));

    window.addEventListener("pointerdown", () => {
      this.keyboardNav = false;
      if (this.sound.wanted && !this.sound.enabled) {
        this.sound.enable();
        setSoundButton(this.topbar, true);
      }
    });
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  private onPop() {
    const route = this.parse(location.hash);
    if (route.projectId) {
      if (this.drawer?.projectId !== route.projectId) this.showProject(route.stop, route.projectId, false);
      return;
    }
    if (this.drawer) this.closeDrawer(false);
    if (Math.abs(this.position - route.stop) > 0.5) this.goToStop(route.stop);
  }

  private onKey(e: KeyboardEvent) {
    this.keyboardNav = true;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;

    if (!this.menu.hidden) {
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeMenu();
      } else if (e.key === "Tab") {
        this.trapFocus(e, this.menu);
      }
      return;
    }
    if (this.drawer) {
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeDrawer(true);
      } else if (e.key === "Tab") {
        this.trapFocus(e, this.panel);
      }
      return;
    }
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        this.go(1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        this.go(-1);
        break;
      case "Escape":
        this.goToStop(0);
        break;
      case "m":
      case "M":
        this.openMenu();
        break;
      default:
        if (/^[0-9]$/.test(e.key) && Number(e.key) <= sections.length) this.goToStop(Number(e.key));
    }
  }

  private trapFocus(e: KeyboardEvent, container: HTMLElement) {
    const items = [...container.querySelectorAll<HTMLElement>("a, button, summary, [tabindex='0']")].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
