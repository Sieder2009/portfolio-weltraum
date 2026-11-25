// Shared GLSL helpers. 3D simplex noise after Ian McEwan / Stefan Gustavson (MIT licence).

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

#ifndef OCTAVES
#define OCTAVES 5
#endif

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < OCTAVES; i++) {
    sum += amp * snoise(p);
    p = p * 2.03 + vec3(17.1, -3.7, 9.2);
    amp *= 0.5;
  }
  return sum;
}

// Three octaves, for lookups that run several times per pixel.
float fbm3(vec3 p) {
  return 0.5 * snoise(p) + 0.25 * snoise(p * 2.03 + vec3(17.1, -3.7, 9.2)) + 0.125 * snoise(p * 4.12 + vec3(-5.3, 8.1, 2.2));
}

vec3 rotY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Cellular noise: distance to the nearest and second nearest feature point, and an id for the nearest cell.
vec3 worley(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 b = vec3(float(x), float(y), float(z));
    vec3 r = b + hash33(i + b) - f;
    float d = dot(r, r);
    if (d < d1) {
      d2 = d1;
      d1 = d;
      id = hash13(i + b + 0.5);
    } else if (d < d2) {
      d2 = d;
    }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}

// Ring density across the ring (0 inner edge, 1 outer edge), shared by the ring and the shadow it casts.
float ringDensity(float r) {
  float b = 0.55 + 0.3 * snoise(vec3(r * 22.0, 1.7, 3.1)) + 0.15 * snoise(vec3(r * 95.0, 4.2, 1.0));
  b *= smoothstep(0.0, 0.05, r) * smoothstep(1.0, 0.88, r);
  b *= 1.0 - 0.93 * exp(-pow((r - 0.62) / 0.028, 2.0));
  b *= 1.0 - 0.7 * exp(-pow((r - 0.86) / 0.007, 2.0));
  b *= mix(1.0, 0.55, smoothstep(0.62, 0.68, r));
  return clamp(b, 0.0, 1.0);
}

// Clouds, shared by the cloud shell and the shadow it casts on the ground. Blocky = sampled on a block grid.
float cloudDensity(vec3 q, float t, float seed, float blocky) {
  vec3 r = rotY(q, t);
  if (blocky > 0.5) {
    vec3 a = abs(r);
    vec3 cube = r / max(a.x, max(a.y, a.z));
    r = normalize((floor(cube * 7.0) + 0.5) / 7.0);
    return step(0.3, fbm3(r * 2.2 + 9.0 + seed));
  }
  vec3 w = vec3(snoise(r * 1.4 + seed + 2.0), snoise(r * 1.4 + seed + 7.0), snoise(r * 1.4 + seed + 4.0));
  float c = fbm(r * 2.4 + w * 0.45 + seed + 31.0);
  c += 0.12 * sin(r.y * 9.0 + c * 3.0);
  return smoothstep(0.04, 0.5, c);
}
`;

export const SURFACE_VERTEX = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vObj = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;
