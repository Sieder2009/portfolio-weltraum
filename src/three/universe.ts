import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { PlanetBody, type BodyDef } from "./bodies";
import { CameraRig, type Frame, type Journey } from "./cameraRig";
import { Fleet } from "./fleet";
import { resolution } from "./fx";
import { Hyperspace, HyperspaceShader } from "./hyperspace";
import { NameIntro, type NameIntroOptions } from "./nameIntro";
import { Sun } from "./sun";
import { bakeDensity, bakeNebula, createSky, createStars, ShootingStars, type SkyFrame, type StarLayer } from "./sky";

export type PickTarget =
  | { type: "sun" }
  | { type: "planet"; index: number }
  | { type: "moon"; index: number; projectId: string }
  /** a ship of the background battle (opens the mini game) */
  | { type: "ship" };

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
  /** moons of the planet in focus (empty elsewhere) */
  moons: (ScreenPoint & { projectId: string })[];
  focused: number | null;
  /** 0 in the overview, 1 at a planet */
  closeness: number;
}

export interface UniverseOptions {
  canvas: HTMLCanvasElement;
  bodies: BodyDef[];
  reducedMotion: boolean;
  lowPower: boolean;
  onHover: (t: PickTarget | null) => void;
  onSelect: (t: PickTarget) => void;
  onFrame: (f: LabelFrame) => void;
  /** runs first in every frame (the smooth scroll ticks here, so the camera reads this frame's position) */
  beforeFrame?: (time: number) => void;
  onProgress?: (p: number, label: string) => void;
  /** the jump into hyperspace and the drop out of it */
  onWarp?: (phase: "enter" | "exit") => void;
}

const SUN_RADIUS = 5;

const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

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
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private scene = new THREE.Scene();
  private sun: Sun;
  private sky!: THREE.Mesh;
  private stars!: StarLayer;
  private bandStars!: StarLayer;
  private dust!: StarLayer;
  private skyTime = 0;
  private meteors = new ShootingStars();
  private hyperspace!: Hyperspace;
  private hyperPass: ShaderPass | null = null;
  private fleet!: Fleet;
  private nameIntro: NameIntro | null = null;
  private hoverCheck = 0;
  private warp = 0;
  private warpTravel = 0;
  private warpHigh = false;
  private flash = 0;
  private lastPosition = 0;
  private travelSpeed = 0;
  /** until when (performance.now) a flight stays in normal space, however fast it goes */
  private calmUntil = 0;
  private drawingSize = new THREE.Vector2();
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
  private pointer = { x: 0, y: 0, inside: false, moved: false, touch: false };
  private down: { x: number; y: number; t: number; lastX: number; dragging: boolean } | null = null;
  private hover: PickTarget | null = null;
  private externalHover: PickTarget | null = null;
  private highlightedMoon: string | null = null;
  private frame: Frame = { width: 1, height: 1, offsetX: 0, offsetY: 0, freeWidth: 1, freeHeight: 1 };
  private projected = new THREE.Vector3();
  private labelFrame: LabelFrame;

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
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x020309, 1);

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.rig.reducedMotion = opts.reducedMotion;
    this.sun = new Sun(SUN_RADIUS, this.octaves);
    this.labelFrame = { sun: { x: 0, y: 0, r: 0, visible: false }, planets: [], moons: [], focused: null, closeness: 0 };
  }

  /** Builds the scene step by step (the loader shows the progress). */
  async init() {
    const progress = this.opts.onProgress ?? (() => undefined);
    const tick = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

    progress(0.1, "Sterne werden gezündet");
    const frame = this.skyFrame();
    const low = this.opts.lowPower;
    this.stars = createStars(low ? 6000 : 15000, { seed: 7, bright: low ? 26 : 48, band: frame.bandNormal, blackHole: frame.blackHole });
    // the star clouds of the Milky Way: placed by a small map of the same sky, so the dust lanes stay dark
    const density = bakeDensity(this.renderer, this.octaves, frame);
    this.bandStars = createStars(low ? 12000 : 34000, { seed: 11, density, blackHole: frame.blackHole });
    this.dust = createStars(low ? 500 : 1100, { near: true, seed: 3 });
    this.scene.add(this.stars.points, this.bandStars.points, this.dust.points, this.meteors.group);
    await tick();

    progress(0.25, "Milchstraße wird gemalt");
    const nebula = bakeNebula(this.renderer, low ? 1024 : 2048, this.octaves, frame);
    this.sky = createSky(nebula.texture, frame);
    this.scene.add(this.sky);
    await tick();

    progress(0.45, "Planeten werden geformt");
    this.scene.add(this.sun.group);
    this.scene.add(new THREE.AmbientLight(0x5a6aa0, 0.5));
    this.scene.add(new THREE.PointLight(0xfff0dd, 3.2, 0, 0));
    const moonGeometry = new THREE.SphereGeometry(1, 40, 28);
    this.opts.bodies.forEach((def, i) => {
      const body = new PlanetBody(def, i, { octaves: this.octaves, lowDetail: this.opts.lowPower, moonGeometry });
      this.bodies.push(body);
      this.scene.add(body.pivot);
    });
    this.rig.setBodies(this.bodies);
    this.labelFrame.planets = this.bodies.map(() => ({ x: 0, y: 0, r: 0, visible: false }));

    // The battle in the background, and the star streaks of hyperspace.
    this.fleet = new Fleet({ lowPower: this.opts.lowPower });
    this.fleet.setEnabled(!this.opts.reducedMotion);
    this.hyperspace = new Hyperspace(this.opts.lowPower ? 700 : 1500);
    this.scene.add(this.fleet.group, this.hyperspace.mesh);

    // Glow for everything brighter than white: the sun, lava, glowing seams and traces, auroras, bright stars.
    // (Left out on phones and small machines, where it costs more than it gives.)
    if (!this.opts.lowPower) {
      const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
      const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
      this.bloom = new UnrealBloomPass(size, 0.55, 0.5, 0.95);
      this.composer.addPass(this.bloom);
      this.hyperPass = new ShaderPass(HyperspaceShader);
      this.composer.addPass(this.hyperPass);
      this.composer.addPass(new OutputPass());
    }
    this.resize();
    this.update(0.016);
    // (everything that is usually hidden is drawn once while loading, so its shaders are ready)
    this.hyperspace.mesh.visible = true;
    const warmUp = new NameIntro({
      points: new Float32Array(0),
      rect: { left: 0, top: 0, width: 1, height: 1 },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dot: 2,
      onReveal: () => undefined,
    });
    this.scene.add(warmUp.group);
    await tick();

    progress(0.65, "Shader werden kompiliert");
    const r = this.renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown> };
    // Compiles in the background where the browser can; never waits longer than a few seconds for it
    // (anything left over is compiled with the first frame).
    if (r.compileAsync) await Promise.race([r.compileAsync(this.scene, this.rig.camera), new Promise((res) => setTimeout(res, 6000))]);
    else this.renderer.compile(this.scene, this.rig.camera);
    if (this.hyperPass) this.hyperPass.enabled = true;
    this.draw();
    warmUp.dispose();
    this.update(0.016);
    await tick();
    progress(1, "Letzte Systemprüfung");
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
      tilt.add(mesh);
      const atmo = new THREE.Mesh(body.atmosphere.geometry, body.atmosphere.material);
      group.add(tilt, atmo);
      let fit = body.def.radius * 1.22;
      const u = body.mesh.material.uniforms;
      u.uSunPos.value.copy(light);
      u.uHover.value = 0;
      u.uSpin.value = 0;
      body.atmosphere.material.uniforms.uSunPos.value.copy(light);
      for (const shell of [body.clouds, body.aurora]) {
        if (!shell) continue;
        shell.material.uniforms.uSunPos.value.copy(light);
        tilt.add(new THREE.Mesh(shell.geometry, shell.material));
      }
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
    // The intro flight is a drop out of hyperspace into the system.
    if (!this.opts.reducedMotion) {
      this.warp = 1;
      this.warpHigh = true;
    }
  }

  /**
   * Where the Milky Way and the black hole go, chosen from the overview: the band runs diagonally behind the
   * system (over the top-left, down to the bright centre at the lower right, clear of the hero text), the hole sits
   * in the free sky at the upper right. Both stay fixed in the world afterwards.
   */
  private skyFrame(): SkyFrame {
    const view = this.rig.overviewView();
    const tilt = THREE.MathUtils.degToRad(30);
    const along = view.right.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(view.up, -Math.sin(tilt)).normalize();
    const bandNormal = new THREE.Vector3().crossVectors(view.dir, along).normalize();
    const core = view.dir.clone().multiplyScalar(Math.cos(0.45)).addScaledVector(along, Math.sin(0.45)).normalize();
    return { bandNormal, core, blackHole: this.blackHoleFor(this.frame) };
  }

  /** The black hole in the overview's free sky: upper right (on phones higher up and smaller, above the orbits). */
  private blackHoleFor(frame: Frame): SkyFrame["blackHole"] {
    const view = this.rig.overviewView(frame);
    const dir = view.portrait ? this.rig.overviewSkyDirection(0.3, 0.41, frame) : this.rig.overviewSkyDirection(0.34, 0.35, frame);
    const u = view.right.clone().addScaledVector(dir, -view.right.dot(dir)).normalize();
    const v = new THREE.Vector3().crossVectors(u, dir).normalize();
    // (the disk a little tilted, not exactly level with the screen)
    const t = -0.22;
    const du = u.clone().multiplyScalar(Math.cos(t)).addScaledVector(v, Math.sin(t));
    const dv = v.clone().multiplyScalar(Math.cos(t)).addScaledVector(u, -Math.sin(t));
    const radius = 0.016 * THREE.MathUtils.clamp(view.freeWidth / 1100, 0.5, 1);
    return { dir, u: du, v: dv, radius };
  }

  /**
   * Places the black hole again, for the final layout (once fonts and the hero are in place, just before the intro).
   * It stays fixed in the world afterwards.
   */
  placeBlackHole(frame: Frame) {
    const bh = this.blackHoleFor(frame);
    const sky = (this.sky.material as THREE.ShaderMaterial).uniforms;
    sky.uBhDir.value.copy(bh.dir);
    sky.uBhU.value.copy(bh.u);
    sky.uBhV.value.copy(bh.v);
    sky.uBhR.value = bh.radius;
    for (const layer of [this.stars, this.bandStars]) {
      layer.material.uniforms.uBhDir.value.copy(bh.dir);
      layer.material.uniforms.uBhR.value = bh.radius;
    }
  }

  /** 0…1, how deep in hyperspace the camera is */
  /**
   * A flight the page makes on its own (dock, arrow keys, "fly on") that stays out of hyperspace for `seconds`:
   * a hop to the neighbouring planet is quick enough to count as fast. 0 ends it.
   */
  calmFlight(seconds: number) {
    this.calmUntil = performance.now() + seconds * 1000;
  }

  get warpLevel() {
    return this.warp;
  }

  /** The name forming out of a passing ship's trail (with the intro flight). */
  playNameIntro(opts: NameIntroOptions) {
    this.nameIntro?.dispose();
    this.nameIntro = new NameIntro(opts);
    this.scene.add(this.nameIntro.group);
  }

  /** Ends the name intro at once. */
  endNameIntro() {
    this.nameIntro?.finish();
  }

  setFrame(frame: Frame) {
    this.frame = frame;
    this.rig.setFrame(frame);
  }

  setJourney(j: Journey) {
    this.rig.setJourney(j);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.dpr);
    this.composer?.setSize(w, h);
    this.stars.material.uniforms.uPixelRatio.value = this.dpr;
    this.bandStars.material.uniforms.uPixelRatio.value = this.dpr;
    this.dust.material.uniforms.uPixelRatio.value = this.dpr;
    this.renderer.getDrawingBufferSize(this.drawingSize);
    resolution.value.copy(this.drawingSize);
    this.hyperspace?.setPixelRatio(this.dpr);
    if (this.hyperPass) this.hyperPass.uniforms.uAspect.value = w / h;
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
    this.fleet.setEnabled(!on);
  }

  // ---------- pointer input (on the canvas) ----------

  pointerMove(x: number, y: number, isTouch: boolean) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.inside = true;
    this.pointer.moved = true;
    this.pointer.touch = isTouch;
    if (!isTouch) this.rig.setPointer((x / window.innerWidth) * 2 - 1, -((y / window.innerHeight) * 2 - 1));
    if (this.down) {
      const dx = x - this.down.lastX;
      if (!this.down.dragging && Math.hypot(x - this.down.x, y - this.down.y) > 6) this.down.dragging = true;
      if (this.down.dragging) this.rig.drag(dx);
      this.down.lastX = x;
    }
  }

  pointerDown(x: number, y: number, isTouch: boolean) {
    this.down = { x, y, t: performance.now(), lastX: x, dragging: false };
    this.pointerMove(x, y, isTouch);
  }

  pointerUp(x: number, y: number, isTouch: boolean) {
    const d = this.down;
    this.down = null;
    if (!d || d.dragging || performance.now() - d.t > 600) return;
    const hit = this.pick(x, y, isTouch ? 26 : 16);
    if (hit) this.opts.onSelect(hit);
  }

  pointerCancel() {
    this.down = null;
  }

  pointerLeave() {
    this.pointer.inside = false;
    this.pointer.moved = true;
    this.rig.setPointer(0, 0);
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
    // Planets, moons and the sun come first; a ship only when the point is right on it.
    const hit = best as PickTarget | null;
    if (hit) return hit;
    const ship = this.fleet?.pickShip(this.rig.camera, x, y, this.frame.width, this.frame.height, minRadius > 20 ? 20 : 14);
    return ship != null ? { type: "ship" } : null;
  }

  // ---------- frame loop ----------

  private loop = (timestamp?: number) => {
    this.timer.update(timestamp);
    this.opts.beforeFrame?.(timestamp ?? performance.now());
    const dt = Math.min(this.timer.getDelta(), 1 / 20);
    this.update(dt);
    this.draw();
    this.adaptQuality(dt);
  };

  private draw() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.rig.camera);
  }

  private update(dt: number) {
    this.time += dt;
    const closeness = this.rig.closeness;
    // The planets slow down while you're at one (reading), and turn at full speed in the overview.
    const targetScale = (this.opts.reducedMotion ? 0.3 : 1) * THREE.MathUtils.lerp(1, 0.1, closeness);
    this.timeScale += (targetScale - this.timeScale) * (1 - Math.exp(-dt * 2));
    const sunPos = this.sun.group.position;
    const focused = this.rig.focusedIndex;

    for (const b of this.bodies) {
      b.setOrbitOpacity(THREE.MathUtils.lerp(0.32, 0.12, closeness));
      b.activeTarget = this.bodies.indexOf(b) === focused ? 1 : 0;
      b.update(dt, dt * this.timeScale, this.time, sunPos);
    }
    this.updateWarp(dt);
    this.rig.warp = this.warp;
    this.rig.update(dt);
    const cam = this.rig.camera;
    this.sun.update(this.time, dt, cam);
    this.sky.position.copy(cam.position);
    this.stars.points.position.copy(cam.position);
    this.bandStars.points.position.copy(cam.position);
    this.stars.material.uniforms.uTime.value = this.time;
    // (the black hole's disk turns; held still with reduced motion)
    if (!this.opts.reducedMotion) this.skyTime += dt;

    // In hyperspace the streaks take over from the sky.
    const w = this.warp;
    const skyUniforms = (this.sky.material as THREE.ShaderMaterial).uniforms;
    skyUniforms.uIntensity.value = 1 - 0.55 * w;
    skyUniforms.uTime.value = this.skyTime;
    this.stars.material.uniforms.uBoost.value = 1 - 0.75 * w;
    this.bandStars.material.uniforms.uBoost.value = 0.62 * (1 - 0.8 * w);
    this.dust.material.uniforms.uBoost.value = 0.32 * (1 - 0.8 * w);
    this.hyperspace.update(cam, w, this.warpTravel);
    this.meteors.update(dt, cam, !this.opts.reducedMotion && w < 0.02);
    this.fleet.update(dt, cam, this.rig.lookTarget, w);
    if (this.nameIntro) {
      this.nameIntro.update(dt, cam, this.dpr);
      if (this.nameIntro.done) {
        this.nameIntro.dispose();
        this.nameIntro = null;
      }
    }
    if (this.hyperPass) {
      const u = this.hyperPass.uniforms;
      this.hyperPass.enabled = w > 0.002 || this.flash > 0.002;
      u.uWarp.value = w;
      u.uFlash.value = this.flash;
      u.uTime.value = this.time;
      const shift = this.rig.projectionShift;
      u.uCenter.value.set(0.5 - shift.x / this.frame.width, 0.5 + shift.y / this.frame.height);
    }

    this.labelFrame.focused = focused;
    this.labelFrame.closeness = closeness;
    this.updateScreen();
    this.updateHover();
    this.opts.onFrame(this.labelFrame);
  }

  /**
   * Hyperspace only when travelling fast between two stops (a quick scroll, a jump across several planets): calm
   * scrolling and a hop to the neighbouring planet (see calmFlight) stay in normal space. It builds up after
   * leaving, deeper the faster, and drops out before arriving. The intro flight starts in it.
   */
  private updateWarp(dt: number) {
    const j = this.rig.journeyState;
    const position = j.from + (j.to - j.from) * j.t;
    const v = dt > 0 ? Math.abs(position - this.lastPosition) / dt : 0;
    this.lastPosition = position;
    this.travelSpeed += (Math.min(v, 4) - this.travelSpeed) * (1 - Math.exp(-dt * 5));

    let target = 0;
    if (j.from !== j.to && performance.now() > this.calmUntil) {
      const envelope = smooth(0.03, 0.2, j.t) * (1 - smooth(0.8, 0.97, j.t));
      // (speed in planets per second; a planet is about one screen height of scrolling apart from the next:
      // calm scrolling stays below 1, a quick flick or a fast spin of the wheel goes well past 2)
      target = envelope * smooth(1.4, 2.8, this.travelSpeed);
    }
    const intro = this.rig.introProgress;
    if (intro !== null) target = Math.max(target, 1 - smooth(0.1, 0.5, intro));
    if (this.opts.reducedMotion) target = 0;
    this.warp += (target - this.warp) * (1 - Math.exp(-dt * (target > this.warp ? 4 : 7)));
    if (this.warp < 0.0005) this.warp = 0;

    if (!this.warpHigh && this.warp > 0.55) {
      this.warpHigh = true;
      this.flash = Math.max(this.flash, 0.22);
      this.opts.onWarp?.("enter");
    } else if (this.warpHigh && this.warp < 0.3) {
      this.warpHigh = false;
      this.flash = Math.max(this.flash, 0.35);
      this.opts.onWarp?.("exit");
    }
    this.flash *= Math.exp(-dt * 8);
    if (this.flash < 0.002) this.flash = 0;
    this.warpTravel += dt * (25 + 560 * this.warp * this.warp * (1 + Math.min(this.travelSpeed, 2) * 0.35));
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
    // (the ships move under a resting pointer: look again now and then, and every frame while on one)
    this.hoverCheck++;
    const recheck = this.pointer.inside && !this.pointer.touch && (this.hover?.type === "ship" || this.hoverCheck % 6 === 0);
    if ((this.pointer.moved || recheck) && !this.down?.dragging) {
      this.pointer.moved = false;
      const hit = this.pointer.inside ? this.pick(this.pointer.x, this.pointer.y, 14) : null;
      if (!samePick(hit, this.hover)) {
        this.hover = hit;
        this.opts.onHover(hit);
      }
    }
    const h = this.externalHover ?? this.hover;
    this.sun.setHover(h?.type === "sun");
    this.fleet.setSlowMotion(this.hover?.type === "ship");
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
