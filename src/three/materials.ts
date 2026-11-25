import * as THREE from "three";
import { NOISE, SURFACE_VERTEX } from "./glsl";

// One surface shader for every planet and moon. The look is picked by uKind, so all bodies share a single
// compiled program (three.js caches programs by source) while each keeps its own uniforms.
export const KIND = {
  terran: 0,
  crystal: 1,
  lava: 2,
  gas: 3,
  voxel: 4,
  circuit: 5,
  ringed: 6,
  aurora: 7,
  moon: 8,
} as const;

export type SurfaceKind = keyof typeof KIND;

const PLANET_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform int uKind;
uniform vec3 uSunPos;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;
uniform vec3 uAtmo;
uniform float uSeed;
uniform float uHover;
uniform vec3 uCenter;
uniform vec3 uRingNormal;
uniform vec3 uRingInfo;

varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;

${NOISE}

vec3 rotY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// Bump mapping from screen-space derivatives of a height value (surface gradient method).
vec3 perturb(vec3 N, float h, float k) {
  vec3 dpx = dFdx(vWorld);
  vec3 dpy = dFdy(vWorld);
  float dhx = dFdx(h);
  float dhy = dFdy(h);
  vec3 r1 = cross(dpy, N);
  vec3 r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * N - k * grad);
}

void main() {
  vec3 p = normalize(vObj);
  vec3 Ng = normalize(vNormalW);
  vec3 N = Ng;
  vec3 L = normalize(uSunPos - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);

  vec3 albedo = uC0;
  vec3 emissive = vec3(0.0);
  float spec = 0.0;
  float gloss = 30.0;
  float cloud = 0.0;
  float nightOnly = 0.0;

  if (uKind == 0) {
    // Home world: oceans, continents, ice caps, clouds and a few lights on the night side.
    float h = fbm(p * 1.7 + uSeed) + 0.22 * snoise(p * 6.0 + uSeed);
    float land = smoothstep(0.0, 0.04, h);
    vec3 ocean = mix(uC0, uC1, smoothstep(-0.45, 0.0, h));
    vec3 ground = mix(uC2, uC3, smoothstep(0.05, 0.42, h + 0.08 * snoise(p * 11.0)));
    float ice = smoothstep(0.8, 0.88, abs(p.y) + 0.06 * snoise(p * 7.0 + 3.0));
    albedo = mix(ocean, ground, land);
    albedo = mix(albedo, uC4, ice);
    spec = (1.0 - land) * (1.0 - ice) * 0.6;
    gloss = 60.0;
    N = perturb(Ng, max(h, 0.0), 0.22);
    vec3 cp = rotY(p, uTime * 0.018);
    float c = fbm(cp * 2.4 + vec3(0.0, 0.0, uTime * 0.006) + 31.0);
    cloud = smoothstep(0.08, 0.55, c + 0.05) * 0.85;
    float city = smoothstep(0.55, 0.8, snoise(p * 38.0 + 5.0));
    emissive = vec3(1.0, 0.7, 0.36) * land * (1.0 - ice) * city * 0.5 * (1.0 - cloud);
    nightOnly = 1.0;
  } else if (uKind == 1) {
    // Crystal world: faceted cells with glowing seams.
    vec3 w = worley(p * 3.4 + uSeed);
    float edge = 1.0 - smoothstep(0.0, 0.07, w.y - w.x);
    vec3 hc = hash33(vec3(w.z * 17.0, w.z * 41.0, w.z * 89.0));
    albedo = mix(uC0, uC1, hc.x);
    albedo = mix(albedo, uC2, smoothstep(0.75, 1.0, hc.y));
    N = normalize(Ng + (hc - 0.5) * 0.9);
    spec = 1.3;
    gloss = 90.0;
    albedo += uC1 * pow(1.0 - max(dot(N, V), 0.0), 2.0) * 0.25;
    emissive = uC3 * (edge * 0.9 + 0.05);
  } else if (uKind == 2) {
    // Lava world: dark basalt with glowing cracks and lakes.
    vec3 q = p * 2.1 + uSeed;
    float f = fbm(q + vec3(0.0, uTime * 0.012, 0.0));
    float r = 1.0 - abs(snoise(q * 2.3 + f * 1.3));
    float cracks = pow(r, 9.0);
    float lake = smoothstep(0.3, 0.62, -f);
    float pulse = 0.78 + 0.22 * sin(uTime * 1.4 + f * 9.0);
    albedo = mix(uC0, uC1, smoothstep(-0.35, 0.45, f)) * (1.0 - lake * 0.8);
    emissive = mix(uC2, uC3, cracks) * cracks * 2.4 * pulse + mix(uC2, uC3, 0.35) * lake * 1.1 * pulse;
    N = perturb(Ng, f * 0.7 - cracks * 0.25, 0.45);
    spec = 0.15;
    gloss = 18.0;
  } else if (uKind == 3) {
    // Gas giant: turbulent bands and a slow storm.
    float t = uTime * 0.008;
    float turb = fbm(vec3(p.x * 2.2 + t, p.y * 8.0, p.z * 2.2 - t) + uSeed);
    float b1 = 0.5 + 0.5 * sin(p.y * 12.0 + turb * 2.4);
    float b2 = 0.5 + 0.5 * sin(p.y * 29.0 + turb * 3.6 + 1.3);
    vec3 c = mix(uC0, uC1, b1);
    c = mix(c, uC2, b2 * 0.42);
    vec3 sc = normalize(vec3(0.62, -0.34, 0.7));
    vec3 d = p - sc;
    float e = length(vec2(length(d.xz) / 0.3, d.y / 0.13));
    float storm = smoothstep(1.0, 0.0, e);
    float swirl = 0.5 + 0.5 * sin(e * 14.0 - uTime * 0.5 + turb * 4.0);
    albedo = mix(c, mix(uC3, uC4, swirl), storm * 0.9);
    spec = 0.08;
    gloss = 12.0;
  } else if (uKind == 4) {
    // Voxel world: the sphere sampled on a block grid.
    vec3 a = abs(p);
    float m = max(a.x, max(a.y, a.z));
    vec3 cube = p / m;
    float res = 12.0;
    vec3 cell = floor(cube * res);
    vec3 q = normalize((cell + 0.5) / res);
    float h = fbm(q * 1.7 + uSeed) + 0.12;
    float br = hash13(cell + uSeed);
    float px = hash13(floor(cube * res * 4.0));
    vec3 c;
    if (h < -0.02) {
      c = mix(uC0 * 0.7, uC0, smoothstep(-0.4, -0.02, h));
      spec = 0.5;
      gloss = 50.0;
    } else if (h < 0.05) {
      c = uC1;
    } else if (h < 0.3) {
      c = uC2;
    } else if (h < 0.46) {
      c = uC3;
    } else {
      c = uC4;
    }
    c *= 0.86 + 0.22 * br;
    c *= 0.92 + 0.14 * px;
    vec3 fr = fract(cube * res);
    vec3 ed = min(fr, 1.0 - fr);
    if (a.x >= a.y && a.x >= a.z) ed.x = 1.0;
    else if (a.y >= a.z) ed.y = 1.0;
    else ed.z = 1.0;
    float edge = min(ed.x, min(ed.y, ed.z));
    albedo = c * (0.8 + 0.2 * smoothstep(0.0, 0.08, edge));
    vec3 cp = rotY(p, uTime * 0.02);
    vec3 ca = abs(cp);
    vec3 cc = cp / max(ca.x, max(ca.y, ca.z));
    vec3 ccell = floor(cc * 7.0);
    float cn = fbm(normalize((ccell + 0.5) / 7.0) * 2.2 + 9.0 + uSeed);
    cloud = step(0.3, cn) * 0.85;
  } else if (uKind == 5) {
    // Circuit world: copper traces, solder pads and chips, with pulses running along the traces.
    vec3 a = abs(p);
    vec2 uv;
    float face;
    if (a.x >= a.y && a.x >= a.z) { uv = p.yz / a.x; face = p.x > 0.0 ? 1.0 : 2.0; }
    else if (a.y >= a.z) { uv = p.xz / a.y; face = p.y > 0.0 ? 3.0 : 4.0; }
    else { uv = p.xy / a.z; face = p.z > 0.0 ? 5.0 : 6.0; }
    vec2 gv = uv * 8.0;
    vec2 id = floor(gv);
    vec2 f = fract(gv) - 0.5;
    float r = hash13(vec3(id, face) + uSeed);
    float r2 = hash13(vec3(id.yx, face * 3.1) + uSeed);
    float lw = 0.045;
    float lh = 1.0 - smoothstep(lw, lw + 0.03, abs(f.y));
    float lv = 1.0 - smoothstep(lw, lw + 0.03, abs(f.x));
    float trace;
    if (r < 0.3) trace = lh;
    else if (r < 0.6) trace = lv;
    else if (r < 0.8) trace = max(lh * step(0.0, f.x), lv * step(0.0, f.y));
    else trace = max(lh * step(f.x, 0.0), lv * step(f.y, 0.0));
    trace *= step(0.12, r2);
    float pad = (1.0 - smoothstep(0.12, 0.16, length(f))) * step(0.7, r2);
    vec2 cg = uv * 2.5;
    vec2 cf = fract(cg) - 0.5;
    float chipOn = step(0.72, hash13(vec3(floor(cg), face + 11.0) + uSeed));
    float cm = max(abs(cf.x), abs(cf.y));
    float chip = chipOn * (1.0 - smoothstep(0.26, 0.28, cm));
    float border = chipOn * smoothstep(0.235, 0.255, cm) * (1.0 - smoothstep(0.27, 0.285, cm));
    float n = fbm(p * 3.0 + uSeed);
    float metal = max(trace, pad) * (1.0 - chip);
    albedo = uC0 * (0.85 + 0.3 * n);
    albedo = mix(albedo, uC1, metal);
    albedo = mix(albedo, uC2, chip);
    float pulse = pow(0.5 + 0.5 * sin((gv.x + gv.y) * 0.7 - uTime * 2.2 + r * 6.2831), 12.0);
    emissive = uC3 * (trace * (0.16 + 1.6 * pulse) + pad * 0.5) * (1.0 - chip) + uC3 * border * 0.6;
    spec = 0.6 * metal + 0.4 * chip;
    gloss = 50.0;
  } else if (uKind == 6) {
    // Ringed world: soft pastel bands.
    float t = uTime * 0.006;
    float turb = fbm(vec3(p.x * 1.6 + t, p.y * 6.5, p.z * 1.6) + uSeed);
    float b = 0.5 + 0.5 * sin(p.y * 10.0 + turb * 1.7);
    float b2 = 0.5 + 0.5 * sin(p.y * 24.0 + turb * 2.3);
    albedo = mix(uC0, uC1, b);
    albedo = mix(albedo, uC2, b2 * 0.35);
    albedo = mix(albedo, uC3, smoothstep(0.72, 0.95, abs(p.y)) * 0.7);
    spec = 0.05;
    gloss = 10.0;
  } else if (uKind == 7) {
    // Ice world with auroras around both poles.
    vec3 w = worley(p * 4.2 + uSeed);
    float cracks = 1.0 - smoothstep(0.0, 0.06, w.y - w.x);
    float n = fbm(p * 2.6 + uSeed);
    albedo = mix(uC0, uC1, smoothstep(-0.3, 0.5, n));
    albedo = mix(albedo, uC2, cracks * 0.65);
    N = perturb(Ng, n * 0.4, 0.12);
    spec = 0.7;
    gloss = 70.0;
    float lon = atan(p.z, p.x);
    float cur = fbm(vec3(cos(lon) * 2.0, sin(lon) * 2.0, uTime * 0.12) + uSeed);
    float band = exp(-pow((abs(p.y) - 0.7 - cur * 0.08) / 0.07, 2.0));
    float flick = 0.55 + 0.45 * sin(lon * 18.0 + uTime * 1.2 + cur * 7.0);
    emissive = mix(uC3, uC4, smoothstep(-0.3, 0.5, cur)) * band * flick * 1.5 + uC2 * cracks * 0.12;
    nightOnly = 0.65;
  } else {
    // Moon: dusty rock with craters.
    float n = fbm(p * 2.8 + uSeed);
    vec3 w = worley(p * 4.5 + uSeed);
    float crater = smoothstep(0.32, 0.0, w.x);
    float rim = smoothstep(0.22, 0.32, w.x) * smoothstep(0.42, 0.32, w.x);
    albedo = mix(uC0, uC1, smoothstep(-0.4, 0.5, n)) * (0.85 - crater * 0.25 + rim * 0.3);
    // (no bump mapping: moons are only a few pixels wide, where screen-space derivatives turn to noise)
    spec = 0.05;
  }

  float ndlGeo = dot(Ng, L);
  float day = smoothstep(-0.15, 0.25, ndlGeo);
  float diffuse = max(dot(N, L), 0.0) * smoothstep(-0.1, 0.2, ndlGeo);

  // Shadow of the ring on the planet.
  float shadow = 1.0;
  if (uRingInfo.z > 0.5) {
    float denom = dot(L, uRingNormal);
    if (abs(denom) > 1e-3) {
      float t = dot(uCenter - vWorld, uRingNormal) / denom;
      if (t > 0.0) {
        float rr = (length(vWorld + L * t - uCenter) - uRingInfo.x) / (uRingInfo.y - uRingInfo.x);
        if (rr > 0.0 && rr < 1.0) shadow = 1.0 - 0.6 * ringDensity(rr);
      }
    }
  }

  vec3 sun = vec3(1.0, 0.96, 0.9) * 1.3;
  vec3 col = albedo * (vec3(0.016, 0.018, 0.03) + diffuse * shadow * sun);
  vec3 H = normalize(L + V);
  col += spec * pow(max(dot(N, H), 0.0), gloss) * diffuse * shadow * vec3(1.0, 0.94, 0.84);
  if (cloud > 0.0) {
    float cl = max(ndlGeo, 0.0) * shadow;
    col = mix(col, vec3(0.012, 0.014, 0.022) + cl * sun * 0.95, cloud);
  }
  col += emissive * mix(1.0, 1.0 - day, nightOnly);

  float fres = pow(1.0 - max(dot(Ng, V), 0.0), 3.0);
  col += uAtmo * fres * (0.1 + 0.9 * smoothstep(-0.2, 0.5, ndlGeo));
  col += uAtmo * fres * uHover * 0.9;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const ATMO_VERTEX = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// Rendered on the back faces of a slightly larger sphere: a soft halo strongest just outside the planet's edge.
const ATMO_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSunPos;
uniform float uStrength;
uniform float uHover;
uniform float uInner;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uSunPos - vWorld);
  float d = -dot(N, V);
  float glow = pow(smoothstep(0.0, uInner, d), 1.8);
  float lit = 0.12 + 0.88 * smoothstep(-0.35, 0.6, dot(N, L));
  vec3 col = uColor * glow * (lit * uStrength + uHover * 0.7);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const RING_VERTEX = /* glsl */ `
varying vec2 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = position.xy;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const RING_FRAGMENT = /* glsl */ `
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uSunPos;
uniform vec3 uCenter;
uniform vec3 uNormal;
uniform float uRadius;
uniform float uInner;
uniform float uOuter;
uniform float uHover;
varying vec2 vLocal;
varying vec3 vWorld;
${NOISE}
void main() {
  float r = (length(vLocal) - uInner) / (uOuter - uInner);
  float dens = ringDensity(r);
  vec3 col = mix(uC0, uC1, smoothstep(0.0, 1.0, r));
  col *= 0.8 + 0.25 * snoise(vec3(r * 70.0, 0.0, 2.0));
  vec3 L = normalize(uSunPos - vWorld);
  float lit = 0.25 + 0.75 * abs(dot(uNormal, L));
  vec3 oc = vWorld - uCenter;
  float b = dot(oc, L);
  float perp = sqrt(max(dot(oc, oc) - b * b, 0.0));
  float shadow = b < 0.0 ? mix(1.0, 0.1, smoothstep(uRadius * 1.02, uRadius * 0.94, perp)) : 1.0;
  vec3 c = col * lit * shadow * 1.2 + col * uHover * 0.25;
  gl_FragColor = vec4(c, dens * 0.9);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SurfaceOptions {
  kind: SurfaceKind;
  colors: string[];
  atmo: string;
  seed: number;
  octaves: number;
}

const toColor = (hex: string | undefined) => new THREE.Color(hex ?? "#808080");

export function createSurfaceMaterial(opts: SurfaceOptions) {
  const c = opts.colors;
  return new THREE.ShaderMaterial({
    vertexShader: SURFACE_VERTEX,
    fragmentShader: PLANET_FRAGMENT,
    defines: { OCTAVES: opts.octaves },
    uniforms: {
      uTime: { value: 0 },
      uKind: { value: KIND[opts.kind] },
      uSunPos: { value: new THREE.Vector3() },
      uC0: { value: toColor(c[0]) },
      uC1: { value: toColor(c[1]) },
      uC2: { value: toColor(c[2]) },
      uC3: { value: toColor(c[3]) },
      uC4: { value: toColor(c[4]) },
      uAtmo: { value: toColor(opts.atmo) },
      uSeed: { value: opts.seed },
      uHover: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
      uRingInfo: { value: new THREE.Vector3(0, 1, 0) },
    },
  });
}

export function createAtmosphereMaterial(color: string, strength: number, scale: number) {
  return new THREE.ShaderMaterial({
    vertexShader: ATMO_VERTEX,
    fragmentShader: ATMO_FRAGMENT,
    uniforms: {
      uColor: { value: toColor(color) },
      uSunPos: { value: new THREE.Vector3() },
      uStrength: { value: strength },
      uHover: { value: 0 },
      // where the planet's edge sits on the halo sphere (as -dot(N, V))
      uInner: { value: Math.sqrt(1 - 1 / (scale * scale)) },
    },
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

export function createRingMaterial(colors: string[], inner: number, outer: number, radius: number, octaves: number) {
  return new THREE.ShaderMaterial({
    vertexShader: RING_VERTEX,
    fragmentShader: RING_FRAGMENT,
    defines: { OCTAVES: octaves },
    uniforms: {
      uC0: { value: toColor(colors[0]) },
      uC1: { value: toColor(colors[1]) },
      uSunPos: { value: new THREE.Vector3() },
      uCenter: { value: new THREE.Vector3() },
      uNormal: { value: new THREE.Vector3(0, 1, 0) },
      uRadius: { value: radius },
      uInner: { value: inner },
      uOuter: { value: outer },
      uHover: { value: 0 },
    },
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
}
