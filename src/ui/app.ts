import { about, projectById } from "../content";
import { HOME_ACCENT, sectionBySlug, sectionOfProject, sections, type Section } from "../config/sections";
import { Universe, webglAvailable, type PickTarget } from "../three/universe";
import type { Frame } from "../three/cameraRig";
import {
  Labels,
  renderDock,
  renderHero,
  renderLoader,
  renderMenu,
  renderTopbar,
  setDockActive,
  setLoaderProgress,
  setSoundButton,
  setThumbnails,
} from "./components";
import { Sound } from "./sound";
import { sectionView, toggleSkill } from "./views";
import { ICON, coarsePointer, copyText, esc, pad2, reducedMotion, reveal, toast, wait } from "./util";

interface Route {
  section: Section | null;
  projectId: string | null;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const root = document.documentElement;

export class App {
  private stage = $("#stage");
  private canvas = $<HTMLCanvasElement>("#webgl");
  private labelsEl = $("#labels");
  private topbar = $("#topbar");
  private hero = $("#hero");
  private panel = $("#panel");
  private dock = $("#dock");
  private menu = $("#menu");
  private loader = $("#loader");
  private panelScroll!: HTMLElement;
  private panelContent!: HTMLElement;

  private universe: Universe | null = null;
  private labels: Labels | null = null;
  private sound = new Sound();
  private route: Route = { section: null, projectId: null };
  private keyboardNav = false;
  private contentToken = 0;
  private hoverPlanet: number | null = null;
  private hoverMoon: string | null = null;
  private layoutQueued = false;
  private started = false;

  async start() {
    renderTopbar(this.topbar);
    renderHero(this.hero);
    renderDock(this.dock);
    renderMenu(this.menu);
    renderLoader(this.loader);
    this.buildPanel();
    this.bindEvents();
    this.applyRoute(true);

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
    }

    await Promise.race([document.fonts?.ready, wait(1500)]);
    this.started = true;
    this.applyRoute(true);
    await this.hideLoader();
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
      onProgress: (p, label) => setLoaderProgress(this.loader, p * 0.9, label),
    });
    this.universe = universe;
    universe.onSwipe = (dir) => this.go(dir);
    this.layout();
    await universe.init();
    setThumbnails(universe.thumbnails(160));
    this.labels = new Labels(this.labelsEl, {
      select: (i) => this.navigate(`#/${sections[i].slug}`),
      hover: (i) => {
        this.hoverPlanet = i;
        universe.setExternalHover(i === null ? null : { type: "planet", index: i });
        this.labels?.setHover(i, this.hoverMoon);
        if (i !== null) this.sound.blip(1 + i * 0.04);
      },
      hoverMoon: (id) => {
        this.hoverMoon = id;
        const i = this.route.section ? this.route.section.number - 1 : 0;
        universe.setExternalHover(id ? { type: "moon", index: i, projectId: id } : null);
        this.labels?.setHover(this.hoverPlanet, id);
      },
    });
    setLoaderProgress(this.loader, 1, "Bereit");
    universe.start();
  }

  private onSceneHover(t: PickTarget | null) {
    this.stage.classList.toggle("is-pointing", !!t);
    this.labels?.setHover(t?.type === "planet" ? t.index : null, t?.type === "moon" ? t.projectId : null);
    if (t) this.sound.blip(t.type === "planet" ? 1 + t.index * 0.04 : t.type === "moon" ? 1.5 : 0.8);
  }

  private onSceneSelect(t: PickTarget) {
    if (t.type === "sun") this.navigate("#/");
    else if (t.type === "planet") this.navigate(`#/${sections[t.index].slug}`);
    else this.navigate(`#/${sections[t.index].slug}/${t.projectId}`);
  }

  // ---------- Routing: #/ , #/<planet> , #/<planet>/<project> ----------

  private parseHash(): Route {
    const parts = location.hash
      .replace(/^#\/?/, "")
      .split("/")
      .filter(Boolean)
      .map((p) => decodeURIComponent(p));
    if (!parts.length) return { section: null, projectId: null };
    const section = sectionBySlug(parts[0]);
    if (!section) {
      // a bare project id still finds its planet
      const s = sectionOfProject(parts[0]);
      return s ? { section: s, projectId: parts[0] } : { section: null, projectId: null };
    }
    const projectId = parts[1] && section.projects.some((p) => p.id === parts[1]) ? parts[1] : null;
    return { section, projectId };
  }

  private navigate(hash: string) {
    if (location.hash === hash || (hash === "#/" && !location.hash)) this.applyRoute();
    else location.hash = hash;
  }

  /** Next / previous planet; 0 is the start (the sun). */
  private go(dir: 1 | -1) {
    const count = sections.length + 1;
    const index = this.route.section?.number ?? 0;
    const next = (index + dir + count) % count;
    this.navigate(next === 0 ? "#/" : `#/${sections[next - 1].slug}`);
  }

  private applyRoute(initial = false) {
    const prev = this.route;
    const next = this.parseHash();
    this.route = next;
    const sectionChanged = prev.section !== next.section;
    const projectChanged = prev.projectId !== next.projectId;

    root.style.setProperty("--accent", next.section?.accent ?? HOME_ACCENT);
    const project = next.projectId ? projectById(next.projectId) : undefined;
    document.title = [project?.shortTitle, next.section?.name, about.siteTitle || about.name].filter(Boolean).join(" – ");

    setDockActive(this.dock, next.section?.number ?? 0);
    const index = next.section ? next.section.number - 1 : null;
    if (this.started || !initial) {
      if (this.universe) {
        if (sectionChanged || initial) this.universe.focus(index);
        this.universe.highlightMoon(next.projectId);
      }
      this.labels?.setFocused(index);
      this.labels?.setCurrent(next.projectId);
    }

    this.setHeroVisible(!next.section, initial);
    if (next.section) this.showPanel(next.section, next.projectId, sectionChanged || projectChanged || initial);
    else this.hidePanel();
    this.layout();
    if (sectionChanged && this.started && !initial) this.sound.whoosh(1.9);
  }

  // ---------- Layout: which part of the screen the planet gets ----------

  private queueLayout() {
    if (this.layoutQueued) return;
    this.layoutQueued = true;
    requestAnimationFrame(() => {
      this.layoutQueued = false;
      this.universe?.resize();
      this.layout();
    });
  }

  private layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const desktop = W >= 900;
    const open = !!this.route.section;
    const top = desktop ? 80 : 64;
    const dock = desktop ? 100 : 86;
    let x0 = 0;
    let y0 = top;
    let x1 = W;
    let y1 = H - dock;
    if (desktop) {
      const panelW = Math.round(Math.min(600, Math.max(380, W * 0.4)));
      root.style.setProperty("--panel-w", `${panelW}px`);
      if (open) {
        x1 = W - panelW;
        y1 = H - 24;
      } else if (W >= 1100) {
        x0 = W * 0.3;
      }
    } else {
      const sheet = Math.round(H * 0.56);
      root.style.setProperty("--sheet-h", `${sheet}px`);
      if (open) {
        y1 = H - sheet;
      } else {
        const heroTop = this.hero.querySelector(".hero-inner")?.getBoundingClientRect().top ?? H * 0.55;
        y1 = Math.max(top + 180, heroTop - 8);
      }
    }
    root.classList.toggle("panel-open", open);
    const frame: Frame = {
      width: W,
      height: H,
      offsetX: W / 2 - (x0 + x1) / 2,
      offsetY: H / 2 - (y0 + y1) / 2,
      freeWidth: Math.max(1, x1 - x0),
      freeHeight: Math.max(1, y1 - y0),
    };
    this.universe?.setFrame(frame);
  }

  // ---------- Hero ----------

  private setHeroVisible(visible: boolean, initial: boolean) {
    this.hero.classList.toggle("is-hidden", !visible);
    this.hero.toggleAttribute("inert", !visible);
    // (the first reveal is timed with the intro flight: hideLoader)
    if (visible && this.started && !initial) {
      const inner = this.hero.querySelector<HTMLElement>(".hero-inner")!;
      if (!inner.classList.contains("is-in")) reveal(inner);
    }
  }

  // ---------- Panel ----------

  private buildPanel() {
    this.panel.innerHTML = `
      <button class="sheet-handle" type="button" aria-label="Bereich vergrößern"><span></span></button>
      <div class="panel-bar">
        <button class="pb-btn pb-prev" type="button" aria-label="Vorheriger Planet">${ICON.arrowLeft}</button>
        <span class="pb-pos" aria-hidden="true"><b class="pb-num">01</b><span class="pb-total">/ ${pad2(sections.length)}</span></span>
        <button class="pb-btn pb-next" type="button" aria-label="Nächster Planet">${ICON.arrowRight}</button>
        <span class="pb-name"></span>
        <button class="pb-btn pb-close" type="button" aria-label="Zur Übersicht">${ICON.close}</button>
      </div>
      <div class="panel-scroll" tabindex="-1"><div class="panel-content"></div></div>`;
    this.panelScroll = this.panel.querySelector(".panel-scroll")!;
    this.panelContent = this.panel.querySelector(".panel-content")!;
    this.panel.setAttribute("inert", "");
  }

  private async showPanel(section: Section, projectId: string | null, changed: boolean) {
    const wasOpen = this.panel.classList.contains("is-open");
    this.panel.classList.add("is-open");
    this.panel.removeAttribute("inert");
    this.panel.style.setProperty("--accent", section.accent);
    this.panel.querySelector(".pb-num")!.textContent = pad2(section.number);
    this.panel.querySelector(".pb-name")!.innerHTML = esc(section.name);
    if (!changed && wasOpen) return;

    const token = ++this.contentToken;
    const content = this.panelContent;
    if (wasOpen && content.childElementCount) {
      content.classList.add("is-leaving");
      await wait(reducedMotion.matches ? 0 : 200);
      if (token !== this.contentToken) return;
    }
    content.classList.remove("is-leaving", "is-in");
    content.innerHTML = sectionView(section, projectId);
    this.panelScroll.scrollTop = 0;
    reveal(content);
    if (this.keyboardNav) content.querySelector<HTMLElement>("#panel-title")?.focus({ preventScroll: true });
  }

  private hidePanel() {
    this.contentToken++;
    this.panel.classList.remove("is-open", "is-full");
    this.panel.setAttribute("inert", "");
  }

  // ---------- Menu ----------

  private openMenu() {
    this.menu.hidden = false;
    root.classList.add("menu-open");
    this.topbar.querySelector(".menu-btn")?.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      this.menu.classList.add("is-open");
      const current = this.menu.querySelector<HTMLElement>(`.menu-link[href="#/${this.route.section?.slug ?? ""}"]`);
      (current ?? this.menu.querySelector<HTMLElement>(".menu-link"))?.focus({ preventScroll: true });
    });
  }

  private closeMenu(returnFocus = true) {
    if (this.menu.hidden) return;
    this.menu.classList.remove("is-open");
    root.classList.remove("menu-open");
    this.topbar.querySelector(".menu-btn")?.setAttribute("aria-expanded", "false");
    window.setTimeout(() => {
      if (!this.menu.classList.contains("is-open")) this.menu.hidden = true;
    }, reducedMotion.matches ? 0 : 520);
    if (returnFocus) this.topbar.querySelector<HTMLElement>(".menu-btn")?.focus({ preventScroll: true });
  }

  // ---------- Loader ----------

  private async hideLoader() {
    await wait(reducedMotion.matches ? 0 : 250);
    this.loader.classList.add("is-done");
    root.classList.remove("is-loading");
    if (!this.route.section) {
      this.universe?.playIntro();
      window.setTimeout(() => reveal(this.hero.querySelector<HTMLElement>(".hero-inner")!), reducedMotion.matches ? 0 : 900);
    }
    window.setTimeout(() => this.loader.remove(), 1400);
  }

  // ---------- Events ----------

  private bindEvents() {
    window.addEventListener("hashchange", () => {
      this.closeMenu(false);
      this.applyRoute();
    });
    window.addEventListener("resize", () => this.queueLayout());
    document.addEventListener("visibilitychange", () => {
      if (!this.universe) return;
      if (document.hidden) this.universe.stop();
      else this.universe.start();
    });
    reducedMotion.addEventListener?.("change", () => this.universe?.setReducedMotion(reducedMotion.matches));

    // Pointer input on the 3D scene.
    const pos = (e: PointerEvent) => [e.clientX, e.clientY] as const;
    this.stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.stage.setPointerCapture(e.pointerId);
      this.universe?.pointerDown(...pos(e), e.pointerType !== "mouse");
      this.stage.classList.add("is-down");
    });
    this.stage.addEventListener("pointermove", (e) => this.universe?.pointerMove(...pos(e), e.pointerType !== "mouse"));
    const up = (e: PointerEvent) => {
      this.stage.classList.remove("is-down");
      this.universe?.pointerUp(...pos(e));
    };
    this.stage.addEventListener("pointerup", up);
    this.stage.addEventListener("pointercancel", up);
    this.stage.addEventListener("pointerleave", () => this.universe?.pointerLeave());
    this.stage.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.universe?.wheel(e.deltaY);
      },
      { passive: false },
    );

    // Clicks anywhere (delegated).
    document.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const hit = <T extends HTMLElement>(sel: string) => t.closest<T>(sel);
      if (hit(".menu-btn")) return this.menu.hidden ? this.openMenu() : this.closeMenu();
      if (hit(".menu-close")) return this.closeMenu();
      if (hit(".sound-btn")) {
        setSoundButton(this.topbar, this.sound.toggle());
        return;
      }
      if (hit(".pb-prev")) return this.go(-1);
      if (hit(".pb-next")) return this.go(1);
      if (hit(".pb-close")) return this.navigate("#/");
      if (hit(".sheet-handle")) {
        const full = this.panel.classList.toggle("is-full");
        hit(".sheet-handle")!.setAttribute("aria-label", full ? "Bereich verkleinern" : "Bereich vergrößern");
        return;
      }
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
    this.panel.addEventListener("pointerover", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>("[data-project]");
      this.universe?.highlightMoon(card?.dataset.project ?? this.route.projectId);
    });
    this.panel.addEventListener("pointerleave", () => this.universe?.highlightMoon(this.route.projectId));

    // Dock hover lights up its planet.
    this.dock.addEventListener("pointerover", (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>(".dock-item");
      if (!item || !this.universe) return;
      const i = Number(item.dataset.index);
      this.universe.setExternalHover(i === 0 ? { type: "sun" } : { type: "planet", index: i - 1 });
    });
    this.dock.addEventListener("pointerleave", () => this.universe?.setExternalHover(null));

    // Keyboard.
    window.addEventListener("pointerdown", () => {
      this.keyboardNav = false;
      if (this.sound.wanted && !this.sound.enabled) {
        this.sound.enable();
        setSoundButton(this.topbar, true);
      }
    });
    window.addEventListener("keydown", (e) => this.onKey(e));
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
        this.trapFocus(e);
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
        if (this.route.projectId && this.route.section) this.navigate(`#/${this.route.section.slug}`);
        else if (this.route.section) this.navigate("#/");
        break;
      case "m":
      case "M":
        this.openMenu();
        break;
      default:
        if (/^[0-9]$/.test(e.key)) {
          const n = Number(e.key);
          if (n === 0) this.navigate("#/");
          else if (sections[n - 1]) this.navigate(`#/${sections[n - 1].slug}`);
        }
    }
  }

  private trapFocus(e: KeyboardEvent) {
    const items = [...this.menu.querySelectorAll<HTMLElement>("a, button")];
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
