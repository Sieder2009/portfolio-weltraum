import * as THREE from "three";
import { StreakBatch } from "./fx";
import { NOISE } from "./glsl";

// The sky around the system: a Milky Way baked once into an equirectangular texture (star clouds, dark dust
// lanes, a warm bulge around the galactic centre, a little glowing gas, a few far galaxies), a black hole that
// bends the light of the sky behind it, and several layers of point stars on top.

/** Where the galactic plane, its centre and the black hole are (chosen for the overview: see Universe). */
export interface SkyFrame {
  /** normal of the galactic plane */
  bandNormal: THREE.Vector3;
  /** direction of the galactic centre */
  core: THREE.Vector3;
  blackHole: {
    dir: THREE.Vector3;
    /** tangent axes at the hole: along the disk, and across it */
    u: THREE.Vector3;
    v: THREE.Vector3;
    /** angular radius of the shadow (radians) */
    radius: number;
  };
}

const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BAKE_FRAGMENT = /* glsl */ `
uniform vec3 uBandN;
uniform vec3 uCore;
uniform float uMode; // 0: the colours, 1: only the density of stars (to place the point stars)
varying vec2 vUv;
${NOISE}

// A faint distant galaxy: a tilted disc with two spiral arms and a bright core (small-angle projection).
vec3 galaxy(vec3 d, vec3 c, vec3 axis, float size, float ratio, float arms, vec3 tint) {
  float cd = dot(d, c);
  if (cd < 0.99) return vec3(0.0);
  vec3 t1 = normalize(axis - c * dot(axis, c));
  vec3 t2 = cross(c, t1);
  vec2 p = vec2(dot(d, t1), dot(d, t2) / ratio) / size;
  float r = length(p);
  float a = atan(p.y, p.x);
  float spiral = 0.5 + 0.5 * cos(2.0 * a - 6.0 * log(r + 0.06));
  float disk = exp(-r * 3.2) * mix(1.0, 0.35 + 0.9 * spiral, arms);
  float core = exp(-r * r * 60.0);
  return tint * (disk * 0.05 + core * 0.18);
}

void main() {
  float lon = vUv.x * 6.2831853 - 3.1415927;
  float lat = (vUv.y - 0.5) * 3.1415927;
  vec3 d = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));

  // galactic coordinates: b above the plane, l along it (0 at the centre)
  float b = dot(d, uBandN);
  vec3 e1 = normalize(uCore - uBandN * dot(uCore, uBandN));
  vec3 e2 = cross(uBandN, e1);
  float fromCore = abs(atan(dot(d, e2), dot(d, e1)));

  // the band is thick and bright around the centre, thin and faint on the far side
  float width = mix(0.13, 0.055, smoothstep(0.0, 2.4, fromCore));
  float band = exp(-b * b / (width * width));
  float thin = exp(-b * b / (width * width * 0.2));
  float bulge = exp(-fromCore * fromCore / 0.16 - b * b / 0.018);

  // patchy star clouds along the band
  float clouds = fbm(d * 3.2 + 7.0) * 0.5 + 0.5;
  float fine = fbm(d * 10.0 + 2.0) * 0.5 + 0.5;
  float starlight = band * (0.3 + 0.7 * smoothstep(0.3, 0.75, clouds * 0.7 + fine * 0.3)) + bulge * 1.4;

  // dust: dark lanes in the middle of the band, and one long rift a little off its centre line
  float lanes = smoothstep(0.5, 0.72, fbm(d * 6.0 + 5.0) * 0.5 + 0.5) * thin;
  float rift = exp(-pow((b - 0.01) / (width * 0.2), 2.0)) * smoothstep(2.7, 0.4, fromCore)
    * smoothstep(0.38, 0.62, fbm(d * 2.4 + 9.0) * 0.5 + 0.5);
  float dust = clamp(lanes * 0.85 + rift * 0.8, 0.0, 0.92);

  if (uMode > 0.5) {
    float density = clamp(starlight * (1.0 - dust) * 0.8, 0.0, 1.0);
    gl_FragColor = vec4(vec3(density), 1.0);
    return;
  }

  // blue-white arms, warm toward the centre; a grain of countless unresolved stars
  vec3 tint = mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.8, 0.58), smoothstep(1.9, 0.15, fromCore) * 0.85);
  float grain = smoothstep(0.35, 1.0, snoise(d * 240.0)) + 0.6 * smoothstep(0.45, 1.0, snoise(d * 110.0 + 3.0));
  vec3 col = tint * starlight * (0.035 + 0.06 * grain) * (1.0 - dust);
  // (the dust is not perfectly black: a faint brownish glow)
  col += vec3(0.06, 0.035, 0.02) * dust * band * 0.05;

  // glowing gas in the band: pink star-forming regions, and a little blue reflection haze
  float em = smoothstep(0.66, 0.86, fbm(d * 4.0 + 21.0) * 0.5 + 0.5) * band;
  col += vec3(0.9, 0.14, 0.28) * em * 0.05 * (1.0 - dust * 0.6);
  float refl = smoothstep(0.68, 0.9, fbm(d * 3.0 + 40.0) * 0.5 + 0.5) * (0.25 + band);
  col += vec3(0.12, 0.26, 0.7) * refl * 0.022;

  // away from the band the sky is nearly black, with only a faint haze here and there
  float haze = smoothstep(0.6, 0.9, fbm(d * 1.4 + 3.0) * 0.5 + 0.5);
  col += mix(vec3(0.05, 0.025, 0.09), vec3(0.015, 0.045, 0.08), smoothstep(-0.3, 0.3, snoise(d * 1.1 + 13.0))) * haze * 0.14;

  // far galaxies
  col += galaxy(d, normalize(vec3(-0.72, -0.42, 0.52)), vec3(0.3, 1.0, 0.2), 0.03, 0.45, 1.0, vec3(0.85, 0.82, 1.0));
  col += galaxy(d, normalize(vec3(-0.55, -0.62, 0.35)), vec3(1.0, 0.3, 0.1), 0.016, 0.8, 1.0, vec3(1.0, 0.9, 0.8));
  col += galaxy(d, normalize(vec3(-0.9, -0.15, 0.25)), vec3(0.1, 0.6, 1.0), 0.012, 0.3, 0.0, vec3(1.0, 0.85, 0.7));
  col += galaxy(d, normalize(vec3(0.6, 0.35, -0.7)), vec3(0.4, 1.0, 0.0), 0.035, 0.6, 1.0, vec3(0.8, 0.85, 1.0));
  col += galaxy(d, normalize(vec3(0.2, -0.75, -0.6)), vec3(1.0, 0.2, 0.5), 0.02, 0.35, 1.0, vec3(0.9, 0.88, 1.0));
  col += galaxy(d, normalize(vec3(-0.15, 0.7, 0.7)), vec3(0.0, 0.3, 1.0), 0.025, 0.7, 1.0, vec3(0.85, 0.9, 1.0));
  col += vec3(0.0015, 0.002, 0.004);
  gl_FragColor = vec4(col, 1.0);
}
`;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDir = world.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uIntensity;
uniform vec3 uBhDir;
uniform vec3 uBhU;
uniform vec3 uBhV;
uniform float uBhR;
uniform float uTime;
varying vec3 vDir;

vec3 sky(vec3 d) {
  vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5);
  return texture2D(uMap, uv).rgb;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// The accretion disk at radius rr (in shadow radii) and angle a: white-hot inside, orange outside, in streaks
// that turn (inner ones faster); \`toward\` (-1…1) brightens the side that moves toward us.
vec3 disk(float rr, float a, float toward) {
  float body = smoothstep(1.75, 2.2, rr) * smoothstep(7.5, 3.2, rr);
  if (body <= 0.0) return vec3(0.0);
  float turn = a + uTime * 1.4 / pow(rr, 1.5);
  float streaks = (0.5 + 0.5 * vnoise(vec2(turn * 6.0, rr * 2.4))) * (0.65 + 0.35 * vnoise(vec2(turn * 17.0, rr * 7.0)));
  vec3 c = mix(vec3(1.0, 0.86, 0.66), vec3(1.0, 0.42, 0.12), smoothstep(1.9, 5.5, rr));
  return c * body * streaks * pow(2.0 / rr, 1.4) * (1.0 + 0.7 * toward) * 1.5;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col;
  if (dot(d, uBhDir) > cos(uBhR * 15.0)) {
    // in the tangent plane at the hole, in shadow radii: x along the disk, y across
    vec2 p = vec2(dot(d, uBhU), dot(d, uBhV)) / uBhR;
    float r = length(p);
    // light from behind bends around the hole (point lens; inside the Einstein ring the sky shows mirrored)
    const float E = 2.4;
    float rs = r - E * E / max(r, 0.05);
    vec2 sp = p / max(r, 1e-4) * rs;
    vec3 sd = normalize(uBhDir + (uBhU * sp.x + uBhV * sp.y) * uBhR);
    float lens = smoothstep(15.0, 9.0, r);
    col = mix(sky(d), sky(sd), lens) * (1.0 + 0.5 * lens * smoothstep(5.0, 1.3, r));
    // the shadow: nothing comes back from inside
    float shadow = 1.0 - smoothstep(0.97, 1.03, r);
    col *= 1.0 - shadow;
    // the photon ring: light that went once around the hole
    col += vec3(1.0, 0.84, 0.62) * exp(-pow((r - 1.07) / 0.04, 2.0)) * 1.5;
    // the far side of the disk, bent up over the top of the shadow (and, fainter, under it)
    if (r > 1.08 && r < 2.7) {
      float rr = mix(2.0, 6.5, (r - 1.12) / 1.5);
      float fade = smoothstep(1.08, 1.22, r) * smoothstep(2.7, 2.1, r);
      col += disk(rr, atan(p.y, p.x), -p.x / r) * fade * (p.y > 0.0 ? 0.6 : 0.22);
    }
    // the near side, seen almost edge on: it passes in front of the shadow; the far half hides behind it
    vec2 q = vec2(p.x, p.y / 0.16);
    float rq = length(q);
    float hidden = step(0.0, q.y) * shadow;
    col += disk(rq, atan(q.y, q.x), -q.x / max(rq, 1e-3)) * (1.0 - hidden);
    // a soft glow around it all (on small devices there is no bloom pass to add one)
    col += vec3(1.0, 0.6, 0.3) * exp(-r * 0.6) * 0.06;
  } else {
    col = sky(d);
  }
  gl_FragColor = vec4(col * uIntensity, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function bakeMaterial(octaves: number, frame: SkyFrame, mode: number) {
  return new THREE.ShaderMaterial({
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
    defines: { OCTAVES: octaves },
    uniforms: {
      uBandN: { value: frame.bandNormal },
      uCore: { value: frame.core },
      uMode: { value: mode },
    },
    depthTest: false,
    depthWrite: false,
  });
}

function renderQuad(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) {
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new THREE.Camera());
  renderer.setRenderTarget(prev);
  quad.geometry.dispose();
  material.dispose();
}

export function bakeNebula(renderer: THREE.WebGLRenderer, width: number, octaves: number, frame: SkyFrame) {
  const target = new THREE.WebGLRenderTarget(width, width / 2, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  renderQuad(renderer, bakeMaterial(octaves, frame, 0), target);
  return target;
}

/** How densely stars crowd at a direction (0…1): the band's star clouds, without its dust lanes. */
export type StarDensity = (dir: THREE.Vector3) => number;

/** A small map of the same Milky Way, read back once, to place the point stars in its clouds and not in its dust. */
export function bakeDensity(renderer: THREE.WebGLRenderer, octaves: number, frame: SkyFrame): StarDensity {
  const W = 512;
  const H = 256;
  const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: false });
  renderQuad(renderer, bakeMaterial(Math.min(octaves, 4), frame, 1), target);
  const pixels = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(target, 0, 0, W, H, pixels);
  target.dispose();
  return (d) => {
    const u = Math.atan2(d.z, d.x) / (Math.PI * 2) + 0.5;
    const v = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI + 0.5;
    const x = Math.min(W - 1, Math.max(0, Math.floor(u * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
    return pixels[(y * W + x) * 4] / 255;
  };
}

export function createSky(texture: THREE.Texture, frame: SkyFrame) {
  const bh = frame.blackHole;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 32),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        uMap: { value: texture },
        uIntensity: { value: 1 },
        uBhDir: { value: bh.dir },
        uBhU: { value: bh.u },
        uBhV: { value: bh.v },
        uBhR: { value: bh.radius },
        uTime: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    }),
  );
  mesh.scale.setScalar(4000);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- Stars ----------

const STAR_VERTEX = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
uniform float uTime;
uniform float uPixelRatio;
uniform float uTwinkle;
uniform float uAttenuate;
uniform float uBoost;
uniform vec3 uBhDir;
uniform float uBhR;
varying vec3 vColor;
varying float vCore;
varying float vSpike;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float s1 = sin(uTime * (0.6 + aPhase * 2.2) + aPhase * 40.0);
  float s2 = sin(uTime * (1.7 + aPhase * 3.1) + aPhase * 13.0);
  float tw = 1.0 - uTwinkle * 0.45 * (0.5 + 0.5 * s1 * s2);
  float size = aSize * uPixelRatio;
  if (uAttenuate > 0.0) size *= clamp(uAttenuate / -mv.z, 0.2, 3.0);
  // The brightest stars get a soft halo and a four-pointed glare, so the point sprite is larger than the star.
  float big = uAttenuate > 0.0 ? 0.0 : smoothstep(3.0, 4.2, aSize);
  float sprite = max(size * mix(2.2, 7.5, big), 2.0);
  gl_PointSize = sprite;
  vCore = clamp(size / sprite, 0.05, 1.0);
  vSpike = big;
  // a slight colour flicker (scintillation)
  vec3 sc = vec3(1.0 + 0.1 * s2 * uTwinkle, 1.0, 1.0 - 0.1 * s2 * uTwinkle);
  vColor = aColor * sc * tw * uBoost * (0.45 + aSize * 0.42);
  // far stars behind the black hole are swallowed by its shadow
  if (uAttenuate <= 0.0 && uBhR > 0.0) {
    vec3 dir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    float ang = acos(clamp(dot(dir, uBhDir), -1.0, 1.0));
    vColor *= smoothstep(uBhR * 0.95, uBhR * 1.25, ang);
  }
}
`;

const STAR_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vCore;
varying float vSpike;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float r = d / (vCore * 0.5);
  float core = exp(-r * r * 2.4);
  float halo = exp(-d * 10.0) * (0.06 + 0.22 * vSpike) * smoothstep(0.5, 0.15, d);
  float spikes = 0.0;
  if (vSpike > 0.0) {
    vec2 a = abs(c);
    float w = vCore * 0.06;
    float sx = exp(-a.y / w) * pow(max(1.0 - a.x * 2.0, 0.0), 2.5);
    float sy = exp(-a.x / w) * pow(max(1.0 - a.y * 2.0, 0.0), 2.5);
    spikes = (sx + sy) * 0.6 * vSpike;
  }
  gl_FragColor = vec4(vColor * (core + halo + spikes), 1.0);
  #include <colorspace_fragment>
}
`;

function starColor(rand: number) {
  // From hot blue-white to warm, with most stars close to white.
  const palette = ["#9db8ff", "#c9d7ff", "#f4f6ff", "#fff4e6", "#ffd9b0", "#ffc09a"];
  const weights = [0.12, 0.22, 0.36, 0.16, 0.09, 0.05];
  let acc = 0;
  for (let i = 0; i < palette.length; i++) {
    acc += weights[i];
    if (rand <= acc) return new THREE.Color(palette[i]);
  }
  return new THREE.Color(palette[2]);
}

export interface StarLayer {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
}

interface StarOptions {
  seed?: number;
  /** near dust: a flat disc inside the system instead of a far shell */
  near?: boolean;
  /** the first `bright` stars are large and glaring */
  bright?: number;
  /** the galactic plane: a share of the far stars gathers along it */
  band?: THREE.Vector3;
  /** star clouds of the Milky Way: every star is placed by this density (small, faint, many) */
  density?: StarDensity;
  blackHole?: SkyFrame["blackHole"];
}

export function createStars(count: number, opts: StarOptions = {}): StarLayer {
  let s = opts.seed ?? 1;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const bandN = (opts.band ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
  const tmp = new THREE.Vector3();
  const helper = Math.abs(bandN.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const u = helper.cross(bandN).normalize();
  const v = bandN.clone().cross(u).normalize();
  const randomDir = () => {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return tmp.set(r * Math.cos(a), z, r * Math.sin(a));
  };

  let placed = 0;
  let tries = 0;
  while (placed < count) {
    const i = placed;
    if (opts.near) {
      // A flat disc of faint dust around the system, for depth while the camera moves.
      const r = 90 + Math.pow(rand(), 0.7) * 420;
      const a = rand() * Math.PI * 2;
      tmp.set(Math.cos(a) * r, (rand() - 0.5) * 80 * (0.3 + rand()), Math.sin(a) * r);
    } else if (opts.density) {
      // (rejection sampling: tried in random directions, kept as often as the clouds are dense there)
      randomDir();
      if (rand() > opts.density(tmp) && ++tries < count * 400) continue;
      tmp.multiplyScalar(1400 + rand() * 600);
    } else if (opts.band && rand() < 0.3) {
      const a = rand() * Math.PI * 2;
      const spread = (rand() + rand() + rand() - 1.5) * (rand() < 0.5 ? 0.08 : 0.18);
      tmp.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a)).addScaledVector(bandN, spread).normalize();
      tmp.multiplyScalar(1400 + rand() * 600);
    } else {
      randomDir().multiplyScalar(1400 + rand() * 600);
    }
    positions.set([tmp.x, tmp.y, tmp.z], i * 3);
    const c = starColor(rand());
    colors.set([c.r, c.g, c.b], i * 3);
    const bright = !opts.near && !opts.density && i < (opts.bright ?? 0);
    sizes[i] = opts.near
      ? 1.2 + rand() * 2.2
      : opts.density
        ? 0.42 + Math.pow(rand(), 6) * 1.1
        : bright
          ? 3.4 + rand() * 2.4
          : 0.55 + Math.pow(rand(), 10) * 2.6;
    phases[i] = rand();
    placed++;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

  const bh = opts.blackHole;
  const material = new THREE.ShaderMaterial({
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uTwinkle: { value: opts.near || opts.density ? 0 : 1 },
      uAttenuate: { value: opts.near ? 160 : 0 },
      uBoost: { value: opts.near ? 0.32 : opts.density ? 0.62 : 1 },
      uBhDir: { value: bh ? bh.dir : new THREE.Vector3(0, 1, 0) },
      uBhR: { value: bh ? bh.radius : 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -5;
  return { points, material };
}

// ---------- Shooting stars: now and then a thin streak across the part of the sky in view ----------

interface Meteor {
  head: THREE.Vector3;
  dir: THREE.Vector3;
  t: number;
  duration: number;
  speed: number;
  length: number;
  brightness: number;
}

const METEOR_COLOR = new THREE.Color(1.6, 1.75, 2.1);

export class ShootingStars {
  readonly group = new THREE.Group();
  private batch = new StreakBatch(4, { core: 0.6, minPx: 1.3 });
  private meteors: Meteor[] = [];
  private wait = 2.5;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor() {
    this.batch.mesh.renderOrder = -4;
    this.group.add(this.batch.mesh);
  }

  /** `active` false lets the running ones finish but starts no new ones. */
  update(dt: number, camera: THREE.PerspectiveCamera, active: boolean) {
    // (like the far stars, the streaks sit on a shell around the camera)
    this.group.position.copy(camera.position);
    this.wait -= dt;
    if (active && this.wait <= 0 && this.meteors.length < 2) {
      this.wait = 3 + Math.random() * 7;
      this.spawn(camera);
    }
    this.batch.begin();
    this.meteors = this.meteors.filter((m) => {
      m.t += dt;
      if (m.t >= m.duration) return false;
      const k = m.t / m.duration;
      const head = this.tmp.copy(m.head).addScaledVector(m.dir, m.speed * m.t);
      const tail = this.tmp2.copy(head).addScaledVector(m.dir, -m.length * Math.min(1, k * 3));
      const alpha = Math.sin(Math.PI * k) * m.brightness;
      this.batch.push(head.x, head.y, head.z, tail.x, tail.y, tail.z, METEOR_COLOR, alpha, 2.2, 0.6, 0);
      return true;
    });
    this.batch.finish();
  }

  private spawn(camera: THREE.PerspectiveCamera) {
    // A random point in the upper part of the view, on the star shell.
    const ndc = this.tmp.set(Math.random() * 1.6 - 0.8, Math.random() * 1.1 - 0.3, 0.5).unproject(camera);
    const toward = ndc.sub(camera.position).normalize();
    const head = toward.clone().multiplyScalar(1500);
    // Mostly downward and sideways on screen.
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const right = this.tmp2.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const dir = right.multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
    dir.addScaledVector(toward, -dir.dot(toward)).normalize();
    this.meteors.push({
      head,
      dir: dir.clone(),
      t: 0,
      duration: 0.55 + Math.random() * 0.6,
      speed: 650 + Math.random() * 500,
      length: 140 + Math.random() * 160,
      brightness: 0.6 + Math.random() * 0.6,
    });
  }
}
