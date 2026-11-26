import * as THREE from "three";

// Small drawing helpers for glowing things: line segments (laser bolts, engine trails, shooting stars)
// and soft round glows (engines, sparks, explosions). Sizes are given in world units and stay at least
// a few pixels wide on screen, so nothing flickers away when it is far off.

/** The drawing buffer size in device pixels (kept up to date by the universe on resize). */
export const resolution = { value: new THREE.Vector2(1, 1) };

const STREAK_VERTEX = /* glsl */ `
attribute vec2 aCorner;
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec4 aColor;
attribute vec3 aShape;
uniform vec2 uResolution;
uniform float uMinPx;
varying vec2 vCorner;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mvH = modelViewMatrix * vec4(aStart, 1.0);
  vec4 mvT = modelViewMatrix * vec4(aEnd, 1.0);
  if (mvH.z > -0.05 || mvT.z > -0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 ch = projectionMatrix * mvH;
  vec4 ct = projectionMatrix * mvT;
  vec2 halfRes = 0.5 * uResolution;
  vec2 d = (ch.xy / ch.w - ct.xy / ct.w) * halfRes;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float scale = length(modelMatrix[0].xyz);
  float focal = projectionMatrix[1][1] * halfRes.y;
  float w = mix(aShape.x / -mvH.z, aShape.y / -mvT.z, aCorner.x) * scale * focal;
  float wPx = max(w, uMinPx);
  vec4 c = mix(ch, ct, aCorner.x);
  float cap = aCorner.x < 0.5 ? 1.0 : -1.0;
  c.xy += (n * aCorner.y + dir * cap) * wPx * 0.5 / halfRes * c.w;
  gl_Position = c;
  vCorner = aCorner;
  vColor = aColor.rgb;
  vAlpha = aColor.a * mix(1.0, aShape.z, aCorner.x) * clamp(w / wPx, 0.35, 1.0);
}
`;

const STREAK_FRAGMENT = /* glsl */ `
uniform float uCore;
varying vec2 vCorner;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float across = 1.0 - abs(vCorner.y);
  float glow = across * across;
  float hot = smoothstep(0.45, 1.0, across) * uCore;
  gl_FragColor = vec4((vColor * glow + vec3(hot)) * vAlpha, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** A quad per segment, expanded across the segment in screen space. */
export function quadGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("aCorner", new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  return g;
}

export class StreakBatch {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private count = 0;
  private start: THREE.InstancedBufferAttribute;
  private end: THREE.InstancedBufferAttribute;
  private color: THREE.InstancedBufferAttribute;
  private shape: THREE.InstancedBufferAttribute;

  constructor(
    readonly capacity: number,
    opts: { core?: number; minPx?: number; depthTest?: boolean } = {},
  ) {
    const g = quadGeometry();
    const attr = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);
    this.start = attr(3);
    this.end = attr(3);
    this.color = attr(4);
    this.shape = attr(3);
    g.setAttribute("aStart", this.start);
    g.setAttribute("aEnd", this.end);
    g.setAttribute("aColor", this.color);
    g.setAttribute("aShape", this.shape);
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        vertexShader: STREAK_VERTEX,
        fragmentShader: STREAK_FRAGMENT,
        uniforms: { uResolution: resolution, uMinPx: { value: opts.minPx ?? 1.5 }, uCore: { value: opts.core ?? 0 } },
        transparent: true,
        depthWrite: false,
        depthTest: opts.depthTest ?? true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
  }

  begin() {
    this.count = 0;
  }

  /** head (start) → tail (end); alpha at the head, `tailAlpha` is a factor at the tail */
  push(
    sx: number,
    sy: number,
    sz: number,
    ex: number,
    ey: number,
    ez: number,
    color: THREE.Color,
    alpha: number,
    widthHead: number,
    widthTail = widthHead,
    tailAlpha = 1,
  ) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.start.setXYZ(i, sx, sy, sz);
    this.end.setXYZ(i, ex, ey, ez);
    this.color.setXYZW(i, color.r, color.g, color.b, alpha);
    this.shape.setXYZ(i, widthHead, widthTail, tailAlpha);
  }

  finish() {
    for (const a of [this.start, this.end, this.color, this.shape]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
    this.mesh.geometry.instanceCount = this.count;
  }
}

const GLOW_VERTEX = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform vec2 uResolution;
uniform float uMinPx;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float scale = length(modelMatrix[0].xyz);
  float px = aSize * scale * projectionMatrix[1][1] * 0.5 * uResolution.y / max(-mv.z, 1e-3);
  float size = max(px, uMinPx);
  gl_PointSize = min(size, 600.0);
  vColor = aColor.rgb * aColor.a * clamp(px / size, 0.3, 1.0);
  if (mv.z > -0.05) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const GLOW_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 4.5) * 0.7 + exp(-r2 * 24.0) * 0.6;
  gl_FragColor = vec4(vColor * a * (1.0 - r2), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class GlowPoints {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private count = 0;
  private position: THREE.BufferAttribute;
  private color: THREE.BufferAttribute;
  private size: THREE.BufferAttribute;

  constructor(
    readonly capacity: number,
    opts: { minPx?: number } = {},
  ) {
    const g = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.BufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.size = new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.position);
    g.setAttribute("aColor", this.color);
    g.setAttribute("aSize", this.size);
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        vertexShader: GLOW_VERTEX,
        fragmentShader: GLOW_FRAGMENT,
        uniforms: { uResolution: resolution, uMinPx: { value: opts.minPx ?? 2 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
  }

  begin() {
    this.count = 0;
  }

  push(x: number, y: number, z: number, r: number, g: number, b: number, alpha: number, size: number) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.position.setXYZ(i, x, y, z);
    this.color.setXYZW(i, r, g, b, alpha);
    this.size.setX(i, size);
  }

  finish() {
    for (const a of [this.position, this.color, this.size]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
    this.points.geometry.setDrawRange(0, this.count);
  }
}
