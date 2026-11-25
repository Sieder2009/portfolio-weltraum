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
uniform mat4 modelMatrix;
uniform float uTime;
uniform int uKind;
uniform vec3 uSunPos;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;
uniform vec3 uAtmo;
uniform float uHaze;
uniform float uSeed;
uniform float uHover;
uniform float uSpin;
uniform float uCloudShadow;
uniform vec3 uCenter;
uniform vec3 uRingNormal;
uniform vec3 uRingInfo;

varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;

${NOISE}

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

// Rotates p around the unit axis c, more the closer it is to c: the spiral of a storm.
vec3 swirl(vec3 p, vec3 c, float radius, float strength) {
  float a = strength * smoothstep(radius, 0.0, distance(p, c));
  return p * cos(a) + cross(c, p) * sin(a) + c * dot(c, p) * (1.0 - cos(a));
}

// Terrace level of a block on the voxel world.
float blockLevel(vec3 cell, float res) {
  float h = fbm3(normalize((cell + 0.5) / res) * 1.7 + uSeed) + 0.1;
  return max(floor(h * 7.0), -1.0);
}

void main() {
  vec3 p = normalize(vObj);
  vec3 Ng = normalize(vNormalW);
  vec3 N = Ng;
  vec3 L = normalize(uSunPos - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndlGeo = dot(Ng, L);

  vec3 albedo = uC0;
  vec3 emissive = vec3(0.0);
  float spec = 0.0;
  float gloss = 30.0;
  float nightOnly = 0.0;
  float groundShadow = 1.0;

  if (uKind == 0) {
    // Home world: warped continents, biomes by latitude and moisture, mountains with snow, polar ice.
    vec3 wq = p * 1.3 + uSeed;
    vec3 warp = vec3(snoise(wq + 1.7), snoise(wq + 9.2), snoise(wq + 4.4));
    float h = fbm(p * 1.8 + warp * 0.45 + uSeed) + 0.16 * snoise(p * 7.0 + uSeed);
    float land = smoothstep(0.0, 0.025, h);
    float coast = land * (1.0 - smoothstep(0.025, 0.08, h));
    float lat = abs(p.y);
    vec3 ocean = mix(uC0, uC1, smoothstep(-0.5, 0.0, h));
    ocean = mix(ocean, vec3(0.1, 0.55, 0.62), smoothstep(-0.07, 0.0, h) * 0.55);
    float moist = snoise(p * 2.6 + 21.0 + uSeed) + (lat - 0.32) * 1.3;
    vec3 ground = mix(vec3(0.74, 0.6, 0.38), uC2, smoothstep(-0.25, 0.2, moist));
    ground = mix(ground, vec3(0.46, 0.5, 0.42), smoothstep(0.55, 0.75, lat + 0.05 * snoise(p * 9.0)));
    ground = mix(ground, uC3, smoothstep(0.28, 0.48, h));
    float snowLine = 0.52 - lat * 0.3;
    ground = mix(ground, uC4, smoothstep(snowLine, snowLine + 0.05, h));
    ground = mix(ground, vec3(0.86, 0.8, 0.6), coast * 0.55);
    float ice = smoothstep(0.82, 0.9, lat + 0.07 * snoise(p * 7.0 + 3.0));
    albedo = mix(ocean, ground, land);
    albedo = mix(albedo, uC4, ice);
    spec = (1.0 - land) * (1.0 - ice) * 1.1;
    gloss = 90.0;
    // mountains read through colour and a little shading instead of bump mapping (which showed steps)
    albedo *= 1.0 - 0.25 * smoothstep(0.2, 0.6, h) * (0.5 + 0.5 * snoise(p * 24.0 + uSeed));
    if (uCloudShadow > 0.0) {
      groundShadow = 1.0 - 0.55 * cloudDensity(rotY(p, uSpin), uTime * 0.012, uSeed, 0.0);
    }
    float city = smoothstep(0.5, 0.85, snoise(p * 42.0 + 5.0)) * smoothstep(0.2, 0.9, snoise(p * 6.0 + 11.0) + coast);
    emissive = vec3(1.0, 0.68, 0.32) * land * (1.0 - ice) * city * 0.9;
    nightOnly = 1.0;
  } else if (uKind == 1) {
    // Crystal world: facets with an oily sheen and glowing, pulsing seams.
    vec3 w = worley(p * 3.4 + uSeed);
    float edge = 1.0 - smoothstep(0.0, 0.065, w.y - w.x);
    vec3 hc = hash33(vec3(w.z * 17.0, w.z * 41.0, w.z * 89.0));
    N = normalize(Ng + (hc - 0.5) * 0.9);
    float facing = max(dot(N, V), 0.0);
    vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + facing * 1.2 + hc.x * 0.5));
    albedo = mix(uC0, uC1, hc.x);
    albedo = mix(albedo, uC2, smoothstep(0.75, 1.0, hc.y));
    albedo = mix(albedo, albedo * irid * 1.5, 0.35);
    spec = 1.6;
    gloss = 120.0;
    float pulse = 0.6 + 0.4 * sin(uTime * 1.5 + hc.z * 6.2831);
    emissive = uC3 * (edge * 1.5 * pulse + 0.05) + uC1 * pow(1.0 - facing, 3.0) * 0.3;
  } else if (uKind == 2) {
    // Lava world: crust plates drifting on molten rock, glowing seams, cracks and lakes.
    vec3 q = p * 2.0 + uSeed;
    float f = fbm(q + vec3(0.0, uTime * 0.012, 0.0));
    vec3 w = worley(q * 1.5 + vec3(0.0, uTime * 0.01, 0.0));
    float seam = 1.0 - smoothstep(0.0, 0.11, w.y - w.x);
    float r = 1.0 - abs(snoise(q * 2.3 + f * 1.3));
    float cracks = max(pow(r, 10.0), seam * 0.85);
    float lake = smoothstep(0.3, 0.58, -f);
    float flow = fbm3(q * 3.0 + vec3(uTime * 0.06, 0.0, uTime * 0.03));
    float pulse = 0.8 + 0.2 * sin(uTime * 1.3 + f * 9.0);
    albedo = mix(uC0, uC1, smoothstep(-0.35, 0.45, f)) * (1.0 - lake) * (0.85 + 0.3 * w.z);
    emissive = mix(uC2, uC3, cracks) * cracks * 3.0 * pulse;
    emissive += mix(uC2, uC3, 0.35 + 0.45 * flow) * lake * (1.5 + 0.8 * flow) * pulse;
    emissive += uC2 * smoothstep(0.55, 1.0, r) * 0.25;
    N = perturb(Ng, f * 0.6 - cracks * 0.2, 0.4);
    spec = 0.2;
    gloss = 20.0;
  } else if (uKind == 3) {
    // Gas giant: banded flow, warped by turbulence and spun into two storms.
    float t = uTime * 0.01;
    vec3 s1 = normalize(vec3(0.62, -0.34, 0.7));
    vec3 s2 = normalize(vec3(-0.5, 0.42, -0.75));
    vec3 q = swirl(p, s1, 0.34, 2.8);
    q = swirl(q, s2, 0.22, -2.2);
    float warp = fbm(vec3(q.x * 1.6 + t, q.y * 7.0, q.z * 1.6 - t) + uSeed);
    float warp2 = snoise(vec3(q.x * 4.0 - t * 2.0, q.y * 18.0 + warp, q.z * 4.0));
    float y = (q.y + warp * 0.07 + warp2 * 0.012) * 5.5;
    vec3 c = mix(uC0, uC1, 0.5 + 0.5 * sin(y * 3.1));
    c = mix(c, uC2, smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(y * 7.3 + 1.0)) * 0.6);
    c = mix(c, uC4, smoothstep(0.6, 1.0, 0.5 + 0.5 * sin(y * 1.7 + 2.0)) * 0.5);
    c = mix(c, uC3, smoothstep(0.17, 0.0, distance(p, s1)) * 0.85);
    c = mix(c, mix(uC3, uC2, 0.5), smoothstep(0.1, 0.0, distance(p, s2)) * 0.7);
    albedo = c * mix(0.62, 1.0, pow(max(dot(Ng, V), 0.0), 0.35));
    spec = 0.06;
    gloss = 12.0;
  } else if (uKind == 4) {
    // Voxel world: the sphere sampled on a block grid, with terraces that cast and catch light.
    vec3 a = abs(p);
    vec3 cube = p / max(a.x, max(a.y, a.z));
    float res = 12.0;
    vec3 U;
    vec3 W;
    if (a.x >= a.y && a.x >= a.z) { U = vec3(0.0, 1.0, 0.0); W = vec3(0.0, 0.0, 1.0); }
    else if (a.y >= a.z) { U = vec3(1.0, 0.0, 0.0); W = vec3(0.0, 0.0, 1.0); }
    else { U = vec3(1.0, 0.0, 0.0); W = vec3(0.0, 1.0, 0.0); }
    vec3 cell = floor(cube * res);
    float lv = blockLevel(cell, res);
    float lu1 = blockLevel(cell + U, res);
    float lu0 = blockLevel(cell - U, res);
    float lw1 = blockLevel(cell + W, res);
    float lw0 = blockLevel(cell - W, res);
    vec3 fr = fract(cube * res);
    float fu = dot(fr, U);
    float fw = dot(fr, W);
    vec3 c;
    if (lv < 0.0) {
      c = uC0 * (0.85 + 0.15 * sin(uTime * 1.2 + (cell.x + cell.y + cell.z) * 0.9));
      spec = 0.8;
      gloss = 60.0;
    } else if (lv < 1.0) {
      c = uC1;
    } else if (lv < 3.0) {
      c = uC2;
    } else if (lv < 4.0) {
      c = uC3;
    } else {
      c = uC4;
    }
    c *= 0.88 + 0.2 * hash13(cell + uSeed);
    c *= 0.93 + 0.12 * hash13(floor(cube * res * 4.0));
    // Edges: next to a higher block it's in shadow, next to a lower one we see the block's side.
    vec3 Uw = normalize(mat3(modelMatrix) * U);
    vec3 Ww = normalize(mat3(modelMatrix) * W);
    float e1 = smoothstep(0.78, 1.0, fu);
    float e0 = smoothstep(0.22, 0.0, fu);
    float g1 = smoothstep(0.78, 1.0, fw);
    float g0 = smoothstep(0.22, 0.0, fw);
    float shade = 1.0;
    shade -= 0.4 * (step(lv + 0.5, lu1) * e1 + step(lv + 0.5, lu0) * e0 + step(lv + 0.5, lw1) * g1 + step(lv + 0.5, lw0) * g0);
    shade += 0.55 * (step(lu1 + 0.5, lv) * e1 * dot(Uw, L) + step(lu0 + 0.5, lv) * e0 * dot(-Uw, L)
                   + step(lw1 + 0.5, lv) * g1 * dot(Ww, L) + step(lw0 + 0.5, lv) * g0 * dot(-Ww, L));
    float edge = min(min(fu, 1.0 - fu), min(fw, 1.0 - fw));
    albedo = c * clamp(shade, 0.4, 1.45) * (0.82 + 0.18 * smoothstep(0.0, 0.06, edge));
    if (uCloudShadow > 0.0) {
      groundShadow = 1.0 - 0.45 * cloudDensity(rotY(p, uSpin), uTime * 0.02, uSeed, 1.0);
    }
  } else if (uKind == 5) {
    // Circuit world: copper traces, pads, chips with pins, blinking LEDs and pulses running along the traces.
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
    float lvv = 1.0 - smoothstep(lw, lw + 0.03, abs(f.x));
    float trace;
    if (r < 0.3) trace = lh;
    else if (r < 0.6) trace = lvv;
    else if (r < 0.8) trace = max(lh * step(0.0, f.x), lvv * step(0.0, f.y));
    else trace = max(lh * step(f.x, 0.0), lvv * step(f.y, 0.0));
    trace *= step(0.12, r2);
    float pad = (1.0 - smoothstep(0.12, 0.16, length(f))) * step(0.7, r2);
    vec2 cg = uv * 2.5;
    vec2 cf = fract(cg) - 0.5;
    float chipOn = step(0.72, hash13(vec3(floor(cg), face + 11.0) + uSeed));
    float cm = max(abs(cf.x), abs(cf.y));
    float chip = chipOn * (1.0 - smoothstep(0.26, 0.28, cm));
    float along = abs(cf.x) > abs(cf.y) ? cf.y : cf.x;
    float pins = chipOn * smoothstep(0.27, 0.29, cm) * (1.0 - smoothstep(0.33, 0.35, cm)) * step(0.5, fract(along * 14.0));
    float n = fbm3(p * 3.0 + uSeed);
    float metal = max(max(trace, pad), pins) * (1.0 - chip);
    albedo = uC0 * (0.85 + 0.3 * n);
    albedo = mix(albedo, uC1, metal);
    albedo = mix(albedo, uC2, chip);
    float pulse = pow(0.5 + 0.5 * sin((gv.x + gv.y) * 0.7 - uTime * 2.2 + r * 6.2831), 12.0);
    float led = pad * step(0.86, r2) * step(0.5, fract(uTime * (0.4 + r) + r * 7.0));
    emissive = uC3 * (trace * (0.14 + 2.0 * pulse) + pad * 0.4) * (1.0 - chip);
    emissive += uC4 * led * 2.5;
    emissive += uC3 * chipOn * smoothstep(0.235, 0.255, cm) * (1.0 - smoothstep(0.27, 0.285, cm)) * 0.5;
    spec = 0.7 * metal + 0.5 * chip;
    gloss = 60.0;
  } else if (uKind == 6) {
    // Ringed world: soft pastel bands with a little turbulence.
    float t = uTime * 0.006;
    float turb = fbm(vec3(p.x * 1.6 + t, p.y * 6.5, p.z * 1.6) + uSeed);
    float y = p.y * 10.0 + turb * 1.7;
    albedo = mix(uC0, uC1, 0.5 + 0.5 * sin(y));
    albedo = mix(albedo, uC2, (0.5 + 0.5 * sin(y * 2.4 + 0.6)) * 0.35);
    albedo = mix(albedo, uC3, smoothstep(0.72, 0.95, abs(p.y)) * 0.7);
    albedo *= mix(0.7, 1.0, pow(max(dot(Ng, V), 0.0), 0.35));
    spec = 0.05;
    gloss = 10.0;
  } else if (uKind == 7) {
    // Ice world: cracked ice with deep blue in the cracks and frost that glitters.
    vec3 w = worley(p * 4.2 + uSeed);
    float cracks = 1.0 - smoothstep(0.0, 0.06, w.y - w.x);
    float n = fbm(p * 2.6 + uSeed);
    albedo = mix(uC0, uC1, smoothstep(-0.3, 0.5, n));
    albedo = mix(albedo, uC2, cracks * 0.75);
    spec = 0.6;
    gloss = 80.0;
    emissive = uC2 * cracks * 0.18;
  } else {
    // Moon: dusty rock with craters.
    float n = fbm(p * 2.8 + uSeed);
    vec3 w = worley(p * 4.5 + uSeed);
    float crater = smoothstep(0.32, 0.0, w.x);
    float rim = smoothstep(0.22, 0.32, w.x) * smoothstep(0.42, 0.32, w.x);
    albedo = mix(uC0, uC1, smoothstep(-0.4, 0.5, n)) * (0.85 - crater * 0.25 + rim * 0.3);
    spec = 0.05;
  }

  float day = smoothstep(-0.18, 0.22, ndlGeo);
  float diffuse = max(dot(N, L), 0.0) * smoothstep(-0.12, 0.18, ndlGeo);

  // Shadow of the ring on the planet.
  float shadow = groundShadow;
  if (uRingInfo.z > 0.5) {
    float denom = dot(L, uRingNormal);
    if (abs(denom) > 1e-3) {
      float t = dot(uCenter - vWorld, uRingNormal) / denom;
      if (t > 0.0) {
        float rr = (length(vWorld + L * t - uCenter) - uRingInfo.x) / (uRingInfo.y - uRingInfo.x);
        if (rr > 0.0 && rr < 1.0) shadow *= 1.0 - 0.6 * ringDensity(rr);
      }
    }
  }

  // The sun turns warm close to the terminator, like a sunset seen from orbit.
  vec3 sunCol = mix(vec3(1.0, 0.5, 0.24), vec3(1.0, 0.96, 0.9), smoothstep(0.0, 0.4, ndlGeo)) * 1.18;
  vec3 col = albedo * (uAtmo * 0.01 + vec3(0.008, 0.009, 0.016) + diffuse * shadow * sunCol);
  vec3 H = normalize(L + V);
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  col += spec * (0.6 + 2.0 * fresnel) * pow(max(dot(N, H), 0.0), gloss) * diffuse * shadow * sunCol;
  col += emissive * mix(1.0, 1.0 - day, nightOnly);

  // Atmosphere: haze over the day side towards the limb, a bright rim and a sunset band along the terminator.
  float nv = max(dot(Ng, V), 0.0);
  float limb = pow(1.0 - nv, 2.4);
  float lit = smoothstep(-0.25, 0.45, ndlGeo);
  col = mix(col, uAtmo * sunCol * 0.55, limb * uHaze * lit * 0.75);
  float rim = pow(1.0 - nv, 4.0);
  col += uAtmo * rim * (0.06 + 1.1 * lit) * uHaze;
  col += vec3(1.0, 0.42, 0.2) * rim * exp(-pow(ndlGeo / 0.14, 2.0)) * 0.7 * uHaze;
  col += uAtmo * rim * uHover * 0.9;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const ATMO_VERTEX = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vObj;
void main() {
  vObj = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// Rendered on the back faces of a slightly larger sphere: a soft halo strongest just outside the planet's edge,
// warm where the light grazes the terminator.
const ATMO_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSunPos;
uniform float uStrength;
uniform float uSunset;
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
  float ndl = dot(N, L);
  float lit = 0.1 + 0.9 * smoothstep(-0.35, 0.6, ndl);
  vec3 col = uColor * glow * (lit * uStrength + uHover * 0.7);
  col += vec3(1.0, 0.45, 0.2) * glow * exp(-pow(ndl / 0.2, 2.0)) * 0.6 * uSunset * uStrength;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// A transparent shell a little above the ground: real depth for clouds, and the shadow is cast below.
const CLOUD_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uSeed;
uniform float uBlocky;
uniform vec3 uSunPos;
uniform float uOpacity;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vObj;
${NOISE}
void main() {
  vec3 p = normalize(vObj);
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunPos - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float d = cloudDensity(p, uTime * uSpeed, uSeed, uBlocky);
  float ndl = dot(N, L);
  vec3 sunCol = mix(vec3(1.0, 0.5, 0.26), vec3(1.0, 0.97, 0.93), smoothstep(0.0, 0.4, ndl)) * 1.3;
  float lit = smoothstep(-0.12, 0.3, ndl);
  vec3 col = vec3(0.97, 0.98, 1.0) * (0.015 + lit * sunCol);
  float alpha = d * uOpacity * smoothstep(0.0, 0.22, dot(N, V));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Auroras on a shell around the poles: curtains that move, brightest along the edge where you look through
// most of them. Drawn on both sides, so the far half shows behind the near one.
const AURORA_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uSunPos;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vObj;
${NOISE}
void main() {
  vec3 p = normalize(vObj);
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uSunPos - vWorld);
  float lon = atan(p.z, p.x);
  float lat = abs(p.y);
  float cur = fbm3(vec3(cos(lon) * 2.0, sin(lon) * 2.0, uTime * 0.1) + uSeed);
  float ring = exp(-pow((lat - 0.74 - cur * 0.06) / 0.055, 2.0));
  float curtains = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(lon * 26.0 + cur * 9.0 + uTime * 0.5), 3.0);
  float graze = pow(1.0 - abs(dot(N, V)), 1.5);
  float night = 1.0 - 0.55 * smoothstep(-0.2, 0.5, dot(N, L));
  vec3 col = mix(uC0, uC1, smoothstep(-0.2, 0.6, cur + (lat - 0.74) * 6.0));
  col *= ring * curtains * (0.35 + 1.6 * graze) * night * 1.5;
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
  vec3 V = normalize(cameraPosition - vWorld);
  float lit = 0.25 + 0.75 * abs(dot(uNormal, L));
  // seen against the sun, thin rings light up (forward scattering)
  lit += pow(max(dot(-V, L), 0.0), 6.0) * (1.0 - dens) * 1.2;
  vec3 oc = vWorld - uCenter;
  float b = dot(oc, L);
  float perp = sqrt(max(dot(oc, oc) - b * b, 0.0));
  float shadow = b < 0.0 ? mix(1.0, 0.1, smoothstep(uRadius * 1.02, uRadius * 0.94, perp)) : 1.0;
  // a faint glitter of the ring particles
  float glint = step(0.985, hash13(vec3(floor(vLocal * 60.0), 1.0))) * 0.8;
  vec3 c = col * (lit + glint) * shadow * 1.2 + col * uHover * 0.25;
  gl_FragColor = vec4(c, dens * 0.9);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SurfaceOptions {
  kind: SurfaceKind;
  colors: string[];
  atmo: string;
  haze: number;
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
      uHaze: { value: opts.haze },
      uSeed: { value: opts.seed },
      uHover: { value: 0 },
      uSpin: { value: 0 },
      uCloudShadow: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
      uRingInfo: { value: new THREE.Vector3(0, 1, 0) },
    },
  });
}

export function createAtmosphereMaterial(color: string, strength: number, scale: number, sunset: number) {
  return new THREE.ShaderMaterial({
    vertexShader: ATMO_VERTEX,
    fragmentShader: ATMO_FRAGMENT,
    uniforms: {
      uColor: { value: toColor(color) },
      uSunPos: { value: new THREE.Vector3() },
      uStrength: { value: strength },
      uSunset: { value: sunset },
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

export function createCloudMaterial(opts: { seed: number; speed: number; blocky: boolean; opacity: number; octaves: number }) {
  return new THREE.ShaderMaterial({
    vertexShader: ATMO_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    defines: { OCTAVES: opts.octaves },
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: opts.speed },
      uSeed: { value: opts.seed },
      uBlocky: { value: opts.blocky ? 1 : 0 },
      uSunPos: { value: new THREE.Vector3() },
      uOpacity: { value: opts.opacity },
    },
    transparent: true,
    depthWrite: false,
  });
}

export function createAuroraMaterial(colors: [string, string], seed: number) {
  return new THREE.ShaderMaterial({
    vertexShader: ATMO_VERTEX,
    fragmentShader: AURORA_FRAGMENT,
    defines: { OCTAVES: 3 },
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
      uC0: { value: toColor(colors[0]) },
      uC1: { value: toColor(colors[1]) },
      uSunPos: { value: new THREE.Vector3() },
    },
    side: THREE.DoubleSide,
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
