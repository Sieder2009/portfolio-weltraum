import * as THREE from "three";
import { NOISE, SURFACE_VERTEX } from "./glsl";

const SUN_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uHover;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;
${NOISE}
void main() {
  vec3 p = normalize(vObj);
  vec3 V = normalize(cameraPosition - vWorld);
  float mu = max(dot(normalize(vNormalW), V), 0.0);
  float n1 = fbm(p * 3.5 + vec3(uTime * 0.02, 0.0, uTime * 0.015));
  float n2 = snoise(p * 16.0 + vec3(0.0, uTime * 0.08, 0.0));
  float gran = clamp(0.55 + 0.5 * n1 + 0.18 * n2, 0.0, 1.0);
  vec3 col = mix(vec3(1.0, 0.33, 0.05), vec3(1.0, 0.8, 0.42), gran);
  col = mix(col, vec3(1.0, 0.96, 0.86), smoothstep(0.75, 1.0, gran) * 0.6);
  col *= 0.6 + 0.55 * pow(mu, 0.45);
  col += vec3(1.0, 0.45, 0.1) * pow(1.0 - mu, 3.0) * 0.8;
  gl_FragColor = vec4(col * (2.0 + uHover * 0.6), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const CORONA_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// A camera-facing quad: soft glow, slow rays.
const CORONA_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uCore;
uniform float uIntensity;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  float a = atan(c.y, c.x);
  float glow = pow(uCore / max(r, uCore), 2.1);
  float rays = pow(0.5 + 0.5 * snoise(vec3(cos(a) * 3.0, sin(a) * 3.0, uTime * 0.06)), 3.0);
  rays *= smoothstep(1.0, 0.25, r) * smoothstep(uCore * 0.9, uCore * 1.6, r);
  float fade = smoothstep(1.0, 0.6, r);
  vec3 col = vec3(1.0, 0.62, 0.28) * glow * 0.85 + vec3(1.0, 0.5, 0.2) * rays * 0.2;
  col *= fade * uIntensity;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sun {
  readonly group = new THREE.Group();
  readonly radius: number;
  private surface: THREE.ShaderMaterial;
  private corona: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private hover = 0;
  private hoverTarget = 0;

  constructor(radius: number, octaves: number) {
    this.radius = radius;
    this.surface = new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERTEX,
      fragmentShader: SUN_FRAGMENT,
      defines: { OCTAVES: Math.min(octaves, 4) },
      uniforms: { uTime: { value: 0 }, uHover: { value: 0 } },
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), this.surface);
    this.group.add(sphere);

    const size = radius * 12;
    this.corona = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.ShaderMaterial({
        vertexShader: CORONA_VERTEX,
        fragmentShader: CORONA_FRAGMENT,
        defines: { OCTAVES: 1 },
        uniforms: { uTime: { value: 0 }, uCore: { value: (radius * 2) / size }, uIntensity: { value: 1 } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.corona.renderOrder = 2;
    this.group.add(this.corona);
  }

  setHover(on: boolean) {
    this.hoverTarget = on ? 1 : 0;
  }

  update(time: number, dt: number, camera: THREE.Camera) {
    this.hover += (this.hoverTarget - this.hover) * (1 - Math.exp(-dt * 8));
    this.surface.uniforms.uTime.value = time;
    this.surface.uniforms.uHover.value = this.hover;
    this.corona.material.uniforms.uTime.value = time;
    // Close by, the glow would cover the whole view in a brown haze: it fades as the camera comes near.
    const near = THREE.MathUtils.smoothstep(camera.position.distanceTo(this.group.position), this.radius * 4, this.radius * 14);
    this.corona.material.uniforms.uIntensity.value = (1 + this.hover * 0.35) * near;
    this.corona.quaternion.copy(camera.quaternion);
  }
}
