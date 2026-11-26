import * as THREE from "three";
import type { PlanetBody } from "./bodies";

/** The part of the screen the 3D scene should be framed in (the rest is covered by text). */
export interface Frame {
  width: number;
  height: number;
  /** shift of the projection centre in CSS pixels (positive x moves the scene left, positive y moves it up) */
  offsetX: number;
  offsetY: number;
  freeWidth: number;
  freeHeight: number;
}

/**
 * Where the journey is. Stops: 0 is the overview (the sun), 1…n are the planets.
 * While holding at a stop, from === to and `hold` runs 0 → 1 (the camera drifts a little closer);
 * between two stops, `t` runs 0 → 1.
 */
export interface Journey {
  from: number;
  to: number;
  t: number;
  hold: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const OVERVIEW_REACH = 84;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  reducedMotion = false;
  /** 0…1: how deep in hyperspace the camera is (set by the universe each frame) */
  warp = 0;
  private clock = 0;
  private bodies: PlanetBody[] = [];
  private journey: Journey = { from: 0, to: 0, t: 0, hold: 0 };
  private intro: { from: THREE.Vector3; t: number; duration: number } | null = null;
  private pos = new THREE.Vector3();
  private target = new THREE.Vector3();
  private aPos = new THREE.Vector3();
  private aTarget = new THREE.Vector3();
  private bPos = new THREE.Vector3();
  private bTarget = new THREE.Vector3();
  private frame: Frame = { width: 1, height: 1, offsetX: 0, offsetY: 0, freeWidth: 1, freeHeight: 1 };
  private offset = new THREE.Vector2();
  private baseFov = 40;
  private settled = false;

  // dragging: turns the system (overview) or the view around a planet
  azimuth = -0.55;
  private azimuthVel = 0;
  private orbitYaw = 0;
  private orbitYawTarget = 0;
  // pointer parallax
  private parallax = new THREE.Vector2();
  private parallaxTarget = new THREE.Vector2();

  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.1, 9000);
  }

  setBodies(bodies: PlanetBody[]) {
    this.bodies = bodies;
  }

  setJourney(j: Journey) {
    // a new planet: forget how far the view was turned at the last one
    const stop = j.t < 0.5 ? j.from : j.to;
    const prev = this.journey.t < 0.5 ? this.journey.from : this.journey.to;
    if (stop !== prev) this.orbitYawTarget = 0;
    this.journey = j;
  }

  get journeyState(): Readonly<Journey> {
    return this.journey;
  }

  /** The point the camera looks at. */
  get lookTarget(): THREE.Vector3 {
    return this.target;
  }

  /** 0 → 1 while the intro flight runs, otherwise null. */
  get introProgress(): number | null {
    return this.intro ? this.intro.t : null;
  }

  /** The current shift of the projection centre in CSS pixels (see Frame). */
  get projectionShift(): THREE.Vector2 {
    return this.offset;
  }

  /**
   * The overview camera's axes and focal length (for placing things in the sky), without moving the camera.
   * `frame`: the overview's framing, when the current one is a planet's.
   */
  overviewView(frame: Frame = this.frame) {
    const pos = new THREE.Vector3();
    const target = new THREE.Vector3();
    const current = this.frame;
    this.frame = frame;
    this.overviewPose(pos, target);
    this.frame = current;
    const dir = target.sub(pos).normalize();
    const right = new THREE.Vector3().crossVectors(dir, UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const focal = frame.height / 2 / Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2));
    return { dir, right, up, focal, freeWidth: frame.freeWidth, freeHeight: frame.freeHeight, portrait: frame.width < frame.height };
  }

  /** The sky direction that shows at a place of the overview's free area (fractions of it from its centre: right, up). */
  overviewSkyDirection(u: number, v: number, frame: Frame = this.frame) {
    const o = this.overviewView(frame);
    return o.dir
      .clone()
      .addScaledVector(o.right, (u * o.freeWidth) / o.focal)
      .addScaledVector(o.up, (v * o.freeHeight) / o.focal)
      .normalize();
  }

  /** The planet the camera is at (or about to reach), null in the overview. */
  get focusedIndex(): number | null {
    const j = this.journey;
    const stop = j.from === j.to ? j.from : j.t < 0.15 ? j.from : j.t > 0.85 ? j.to : -1;
    return stop > 0 ? stop - 1 : null;
  }

  /** 0 in the overview, 1 at a planet. */
  get closeness() {
    const j = this.journey;
    const a = j.from > 0 ? 1 : 0;
    const b = j.to > 0 ? 1 : 0;
    return a + (b - a) * smooth(0, 1, j.t);
  }

  setFrame(frame: Frame) {
    this.frame = frame;
    this.camera.aspect = frame.width / frame.height;
    this.camera.updateProjectionMatrix();
  }

  setPointer(nx: number, ny: number) {
    this.parallaxTarget.set(nx, ny);
  }

  drag(dx: number) {
    if (this.focusedIndex !== null) {
      this.orbitYawTarget = THREE.MathUtils.clamp(this.orbitYawTarget - dx * 0.006, -1.4, 1.4);
    } else {
      this.azimuthVel = -dx * 0.0045;
      this.azimuth += this.azimuthVel;
    }
  }

  /** Starts far away and flies into wherever the journey is. */
  playIntro(duration = 3.4) {
    if (this.reducedMotion) return;
    this.pose(this.journey.from, this.journey.hold, this.aPos, this.aTarget);
    this.intro = { from: this.aPos.clone().multiplyScalar(4.2).add(new THREE.Vector3(-180, 260, 120)), t: 0, duration };
  }

  private overviewPose(outPos: THREE.Vector3, outTarget: THREE.Vector3) {
    const f = this.frame;
    const tv = Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2));
    const fitW = OVERVIEW_REACH / (tv * (f.freeWidth / f.height));
    // On upright screens the system is seen from higher up, as far as the free height allows without moving
    // the camera back: the orbits spread over more of the screen.
    let elevation = 0.44;
    if (f.width < f.height) {
      const room = (fitW * tv * (f.freeHeight / f.height) - 10) / OVERVIEW_REACH;
      elevation = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(room, 0, 1)), 0.44, 0.9);
    }
    const fitH = (OVERVIEW_REACH * Math.sin(elevation) + 10) / (tv * (f.freeHeight / f.height));
    const dist = Math.max(70, Math.max(fitW, fitH) * 1.08);
    outTarget.set(0, 0, 0);
    outPos.set(
      Math.cos(elevation) * Math.cos(this.azimuth) * dist,
      Math.sin(elevation) * dist,
      Math.cos(elevation) * Math.sin(this.azimuth) * dist,
    );
    this.tmp.set(-Math.sin(this.azimuth), 0, Math.cos(this.azimuth));
    outPos.addScaledVector(this.tmp, this.parallax.x * dist * 0.025);
    outPos.addScaledVector(UP, this.parallax.y * dist * 0.02);
  }

  private focusPose(body: PlanetBody, hold: number, outPos: THREE.Vector3, outTarget: THREE.Vector3) {
    const f = this.frame;
    const tv = Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2));
    const avail = (tv * Math.min(f.freeWidth, f.freeHeight)) / f.height;
    const portrait = f.freeWidth < f.freeHeight * 1.1;
    const fill = portrait ? 0.86 : 0.8;
    // While the text scrolls past, the camera keeps drifting closer and a little around the planet.
    const drift = THREE.MathUtils.lerp(1.14, 0.94, hold);
    const dist = (body.frameRadius / Math.sin(Math.atan(avail * fill))) * drift;

    // Look at the planet from slightly beside the sun direction: a lit face with a visible terminator.
    const toSun = this.tmp.copy(body.worldPos).negate().setY(0).normalize();
    const yaw = body.def.view + this.orbitYaw + THREE.MathUtils.lerp(-0.2, 0.2, hold);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const dir = this.tmp2.set(toSun.x * c - toSun.z * s, 0, toSun.x * s + toSun.z * c);
    dir.y = THREE.MathUtils.lerp(0.4, 0.28, hold);
    dir.normalize();

    outTarget.copy(body.worldPos);
    outPos.copy(body.worldPos).addScaledVector(dir, dist);
    const right = this.tmp.crossVectors(dir, UP).normalize();
    outPos.addScaledVector(right, this.parallax.x * dist * 0.035);
    outPos.addScaledVector(UP, this.parallax.y * dist * 0.025);
  }

  private pose(stop: number, hold: number, outPos: THREE.Vector3, outTarget: THREE.Vector3) {
    const body = stop > 0 ? this.bodies[stop - 1] : undefined;
    if (body) this.focusPose(body, hold, outPos, outTarget);
    else this.overviewPose(outPos, outTarget);
  }

  update(dt: number) {
    const k = (rate: number) => 1 - Math.exp(-dt * rate);
    this.clock += dt;
    this.parallax.lerp(this.parallaxTarget, k(2.5));
    this.orbitYaw += (this.orbitYawTarget - this.orbitYaw) * k(5);
    this.azimuthVel *= Math.exp(-dt * 3);
    this.azimuth += this.azimuthVel + (this.reducedMotion ? 0 : dt * 0.006 * (1 - this.closeness));

    // Where the scroll position says the camera should be.
    const j = this.journey;
    let fovKick = 0;
    if (j.from === j.to) {
      this.pose(j.from, j.hold, this.aPos, this.aTarget);
    } else {
      this.pose(j.from, 1, this.aPos, this.aTarget);
      this.pose(j.to, 0, this.bPos, this.bTarget);
      const arc = Math.min(this.aPos.distanceTo(this.bPos) * 0.16, 30);
      const e = easeInOutCubic(j.t);
      this.aPos.lerp(this.bPos, e).addScaledVector(UP, Math.sin(Math.PI * e) * arc);
      this.aTarget.lerp(this.bTarget, smooth(0.05, 0.85, j.t));
      fovKick = Math.sin(Math.PI * j.t) * 7;
    }

    if (this.intro) {
      this.intro.t = Math.min(1, this.intro.t + dt / this.intro.duration);
      const e = 1 - Math.pow(1 - this.intro.t, 4);
      this.aPos.lerpVectors(this.intro.from, this.aPos, e);
      fovKick += Math.sin(Math.PI * this.intro.t) * 14;
      if (this.intro.t >= 1) this.intro = null;
    }

    // A touch of smoothing on top, so steps of a wheel or a finger never show as jumps.
    if (!this.settled) {
      this.pos.copy(this.aPos);
      this.target.copy(this.aTarget);
      this.settled = true;
    } else {
      const rate = this.intro || this.reducedMotion ? 60 : 9;
      this.pos.lerp(this.aPos, k(rate));
      this.target.lerp(this.aTarget, k(rate));
    }

    const cam = this.camera;
    cam.position.copy(this.pos);
    cam.lookAt(this.target);
    // Hyperspace: the view widens and shakes a little.
    const warp = this.reducedMotion ? 0 : this.warp;
    if (warp > 0.01) {
      const w = warp * warp;
      const c = this.clock;
      cam.rotateZ((Math.sin(c * 17.3) * 0.6 + Math.sin(c * 31.7) * 0.4) * 0.005 * w);
      cam.rotateX((Math.sin(c * 23.1) + Math.sin(c * 41.3)) * 0.0009 * w);
      cam.rotateY((Math.sin(c * 19.7) + Math.sin(c * 37.9)) * 0.0009 * w);
    }
    const fov = this.baseFov + fovKick + warp * 16;
    if (Math.abs(cam.fov - fov) > 0.001) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    // Slide the projection centre so the planet sits in the free part of the screen.
    this.offset.x += (this.frame.offsetX - this.offset.x) * k(4);
    this.offset.y += (this.frame.offsetY - this.offset.y) * k(4);
    const { width, height } = this.frame;
    if (Math.abs(this.offset.x) < 0.5 && Math.abs(this.offset.y) < 0.5) {
      if (cam.view?.enabled) cam.clearViewOffset();
    } else {
      cam.setViewOffset(width, height, this.offset.x, this.offset.y, width, height);
    }
  }
}
