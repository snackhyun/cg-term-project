/**
 * 망치질·물건 낙하 소품 (기본 도형)
 */
import * as THREE from 'three';
import { FootfallDetector } from './footfall.js';

/**
 * 망치 치수·동작 (m, 초, 라디안)
 * headSize: 머리 [x, 타격 방향, 길이], strikeAngle: 바닥에 닿는 각도
 */
export const HAMMER = Object.freeze({
  handle: 0.3,
  headSize: [0.07, 0.07, 0.14],
  strikeAngle: Math.PI / 3,
  raiseAngle: -0.7,
  raise: 0.4,
  hold: 0.12,
  strike: 0.12,
  rest: 0.18,
  strikes: 5,
  linger: 0.5,
});

/** 망치질 전체 길이 (초) */
export function hammerDuration(p = HAMMER) {
  return (p.raise + p.hold + p.strike + p.rest) * p.strikes;
}

/** 망치 각도 (시작 후 t초). 마지막 타격 뒤에는 null */
export function hammerAngle(t, p = HAMMER) {
  const cycle = p.raise + p.hold + p.strike + p.rest;
  const n = Math.floor(t / cycle);
  if (n >= p.strikes) return null;
  const u = t - n * cycle;
  const { strikeAngle: s, raiseAngle: r } = p;
  if (u < p.raise) {
    const k = u / p.raise;
    return s + (r - s) * (1 - (1 - k) * (1 - k));
  }
  if (u < p.raise + p.hold) return r;
  if (u < p.raise + p.hold + p.strike) {
    const k = (u - p.raise - p.hold) / p.strike;
    return r + (s - r) * k * k;
  }
  return s;
}

/**
 * 공 낙하 상수
 * height: 낙하 높이(공 아래 기준), minBounceSpeed: 이보다 느리면 정지, linger: 정지 후 남는 시간
 */
export const DROP = Object.freeze({
  radius: 0.07,
  height: 0.9,
  restitution: 0.55,
  minBounceSpeed: 0.5,
  gravity: 9.81,
  substep: 1 / 240,
  linger: 1.5,
});

/**
 * 공 낙하 한 단계 (높이 y는 공 아래 기준)
 * @param {{ y: number, vy: number, resting: boolean }} s
 * @returns {number[]} 이번 단계 충돌 속도 목록 (m/s)
 */
export function stepDrop(s, dt, p = DROP) {
  const hits = [];
  let left = dt;
  while (left > 1e-9 && !s.resting) {
    const h = Math.min(p.substep, left);
    left -= h;
    s.vy -= p.gravity * h;
    s.y += s.vy * h;
    if (s.y <= 0 && s.vy < 0) {
      hits.push(-s.vy);
      s.y = 0;
      s.vy = -s.vy * p.restitution;
      if (s.vy < p.minBounceSpeed) {
        s.vy = 0;
        s.resting = true;
      }
    }
  }
  return hits;
}

function disposeTree(root) {
  root.removeFromParent();
  root.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
}

/**
 * 망치 소품
 * @param {{ x, z }} at 타격 지점
 * @param {number} yaw 망치가 향하는 방향
 */
export class HammerProp {
  constructor(scene, unit, at, yaw) {
    const p = HAMMER;
    this.unit = unit;
    this.time = 0;
    this.done = false;

    this.root = new THREE.Group();
    this.root.name = 'hammer';
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);

    const wood = new THREE.MeshStandardMaterial({
      color: 0x9a6b3f,
      roughness: 0.8,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: 0x8a8f96,
      metalness: 0.6,
      roughness: 0.35,
    });
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.016, p.handle, 10),
      wood,
    );
    handle.rotation.x = Math.PI / 2;
    handle.position.z = p.handle / 2;
    const [hx, hy, hz] = p.headSize;
    const head = new THREE.Mesh(new THREE.BoxGeometry(hx, hz, hy), metal);
    head.position.z = p.handle;
    for (const m of [handle, head]) m.castShadow = true;
    this.pivot.add(handle, head);

    this.marker = new THREE.Object3D();
    this.marker.position.set(0, -hz / 2, p.handle);
    this.pivot.add(this.marker);

    // 타격 각도에서 머리 아래가 바닥에 닿는 피벗 높이·거리
    const s = p.strikeAngle;
    this.pivotHeight = p.handle * Math.sin(s) + (hz / 2) * Math.cos(s);
    this.offset = p.handle * Math.cos(s) - (hz / 2) * Math.sin(s);
    this.yaw = yaw;
    this.setPlacement(unit, at);

    this.detector = new FootfallDetector(1, {
      liftHeight: 0.05,
      contactHeight: 0.005,
      minInterval: 0.2,
    });
    scene.add(this.root);
  }

  /** 타격 지점 기준 배치 */
  setPlacement(unit, at) {
    this.unit = unit;
    this.at = { ...at };
    this.root.position.set(
      at.x - Math.sin(this.yaw) * this.offset,
      unit.floorY + this.pivotHeight,
      at.z - Math.cos(this.yaw) * this.offset,
    );
    this.root.rotation.y = this.yaw;
  }

  /** @returns {{ x, z, type, opts? }[]} */
  update(delta) {
    if (this.done) return [];
    this.time += delta;
    const angle = hammerAngle(this.time);
    if (angle === null) {
      this.done = this.time > hammerDuration() + HAMMER.linger;
      return [];
    }
    this.pivot.rotation.x = angle;
    this.root.updateMatrixWorld(true);
    const m = this.marker.getWorldPosition(new THREE.Vector3());
    const h = m.y - this.unit.floorY;
    const hits = this.detector.update(this.time, [h]);
    return hits.map(() => ({ x: m.x, z: m.z, type: 'hammer' }));
  }

  dispose() {
    disposeTree(this.root);
  }
}

/** 떨어지며 튀는 공 */
export class DropProp {
  constructor(scene, unit, at) {
    this.state = { y: DROP.height, vy: 0, resting: false };
    this.restTime = 0;
    this.done = false;
    this.firstSpeed = null;

    const mat = new THREE.MeshStandardMaterial({
      color: 0xe8553d,
      roughness: 0.5,
    });
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(DROP.radius, 20, 14),
      mat,
    );
    this.mesh.name = 'drop-ball';
    this.mesh.castShadow = true;
    this.setPlacement(unit, at);
    scene.add(this.mesh);
  }

  setPlacement(unit, at) {
    this.unit = unit;
    this.at = { ...at };
    this.sync();
  }

  sync() {
    this.mesh.position.set(
      this.at.x,
      this.unit.floorY + DROP.radius + this.state.y,
      this.at.z,
    );
  }

  /** @returns {{ x, z, type, opts }[]} */
  update(delta) {
    if (this.done) return [];
    const hits = stepDrop(this.state, delta);
    this.sync();
    if (this.state.resting) {
      this.restTime += delta;
      if (this.restTime > DROP.linger) this.done = true;
    }
    return hits.map((speed) => {
      this.firstSpeed ??= speed;
      const intensity = (speed / this.firstSpeed) ** 2;
      return {
        x: this.at.x,
        z: this.at.z,
        type: 'drop',
        opts: { intensity, impactSpeed: speed },
      };
    });
  }

  dispose() {
    disposeTree(this.mesh);
  }
}
