/**
 * 아이 캐릭터: 애니메이션 블렌딩, 이동, 발 착지 감지
 */
import * as THREE from 'three';
import { FootfallDetector } from './footfall.js';
import { RUN, WALK, gaitSpeed } from './gait.js';
import {
  clampToRect,
  fromNormalized,
  toNormalized,
  walkableRect,
  wrapAngle,
} from './navigation.js';

/**
 * 이동·블렌딩 상수
 * fade: 크로스페이드(초), turnRate: rad/s, arriveDistance: m, floorOffset: 히트맵 면 위 띄움(m),
 * popDuration: 세대 이동 축소·확대(초), jumpMergeWindow: 두 발 착지를 한 번으로 묶는 시간(초)
 */
export const MOTION = Object.freeze({
  fade: 0.25,
  turnRate: 9,
  arriveDistance: 0.03,
  floorOffset: 0.004,
  popDuration: 0.18,
  jumpMergeWindow: 0.15,
});

const LOCO = ['walk', 'run'];
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Character {
  /**
   * @param {Awaited<ReturnType<import('./model.js').loadCharacterModel>>} model
   */
  constructor(model) {
    this.model = model;
    this.group = model.root;
    this.scale = model.scale;
    this.mixer = new THREE.AnimationMixer(model.model);

    this.actions = {};
    this.weights = {};
    for (const [name, clip] of Object.entries(model.clips)) {
      const action = this.mixer.clipAction(clip);
      if (name === 'jump' || name === 'interact') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      if (LOCO.includes(name)) action.timeScale = 0; // 위상 직접 지정 (updatePhase)
      action.play();
      action.setEffectiveWeight(name === 'idle' ? 1 : 0);
      this.actions[name] = action;
      this.weights[name] = name === 'idle' ? 1 : 0;
    }
    this.base = 'idle';
    /** 걷기·뛰기 공통 위상 (0~1) */
    this.phase = 0;
    this.speeds = {
      walk: gaitSpeed(WALK) * this.scale,
      run: gaitSpeed(RUN) * this.scale,
    };

    this.unit = null;
    this.heading = 0;
    /** 이동 목표 { u, v }, 걷는 영역 기준 상대 좌표 */
    this.target = null;
    this.gait = 'walk';
    this.keepMoving = false;
    /** stop() 후 진행 방향 감속 이동 여부 */
    this.glide = false;
    this.speed = 0;
    this.time = 0;
    /** 세대 이동 연출 상태 */
    this.pop = null;
    this.jumpLandedAt = -Infinity;

    this.detector = new FootfallDetector(2);
    this.lastFeet = [];
  }

  /** 현재 세대의 걷는 영역 */
  get rect() {
    return walkableRect(this.unit);
  }

  get position() {
    return this.group.position;
  }

  /** 세대 안 (x, z)에 즉시 배치 */
  place(unit, x, z) {
    this.unit = unit;
    const p = clampToRect(walkableRect(unit), x, z);
    this.group.position.set(p.x, unit.floorY + MOTION.floorOffset, p.z);
    this.group.updateMatrixWorld(true);
    this.detector.reset(this.footHeights());
  }

  /** 다른 세대로 축소·확대하며 이동 */
  popTo(unit, x, z, onDone = null) {
    const p = this.pop;
    if (p && p.unit === unit && !p.moved) {
      Object.assign(p, { x, z, onDone });
      return;
    }
    if (p && !p.moved) this.group.scale.setScalar(1);
    this.pop = { t: 0, unit, x, z, moved: false, onDone };
  }

  /** 세대 이동 취소: 옮기기 전이면 제자리, 옮긴 뒤면 확대만 마무리. 콜백 폐기 */
  cancelPop() {
    const p = this.pop;
    if (!p) return;
    p.onDone = null;
    if (!p.moved) {
      this.pop = null;
      this.group.scale.setScalar(1);
    }
  }

  /** 걷는 영역 기준 상대 위치 */
  normalizedPosition() {
    return toNormalized(this.rect, this.position.x, this.position.z);
  }

  /**
   * 상대 좌표로 이동 시작
   * @param {boolean} [keepMoving] 도착 후 감속 없이 걸음 유지 (다음 목표가 바로 이어질 때)
   */
  moveTo(target, gait = 'walk', keepMoving = false) {
    this.target = { ...target };
    this.gait = gait;
    this.keepMoving = keepMoving;
    this.glide = false;
    this.setBase(gait);
  }

  /** 이동 중지 (진행 방향으로 감속 후 대기) */
  stop() {
    if (this.target || LOCO.includes(this.base)) this.glide = true;
    this.target = null;
    if (this.base !== 'jump') this.setBase('idle');
  }

  /** 즉시 대기 자세 */
  resetPose() {
    this.target = null;
    this.glide = false;
    this.pop = null;
    this.group.scale.setScalar(1);
    this.base = 'idle';
    for (const name of Object.keys(this.weights)) {
      this.weights[name] = name === 'idle' ? 1 : 0;
      this.actions[name].setEffectiveWeight(this.weights[name]);
    }
    this.speed = 0;
    this.mixer.update(0);
    this.group.updateMatrixWorld(true);
    this.detector.reset(this.footHeights());
  }

  get isMoving() {
    return this.target !== null || this.speed > 0.01;
  }

  /** 제자리 점프 1회 시작 */
  jump() {
    this.target = null;
    const action = this.actions.jump;
    action.reset();
    action.play();
    this.setBase('jump');
  }

  get jumpDone() {
    const a = this.actions.jump;
    return this.base !== 'jump' || a.time >= a.getClip().duration - 1e-3;
  }

  /** 한 번 재생 동작 (interact 등) */
  playOnce(name) {
    const action = this.actions[name];
    if (!action) return;
    action.reset();
    action.play();
    this.setBase(name);
  }

  /** 목표 동작 전환. 가중치는 update에서 서서히 이동 */
  setBase(name) {
    if (!this.actions[name]) name = 'idle';
    if (
      LOCO.includes(name) &&
      !LOCO.includes(this.base) &&
      this.weights.walk + this.weights.run < 0.05
    ) {
      this.phase = 0;
    }
    this.base = name;
  }

  /** 발 높이 (바닥 기준 m), 두 발 */
  footHeights() {
    const floor = this.unit ? this.unit.floorY + MOTION.floorOffset : 0;
    return this.model.feet.map(({ heel, toe }) => {
      heel.getWorldPosition(_a);
      toe.getWorldPosition(_b);
      return Math.min(_a.y, _b.y) - floor;
    });
  }

  /** 발 중심 월드 좌표 */
  footPosition(i, out = new THREE.Vector3()) {
    const { heel, toe } = this.model.feet[i];
    heel.getWorldPosition(_a);
    toe.getWorldPosition(_b);
    return out.addVectors(_a, _b).multiplyScalar(0.5);
  }

  updateWeights(delta) {
    const step = delta / MOTION.fade;
    let sum = 0;
    for (const name of Object.keys(this.weights)) {
      const goal = name === this.base ? 1 : 0;
      const w = this.weights[name];
      this.weights[name] =
        goal > w ? Math.min(goal, w + step) : Math.max(goal, w - step);
      sum += this.weights[name];
    }
    for (const name of Object.keys(this.weights)) {
      if (sum > 0) this.weights[name] /= sum;
      this.actions[name].setEffectiveWeight(this.weights[name]);
    }
  }

  updatePhase(delta) {
    const ww = this.weights.walk;
    const wr = this.weights.run;
    const loco = ww + wr;
    if (loco > 1e-4) {
      this.phase += (delta * (ww / WALK.period + wr / RUN.period)) / loco;
      this.phase -= Math.floor(this.phase);
    }
    for (const name of LOCO) {
      const a = this.actions[name];
      a.time = this.phase * a.getClip().duration;
    }
  }

  /** 이동 목표 방향으로 회전·전진 */
  updateMotion(delta) {
    const ww = this.weights.walk;
    const wr = this.weights.run;
    let speed = ww * this.speeds.walk + wr * this.speeds.run;

    const rect = this.rect;
    const pos = this.position;
    if (this.target) {
      const goal = fromNormalized(rect, this.target.u, this.target.v);
      const dx = goal.x - pos.x;
      const dz = goal.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > MOTION.arriveDistance) {
        const want = Math.atan2(dx, dz);
        const err = wrapAngle(want - this.heading);
        const turn =
          Math.sign(err) * Math.min(Math.abs(err), MOTION.turnRate * delta);
        this.heading = wrapAngle(this.heading + turn);
        speed *= Math.max(0, Math.cos(err));
        // 크로스페이드 감속 거리만큼 미리 대기로 전환 → 목표에서 정지
        const fullSpeed = this.speeds[this.gait];
        const stopDistance = (fullSpeed * MOTION.fade) / 2;
        if (!this.keepMoving && dist <= stopDistance + MOTION.arriveDistance) {
          this.setBase('idle');
        }
        const stepLen = Math.min(speed * delta, dist);
        pos.x += Math.sin(this.heading) * stepLen;
        pos.z += Math.cos(this.heading) * stepLen;
        // 감속 중 속도가 다 줄면 그 자리를 도착으로 처리
        if (this.base === 'idle' && speed < 1e-3) this.target = null;
      } else {
        this.target = null;
        if (!this.keepMoving) this.setBase('idle');
      }
    } else if (this.glide && speed > 1e-3) {
      pos.x += Math.sin(this.heading) * speed * delta;
      pos.z += Math.cos(this.heading) * speed * delta;
    } else {
      this.glide = false;
    }
    this.speed = speed;

    const c = clampToRect(rect, pos.x, pos.z);
    pos.x = c.x;
    pos.z = c.z;
    pos.y = this.unit.floorY + MOTION.floorOffset;
    this.group.rotation.y = this.heading;
  }

  updatePop(delta) {
    const p = this.pop;
    p.t += delta;
    const half = MOTION.popDuration;
    if (!p.moved && p.t >= half) {
      p.moved = true;
      this.place(p.unit, p.x, p.z);
    }
    const k = p.t < half ? 1 - p.t / half : Math.min(1, (p.t - half) / half);
    this.group.scale.setScalar(Math.max(0.001, k));
    if (p.t >= 2 * half) {
      this.group.scale.setScalar(1);
      this.pop = null;
      p.onDone?.();
    }
  }

  /** 걷는 방향 바라보기 */
  face(x, z) {
    this.heading = Math.atan2(x - this.position.x, z - this.position.z);
    this.group.rotation.y = this.heading;
  }

  /**
   * 프레임 갱신
   * @returns {{ x: number, z: number, type: string, feet: number[] }[]} 이번 프레임 착지
   */
  update(delta) {
    if (!this.unit) return [];
    this.time += delta;
    if (this.pop) this.updatePop(delta);

    if (this.base === 'jump' && this.jumpDone) this.setBase('idle');
    if (this.base === 'interact') {
      const a = this.actions.interact;
      if (a.time >= a.getClip().duration - 1e-3) this.setBase('idle');
    }

    this.updateWeights(delta);
    this.updatePhase(delta);
    this.mixer.update(delta);
    if (!this.pop) this.updateMotion(delta);
    this.group.updateMatrixWorld(true);

    const heights = this.footHeights();
    this.lastFeet = heights;
    if (this.pop) {
      this.detector.reset(heights);
      return [];
    }
    const events = this.detector.update(this.time, heights);
    if (events.length === 0) return [];
    return this.toImpacts(events);
  }

  /** 착지 → 충격 목록 */
  toImpacts(events) {
    const w = this.weights;
    if (
      w.jump > 0.5 ||
      this.time - this.jumpLandedAt < MOTION.jumpMergeWindow
    ) {
      if (this.time - this.jumpLandedAt < MOTION.jumpMergeWindow) return [];
      this.jumpLandedAt = this.time;
      const mid = this.footPosition(0)
        .add(this.footPosition(1, _b.clone()))
        .multiplyScalar(0.5);
      return [{ x: mid.x, z: mid.z, type: 'jump', feet: [0, 1] }];
    }
    const type =
      w.run + w.walk < 0.05 ? this.gait : w.run > w.walk ? 'run' : 'walk';
    return events.map((e) => {
      const p = this.footPosition(e.foot);
      return { x: p.x, z: p.z, type, feet: [e.foot] };
    });
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model.model);
    this.model.dispose();
  }
}
