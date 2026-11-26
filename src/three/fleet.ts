import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GlowPoints, StreakBatch } from "./fx";

// A space battle in the background, in the look of a "used future": two factions of fighters chase each other in
// tight loops, weaving and rolling, and shoot (red bolts for the patrol, green for the raiders); hits throw sparks, a
// ship with too many hits explodes and later jumps back in from hyperspace. Two large ships trade heavy fire further
// back. The designs are our own (built from simple solids, panels in mismatched shades, soot and markings).
// On the patrol's side flies the star squadron: one ship for every star the project has on GitHub, in V formations,
// marked in gold (see setStars).
//
// Everything lives in an "arena" that follows the camera's view (and grows with the camera's distance),
// so the battle stays on screen at the overview as well as close to a planet, and still passes behind
// the planets (it is drawn in the scene with depth).

/** 0: blue-green patrol, 1: ember raiders */
export type Faction = 0 | 1;
/** the kind of fighter: 0 patrol, 1 raider, 2 star squadron (on the patrol's side) */
type Kind = 0 | 1 | 2;

const FIGHTER_LEN = 0.075;
const CAPITAL_LEN = 0.62;
const BOLT_SPEED = 2.7;
const HEAVY_SPEED = 1.6;
const HIT_RADIUS = 0.03;
const TRAIL_POINTS = 12;

// (by kind: patrol, raider, star squadron) Red bolts for the patrol, green for the raiders, gold for the squadron;
// warm engines on the patrol's side, cold blue ones on the raiders'.
const LASER = [new THREE.Color(3.0, 0.3, 0.2), new THREE.Color(0.45, 3.0, 0.5), new THREE.Color(2.9, 2.2, 0.55)];
const TRAIL = [new THREE.Color(1.2, 0.55, 0.35), new THREE.Color(0.45, 0.7, 1.15), new THREE.Color(1.25, 0.95, 0.4)];
const ENGINE = [new THREE.Color(3.0, 1.35, 0.85), new THREE.Color(1.3, 1.9, 3.0), new THREE.Color(3.0, 2.3, 1.0)];
/** where the guns sit, by kind: sideways and forward of the centre (length 1) */
const GUNS: [number, number][] = [
  [0.47, 0.06],
  [0.41, 0.28],
  [0.44, 0.18],
];

// ---------- shapes (built from simple solids, length 1 along +z, nose forward) ----------
// The look of a "used future": hulls of panels that don't quite match, darker underneath and sooty toward the
// engines, faded markings, canopies of dark glass; the lights (engines, windows, edges) glow.

type Vec3 = [number, number, number];

const rgb = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const HALF_PI = Math.PI / 2;

/** the paint of each hull (sRGB) */
const PAINT = {
  patrol: new THREE.Color(0xc9c6bb),
  raider: new THREE.Color(0x4b4d55),
  star: new THREE.Color(0xe4dac6),
  carrier: new THREE.Color(0xaeaca4),
  cruiser: new THREE.Color(0x55575f),
};
/** faded markings: red stripes on the patrol, pale ones on the raiders */
const MARK = { patrol: new THREE.Color(0x9c4434), raider: new THREE.Color(0x9a988c) };
/** canopies of dark glass, and the dark metal of intakes, barrels and vents */
const GLASS = rgb(0.018, 0.024, 0.034);
const DARK = rgb(0.035, 0.035, 0.04);

class Shape {
  private hull: THREE.BufferGeometry[] = [];
  private glow: THREE.BufferGeometry[] = [];
  private shade = new THREE.Color();

  /** `paint`: the colour of the hull (every part gets a shade of its own); `seed`: how shades and details fall */
  constructor(
    private paint: THREE.Color,
    private seed: number,
  ) {}

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  /** A part of the hull, in a shade of the paint or in `tint`; with `glow`, a light instead. */
  add(g: THREE.BufferGeometry, at: Vec3, opts: { rot?: Vec3; scale?: Vec3; glow?: THREE.Color; tint?: THREE.Color } = {}) {
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
    const color = opts.glow ?? opts.tint ?? this.shade.copy(this.paint).multiplyScalar(0.8 + this.rand() * 0.32);
    const count = n.getAttribute("position").count;
    const c = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) c.set([color.r, color.g, color.b], i * 3);
    n.setAttribute("color", new THREE.BufferAttribute(c, 3));
    (opts.glow ? this.glow : this.hull).push(n);
    return this;
  }

  /** Small boxes on a hull of w × h between z0 and z1: surface detail. */
  greebles(count: number, w: number, h: number, z0: number, z1: number) {
    for (let i = 0; i < count; i++) {
      const side = Math.floor(this.rand() * 4);
      const z = z0 + (z1 - z0) * this.rand();
      const sx = 0.015 + this.rand() * 0.035;
      const sy = 0.008 + this.rand() * 0.02;
      const sz = 0.02 + this.rand() * 0.07;
      const u = (this.rand() - 0.5) * 0.8;
      if (side === 0) this.add(new THREE.BoxGeometry(sx, sy, sz), [u * w, h / 2 + sy / 2, z]);
      else if (side === 1) this.add(new THREE.BoxGeometry(sx, sy, sz), [u * w, -h / 2 - sy / 2, z]);
      else this.add(new THREE.BoxGeometry(sy, sx, sz), [(side === 2 ? 1 : -1) * (w / 2 + sy / 2), u * h, z]);
    }
    return this;
  }

  /** Thin plates over a hull of w × h, each a shade of its own: the patchwork of a ship patched up many times. */
  plates(count: number, w: number, h: number, z0: number, z1: number) {
    const t = 0.004;
    for (let i = 0; i < count; i++) {
      const side = Math.floor(this.rand() * 4);
      const face = side < 2 ? w : h;
      const across = (0.2 + this.rand() * 0.4) * face;
      const along = 0.04 + this.rand() * 0.12;
      const z = z0 + (z1 - z0) * this.rand();
      const u = (this.rand() - 0.5) * (face - across);
      if (side < 2) this.add(new THREE.BoxGeometry(across, t, along), [u, (side ? -1 : 1) * (h / 2 + t / 2), z]);
      else this.add(new THREE.BoxGeometry(t, across, along), [(side === 2 ? 1 : -1) * (w / 2 + t / 2), u, z]);
    }
    return this;
  }

  build(length: number) {
    const finish = (parts: THREE.BufferGeometry[], worn: boolean) => {
      const g = mergeGeometries(parts, false)!;
      parts.forEach((p) => p.dispose());
      if (worn) wear(g);
      g.scale(length, length, length);
      g.computeVertexNormals(); // (not indexed: flat facets)
      return g;
    };
    return { hull: finish(this.hull, true), glow: finish(this.glow, false) };
  }
}

/** Wear on a hull (length 1, nose at +z): soot toward the engines, grime, darker undersides. */
function wear(g: THREE.BufferGeometry) {
  const pos = g.getAttribute("position");
  const col = g.getAttribute("color");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const soot = THREE.MathUtils.smoothstep(-z, 0.18, 0.5);
    const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    const grime = h - Math.floor(h);
    const k = (1 - 0.4 * soot) * (0.8 + 0.24 * grime) * (y < -0.015 ? 0.82 : 1);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
}

/** Patrol fighter: a long nose, swept wings with cannons at the tips, two engines beside the body, red stripes. */
function lanceShape(length = FIGHTER_LEN) {
  const s = new Shape(PAINT.patrol, 11);
  const engine = rgb(3.0, 1.35, 0.85);
  s.add(new THREE.CylinderGeometry(0.016, 0.072, 0.6, 8), [0, 0, 0.21], { scale: [1, 1, 0.8], rot: [HALF_PI, 0, 0] });
  s.add(new THREE.BoxGeometry(0.15, 0.095, 0.42), [0, -0.005, -0.24]);
  s.add(new THREE.BoxGeometry(0.09, 0.035, 0.34), [0, 0.06, -0.2]);
  s.add(new THREE.CylinderGeometry(0.005, 0.005, 0.1, 4), [0, 0, 0.55], { rot: [HALF_PI, 0, 0], tint: DARK });
  s.add(new THREE.SphereGeometry(0.056, 10, 8), [0, 0.048, 0.05], { scale: [1, 0.72, 2.1], tint: GLASS });
  s.add(new THREE.BoxGeometry(0.008, 0.012, 0.2), [0, 0.087, 0.05]);
  s.add(new THREE.BoxGeometry(0.12, 0.012, 0.035), [0, 0.072, -0.05], { tint: MARK.patrol });
  for (const side of [-1, 1]) {
    s.add(new THREE.BoxGeometry(0.44, 0.02, 0.2), [side * 0.27, -0.008, -0.22], { rot: [0, side * 0.42, 0] });
    s.add(new THREE.BoxGeometry(0.16, 0.024, 0.045), [side * 0.355, -0.008, -0.257], { rot: [0, side * 0.42, 0], tint: MARK.patrol });
    s.add(new THREE.CylinderGeometry(0.009, 0.009, 0.36, 5), [side * 0.47, -0.008, -0.12], { rot: [HALF_PI, 0, 0] });
    s.add(new THREE.CylinderGeometry(0.017, 0.017, 0.09, 6), [side * 0.47, -0.008, -0.26], { rot: [HALF_PI, 0, 0], tint: DARK });
    s.add(new THREE.CylinderGeometry(0.047, 0.055, 0.34, 10), [side * 0.12, -0.018, -0.31], { rot: [HALF_PI, 0, 0] });
    s.add(new THREE.TorusGeometry(0.047, 0.01, 4, 12), [side * 0.12, -0.018, -0.14], { tint: DARK });
    s.add(new THREE.CylinderGeometry(0.039, 0.039, 0.02, 12), [side * 0.12, -0.018, -0.485], { rot: [HALF_PI, 0, 0], glow: engine });
  }
  s.add(new THREE.BoxGeometry(0.014, 0.085, 0.15), [0, -0.085, -0.34], { rot: [0.3, 0, 0] });
  s.greebles(10, 0.15, 0.095, -0.42, -0.06);
  return s.build(length);
}

/** Raider fighter: a faceted pod with a dark canopy, held inside a crescent blade of mismatched plates; cold engine. */
function crescentShape(length = FIGHTER_LEN) {
  const s = new Shape(PAINT.raider, 23);
  const engine = rgb(1.3, 1.9, 3.0);
  const arc = 3.5;
  const parts = 5;
  s.add(new THREE.IcosahedronGeometry(0.16, 0), [0, 0, 0.02], { scale: [1, 0.75, 1.9] });
  s.add(new THREE.SphereGeometry(0.075, 10, 8), [0, 0.03, 0.2], { scale: [1.15, 0.62, 1.1], tint: GLASS });
  s.add(new THREE.BoxGeometry(0.11, 0.008, 0.012), [0, 0.068, 0.24], { glow: rgb(0.45, 1.6, 0.85) });
  for (let k = 0; k < parts; k++) {
    const seg = new THREE.TorusGeometry(0.42, 0.04, 4, 5, arc / parts);
    seg.rotateZ(-HALF_PI - arc / 2 + (k * arc) / parts);
    seg.rotateX(HALF_PI);
    s.add(seg, [0, 0, 0], { scale: [1, 1, 0.45], tint: k === 1 || k === parts - 2 ? MARK.raider : undefined });
  }
  s.add(new THREE.BoxGeometry(0.03, 0.022, 0.16), [0, 0, -0.36]);
  for (const side of [-1, 1]) {
    s.add(new THREE.BoxGeometry(0.31, 0.018, 0.03), [side * 0.215, 0, -0.155], { rot: [0, side * 0.74, 0] });
    s.add(new THREE.BoxGeometry(0.06, 0.03, 0.07), [side * 0.3, 0, -0.23], { rot: [0, side * 0.74, 0], tint: DARK });
    s.add(new THREE.CylinderGeometry(0.011, 0.011, 0.22, 5), [side * 0.413, 0, 0.17], { rot: [HALF_PI, 0, 0] });
    s.add(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 6), [side * 0.413, 0, 0.07], { rot: [HALF_PI, 0, 0], tint: DARK });
  }
  s.add(new THREE.SphereGeometry(0.055, 10, 8), [0, 0, -0.31], { scale: [1, 0.7, 0.5], glow: engine });
  const edge = new THREE.TorusGeometry(0.39, 0.012, 3, 22, 3.3);
  edge.rotateZ(-HALF_PI - 1.65);
  edge.rotateX(HALF_PI);
  s.add(edge, [0, 0, 0], { glow: rgb(0.3, 1.5, 1.25) });
  s.greebles(8, 0.2, 0.12, -0.15, 0.12);
  return s.build(length);
}

/** Star squadron fighter: an arrowhead with forward-swept wings, gold leading edges and a gold spark on its back. */
function starShape(length = FIGHTER_LEN) {
  const s = new Shape(PAINT.star, 37);
  const gold = rgb(3.0, 2.15, 0.7);
  const engine = rgb(3.0, 2.4, 1.2);
  const sweep = 0.5;
  s.add(new THREE.CylinderGeometry(0.015, 0.078, 0.92, 6), [0, 0, 0.04], { scale: [1, 1, 0.72], rot: [HALF_PI, 0, 0] });
  s.add(new THREE.SphereGeometry(0.056, 8, 6), [0, 0.044, 0.1], { scale: [1, 0.7, 2.3], tint: GLASS });
  for (const side of [-1, 1]) {
    // (a wing swept forward: its tip lies ahead of its root)
    s.add(new THREE.BoxGeometry(0.46, 0.018, 0.13), [side * 0.24, -0.01, -0.12], { rot: [0, -side * sweep, 0] });
    s.add(new THREE.BoxGeometry(0.4, 0.022, 0.02), [side * 0.209, -0.006, -0.063], { rot: [0, -side * sweep, 0], glow: gold });
    s.add(new THREE.CylinderGeometry(0.008, 0.008, 0.24, 5), [side * 0.442, -0.01, 0.06], { rot: [HALF_PI, 0, 0] });
    s.add(new THREE.CylinderGeometry(0.042, 0.052, 0.3, 8), [side * 0.085, -0.012, -0.34], { rot: [HALF_PI, 0, 0] });
    s.add(new THREE.TorusGeometry(0.042, 0.009, 4, 12), [side * 0.085, -0.012, -0.19], { tint: DARK });
    s.add(new THREE.CylinderGeometry(0.038, 0.038, 0.02, 10), [side * 0.085, -0.012, -0.495], { rot: [HALF_PI, 0, 0], glow: engine });
  }
  s.add(new THREE.BoxGeometry(0.016, 0.1, 0.17), [0, 0.065, -0.33], { rot: [-0.35, 0, 0] });
  s.add(new THREE.BoxGeometry(0.15, 0.012, 0.026), [0, 0.058, -0.12], { glow: gold });
  s.add(new THREE.BoxGeometry(0.026, 0.012, 0.15), [0, 0.058, -0.12], { glow: gold });
  s.greebles(8, 0.11, 0.08, -0.38, -0.02);
  return s.build(length);
}

/** Patrol carrier: a long plated spine with a ring around its middle, a bridge tower, a hangar, five engines. */
function carrierShape() {
  const s = new Shape(PAINT.carrier, 53);
  const engine = rgb(3.0, 1.35, 0.85);
  const windows = rgb(1.25, 1.0, 0.65);
  s.add(new THREE.BoxGeometry(0.12, 0.1, 0.8), [0, 0, 0]);
  s.add(new THREE.ConeGeometry(0.085, 0.24, 4), [0, 0, 0.52], { rot: [HALF_PI, 0, 0] });
  for (let k = 0; k < 8; k++) {
    const seg = new THREE.TorusGeometry(0.17, 0.018, 6, 4, Math.PI / 4);
    seg.rotateZ((k * Math.PI) / 4);
    s.add(seg, [0, 0, 0.05], { tint: k % 4 === 1 ? MARK.patrol : undefined });
  }
  s.add(new THREE.BoxGeometry(0.34, 0.015, 0.02), [0, 0, 0.05]);
  s.add(new THREE.BoxGeometry(0.015, 0.34, 0.02), [0, 0, 0.05]);
  s.add(new THREE.BoxGeometry(0.24, 0.15, 0.16), [0, 0, -0.42]);
  s.add(new THREE.BoxGeometry(0.05, 0.08, 0.1), [0, 0.09, -0.25]);
  s.add(new THREE.BoxGeometry(0.12, 0.025, 0.05), [0, 0.135, -0.25]);
  s.add(new THREE.BoxGeometry(0.1, 0.004, 0.006), [0, 0.135, -0.2245], { glow: windows });
  s.add(new THREE.CylinderGeometry(0.032, 0.01, 0.012, 10), [0.045, 0.165, -0.27], { rot: [0.5, 0, 0.35] });
  s.add(new THREE.CylinderGeometry(0.002, 0.002, 0.09, 3), [-0.035, 0.19, -0.26], { tint: DARK });
  s.add(new THREE.SphereGeometry(0.022, 8, 6), [0, 0.055, 0.22], { scale: [1, 0.6, 1] });
  s.add(new THREE.SphereGeometry(0.022, 8, 6), [0, -0.055, 0.02], { scale: [1, 0.6, 1] });
  for (const side of [-1, 1]) {
    s.add(new THREE.BoxGeometry(0.05, 0.06, 0.35), [side * 0.085, -0.01, -0.05]);
    s.add(new THREE.BoxGeometry(0.003, 0.007, 0.55), [side * 0.0615, 0.022, 0.08], { glow: windows });
    s.add(new THREE.BoxGeometry(0.003, 0.007, 0.3), [side * 0.111, 0.0, -0.05], { glow: windows });
    s.add(new THREE.TorusGeometry(0.17, 0.007, 4, 28), [0, 0, 0.05 + side * 0.02], { glow: rgb(1.1, 0.55, 0.35) });
    s.add(new THREE.BoxGeometry(0.004, 0.035, 0.08), [side * 0.0615, -0.01, 0.25], { glow: rgb(1.5, 1.05, 0.6) });
  }
  for (const [x, y] of CARRIER_NOZZLES) {
    s.add(new THREE.CylinderGeometry(0.03, 0.034, 0.03, 10), [x, y, -0.51], { rot: [HALF_PI, 0, 0], tint: DARK });
    s.add(new THREE.CylinderGeometry(0.026, 0.026, 0.01, 10), [x, y, -0.528], { rot: [HALF_PI, 0, 0], glow: engine });
  }
  s.plates(46, 0.12, 0.1, -0.34, 0.4);
  s.greebles(30, 0.12, 0.1, -0.34, 0.38);
  return s.build(CAPITAL_LEN);
}

/** Raider cruiser: a block hull behind a wide front bar with turrets, a command tower, a bank of cold engines. */
function hammerShape() {
  const s = new Shape(PAINT.cruiser, 71);
  const engine = rgb(1.3, 1.9, 3.0);
  const windows = rgb(0.5, 1.3, 1.25);
  s.add(new THREE.BoxGeometry(0.16, 0.11, 0.7), [0, 0, -0.05]);
  s.add(new THREE.BoxGeometry(0.5, 0.07, 0.12), [0, 0, 0.36]);
  s.add(new THREE.BoxGeometry(0.12, 0.05, 0.4), [0, 0.075, -0.1]);
  s.add(new THREE.BoxGeometry(0.08, 0.04, 0.2), [0, 0.115, -0.2]);
  s.add(new THREE.BoxGeometry(0.06, 0.07, 0.07), [0, 0.165, -0.24]);
  s.add(new THREE.BoxGeometry(0.1, 0.02, 0.04), [0, 0.205, -0.24]);
  s.add(new THREE.BoxGeometry(0.085, 0.004, 0.004), [0, 0.205, -0.2185], { glow: windows });
  s.add(new THREE.BoxGeometry(0.4, 0.004, 0.003), [0, 0, 0.4215], { glow: rgb(0.5, 1.6, 1.1) });
  s.add(new THREE.BoxGeometry(0.1, 0.06, 0.008), [0, 0, -0.404], { tint: DARK });
  for (const side of [-1, 1]) {
    s.add(new THREE.BoxGeometry(0.08, 0.1, 0.16), [side * 0.25, 0, 0.36], { tint: side < 0 ? MARK.raider : undefined });
    s.add(new THREE.CylinderGeometry(0.04, 0.05, 0.3, 8), [side * 0.12, -0.02, -0.3], { rot: [HALF_PI, 0, 0] });
    s.add(new THREE.BoxGeometry(0.003, 0.006, 0.5), [side * 0.0815, 0.02, -0.05], { glow: windows });
    s.add(new THREE.BoxGeometry(0.003, 0.005, 0.3), [side * 0.0615, 0.075, -0.1], { glow: windows });
    s.add(new THREE.CylinderGeometry(0.018, 0.022, 0.016, 8), [side * 0.17, 0.043, 0.36]);
    s.add(new THREE.CylinderGeometry(0.003, 0.003, 0.05, 4), [side * 0.17, 0.05, 0.385], { rot: [HALF_PI, 0, 0], tint: DARK });
  }
  for (const [x, y] of CRUISER_NOZZLES) {
    if (Math.abs(x) < 0.1) s.add(new THREE.CylinderGeometry(0.034, 0.038, 0.06, 10), [x, y, -0.43], { rot: [HALF_PI, 0, 0], tint: DARK });
    s.add(new THREE.CylinderGeometry(0.032, 0.032, 0.02, 10), [x, y, -0.462], { rot: [HALF_PI, 0, 0], glow: engine });
  }
  s.plates(50, 0.16, 0.11, -0.36, 0.26);
  s.greebles(34, 0.16, 0.11, -0.36, 0.26);
  return s.build(CAPITAL_LEN);
}

/** the engine nozzles at the back of the two big ships (x, y; length 1) */
const CARRIER_NOZZLES: [number, number][] = [
  [-0.07, -0.035],
  [0.07, -0.035],
  [0, 0],
  [-0.07, 0.035],
  [0.07, 0.035],
];
const CRUISER_NOZZLES: [number, number][] = [
  [-0.12, -0.02],
  [0.12, -0.02],
  [-0.05, 0.022],
  [0.05, 0.022],
  [0, -0.03],
];

const hullMaterial = (kind: Kind) =>
  new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: kind === 1 ? 0.55 : 0.5, metalness: kind === 1 ? 0.42 : 0.3 });

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
  kind: Kind;
  /** its place in its kind's instanced mesh */
  slot: number;
  /** star squadron: which star on GitHub it stands for (1, 2, …); 0 for the others */
  star: number;
  /** star squadron: its place in the V formation, beside and behind the leader (left, up, forward) */
  offset: THREE.Vector3 | null;
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
  color: THREE.Color;
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
  /** the loops the star squadron flies on (a V formation of five ships per flight) */
  private starChains: Chain[] = [];
  /** how many star ships fit (more stars than that: the squadron is full) */
  readonly starCapacity: number;
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
    // (each chain: pursuers close on the tail of the one ahead, the factions taking turns)
    const chainDefs: { ships: Faction[]; center: Vec3; amp: Vec3; freq: Vec3; speed: number }[] = [
      { ships: [1, 0, 1, 0], center: [0.1, 0.15, -0.1], amp: [1.75, 0.55, 0.9], freq: [1, 2, 1], speed: 0.225 },
      { ships: [0, 1, 0], center: [-0.2, -0.1, 0.25], amp: [1.35, 0.75, 1.0], freq: [1, 1.5, 2], speed: -0.245 },
      { ships: [1, 0, 1, 0], center: [0.3, 0.25, -0.6], amp: [1.6, 0.6, 0.8], freq: [2, 1, 1.5], speed: 0.15 },
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
          kind: faction,
          slot: slots[faction]++,
          star: 0,
          offset: null,
          chain,
          lag: i * 0.075 + (i ? this.rand() * 0.015 : 0),
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
          rollWait: 2 + this.rand() * 4,
          wobble: new THREE.Vector3(this.rand() * 6.28, this.rand() * 6.28, this.rand() * 6.28),
          trail: new Float32Array(TRAIL_POINTS * 3),
          trailCount: 0,
          trailTimer: 0,
        });
      });
    }
    this.fighters.forEach((f) => (f.hp = this.newHp()));

    // The star squadron's loops: empty until stars come in (setStars).
    this.starCapacity = low ? 10 : 20;
    const starDefs: { center: Vec3; amp: Vec3; freq: Vec3; speed: number }[] = [
      { center: [-0.2, 0.34, 0.1], amp: [1.5, 0.42, 0.8], freq: [1, 2, 1], speed: 0.15 },
      { center: [0.25, -0.32, -0.35], amp: [1.4, 0.5, 0.85], freq: [1, 1, 2], speed: -0.14 },
    ];
    for (const def of starDefs) {
      const chain: Chain = {
        center: new THREE.Vector3(...def.center),
        amp: new THREE.Vector3(...def.amp),
        freq: new THREE.Vector3(...def.freq),
        phase: new THREE.Vector3(this.rand() * 6.28, this.rand() * 6.28, this.rand() * 6.28),
        speed: def.speed,
        s: this.rand() * 20,
      };
      this.chains.push(chain);
      this.starChains.push(chain);
    }

    const hullMaterials = [hullMaterial(0), hullMaterial(1), hullMaterial(2)];
    const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
    const fighterShapes = [lanceShape(), crescentShape(), starShape()];
    for (const kind of [0, 1, 2] as const) {
      const n = kind === 2 ? this.starCapacity : Math.max(1, slots[kind]);
      const hull = new THREE.InstancedMesh(fighterShapes[kind].hull, hullMaterials[kind], n);
      const glow = new THREE.InstancedMesh(fighterShapes[kind].glow, glowMaterial, n);
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
        engines: CARRIER_NOZZLES.map(([x, y]) => [x, y, -0.54] as Vec3),
      },
      {
        base: [2.05, -0.38, -2.7],
        yaw: -HALF_PI + 0.42,
        turrets: [[0, 0.14, -0.12], [0.17, 0.06, 0.4], [-0.17, 0.06, 0.4], [0, -0.07, 0.0]],
        engines: CRUISER_NOZZLES.map(([x, y]) => [x, y, -0.475] as Vec3),
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
        color: LASER[0],
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

    // (room for every fighter there can be, the star squadron at full strength included)
    const fighters = this.fighters.length + this.starCapacity;
    this.trailBatch = new StreakBatch(fighters * TRAIL_POINTS, { minPx: 1.2 });
    this.boltBatch = new StreakBatch(this.bolts.length + fighters, { core: 1.2, minPx: 1.6 });
    this.glows = new GlowPoints(this.particles.length + fighters * 2 + 12, { minPx: 2 });
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

  /**
   * The star squadron: one ship per star on GitHub (up to starCapacity). `arriving`: the new ones drop out of
   * hyperspace into their place (a star that just came in), otherwise they are simply there. Fewer stars than
   * ships: the last ones jump away.
   */
  setStars(count: number, arriving: boolean) {
    const want = Math.max(0, Math.min(this.starCapacity, Math.floor(count)));
    const squadron = this.fighters.filter((f) => f.kind === 2);
    for (let i = squadron.length; i < want; i++) this.fighters.push(this.starFighter(i, arriving));
    if (want < squadron.length) {
      const leaving = new Set(squadron.slice(want));
      for (const f of leaving) if (f.alive) this.spawnParticle(f.pos, this.pv.set(0, 0, 0), 0.3, 0.12, 1, 0, ARRIVE, 1.2, true);
      this.fighters = this.fighters.filter((f) => !leaving.has(f));
    }
  }

  /** Ship i of the star squadron: flights of five in a V, the flights spread over two loops. */
  private starFighter(i: number, arriving: boolean): Fighter {
    const flight = Math.floor(i / 5);
    const wing = i % 5;
    // (leader, then pairs further out and further back: left, up, forward in the leader's own frame)
    const side = wing === 0 ? 0 : wing % 2 ? 1 : -1;
    const row = Math.ceil(wing / 2);
    return {
      faction: 0,
      kind: 2,
      slot: i,
      star: i + 1,
      offset: new THREE.Vector3(side * row * 0.085, row * 0.012, -row * 0.075),
      chain: this.starChains[flight % this.starChains.length],
      lag: Math.floor(flight / this.starChains.length) * 0.55,
      alive: true,
      hp: this.newHp(),
      respawn: 0,
      arrive: arriving ? 0 : 1,
      pos: new THREE.Vector3(),
      fwd: new THREE.Vector3(0, 0, 1),
      left: new THREE.Vector3(1, 0, 0),
      quat: new THREE.Quaternion(),
      cooldown: this.rand(),
      shots: 4,
      pause: this.rand() * 1.5,
      side: 1,
      roll: 0,
      rollWait: 5 + this.rand() * 8,
      wobble: new THREE.Vector3(this.rand() * 6.28, this.rand() * 6.28, this.rand() * 6.28),
      trail: new Float32Array(TRAIL_POINTS * 3),
      trailCount: 0,
      trailTimer: 0,
    };
  }

  /** Slow motion while the pointer is on a ship (easier to click). */
  setSlowMotion(on: boolean) {
    this.slowTarget = on ? 1 : 0;
  }

  /**
   * The nearest ship under a screen point (CSS pixels), or null: its distance, and for the star squadron which star
   * it stands for. A ship counts when the point lies within its own outline, or at least `minPx` from its centre.
   */
  pickShip(
    camera: THREE.PerspectiveCamera,
    x: number,
    y: number,
    width: number,
    height: number,
    minPx: number,
  ): { distance: number; star: number } | null {
    if (!this.enabled || !this.placed) return null;
    this.group.updateMatrixWorld();
    const focal = height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const scale = this.group.scale.x;
    let best = Infinity;
    let star = 0;
    const test = (local: THREE.Vector3, radius: number, which: number) => {
      const p = this.pv.copy(local).applyMatrix4(this.group.matrixWorld);
      const dist = camera.position.distanceTo(p);
      p.project(camera);
      if (p.z < -1 || p.z > 1) return;
      const sx = (p.x * 0.5 + 0.5) * width;
      const sy = (-p.y * 0.5 + 0.5) * height;
      const r = ((radius * scale) / Math.max(dist, 1e-3)) * focal;
      if (Math.hypot(sx - x, sy - y) <= Math.max(r, minPx) && dist < best) {
        best = dist;
        star = which;
      }
    };
    for (const f of this.fighters) if (f.alive && f.arrive >= 1) test(f.pos, FIGHTER_LEN * 0.6, f.star);
    for (const c of this.capitals) test(c.group.position, CAPITAL_LEN * 0.42, 0);
    return best < Infinity ? { distance: best, star } : null;
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
    // (the star squadron keeps its place in the formation, in the frame of the leader's path)
    if (f.offset) f.pos.addScaledVector(left, f.offset.x).addScaledVector(up, f.offset.y).addScaledVector(fwd, f.offset.z);
    // Jinking: every ship weaves from side to side, banking with it, to spoil the aim of the one behind it
    // (the squadron less, it keeps formation).
    const jink = f.kind === 2 ? 0.35 : 1;
    const jx = t * (2.1 + w.x * 0.25) + w.y;
    const jy = t * (1.6 + w.z * 0.2) + w.x;
    f.pos.addScaledVector(left, Math.sin(jx) * 0.024 * jink).addScaledVector(up, Math.sin(jy) * 0.014 * jink);
    this.mat.makeBasis(left, up, fwd);
    f.quat.setFromRotationMatrix(this.mat);
    f.quat.multiply(this.q.setFromAxisAngle(this.tmp.set(0, 0, 1), -Math.cos(jx) * 0.45 * jink));

    // Now and then an evasive roll.
    f.rollWait -= dt;
    if (f.rollWait <= 0 && f.roll === 0) f.roll = 0.0001;
    if (f.roll > 0) {
      f.roll += dt / 0.75;
      if (f.roll >= 1) {
        f.roll = 0;
        f.rollWait = 2.5 + this.rand() * 4.5;
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
      .copy(ENGINE_POINT[f.kind])
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
    const [gx, gz] = GUNS[f.kind];
    const gun = this.tmp3.copy(f.left).multiplyScalar(f.side * gx * FIGHTER_LEN).addScaledVector(f.fwd, gz * FIGHTER_LEN).add(f.pos);
    f.side = -f.side;
    this.spawnBolt(gun, dir, f.faction, false, LASER[f.kind]);
    this.spawnParticle(gun, this.tmp.set(0, 0, 0), 0.07, 0.022, 0, 0, LASER[f.kind], 0.8, true);
    f.cooldown = 0.1 + this.rand() * 0.07;
    if (--f.shots <= 0) {
      f.shots = 3 + Math.floor(this.rand() * 6);
      f.pause = 0.35 + this.rand() * 1.0;
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

  private spawnBolt(from: THREE.Vector3, dir: THREE.Vector3, faction: Faction, heavy: boolean, color = LASER[faction]) {
    const b = this.bolts.find((x) => !x.alive);
    if (!b) return;
    b.alive = true;
    b.color = color;
    b.p.copy(from);
    b.prev.copy(from);
    b.dir.copy(dir);
    b.speed = heavy ? HEAVY_SPEED : BOLT_SPEED;
    b.life = heavy ? 4 : 0.55;
    b.len = heavy ? 0.3 : 0.11;
    b.width = heavy ? 0.02 : 0.0075;
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
      // (the star squadron a little larger: the visitors' ships should be easy to find)
      this.mat.compose(f.pos, f.quat, this.scale.setScalar(Math.max(grow, 0.001) * (f.kind === 2 ? 1.2 : 1)));
      const m = this.meshes[f.kind];
      m.hull.setMatrixAt(f.slot, this.mat);
      m.glow.setMatrixAt(f.slot, this.mat);

      // the jump back in: a bright line that shrinks into the ship
      if (f.arrive < 1) {
        const tail = this.tmp.copy(f.pos).addScaledVector(f.fwd, -0.8 * (1 - f.arrive));
        this.boltBatch.push(f.pos.x, f.pos.y, f.pos.z, tail.x, tail.y, tail.z, ARRIVE, 1 - f.arrive, 0.02, 0.004, 0.1);
      }

      // engines
      const flicker = 0.85 + 0.15 * Math.sin(t * 41 + f.slot * 3.1) * Math.sin(t * 27 + f.slot);
      const c = ENGINE[f.kind];
      for (const e of ENGINES[f.kind]) {
        const p = this.tmp.copy(e).multiplyScalar(FIGHTER_LEN).applyQuaternion(f.quat).add(f.pos);
        this.glows.push(p.x, p.y, p.z, c.r, c.g, c.b, flicker * grow, f.kind === 1 ? 0.04 : 0.028);
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
        this.trailBatch.push(px, py, pz, x, y, z, TRAIL[f.kind], 0.5 * a0 * grow, 0.013 * a0 + 0.002, 0.013 * a1 + 0.002, a1 / Math.max(a0, 1e-3));
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
      this.boltBatch.push(b.p.x, b.p.y, b.p.z, tail.x, tail.y, tail.z, b.color, fade * (b.heavy ? 1.3 : 1), b.width, b.width * 0.7, 0.55);
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
const STAR_ENGINES = [new THREE.Vector3(-0.085, -0.012, -0.53), new THREE.Vector3(0.085, -0.012, -0.53)];
/** (by kind) where the engines glow, and where the trail starts */
const ENGINES = [LANCE_ENGINES, CRESCENT_ENGINES, STAR_ENGINES];
const ENGINE_POINT = [new THREE.Vector3(0, -0.01, -0.5), new THREE.Vector3(0, 0, -0.33), new THREE.Vector3(0, -0.012, -0.5)];

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
