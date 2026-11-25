import * as THREE from "three";
import { PlanetBody, type BodyDef } from "./bodies";
import { CameraRig, type Frame } from "./cameraRig";
import { Sun } from "./sun";
import { bakeNebula, createSky, createStars, type StarLayer } from "./sky";

export type PickTarget = { type: "sun" } | { type: "planet"; index: number } | { type: "moon"; index: number; projectId: string };

export interface ScreenPoint {
  x: number;
  y: number;
  /** on-screen radius in CSS pixels */
  r: number;
  visible: boolean;
}

export interface LabelFrame {
  sun: ScreenPoint;
  planets: ScreenPoint[];
  /** moons of the planet in focus (empty in the overview) */
  moons: (ScreenPoint & { projectId: string })[];
  focused: number | null;
}

export interface UniverseOptions {
  canvas: HTMLCanvasElement;
  bodies: BodyDef[];
  reducedMotion: boolean;
  lowPower: boolean;
  onHover: (t: PickTarget | null) => void;
  onSelect: (t: PickTarget) => void;
  onFrame: (f: LabelFrame) => void;
  onProgress?: (p: number, label: string) => void;
}

const SUN_RADIUS = 5;

const samePick = (a: PickTarget | null, b: PickTarget | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.type === b.type &&
    (a.type !== "planet" || a.index === (b as { index: number }).index) &&
    (a.type !== "moon" || a.projectId === (b as { projectId: string }).projectId));

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

export class Universe {
  readonly rig: CameraRig;
  readonly bodies: PlanetBody[] = [];
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private sun: Sun;
  private sky!: THREE.Mesh;
  private stars!: StarLayer;
  private dust!: StarLayer;
  private timer = new THREE.Timer();
  private time = 0;
  private timeScale = 1;
  private opts: UniverseOptions;
  private octaves: number;
  private dpr: number;
  private maxDpr: number;
  private minDpr: number;
  private frameTimes: number[] = [];
  private lastQualityCheck = 0;
  private lastDowngrade = -Infinity;
  private running = false;
  private pointer = { x: 0, y: 0, inside: false, moved: false };
  private down: { x: number; y: number; t: number; lastX: number; lastY: number; touch: boolean; dragging: boolean } | null = null;
  private hover: PickTarget | null = null;
  private externalHover: PickTarget | null = null;
  private highlightedMoon: string | null = null;
  private frame: Frame = { width: 1, height: 1, offsetX: 0, offsetY: 0, freeWidth: 1, freeHeight: 1 };
  private projected = new THREE.Vector3();
  private labelFrame: LabelFrame;
  onSwipe: ((dir: 1 | -1) => void) | null = null;

  constructor(opts: UniverseOptions) {
    this.opts = opts;
    this.octaves = opts.lowPower ? 4 : 5;
    this.maxDpr = Math.min(window.devicePixelRatio || 1, opts.lowPower ? 1.5 : 2);
    this.minDpr = Math.min(this.maxDpr, opts.lowPower ? 0.75 : 1);
    this.dpr = this.maxDpr;

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: this.dpr < 2,
      powerPreference: "high-performance",
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x020309, 1);

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.rig.reducedMotion = opts.reducedMotion;
    this.sun = new Sun(SUN_RADIUS, this.octaves);
    this.labelFrame = { sun: { x: 0, y: 0, r: 0, visible: false }, planets: [], moons: [], focused: null };
  }

  /** Builds the scene step by step (the loader shows the progress). */
  async init() {
    const progress = this.opts.onProgress ?? (() => undefined);
    const tick = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

    progress(0.1, "Sterne");
    this.stars = createStars(this.opts.lowPower ? 3800 : 7000, { seed: 7 });
    this.dust = createStars(this.opts.lowPower ? 500 : 1100, { near: true, seed: 3 });
    this.scene.add(this.stars.points, this.dust.points);
    await tick();

    progress(0.25, "Nebel");
    const nebula = bakeNebula(this.renderer, this.opts.lowPower ? 1024 : 2048, this.octaves);
    this.sky = createSky(nebula.texture);
    this.scene.add(this.sky);
    await tick();

    progress(0.45, "Planeten");
    this.scene.add(this.sun.group);
    this.scene.add(new THREE.AmbientLight(0x5a6aa0, 0.5));
    const light = new THREE.PointLight(0xfff0dd, 3.2, 0, 0);
    this.scene.add(light);
    const moonGeometry = new THREE.SphereGeometry(1, 40, 28);
    this.opts.bodies.forEach((def, i) => {
      const body = new PlanetBody(def, i, { octaves: this.octaves, lowDetail: this.opts.lowPower, moonGeometry });
      this.bodies.push(body);
      this.scene.add(body.pivot);
    });
    this.labelFrame.planets = this.bodies.map(() => ({ x: 0, y: 0, r: 0, visible: false }));
    this.resize();
    this.update(0.016);
    await tick();

    progress(0.65, "Shader");
    const r = this.renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown> };
    // Compiles in the background where the browser can; never waits longer than a few seconds for it
    // (anything left over is compiled with the first frame).
    if (r.compileAsync) await Promise.race([r.compileAsync(this.scene, this.rig.camera), new Promise((res) => setTimeout(res, 6000))]);
    else this.renderer.compile(this.scene, this.rig.camera);
    this.renderer.render(this.scene, this.rig.camera);
    await tick();
    progress(1, "Bereit");
  }

  /** Small pictures of every planet (for the dock and the menu), drawn with the real shaders. */
  thumbnails(size = 160): string[] {
    const urls: string[] = [];
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    const light = new THREE.Vector3(6, 2.4, 7);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return urls;
    const pr = this.renderer.getPixelRatio();
    const px = Math.round(size / pr);
    const oldViewport = new THREE.Vector4();
    this.renderer.getViewport(oldViewport);
    scene.add(new THREE.AmbientLight(0x5a6aa0, 0.5));
    const pl = new THREE.PointLight(0xfff0dd, 3.2, 0, 0);
    pl.position.copy(light);
    scene.add(pl);

    for (const body of this.bodies) {
      const group = new THREE.Group();
      const tilt = new THREE.Group();
      tilt.rotation.z = body.def.tilt;
      const mesh = new THREE.Mesh(body.mesh.geometry, body.mesh.material);
      mesh.rotation.y = 0.8;
      tilt.add(mesh);
      const atmo = new THREE.Mesh(body.atmosphere.geometry, body.atmosphere.material);
      group.add(tilt, atmo);
      let fit = body.def.radius * 1.22;
      const u = body.mesh.material.uniforms;
      u.uSunPos.value.copy(light);
      u.uHover.value = 0;
      body.atmosphere.material.uniforms.uSunPos.value.copy(light);
      if (body.ring) {
        const ring = new THREE.Mesh(body.ring.geometry, body.ring.material);
        ring.rotation.copy(body.ring.rotation);
        tilt.add(ring);
        group.updateMatrixWorld(true);
        const n = new THREE.Vector3(0, 0, 1).transformDirection(ring.matrixWorld);
        const ru = body.ring.material.uniforms;
        ru.uSunPos.value.copy(light);
        ru.uCenter.value.set(0, 0, 0);
        ru.uNormal.value.copy(n);
        u.uCenter.value.set(0, 0, 0);
        u.uRingNormal.value.copy(n);
        fit = body.def.radius * body.def.ring!.outer * 1.04;
      }
      if (body.crystals) {
        const c = new THREE.InstancedMesh(body.crystals.geometry, body.crystals.material, body.crystals.count);
        c.instanceMatrix.copy(body.crystals.instanceMatrix);
        c.rotation.copy(body.crystals.rotation);
        tilt.add(c);
        fit = body.def.radius * 2.3;
      }
      scene.add(group);
      cam.position.set(0, fit * 0.18, fit / Math.sin(THREE.MathUtils.degToRad(15)));
      cam.lookAt(0, 0, 0);

      this.renderer.setViewport(0, 0, px, px);
      this.renderer.setScissor(0, 0, px, px);
      this.renderer.setScissorTest(true);
      this.renderer.setClearColor(0x05060d, 1);
      this.renderer.clear();
      this.renderer.render(scene, cam);
      const h = this.renderer.domElement.height;
      const dev = Math.round(px * pr);
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(this.renderer.domElement, 0, h - dev, dev, dev, 0, 0, size, size);
      urls.push(canvas.toDataURL("image/png"));
      scene.remove(group);
    }
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(oldViewport);
    this.renderer.setClearColor(0x020309, 1);
    return urls;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer.reset();
    this.renderer.setAnimationLoop(this.loop);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  playIntro() {
    this.rig.playIntro();
  }

  setFrame(frame: Frame) {
    this.frame = frame;
    this.rig.setFrame(frame);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.stars.material.uniforms.uPixelRatio.value = this.dpr;
    this.dust.material.uniforms.uPixelRatio.value = this.dpr;
  }

  /** null = overview */
  focus(index: number | null) {
    const body = index === null ? null : this.bodies[index];
    this.bodies.forEach((b, i) => (b.activeTarget = i === index ? 1 : 0));
    this.rig.flyTo(body ?? null);
    this.labelFrame.focused = index;
  }

  setExternalHover(t: PickTarget | null) {
    this.externalHover = t;
  }

  highlightMoon(projectId: string | null) {
    this.highlightedMoon = projectId;
  }

  setReducedMotion(on: boolean) {
    this.opts.reducedMotion = on;
    this.rig.reducedMotion = on;
    this.stars.material.uniforms.uTwinkle.value = on ? 0 : 1;
  }

  // ---------- pointer input (on the canvas) ----------

  pointerMove(x: number, y: number, isTouch: boolean) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.inside = true;
    this.pointer.moved = true;
    if (!isTouch) this.rig.setPointer((x / window.innerWidth) * 2 - 1, -((y / window.innerHeight) * 2 - 1));
    if (this.down) {
      const dx = x - this.down.lastX;
      const dy = y - this.down.lastY;
      if (!this.down.dragging && Math.hypot(x - this.down.x, y - this.down.y) > 6) this.down.dragging = true;
      if (this.down.dragging && !(this.down.touch && this.rig.focused)) this.rig.drag(dx, dy);
      this.down.lastX = x;
      this.down.lastY = y;
    }
  }

  pointerDown(x: number, y: number, isTouch: boolean) {
    this.down = { x, y, t: performance.now(), lastX: x, lastY: y, touch: isTouch, dragging: false };
    this.pointerMove(x, y, isTouch);
  }

  pointerUp(x: number, y: number) {
    const d = this.down;
    this.down = null;
    if (!d) return;
    const dt = performance.now() - d.t;
    const dx = x - d.x;
    const dy = y - d.y;
    if (!d.dragging && dt < 600) {
      const hit = this.pick(x, y, d.touch ? 26 : 16);
      if (hit) this.opts.onSelect(hit);
      return;
    }
    // A quick sideways swipe on a touch screen switches planets while one is in focus.
    if (d.touch && this.rig.focused && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 700) {
      this.onSwipe?.(dx < 0 ? 1 : -1);
    }
  }

  pointerLeave() {
    this.pointer.inside = false;
    this.pointer.moved = true;
    this.rig.setPointer(0, 0);
  }

  wheel(delta: number) {
    this.rig.wheel(delta);
  }

  // ---------- picking in screen space (generous targets for small planets and fingers) ----------

  private screenOf(world: THREE.Vector3, radius: number, out: ScreenPoint) {
    const cam = this.rig.camera;
    this.projected.copy(world).project(cam);
    const w = this.frame.width;
    const h = this.frame.height;
    out.x = (this.projected.x * 0.5 + 0.5) * w;
    out.y = (-this.projected.y * 0.5 + 0.5) * h;
    const dist = cam.position.distanceTo(world);
    const focal = h / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    out.r = (radius / Math.max(dist, 0.001)) * focal;
    out.visible = this.projected.z < 1 && this.projected.z > -1 && out.x > -200 && out.x < w + 200 && out.y > -200 && out.y < h + 200;
    return out;
  }

  private pick(x: number, y: number, minRadius: number): PickTarget | null {
    let best: PickTarget | null = null;
    let bestDist = Infinity;
    const camPos = this.rig.camera.position;
    const consider = (p: ScreenPoint, depth: number, target: PickTarget, min: number) => {
      if (!p.visible) return;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= Math.max(p.r * 1.08, min) && depth < bestDist) {
        bestDist = depth;
        best = target;
      }
    };
    const focused = this.labelFrame.focused;
    if (focused !== null) {
      for (const m of this.labelFrame.moons) {
        const moon = this.bodies[focused].moons.find((mm) => mm.projectId === m.projectId);
        if (moon) consider(m, camPos.distanceTo(moon.worldPos) - 1, { type: "moon", index: focused, projectId: m.projectId }, minRadius * 0.9);
      }
    }
    this.labelFrame.planets.forEach((p, i) => {
      consider(p, camPos.distanceTo(this.bodies[i].worldPos), { type: "planet", index: i }, minRadius);
    });
    consider(this.labelFrame.sun, camPos.length(), { type: "sun" }, minRadius);
    return best;
  }

  // ---------- frame loop ----------

  private loop = (timestamp?: number) => {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 1 / 20);
    this.update(dt);
    this.renderer.render(this.scene, this.rig.camera);
    this.adaptQuality(dt);
  };

  private update(dt: number) {
    this.time += dt;
    const focused = this.rig.focused;
    const targetScale = focused ? 0.12 : this.opts.reducedMotion ? 0.3 : 1;
    this.timeScale += (targetScale - this.timeScale) * (1 - Math.exp(-dt * 2));
    const sunPos = this.sun.group.position;

    for (const b of this.bodies) {
      b.setOrbitOpacity(focused ? 0.14 : 0.32);
      b.update(dt, dt * this.timeScale, this.time, sunPos);
    }
    this.rig.update(dt);
    const cam = this.rig.camera;
    this.sun.update(this.time, dt, cam);
    this.sky.position.copy(cam.position);
    this.stars.points.position.copy(cam.position);
    this.stars.material.uniforms.uTime.value = this.time;

    this.updateScreen();
    this.updateHover();
    this.opts.onFrame(this.labelFrame);
  }

  private updateScreen() {
    const lf = this.labelFrame;
    this.screenOf(this.sun.group.position, SUN_RADIUS, lf.sun);
    this.bodies.forEach((b, i) => this.screenOf(b.worldPos, b.def.radius, lf.planets[i]));
    const focused = lf.focused;
    if (focused !== null) {
      const moons = this.bodies[focused].moons;
      if (lf.moons.length !== moons.length || lf.moons[0]?.projectId !== moons[0]?.projectId) {
        lf.moons = moons.map((m) => ({ x: 0, y: 0, r: 0, visible: false, projectId: m.projectId }));
      }
      moons.forEach((m, i) => this.screenOf(m.worldPos, m.radius, lf.moons[i]));
    } else if (lf.moons.length) {
      lf.moons = [];
    }
  }

  private updateHover() {
    if (this.pointer.moved && !this.down?.dragging) {
      this.pointer.moved = false;
      const hit = this.pointer.inside ? this.pick(this.pointer.x, this.pointer.y, 14) : null;
      if (!samePick(hit, this.hover)) {
        this.hover = hit;
        this.opts.onHover(hit);
      }
    }
    const h = this.externalHover ?? this.hover;
    this.sun.setHover(h?.type === "sun");
    this.bodies.forEach((b, i) => {
      b.hoverTarget = h?.type === "planet" && h.index === i ? 1 : 0;
      for (const m of b.moons) {
        m.hoverTarget = (h?.type === "moon" && h.projectId === m.projectId) || this.highlightedMoon === m.projectId ? 1 : 0;
      }
    });
  }

  private adaptQuality(dt: number) {
    this.frameTimes.push(dt);
    if (this.time - this.lastQualityCheck < 2) return;
    this.lastQualityCheck = this.time;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (this.time < 4) return; // the intro and shader warm-up don't count
    let next = this.dpr;
    if (avg > 1 / 45 && this.dpr > this.minDpr) {
      next = Math.max(this.minDpr, this.dpr - 0.25);
      this.lastDowngrade = this.time;
    } else if (avg < 1 / 75 && this.dpr < this.maxDpr && this.time - this.lastDowngrade > 20) {
      next = Math.min(this.maxDpr, this.dpr + 0.25);
    }
    if (next !== this.dpr) {
      this.dpr = next;
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }
}
