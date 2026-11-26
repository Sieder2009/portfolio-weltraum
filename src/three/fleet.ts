import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GlowPoints, StreakBatch } from "./fx";

// A space battle in the background: two factions of fighters chase each other in loops and shoot,
// hits throw sparks, a ship with too many hits explodes and later jumps back in from hyperspace.
// Two large ships trade heavy fire further back.
//
// Everything lives in an "arena" that follows the camera's view (and grows with the camera's distance),
// so the battle stays on screen at the overview as well as close to a planet, and still passes behind
// the planets (it is drawn in the scene with depth).

/** 0: blue-green patrol, 1: ember raiders */
export type Faction = 0 | 1;

const FIGHTER_LEN = 0.075;
const CAPITAL_LEN = 0.62;
const BOLT_SPEED = 2.3;
const HEAVY_SPEED = 1.5;
const HIT_RADIUS = 0.03;
const TRAIL_POINTS = 12;

const LASER = [new THREE.Color(0.3, 1.9, 2.6), new THREE.Color(3.0, 0.5, 0.18)];
const TRAIL = [new THREE.Color(0.3, 0.75, 1.1), new THREE.Color(1.2, 0.5, 0.2)];
const ENGINE = [new THREE.Color(1.1, 2.3, 3.0), new THREE.Color(3.0, 1.25, 0.35)];

// ---------- shapes (built from simple solids, length 1 along +z, nose forward) ----------

type Vec3 = [number, number, number];

class Shape {
  private hull: THREE.BufferGeometry[] = [];
  private glow: THREE.BufferGeometry[] = [];

  add(g: THREE.BufferGeometry, at: Vec3, opts: { rot?: Vec3; scale?: Vec3; glow?: THREE.Color } = {}) {
    if (opts.scale) g.scale(...opts.scale);
    if (opts.rot) {
      g.rotateX(opts.rot[0]);
      g.rotateY(opts.rot[1]);
      g.rotateZ(opts.rot[2]);
    }
    g.translate(...at);
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    n.deleteAttribute("uv");
    n.deleteAttribute("normal");
    if (opts.glow) {
      const count = n.getAttribute("position").count;
      const c = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) c.set([opts.glow.r, opts.glow.g, opts.glow.b], i * 3);
      n.setAttribute("color", new THREE.BufferAttribute(c, 3));
      this.glow.push(n);
    } else {
      this.hull.push(n);
    }
    return this;
  }

  /** Small boxes on the hull for surface detail. */
  greebles(count: number, seed: number, w: number, h: number, z0: number, z1: number) {
    let s = seed;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
    for (let i = 0; i < count; i++) {
      const side = Math.floor(rand() * 4);
      const z = z0 + (z1 - z0) * rand();
      const sx = 0.015 + rand() * 0.035;
      const sy = 0.008 + rand() * 0.02;
      const sz = 0.02 + rand() * 0.07;
      const u = (rand() - 0.5) * 0.8;
      if (side === 0) this.add(new THREE.BoxGeometry(sx, sy, sz), [u * w, h / 2 + sy / 2, z]);
      else if (side === 1) this.add(new THREE.BoxGeometry(sx, sy, sz), [u * w, -h / 2 - sy / 2, z]);
      else this.add(new THREE.BoxGeometry(sy, sx, sz), [(side === 2 ? 1 : -1) * (w / 2 + sy / 2), u * h, z]);
    }
    return this;
  }

  build(length: number) {
    const finish = (parts: THREE.BufferGeometry[]) => {
      const g = mergeGeometries(parts, false)!;
      parts.forEach((p) => p.dispose());
      g.scale(length, length, length);
      g.computeVertexNormals(); // (not indexed: flat facets)
      return g;
    };
    return { hull: finish(this.hull), glow: finish(this.glow) };
  }
}

const rgb = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const HALF_PI = Math.PI / 2;

/** Patrol fighter: a slim dart with swept wings and two engines. */
function lanceShape(length = FIGHTER_LEN) {
  const s = new Shape();
  const engine = rgb(1.2, 2.6, 3.2);
  s.add(new THREE.CylinderGeometry(0.02, 0.09, 0.95, 6), [0, 0, 0.02], { scale: [1, 1, 0.7], rot: [HALF_PI, 0, 0] });
  for (const side of [-1, 1]) {
    s.add(new THREE.BoxGeometry(0.42, 0.02, 0.2), [side * 0.22, 0, -0.18], { rot: [0, side * 0.45, 0] });
    s.add(new THREE.BoxGeometry(0.02, 0.12, 0.14), [side * 0.41, 0.04, -0.27]);
    s.add(new THREE.CylinderGeometry(0.045, 0.055, 0.32, 8), [side * 0.11, -0.01, -0.33], { rot: [HALF_PI, 0, 0] });
    s.add(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 5), [side * 0.41, -0.01, -0.08], { rot: [HALF_PI, 0, 0] });
    s.add(new THREE.CylinderGeometry(0.042, 0.042, 0.02, 10), [side * 0.11, -0.01, -0.495], { rot: [HALF_PI, 0, 0], glow: engine });
    s.add(new THREE.BoxGeometry(0.28, 0.024, 0.03), [side * 0.24, 0.006, -0.1], { rot: [0, side * 0.45, 0], glow: rgb(0.25, 1.1, 1.4) });
  }
  s.add(new THREE.SphereGeometry(0.06, 8, 6), [0, 0.045, 0.12], { scale: [1, 0.7, 2.2], glow: rgb(0.12, 0.35, 0.5) });
  return s.build(length);
}

/** Raider fighter: a faceted pod held inside a crescent blade. */
function crescentShape(length = FIGHTER_LEN) {
  const s = new Shape();
  const arc = 3.5;
  s.add(new THREE.IcosahedronGeometry(0.16, 0), [0, 0, 0.02], { scale: [1, 0.75, 1.9] });
  const blade = new THREE.TorusGeometry(0.42, 0.04, 4, 22, arc);
  blade.rotateZ(-HALF_PI - arc / 2);
  blade.rotateX(HALF_PI);
  s.add(blade, [0, 0, 0], { scale: [1, 1, 0.45] });
  s.add(new THREE.BoxGeometry(0.03, 0.022, 0.16), [0, 0, -0.36]);
  for (const side of [-1, 1]) {
    s.add(new THREE.BoxGeometry(0.31, 0.018, 0.03), [side * 0.215, 0, -0.155], { rot: [0, side * 0.74, 0] });
    s.add(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 5), [side * 0.413, 0, 0.16], { rot: [HALF_PI, 0, 0] });
  }
  s.add(new THREE.SphereGeometry(0.055, 10, 8), [0, 0, -0.31], { scale: [1, 0.7, 0.5], glow: rgb(3.2, 1.2, 0.3) });
  s.add(new THREE.SphereGeometry(0.05, 10, 6), [0, 0.035, 0.27], { scale: [1.5, 0.55, 0.6], glow: rgb(1.6, 0.35, 0.12) });
  const edge = new THREE.TorusGeometry(0.39, 0.012, 3, 22, 3.3);
  edge.rotateZ(-HALF_PI - 1.65);
  edge.rotateX(HALF_PI);
  s.add(edge, [0, 0, 0], { glow: rgb(2.2, 0.55, 0.18) });
  return s.build(length);
}

/** Patrol carrier: a long spine with a lit ring around its middle. */
function carrierShape() {
  const s = new Shape();
  const engine = rgb(1.0, 2.4, 3.0);
  const windows = rgb(0.55, 0.95, 1.05);
  s.add(new THREE.BoxGeometry(0.12, 0.1, 0.8), [0, 0, 0]);
  s.add(new THREE.ConeGeometry(0.085, 0.24, 4), [0, 0, 0.52], { rot: [HALF_PI, 0, 0] });
  s.add(new THREE.TorusGeometry(0.17, 0.018, 6, 28), [0, 0, 0.05]);
  s.add(new THREE.BoxGeometry(0.34, 0.015, 0.02), [0, 0, 0.05]);
  s.add(new THREE.BoxGeometry(0.015, 0.34, 0.02), [0, 0, 0.05]);
  s.add(new THREE.BoxGeometry(0.24, 0.15, 0.16), [0, 0, -0.42]);
  s.add(new THREE.BoxGeometry(0.05, 0.08, 0.1), [0, 0.09, -0.25]);
  s.add(new THREE.BoxGeometry(0.12, 0.025, 0.05), [0, 0.135, -0.25]);
  for (const side of [-1, 1]) {
    s.add(new THREE.BoxGeometry(0.05, 0.06, 0.35), [side * 0.085, -0.01, -0.05]);
    s.add(new THREE.BoxGeometry(0.003, 0.007, 0.55), [side * 0.0615, 0.022, 0.08], { glow: windows });
    s.add(new THREE.BoxGeometry(0.003, 0.007, 0.3), [side * 0.111, 0.0, -0.05], { glow: windows });
    s.add(new THREE.CylinderGeometry(0.036, 0.036, 0.01, 10), [side * 0.07, -0.02, -0.502], { rot: [HALF_PI, 0, 0], glow: engine });
    s.add(new THREE.TorusGeometry(0.17, 0.007, 4, 28), [0, 0, 0.05 + side * 0.02], { glow: rgb(0.2, 1.3, 1.5) });
  }
  s.add(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 10), [0, 0.04, -0.502], { rot: [HALF_PI, 0, 0], glow: engine });
  s.greebles(30, 5, 0.12, 0.1, -0.34, 0.38);
  return s.build(CAPITAL_LEN);
}

/** Raider cruiser: a block hull behind a wide front bar. */
function hammerShape() {
  const s = new Shape();
  const engine = rgb(3.0, 1.0, 0.25);
  const windows = rgb(1.5, 0.75, 0.35);
  s.add(new THREE.BoxGeometry(0.16, 0.11, 0.7), [0, 0, -0.05]);
  s.add(new THREE.BoxGeometry(0.5, 0.07, 0.12), [0, 0, 0.36]);
  s.add(new THREE.BoxGeometry(0.12, 0.05, 0.4), [0, 0.075, -0.1]);
  s.add(new THREE.BoxGeometry(0.08, 0.04, 0.2), [0, 0.115, -0.2]);
  s.add(new THREE.BoxGeometry(0.4, 0.004, 0.003), [0, 0, 0.4215], { glow: rgb(2.2, 0.5, 0.15) });
  s.add(new THREE.BoxGeometry(0.1, 0.06, 0.008), [0, 0, -0.404], { glow: engine });
  for (const side of [-1, 1]) {
    s.add(new THREE.BoxGeometry(0.08, 0.1, 0.16), [side * 0.25, 0, 0.36]);
    s.add(new THREE.CylinderGeometry(0.04, 0.05, 0.3, 8), [side * 0.12, -0.02, -0.3], { rot: [HALF_PI, 0, 0] });
    s.add(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 10), [side * 0.12, -0.02, -0.452], { rot: [HALF_PI, 0, 0], glow: engine });
    s.add(new THREE.BoxGeometry(0.003, 0.006, 0.5), [side * 0.0815, 0.02, -0.05], { glow: windows });
    s.add(new THREE.BoxGeometry(0.003, 0.005, 0.3), [side * 0.0615, 0.075, -0.1], { glow: windows });
  }
  s.greebles(34, 9, 0.16, 0.11, -0.36, 0.26);
  return s.build(CAPITAL_LEN);
}

const HULL_COLORS = [0xb4c0d2, 0x4d4f59];
const hullMaterial = (faction: Faction) =>
  new THREE.MeshStandardMaterial({ color: HULL_COLORS[faction], roughness: faction ? 0.5 : 0.45, metalness: faction ? 0.45 : 0.35 });

/** One fighter on its own (the intro fly-by): nose along +z, one unit long, with its engine positions. */
export function createFighter(faction: Faction) {
  const shape = faction === 0 ? lanceShape(1) : crescentShape(1);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(shape.hull, hullMaterial(faction)), new THREE.Mesh(shape.glow, new THREE.MeshBasicMaterial({ vertexColors: true })));
  const engines = (faction === 0 ? LANCE_ENGINES : CRESCENT_ENGINES).map((e) => e.clone());
  const dispose = () =>
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  return { group, engines, dispose };
}

// ---------- the battle ----------

interface Chain {
  center: THREE.Vector3;
  amp: THREE.Vector3;
  freq: THREE.Vector3;
  phase: THREE.Vector3;
  speed: number;
  s: number;
}

interface Fighter {
  faction: Faction;
  slot: number;
  chain: Chain;
  lag: number;
  alive: boolean;
  hp: number;
  respawn: number;
  arrive: number;
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  left: THREE.Vector3;
  quat: THREE.Quaternion;
  cooldown: number;
  shots: number;
  pause: number;
  side: number;
  roll: number;
  rollWait: number;
  wobble: THREE.Vector3;
  trail: Float32Array;
  trailCount: number;
  trailTimer: number;
}

interface Capital {
  faction: Faction;
  group: THREE.Group;
  base: THREE.Vector3;
  phase: number;
  axis: THREE.Vector3;
  turrets: THREE.Vector3[];
  engines: THREE.Vector3[];
  cooldown: number;
}

interface Bolt {
  alive: boolean;
  p: THREE.Vector3;
  prev: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  life: number;
  len: number;
  width: number;
  faction: Faction;
  heavy: boolean;
}

interface Particle {
  alive: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
  drag: number;
  color: THREE.Color;
  flash: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Fleet {
  /** the arena: follows the view, everything below is in its (scaled) space */
  readonly group = new THREE.Group();
  private fighters: Fighter[] = [];
  private chains: Chain[] = [];
  private capitals: Capital[] = [];
  private bolts: Bolt[] = [];
  private particles: Particle[] = [];
  private meshes: { hull: THREE.InstancedMesh; glow: THREE.InstancedMesh }[] = [];
  private boltBatch: StreakBatch;
  private trailBatch: StreakBatch;
  private glows: GlowPoints;
  private enabled = true;
  private placed = false;
  private time = 0;
  private spread = 1;
  private seed = 4242;

  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();
  private mat = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private pv = new THREE.Vector3();
  private e1 = new THREE.Vector3();
  private e2 = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private cursor = 0;
  private slow = 0;
  private slowTarget = 0;

  constructor(opts: { lowPower: boolean }) {
    const low = opts.lowPower;
    this.group.name = "fleet";

    // Loops for the dogfights (arena units; the arena is scaled to the view).
    const chainDefs: { ships: Faction[]; center: Vec3; amp: Vec3; freq: Vec3; speed: number }[] = [
      { ships: [1, 0, 1, 0], center: [0.1, 0.15, -0.1], amp: [1.75, 0.55, 0.9], freq: [1, 2, 1], speed: 0.2 },
      { ships: [0, 1, 0], center: [-0.2, -0.1, 0.25], amp: [1.35, 0.75, 1.0], freq: [1, 1.5, 2], speed: -0.22 },
      { ships: [1, 0, 1, 0], center: [0.3, 0.25, -0.6], amp: [1.6, 0.6, 0.8], freq: [2, 1, 1.5], speed: 0.13 },
    ];
    const defs = low ? chainDefs.slice(0, 2).map((c) => ({ ...c, ships: c.ships.slice(0, 3) })) : chainDefs;
    const slots = [0, 0];
    for (const def of defs) {
      const chain: Chain = {
        center: new THREE.Vector3(...def.center),
        amp: new THREE.Vector3(...def.amp),
        freq: new THREE.Vector3(...def.freq),
        phase: new THREE.Vector3(this.rand() * 6.28, this.rand() * 6.28, this.rand() * 6.28),
        speed: def.speed,
        s: this.rand() * 20,
      };
      this.chains.push(chain);
      def.ships.forEach((faction, i) => {
        this.fighters.push({
          faction,
          slot: slots[faction]++,
          chain,
          lag: i * 0.09 + (i ? this.rand() * 0.02 : 0),
          alive: true,
          hp: 0,
          respawn: 0,
          arrive: 1,
          pos: new THREE.Vector3(),
          fwd: new THREE.Vector3(0, 0, 1),
          left: new THREE.Vector3(1, 0, 0),
          quat: new THREE.Quaternion(),
          cooldown: this.rand(),
          shots: 4,
          pause: this.rand() * 1.5,
          side: 1,
          roll: 0,
          rollWait: 3 + this.rand() * 6,
          wobble: new THREE.Vector3(this.rand() * 6.28, this.rand() * 6.28, this.rand() * 6.28),
          trail: new Float32Array(TRAIL_POINTS * 3),
          trailCount: 0,
          trailTimer: 0,
        });
      });
    }
    this.fighters.forEach((f) => (f.hp = this.newHp()));

    const hullMaterials = [hullMaterial(0), hullMaterial(1)];
    const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
    const fighterShapes = [lanceShape(), crescentShape()];
    for (const faction of [0, 1] as const) {
      const n = Math.max(1, slots[faction]);
      const hull = new THREE.InstancedMesh(fighterShapes[faction].hull, hullMaterials[faction], n);
      const glow = new THREE.InstancedMesh(fighterShapes[faction].glow, glowMaterial, n);
      for (const m of [hull, glow]) {
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(m);
      }
      this.meshes.push({ hull, glow });
    }

    // The two big ships, further back, facing each other at an angle.
    const capitalShapes = [carrierShape(), hammerShape()];
    const capitalDefs: { base: Vec3; yaw: number; turrets: Vec3[]; engines: Vec3[] }[] = [
      {
        base: [-1.95, 0.5, -2.3],
        yaw: HALF_PI - 0.42,
        turrets: [[0, 0.06, 0.22], [0, 0.06, -0.08], [0, -0.06, 0.02], [0.08, 0, 0.3]],
        engines: [[-0.07, -0.02, -0.52], [0.07, -0.02, -0.52], [0, 0.04, -0.52]],
      },
      {
        base: [2.05, -0.38, -2.7],
        yaw: -HALF_PI + 0.42,
        turrets: [[0, 0.14, -0.12], [0.22, 0.04, 0.36], [-0.22, 0.04, 0.36], [0, -0.07, 0.0]],
        engines: [[-0.12, -0.02, -0.47], [0.12, -0.02, -0.47], [0, 0, -0.42]],
      },
    ];
    capitalDefs.forEach((def, i) => {
      const faction = i as Faction;
      const group = new THREE.Group();
      const hull = new THREE.Mesh(capitalShapes[i].hull, hullMaterials[faction]);
      const glow = new THREE.Mesh(capitalShapes[i].glow, glowMaterial);
      group.add(hull, glow);
      group.rotation.set(0.04 * (i ? -1 : 1), def.yaw, 0.06 * (i ? 1 : -1));
      group.position.set(...def.base);
      this.group.add(group);
      this.capitals.push({
        faction,
        group,
        base: new THREE.Vector3(...def.base),
        phase: i * 2.1,
        axis: new THREE.Vector3(),
        turrets: def.turrets.map((t) => new THREE.Vector3(...t).multiplyScalar(CAPITAL_LEN)),
        engines: def.engines.map((t) => new THREE.Vector3(...t).multiplyScalar(CAPITAL_LEN)),
        cooldown: 0.5 + this.rand() * 1.5,
      });
    });

    for (let i = 0; i < 160; i++) {
      this.bolts.push({
        alive: false,
        p: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        speed: 0,
        life: 0,
        len: 0,
        width: 0,
        faction: 0,
        heavy: false,
      });
    }
    for (let i = 0; i < (low ? 450 : 1000); i++) {
      this.particles.push({
        alive: false,
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        life: 0,
        max: 1,
        size: 0,
        grow: 0,
        drag: 0,
        color: new THREE.Color(),
        flash: false,
      });
    }

    this.trailBatch = new StreakBatch(this.fighters.length * TRAIL_POINTS, { minPx: 1.2 });
    this.boltBatch = new StreakBatch(this.bolts.length + this.fighters.length, { core: 1.2, minPx: 1.6 });
    this.glows = new GlowPoints(this.particles.length + this.fighters.length * 2 + 12, { minPx: 2 });
    this.group.add(this.trailBatch.mesh, this.boltBatch.mesh, this.glows.points);
  }

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  private newHp() {
    return 9 + Math.floor(this.rand() * 6);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.group.visible = on;
  }

  /** Slow motion while the pointer is on a ship (easier to click). */
  setSlowMotion(on: boolean) {
    this.slowTarget = on ? 1 : 0;
  }

  /**
   * The distance to the nearest ship under a screen point (CSS pixels), or null. A ship counts when the point lies
   * within its own outline, or at least `minPx` from its centre.
   */
  pickShip(camera: THREE.PerspectiveCamera, x: number, y: number, width: number, height: number, minPx: number): number | null {
    if (!this.enabled || !this.placed) return null;
    this.group.updateMatrixWorld();
    const focal = height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const scale = this.group.scale.x;
    let best = Infinity;
    const test = (local: THREE.Vector3, radius: number) => {
      const p = this.pv.copy(local).applyMatrix4(this.group.matrixWorld);
      const dist = camera.position.distanceTo(p);
      p.project(camera);
      if (p.z < -1 || p.z > 1) return;
      const sx = (p.x * 0.5 + 0.5) * width;
      const sy = (-p.y * 0.5 + 0.5) * height;
      const r = ((radius * scale) / Math.max(dist, 1e-3)) * focal;
      if (Math.hypot(sx - x, sy - y) <= Math.max(r, minPx) && dist < best) best = dist;
    };
    for (const f of this.fighters) if (f.alive && f.arrive >= 1) test(f.pos, FIGHTER_LEN * 0.6);
    for (const c of this.capitals) test(c.group.position, CAPITAL_LEN * 0.42);
    return best < Infinity ? best : null;
  }

  update(realDt: number, camera: THREE.PerspectiveCamera, target: THREE.Vector3, warp: number) {
    if (!this.enabled) return;
    this.follow(realDt, camera, target, warp);
    this.slow += (this.slowTarget - this.slow) * (1 - Math.exp(-realDt * 6));
    const dt = realDt * (1 - 0.8 * this.slow);
    this.time += dt;
    for (const c of this.chains) c.s += c.speed * dt;
    for (const f of this.fighters) this.updateFighter(f, dt);
    for (const f of this.fighters) this.fire(f, dt);
    this.updateCapitals(dt);
    this.updateBolts(dt);
    this.updateParticles(dt);
    this.draw();
  }

  // ---------- the arena follows the view ----------

  private follow(dt: number, camera: THREE.PerspectiveCamera, target: THREE.Vector3, warp: number) {
    const dist = Math.max(1, camera.position.distanceTo(target));
    // Grows slower than the distance: ships look smaller in the overview than beside a planet.
    const s = Math.pow(dist, 0.7);
    const fwd = this.tmp.copy(target).sub(camera.position).normalize();
    this.desired.copy(target).addScaledVector(fwd, 0.6 * s);
    // On narrow screens the loops pull in sideways.
    this.spread = THREE.MathUtils.clamp(camera.aspect / 1.6, 0.42, 1.1);
    if (!this.placed) {
      this.group.position.copy(this.desired);
      this.group.scale.setScalar(s);
      this.group.quaternion.copy(camera.quaternion);
      this.placed = true;
      return;
    }
    const k = 1 - Math.exp(-dt * (warp > 0.2 ? 10 : 1.6));
    this.group.position.lerp(this.desired, k);
    this.group.scale.setScalar(this.group.scale.x + (s - this.group.scale.x) * k);
    this.group.quaternion.slerp(camera.quaternion, k);
  }

  // ---------- fighters ----------

  /** position on a chain's loop, its direction of flight and the sideways pull of the turn */
  private curve(c: Chain, u: number, pos: THREE.Vector3, vel: THREE.Vector3, acc: THREE.Vector3) {
    const { amp, freq, phase, center } = c;
    const sp = this.spread;
    const ax = freq.x * u + phase.x;
    const ay = freq.y * u + phase.y;
    const az = freq.z * u + phase.z;
    pos.set(center.x * sp + amp.x * sp * Math.sin(ax), center.y + amp.y * Math.sin(ay), center.z + amp.z * Math.sin(az));
    vel.set(amp.x * sp * freq.x * Math.cos(ax), amp.y * freq.y * Math.cos(ay), amp.z * freq.z * Math.cos(az)).multiplyScalar(c.speed);
    acc.set(-amp.x * sp * freq.x * freq.x * Math.sin(ax), -amp.y * freq.y * freq.y * Math.sin(ay), -amp.z * freq.z * freq.z * Math.sin(az)).multiplyScalar(c.speed * c.speed);
  }

  private updateFighter(f: Fighter, dt: number) {
    if (!f.alive) {
      f.respawn -= dt;
      if (f.respawn > 0) return;
      // Back in the fight: drops out of hyperspace at its place in the loop.
      f.alive = true;
      f.hp = this.newHp();
      f.arrive = 0;
      f.trailCount = 0;
    }
    const vel = this.tmp;
    const acc = this.tmp2;
    this.curve(f.chain, f.chain.s - f.lag * Math.sign(f.chain.speed), f.pos, vel, acc);
    const t = this.time;
    const w = f.wobble;
    f.pos.x += Math.sin(t * 1.7 + w.x) * 0.025;
    f.pos.y += Math.sin(t * 2.3 + w.y) * 0.02;
    f.pos.z += Math.sin(t * 1.3 + w.z) * 0.025;

    const fwd = f.fwd.copy(vel).normalize();
    // Bank into the turn: the up vector leans toward the centre of the curve.
    const lateral = acc.addScaledVector(fwd, -acc.dot(fwd));
    const up = this.tmp3.copy(UP).addScaledVector(lateral, 3.2);
    if (up.lengthSq() > 4) up.setLength(2);
    const left = f.left.crossVectors(up, fwd);
    if (left.lengthSq() < 1e-6) left.set(1, 0, 0);
    left.normalize();
    up.crossVectors(fwd, left);
    this.mat.makeBasis(left, up, fwd);
    f.quat.setFromRotationMatrix(this.mat);

    // Now and then an evasive roll.
    f.rollWait -= dt;
    if (f.rollWait <= 0 && f.roll === 0) f.roll = 0.0001;
    if (f.roll > 0) {
      f.roll += dt / 0.9;
      if (f.roll >= 1) {
        f.roll = 0;
        f.rollWait = 4 + this.rand() * 7;
      } else {
        const e = f.roll < 0.5 ? 2 * f.roll * f.roll : 1 - Math.pow(-2 * f.roll + 2, 2) / 2;
        f.quat.multiply(this.q.setFromAxisAngle(this.tmp.set(0, 0, 1), e * Math.PI * 2));
      }
    }
    if (f.arrive === 0) this.spawnParticle(f.pos, this.pv.set(0, 0, 0), 0.3, 0.12, 1, 0, ARRIVE, 1.2, true);
    if (f.arrive < 1) f.arrive = Math.min(1, f.arrive + dt / 0.35);

    // engine trail
    f.trailTimer -= dt;
    if (f.trailTimer <= 0) {
      f.trailTimer = 0.03;
      f.trail.copyWithin(3, 0, (TRAIL_POINTS - 1) * 3);
      const e = this.enginePoint(f, this.tmp);
      f.trail[0] = e.x;
      f.trail[1] = e.y;
      f.trail[2] = e.z;
      f.trailCount = Math.min(TRAIL_POINTS, f.trailCount + 1);
    }
  }

  private enginePoint(f: Fighter, out: THREE.Vector3) {
    return out
      .set(0, f.faction === 0 ? -0.01 : 0, f.faction === 0 ? -0.5 : -0.33)
      .multiplyScalar(FIGHTER_LEN)
      .applyQuaternion(f.quat)
      .add(f.pos);
  }

  private fire(f: Fighter, dt: number) {
    if (!f.alive || f.arrive < 1) return;
    f.cooldown -= dt;
    if (f.pause > 0) {
      f.pause -= dt;
      return;
    }
    let best: Fighter | null = null;
    let bestScore = -Infinity;
    for (const o of this.fighters) {
      if (!o.alive || o.faction === f.faction) continue;
      const to = this.tmp.copy(o.pos).sub(f.pos);
      const d = to.length();
      if (d > 1.0 || d < 0.05) continue;
      const aim = to.dot(f.fwd) / d;
      if (aim < 0.9) continue;
      const score = aim - d * 0.25;
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (!best || f.cooldown > 0) return;
    const to = this.tmp.copy(best.pos).sub(f.pos).normalize();
    const dir = this.tmp2.copy(f.fwd).multiplyScalar(0.55).addScaledVector(to, 0.45);
    dir.x += (this.rand() - 0.5) * 0.05;
    dir.y += (this.rand() - 0.5) * 0.05;
    dir.z += (this.rand() - 0.5) * 0.05;
    dir.normalize();
    // (twin guns: left and right in turn)
    const gun = this.tmp3.copy(f.left).multiplyScalar(f.side * 0.4 * FIGHTER_LEN).addScaledVector(f.fwd, 0.4 * FIGHTER_LEN).add(f.pos);
    f.side = -f.side;
    this.spawnBolt(gun, dir, f.faction, false);
    this.spawnParticle(gun, this.tmp.set(0, 0, 0), 0.07, 0.022, 0, 0, LASER[f.faction], 0.8, true);
    f.cooldown = 0.1 + this.rand() * 0.07;
    if (--f.shots <= 0) {
      f.shots = 3 + Math.floor(this.rand() * 5);
      f.pause = 0.5 + this.rand() * 1.5;
    }
  }

  // ---------- capital ships ----------

  private updateCapitals(dt: number) {
    const t = this.time;
    for (const c of this.capitals) {
      const g = c.group;
      g.position.set(
        c.base.x * this.spread + Math.sin(t * 0.045 + c.phase) * 0.12,
        c.base.y + Math.sin(t * 0.06 + c.phase) * 0.04,
        c.base.z + Math.cos(t * 0.04 + c.phase) * 0.1,
      );
      c.axis.set(0, 0, 1).applyQuaternion(g.quaternion);
    }
    for (const c of this.capitals) {
      c.cooldown -= dt;
      if (c.cooldown > 0) continue;
      c.cooldown = 0.35 + this.rand() * 1.3;
      const other = this.capitals[c.faction === 0 ? 1 : 0];
      if (!other) continue;
      const from = this.tmp.copy(c.turrets[Math.floor(this.rand() * c.turrets.length)]).applyQuaternion(c.group.quaternion).add(c.group.position);
      const to = this.tmp2
        .copy(other.group.position)
        .addScaledVector(other.axis, (this.rand() - 0.5) * 0.7 * CAPITAL_LEN)
        .add(this.tmp3.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(0.07));
      const dir = to.sub(from).normalize();
      this.spawnBolt(from, dir, c.faction, true);
      this.spawnParticle(from, this.tmp3.set(0, 0, 0), 0.12, 0.05, 0, 0, LASER[c.faction], 1, true);
    }
  }

  // ---------- bolts ----------

  private spawnBolt(from: THREE.Vector3, dir: THREE.Vector3, faction: Faction, heavy: boolean) {
    const b = this.bolts.find((x) => !x.alive);
    if (!b) return;
    b.alive = true;
    b.p.copy(from);
    b.prev.copy(from);
    b.dir.copy(dir);
    b.speed = heavy ? HEAVY_SPEED : BOLT_SPEED;
    b.life = heavy ? 4 : 0.55;
    b.len = heavy ? 0.2 : 0.07;
    b.width = heavy ? 0.022 : 0.009;
    b.faction = faction;
    b.heavy = heavy;
  }

  private updateBolts(dt: number) {
    for (const b of this.bolts) {
      if (!b.alive) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.alive = false;
        continue;
      }
      b.prev.copy(b.p);
      b.p.addScaledVector(b.dir, b.speed * dt);
      if (!b.heavy) {
        for (const f of this.fighters) {
          if (!f.alive || f.faction === b.faction || f.arrive < 1) continue;
          if (segmentDistanceSq(f.pos, b.prev, b.p, this.tmp) < HIT_RADIUS * HIT_RADIUS) {
            b.alive = false;
            this.hitFighter(f, b);
            break;
          }
        }
        if (!b.alive) continue;
      }
      for (const c of this.capitals) {
        if (c.faction === b.faction) continue;
        const a = this.tmp2.copy(c.group.position).addScaledVector(c.axis, 0.45 * CAPITAL_LEN);
        const z = this.tmp3.copy(c.group.position).addScaledVector(c.axis, -0.45 * CAPITAL_LEN);
        const r = 0.065 * CAPITAL_LEN;
        if (segmentsClose(b.p, a, z, r)) {
          b.alive = false;
          this.impact(b.p, b.faction, b.heavy ? 1 : 0.45);
          break;
        }
      }
    }
  }

  private hitFighter(f: Fighter, b: Bolt) {
    this.impact(b.p, b.faction, 0.35);
    if (--f.hp > 0) return;
    this.explode(f.pos, f.faction);
    f.alive = false;
    f.respawn = 2.5 + this.rand() * 3.5;
  }

  // ---------- sparks, fire, explosions ----------

  private spawnParticle(
    p: THREE.Vector3,
    v: THREE.Vector3,
    life: number,
    size: number,
    grow: number,
    drag: number,
    color: THREE.Color,
    intensity: number,
    flash = false,
  ) {
    const all = this.particles;
    let q: Particle | null = null;
    for (let i = 0; i < all.length; i++) {
      const c = all[(this.cursor + i) % all.length];
      if (!c.alive) {
        q = c;
        this.cursor = (this.cursor + i + 1) % all.length;
        break;
      }
    }
    if (!q) return;
    q.alive = true;
    q.p.copy(p);
    q.v.copy(v);
    q.life = q.max = life;
    q.size = size;
    q.grow = grow;
    q.drag = drag;
    q.color.copy(color).multiplyScalar(intensity);
    q.flash = flash;
  }

  private randomDir(out: THREE.Vector3) {
    const z = this.rand() * 2 - 1;
    const a = this.rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return out.set(r * Math.cos(a), z, r * Math.sin(a));
  }

  private impact(p: THREE.Vector3, faction: Faction, power: number) {
    const v = this.pv;
    this.spawnParticle(p, v.set(0, 0, 0), 0.14, 0.045 * (0.6 + power), 1.2, 0, WHITE_HOT, 1.1, true);
    const n = Math.round(5 + power * 10);
    for (let i = 0; i < n; i++) {
      this.randomDir(v).multiplyScalar(0.25 + this.rand() * 0.6 * (0.5 + power));
      this.spawnParticle(p, v, 0.25 + this.rand() * 0.35, 0.012, 0, 2.5, i % 2 ? LASER[faction] : SPARK, 1);
    }
  }

  private explode(p: THREE.Vector3, faction: Faction) {
    const v = this.pv;
    const r = () => this.rand();
    this.spawnParticle(p, v.set(0, 0, 0), 0.22, 0.16, 1.4, 0, WHITE_HOT, 1.0, true);
    this.spawnParticle(p, v.set(0, 0, 0), 0.55, 0.11, 1.2, 0, FIRE, 0.9, true);
    for (let i = 0; i < 24; i++) {
      this.randomDir(v).multiplyScalar(0.08 + r() * 0.22);
      this.spawnParticle(p, v, 0.5 + r() * 0.7, 0.03 + r() * 0.03, 1.6, 2.2, i % 3 ? FIRE : EMBER_HOT, 0.5 + r() * 0.4);
    }
    for (let i = 0; i < 28; i++) {
      this.randomDir(v).multiplyScalar(0.4 + r() * 0.7);
      this.spawnParticle(p, v, 0.3 + r() * 0.6, 0.011, 0, 1.2, SPARK, 1.3);
    }
    // a flat shock ring
    const axis = this.randomDir(this.axis);
    const e1 = this.e1.crossVectors(axis, UP);
    if (e1.lengthSq() < 0.01) e1.set(1, 0, 0);
    e1.normalize();
    const e2 = this.e2.crossVectors(axis, e1);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      v.copy(e1).multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a)).multiplyScalar(0.55);
      this.spawnParticle(p, v, 0.45, 0.02, 0.5, 3, faction === 0 ? RING_EMBER : RING_BLUE, 1);
    }
    for (let i = 0; i < 10; i++) {
      this.randomDir(v).multiplyScalar(0.04 + r() * 0.1);
      this.spawnParticle(p, v, 1.5 + r() * 1.2, 0.02, 0.3, 0.6, EMBER, 1);
    }
  }

  private updateParticles(dt: number) {
    for (const q of this.particles) {
      if (!q.alive) continue;
      q.life -= dt;
      if (q.life <= 0) {
        q.alive = false;
        continue;
      }
      q.p.addScaledVector(q.v, dt);
      q.v.multiplyScalar(Math.exp(-q.drag * dt));
    }
  }

  // ---------- drawing ----------

  private draw() {
    const t = this.time;
    const hidden = this.mat.makeScale(0, 0, 0);
    for (const m of this.meshes) {
      for (let i = 0; i < m.hull.count; i++) {
        m.hull.setMatrixAt(i, hidden);
        m.glow.setMatrixAt(i, hidden);
      }
    }

    this.boltBatch.begin();
    this.trailBatch.begin();
    this.glows.begin();

    for (const f of this.fighters) {
      if (!f.alive) continue;
      const grow = THREE.MathUtils.smoothstep(f.arrive, 0, 0.6);
      this.mat.compose(f.pos, f.quat, this.scale.setScalar(Math.max(grow, 0.001)));
      const m = this.meshes[f.faction];
      m.hull.setMatrixAt(f.slot, this.mat);
      m.glow.setMatrixAt(f.slot, this.mat);

      // the jump back in: a bright line that shrinks into the ship
      if (f.arrive < 1) {
        const tail = this.tmp.copy(f.pos).addScaledVector(f.fwd, -0.8 * (1 - f.arrive));
        this.boltBatch.push(f.pos.x, f.pos.y, f.pos.z, tail.x, tail.y, tail.z, ARRIVE, 1 - f.arrive, 0.02, 0.004, 0.1);
      }

      // engines
      const flicker = 0.85 + 0.15 * Math.sin(t * 41 + f.slot * 3.1) * Math.sin(t * 27 + f.slot);
      const c = ENGINE[f.faction];
      const engines = f.faction === 0 ? LANCE_ENGINES : CRESCENT_ENGINES;
      for (const e of engines) {
        const p = this.tmp.copy(e).multiplyScalar(FIGHTER_LEN).applyQuaternion(f.quat).add(f.pos);
        this.glows.push(p.x, p.y, p.z, c.r, c.g, c.b, flicker * grow, f.faction === 0 ? 0.028 : 0.04);
      }

      // trail: from the engine back along the recent path
      const head = this.enginePoint(f, this.tmp);
      let px = head.x;
      let py = head.y;
      let pz = head.z;
      const n = f.trailCount;
      for (let i = 0; i < n; i++) {
        const x = f.trail[i * 3];
        const y = f.trail[i * 3 + 1];
        const z = f.trail[i * 3 + 2];
        const a0 = 1 - i / TRAIL_POINTS;
        const a1 = 1 - (i + 1) / TRAIL_POINTS;
        this.trailBatch.push(px, py, pz, x, y, z, TRAIL[f.faction], 0.5 * a0 * grow, 0.013 * a0 + 0.002, 0.013 * a1 + 0.002, a1 / Math.max(a0, 1e-3));
        px = x;
        py = y;
        pz = z;
      }
    }
    for (const m of this.meshes) {
      m.hull.instanceMatrix.needsUpdate = true;
      m.glow.instanceMatrix.needsUpdate = true;
    }

    for (const c of this.capitals) {
      const col = ENGINE[c.faction];
      for (const e of c.engines) {
        const p = this.tmp.copy(e).applyQuaternion(c.group.quaternion).add(c.group.position);
        this.glows.push(p.x, p.y, p.z, col.r, col.g, col.b, 0.9 + 0.1 * Math.sin(t * 13 + e.x * 50), 0.075);
      }
    }

    for (const b of this.bolts) {
      if (!b.alive) continue;
      const tail = this.tmp.copy(b.p).addScaledVector(b.dir, -b.len);
      const fade = Math.min(1, b.life / 0.12);
      this.boltBatch.push(b.p.x, b.p.y, b.p.z, tail.x, tail.y, tail.z, LASER[b.faction], fade * (b.heavy ? 1.3 : 1), b.width, b.width * 0.7, 0.55);
    }

    for (const q of this.particles) {
      if (!q.alive) continue;
      const l = q.life / q.max;
      const a = q.flash ? l * l : Math.pow(l, 1.3);
      const size = q.size * (1 + q.grow * (1 - l));
      this.glows.push(q.p.x, q.p.y, q.p.z, q.color.r, q.color.g, q.color.b, a, size);
    }

    this.boltBatch.finish();
    this.trailBatch.finish();
    this.glows.finish();
  }
}

const WHITE_HOT = new THREE.Color(2.6, 2.3, 2.0);
const SPARK = new THREE.Color(2.8, 2.2, 1.4);
const FIRE = new THREE.Color(2.6, 1.05, 0.28);
const EMBER_HOT = new THREE.Color(2.8, 1.8, 0.6);
const EMBER = new THREE.Color(1.3, 0.32, 0.08);
const RING_BLUE = new THREE.Color(1.0, 1.6, 2.6);
const RING_EMBER = new THREE.Color(2.4, 1.3, 0.6);
const ARRIVE = new THREE.Color(1.6, 2.0, 2.8);
const LANCE_ENGINES = [new THREE.Vector3(-0.11, -0.01, -0.53), new THREE.Vector3(0.11, -0.01, -0.53)];
const CRESCENT_ENGINES = [new THREE.Vector3(0, 0, -0.36)];

/** squared distance from point p to the segment a–b */
function segmentDistanceSq(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, tmp: THREE.Vector3) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len = abx * abx + aby * aby + abz * abz;
  const t = len > 0 ? THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len, 0, 1) : 0;
  tmp.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
  return tmp.distanceToSquared(p);
}

const closest = new THREE.Vector3();
/** whether p lies within r of the segment a–b */
function segmentsClose(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number) {
  return segmentDistanceSq(p, a, b, closest) < r * r;
}
