import * as THREE from 'three';
import type { Viewer } from './Viewer';

interface PoseSample {
  t: number;
  theta: number;
  phi: number;
  radius: number;
}

export interface CameraKey {
  t: number;
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  fov: number;
  tx: number;
  ty: number;
  tz: number;
}

export interface CameraTake {
  version: 1;
  recordedAt: string;
  duration: number;
  keys: CameraKey[];
}

class OneEuro {
  private xPrev: number | undefined;
  private dxPrev = 0;
  private tPrev: number | undefined;

  constructor(
    public minCutoff: number,
    public beta: number,
    private readonly dCutoff = 1,
  ) {}

  reset(): void {
    this.xPrev = undefined;
    this.dxPrev = 0;
    this.tPrev = undefined;
  }

  filter(x: number, t: number, wrap = false): number {
    if (this.tPrev === undefined || this.xPrev === undefined) {
      this.tPrev = t;
      this.xPrev = x;
      return x;
    }
    const dt = Math.max((t - this.tPrev) / 1000, 1e-3);
    let incoming = x;
    if (wrap) incoming = this.xPrev + shortestAngle(x - this.xPrev);
    const dx = (incoming - this.xPrev) / dt;
    const edx = lowpass(this.dxPrev, dx, alpha(dt, this.dCutoff));
    this.dxPrev = edx;
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const y = lowpass(this.xPrev, incoming, alpha(dt, cutoff));
    this.xPrev = y;
    this.tPrev = t;
    return wrap ? wrapAngle(y) : y;
  }
}

function alpha(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * Math.max(cutoff, 1e-4));
  return 1 / (1 + tau / dt);
}

function lowpass(prev: number, next: number, a: number): number {
  return a * next + (1 - a) * prev;
}

function shortestAngle(delta: number): number {
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

function wrapAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + shortestAngle(b - a) * t;
}

/**
 * Mature phone gimbal (krpano / product-viewer style):
 * DeviceOrientation drives orbit look around the model — never free-fly from accelerometer.
 * The model stays framed; pinch/dolly only changes distance.
 */
export class HandheldRig {
  delayMs = 35;
  stabilize = 0.55;
  sensitivity = 1;
  /** Kept for panel compat; scales orbit response slightly with radius feel. */
  moveScale = 1;
  connected = false;

  taking = false;
  playing = false;
  take: CameraTake | null = null;

  private readonly spherical = new THREE.Spherical();
  private readonly offset = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly quatB = new THREE.Quaternion();
  private readonly deviceQuat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly q0 = new THREE.Quaternion();
  private readonly q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  private readonly zee = new THREE.Vector3(0, 0, 1);

  private yawFilter = new OneEuro(1.2, 0.15);
  private pitchFilter = new OneEuro(1.2, 0.15);
  private radiusFilter = new OneEuro(0.9, 0.1);

  private buffer: PoseSample[] = [];
  private calibrated = false;
  private basePitch = 0;
  private originTheta = 0;
  private originPhi = Math.PI / 2;
  private radius = 4;
  private lastApplied: PoseSample | null = null;
  private takeKeys: CameraKey[] = [];
  private takeStarted = 0;
  private playStarted = 0;
  private lastOrient = { a: 0, b: 90, g: 0, o: 0 };
  /** Ignore tiny sensor jitter (radians). */
  private readonly deadzone = 0.01;
  /** Unwrapped yaw so a full phone spin maps to a full orbit (not ±180° wrap). */
  private prevYaw: number | null = null;
  private accumYaw = 0;
  private readonly forward = new THREE.Vector3();

  constructor(private readonly viewer: Viewer) {}

  get driving(): boolean {
    return this.playing || this.connected;
  }

  resetFilters(): void {
    this.yawFilter.reset();
    this.pitchFilter.reset();
    this.radiusFilter.reset();
  }

  connect(): void {
    this.connected = true;
    this.calibrated = false;
    this.buffer.length = 0;
    this.resetFilters();
    this.viewer.controls.enabled = false;
    this.viewer.controls.autoRotate = false;
  }

  disconnect(): void {
    this.connected = false;
    this.calibrated = false;
    this.buffer.length = 0;
    if (!this.playing) this.viewer.controls.enabled = true;
  }

  /** Phone aimed at screen → lock orbit origin on a framed model view. */
  alignToScreen(alphaDeg: number, betaDeg: number, gammaDeg: number, orientDeg: number): void {
    if (!this.connected) return;
    this.snapFramedOrbit();
    const angles = this.deviceAngles(alphaDeg, betaDeg, gammaDeg, orientDeg);
    this.basePitch = angles.pitch;
    this.prevYaw = angles.yaw;
    this.accumYaw = 0;
    this.lastOrient = { a: alphaDeg, b: betaDeg, g: gammaDeg, o: orientDeg };
    this.calibrated = true;
    this.buffer.length = 0;
    this.resetFilters();
    const now = performance.now();
    this.buffer.push({
      t: now,
      theta: this.originTheta,
      phi: this.originPhi,
      radius: this.radius,
    });
    this.applySample(this.buffer[0]);
  }

  recalibrate(): void {
    this.alignToScreen(this.lastOrient.a, this.lastOrient.b, this.lastOrient.g, this.lastOrient.o);
  }

  onHostFramed(): void {
    if (!this.connected || !this.calibrated) return;
    this.syncOriginFromCamera();
    this.buffer.length = 0;
    this.resetFilters();
  }

  ingestDevice(
    alphaDeg: number,
    betaDeg: number,
    gammaDeg: number,
    orientDeg: number,
    _dx = 0,
    _dy = 0,
    _dz = 0,
    now = performance.now(),
  ): void {
    if (!this.connected) return;
    this.lastOrient = { a: alphaDeg, b: betaDeg, g: gammaDeg, o: orientDeg };
    if (!this.calibrated) {
      this.alignToScreen(alphaDeg, betaDeg, gammaDeg, orientDeg);
      return;
    }

    this.applyStabilizeParams();
    const angles = this.deviceAngles(alphaDeg, betaDeg, gammaDeg, orientDeg);

    // Unwrap yaw step-by-step so 360° phone turn → 360° orbit (shortestAngle alone caps at ±180°)
    if (this.prevYaw === null) {
      this.prevYaw = angles.yaw;
      this.accumYaw = 0;
    } else {
      const step = shortestAngle(angles.yaw - this.prevYaw);
      if (Math.abs(step) >= this.deadzone) this.accumYaw += step;
      this.prevYaw = angles.yaw;
    }

    let dYaw = this.accumYaw * this.sensitivity;
    let dPitch = (angles.pitch - this.basePitch) * this.sensitivity;
    if (Math.abs(dPitch) < this.deadzone) dPitch = 0;

    // Keep elevation near the framed view — allow tilt, but not flipping over the pole
    const minPhi = 0.25;
    const maxPhi = this.viewer.settings.camera.limitBelowGround ? Math.PI / 2 - 0.06 : Math.PI - 0.25;
    const theta = this.originTheta - dYaw;
    const phi = THREE.MathUtils.clamp(this.originPhi - dPitch, minPhi, maxPhi);

    this.buffer.push({
      t: now,
      theta: this.yawFilter.filter(theta, now, true),
      phi: this.pitchFilter.filter(phi, now),
      radius: this.radiusFilter.filter(this.radius, now),
    });
    if (this.buffer.length > 180) this.buffer.splice(0, this.buffer.length - 120);
  }

  /** Pinch dolly — soften deltas and keep look angles locked to last sample. */
  dolly(delta: number): void {
    if (!this.connected) return;
    const min = this.viewer.controls.minDistance || this.sceneScale() * 0.3;
    const max = this.viewer.controls.maxDistance || this.sceneScale() * 20;
    const step = THREE.MathUtils.clamp(delta, -0.06, 0.06);
    this.radius = THREE.MathUtils.clamp(this.radius * Math.exp(-step), min, max);
    const now = performance.now();
    const ang = this.lastApplied;
    if (!ang) return;
    this.buffer.push({
      t: now,
      theta: ang.theta,
      phi: ang.phi,
      radius: this.radiusFilter.filter(this.radius, now),
    });
    if (this.buffer.length > 180) this.buffer.splice(0, this.buffer.length - 120);
  }

  startTake(): void {
    this.takeKeys = [];
    this.takeStarted = performance.now();
    this.taking = true;
    this.take = null;
  }

  stopTake(): CameraTake | null {
    this.taking = false;
    if (this.takeKeys.length < 2) {
      this.take = null;
      return null;
    }
    this.take = {
      version: 1,
      recordedAt: new Date().toISOString(),
      duration: this.takeKeys[this.takeKeys.length - 1].t,
      keys: this.takeKeys,
    };
    this.takeKeys = [];
    return this.take;
  }

  playTake(take = this.take): boolean {
    if (!take || take.keys.length < 2) return false;
    this.take = take;
    this.playing = true;
    this.playStarted = performance.now();
    this.viewer.controls.enabled = false;
    this.viewer.controls.autoRotate = false;
    return true;
  }

  stopPlayback(): void {
    this.playing = false;
    if (!this.connected) this.viewer.controls.enabled = true;
  }

  update(now = performance.now()): void {
    if (this.playing && this.take) {
      this.applyTake(now);
      return;
    }
    if (!this.connected || !this.calibrated) return;
    const delayed = this.sampleAt(now - this.delayMs);
    if (!delayed) return;
    this.applySample(delayed);
  }

  private snapFramedOrbit(): void {
    this.viewer.frameModel();
    this.syncOriginFromCamera();
  }

  private syncOriginFromCamera(): void {
    this.offset.copy(this.viewer.camera.position).sub(this.viewer.controls.target);
    this.spherical.setFromVector3(this.offset);
    this.originTheta = this.spherical.theta;
    this.originPhi = this.spherical.phi;
    this.radius = Math.max(this.spherical.radius, this.sceneScale() * 0.5);
  }

  private sampleAt(time: number): PoseSample | null {
    const buffer = this.buffer;
    if (buffer.length === 0) return this.lastApplied;
    if (time >= buffer[buffer.length - 1].t) return buffer[buffer.length - 1];
    if (time <= buffer[0].t) return buffer[0];
    let index = 1;
    while (index < buffer.length && buffer[index].t < time) index++;
    const b = buffer[index];
    const a = buffer[index - 1];
    const t = (time - a.t) / Math.max(b.t - a.t, 1);
    return {
      t: time,
      theta: lerpAngle(a.theta, b.theta, t),
      phi: THREE.MathUtils.lerp(a.phi, b.phi, t),
      radius: THREE.MathUtils.lerp(a.radius, b.radius, t),
    };
  }

  private applySample(sample: PoseSample): void {
    const camera = this.viewer.camera;
    const target = this.viewer.controls.target;
    this.offset.setFromSphericalCoords(sample.radius, sample.phi, sample.theta);
    camera.position.copy(target).add(this.offset);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    this.viewer.applyClipPlanes();
    this.lastApplied = sample;
    if (this.taking) this.recordKey();
  }

  private applyTake(now: number): void {
    const take = this.take;
    if (!take) return;
    const local = (now - this.playStarted) / 1000;
    if (local >= take.duration) {
      this.applyKey(take.keys[take.keys.length - 1]);
      this.stopPlayback();
      return;
    }
    const keys = take.keys;
    let index = 1;
    while (index < keys.length && keys[index].t < local) index++;
    const b = keys[index];
    const a = keys[index - 1];
    const span = Math.max(b.t - a.t, 1e-4);
    this.applyKey(a, b, (local - a.t) / span);
  }

  private applyKey(a: CameraKey, b?: CameraKey, t = 1): void {
    const camera = this.viewer.camera;
    const target = this.viewer.controls.target;
    if (!b || t >= 1) {
      camera.position.set(a.px, a.py, a.pz);
      camera.quaternion.set(a.qx, a.qy, a.qz, a.qw);
      target.set(a.tx, a.ty, a.tz);
      this.setFov(a.fov);
    } else {
      camera.position.set(
        THREE.MathUtils.lerp(a.px, b.px, t),
        THREE.MathUtils.lerp(a.py, b.py, t),
        THREE.MathUtils.lerp(a.pz, b.pz, t),
      );
      this.quat.set(a.qx, a.qy, a.qz, a.qw);
      this.quatB.set(b.qx, b.qy, b.qz, b.qw);
      camera.quaternion.copy(this.quat.slerp(this.quatB, t));
      target.set(
        THREE.MathUtils.lerp(a.tx, b.tx, t),
        THREE.MathUtils.lerp(a.ty, b.ty, t),
        THREE.MathUtils.lerp(a.tz, b.tz, t),
      );
      this.setFov(THREE.MathUtils.lerp(a.fov, b.fov, t));
    }
    this.viewer.applyClipPlanes();
  }

  private recordKey(): void {
    const camera = this.viewer.camera;
    const target = this.viewer.controls.target;
    const t = (performance.now() - this.takeStarted) / 1000;
    const last = this.takeKeys[this.takeKeys.length - 1];
    if (last && t - last.t < 1 / 40) return;
    this.takeKeys.push({
      t,
      px: camera.position.x,
      py: camera.position.y,
      pz: camera.position.z,
      qx: camera.quaternion.x,
      qy: camera.quaternion.y,
      qz: camera.quaternion.z,
      qw: camera.quaternion.w,
      fov: this.viewer.settings.camera.fov,
      tx: target.x,
      ty: target.y,
      tz: target.z,
    });
  }

  private setFov(fov: number): void {
    if (this.viewer.camera instanceof THREE.PerspectiveCamera) {
      this.viewer.settings.camera.fov = fov;
      this.viewer.camera.fov = fov;
      this.viewer.camera.updateProjectionMatrix();
    }
  }

  private sceneScale(): number {
    return Math.max(this.viewer.boundsRadius, 0.05);
  }

  private applyStabilizeParams(): void {
    const s = this.stabilize;
    const minCutoff = THREE.MathUtils.lerp(2.4, 0.4, s);
    const beta = THREE.MathUtils.lerp(0.7, 0.05, s);
    this.yawFilter.minCutoff = minCutoff;
    this.yawFilter.beta = beta;
    this.pitchFilter.minCutoff = minCutoff;
    this.pitchFilter.beta = beta;
    this.radiusFilter.minCutoff = Math.max(0.5, minCutoff);
    this.radiusFilter.beta = beta * 0.5;
  }

  private deviceAngles(alphaDeg: number, betaDeg: number, gammaDeg: number, orientDeg: number): {
    yaw: number;
    pitch: number;
  } {
    this.euler.set(
      THREE.MathUtils.degToRad(betaDeg),
      THREE.MathUtils.degToRad(alphaDeg),
      -THREE.MathUtils.degToRad(gammaDeg),
      'YXZ',
    );
    this.deviceQuat.setFromEuler(this.euler);
    this.deviceQuat.multiply(this.q1);
    this.deviceQuat.multiply(this.q0.setFromAxisAngle(this.zee, -THREE.MathUtils.degToRad(orientDeg)));

    // Look direction → azimuth / elevation (stable for full 360° yaw; avoids Euler pitch flips)
    this.forward.set(0, 0, -1).applyQuaternion(this.deviceQuat);
    const yaw = Math.atan2(this.forward.x, this.forward.z);
    const horiz = Math.hypot(this.forward.x, this.forward.z);
    const pitch = Math.atan2(this.forward.y, Math.max(horiz, 1e-6));
    return { yaw, pitch };
  }
}
