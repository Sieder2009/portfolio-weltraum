import * as THREE from "three";
import type { PlanetBody } from "./bodies";

/** The part of the screen the 3D scene should be framed in (the rest is covered by the panel). */
export interface Frame {
  width: number;
  height: number;
  /** shift of the projection centre in CSS pixels (positive x moves the scene left, positive y moves it up) */
  offsetX: number;
  offsetY: number;
  freeWidth: number;
  freeHeight: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const OVERVIEW_REACH = 84;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

interface Flight {
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  t: number;
  duration: number;
  arc: number;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  reducedMotion = false;
  /** set while the intro plays: the camera comes in from far away */
  private intro: Flight | null = null;
  private flight: Flight | null = null;
  private focus: PlanetBody | null = null;
  private pos = new THREE.Vector3();
  private target = new THREE.Vector3();
  private desiredPos = new THREE.Vector3();
  private desiredTarget = new THREE.Vector3();
  private frame: Frame = { width: 1, height: 1, offsetX: 0, offsetY: 0, freeWidth: 1, freeHeight: 1 };
  private offset = new THREE.Vector2();
  private baseFov = 40;

  // overview controls
  azimuth = -0.55;
  private azimuthVel = 0;
  private zoom = 1;
  private zoomTarget = 1;
  // focus controls
  private orbitYaw = 0;
  private orbitYawTarget = 0;
  private focusZoom = 1;
  private focusZoomTarget = 1;
  // pointer parallax
  private parallax = new THREE.Vector2();
  private parallaxTarget = new THREE.Vector2();

  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.1, 9000);
    this.overviewPose(this.pos, this.target);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.target);
  }

  get focused() {
    return this.focus;
  }

  get flying() {
    return this.flight !== null || this.intro !== null;
  }

  setFrame(frame: Frame) {
    this.frame = frame;
    this.camera.aspect = frame.width / frame.height;
    this.camera.updateProjectionMatrix();
  }

  setPointer(nx: number, ny: number) {
    this.parallaxTarget.set(nx, ny);
  }

  drag(dx: number, dy: number) {
    if (this.focus) {
      this.orbitYawTarget = THREE.MathUtils.clamp(this.orbitYawTarget - dx * 0.006, -1.3, 1.3);
    } else {
      this.azimuthVel = -dx * 0.0045;
      this.azimuth += this.azimuthVel;
    }
    void dy;
  }

  wheel(delta: number) {
    const f = Math.exp(delta * 0.0012);
    if (this.focus) this.focusZoomTarget = THREE.MathUtils.clamp(this.focusZoomTarget * f, 0.7, 1.6);
    else this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget * f, 0.55, 1.45);
  }

  /** Starts far away and flies into the overview. */
  playIntro(duration = 3.4) {
    this.overviewPose(this.desiredPos, this.desiredTarget);
    if (this.reducedMotion) {
      this.pos.copy(this.desiredPos);
      this.target.copy(this.desiredTarget);
      return;
    }
    const from = this.desiredPos.clone().multiplyScalar(4.2).add(new THREE.Vector3(-180, 260, 120));
    this.pos.copy(from);
    this.target.set(0, 0, 0);
    this.intro = { fromPos: from, fromTarget: new THREE.Vector3(), t: 0, duration, arc: 0 };
  }

  /** null = overview */
  flyTo(body: PlanetBody | null) {
    if (body === this.focus && !this.intro) return;
    const prev = this.focus;
    this.focus = body;
    this.orbitYawTarget = 0;
    this.focusZoomTarget = 1;
    if (this.reducedMotion) {
      this.flight = null;
      this.intro = null;
      this.orbitYaw = 0;
      this.focusZoom = 1;
      this.pose(this.pos, this.target);
      return;
    }
    this.intro = null;
    this.pose(this.desiredPos, this.desiredTarget);
    const dist = this.pos.distanceTo(this.desiredPos);
    const duration = THREE.MathUtils.clamp(1.25 + dist / 160, 1.5, 2.5) * (prev && body ? 1 : 1.05);
    this.flight = {
      fromPos: this.pos.clone(),
      fromTarget: this.target.clone(),
      t: 0,
      duration,
      arc: Math.min(dist * 0.14, 26),
    };
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
    const dist = Math.max(70, Math.max(fitW, fitH) * 1.08) * this.zoom;
    outTarget.set(0, 0, 0);
    outPos.set(
      Math.cos(elevation) * Math.cos(this.azimuth) * dist,
      Math.sin(elevation) * dist,
      Math.cos(elevation) * Math.sin(this.azimuth) * dist,
    );
    // parallax: a little sideways and up
    this.tmp.set(-Math.sin(this.azimuth), 0, Math.cos(this.azimuth));
    outPos.addScaledVector(this.tmp, this.parallax.x * dist * 0.025);
    outPos.addScaledVector(UP, this.parallax.y * dist * 0.02);
  }

  private focusPose(body: PlanetBody, outPos: THREE.Vector3, outTarget: THREE.Vector3) {
    const f = this.frame;
    const tv = Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2));
    const avail = (tv * Math.min(f.freeWidth, f.freeHeight)) / f.height;
    const portrait = f.freeWidth < f.freeHeight * 1.1;
    const fill = portrait ? 0.86 : 0.78;
    const dist = (body.frameRadius / Math.sin(Math.atan(avail * fill))) * this.focusZoom;

    // Look at the planet from slightly beside the sun direction: a lit face with a visible terminator.
    const toSun = this.tmp.copy(body.worldPos).negate().setY(0).normalize();
    const yaw = body.def.view + this.orbitYaw;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const dir = this.tmp2.set(toSun.x * c - toSun.z * s, 0, toSun.x * s + toSun.z * c);
    dir.y = 0.34;
    dir.normalize();

    outTarget.copy(body.worldPos);
    outPos.copy(body.worldPos).addScaledVector(dir, dist);
    const right = this.tmp.crossVectors(dir, UP).normalize();
    outPos.addScaledVector(right, this.parallax.x * dist * 0.035);
    outPos.addScaledVector(UP, this.parallax.y * dist * 0.025);
  }

  private pose(outPos: THREE.Vector3, outTarget: THREE.Vector3) {
    if (this.focus) this.focusPose(this.focus, outPos, outTarget);
    else this.overviewPose(outPos, outTarget);
  }

  update(dt: number) {
    const k = (rate: number) => 1 - Math.exp(-dt * rate);
    this.parallax.lerp(this.parallaxTarget, k(2.5));
    this.zoom += (this.zoomTarget - this.zoom) * k(5);
    this.focusZoom += (this.focusZoomTarget - this.focusZoom) * k(5);
    this.orbitYaw += (this.orbitYawTarget - this.orbitYaw) * k(5);
    if (!this.focus) {
      // inertia after a drag, then a very slow drift
      this.azimuthVel *= Math.exp(-dt * 3);
      this.azimuth += this.azimuthVel + (this.reducedMotion ? 0 : dt * 0.006);
    }

    this.pose(this.desiredPos, this.desiredTarget);
    let fovKick = 0;

    const active = this.intro ?? this.flight;
    if (active) {
      active.t = Math.min(1, active.t + dt / active.duration);
      const isIntro = active === this.intro;
      const e = isIntro ? 1 - Math.pow(1 - active.t, 4) : easeInOutCubic(active.t);
      const et = isIntro ? e : easeOutCubic(Math.min(1, active.t * 1.2));
      this.pos.lerpVectors(active.fromPos, this.desiredPos, e).addScaledVector(UP, Math.sin(Math.PI * e) * active.arc);
      this.target.lerpVectors(active.fromTarget, this.desiredTarget, et);
      fovKick = Math.sin(Math.PI * active.t) * (isIntro ? 14 : 8);
      if (active.t >= 1) {
        if (isIntro) this.intro = null;
        else this.flight = null;
      }
    } else {
      this.pos.copy(this.desiredPos);
      this.target.copy(this.desiredTarget);
    }

    const cam = this.camera;
    cam.position.copy(this.pos);
    cam.lookAt(this.target);
    const fov = this.baseFov + fovKick;
    if (Math.abs(cam.fov - fov) > 0.001) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    // Slide the projection centre so the planet sits in the free part of the screen.
    this.offset.x += (this.frame.offsetX - this.offset.x) * k(this.reducedMotion ? 40 : 5);
    this.offset.y += (this.frame.offsetY - this.offset.y) * k(this.reducedMotion ? 40 : 5);
    const { width, height } = this.frame;
    if (Math.abs(this.offset.x) < 0.5 && Math.abs(this.offset.y) < 0.5) {
      if (cam.view?.enabled) cam.clearViewOffset();
    } else {
      cam.setViewOffset(width, height, this.offset.x, this.offset.y, width, height);
    }
  }
}
