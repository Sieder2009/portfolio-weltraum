import * as THREE from "three";
import { NOISE } from "./glsl";

// ---------- Nebula: drawn once into an equirectangular texture, then shown on a sphere around the camera ----------

const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BAKE_FRAGMENT = /* glsl */ `
varying vec2 vUv;
${NOISE}
void main() {
  float lon = vUv.x * 6.2831853 - 3.1415927;
  float lat = (vUv.y - 0.5) * 3.1415927;
  vec3 d = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));

  vec3 bandN = normalize(vec3(0.25, 1.0, -0.35));
  float bd = dot(d, bandN);
  float band = exp(-bd * bd / 0.05);

  float n1 = fbm(d * 2.2 + 3.0);
  float n2 = fbm(d * 4.5 + 11.0);
  float n3 = fbm(d * 1.2 + 7.0);
  float clouds = smoothstep(-0.1, 0.8, n1 + 0.5 * n2);

  vec3 violet = vec3(0.13, 0.045, 0.26);
  vec3 teal = vec3(0.015, 0.11, 0.2);
  vec3 magenta = vec3(0.26, 0.04, 0.15);
  vec3 neb = mix(violet, teal, smoothstep(-0.4, 0.4, n3));
  neb = mix(neb, magenta, smoothstep(0.3, 0.8, n2) * 0.55);

  float dens = clouds * (0.22 + 0.95 * band);
  float dust = smoothstep(0.1, 0.6, fbm(d * 6.0 + 5.0)) * band;

  vec3 col = neb * dens * 0.6;
  col += vec3(0.42, 0.4, 0.55) * band * 0.035 * (0.6 + 0.4 * n2);
  col *= 1.0 - dust * 0.7;
  col += vec3(0.003, 0.004, 0.01);
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
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5);
  gl_FragColor = vec4(texture2D(uMap, uv).rgb * uIntensity, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function bakeNebula(renderer: THREE.WebGLRenderer, width: number, octaves: number) {
  const target = new THREE.WebGLRenderTarget(width, width / 2, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const material = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
    defines: { OCTAVES: octaves },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose();
  material.dispose();
  return target;
}

export function createSky(texture: THREE.Texture) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 32),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: { uMap: { value: texture }, uIntensity: { value: 1 } },
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
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 1.0 - uTwinkle * 0.4 * (0.5 + 0.5 * sin(uTime * (0.5 + aPhase * 1.8) + aPhase * 40.0));
  float size = aSize * uPixelRatio;
  if (uAttenuate > 0.0) size *= clamp(uAttenuate / -mv.z, 0.2, 3.0);
  gl_PointSize = max(size, 1.0);
  vColor = aColor * tw * uBoost * min(aSize, 1.0 + aSize * 0.25);
}
`;

const STAR_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = pow(smoothstep(0.5, 0.0, d), 2.4);
  gl_FragColor = vec4(vColor * a, a);
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

/** Far stars on a shell (a third of them gathered along the galactic band), or near dust when `near` is set. */
export function createStars(count: number, opts: { near?: boolean; seed?: number } = {}): StarLayer {
  let s = opts.seed ?? 1;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const bandN = new THREE.Vector3(0.25, 1, -0.35).normalize();
  const tmp = new THREE.Vector3();
  const u = new THREE.Vector3(1, 0, 0).cross(bandN).normalize();
  const v = bandN.clone().cross(u).normalize();

  for (let i = 0; i < count; i++) {
    if (opts.near) {
      // A flat disc of faint dust around the system, for depth while the camera moves.
      const r = 90 + Math.pow(rand(), 0.7) * 420;
      const a = rand() * Math.PI * 2;
      tmp.set(Math.cos(a) * r, (rand() - 0.5) * 80 * (0.3 + rand()), Math.sin(a) * r);
    } else if (rand() < 0.35) {
      const a = rand() * Math.PI * 2;
      const spread = (rand() + rand() + rand() - 1.5) * 0.18;
      tmp.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a)).addScaledVector(bandN, spread).normalize();
      tmp.multiplyScalar(1400 + rand() * 600);
    } else {
      const z = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      tmp.set(r * Math.cos(a), z, r * Math.sin(a)).multiplyScalar(1400 + rand() * 600);
    }
    positions.set([tmp.x, tmp.y, tmp.z], i * 3);
    const c = starColor(rand());
    colors.set([c.r, c.g, c.b], i * 3);
    sizes[i] = opts.near ? 1.2 + rand() * 2.2 : 0.7 + Math.pow(rand(), 7) * 3.4;
    phases[i] = rand();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uTwinkle: { value: opts.near ? 0 : 1 },
      uAttenuate: { value: opts.near ? 160 : 0 },
      uBoost: { value: opts.near ? 0.32 : 1 },
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
