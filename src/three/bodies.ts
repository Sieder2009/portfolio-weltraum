import * as THREE from "three";
import { createAtmosphereMaterial, createRingMaterial, createSurfaceMaterial, type SurfaceKind } from "./materials";

export interface BodyDef {
  key: string;
  kind: SurfaceKind;
  radius: number;
  orbit: number;
  colors: string[];
  atmo: string;
  atmoStrength: number;
  accent: string;
  seed: number;
  tilt: number;
  ring?: { inner: number; outer: number; colors: string[]; tilt: number };
  crystals?: number;
  /** project ids, one moon each */
  moons: string[];
  /** where the camera sits relative to the sun direction when this planet is in focus (radians) */
  view: number;
}

const SPHERE_DETAIL = { hi: [128, 96], lo: [72, 48] } as const;

function mixHex(a: string, b: string, t: number) {
  return "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

export class Moon {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly worldPos = new THREE.Vector3();
  readonly radius: number;
  readonly distance: number;
  angle: number;
  private speed: number;
  private incline: number;
  private hover = 0;
  hoverTarget = 0;

  constructor(
    readonly projectId: string,
    index: number,
    planetRadius: number,
    accent: string,
    geometry: THREE.SphereGeometry,
    octaves: number,
  ) {
    this.radius = 0.2 + ((index * 37) % 5) * 0.03 + planetRadius * 0.04;
    this.distance = planetRadius * 1.9 + 0.55 + index * 0.62;
    this.angle = index * 2.4 + planetRadius;
    this.speed = 0.55 / Math.sqrt(this.distance);
    this.incline = ((index % 3) - 1) * 0.22 + 0.08;
    const material = createSurfaceMaterial({
      kind: "moon",
      colors: [mixHex("#34343c", accent, 0.22), mixHex("#b9b9c4", accent, 0.3)],
      atmo: accent,
      seed: index * 7.3 + planetRadius,
      octaves: Math.min(octaves, 4),
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.scale.setScalar(this.radius);
  }

  update(dt: number, time: number, sunPos: THREE.Vector3) {
    this.angle += this.speed * dt;
    const a = this.angle;
    this.mesh.position.set(Math.cos(a) * this.distance, Math.sin(a) * this.distance * Math.sin(this.incline), Math.sin(a) * this.distance * Math.cos(this.incline));
    this.mesh.rotation.y += dt * 0.2;
    this.hover += (this.hoverTarget - this.hover) * (1 - Math.exp(-dt * 10));
    const u = this.mesh.material.uniforms;
    u.uTime.value = time;
    u.uSunPos.value.copy(sunPos);
    u.uHover.value = this.hover;
    this.mesh.getWorldPosition(this.worldPos);
  }
}

const ORBIT_VERTEX = /* glsl */ `
attribute float aAngle;
varying float vAngle;
void main() {
  vAngle = aAngle;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The orbit fades in behind the planet like a trail.
const ORBIT_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAngle;
uniform float uOpacity;
uniform float uActive;
varying float vAngle;
void main() {
  float d = mod(uAngle - vAngle + 6.2831853, 6.2831853);
  float trail = exp(-d * 1.4);
  float a = uOpacity * (0.16 + 0.84 * trail) * (1.0 + uActive * 1.6);
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

export class PlanetBody {
  readonly def: BodyDef;
  readonly pivot = new THREE.Group();
  readonly holder = new THREE.Group();
  readonly tilt = new THREE.Group();
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly atmosphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly ring?: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
  readonly crystals?: THREE.InstancedMesh;
  readonly moons: Moon[] = [];
  readonly orbitLine: THREE.LineLoop<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly worldPos = new THREE.Vector3();
  /** radius that has to fit on screen when the planet is in focus (rings, moons and crystals included) */
  readonly frameRadius: number;
  angle: number;
  private speed: number;
  private spin: number;
  private hover = 0;
  hoverTarget = 0;
  private active = 0;
  activeTarget = 0;
  private crystalData: { a: number; r: number; y: number; s: number; rot: THREE.Euler }[] = [];
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private ringNormal = new THREE.Vector3();

  constructor(def: BodyDef, index: number, opts: { octaves: number; lowDetail: boolean; moonGeometry: THREE.SphereGeometry }) {
    this.def = def;
    const [ws, hs] = opts.lowDetail ? SPHERE_DETAIL.lo : SPHERE_DETAIL.hi;

    // Orbit plane: a small inclination per planet, so the system has some depth.
    this.pivot.rotation.set(Math.sin(index * 1.7) * 0.045, index * 0.9, Math.cos(index * 2.3) * 0.04);
    this.angle = index * 2.39996 + 0.6;
    this.speed = 0.085 / Math.sqrt(def.orbit / 17);
    this.spin = 0.05 + ((index * 13) % 7) * 0.012;

    this.pivot.add(this.holder);
    this.holder.add(this.tilt);
    this.tilt.rotation.z = def.tilt;

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(def.radius, ws, hs),
      createSurfaceMaterial({ kind: def.kind, colors: def.colors, atmo: def.atmo, seed: def.seed, octaves: opts.octaves }),
    );
    this.tilt.add(this.mesh);

    const atmoScale = def.kind === "gas" ? 1.1 : 1.14;
    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(def.radius * atmoScale, 64, 48),
      createAtmosphereMaterial(def.atmo, def.atmoStrength, atmoScale),
    );
    this.atmosphere.renderOrder = 1;
    this.holder.add(this.atmosphere);

    // (small planets without moons still leave some space around them)
    let frame = Math.max(def.radius * 1.3, 2.1);

    if (def.ring) {
      const inner = def.radius * def.ring.inner;
      const outer = def.radius * def.ring.outer;
      this.ring = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 192, 1),
        createRingMaterial(def.ring.colors, inner, outer, def.radius, opts.octaves),
      );
      this.ring.rotation.x = -Math.PI / 2 + def.ring.tilt;
      this.ring.renderOrder = 3;
      this.tilt.add(this.ring);
      frame = Math.max(frame, outer * 1.02);
    }

    if (def.crystals) {
      const geo = new THREE.OctahedronGeometry(0.13, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: def.colors[1],
        emissive: new THREE.Color(def.colors[3] ?? def.accent),
        emissiveIntensity: 0.55,
        roughness: 0.25,
        metalness: 0.1,
        flatShading: true,
      });
      this.crystals = new THREE.InstancedMesh(geo, mat, def.crystals);
      for (let i = 0; i < def.crystals; i++) {
        const t = i / def.crystals;
        this.crystalData.push({
          a: t * Math.PI * 2 + Math.sin(i * 12.9) * 0.2,
          r: def.radius * (1.85 + ((i * 7) % 5) * 0.09),
          y: Math.sin(i * 3.1) * 0.12,
          s: 0.7 + ((i * 5) % 4) * 0.22,
          rot: new THREE.Euler(i, i * 0.7, i * 1.3),
        });
      }
      this.crystals.rotation.x = 0.32;
      this.tilt.add(this.crystals);
      frame = Math.max(frame, def.radius * 2.35);
    }

    def.moons.forEach((id, i) => {
      const moon = new Moon(id, i, def.radius, def.accent, opts.moonGeometry, opts.octaves);
      this.moons.push(moon);
      this.holder.add(moon.mesh);
      frame = Math.max(frame, moon.distance + moon.radius * 2);
    });
    this.frameRadius = frame;

    // Orbit line with an angle per vertex for the trail.
    const segments = 360;
    const pos = new Float32Array(segments * 3);
    const ang = new Float32Array(segments);
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pos.set([Math.cos(a) * def.orbit, 0, Math.sin(a) * def.orbit], i * 3);
      ang[i] = a;
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    lineGeo.setAttribute("aAngle", new THREE.BufferAttribute(ang, 1));
    this.orbitLine = new THREE.LineLoop(
      lineGeo,
      new THREE.ShaderMaterial({
        vertexShader: ORBIT_VERTEX,
        fragmentShader: ORBIT_FRAGMENT,
        uniforms: {
          uColor: { value: new THREE.Color(def.accent) },
          uAngle: { value: 0 },
          uOpacity: { value: 0.32 },
          uActive: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.pivot.add(this.orbitLine);
    this.placeOnOrbit();
  }

  private placeOnOrbit() {
    const a = this.angle;
    this.holder.position.set(Math.cos(a) * this.def.orbit, 0, Math.sin(a) * this.def.orbit);
  }

  setOrbitOpacity(v: number) {
    this.orbitLine.material.uniforms.uOpacity.value = v;
  }

  update(dt: number, orbitDt: number, time: number, sunPos: THREE.Vector3) {
    this.angle += this.speed * orbitDt;
    this.angle %= Math.PI * 2;
    this.placeOnOrbit();
    this.mesh.rotation.y += this.spin * dt;
    this.pivot.updateMatrixWorld(true);
    this.holder.getWorldPosition(this.worldPos);

    const k = 1 - Math.exp(-dt * 8);
    this.hover += (this.hoverTarget - this.hover) * k;
    this.active += (this.activeTarget - this.active) * (1 - Math.exp(-dt * 4));

    const u = this.mesh.material.uniforms;
    u.uTime.value = time;
    u.uSunPos.value.copy(sunPos);
    u.uHover.value = this.hover;

    const au = this.atmosphere.material.uniforms;
    au.uSunPos.value.copy(sunPos);
    au.uHover.value = this.hover;

    const ou = this.orbitLine.material.uniforms;
    // (the line's vertices use the same angle convention as holder.position: x = cos, z = sin)
    ou.uAngle.value = this.angle;
    ou.uActive.value = Math.max(this.hover, this.active * 0.6);

    if (this.ring) {
      const ru = this.ring.material.uniforms;
      this.ring.updateMatrixWorld();
      this.ringNormal.set(0, 0, 1).transformDirection(this.ring.matrixWorld);
      ru.uSunPos.value.copy(sunPos);
      ru.uCenter.value.copy(this.worldPos);
      ru.uNormal.value.copy(this.ringNormal);
      ru.uHover.value = this.hover;
      u.uCenter.value.copy(this.worldPos);
      u.uRingNormal.value.copy(this.ringNormal);
      u.uRingInfo.value.set(this.def.radius * this.def.ring!.inner, this.def.radius * this.def.ring!.outer, 1);
    }

    if (this.crystals) {
      this.crystalData.forEach((c, i) => {
        const a = c.a + time * 0.05;
        this.tmpV.set(Math.cos(a) * c.r, c.y, Math.sin(a) * c.r);
        c.rot.x += dt * 0.4;
        c.rot.y += dt * 0.6;
        this.tmpQ.setFromEuler(c.rot);
        this.tmpS.setScalar(c.s * (1 + this.hover * 0.15));
        this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
        this.crystals!.setMatrixAt(i, this.tmpM);
      });
      this.crystals.instanceMatrix.needsUpdate = true;
    }

    for (const m of this.moons) m.update(dt, time, sunPos);
  }
}
