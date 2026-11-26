import * as THREE from "three";

// The start of the page: right after the drop out of hyperspace the name is written in the stars. Stars light up all
// over the sky, then drift together, swirling in from left to right, until they spell the name; it hangs there as a
// constellation for a moment before the page text takes over. The stars fly to points sampled from the real heading,
// so the text appears exactly where they are.

export interface NameIntroOptions {
  /** where the particles end up: x, y pairs in CSS pixels of the viewport */
  points: Float32Array;
  /** the heading's box (CSS pixels) */
  rect: { left: number; top: number; width: number; height: number };
  viewport: { width: number; height: number };
  /** the size of a particle once the name has formed (CSS pixels) */
  dot: number;
  /** called once, when the name is complete: the page shows its text and the particles fade */
  onReveal: () => void;
}

/** how long the finished name stays written in the stars before the text takes over (seconds) */
const HOLD = 1.2;

const VERTEX = /* glsl */ `
attribute vec2 aStart;
attribute vec2 aCtrl;
attribute vec2 aTarget;
attribute vec3 aTime; // lights up, leaves, takes (seconds)
attribute float aSeed;
uniform float uTime;
uniform float uFade;
uniform float uDot;
uniform float uPx;
uniform vec2 uViewport;
varying vec3 vColor;
void main() {
  float shown = smoothstep(aTime.x, aTime.x + 0.6, uTime);
  float k = clamp((uTime - aTime.y) / aTime.z, 0.0, 1.0);
  // a star leaves its place slowly, glides, and settles into its letter
  float e = k < 0.5 ? 4.0 * k * k * k : 1.0 - pow(-2.0 * k + 2.0, 3.0) * 0.5;
  vec2 p = mix(mix(aStart, aCtrl, e), mix(aCtrl, aTarget, e), e);
  float settled = smoothstep(0.85, 1.0, k);
  p += vec2(sin(uTime * 1.7 + aSeed * 40.0), cos(uTime * 1.3 + aSeed * 31.0)) * 0.3 * settled;
  gl_Position = vec4(p.x / uViewport.x * 2.0 - 1.0, 1.0 - p.y / uViewport.y * 2.0, 0.0, 1.0);
  // stars of every brightness: most small, a few bright ones stand out (in the sky and in the name)
  float mag = pow(fract(aSeed * 7.13), 3.0);
  float star = mix(1.1, 2.8, mag);
  float placed = uDot * mix(0.6, 1.3, mag);
  gl_PointSize = max(mix(star, placed, smoothstep(0.3, 1.0, k)), 1.0) * uPx;
  float twinkle = 0.62 + 0.38 * sin(uTime * (1.4 + fract(aSeed * 13.7) * 3.6) + aSeed * 60.0);
  float flight = sin(3.14159 * k);
  vec3 tint = mix(vec3(0.74, 0.86, 1.32), vec3(1.26, 1.02, 0.8), fract(aSeed * 3.71));
  vec3 c = mix(tint, vec3(1.2, 1.08, 0.96), settled * 0.55) * (twinkle + 0.9 * flight) * (1.0 + 0.6 * mag * settled);
  vColor = c * 1.25 * shown * uFade;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float a = (1.0 - r2) * (1.0 - r2);
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class NameIntro {
  readonly group = new THREE.Group();
  readonly revealAt: number;
  done = false;
  private time = 0;
  private revealed = false;
  private endAt: number;
  private particles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor(private opts: NameIntroOptions) {
    const { rect, viewport: vp } = opts;
    const W = vp.width;
    const H = vp.height;
    const n = opts.points.length / 2;
    const start = new Float32Array(n * 2);
    const ctrl = new Float32Array(n * 2);
    const target = new Float32Array(n * 2);
    const time = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const tx = opts.points[i * 2];
      const ty = opts.points[i * 2 + 1];
      // A star somewhere in the sky (a few just outside it, drifting in).
      const sx = (Math.random() * 1.1 - 0.05) * W;
      const sy = (Math.random() * 1.1 - 0.05) * H;
      // All paths bend the same way: the stars swirl in.
      const dx = tx - sx;
      const dy = ty - sy;
      const bend = 0.18 + Math.random() * 0.22;
      const cx = (sx + tx) / 2 - dy * bend;
      const cy = (sy + ty) / 2 + dx * bend;
      // The stars light up as the drop out of hyperspace ends; then the name is written from left to right.
      const along = THREE.MathUtils.clamp((tx - rect.left) / Math.max(1, rect.width), 0, 1);
      const appear = 0.7 + Math.random() * 0.5;
      const leave = 1.1 + along * 0.55 + Math.random() * 0.3;
      const takes = 0.95 + Math.random() * 0.4;
      start.set([sx, sy], i * 2);
      ctrl.set([cx, cy], i * 2);
      target.set([tx, ty], i * 2);
      time.set([appear, leave, takes], i * 3);
      seed[i] = Math.random();
      last = Math.max(last, leave + takes);
    }
    this.revealAt = (n ? last : 1) + HOLD;
    this.endAt = this.revealAt + 1.0;

    const g = new THREE.BufferGeometry();
    // (position is unused by the shader but three.js needs it for the draw count)
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aStart", new THREE.BufferAttribute(start, 2));
    g.setAttribute("aCtrl", new THREE.BufferAttribute(ctrl, 2));
    g.setAttribute("aTarget", new THREE.BufferAttribute(target, 2));
    g.setAttribute("aTime", new THREE.BufferAttribute(time, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.particles = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uFade: { value: 1 },
          uDot: { value: opts.dot },
          uPx: { value: 1 },
          uViewport: { value: new THREE.Vector2(W, H) },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 30;
    this.group.add(this.particles);
  }

  /** (the stars live in screen space: the camera's flight doesn't move them) */
  update(dt: number, _camera: THREE.PerspectiveCamera, pixelRatio: number) {
    if (this.done) return;
    this.time += dt;
    const t = this.time;
    const uni = this.particles.material.uniforms;
    uni.uTime.value = t;
    uni.uPx.value = pixelRatio;
    uni.uFade.value = 1 - THREE.MathUtils.smoothstep(t, this.revealAt, this.revealAt + 0.8);
    if (!this.revealed && t >= this.revealAt) {
      this.revealed = true;
      this.opts.onReveal();
    }
    if (t >= this.endAt) this.done = true;
  }

  /** Stops at once (the page shows its text without waiting). */
  finish() {
    this.done = true;
  }

  dispose() {
    this.group.removeFromParent();
    this.particles.geometry.dispose();
    this.particles.material.dispose();
  }
}
