import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BehaviorRunner, BEHAVIOR_PARAMS } from '../src/character/behaviors.js';
import { Character } from '../src/character/Character.js';
import { LEG, RUN, WALK, gaitSpeed } from '../src/character/gait.js';
import {
  CHARACTER_HEIGHT,
  REQUIRED_CLIPS,
  assembleCharacter,
} from '../src/character/model.js';
import { walkableRect } from '../src/character/navigation.js';
import { loadRig } from './glbRig.js';

const GLB = fileURLToPath(
  new URL('../public/assets/character/character-female-b.glb', import.meta.url),
);

/** 실제 GLB 노드·클립으로 만든 캐릭터 (메시 없음) */
function makeCharacter(unit) {
  const rig = loadRig(GLB);
  const model = assembleCharacter(rig.scene, rig.animations, {
    modelHeight: rig.meshTop,
  });
  const c = new Character(model);
  c.place(unit, unit.centerX, unit.bounds.minZ + 1);
  return c;
}

function makeUnit(
  name = '201호',
  { x0 = -4.6, w = 4.5, d = 6, floorY = 2.51 } = {},
) {
  return {
    name,
    floorY,
    centerX: x0 + w / 2,
    centerZ: 0,
    bounds: { minX: x0, maxX: x0 + w, minZ: -d / 2, maxZ: d / 2 },
  };
}

/** 프레임 간격 생성기 */
const STEPS = {
  '60fps': () => 1 / 60,
  '20fps': () => 1 / 20,
  '10fps': () => 0.1,
  불규칙: (() => {
    let s = 3;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return 0.004 + (s / 4294967296) * 0.096;
    };
  })(),
};

/** t초 동안 실행하며 충격과 이후 발 위치 기록 */
function simulate(c, seconds, step, { runner = null, onTick = null } = {}) {
  const impacts = [];
  let t = 0;
  while (t < seconds) {
    const dt = step();
    t += dt;
    runner?.update(dt);
    onTick?.(t);
    for (const imp of c.update(dt)) {
      impacts.push({ ...imp, t, drift: 0 });
    }
    // 착지 후 0.1초간 착지 발 이동 거리 (미끄러짐)
    for (const imp of impacts) {
      if (imp.feet.length !== 1 || t - imp.t > 0.1) continue;
      const p = c.footPosition(imp.feet[0]);
      imp.drift = Math.max(imp.drift, Math.hypot(p.x - imp.x, p.z - imp.z));
    }
  }
  return impacts;
}

function alternates(impacts) {
  return impacts.every(
    (imp, i) => i === 0 || imp.feet[0] !== impacts[i - 1].feet[0],
  );
}

describe('GLB 원본 데이터', () => {
  const rig = loadRig(GLB);

  it('필요한 클립과 길이', () => {
    const byName = Object.fromEntries(rig.animations.map((c) => [c.name, c]));
    for (const n of REQUIRED_CLIPS) expect(byName[n]).toBeDefined();
    expect(byName.walk.duration).toBeCloseTo(WALK.period, 3);
    expect(byName.sprint.duration).toBeCloseTo(RUN.period, 3);
  });

  it('다리 피벗 높이와 발바닥 치수가 정점과 일치', () => {
    const leg = rig.scene.getObjectByName('leg-left');
    expect(leg.position.y).toBeCloseTo(LEG.length, 4);

    const { json, accessor } = rig;
    const prim = json.meshes[0].primitives[0].attributes;
    const pos = accessor(prim.POSITION);
    const joints = accessor(prim.JOINTS_0);
    const weights = accessor(prim.WEIGHTS_0);
    const legJoint = json.skins[0].joints.indexOf(
      json.nodes.findIndex((n) => n.name === 'leg-left'),
    );
    const zs = [];
    let minY = Infinity;
    pos.forEach((p, k) => {
      const w = weights[k];
      const main = joints[k][w.indexOf(Math.max(...w))];
      if (main !== legJoint) return;
      zs.push(p[2] - leg.position.z);
      minY = Math.min(minY, p[1]);
    });
    expect(minY).toBeCloseTo(0, 4);
    expect(Math.min(...zs)).toBeCloseTo(LEG.heelZ, 2);
    expect(Math.max(...zs)).toBeCloseTo(LEG.toeZ, 2);
  });

  it('원본 walk는 두 발 높이가 항상 같음 (한 발 착지 순간 없음 → 다리 트랙 생성 이유)', () => {
    const scene = rig.scene.clone();
    const legs = ['leg-left', 'leg-right'].map((n) => scene.getObjectByName(n));
    const soles = legs.map((leg) => {
      const o = new THREE.Object3D();
      o.position.set(0, -LEG.length, 0);
      leg.add(o);
      return o;
    });
    const mixer = new THREE.AnimationMixer(scene);
    mixer.clipAction(rig.animations.find((c) => c.name === 'walk')).play();
    const v = new THREE.Vector3();
    for (let i = 0; i < 40; i++) {
      mixer.update(i === 0 ? 0 : WALK.period / 40);
      scene.updateMatrixWorld(true);
      const [a, b] = soles.map((s) => s.getWorldPosition(v).y);
      expect(Math.abs(a - b)).toBeLessThan(1e-4);
    }
  });
});

describe('실제 리그로 만든 캐릭터', () => {
  it('키와 스케일', () => {
    const c = makeCharacter(makeUnit());
    expect(c.scale * loadRig(GLB).meshTop).toBeCloseTo(CHARACTER_HEIGHT, 6);
  });

  for (const [label, step] of Object.entries(STEPS)) {
    it(`걷기 ${label}: 발마다 한 번, 번갈아, 발 미끄러짐 1cm 이하`, () => {
      const unit = makeUnit();
      const c = makeCharacter(unit);
      const rect = walkableRect(unit);
      c.moveTo({ u: 0.5, v: 1 }, 'walk');
      const impacts = simulate(c, 12, step);
      const distance = rect.maxZ - rect.minZ;
      const stride = (gaitSpeed(WALK) * c.scale * WALK.period) / 2; // 한 걸음
      expect(c.isMoving).toBe(false);
      expect(c.position.z).toBeCloseTo(rect.maxZ, 1);
      expect(impacts.length).toBeGreaterThanOrEqual(
        Math.floor(distance / stride) - 1,
      );
      expect(impacts.length).toBeLessThanOrEqual(
        Math.ceil(distance / stride) + 3,
      );
      expect(alternates(impacts)).toBe(true);
      expect(new Set(impacts.map((i) => i.type))).toEqual(new Set(['walk']));
      const steady = impacts.slice(1, -2);
      expect(Math.max(...steady.map((i) => i.drift))).toBeLessThan(0.01);
      for (const imp of impacts) {
        expect(imp.x).toBeGreaterThan(unit.bounds.minX);
        expect(imp.x).toBeLessThan(unit.bounds.maxX);
      }
    });
  }

  it('대기 중에는 충격 없음', () => {
    const c = makeCharacter(makeUnit());
    expect(simulate(c, 3, STEPS['20fps'])).toHaveLength(0);
  });

  for (const [label, step] of Object.entries(STEPS)) {
    it(`아이 뛰기 ${label}: 왕복 중 번갈아 착지, 초당 3회 이상`, () => {
      const c = makeCharacter(makeUnit());
      const runner = new BehaviorRunner(c, {
        startProp: () => null,
        clearProps() {},
      });
      runner.start('run');
      const impacts = simulate(c, BEHAVIOR_PARAMS.runDuration + 2, step, {
        runner,
      });
      expect(runner.busy).toBe(false);
      const running = impacts.filter((i) => i.type === 'run');
      expect(running.length).toBeGreaterThan(BEHAVIOR_PARAMS.runDuration * 3);
      expect(alternates(impacts)).toBe(true);
      const byFoot = [0, 1].map((f) =>
        impacts.filter((i) => i.feet[0] === f).map((i) => i.t),
      );
      for (const ts of byFoot) {
        for (let i = 1; i < ts.length; i++)
          expect(ts[i] - ts[i - 1]).toBeGreaterThan(0.2);
      }
    });
  }

  it('걷다가 뛰기로 바꿔도(크로스페이드) 중복·누락 없음', () => {
    const c = makeCharacter(makeUnit());
    c.moveTo({ u: 0.5, v: 1 }, 'walk');
    const impacts = simulate(c, 8, STEPS['불규칙'], {
      onTick: (t) => {
        if (t > 1.5 && c.gait === 'walk' && c.target)
          c.moveTo({ u: 0.5, v: 1 }, 'run');
      },
    });
    expect(alternates(impacts)).toBe(true);
    expect(impacts.some((i) => i.type === 'walk')).toBe(true);
    expect(impacts.some((i) => i.type === 'run')).toBe(true);
  });

  for (const [label, step] of Object.entries(STEPS)) {
    it(`제자리 점프 ${label}: 점프마다 두 발 합친 충격 1회`, () => {
      const c = makeCharacter(makeUnit());
      const runner = new BehaviorRunner(c, {
        startProp: () => null,
        clearProps() {},
      });
      runner.start('jump');
      const start = c.position.clone();
      const impacts = simulate(c, 8, step, { runner });
      expect(impacts).toHaveLength(BEHAVIOR_PARAMS.jumps);
      for (const imp of impacts) {
        expect(imp.type).toBe('jump');
        expect(imp.feet).toEqual([0, 1]);
        expect(Math.hypot(imp.x - start.x, imp.z - start.z)).toBeLessThan(0.05);
      }
    });
  }

  it('세대 재생성: 같은 상대 위치로 옮기고 이동 계속, 영역 안 유지', () => {
    const unit = makeUnit();
    const c = makeCharacter(unit);
    c.moveTo({ u: 0.5, v: 1 }, 'run');
    simulate(c, 0.8, STEPS['60fps']);
    const small = makeUnit('201호', { w: 3, d: 4 });
    const n = c.normalizedPosition();
    const rect = walkableRect(small);
    c.place(
      small,
      rect.minX + (rect.maxX - rect.minX) * n.u,
      rect.minZ + (rect.maxZ - rect.minZ) * n.v,
    );
    const after = simulate(c, 3, STEPS['60fps']);
    expect(after.length).toBeGreaterThan(0);
    expect(c.position.z).toBeCloseTo(rect.maxZ, 1);
    expect(c.position.y).toBeCloseTo(small.floorY, 2);
  });

  it('즉시 대기(resetPose) 후 충격 없음', () => {
    const c = makeCharacter(makeUnit());
    c.moveTo({ u: 0.5, v: 1 }, 'run');
    simulate(c, 1, STEPS['60fps']);
    c.resetPose();
    expect(c.weights.idle).toBe(1);
    expect(simulate(c, 2, STEPS['60fps'])).toHaveLength(0);
  });

  it('세대 이동 중 취소: 옮기기 전이면 제자리, 콜백 실행 안 함', () => {
    const unit = makeUnit();
    const c = makeCharacter(unit);
    const runner = new BehaviorRunner(c, {
      startProp: () => null,
      clearProps() {},
    });
    let called = 0;
    c.popTo(makeUnit('202호', { x0: 0.1 }), 2, 0, () => called++);
    c.update(0.1);
    runner.cancel();
    simulate(c, 0.6, STEPS['20fps']);
    expect(c.unit).toBe(unit);
    expect(called).toBe(0);
    expect(c.group.scale.x).toBe(1);
  });

  it('세대 이동 중 즉시 대기: 크기 복원', () => {
    const c = makeCharacter(makeUnit());
    c.popTo(makeUnit('202호', { x0: 0.1 }), 2, 0);
    c.update(0.1);
    c.resetPose();
    c.update(0.1);
    expect(c.group.scale.x).toBe(1);
  });

  for (const dt of [1 / 60, 0.1]) {
    it(`뛰는 중 바로 앞(4cm) 목표: 목표를 지나치지 않음 (dt ${dt.toFixed(3)})`, () => {
      const unit = makeUnit();
      const c = makeCharacter(unit);
      const rect = walkableRect(unit);
      c.moveTo({ u: 0.5, v: 1 }, 'run');
      simulate(c, 1, () => dt);
      const z0 = c.position.z;
      const v = (z0 + 0.04 - rect.minZ) / (rect.maxZ - rect.minZ);
      c.moveTo({ u: 0.5, v }, 'run');
      simulate(c, 2, () => dt);
      expect(c.position.z - z0).toBeLessThan(0.04 + 0.01);
      expect(c.isMoving).toBe(false);
    });
  }

  it('뛰다가 정지: 감속 후 멈춤, 영역 안', () => {
    const unit = makeUnit();
    const c = makeCharacter(unit);
    c.moveTo({ u: 0.5, v: 1 }, 'run');
    simulate(c, 1, STEPS['60fps']);
    const z0 = c.position.z;
    c.stop();
    simulate(c, 1, STEPS['60fps']);
    expect(c.isMoving).toBe(false);
    expect(c.position.z - z0).toBeGreaterThan(0.05);
    expect(c.position.z - z0).toBeLessThan(0.4);
  });
});
