// Sternenschwarm: a small vertical space shooter, opened by clicking a ship in the background battle.
// You fly a patrol fighter; squadrons of raiders fly in, line up in formation, dive at you and shoot; every fifth
// wave their flagship comes down itself. The ships and colours are those of the battle behind the site. The field, the ships and the effects are drawn into a canvas (every sprite is painted once, in
// code); scores, banners and menus are HTML on top of it, in the look of the rest of the site.

export type SfxKind = "shot" | "hit" | "boom" | "bigboom" | "power" | "hurt" | "wave";

export interface GameAudio {
  sfx(kind: SfxKind): void;
}

export interface GameOptions {
  audio: GameAudio;
  reducedMotion: boolean;
  /** called after the game has removed itself */
  onClose: () => void;
}

export interface GameHandle {
  close(): void;
}

export function openGame(opts: GameOptions): GameHandle {
  const game = new Shooter(opts);
  return { close: () => game.close() };
}

// ---------- constants ----------

/** the playfield, in game units (scaled to fit the screen) */
const W = 540;
const H = 960;
const TAU = Math.PI * 2;
const BEST_KEY = "sternenschwarm-rekord";
const MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace';
const SHIELD_TIME = 8;
/** free room beside the field (CSS px) from which on the score panels sit beside it */
const SIDE_ROOM = 250;

type State = "title" | "play" | "pause" | "over";
/** the raiders: drone = fighter, crab = interceptor, beetle = bomber, queen = the flagship */
type Kind = "drone" | "crab" | "beetle" | "queen";
type PowerKind = "weapon" | "shield" | "life";
type Glow = "red" | "amber" | "fire" | "ice" | "white" | "yellow";

/** the screen in amber, like a targeting computer */
const HUD = "#ffb347";
/** the fireball of an explosion, and the colour of the hull fragments flying off */
const BLAST = "#ffb066";
const DEBRIS: Record<Kind | "player", string> = { drone: "#8f959f", crab: "#8f959f", beetle: "#6c727c", queen: "#8f959f", player: "#d9d3c5" };
const POWER_COLOR: Record<PowerKind, string> = { weapon: HUD, shield: "#8ec9ff", life: "#ff5a4a" };
/** where fires break out on the flagship when it is badly hit (from its centre) */
const FIRES: [number, number][] = [
  [-22, -38],
  [18, -8],
  [-58, 32],
  [28, -60],
  [62, 28],
];
/** where the engines glow at the back of each raider (x, y, size; the sprites face down) */
const ENGINE_SPOTS: Record<Kind, [number, number, number][]> = {
  drone: [[0, -21, 0.5]],
  crab: [
    [-3, -17, 0.38],
    [3, -17, 0.38],
  ],
  beetle: [
    [-11, -30, 0.5],
    [11, -30, 0.5],
    [0, -8.5, 0.3],
  ],
  queen: [
    [-22, -79, 0.6],
    [-11, -79, 0.6],
    [0, -79, 0.6],
    [11, -79, 0.6],
    [22, -79, 0.6],
    [-45, -78, 0.85],
    [45, -78, 0.85],
  ],
};
const STAR_TINTS = ["#ffffff", "#d6e4ff", "#ffe8cc", "#e0d2ff", "#c8f7ff"];
const ENEMY: Record<Exclude<Kind, "queen">, { hp: number; r: number; value: number }> = {
  drone: { hp: 1, r: 15, value: 100 },
  crab: { hp: 3, r: 18, value: 250 },
  beetle: { hp: 7, r: 23, value: 600 },
};

interface Vec {
  x: number;
  y: number;
}

interface Path {
  p: [Vec, Vec, Vec, Vec];
  t: number;
  dur: number;
}

interface Player {
  x: number;
  y: number;
  lives: number;
  level: number;
  shield: number;
  invuln: number;
  fire: number;
  alive: boolean;
  respawn: number;
}

interface Enemy {
  kind: Kind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  r: number;
  value: number;
  state: "enter" | "form" | "dive" | "return" | "boss";
  path: Path | null;
  row: number;
  col: number;
  flash: number;
  phase: number;
  shots: number;
  dead: boolean;
  attack: number;
  attackT: number;
  step: number;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  /** (drawn turned along its flight) */
  sprite: Sprite;
  dead: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  sprite: Sprite;
  drag: number;
}

interface Ring {
  x: number;
  y: number;
  max: number;
  life: number;
  dur: number;
  color: string;
  width: number;
}

interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  size: number;
  life: number;
  max: number;
  color: string;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  max: number;
}

interface PowerUp {
  x: number;
  y: number;
  kind: PowerKind;
  t: number;
  dead: boolean;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
}

interface Spawn {
  at: number;
  kind: Kind;
  row: number;
  col: number;
  path: [Vec, Vec, Vec, Vec];
}

interface Sprite {
  img: HTMLCanvasElement;
  w: number;
  h: number;
}

// ---------- small helpers ----------

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const thousands = (n: number) => Math.floor(n).toLocaleString("de-DE");

function bezier(p: [Vec, Vec, Vec, Vec], t: number, out: Vec) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  out.x = p[0].x * a + p[1].x * b + p[2].x * c + p[3].x * d;
  out.y = p[0].y * a + p[1].y * b + p[2].y * c + p[3].y * d;
  return out;
}

function readBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(score: number) {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    /* private mode */
  }
}

/** the score with its leading zeros dimmed */
function scoreHtml(n: number) {
  const s = String(Math.max(0, Math.floor(n))).padStart(7, "0");
  const first = s.search(/[1-9]/);
  const cut = first < 0 ? s.length - 1 : first;
  return `<span class="z">${s.slice(0, cut)}</span>${s.slice(cut)}`;
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

// ---------- sprites (painted once; enemies face down, the player up) ----------
// The ships look like the battle behind the site: you fly a patrol fighter (light hull, faded red bands, warm engines,
// red bolts), the enemies are raiders (grey hulls, pale markings, green visors, cold engines, green bolts). The hulls
// are matte paint with plates in other shades, grime and soot toward the engines.

function makeSprite(w: number, h: number, res: number, draw: (ctx: CanvasRenderingContext2D) => void): Sprite {
  const img = document.createElement("canvas");
  img.width = Math.max(1, Math.ceil(w * res));
  img.height = Math.max(1, Math.ceil(h * res));
  const ctx = img.getContext("2d")!;
  ctx.scale(res, res);
  ctx.translate(w / 2, h / 2);
  draw(ctx);
  return { img, w, h };
}

/** the same shape in plain white (the flash when hit) */
function whiteOf(s: Sprite): Sprite {
  const img = document.createElement("canvas");
  img.width = s.img.width;
  img.height = s.img.height;
  const ctx = img.getContext("2d")!;
  ctx.drawImage(s.img, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, img.width, img.height);
  return { img, w: s.w, h: s.h };
}

function glowDot(res: number, color: string) {
  return makeSprite(32, 32, res, (ctx) => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 16);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.18, color);
    g.addColorStop(0.5, color + "55");
    g.addColorStop(1, color + "00");
    ctx.fillStyle = g;
    ctx.fillRect(-16, -16, 32, 32);
  });
}

function smokeSprite(res: number) {
  return makeSprite(32, 32, res, (ctx) => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 16);
    g.addColorStop(0, "rgba(92,86,80,0.55)");
    g.addColorStop(0.6, "rgba(58,54,50,0.25)");
    g.addColorStop(1, "rgba(34,32,30,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-16, -16, 32, 32);
  });
}

/** the flame of a warm engine, pointing down */
function drawFlame(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, -20, 0, 22);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.2, "rgba(255,214,160,0.95)");
  g.addColorStop(0.55, "rgba(255,120,60,0.5)");
  g.addColorStop(1, "rgba(255,70,40,0)");
  ctx.shadowColor = "#ff7a3a";
  ctx.shadowBlur = 8;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-5.5, -20);
  ctx.quadraticCurveTo(-6.5, 2, 0, 22);
  ctx.quadraticCurveTo(6.5, 2, 5.5, -20);
  ctx.closePath();
  ctx.fill();
}

type Tone = { dark: string; mid: string; light: string; tint?: string };

/** Polished metal (barrels, turrets): dark edges, a bright band toward the light, a darker reflection band. */
function metal(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, t: Tone) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, t.dark);
  g.addColorStop(0.22, t.mid);
  g.addColorStop(0.38, t.light);
  g.addColorStop(0.44, "#ffffff");
  g.addColorStop(0.5, t.light);
  g.addColorStop(0.62, t.mid);
  g.addColorStop(0.75, t.dark);
  g.addColorStop(0.87, t.tint ?? t.mid);
  g.addColorStop(1, t.dark);
  return g;
}

/** Matte paint across a hull part: darker toward its edges, lightest a little toward the light, no shine. */
function paint(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, t: Tone) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, t.dark);
  g.addColorStop(0.26, t.mid);
  g.addColorStop(0.44, t.light);
  g.addColorStop(0.64, t.mid);
  g.addColorStop(0.88, t.tint ?? t.mid);
  g.addColorStop(1, t.dark);
  return g;
}

/** the patrol's light hull, the raiders' grey one and a darker grey for their engines and pods */
const PATROL: Tone = { dark: "#55504a", mid: "#b2ac9f", light: "#e7e1d3", tint: "#8a8478" };
const RAIDER: Tone = { dark: "#2a2e35", mid: "#747b85", light: "#c4cad2", tint: "#555c66" };
const RAIDER_DARK: Tone = { dark: "#16181d", mid: "#4a5059", light: "#959ca6", tint: "#3a4048" };
const GUNMETAL: Tone = { dark: "#0e1118", mid: "#3a4252", light: "#9aa4b5" };
/** faded markings: red bands on the patrol, pale ones on the raiders */
const RED_BAND = "#a8392a";
const PALE_BAND = "#cfccc2";
const OUTLINE = "rgba(10,9,8,0.92)";
const SEAM = "rgba(18,15,12,0.5)";

/** a closed path through points given for the right half (x ≥ 0, in order), mirrored for the left half */
function sym(ctx: CanvasRenderingContext2D, half: [number, number][]) {
  ctx.beginPath();
  half.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = half.length - 1; i >= 0; i--) ctx.lineTo(-half[i][0], half[i][1]);
  ctx.closePath();
}

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/** Straight lines from [x0, y0, x1, y1] lists. */
function lines(ctx: CanvasRenderingContext2D, segs: number[][], color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of segs) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
}

/**
 * Wear inside the current clip (box: x0, y0, x1, y1): plates in other shades, grime, and soot growing from
 * `clean` toward `soot` (y: toward the engines).
 */
function weather(ctx: CanvasRenderingContext2D, box: number[], clean: number, soot: number, seed: number) {
  const [x0, y0, x1, y1] = box;
  let s = seed * 7919 + 13;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const area = (x1 - x0) * (y1 - y0);
  for (let i = 0; i < Math.max(3, area / 70); i++) {
    const w = 2.5 + r() * 7;
    const h = 2.5 + r() * 8;
    ctx.fillStyle = r() < 0.5 ? `rgba(255,250,238,${(0.05 + r() * 0.08).toFixed(3)})` : `rgba(22,18,14,${(0.06 + r() * 0.1).toFixed(3)})`;
    ctx.fillRect(x0 + r() * (x1 - x0 - w), y0 + r() * (y1 - y0 - h), w, h);
  }
  for (let i = 0; i < area / 14; i++) {
    ctx.fillStyle = `rgba(28,22,16,${(0.1 + r() * 0.2).toFixed(3)})`;
    ctx.fillRect(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), 0.5 + r() * 1.3, 0.5 + r() * 1.3);
  }
  const g = ctx.createLinearGradient(0, clean, 0, soot);
  g.addColorStop(0, "rgba(14,11,8,0)");
  g.addColorStop(1, "rgba(14,11,8,0.6)");
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

/** A part of a hull: the path from `shape`, filled with `fill`, worn (see weather) and outlined. */
function part(
  ctx: CanvasRenderingContext2D,
  shape: () => void,
  fill: string | CanvasGradient,
  wear?: { box: number[]; clean: number; soot: number; seed: number },
) {
  shape();
  ctx.fillStyle = fill;
  ctx.fill();
  if (wear) {
    ctx.save();
    shape();
    ctx.clip();
    weather(ctx, wear.box, wear.clean, wear.soot, wear.seed);
    ctx.restore();
  }
  shape();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.9;
  ctx.stroke();
}

/** Fills the current clip's box with a band (markings painted over a part). */
function band(ctx: CanvasRenderingContext2D, shape: () => void, color: string, x: number, y: number, w: number, h: number) {
  ctx.save();
  shape();
  ctx.clip();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** dark glass: a canopy with a faint reflection along its top */
function glass(ctx: CanvasRenderingContext2D, shape: () => void, x0: number, y0: number, x1: number, y1: number) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, "#40525e");
  g.addColorStop(0.35, "#0d1820");
  g.addColorStop(1, "#03070b");
  shape();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(10,9,8,0.95)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

/** a small light that glows (visors, gun ports) */
function lamp(ctx: CanvasRenderingContext2D, color: string, draw: () => void, blur = 6) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  draw();
  ctx.restore();
}

/** a gun barrel pointing along y, from y0 to y1, with a dark muzzle at y1 */
function barrel(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, w = 2.2) {
  ctx.fillStyle = metal(ctx, x - w / 2, 0, x + w / 2, 0, GUNMETAL);
  ctx.fillRect(x - w / 2, Math.min(y0, y1), w, Math.abs(y1 - y0));
  ctx.fillStyle = "#121318";
  ctx.fillRect(x - w * 0.75, y1 - (y1 < y0 ? 0 : 3), w * 1.5, 3);
}

/**
 * The player: a patrol fighter seen from above, nose up. A long body with the cockpit in the middle, straight wings
 * with an engine nacelle at each tip, two cannons forward of the wings; faded red bands, warm engines.
 */
function drawPlayer(ctx: CanvasRenderingContext2D) {
  ctx.lineJoin = "round";
  for (const s of [-1, 1]) barrel(ctx, s * 13, -1, -26);
  // the wings
  for (const s of [-1, 1]) {
    const wing = () => poly(ctx, [[s * 4, -1], [s * 17, 3], [s * 17, 12], [s * 4, 11]]);
    part(ctx, wing, paint(ctx, 0, -1, 0, 12, PATROL), { box: [-18, -2, 18, 13], clean: 2, soot: 16, seed: 3 + s });
    band(ctx, wing, RED_BAND, s > 0 ? 12.5 : -15.5, -2, 3, 16);
    lines(ctx, [[s * 8, 0.3, s * 8, 11.2], [s * 4, 6, s * 12.5, 7]], SEAM, 0.6);
  }
  // the nacelles: a dark intake in front, a red band, the nozzle behind
  for (const s of [-1, 1]) {
    const x = s * 20;
    const nacelle = () => {
      rrect(ctx, x - 4.6, -13, 9.2, 35, 3.2);
    };
    part(ctx, nacelle, paint(ctx, x - 4.6, 0, x + 4.6, 0, PATROL), { box: [x - 5, -14, x + 5, 23], clean: 2, soot: 22, seed: 8 + s });
    band(ctx, nacelle, RED_BAND, x - 5, -3.5, 10, 4);
    lines(ctx, [[x - 4.6, -8, x + 4.6, -8], [x - 4.6, 6, x + 4.6, 6], [x - 4.6, 13, x + 4.6, 13]], SEAM, 0.6);
    ctx.fillStyle = "#101114";
    ctx.beginPath();
    ctx.ellipse(x, -12.2, 3.3, 1.4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#1a1b1f";
    ctx.fillRect(x - 3.6, 19.5, 7.2, 3.2);
    ctx.strokeStyle = "rgba(255,150,90,0.95)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, 22.5, 3, 0.9, 0, 0, TAU);
    ctx.stroke();
  }
  // the body: red band on the nose and behind the cockpit
  const body = () => sym(ctx, [[0, -31], [2.4, -24], [4.8, -10], [6, 6], [6, 22], [3.5, 25]]);
  part(ctx, body, paint(ctx, -6, 0, 6, 0, PATROL), { box: [-7, -32, 7, 26], clean: 4, soot: 26, seed: 11 });
  band(ctx, body, RED_BAND, -7, -21.5, 14, 3.2);
  band(ctx, body, RED_BAND, -7, 3, 14, 2.6);
  ctx.fillStyle = "#17181c";
  ctx.fillRect(-0.6, -34, 1.2, 4);
  // the rear deck: a darker plate, a vent, a small sensor dish
  ctx.fillStyle = "rgba(20,16,12,0.16)";
  ctx.fillRect(-4.2, 8.5, 8.4, 13.5);
  ctx.fillStyle = "#24252a";
  ctx.fillRect(-2.6, 16, 5.2, 3);
  lines(ctx, [[-2.6, 17, 2.6, 17], [-2.6, 18, 2.6, 18]], "rgba(120,114,104,0.6)", 0.4);
  ctx.fillStyle = paint(ctx, 1, 0, 5, 0, PATROL);
  ctx.beginPath();
  ctx.arc(2.6, 11.5, 1.8, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.5;
  ctx.stroke();
  lines(ctx, [[0, -17, 0, -15], [-4.6, -12, 4.6, -12], [-5.6, 8.5, 5.6, 8.5]], SEAM, 0.6);
  // the cockpit: dark glass in a frame
  const canopy = () => {
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.quadraticCurveTo(3.6, -10, 3.1, -1.5);
    ctx.quadraticCurveTo(0, 0.6, -3.1, -1.5);
    ctx.quadraticCurveTo(-3.6, -10, 0, -17);
  };
  glass(ctx, canopy, -3, -17, 3, 0);
  lines(ctx, [[0, -16.5, 0, -0.5], [-3.2, -7, 3.2, -7]], "rgba(190,182,166,0.85)", 0.7);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(-1.4, -11.5, 0.6, 2.6, 0.2, 0, TAU);
  ctx.fill();
}

/**
 * The fighter (a raider dart seen from above, nose down): wings swept back with a cannon at each tip, a ridge of a
 * fin along its back, a dark canopy with a green visor, one cold engine.
 */
function drawDrone(ctx: CanvasRenderingContext2D) {
  ctx.lineJoin = "round";
  for (const s of [-1, 1]) barrel(ctx, s * 16.6, -9, 6, 2);
  for (const s of [-1, 1]) {
    const wing = () => poly(ctx, [[s * 4, 4], [s * 17.8, -9.5], [s * 17.8, -15], [s * 5, -9]]);
    part(ctx, wing, paint(ctx, 0, 4, 0, -15, RAIDER), { box: [-18, -16, 18, 5], clean: 2, soot: -14, seed: 21 + s });
    band(ctx, wing, PALE_BAND, s > 0 ? 13 : -15.5, -16, 2.5, 20);
    ctx.fillStyle = "rgba(14,14,18,0.75)";
    ctx.fillRect(s > 0 ? 7 : -10, -7.5, 3, 4);
  }
  const body = () => sym(ctx, [[0, 21], [3.4, 10], [6.4, -6], [6, -15], [3.5, -18.5]]);
  part(ctx, body, paint(ctx, -6.4, 0, 6.4, 0, RAIDER), { box: [-7, -19, 7, 22], clean: 6, soot: -19, seed: 25 });
  // the fin, seen from above: a thin ridge along the back
  ctx.fillStyle = paint(ctx, -1.3, 0, 1.3, 0, RAIDER_DARK);
  ctx.fillRect(-1.3, -18, 2.6, 15);
  lines(ctx, [[-0.4, -17.5, -0.4, -3.5]], "rgba(220,226,234,0.45)", 0.5);
  lines(ctx, [[-5, -2, 5, -2], [-3.6, 9, 3.6, 9]], SEAM, 0.6);
  const canopy = () => poly(ctx, [[0, 14], [2.8, 7.5], [0, 0.5], [-2.8, 7.5]]);
  glass(ctx, canopy, -2, 1, 2, 14);
  lines(ctx, [[0, 0.8, 0, 13.6]], "rgba(150,158,170,0.55)", 0.5);
  lamp(ctx, "#7dff9a", () => ctx.fillRect(-2.2, 11.2, 4.4, 1.2));
  ctx.fillStyle = "#15171b";
  ctx.fillRect(-3.6, -20.5, 7.2, 3);
  ctx.strokeStyle = "rgba(150,205,255,0.95)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, -20.5, 3, 0.9, 0, 0, TAU);
  ctx.stroke();
}

/**
 * The interceptor (seen from above, nose down): a pod with a dark canopy between two sickle blades that curve
 * forward, a cannon at each blade tip, a pale band across each blade, two cold engines.
 */
function drawCrab(ctx: CanvasRenderingContext2D) {
  ctx.lineJoin = "round";
  for (const s of [-1, 1]) {
    ctx.fillStyle = "#25282e";
    ctx.fillRect(s > 0 ? 6 : -13, -6, 7, 5);
    barrel(ctx, s * 18, 17, 27, 2);
  }
  for (const s of [-1, 1]) {
    const blade = () => {
      ctx.beginPath();
      ctx.moveTo(s * 11, -10);
      ctx.quadraticCurveTo(s * 26, -11, s * 25, 4);
      ctx.quadraticCurveTo(s * 24, 15, s * 19.5, 22);
      ctx.lineTo(s * 16.5, 20);
      ctx.quadraticCurveTo(s * 18.5, 9, s * 15.5, 0);
      ctx.quadraticCurveTo(s * 13.5, -3.5, s * 10, -2.5);
      ctx.closePath();
    };
    part(ctx, blade, paint(ctx, s * 10, 0, s * 26, 0, RAIDER), { box: [s > 0 ? 9 : -27, -12, s > 0 ? 27 : -9, 23], clean: 10, soot: -12, seed: 31 + s });
    band(ctx, blade, PALE_BAND, s > 0 ? 9 : -27, 3, 18, 3.4);
    lines(ctx, [[s * 14, -8, s * 22, -6], [s * 17, 10, s * 23, 11]], SEAM, 0.6);
    ctx.fillStyle = "rgba(14,14,18,0.8)";
    ctx.fillRect(s > 0 ? 19 : -22, -5, 3, 5);
  }
  const pod = () => sym(ctx, [[0, 15], [5.2, 11.5], [8.2, 1], [7.2, -10], [4.2, -15.5]]);
  part(ctx, pod, paint(ctx, -8.2, 0, 8.2, 0, RAIDER), { box: [-9, -16, 9, 16], clean: 6, soot: -16, seed: 35 });
  lines(ctx, [[-7.6, -4, 7.6, -4], [0, -15, 0, -8]], SEAM, 0.6);
  const canopy = () => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      ctx.lineTo(Math.cos(a) * 4.6, 4.5 + Math.sin(a) * 4.6);
    }
    ctx.closePath();
  };
  glass(ctx, canopy, -3, 0, 3, 9);
  lamp(ctx, "#7dff9a", () => ctx.fillRect(-2.6, 9.6, 5.2, 1.2));
  for (const s of [-1, 1]) {
    ctx.fillStyle = "#15171b";
    ctx.fillRect(s * 3 - 2, -17.5, 4, 2.6);
  }
}

/**
 * The bomber (seen from above, nose down): two long hulls with bomb bays, joined by a broad wing and a cockpit
 * module in front with a twin gun; heavy plates, three cold engines.
 */
function drawBeetle(ctx: CanvasRenderingContext2D) {
  ctx.lineJoin = "round";
  for (const s of [-1, 1]) barrel(ctx, s * 2.2, 24, 31, 1.8);
  // the broad wing, reaching out past the hulls, with pale tips and a cannon under each
  for (const s of [-1, 1]) barrel(ctx, s * 21, -2, 12, 1.8);
  const wing = () => poly(ctx, [[-25, -9], [25, -9], [25, -3], [21, 7], [-21, 7], [-25, -3]]);
  part(ctx, wing, paint(ctx, 0, -9, 0, 7, RAIDER), { box: [-26, -10, 26, 8], clean: 8, soot: -9, seed: 41 });
  band(ctx, wing, PALE_BAND, -26, -10, 6, 18);
  band(ctx, wing, PALE_BAND, 20, -10, 6, 18);
  for (const s of [-1, 1]) {
    const x = s * 11;
    const hull = () => {
      rrect(ctx, x - 5.5, -28, 11, 48, 4.5);
    };
    part(ctx, hull, paint(ctx, x - 5.5, 0, x + 5.5, 0, RAIDER_DARK), { box: [x - 6, -29, x + 6, 21], clean: 6, soot: -29, seed: 43 + s });
    // the bomb bay
    ctx.fillStyle = "#14161a";
    ctx.fillRect(x - 3, -15, 6, 18);
    lines(ctx, [[x, -15, x, 3], [x - 3, -6, x + 3, -6]], "rgba(120,126,136,0.55)", 0.5);
    lines(ctx, [[x - 5.5, -21, x + 5.5, -21], [x - 5.5, 9, x + 5.5, 9], [x - 5.5, 15, x + 5.5, 15]], SEAM, 0.6);
    ctx.fillStyle = "#15171b";
    ctx.fillRect(x - 4, -30, 8, 3);
  }
  const module = () => sym(ctx, [[0, 27], [4.5, 23], [6.5, 12], [6, -2], [4, -7]]);
  part(ctx, module, paint(ctx, -6.5, 0, 6.5, 0, RAIDER), { box: [-7, -8, 7, 28], clean: 20, soot: -8, seed: 47 });
  lines(ctx, [[-6.4, 4, 6.4, 4], [0, -6, 0, 4]], SEAM, 0.6);
  const canopy = () => poly(ctx, [[-3.6, 13], [3.6, 13], [2.8, 21], [-2.8, 21]]);
  glass(ctx, canopy, -3, 13, 3, 21);
  lamp(ctx, "#7dff9a", () => ctx.fillRect(-2.6, 21.6, 5.2, 1.2));
  ctx.fillStyle = "#15171b";
  ctx.fillRect(-2.5, -9.5, 5, 2.6);
}

/**
 * The flagship (a raider cruiser seen from above, nose down): a long block hull behind a wide front bar with a gun
 * pod at each end, decks stepping up to a command tower, trenches with rows of cold windows, engines at the back.
 * (The big gun turret in the middle is drawn live, it follows the player.)
 */
function drawQueen(ctx: CanvasRenderingContext2D) {
  ctx.lineJoin = "round";
  const windows = (x: number, y0: number, y1: number, seed: number) => {
    let s = seed;
    ctx.fillStyle = "rgba(190,225,255,0.9)";
    for (let y = y0; y < y1; y += 3.4) {
      s = (s * 16807) % 2147483647;
      if (s % 5 === 0) continue;
      ctx.fillRect(x - 0.6, y, 1.2, 1.6);
    }
  };
  // the side engines, held out on struts
  for (const s of [-1, 1]) {
    ctx.fillStyle = "#23262c";
    ctx.fillRect(s > 0 ? 30 : -38, -56, 8, 10);
    ctx.fillRect(s > 0 ? 30 : -38, -34, 8, 8);
    const x = s * 45;
    const nacelle = () => {
      rrect(ctx, x - 9.5, -76, 19, 58, 6);
    };
    part(ctx, nacelle, paint(ctx, x - 9.5, 0, x + 9.5, 0, RAIDER_DARK), { box: [x - 10, -77, x + 10, -17], clean: -30, soot: -76, seed: 51 + s });
    lines(ctx, [[x - 9.5, -60, x + 9.5, -60], [x - 9.5, -44, x + 9.5, -44], [x - 9.5, -30, x + 9.5, -30]], SEAM, 0.8);
    ctx.fillStyle = "#121317";
    ctx.fillRect(x - 7, -79, 14, 4);
  }
  // the hull, with the engine block at the back
  const hull = () => sym(ctx, [[0, -72], [27, -72], [34, -62], [34, 20], [30, 24]]);
  part(ctx, hull, paint(ctx, -34, 0, 34, 0, RAIDER), { box: [-35, -73, 35, 25], clean: -10, soot: -72, seed: 57 });
  ctx.fillStyle = paint(ctx, -30, 0, 30, 0, RAIDER_DARK);
  ctx.fillRect(-30, -80, 60, 11);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.9;
  ctx.strokeRect(-30, -80, 60, 11);
  for (const x of [-22, -11, 0, 11, 22]) {
    ctx.fillStyle = "#101115";
    ctx.beginPath();
    ctx.arc(x, -80, 4.2, 0, Math.PI);
    ctx.fill();
  }
  // trenches with rows of windows along both sides
  for (const s of [-1, 1]) {
    ctx.fillStyle = "#14161a";
    ctx.fillRect(s > 0 ? 26 : -30, -60, 4, 76);
    lines(ctx, [[s * 25.5, -60, s * 25.5, 16], [s * 30.5, -60, s * 30.5, 16]], "rgba(200,206,214,0.35)", 0.6);
    windows(s * 28, -58, 14, 7 + s);
  }
  // decks stepping up to the command tower
  const deck = () => sym(ctx, [[0, -58], [21, -58], [23, -52], [23, 12], [19, 16]]);
  part(ctx, deck, paint(ctx, -23, 0, 23, 0, RAIDER), { box: [-24, -59, 24, 17], clean: 0, soot: -58, seed: 61 });
  const upper = () => poly(ctx, [[-14, -50], [14, -50], [14, -14], [-14, -14]]);
  part(ctx, upper, paint(ctx, -14, 0, 14, 0, RAIDER), { box: [-15, -51, 15, -13], clean: -20, soot: -50, seed: 63 });
  for (const s of [-1, 1]) windows(s * 18.5, -54, 10, 11 + s);
  const tower = () => poly(ctx, [[-13, -42], [13, -42], [13, -36], [9, -36], [9, -27], [-9, -27], [-9, -36], [-13, -36]]);
  part(ctx, tower, paint(ctx, -13, 0, 13, 0, RAIDER));
  lamp(ctx, "#bfe2ff", () => ctx.fillRect(-11, -40, 22, 1.4), 5);
  lines(ctx, [[-23, -20, 23, -20], [-23, 0, -14, 0], [14, 0, 23, 0], [0, -14, 0, -8]], SEAM, 0.8);
  // the front bar, the gun pods at its ends (one with a pale marking), turrets, the green strip along its edge
  const bar = () => poly(ctx, [[-88, 22], [88, 22], [88, 44], [81, 50], [-81, 50], [-88, 44]]);
  part(ctx, bar, paint(ctx, 0, 22, 0, 50, RAIDER), { box: [-89, 21, 89, 51], clean: 50, soot: 22, seed: 67 });
  lines(ctx, [[-60, 22, -60, 50], [-30, 22, -30, 50], [30, 22, 30, 50], [60, 22, 60, 50]], SEAM, 0.8);
  for (const s of [-1, 1]) {
    const x = s * 78;
    const pod = () => {
      rrect(ctx, x - 11, 2, 22, 44, 5);
    };
    part(ctx, pod, paint(ctx, x - 11, 0, x + 11, 0, s < 0 ? { ...RAIDER, mid: "#9c9a92", light: "#e2dfd6" } : RAIDER_DARK), {
      box: [x - 12, 1, x + 12, 47],
      clean: 46,
      soot: 2,
      seed: 71 + s,
    });
    lines(ctx, [[x - 11, 14, x + 11, 14], [x - 11, 34, x + 11, 34]], SEAM, 0.8);
    ctx.fillStyle = "#14161a";
    ctx.beginPath();
    ctx.arc(x, 22, 6, 0, TAU);
    ctx.fill();
    lamp(ctx, "#7dff9a", () => {
      ctx.beginPath();
      ctx.arc(x, 22, 2.4, 0, TAU);
      ctx.fill();
    }, 8);
    for (const tx of [s * 40, s * 58]) {
      barrel(ctx, tx - 1.6, 34, 47, 1.8);
      barrel(ctx, tx + 1.6, 34, 47, 1.8);
      ctx.fillStyle = metal(ctx, tx - 5.5, 0, tx + 5.5, 0, GUNMETAL);
      ctx.beginPath();
      ctx.arc(tx, 33, 5.5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
  lamp(ctx, "#8dffc0", () => ctx.fillRect(-70, 48.6, 140, 1.2), 6);
  // small blocks of machinery on the decks
  let seed = 97;
  const r = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 26; i++) {
    const x = (r() - 0.5) * 40;
    const y = -56 + r() * 66;
    if (Math.abs(x) < 15 && y > -50 && y < -14) continue;
    ctx.fillStyle = r() < 0.5 ? "rgba(26,28,33,0.7)" : "rgba(210,214,220,0.28)";
    ctx.fillRect(x, y, 2 + r() * 4, 2 + r() * 5);
  }
}

function drawPowerUp(ctx: CanvasRenderingContext2D, kind: PowerKind) {
  const color = POWER_COLOR[kind];
  const bg = ctx.createRadialGradient(0, -4, 2, 0, 0, 14);
  bg.addColorStop(0, "rgba(52,46,40,0.95)");
  bg.addColorStop(1, "rgba(14,12,10,0.95)");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, TAU);
  ctx.fill();
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (kind === "weapon") {
    for (const y of [2, -4]) {
      ctx.beginPath();
      ctx.moveTo(-6, y + 3);
      ctx.lineTo(0, y - 3);
      ctx.lineTo(6, y + 3);
      ctx.stroke();
    }
  } else if (kind === "shield") {
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(6, -4);
    ctx.quadraticCurveTo(6, 4, 0, 8);
    ctx.quadraticCurveTo(-6, 4, -6, -4);
    ctx.closePath();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.bezierCurveTo(-11, -1, -5, -10, 0, -4);
    ctx.bezierCurveTo(5, -10, 11, -1, 0, 7);
    ctx.fill();
  }
}

/** a blaster bolt, pointing up: a coloured glow around a white-hot core, brightest at the head */
function boltSprite(res: number, rgb: string, w: number, h: number) {
  // (room around it for the glow)
  return makeSprite(w + 26, h + 26, res, (ctx) => {
    ctx.shadowColor = `rgb(${rgb})`;
    ctx.shadowBlur = 12;
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(0.7, `rgba(${rgb},0.85)`);
    g.addColorStop(1, `rgba(${rgb},0.15)`);
    ctx.fillStyle = g;
    rrect(ctx, -w / 2, -h / 2, w, h, w / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    const c = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    c.addColorStop(0, "rgba(255,255,255,1)");
    c.addColorStop(0.75, "rgba(255,255,255,0.8)");
    c.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = c;
    rrect(ctx, -w / 4, -h / 2 + 1, w / 2, h * 0.85, w / 4);
    ctx.fill();
  });
}

/** a sharp, diamond-shaped bolt, pointing up (the bombers' spread shot: a shape of its own, not only a colour) */
function needleSprite(res: number, color: string) {
  return makeSprite(16, 34, res, (ctx) => {
    ctx.shadowColor = color;
    ctx.shadowBlur = 9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(4.5, 0);
    ctx.lineTo(0, 13);
    ctx.lineTo(-4.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(1.8, 0);
    ctx.lineTo(0, 9);
    ctx.lineTo(-1.8, 0);
    ctx.closePath();
    ctx.fill();
  });
}

/** a distant planet for the background (light and dark as 6-digit hex) */
function planetSprite(res: number, r: number, light: string, dark: string, ring: string | null) {
  const size = r * (ring ? 3.8 : 2.8);
  return makeSprite(size, size, res, (ctx) => {
    const tilt = -0.38;
    const ringArc = (from: number, to: number) => {
      ctx.save();
      ctx.rotate(tilt);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.75, r * 0.42, 0, from, to);
      ctx.restore();
      ctx.strokeStyle = ring!;
      ctx.lineWidth = r * 0.1;
      ctx.stroke();
    };
    if (ring) ringArc(Math.PI, TAU);
    const haze = ctx.createRadialGradient(0, 0, r * 0.9, 0, 0, r * 1.35);
    haze.addColorStop(0, light + "44");
    haze.addColorStop(1, light + "00");
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.35, 0, TAU);
    ctx.fill();
    const body = ctx.createRadialGradient(-r * 0.4, -r * 0.4, r * 0.1, 0, 0, r);
    body.addColorStop(0, light);
    body.addColorStop(1, dark);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.rotate(tilt * 0.6);
    for (let i = -4; i <= 4; i++) {
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.07)" : "rgba(0,0,20,0.14)";
      ctx.fillRect(-r * 1.3, i * r * 0.22, r * 2.6, r * 0.11);
    }
    ctx.restore();
    const night = ctx.createLinearGradient(-r, -r, r, r);
    night.addColorStop(0.42, "rgba(2,3,12,0)");
    night.addColorStop(1, "rgba(2,3,12,0.88)");
    ctx.fillStyle = night;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    if (ring) ringArc(0, Math.PI);
  });
}

class Sprites {
  readonly player: Sprite;
  readonly flame: Sprite;
  readonly enemy: Record<Kind, Sprite>;
  readonly white: Record<Kind, Sprite>;
  readonly power: Record<PowerKind, Sprite>;
  readonly bolt: Sprite;
  readonly boltHeavy: Sprite;
  readonly enemyBolt: Sprite;
  readonly enemyBoltHeavy: Sprite;
  readonly needle: Sprite;
  readonly smoke: Sprite;
  readonly glow: Record<Glow, Sprite>;

  constructor(readonly res: number) {
    this.player = makeSprite(64, 72, res, drawPlayer);
    this.flame = makeSprite(18, 46, res, drawFlame);
    this.enemy = {
      drone: makeSprite(44, 50, res, drawDrone),
      crab: makeSprite(60, 60, res, drawCrab),
      beetle: makeSprite(58, 70, res, drawBeetle),
      queen: makeSprite(220, 180, res, drawQueen),
    };
    this.white = {
      drone: whiteOf(this.enemy.drone),
      crab: whiteOf(this.enemy.crab),
      beetle: whiteOf(this.enemy.beetle),
      queen: whiteOf(this.enemy.queen),
    };
    this.power = {
      weapon: makeSprite(36, 36, res, (c) => drawPowerUp(c, "weapon")),
      shield: makeSprite(36, 36, res, (c) => drawPowerUp(c, "shield")),
      life: makeSprite(36, 36, res, (c) => drawPowerUp(c, "life")),
    };
    // (yours: long and thin, red; theirs: short and fat, green; the bombers' diamonds)
    this.bolt = boltSprite(res, "255,62,44", 5, 28);
    this.boltHeavy = boltSprite(res, "255,128,52", 8, 34);
    this.enemyBolt = boltSprite(res, "70,255,110", 7, 16);
    this.enemyBoltHeavy = boltSprite(res, "120,255,140", 9, 20);
    this.needle = needleSprite(res, "#8dff6a");
    this.smoke = smokeSprite(res);
    this.glow = {
      red: glowDot(res, "#ff4a3a"),
      amber: glowDot(res, "#ffb347"),
      fire: glowDot(res, "#ff8a2a"),
      ice: glowDot(res, "#8ec9ff"),
      white: glowDot(res, "#fff1dc"),
      yellow: glowDot(res, "#ffd84a"),
    };
  }
}

// ---------- the backdrop: the same sky as the site (Milky Way, a black hole), planets drifting by, moving stars ----------

/** Smooth 2D value noise with a few octaves (seeded), for the band's star clouds and dust lanes. */
function makeFbm(seed: number) {
  let s = seed;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = Float32Array.from({ length: 256 }, () => r());
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const X = xi & 255;
    const Y = yi & 255;
    const a = val[perm[perm[X] + Y]];
    const b = val[perm[perm[X + 1] + Y]];
    const c = val[perm[perm[X] + Y + 1]];
    const d = val[perm[perm[X + 1] + Y + 1]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x: number, y: number) => {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    for (let o = 0; o < 4; o++) {
      sum += amp * noise(x * f + o * 17.3, y * f - o * 9.1);
      f *= 2.03;
      amp *= 0.5;
    }
    return sum / 0.9375;
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * The Milky Way across the screen, painted once (in device pixels): a soft glow with star clouds and dark dust
 * lanes at a quarter of the resolution, then thousands of small stars at half of it, crowding where the clouds are.
 */
function paintMilkyWay(w: number, h: number) {
  const portrait = h > w;
  const angle = portrait ? -1.05 : -0.42;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const diag = Math.hypot(w, h);
  const fbm = makeFbm(7);
  const fbm2 = makeFbm(23);

  // 1) the glow, at a quarter of the resolution
  const qs = 6;
  const qw = Math.max(24, Math.ceil(w / qs));
  const qh = Math.max(24, Math.ceil(h / qs));
  const glow = document.createElement("canvas");
  glow.width = qw;
  glow.height = qh;
  const gctx = glow.getContext("2d")!;
  const img = gctx.createImageData(qw, qh);
  const density = new Float32Array(qw * qh);
  const bw = 0.06 * diag;
  const coreAlong = 0.2 * diag;
  for (let y = 0; y < qh; y++) {
    for (let x = 0; x < qw; x++) {
      const px = x * qs - w * 0.52;
      const py = y * qs - h * 0.5;
      const along = px * ca + py * sa;
      const across = -px * sa + py * ca;
      const u = (along / diag) * 7;
      const v = (across / diag) * 7;
      const profile = Math.exp(-((across / bw) ** 2));
      const thin = Math.exp(-((across / (0.45 * bw)) ** 2));
      const core = Math.exp(-(((along - coreAlong) / (0.3 * diag)) ** 2)) * Math.exp(-((across / (1.5 * bw)) ** 2));
      const clouds = fbm(u * 1.3, v * 2.6);
      const starlight = profile * (0.2 + 0.8 * smoothstep(0.35, 0.75, clouds)) + core * 0.75;
      const lanes = smoothstep(0.5, 0.7, fbm2(u * 2.4, v * 5)) * thin;
      const rift = Math.exp(-(((across - 0.12 * bw) / (0.22 * bw)) ** 2)) * smoothstep(0.42, 0.62, fbm2(u * 0.9 + 4, v * 0.9));
      const dust = Math.min(0.92, lanes * 0.85 + rift * 0.75);
      const light = starlight * (1 - dust);
      density[y * qw + x] = Math.min(1, light);
      const warm = Math.min(1, core * 1.4);
      const k = light * 32;
      const pink = smoothstep(0.7, 0.88, fbm(u * 2 + 9, v * 2 - 3)) * profile * (1 - dust) * 9;
      const base = 1 - y / qh;
      const i = (y * qw + x) * 4;
      img.data[i] = 1 + base * 2 + k * (0.72 + 0.28 * warm) + pink;
      img.data[i + 1] = 2 + base * 2 + k * 0.8 + pink * 0.18;
      img.data[i + 2] = 5 + base * 6 + k * (1 - 0.42 * warm) + pink * 0.35;
      img.data[i + 3] = 255;
    }
  }
  gctx.putImageData(img, 0, 0);

  // 2) the stars, at half of the resolution, on top of the glow
  const hw = Math.max(64, Math.ceil(w / 2));
  const hh = Math.max(64, Math.ceil(h / 2));
  const sky = document.createElement("canvas");
  sky.width = hw;
  sky.height = hh;
  const sctx = sky.getContext("2d")!;
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(glow, 0, 0, hw, hh);
  const data = sctx.getImageData(0, 0, hw, hh);
  const px = data.data;
  const add = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= hw || y >= hh) return;
    const i = (y * hw + x) * 4;
    px[i] = Math.min(255, px[i] + r);
    px[i + 1] = Math.min(255, px[i + 1] + g);
    px[i + 2] = Math.min(255, px[i + 2] + b);
  };
  const tints = [
    [0.8, 0.86, 1],
    [1, 1, 1],
    [1, 0.93, 0.82],
    [1, 0.82, 0.66],
  ];
  const count = Math.round((hw * hh) / 50);
  let seed = 99;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let n = 0, tries = 0; n < count && tries < count * 30; tries++) {
    const x = Math.floor(rnd() * hw);
    const y = Math.floor(rnd() * hh);
    const d = density[Math.min(qh - 1, Math.floor((y * 2) / qs)) * qw + Math.min(qw - 1, Math.floor((x * 2) / qs))];
    if (rnd() > 0.06 + d * 1.1) continue;
    n++;
    const t = tints[Math.floor(rnd() * tints.length)];
    const b = 14 + 200 * Math.pow(rnd(), 4.5);
    add(x, y, b * t[0], b * t[1], b * t[2]);
    if (b > 175) {
      // the brighter ones get a little cross of light
      const h2 = b * 0.35;
      add(x + 1, y, h2 * t[0], h2 * t[1], h2 * t[2]);
      add(x - 1, y, h2 * t[0], h2 * t[1], h2 * t[2]);
      add(x, y + 1, h2 * t[0], h2 * t[1], h2 * t[2]);
      add(x, y - 1, h2 * t[0], h2 * t[1], h2 * t[2]);
    }
  }
  sctx.putImageData(data, 0, 0);
  return sky;
}

/** The inclined accretion disk, its far half (behind the hole) or its near half (in front of it). */
function diskHalf(ctx: CanvasRenderingContext2D, r: number, half: "back" | "front") {
  ctx.save();
  ctx.beginPath();
  ctx.rect(-8 * r, half === "back" ? -2 * r : 0, 16 * r, 2 * r);
  ctx.clip();
  const g = ctx.createLinearGradient(-7 * r, 0, 7 * r, 0);
  g.addColorStop(0, "rgba(255,110,40,0)");
  g.addColorStop(0.18, "rgba(255,160,80,0.75)");
  g.addColorStop(0.42, "rgba(255,238,210,1)");
  g.addColorStop(0.6, "rgba(255,205,150,0.9)");
  g.addColorStop(0.82, "rgba(255,120,45,0.5)");
  g.addColorStop(1, "rgba(255,90,30,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, 7 * r, 1.15 * r, 0, 0, TAU);
  ctx.ellipse(0, 0, 2 * r, 0.33 * r, 0, 0, TAU);
  ctx.fill("evenodd");
  // fine streaks along the orbits
  ctx.lineWidth = r * 0.1;
  for (let i = 0; i < 9; i++) {
    const k = 2.25 + i * 0.52;
    ctx.strokeStyle = i % 2 ? "rgba(255,255,255,0.16)" : "rgba(110,36,8,0.22)";
    ctx.beginPath();
    ctx.ellipse(0, 0, k * r, k * 0.165 * r, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/** A black hole: shadow, photon ring, the inclined disk and its far side bent over the top (r: shadow radius, px). */
function paintBlackHole(r: number) {
  const c = document.createElement("canvas");
  c.width = Math.ceil(r * 17);
  c.height = Math.ceil(r * 8);
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  // (a flat glow along the disk, fading out well inside the picture, so it shows no edge)
  ctx.save();
  ctx.scale(1, 0.45);
  const halo = ctx.createRadialGradient(0, 0, r, 0, 0, r * 7.6);
  halo.addColorStop(0, "rgba(255,170,90,0.18)");
  halo.addColorStop(1, "rgba(255,120,40,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(-c.width / 2, -c.height, c.width, c.height * 2);
  ctx.restore();
  diskHalf(ctx, r, "back");
  // the far side of the disk, bent up over the shadow (and, fainter, under it)
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(255,170,80,0.9)";
  ctx.shadowBlur = r * 0.9;
  ctx.strokeStyle = "rgba(255,215,165,0.95)";
  ctx.lineWidth = r * 0.42;
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.04, r * 1.42, r * 1.34, 0, Math.PI * 1.03, Math.PI * 1.97);
  ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = r * 0.14;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.05, r * 1.24, r * 1.18, 0, Math.PI * 0.08, Math.PI * 0.92);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // the shadow and the photon ring
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.shadowColor = "#ffd9a0";
  ctx.shadowBlur = r * 0.5;
  ctx.strokeStyle = "rgba(255,228,195,0.95)";
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.06, 0, TAU);
  ctx.stroke();
  ctx.shadowBlur = 0;
  diskHalf(ctx, r, "front");
  return c;
}

class Backdrop {
  private sky: HTMLCanvasElement | null = null;
  private hole: HTMLCanvasElement | null = null;
  private holeAt = { x: 0, y: 0 };
  private vignette: CanvasGradient | null = null;
  private planets: Sprite[] = [];
  private planet = { i: 0, x: 0.12, y: 140, s: 1 };
  private stars = Array.from({ length: 120 }, () => ({
    x: Math.random(),
    y: Math.random(),
    z: Math.pow(Math.random(), 1.7),
    c: STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)],
    tw: Math.random() * TAU,
  }));
  private built = "";
  private timer = 0;
  /** 0 → 1: the painted sky fades in once it is ready */
  private fade = 0;
  private w = 1;
  private h = 1;
  private dpr = 1;

  /** `field`: where the playfield is (device pixels): the black hole goes beside it, or behind its top. */
  resize(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, field: { x: number; w: number }) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.75);
    this.vignette.addColorStop(0, "rgba(0,0,4,0)");
    this.vignette.addColorStop(1, "rgba(0,0,4,0.6)");
    const build = () => {
      const key = `${w}x${h}x${field.x}`;
      if (key === this.built) return;
      this.built = key;
      this.sky = paintMilkyWay(w, h);
      const side = field.x > 160 * dpr;
      const r = (side ? Math.min(22, field.x / dpr / 18) : 13) * dpr;
      this.hole = paintBlackHole(r);
      this.holeAt = side ? { x: field.x / 2, y: h * 0.7 } : { x: w * 0.76, y: h * 0.2 };
      this.planets = [
        planetSprite(dpr, 64, "#d3a6ff", "#2a1150", "rgba(225,200,255,0.4)"),
        planetSprite(dpr, 40, "#8fe8ff", "#0a3050", null),
        planetSprite(dpr, 88, "#ffc08a", "#3c1408", "rgba(255,215,180,0.32)"),
      ];
    };
    // (painting the sky takes a moment: the first time right after the first frames, then fading in;
    // while the window is being resized only at the end)
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(build, this.sky ? 220 : 40);
  }

  dispose() {
    window.clearTimeout(this.timer);
  }

  update(dt: number, warp: number) {
    if (this.sky) this.fade = Math.min(1, this.fade + dt * 1.6);
    const fast = 1 + warp * 12;
    for (const s of this.stars) {
      s.y += dt * 0.03 * (0.25 + s.z * 1.3) * fast;
      if (s.y > 1.02) {
        s.y -= 1.04;
        s.x = Math.random();
      }
    }
    const p = this.planet;
    const sprite = this.planets[p.i];
    p.y += dt * 9 * (1 + warp * 4) * this.dpr;
    if (sprite && p.y - sprite.h * this.dpr * p.s > this.h) {
      // the next one, beside the field where possible
      p.i = (p.i + 1) % this.planets.length;
      p.s = rand(0.7, 1.15);
      p.x = Math.random() < 0.5 ? rand(0.04, 0.22) : rand(0.78, 0.96);
      p.y = -this.planets[p.i].h * this.dpr * p.s;
    }
  }

  draw(ctx: CanvasRenderingContext2D, warp: number, t: number) {
    const { w, h, dpr } = this;
    ctx.fillStyle = "#020309";
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = this.fade;
    if (this.sky) ctx.drawImage(this.sky, 0, 0, w, h);
    if (this.hole) {
      const hw = this.hole.width;
      const hh = this.hole.height;
      ctx.globalAlpha = this.fade * (0.78 + 0.06 * Math.sin(t * 1.3));
      ctx.drawImage(this.hole, this.holeAt.x - hw / 2, this.holeAt.y - hh / 2);
      ctx.globalAlpha = 1;
    }
    const p = this.planet;
    const sprite = this.planets[p.i];
    if (sprite) {
      const sw = sprite.w * dpr * p.s;
      const sh = sprite.h * dpr * p.s;
      ctx.globalAlpha = 0.55;
      ctx.drawImage(sprite.img, p.x * w - sw / 2, p.y - sh / 2, sw, sh);
    }
    for (const s of this.stars) {
      const size = (0.6 + s.z * 1.6) * dpr;
      ctx.globalAlpha = (0.3 + s.z * 0.7) * (0.75 + 0.25 * Math.sin(t * 2 + s.tw));
      ctx.fillStyle = s.c;
      ctx.fillRect(s.x * w, s.y * h, size, size + warp * (14 + s.z * 110) * dpr);
    }
    ctx.globalAlpha = 1;
  }

  drawVignette(ctx: CanvasRenderingContext2D) {
    if (!this.vignette) return;
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, this.w, this.h);
  }
}

// ---------- the game ----------

class Shooter {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private status: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private banner: HTMLElement;
  private cards: { start: HTMLElement; paused: HTMLElement; over: HTMLElement };
  private hud: Record<string, HTMLElement>;
  private shown: Record<string, number | boolean> = {};
  private sprites!: Sprites;
  private backdrop = new Backdrop();
  private frameStroke: CanvasGradient | null = null;
  private raf = 0;
  private last = 0;
  private time = 0;
  private dpr = 1;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private state: State = "title";
  private best = readBest();
  private newBest = false;
  private overReady = false;
  private timers: number[] = [];

  // world
  private player: Player = { x: W / 2, y: H - 120, lives: 3, level: 1, shield: 0, invuln: 0, fire: 0, alive: true, respawn: 0 };
  private enemies: Enemy[] = [];
  private shots: Bullet[] = [];
  private bullets: Bullet[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private shards: Shard[] = [];
  private puffs: Puff[] = [];
  private powerUps: PowerUp[] = [];
  private floaters: Floater[] = [];
  private spawns: Spawn[] = [];
  private score = 0;
  private wave = 0;
  private waveTime = 0;
  private nextDive = 3;
  private formFire = 0;
  private clearTimer = -1;
  private bossesBeaten = 0;
  private bossLag = 1;
  private kills = 0;
  private fired = 0;
  private hits = 0;

  // looks
  private shake = 0;
  private warp = 0;
  private flash = 0;
  private hurt = 0;
  private muzzle = 0;
  private bank = 0;
  private prevX = W / 2;
  private grid = 0;

  // input
  private keys = new Set<string>();
  private pointer = { x: W / 2, y: H - 120, active: false, touch: false, lastX: 0, lastY: 0 };
  private tmp: Vec = { x: 0, y: 0 };
  private closed = false;

  constructor(private opts: GameOptions) {
    this.root = document.createElement("div");
    this.root.className = "game is-title";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", "Sternenschwarm – Minispiel");
    this.root.setAttribute("aria-describedby", "game-help");
    this.root.setAttribute("data-lenis-prevent", "");
    this.root.innerHTML = TEMPLATE;
    document.body.appendChild(this.root);
    const $ = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.canvas = $<HTMLCanvasElement>(".game-canvas");
    this.ctx = this.canvas.getContext("2d")!;
    this.status = $(".game-status");
    this.pauseBtn = $<HTMLButtonElement>(".game-pause");
    this.banner = $(".game-banner");
    this.cards = { start: $(".game-start"), paused: $(".game-paused"), over: $(".game-over") };
    this.hud = {};
    this.root.querySelectorAll<HTMLElement>("[data-hud]").forEach((el) => (this.hud[el.dataset.hud!] = el));

    this.root.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "start") this.start();
      else if (act === "resume") this.resume();
      else if (act === "pause") this.togglePause();
      else if (act === "close") this.close();
    });

    this.hud.titleBest.textContent = this.best ? `Rekord ${thousands(this.best)}` : "";
    this.resize();
    this.bind();
    this.setState("title");
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    requestAnimationFrame(() => this.root.classList.add("is-open"));
    if (import.meta.env.DEV) (window as unknown as { __sternenschwarm?: Shooter }).__sternenschwarm = this;
  }

  // ---------- lifecycle ----------

  close() {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    this.backdrop.dispose();
    this.timers.forEach((t) => window.clearTimeout(t));
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.root.classList.remove("is-open");
    window.setTimeout(() => this.root.remove(), this.opts.reducedMotion ? 0 : 320);
    if (import.meta.env.DEV) delete (window as unknown as { __sternenschwarm?: Shooter }).__sternenschwarm;
    this.opts.onClose();
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private bind() {
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibility);
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture?.(e.pointerId);
      const p = this.toGame(e.clientX, e.clientY);
      this.pointer.touch = e.pointerType !== "mouse";
      this.pointer.active = true;
      this.pointer.lastX = p.x;
      this.pointer.lastY = p.y;
      if (!this.pointer.touch) {
        this.pointer.x = p.x;
        this.pointer.y = p.y;
      }
    });
    c.addEventListener("pointermove", (e) => {
      const p = this.toGame(e.clientX, e.clientY);
      if (e.pointerType === "mouse") {
        this.pointer.touch = false;
        this.pointer.active = true;
        this.pointer.x = p.x;
        this.pointer.y = p.y;
      } else if (this.pointer.active && this.state === "play" && this.player.alive) {
        // fingers move the ship relative to where they went down, so the ship stays visible above them
        this.player.x = clamp(this.player.x + (p.x - this.pointer.lastX) * 1.25, 20, W - 20);
        this.player.y = clamp(this.player.y + (p.y - this.pointer.lastY) * 1.25, 90, H - 36);
        this.pointer.lastX = p.x;
        this.pointer.lastY = p.y;
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") this.pointer.active = false;
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") this.pointer.active = false;
    });
  }

  private onResize = () => this.resize();

  private onBlur = () => {
    this.keys.clear();
    if (this.state === "play") this.pause();
  };

  private onVisibility = () => {
    if (document.hidden && this.state === "play") this.pause();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (k === "Tab") {
      // keep the focus inside the dialog
      e.preventDefault();
      const items = [...this.root.querySelectorAll<HTMLButtonElement>("button")].filter((b) => !b.disabled && b.offsetParent !== null);
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
      return;
    }
    e.stopPropagation();
    const onButton = (e.target as HTMLElement).tagName === "BUTTON";
    if (k === " " || k === "Enter") {
      if (onButton) return;
      e.preventDefault();
      if (this.state === "title" || (this.state === "over" && this.overReady)) this.start();
      else if (this.state === "pause") this.resume();
      return;
    }
    if (k === "p" || k === "P") {
      this.togglePause();
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(k)) e.preventDefault();
    this.keys.add(k.toLowerCase());
    this.pointer.active = false;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private resize() {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.scale = Math.min(w / W, h / H);
    this.ox = (w - W * this.scale) / 2;
    this.oy = (h - H * this.scale) / 2;
    const s = this.root.style;
    s.setProperty("--fx", `${this.ox}px`);
    s.setProperty("--fy", `${this.oy}px`);
    s.setProperty("--fw", `${W * this.scale}px`);
    s.setProperty("--fh", `${H * this.scale}px`);
    this.root.classList.toggle("is-wide", this.ox >= SIDE_ROOM);
    // (the pause and close buttons sit over the field's top edge: the score makes room for them)
    this.root.classList.toggle("is-tight", this.oy < 64);
    const res = Math.max(1, Math.round(this.scale * this.dpr * 4) / 4);
    if (!this.sprites || this.sprites.res !== res) this.sprites = new Sprites(res);
    this.backdrop.resize(this.ctx, this.canvas.width, this.canvas.height, this.dpr, { x: Math.round(this.ox * this.dpr), w: Math.round(W * this.scale * this.dpr) });
    this.frameStroke = this.ctx.createLinearGradient(0, 0, W, H);
    this.frameStroke.addColorStop(0, "rgba(255,179,71,0.8)");
    this.frameStroke.addColorStop(0.5, "rgba(255,150,70,0.3)");
    this.frameStroke.addColorStop(1, "rgba(255,74,58,0.7)");
  }

  private toGame(cx: number, cy: number): Vec {
    const r = this.canvas.getBoundingClientRect();
    return { x: (cx - r.left - this.ox) / this.scale, y: (cy - r.top - this.oy) / this.scale };
  }

  private say(text: string) {
    this.status.textContent = text;
  }

  // ---------- states and menus ----------

  private setState(s: State) {
    this.state = s;
    for (const k of ["title", "play", "pause", "over"]) this.root.classList.toggle(`is-${k}`, k === s);
    this.canvas.classList.toggle("is-playing", s === "play");
    const card = s === "title" ? this.cards.start : s === "pause" ? this.cards.paused : s === "over" ? this.cards.over : null;
    for (const c of Object.values(this.cards)) {
      if (c === card) {
        c.hidden = false;
        requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add("is-on")));
      } else {
        c.classList.remove("is-on");
        c.hidden = true;
      }
    }
    const paused = s === "pause";
    this.pauseBtn.setAttribute("aria-label", paused ? "Weiter" : "Pause");
    this.pauseBtn.querySelector(".ib-icon")!.innerHTML = paused ? PLAY_ICON : PAUSE_ICON;
    if (s === "play") this.canvas.focus({ preventScroll: true });
    else if (s === "title") card?.querySelector<HTMLElement>(".gc-primary")?.focus({ preventScroll: true });
    else if (s === "pause") card?.querySelector<HTMLElement>(".gc-primary")?.focus({ preventScroll: true });
  }

  private start() {
    this.score = 0;
    this.wave = 0;
    this.newBest = false;
    this.kills = 0;
    this.fired = 0;
    this.hits = 0;
    this.player = { x: W / 2, y: H - 120, lives: 3, level: 1, shield: 0, invuln: 1.5, fire: 0, alive: true, respawn: 0 };
    this.prevX = W / 2;
    this.bank = 0;
    this.enemies = [];
    this.shots = [];
    this.bullets = [];
    this.powerUps = [];
    this.floaters = [];
    this.spawns = [];
    this.bossesBeaten = 0;
    this.bossLag = 1;
    this.setState("play");
    this.nextWave();
  }

  private pause() {
    if (this.state !== "play") return;
    this.setState("pause");
    this.say("Pause");
  }

  private resume() {
    if (this.state !== "pause") return;
    this.setState("play");
    this.last = performance.now();
  }

  private togglePause() {
    if (this.state === "play") this.pause();
    else if (this.state === "pause") this.resume();
  }

  private gameOver() {
    if (this.score > this.best) {
      this.best = this.score;
      this.newBest = true;
      saveBest(this.score);
    }
    const h = this.hud;
    h.finalScore.textContent = thousands(this.score);
    h.record.textContent = this.newBest ? "Neuer Rekord!" : `Rekord ${thousands(this.best)}`;
    h.record.classList.toggle("is-new", this.newBest);
    h.statWave.textContent = String(this.wave);
    h.statKills.textContent = String(this.kills);
    h.statAcc.textContent = this.fired ? `${Math.round((this.hits / this.fired) * 100)} %` : "–";
    h.titleBest.textContent = `Rekord ${thousands(this.best)}`;
    // (the buttons wait a moment, so a tap meant for the ship does not start a new round)
    this.overReady = false;
    const buttons = [...this.cards.over.querySelectorAll<HTMLButtonElement>("button")];
    buttons.forEach((b) => (b.disabled = true));
    this.setState("over");
    this.later(800, () => {
      this.overReady = true;
      buttons.forEach((b) => (b.disabled = false));
      buttons[0]?.focus({ preventScroll: true });
    });
    this.say(`Mission beendet. ${this.score} Punkte${this.newBest ? ", neuer Rekord" : ""}.`);
  }

  private showBanner(title: string, sub: string, boss = false) {
    const b = this.banner;
    b.querySelector(".gb-title")!.textContent = title;
    b.querySelector(".gb-sub")!.textContent = sub;
    b.classList.toggle("is-boss", boss);
    b.classList.remove("is-on", "is-static");
    void b.offsetWidth;
    if (this.opts.reducedMotion) {
      b.classList.add("is-static");
      this.later(1800, () => b.classList.remove("is-static"));
    } else {
      b.classList.add("is-on");
    }
  }

  // ---------- waves ----------

  private nextWave() {
    this.wave++;
    this.waveTime = 0;
    this.clearTimer = -1;
    this.nextDive = 3.2;
    this.warp = this.opts.reducedMotion ? 0 : 1;
    const boss = this.wave % 5 === 0;
    if (boss) this.showBanner("Flaggschiff", `Welle ${this.wave}`, true);
    else this.showBanner(`Welle ${this.wave}`, this.wave === 1 ? "Die Plünderer kommen" : "");
    this.say(boss ? `Welle ${this.wave}: das Flaggschiff` : `Welle ${this.wave}`);
    this.opts.audio.sfx("wave");
    this.spawns = [];
    if (boss) {
      const q = this.makeEnemy("queen", W / 2, -120);
      q.state = "boss";
      this.enemies.push(q);
      this.bossLag = 1;
      return;
    }
    const n = this.wave;
    const rows: { kind: Kind; count: number }[] = [
      { kind: "beetle", count: n >= 3 ? Math.min(n - 1, 6) : 0 },
      { kind: "crab", count: n >= 2 ? Math.min(2 + n, 8) : 0 },
      { kind: "crab", count: n >= 4 ? Math.min(n - 1, 8) : 0 },
      { kind: "drone", count: Math.min(5 + n, 8) },
      { kind: "drone", count: Math.min(3 + n, 8) },
    ];
    let at = 1.4;
    let side = Math.random() < 0.5 ? -1 : 1;
    // bottom rows first, each row flies in as one group from alternating sides
    for (let row = rows.length - 1; row >= 0; row--) {
      const { kind, count } = rows[row];
      if (!count) continue;
      const first = Math.floor((8 - count) / 2);
      const fromTop = Math.random() < 0.3;
      for (let i = 0; i < count; i++) {
        const col = first + i;
        const slot = this.slot(row, col, 0, 1);
        const start = fromTop ? { x: W / 2 + side * rand(40, 140), y: -40 } : { x: side < 0 ? -40 : W + 40, y: rand(80, 220) };
        const path: [Vec, Vec, Vec, Vec] = [
          start,
          { x: W / 2 - side * rand(60, 180), y: H * rand(0.48, 0.62) },
          { x: slot.x + side * rand(60, 140), y: H * rand(0.3, 0.42) },
          slot,
        ];
        this.spawns.push({ at: at + i * 0.16, kind, row, col, path });
      }
      at += count * 0.16 + 0.9;
      side = -side;
    }
  }

  /** where a place in the formation is right now (the formation sways and breathes) */
  private slot(row: number, col: number, t: number, breathe = 1 + 0.045 * Math.sin(t * 1.3)): Vec {
    const cx = W / 2 + Math.sin(t * 0.7) * 34;
    return { x: cx + (col - 3.5) * 54 * breathe, y: 150 + row * 50 * breathe };
  }

  private makeEnemy(kind: Kind, x: number, y: number): Enemy {
    const def = kind === "queen" ? { hp: 220 + this.bossesBeaten * 140, r: 70, value: 5000 } : ENEMY[kind];
    const hp = kind === "queen" ? def.hp : def.hp + Math.floor(this.wave / 6);
    return {
      kind,
      x,
      y,
      hp,
      maxHp: hp,
      r: def.r,
      value: def.value,
      state: "enter",
      path: null,
      row: 0,
      col: 0,
      flash: 0,
      phase: Math.random() * 10,
      shots: 0,
      dead: false,
      attack: 0,
      attackT: 2,
      step: 0,
    };
  }

  // ---------- the frame loop ----------

  private loop = (now: number) => {
    if (this.closed) return;
    const dt = clamp((now - this.last) / 1000, 0, 1 / 30);
    this.last = now;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    this.time += dt;
    const running = this.state !== "pause";
    this.warp = Math.max(0, this.warp - dt * 0.8);
    this.backdrop.update(running ? dt : 0, this.warp);
    if (running) this.grid += dt * (36 + this.warp * 420);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    this.shake = Math.max(0, this.shake - dt * 30);
    this.muzzle = Math.max(0, this.muzzle - dt);
    if (this.state === "play") this.updatePlay(dt);
    else if (running) this.updateEffects(dt);
    this.syncHud(dt);
  }

  private updatePlay(dt: number) {
    this.waveTime += dt;
    this.updatePlayer(dt);
    while (this.spawns.length && this.spawns[0].at <= this.waveTime) {
      const s = this.spawns.shift()!;
      const e = this.makeEnemy(s.kind, s.path[0].x, s.path[0].y);
      e.row = s.row;
      e.col = s.col;
      e.path = { p: s.path, t: 0, dur: 2.1 };
      this.enemies.push(e);
    }
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updatePowerUps(dt);
    this.updateEffects(dt);
    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= dt * 42;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);

    // wave cleared
    if (!this.spawns.length && !this.enemies.length && this.clearTimer < 0 && this.state === "play") {
      this.clearTimer = 1.6;
      const bonus = 300 * this.wave;
      this.score += bonus;
      this.showBanner("Welle geschafft", `+${thousands(bonus)} Bonus`);
    }
    if (this.clearTimer >= 0) {
      this.clearTimer -= dt;
      if (this.clearTimer < 0) this.nextWave();
    }
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    if (!p.alive) {
      p.respawn -= dt;
      if (p.respawn <= 0) {
        if (p.lives <= 0) {
          this.gameOver();
          return;
        }
        p.alive = true;
        p.x = W / 2;
        p.y = H - 120;
        p.invuln = 2.4;
        this.prevX = p.x;
      }
      return;
    }
    p.invuln = Math.max(0, p.invuln - dt);
    p.shield = Math.max(0, p.shield - dt);
    const k = this.keys;
    const dx = (k.has("arrowright") || k.has("d") ? 1 : 0) - (k.has("arrowleft") || k.has("a") ? 1 : 0);
    const dy = (k.has("arrowdown") || k.has("s") ? 1 : 0) - (k.has("arrowup") || k.has("w") ? 1 : 0);
    if (dx || dy) {
      const l = Math.hypot(dx, dy);
      p.x += (dx / l) * 460 * dt;
      p.y += (dy / l) * 460 * dt;
    } else if (this.pointer.active && !this.pointer.touch) {
      // the mouse: the ship follows the pointer, quickly but not instantly
      const f = 1 - Math.exp(-dt * 16);
      p.x += (this.pointer.x - p.x) * f;
      p.y += (this.pointer.y - p.y) * f;
    }
    p.x = clamp(p.x, 20, W - 20);
    p.y = clamp(p.y, 90, H - 36);
    // banking: the ship leans into sideways moves
    const vx = dt > 0 ? (p.x - this.prevX) / dt : 0;
    this.prevX = p.x;
    this.bank += (clamp(vx / 520, -1, 1) - this.bank) * (1 - Math.exp(-dt * 10));

    // exhaust from the two nacelles
    for (const x of [-20, 20]) {
      if (Math.random() < 0.65) {
        this.particles.push({
          x: p.x + x + rand(-1.5, 1.5),
          y: p.y + 27,
          vx: rand(-18, 18),
          vy: rand(150, 230),
          life: 0.22,
          max: 0.22,
          size: rand(5, 8),
          grow: -0.4,
          sprite: this.sprites.glow.fire,
          drag: 2,
        });
      }
    }

    // auto fire
    p.fire -= dt;
    if (p.fire <= 0) {
      p.fire = p.level >= 2 ? 0.095 : 0.12;
      const heavy = p.level >= 5;
      const sprite = heavy ? this.sprites.boltHeavy : this.sprites.bolt;
      const shoot = (x: number, y: number, angle: number) => {
        const speed = 980;
        this.shots.push({
          x: p.x + x,
          y: p.y + y,
          vx: Math.sin(angle) * speed,
          vy: -Math.cos(angle) * speed,
          r: heavy ? 6 : 4,
          dmg: heavy ? 2 : 1,
          sprite,
          dead: false,
        });
        this.fired++;
      };
      // (the twin cannons forward of the wings; with more fire power the nacelles fire too, fanning out)
      shoot(-13, -28, 0);
      shoot(13, -28, 0);
      if (p.level >= 3) {
        shoot(-20, -15, -0.12);
        shoot(20, -15, 0.12);
      }
      if (p.level >= 4) {
        shoot(-21, -13, -0.26);
        shoot(21, -13, 0.26);
      }
      this.muzzle = 0.05;
      this.opts.audio.sfx("shot");
    }
  }

  private updateEnemies(dt: number) {
    const t = this.waveTime;
    const p = this.player;
    const bulletSpeed = Math.min(190 + this.wave * 9, 330);

    // now and then one or two leave the formation and dive at the player
    this.nextDive -= dt;
    if (this.nextDive <= 0) {
      this.nextDive = Math.max(1.1, 3.4 - this.wave * 0.18) * rand(0.7, 1.3);
      const ready = this.enemies.filter((e) => e.state === "form");
      const count = Math.min(ready.length, this.wave >= 4 ? 2 : 1);
      for (let i = 0; i < count; i++) {
        const e = ready.splice(Math.floor(Math.random() * ready.length), 1)[0];
        e.state = "dive";
        e.shots = 0;
        const side = e.x < W / 2 ? 1 : -1;
        e.path = {
          p: [
            { x: e.x, y: e.y },
            { x: e.x - side * rand(40, 120), y: e.y - 70 },
            { x: p.x + rand(-60, 60), y: p.y - rand(80, 200) },
            { x: p.x + side * rand(60, 220), y: H + 60 },
          ],
          t: 0,
          dur: Math.max(1.7, 2.6 - this.wave * 0.07),
        };
      }
    }

    // the formation shoots too
    this.formFire -= dt;
    if (this.formFire <= 0) {
      this.formFire = Math.max(0.25, 1.3 - this.wave * 0.09) * rand(0.6, 1.4);
      const shooters = this.enemies.filter((e) => e.state === "form" && e.kind !== "drone");
      const e = shooters[Math.floor(Math.random() * shooters.length)] ?? this.enemies.find((x) => x.state === "form");
      if (e) this.enemyShoot(e, bulletSpeed);
    }

    for (const e of this.enemies) {
      e.flash = Math.max(0, e.flash - dt);
      if (e.kind === "queen") {
        this.updateQueen(e, dt, bulletSpeed);
        continue;
      }
      if (e.state === "enter" || e.state === "return" || e.state === "dive") {
        const path = e.path!;
        path.t += dt / path.dur;
        const k = Math.min(1, path.t);
        bezier(path.p, e.state === "dive" ? k : easeInOut(k), this.tmp);
        e.x = this.tmp.x;
        e.y = this.tmp.y;
        if (e.state === "dive") {
          if (Math.random() < 0.7) {
            this.particles.push({
              x: e.x + rand(-4, 4),
              y: e.y - 8,
              vx: 0,
              vy: -20,
              life: 0.35,
              max: 0.35,
              size: rand(10, 16),
              grow: -0.5,
              sprite: this.sprites.glow.ice,
              drag: 1,
            });
          }
          // aimed shots on the way down
          if ((e.shots === 0 && k > 0.2) || (e.shots === 1 && k > 0.42 && e.kind !== "drone")) {
            e.shots++;
            this.enemyShoot(e, bulletSpeed * 1.1);
          }
          if (k >= 1) {
            e.state = "return";
            const s = this.slot(e.row, e.col, t);
            e.path = { p: [{ x: s.x, y: -50 }, { x: s.x, y: 20 }, { x: s.x, y: s.y - 60 }, s], t: 0, dur: 1.3 };
            e.x = s.x;
            e.y = -50;
          }
        } else if (k >= 1) {
          e.state = "form";
        }
      } else if (e.state === "form") {
        const s = this.slot(e.row, e.col, t);
        const f = 1 - Math.exp(-dt * 6);
        e.x += (s.x - e.x) * f;
        e.y += (s.y - e.y) * f;
      }
      // touching the player
      if (p.alive && Math.hypot(e.x - p.x, e.y - p.y) < e.r + 12) {
        if (p.shield > 0) this.damage(e, 99);
        else if (p.invuln <= 0) {
          this.damage(e, 99);
          this.hurtPlayer();
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  private updateQueen(e: Enemy, dt: number, speed: number) {
    const p = this.player;
    // comes down, then sways at the top
    if (e.y < 200) e.y = Math.min(200, e.y + dt * 110);
    e.x = W / 2 + Math.sin(this.waveTime * 0.45) * 130;
    e.attackT -= dt;
    if (e.attackT > 0 || e.y < 200) return;
    const rage = e.hp < e.maxHp * 0.4 ? 1.35 : 1;
    switch (e.attack) {
      case 0: {
        // rings of heavy bolts
        const n = 18;
        const off = e.step * 0.17;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + off;
          this.bullets.push(this.enemyBolt(e.x, e.y + 20, Math.cos(a) * speed * 0.75, Math.sin(a) * speed * 0.75, this.sprites.enemyBoltHeavy, 6));
        }
        e.attackT = 0.42 / rage;
        break;
      }
      case 1: {
        // aimed fans of diamond bolts from the gun pods
        for (const s of [-1, 1]) {
          const ox = e.x + s * 78;
          const oy = e.y + 18;
          const base = Math.atan2(p.y - oy, p.x - ox);
          for (let i = -2; i <= 2; i++) {
            const a = base + i * 0.16;
            this.bullets.push(this.needle(ox, oy, Math.cos(a) * speed, Math.sin(a) * speed));
          }
        }
        e.attackT = 0.55 / rage;
        break;
      }
      case 2: {
        // a turning double spiral
        for (const s of [0, Math.PI]) {
          const a = e.step * 0.33 + s;
          this.bullets.push(this.enemyBolt(e.x, e.y + 10, Math.cos(a) * speed * 0.8, Math.abs(Math.sin(a)) * speed * 0.8 + 30, this.sprites.enemyBolt, 5));
        }
        e.attackT = 0.06 / rage;
        break;
      }
      default: {
        // launches fighters that dive at once
        for (let i = 0; i < 4; i++) {
          const d = this.makeEnemy("drone", e.x + (i - 1.5) * 40, e.y + 40);
          d.state = "dive";
          d.row = 4;
          d.col = 2 + i;
          d.path = {
            p: [{ x: d.x, y: d.y }, { x: d.x + (i - 1.5) * 90, y: d.y + 120 }, { x: p.x + rand(-80, 80), y: p.y - 140 }, { x: p.x + rand(-200, 200), y: H + 60 }],
            t: 0,
            dur: 2.2,
          };
          this.enemies.push(d);
        }
        e.attackT = 0.2;
        e.step = 99;
      }
    }
    e.step++;
    const steps = [5, 4, 30, 1][e.attack];
    if (e.step >= steps) {
      e.step = 0;
      e.attack = (e.attack + 1) % 4;
      e.attackT = 1.1 / rage;
    }
  }

  private enemyBolt(x: number, y: number, vx: number, vy: number, sprite: Sprite, r: number): Bullet {
    return { x, y, vx, vy, r, dmg: 1, sprite, dead: false };
  }

  private needle(x: number, y: number, vx: number, vy: number): Bullet {
    return { x, y, vx, vy, r: 5, dmg: 1, sprite: this.sprites.needle, dead: false };
  }

  private enemyShoot(e: Enemy, speed: number) {
    const p = this.player;
    const base = Math.atan2(p.y - e.y, p.x - e.x);
    if (e.kind === "beetle") {
      for (const d of [-0.22, 0, 0.22]) {
        const a = base + d;
        this.bullets.push(this.needle(e.x, e.y + 16, Math.cos(a) * speed, Math.sin(a) * speed));
      }
    } else {
      const a = base + rand(-0.08, 0.08);
      this.bullets.push(this.enemyBolt(e.x, e.y + 12, Math.cos(a) * speed, Math.sin(a) * speed, this.sprites.enemyBolt, 5));
    }
  }

  private updateBullets(dt: number) {
    const p = this.player;
    for (const b of this.shots) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -30 || b.x < -30 || b.x > W + 30) b.dead = true;
      if (b.dead) continue;
      for (const e of this.enemies) {
        if (e.dead || (e.kind === "queen" && e.y < 120)) continue;
        const hit = e.kind === "queen" ? ((b.x - e.x) / 88) ** 2 + ((b.y - e.y) / 64) ** 2 < 1 : Math.hypot(b.x - e.x, b.y - e.y) < e.r + b.r;
        if (hit) {
          b.dead = true;
          this.hits++;
          this.spark(b.x, b.y - 4, 4, this.sprites.glow.fire, 170);
          this.damage(e, b.dmg);
          break;
        }
      }
    }
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y > H + 30 || b.y < -60 || b.x < -30 || b.x > W + 30) b.dead = true;
      if (b.dead || !p.alive) continue;
      if (p.shield > 0 && Math.hypot(b.x - p.x, b.y - p.y) < 36) {
        b.dead = true;
        this.spark(b.x, b.y, 5, this.sprites.glow.ice, 130);
      } else if (p.invuln <= 0 && Math.hypot(b.x - p.x, b.y - p.y) < b.r + 5) {
        b.dead = true;
        this.hurtPlayer();
      }
    }
    this.shots = this.shots.filter((b) => !b.dead);
    this.bullets = this.bullets.filter((b) => !b.dead);
  }

  private damage(e: Enemy, dmg: number) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 0.07;
    if (e.hp > 0) {
      if (e.kind === "queen") this.opts.audio.sfx("hit");
      return;
    }
    e.dead = true;
    this.kills++;
    const value = e.value * (e.state === "dive" ? 2 : 1);
    this.score += value;
    this.floaters.push({ x: e.x, y: e.y - 10, text: `+${value}`, life: 0.9, max: 0.9 });
    if (e.kind === "queen") {
      this.bossesBeaten++;
      this.bigExplosion(e.x, e.y);
      this.drop(e.x - 30, e.y, "weapon");
      this.drop(e.x + 30, e.y, "shield");
      this.bullets = [];
      this.enemies.forEach((o) => {
        if (o !== e && !o.dead) this.damage(o, 99);
      });
      return;
    }
    this.explosion(e.x, e.y, e.kind);
    const chance = e.kind === "beetle" ? 0.3 : e.kind === "crab" ? 0.1 : 0.05;
    if (Math.random() < chance) {
      const k = Math.random();
      this.drop(e.x, e.y, k < 0.6 ? "weapon" : k < 0.85 || this.player.lives >= 5 ? "shield" : "life");
    }
  }

  private drop(x: number, y: number, kind: PowerKind) {
    this.powerUps.push({ x, y, kind, t: 0, dead: false });
  }

  private hurtPlayer() {
    const p = this.player;
    if (!p.alive) return;
    p.lives--;
    p.level = Math.max(1, p.level - 1);
    p.alive = false;
    p.respawn = 1.4;
    this.shake = this.opts.reducedMotion ? 0 : 14;
    this.hurt = 1;
    this.explosion(p.x, p.y, "player");
    this.opts.audio.sfx("hurt");
    this.bullets = this.bullets.filter((b) => Math.hypot(b.x - p.x, b.y - p.y) > 160);
    this.say(p.lives > 0 ? `Getroffen. Noch ${p.lives} Leben.` : "Getroffen.");
  }

  private updatePowerUps(dt: number) {
    const p = this.player;
    for (const u of this.powerUps) {
      u.t += dt;
      u.y += dt * 110;
      u.x += Math.sin(u.t * 3) * dt * 30;
      if (u.y > H + 30) u.dead = true;
      if (!u.dead && p.alive && Math.hypot(u.x - p.x, u.y - p.y) < 34) {
        u.dead = true;
        this.opts.audio.sfx("power");
        let text: string;
        if (u.kind === "weapon") {
          if (p.level < 5) p.level++;
          else this.score += 1000;
          text = p.level < 5 ? "Feuerkraft +" : "Feuerkraft max";
        } else if (u.kind === "shield") {
          p.shield = SHIELD_TIME;
          text = "Schild";
        } else {
          p.lives = Math.min(5, p.lives + 1);
          text = "+1 Leben";
        }
        this.floaters.push({ x: u.x, y: u.y - 14, text, life: 1.1, max: 1.1 });
        this.rings.push({ x: u.x, y: u.y, max: 46, life: 0.4, dur: 0.4, color: POWER_COLOR[u.kind], width: 3 });
        this.spark(u.x, u.y, 12, this.sprites.glow.white, 200);
      }
    }
    this.powerUps = this.powerUps.filter((u) => !u.dead);
  }

  // ---------- effects ----------

  private spark(x: number, y: number, n: number, sprite: Sprite, speed: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = rand(0.3, 1) * speed;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.2, 0.45), max: 0.45, size: rand(5, 10), grow: 0, sprite, drag: 3 });
    }
  }

  private explosion(x: number, y: number, kind: Kind | "player") {
    const g = this.sprites.glow;
    const main = g.fire;
    const big = kind === "player" || kind === "beetle";
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.22, max: 0.22, size: big ? 130 : 90, grow: 0.3, sprite: g.white, drag: 0 });
    this.rings.push({ x, y, max: big ? 96 : 62, life: 0.45, dur: 0.45, color: BLAST, width: big ? 4 : 3 });
    const n = big ? 40 : 24;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = rand(40, big ? 380 : 260);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: rand(0.35, 0.9),
        max: 0.9,
        size: rand(8, 20),
        grow: 0,
        sprite: i % 3 === 0 ? g.yellow : main,
        drag: 2.6,
      });
    }
    for (let i = 0; i < (big ? 12 : 7); i++) {
      const a = Math.random() * TAU;
      const v = rand(60, 220);
      this.shards.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        rot: Math.random() * TAU,
        spin: rand(-12, 12),
        size: rand(3, 6),
        life: rand(0.5, 0.9),
        max: 0.9,
        color: DEBRIS[kind],
      });
    }
    for (let i = 0; i < (big ? 6 : 3); i++) {
      this.puffs.push({ x: x + rand(-8, 8), y: y + rand(-8, 8), vx: rand(-20, 20), vy: rand(-30, 10), size: rand(22, 36), life: rand(0.7, 1.2), max: 1.2 });
    }
    this.opts.audio.sfx(kind === "player" ? "bigboom" : "boom");
    if (kind === "beetle") this.shake = Math.max(this.shake, this.opts.reducedMotion ? 0 : 5);
    if (kind === "player") this.flash = Math.max(this.flash, 0.5);
  }

  private bigExplosion(x: number, y: number) {
    this.shake = this.opts.reducedMotion ? 0 : 24;
    this.flash = 1;
    this.opts.audio.sfx("bigboom");
    for (let k = 0; k < 7; k++) {
      const ex = x + rand(-80, 80);
      const ey = y + rand(-50, 50);
      this.particles.push({ x: ex, y: ey, vx: 0, vy: 0, life: 0.4 + k * 0.08, max: 0.4 + k * 0.08, size: rand(110, 190), grow: 0.4, sprite: this.sprites.glow.white, drag: 0 });
      this.rings.push({ x: ex, y: ey, max: rand(90, 160), life: 0.5 + k * 0.06, dur: 0.5 + k * 0.06, color: k % 2 ? "#ffd9a0" : BLAST, width: 4 });
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * TAU;
        const v = rand(60, 420);
        this.particles.push({
          x: ex,
          y: ey,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          life: rand(0.5, 1.4),
          max: 1.4,
          size: rand(10, 26),
          grow: 0,
          sprite: i % 2 ? this.sprites.glow.yellow : this.sprites.glow.fire,
          drag: 1.8,
        });
      }
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * TAU;
        const v = rand(80, 300);
        this.shards.push({ x: ex, y: ey, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: 0, spin: rand(-10, 10), size: rand(4, 9), life: rand(0.8, 1.3), max: 1.3, color: DEBRIS.queen });
      }
    }
  }

  private updateEffects(dt: number) {
    for (const q of this.particles) {
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      const d = Math.exp(-q.drag * dt);
      q.vx *= d;
      q.vy *= d;
    }
    this.particles = this.particles.filter((q) => q.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const s of this.shards) {
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= Math.exp(-1.5 * dt);
      s.vy *= Math.exp(-1.5 * dt);
      s.rot += s.spin * dt;
    }
    this.shards = this.shards.filter((s) => s.life > 0);
    for (const f of this.puffs) {
      f.life -= dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    this.puffs = this.puffs.filter((f) => f.life > 0);
  }

  // ---------- the HTML on top: scores, the flagship's health ----------

  private syncHud(dt: number) {
    const h = this.hud;
    const p = this.player;
    const was = this.shown;
    const best = Math.max(this.best, this.score);
    if (was.score !== this.score) h.score.innerHTML = scoreHtml((was.score = this.score));
    if (was.best !== best) h.best.textContent = thousands((was.best = best));
    if (was.wave !== this.wave) h.wave.textContent = String((was.wave = this.wave));
    if (was.lives !== p.lives) h.lives.innerHTML = LIFE_ICON.repeat(Math.max(0, (was.lives = p.lives)));
    if (was.level !== p.level) {
      was.level = p.level;
      [...h.power.children].forEach((el, i) => el.classList.toggle("on", i < p.level));
    }
    const shield = p.shield > 0 && p.alive;
    if (was.shield !== shield) h.shieldWrap.hidden = !(was.shield = shield);
    if (shield) h.shield.style.transform = `scaleX(${(p.shield / SHIELD_TIME).toFixed(3)})`;
    const q = this.state === "title" ? undefined : this.enemies.find((e) => e.kind === "queen" && !e.dead);
    if (was.boss !== !!q) h.boss.classList.toggle("is-on", (was.boss = !!q));
    if (q) {
      const f = Math.max(0, q.hp) / q.maxHp;
      this.bossLag = this.bossLag > f ? this.bossLag + (f - this.bossLag) * (1 - Math.exp(-dt * 2.5)) : f;
      h.bossFill.style.transform = `scaleX(${f.toFixed(4)})`;
      h.bossLag.style.transform = `scaleX(${this.bossLag.toFixed(4)})`;
      const pct = Math.ceil(f * 100);
      if (was.bossPct !== pct) h.bossPct.textContent = `${(was.bossPct = pct)} %`;
    }
  }

  // ---------- drawing ----------

  private draw() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    this.backdrop.draw(ctx, this.warp, this.time);

    // beside the field it is darker, so the field stands out
    const fx = Math.round(this.ox * dpr);
    const fw = Math.round(W * this.scale * dpr);
    if (fx > 2) {
      ctx.fillStyle = "rgba(2,3,10,0.12)";
      ctx.fillRect(0, 0, fx, ch);
      ctx.fillRect(fx + fw, 0, cw - fx - fw, ch);
    }

    const s = this.shake;
    const sx = s ? rand(-s, s) : 0;
    const sy = s ? rand(-s, s) : 0;
    const k = this.scale * dpr;
    ctx.setTransform(k, 0, 0, k, (this.ox + sx) * dpr, (this.oy + sy) * dpr);
    ctx.save();
    rrect(ctx, 0, 0, W, H, 22);
    ctx.clip();
    this.drawGrid(ctx);
    if (this.state === "title") this.drawTitleScene(ctx);
    else this.drawWorld(ctx);
    ctx.restore();
    this.drawFrame(ctx);

    // whole screen: hit and flash, then the vignette
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.hurt > 0) {
      const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.3, cw / 2, ch / 2, Math.max(cw, ch) * 0.7);
      g.addColorStop(0, "rgba(255,40,80,0)");
      g.addColorStop(1, `rgba(255,40,80,${(this.hurt * 0.4).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
    }
    if (this.flash > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(255,238,215,${(this.flash * 0.35).toFixed(3)})`;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = "source-over";
    }
    this.backdrop.drawVignette(ctx);
  }

  private put(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, scale = 1) {
    const w = s.w * scale;
    const h = s.h * scale;
    ctx.drawImage(s.img, x - w / 2, y - h / 2, w, h);
  }

  /** a faint grid drifting down: the feeling of flying forward */
  private drawGrid(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "rgba(4,6,18,0.52)";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,179,71,0.045)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const off = this.grid % 60;
    for (let y = off - 60; y < H; y += 60) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    for (let x = 30; x < W; x += 60) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    ctx.stroke();
  }

  /** the field's edge: a glowing line and corner marks */
  private drawFrame(ctx: CanvasRenderingContext2D) {
    if (this.frameStroke) {
      ctx.strokeStyle = this.frameStroke;
      ctx.globalAlpha = 0.14;
      ctx.lineWidth = 7;
      rrect(ctx, 0, 0, W, H, 22);
      ctx.stroke();
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = HUD;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    const L = 30;
    const m = 9;
    ctx.beginPath();
    for (const [x, y, dx, dy] of [
      [m, m, 1, 1],
      [W - m, m, -1, 1],
      [m, H - m, 1, -1],
      [W - m, H - m, -1, -1],
    ]) {
      ctx.moveTo(x, y + dy * L);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dx * L, y);
    }
    ctx.stroke();
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, t: number, x = e.x, y = e.y) {
    ctx.save();
    ctx.translate(x, y);
    // (banking through the turns of a dive)
    if (e.state === "dive" || e.state === "enter") ctx.rotate(Math.sin(t * 5 + e.phase) * 0.25);
    // the cold engines glow at the back
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 31 + e.phase * 7);
    for (const [ex, ey, s] of ENGINE_SPOTS[e.kind]) this.put(ctx, this.sprites.glow.ice, ex, ey, s);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    this.put(ctx, this.sprites.enemy[e.kind], 0, 0);
    if (e.flash > 0) {
      // (the flagship takes hits all the time: only a light flash, or it would look white)
      ctx.globalAlpha = e.kind === "queen" ? 0.28 : 0.85;
      this.put(ctx, this.sprites.white[e.kind], 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (e.kind === "queen") this.drawTurret(ctx, e);
    else if (e.hp < e.maxHp && e.maxHp > 1) {
      // tougher ones show their health
      const w = 26;
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(x - w / 2, y + e.r + 8, w, 3);
      ctx.fillStyle = HUD;
      ctx.fillRect(x - w / 2, y + e.r + 8, (w * Math.max(0, e.hp)) / e.maxHp, 3);
    }
  }

  /** The flagship's big gun turret, turning after the player; badly hit, fires break out on the hull. */
  private drawTurret(ctx: CanvasRenderingContext2D, e: Enemy) {
    const p = this.player;
    const t = this.time;
    const cx = e.x;
    const cy = e.y + 4;
    const a = Math.atan2(p.y - cy, p.x - cx);
    const hurt = e.hp < e.maxHp * 0.4;
    ctx.save();
    if (hurt) {
      ctx.globalCompositeOperation = "lighter";
      FIRES.forEach(([fx, fy], i) => {
        ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(t * (7 + i * 1.7) + i));
        this.put(ctx, this.sprites.glow.fire, e.x + fx, e.y + fy, 0.7 + 0.25 * Math.sin(t * 11 + i * 2));
      });
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.translate(cx, cy);
    ctx.fillStyle = "#17191e";
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, TAU);
    ctx.fill();
    ctx.rotate(a - Math.PI / 2);
    for (const s of [-1, 1]) {
      ctx.fillStyle = metal(ctx, s * 3.4 - 1.6, 0, s * 3.4 + 1.6, 0, GUNMETAL);
      ctx.fillRect(s * 3.4 - 1.6, 4, 3.2, 21);
      ctx.fillStyle = "#101114";
      ctx.fillRect(s * 3.4 - 2.2, 22, 4.4, 4);
    }
    ctx.fillStyle = metal(ctx, -11, -11, 11, 11, RAIDER);
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.stroke();
    lines(ctx, [[-11, -2, 11, -2]], SEAM, 0.8);
    lamp(ctx, hurt ? "#ff5a3a" : "#7dff9a", () => ctx.fillRect(-4, 4.5, 8, 1.6), 8);
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, bank: number, alpha = 1) {
    const t = this.time;
    ctx.globalAlpha = alpha;
    // engine flames
    ctx.globalCompositeOperation = "lighter";
    const flick = 0.85 + Math.sin(t * 43) * 0.1 + Math.sin(t * 71) * 0.05;
    for (const ex of [-20, 20]) {
      const f = this.sprites.flame;
      const h = f.h * 0.62 * flick;
      ctx.drawImage(f.img, x + ex - f.w * 0.3, y + 22, f.w * 0.6, h);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bank * 0.12);
    ctx.scale(1 - Math.abs(bank) * 0.22, 1);
    this.put(ctx, this.sprites.player, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawWorld(ctx: CanvasRenderingContext2D) {
    const t = this.time;
    const g = this.sprites.glow;

    // smoke and shards under everything bright
    for (const f of this.puffs) {
      const l = f.life / f.max;
      ctx.globalAlpha = l * 0.7;
      this.put(ctx, this.sprites.smoke, f.x, f.y, (f.size * (1 + (1 - l) * 1.6)) / 32);
    }
    ctx.globalAlpha = 1;

    // power-ups with a turning dashed ring
    for (const u of this.powerUps) {
      const pulse = 1 + Math.sin(u.t * 6) * 0.06;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.5;
      this.put(ctx, g[u.kind === "weapon" ? "amber" : u.kind === "shield" ? "ice" : "red"], u.x, u.y, 1.9);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = POWER_COLOR[u.kind];
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -u.t * 24;
      ctx.beginPath();
      ctx.arc(u.x, u.y, 20, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      this.put(ctx, this.sprites.power[u.kind], u.x, u.y, pulse);
    }

    for (const e of this.enemies) this.drawEnemy(ctx, e, t);

    // the player
    const p = this.player;
    if (p.alive) {
      const alpha = p.invuln > 0 ? 0.45 + 0.4 * Math.abs(Math.sin(t * 12)) : 1;
      this.drawPlayer(ctx, p.x, p.y, this.bank, alpha);
      if (this.muzzle > 0) {
        ctx.globalCompositeOperation = "lighter";
        for (const x of [-13, 13]) this.put(ctx, g.red, p.x + x, p.y - 28, 0.7);
        ctx.globalCompositeOperation = "source-over";
      }
      if (p.shield > 0) this.drawShield(ctx, p.x, p.y, p.shield < 2 ? 0.35 + 0.45 * Math.abs(Math.sin(t * 9)) : 1);
    }

    // bolts, bullets, sparks, rings: light adds up
    ctx.globalCompositeOperation = "lighter";
    for (const b of this.shots) this.drawTurned(ctx, b);
    for (const b of this.bullets) this.drawTurned(ctx, b);
    for (const q of this.particles) {
      const l = clamp(q.life / q.max, 0, 1);
      ctx.globalAlpha = l;
      this.put(ctx, q.sprite, q.x, q.y, (q.size * (1 + q.grow * (1 - l))) / 32);
    }
    for (const r of this.rings) {
      const pr = 1 - r.life / r.dur;
      ctx.globalAlpha = 1 - pr;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - pr) + 0.6;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(1, r.max * easeOut(pr)), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    for (const s of this.shards) {
      ctx.globalAlpha = clamp(s.life / s.max, 0, 1);
      ctx.fillStyle = s.color;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.beginPath();
      ctx.moveTo(0, -s.size);
      ctx.lineTo(s.size * 0.7, s.size * 0.6);
      ctx.lineTo(-s.size * 0.6, s.size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // points
    ctx.font = `700 15px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const f of this.floaters) {
      const l = f.life / f.max;
      ctx.globalAlpha = clamp(l * 2.2, 0, 1);
      const pop = 1 + Math.max(0, l - 0.8) * 2;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.scale(pop, pop);
      ctx.strokeStyle = "rgba(4,6,18,0.75)";
      ctx.lineWidth = 4;
      ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = "#ffe7a3";
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private drawTurned(ctx: CanvasRenderingContext2D, b: Bullet) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.atan2(b.vx, -b.vy));
    this.put(ctx, b.sprite, 0, 0);
    ctx.restore();
  }

  private drawShield(ctx: CanvasRenderingContext2D, x: number, y: number, a: number) {
    const t = this.time;
    const r = 36;
    ctx.globalCompositeOperation = "lighter";
    const fill = ctx.createRadialGradient(x, y, r * 0.45, x, y, r);
    fill.addColorStop(0, "rgba(142,201,255,0)");
    fill.addColorStop(0.85, `rgba(142,201,255,${(0.16 * a).toFixed(3)})`);
    fill.addColorStop(1, `rgba(142,201,255,${(0.42 * a).toFixed(3)})`);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(170,250,255,${(0.85 * a).toFixed(3)})`;
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      const s = t * 1.8 + (i * TAU) / 3;
      ctx.beginPath();
      ctx.arc(x, y, r + 2, s, s + 1.1);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /** behind the start menu: the raiders swaying in formation, your fighter waiting below */
  private drawTitleScene(ctx: CanvasRenderingContext2D) {
    const t = this.time;
    const kinds: Kind[] = ["beetle", "crab", "crab", "drone", "drone"];
    kinds.forEach((kind, row) => {
      for (let c = 0; c < 6; c++) {
        const s = this.slot(row, c + 1, t);
        const e = { kind, r: ENEMY[kind as Exclude<Kind, "queen">].r, phase: row * 2 + c, state: "form", hp: 1, maxHp: 1, flash: 0 } as Enemy;
        this.drawEnemy(ctx, e, t, s.x, s.y - 40 + Math.sin(t * 2 + c + row) * 3);
      }
    });
    this.drawPlayer(ctx, W / 2, H - 70 + Math.sin(t * 2) * 4, Math.sin(t * 0.8) * 0.3);
  }
}

// ---------- markup and icons ----------

const PAUSE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const PLAY_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const LIFE_ICON = `<svg viewBox="-27 -34 54 60" aria-hidden="true"><path fill="currentColor" d="M0 -32L3 -23L6 -10L6 0L15.5 2L15.5 -11Q15.5 -14 19 -14L21 -14Q24.5 -14 24.5 -11L24.5 20Q24.5 23 21 23L19 23Q15.5 23 15.5 20L15.5 12L6 11L6 22L3.5 25L-3.5 25L-6 22L-6 11L-15.5 12L-15.5 20Q-15.5 23 -19 23L-21 23Q-24.5 23 -24.5 20L-24.5 -11Q-24.5 -14 -21 -14L-19 -14Q-15.5 -14 -15.5 -11L-15.5 2L-6 0L-6 -10L-3 -23Z M11.6 -27h2.8v26h-2.8Z M-14.4 -27h2.8v26h-2.8Z"/></svg>`;

const TEMPLATE = `
  <canvas class="game-canvas" tabindex="-1" aria-label="Spielfeld"></canvas>
  <div class="game-field">
    <div class="gh gh-left">
      <div class="gh-block">
        <span class="gh-label">Punkte</span>
        <span class="gh-score" data-hud="score"></span>
        <span class="gh-best">Rekord <b data-hud="best">0</b></span>
      </div>
      <div class="gh-row">
        <span class="gh-wave">Welle <b data-hud="wave">1</b></span>
        <span class="gh-lives" data-hud="lives" aria-label="Leben"></span>
      </div>
      <div class="gh-block">
        <span class="gh-label">Feuerkraft</span>
        <span class="gh-power" data-hud="power"><i></i><i></i><i></i><i></i><i></i></span>
      </div>
      <div class="gh-block" data-hud="shieldWrap" hidden>
        <span class="gh-label">Schild</span>
        <span class="gh-shield"><i data-hud="shield"></i></span>
      </div>
    </div>
    <div class="gh gh-right">
      <div class="gh-block">
        <span class="gh-label">Steuerung</span>
        <ul class="gh-list">
          <li><kbd>Maus</kbd> oder <kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd></li>
          <li>Feuer automatisch</li>
          <li><kbd>P</kbd> Pause · <kbd>Esc</kbd> zurück</li>
        </ul>
      </div>
      <div class="gh-block">
        <span class="gh-label">Power-ups</span>
        <ul class="gh-list">
          <li><i class="pu pu-weapon"></i>Feuerkraft</li>
          <li><i class="pu pu-shield"></i>Schild</li>
          <li><i class="pu pu-life"></i>Extraleben</li>
        </ul>
      </div>
      <div class="gh-block">
        <span class="gh-label">Gegner</span>
        <ul class="gh-list">
          <li><i class="pu pu-drone"></i>Jäger · 100</li>
          <li><i class="pu pu-crab"></i>Abfangjäger · 250</li>
          <li><i class="pu pu-beetle"></i>Bomber · 600</li>
        </ul>
      </div>
    </div>
    <div class="game-boss" data-hud="boss" aria-hidden="true">
      <div class="gbo-head"><span>Flaggschiff</span><b data-hud="bossPct"></b></div>
      <div class="gbo-bar"><i class="gbo-lag" data-hud="bossLag"></i><i class="gbo-fill" data-hud="bossFill"></i></div>
    </div>
    <div class="game-banner" aria-hidden="true"><span class="gb-sub"></span><span class="gb-title"></span></div>
    <section class="game-card game-start" aria-labelledby="game-title">
      <p class="gc-kicker">Minispiel</p>
      <h2 class="gc-logo" id="game-title"><span>Sternen</span><span>schwarm</span></h2>
      <p class="gc-text">Die Plünderer greifen an. Wie lange hältst du die Stellung?</p>
      <button class="gc-btn gc-primary" type="button" data-act="start">Spielen</button>
      <p class="gc-best" data-hud="titleBest"></p>
      <ul class="gc-keys">
        <li><kbd>Maus</kbd> <kbd>Finger</kbd> <kbd>←↑↓→</kbd> fliegen · Feuer automatisch</li>
        <li><kbd>P</kbd> Pause · <kbd>Esc</kbd> zurück zum Portfolio</li>
      </ul>
    </section>
    <section class="game-card game-paused" aria-labelledby="game-paused-title" hidden>
      <p class="gc-kicker">Pause</p>
      <h2 class="gc-title" id="game-paused-title">Kurz durchatmen</h2>
      <div class="gc-actions">
        <button class="gc-btn gc-primary" type="button" data-act="resume">Weiter</button>
        <button class="gc-btn" type="button" data-act="close">Zurück zum Portfolio</button>
      </div>
    </section>
    <section class="game-card game-over" aria-labelledby="game-over-title" hidden>
      <p class="gc-kicker" id="game-over-title">Mission beendet</p>
      <p class="gc-score" data-hud="finalScore">0</p>
      <p class="gc-record" data-hud="record"></p>
      <dl class="gc-stats">
        <div><dt>Welle</dt><dd data-hud="statWave">1</dd></div>
        <div><dt>Abschüsse</dt><dd data-hud="statKills">0</dd></div>
        <div><dt>Treffer</dt><dd data-hud="statAcc">–</dd></div>
      </dl>
      <div class="gc-actions">
        <button class="gc-btn gc-primary" type="button" data-act="start">Nochmal</button>
        <button class="gc-btn" type="button" data-act="close">Zurück zum Portfolio</button>
      </div>
    </section>
  </div>
  <p id="game-help" class="sr-only">Ein Weltraum-Shooter. Mit Maus, Finger oder Pfeiltasten fliegen, das Schiff feuert von selbst.
    P pausiert, Escape schließt das Spiel.</p>
  <p class="sr-only game-status" role="status" aria-live="polite"></p>
  <div class="game-buttons">
    <button class="icon-btn game-pause" type="button" aria-label="Pause" data-act="pause"><span class="ib-icon">${PAUSE_ICON}</span></button>
    <button class="icon-btn game-close" type="button" aria-label="Spiel schließen" data-act="close"><span class="ib-icon">${CLOSE_ICON}</span><span class="ib-label">Zurück</span></button>
  </div>`;
