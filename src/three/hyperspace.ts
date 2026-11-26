import * as THREE from "three";
import { quadGeometry, resolution } from "./fx";

// The jump to lightspeed between two planets: stars stretch into lines that rush past the camera,
// the picture blurs outward from the vanishing point, and a flash marks the jump in and the drop out.

const TUNNEL_VERTEX = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aStreak; // angle around the view axis, distance from it, depth seed, brightness
attribute vec3 aColor;
uniform float uTravel;
uniform float uWarp;
uniform float uDepth;
uniform float uNear;
uniform float uLength;
uniform float uPx;
uniform vec2 uResolution;
varying vec2 vCorner;
varying vec3 vColor;
void main() {
  // (the mesh follows the camera, so this is camera space: the streaks fly along -z toward the viewer)
  float z = uNear + mod(aStreak.z * uDepth - uTravel, uDepth);
  vec2 xy = vec2(cos(aStreak.x), sin(aStreak.x)) * aStreak.y;
  float stretch = uLength * uWarp * uWarp * (0.55 + 0.9 * aStreak.w);
  vec4 ch = projectionMatrix * modelViewMatrix * vec4(xy, -z, 1.0);
  vec4 ct = projectionMatrix * modelViewMatrix * vec4(xy, -(z + stretch), 1.0);
  vec2 halfRes = 0.5 * uResolution;
  vec2 d = (ch.xy / ch.w - ct.xy / ct.w) * halfRes;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float w = (1.1 + 1.9 * aStreak.w) * uPx;
  vec4 c = mix(ch, ct, aCorner.x);
  float cap = aCorner.x < 0.5 ? 1.0 : -1.0;
  c.xy += (n * aCorner.y + dir * cap) * w * 0.5 / halfRes * c.w;
  gl_Position = c;
  vCorner = aCorner;
  // (far streaks bunch up around the vanishing point: they fade out early, or the centre turns into a white blob)
  float fade = smoothstep(uNear + uDepth, uNear + uDepth * 0.3, z) * smoothstep(uNear, uNear + 12.0, z);
  vColor = aColor * fade * smoothstep(0.0, 0.3, uWarp) * (0.5 + 1.5 * aStreak.w) * mix(0.6, 1.15, uWarp);
}
`;

const TUNNEL_FRAGMENT = /* glsl */ `
varying vec2 vCorner;
varying vec3 vColor;
void main() {
  float across = 1.0 - abs(vCorner.y);
  float along = mix(1.0, 0.15, vCorner.x);
  vec3 col = vColor * across * across * along + vec3(smoothstep(0.6, 1.0, across) * along * 0.6) * length(vColor) * 0.4;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Hyperspace {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

  constructor(count: number) {
    let s = 11;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
    const streaks = new Float32Array(count * 4);
    const colors = new Float32Array(count * 3);
    const palette = [new THREE.Color(0.85, 0.92, 1), new THREE.Color(0.55, 0.82, 1), new THREE.Color(0.78, 0.72, 1), new THREE.Color(1, 1, 1)];
    for (let i = 0; i < count; i++) {
      streaks.set([rand() * Math.PI * 2, 1.6 + 44 * Math.pow(rand(), 0.8), rand(), Math.pow(rand(), 3)], i * 4);
      const c = palette[Math.floor(rand() * palette.length)];
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const g = quadGeometry();
    g.setAttribute("aStreak", new THREE.InstancedBufferAttribute(streaks, 4));
    g.setAttribute("aColor", new THREE.InstancedBufferAttribute(colors, 3));
    g.instanceCount = count;
    this.mesh = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        vertexShader: TUNNEL_VERTEX,
        fragmentShader: TUNNEL_FRAGMENT,
        uniforms: {
          uTravel: { value: 0 },
          uWarp: { value: 0 },
          uDepth: { value: 420 },
          uNear: { value: 2.5 },
          uLength: { value: 190 },
          uPx: { value: 1 },
          uResolution: resolution,
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  setPixelRatio(px: number) {
    this.mesh.material.uniforms.uPx.value = px;
  }

  update(camera: THREE.Camera, warp: number, travel: number) {
    this.mesh.visible = warp > 0.002;
    this.mesh.position.copy(camera.position);
    this.mesh.quaternion.copy(camera.quaternion);
    const u = this.mesh.material.uniforms;
    u.uWarp.value = warp;
    u.uTravel.value = travel;
  }
}

/** Post effect: zoom blur toward the vanishing point, colour fringes, a blue tunnel glow and the flash. */
export const HyperspaceShader = {
  name: "HyperspaceShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uWarp: { value: 0 },
    uFlash: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uWarp;
    uniform float uFlash;
    uniform float uTime;
    uniform float uAspect;
    uniform vec2 uCenter;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - uCenter;
      vec2 q = dir * vec2(uAspect, 1.0);
      float r = length(q);
      float strength = uWarp * 0.14;
      float fringe = uWarp * 0.014;
      vec3 col = vec3(0.0);
      float total = 0.0;
      for (int i = 0; i < 10; i++) {
        float f = float(i) / 9.0;
        float w = 1.0 - 0.65 * f;
        float s = 1.0 - strength * f;
        col.r += texture2D(tDiffuse, uCenter + dir * s * (1.0 + fringe)).r * w;
        col.g += texture2D(tDiffuse, uCenter + dir * s).g * w;
        col.b += texture2D(tDiffuse, uCenter + dir * s * (1.0 - fringe)).b * w;
        total += w;
      }
      col /= total;
      // the tunnel: a blue glow around the vanishing point with slowly turning bands
      float a = atan(q.y, q.x);
      float bands = 0.5 + 0.5 * sin(a * 9.0 + log(r + 0.02) * 7.0 - uTime * 5.0);
      float tunnel = smoothstep(0.95, 0.05, r) * (0.55 + 0.45 * bands);
      col += vec3(0.12, 0.3, 0.95) * tunnel * uWarp * uWarp * 0.2;
      col += vec3(0.6, 0.8, 1.0) * exp(-r * 22.0) * uWarp * 0.16;
      col *= 1.0 - uWarp * 0.55 * smoothstep(0.3, 1.0, r);
      // the flash bursts out of the vanishing point (a uniform white wash only greys the picture)
      col += vec3(0.7, 0.85, 1.0) * uFlash * (0.03 + 2.4 * exp(-r * 7.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
