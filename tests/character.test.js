import { describe, expect, it, vi } from 'vitest';
import { BehaviorRunner, BEHAVIOR_PARAMS } from '../src/character/behaviors.js';
import {
  RUN,
  WALK,
  gaitPose,
  gaitSpeed,
  jumpDuration,
  jumpPose,
  poseFootHeights,
} from '../src/character/gait.js';
import { impactLevel } from '../src/character/levels.js';
import {
  WALL_MARGIN,
  clampToRect,
  fromNormalized,
  toNormalized,
  traverseEndpoints,
  walkableRect,
} from '../src/character/navigation.js';
import { DROP, HAMMER, hammerAngle, stepDrop } from '../src/character/props.js';
import { BUILDING_LIMITS } from '../src/config.js';

function unitOf(w, d, x0 = 0, z0 = 0) {
  return { bounds: { minX: x0, maxX: x0 + w, minZ: z0, maxZ: z0 + d } };
}

describe('걷는 영역', () => {
  it('벽에서 1.0m 안쪽', () => {
    const r = walkableRect(unitOf(4.5, 6, 10, -3));
    expect(WALL_MARGIN).toBe(1.0);
    expect(r).toEqual({ minX: 11, maxX: 13.5, minZ: -2, maxZ: 2 });
  });

  it('최소 크기 세대에서도 경로가 있음', () => {
    const { width, depth } = BUILDING_LIMITS;
    const r = walkableRect(unitOf(width.min, depth.min));
    const [a, b] = traverseEndpoints(r);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(0.9);
  });

  it('너무 좁으면 가운데 한 점으로 줄어듦', () => {
    const r = walkableRect(unitOf(1.5, 1.8));
    expect(r.minX).toBe(r.maxX);
    expect(r.minZ).toBe(r.maxZ);
    const [a, b] = traverseEndpoints(r);
    expect(a).toEqual(b);
    expect(toNormalized(r, r.minX, r.minZ)).toEqual({ u: 0.5, v: 0.5 });
  });

  it('긴 축을 따라 왕복, 짧으면 대각선', () => {
    const r = walkableRect(unitOf(4.5, 6));
    const [a, b] = traverseEndpoints(r);
    expect(a.x).toBe(b.x);
    expect(Math.abs(b.z - a.z)).toBeCloseTo(4);
    const small = { minX: 0, maxX: 0.5, minZ: 0, maxZ: 0.8 };
    const [c, d] = traverseEndpoints(small);
    expect(c).toEqual({ x: 0, z: 0 });
    expect(d).toEqual({ x: 0.5, z: 0.8 });
  });

  it('상대 좌표 왕복 변환과 영역 제한', () => {
    const r = walkableRect(unitOf(5, 7));
    const n = toNormalized(r, 2, 3);
    const p = fromNormalized(r, n.u, n.v);
    expect(p.x).toBeCloseTo(2);
    expect(p.z).toBeCloseTo(3);
    expect(clampToRect(r, -5, 99)).toEqual({ x: r.minX, z: r.maxZ });
  });
});

describe('걸음 자세', () => {
  for (const [name, params] of [
    ['walk', WALK],
    ['run', RUN],
  ]) {
    it(`${name}: 발이 바닥을 뚫지 않고, 위상 연속`, () => {
      let prev = null;
      for (let i = 0; i <= 400; i++) {
        const t = (params.period * i) / 400;
        const pose = gaitPose(params, t);
        const h = poseFootHeights(pose);
        for (const v of h) expect(v).toBeGreaterThanOrEqual(-1e-9);
        if (prev) expect(Math.abs(pose.rootY - prev.rootY)).toBeLessThan(0.01);
        prev = pose;
      }
      const a = gaitPose(params, 0);
      const b = gaitPose(params, params.period);
      expect(b.rootY).toBeCloseTo(a.rootY, 6);
      expect(b.legs[0].theta).toBeCloseTo(a.legs[0].theta, 6);
    });
  }

  it('walk는 항상 한 발 이상 바닥, run은 두 발 모두 뜨는 구간', () => {
    let runAirborne = false;
    for (let i = 0; i < 200; i++) {
      const hw = poseFootHeights(gaitPose(WALK, (WALK.period * i) / 200));
      expect(Math.min(...hw)).toBeLessThan(1e-6);
      const hr = poseFootHeights(gaitPose(RUN, (RUN.period * i) / 200));
      if (Math.min(...hr) > 0.002) runAirborne = true;
    }
    expect(runAirborne).toBe(true);
  });

  it('뛰기가 걷기보다 빠름', () => {
    expect(gaitSpeed(RUN)).toBeGreaterThan(gaitSpeed(WALK));
  });

  it('점프: 두 발이 같이 뜨고 거의 같은 순간 착지', () => {
    const T = jumpDuration();
    const S = 1.59;
    let maxH = 0;
    let apexT = 0;
    const landed = [null, null];
    for (let i = 0; i <= 2000; i++) {
      const t = (T * i) / 2000;
      const h = poseFootHeights(jumpPose(t)).map((v) => v * S);
      for (const v of h) expect(v).toBeGreaterThanOrEqual(-1e-9);
      if (h[0] > maxH) {
        maxH = h[0];
        apexT = t;
      }
      h.forEach((v, k) => {
        if (t > apexT && landed[k] === null && v <= 0.01 && maxH > 0.1)
          landed[k] = t;
      });
    }
    expect(maxH).toBeGreaterThan(0.25);
    expect(Math.abs(landed[0] - landed[1])).toBeLessThan(0.01);
    expect(poseFootHeights(jumpPose(T))[0]).toBeCloseTo(0, 6);
  });
});

describe('소품', () => {
  it('공은 튈수록 약하게 부딪히다 멈춤', () => {
    const s = { y: DROP.height, vy: 0, resting: false };
    const hits = [];
    for (let i = 0; i < 600 && !s.resting; i++) hits.push(...stepDrop(s, 0.1));
    expect(hits.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < hits.length; i++)
      expect(hits[i]).toBeLessThan(hits[i - 1]);
    expect(hits[0]).toBeCloseTo(Math.sqrt(2 * DROP.gravity * DROP.height), 1);
    expect(s.resting).toBe(true);
  });

  it('프레임 간격과 무관하게 충돌 횟수 동일', () => {
    const count = (dt) => {
      const s = { y: DROP.height, vy: 0, resting: false };
      let n = 0;
      for (let t = 0; t < 5; t += dt) n += stepDrop(s, dt).length;
      return n;
    };
    expect(count(1 / 60)).toBe(count(0.1));
  });

  it('망치는 타격마다 바닥 각도에 머무름', () => {
    const cycle = HAMMER.raise + HAMMER.hold + HAMMER.strike + HAMMER.rest;
    for (let n = 0; n < HAMMER.strikes; n++) {
      const t =
        n * cycle +
        HAMMER.raise +
        HAMMER.hold +
        HAMMER.strike +
        HAMMER.rest / 2;
      expect(hammerAngle(t)).toBe(HAMMER.strikeAngle);
    }
    expect(hammerAngle(HAMMER.strikes * cycle + 0.01)).toBeNull();
  });
});

describe('충격 세기 조회', () => {
  it('모르는 유형은 대체 유형으로', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lookup = (type) => {
      if (type === 'run') return 'RUN';
      throw new Error(type);
    };
    expect(impactLevel('jump', undefined, lookup)).toBe('RUN');
    expect(impactLevel('nope', undefined, lookup)).toBeNull();
    warn.mockRestore();
  });

  it('값은 그대로 전달', () => {
    const v = { opaque: true };
    expect(impactLevel('walk', { a: 1 }, () => v)).toBe(v);
  });
});

/** 행동 실행기용 가짜 캐릭터 */
function fakeCharacter() {
  return {
    rect: { minX: 0, maxX: 2, minZ: 0, maxZ: 4 },
    position: { x: 1, z: 0 },
    target: null,
    moving: false,
    jumping: 0,
    log: [],
    get isMoving() {
      return this.moving;
    },
    get jumpDone() {
      return this.jumping <= 0;
    },
    moveTo(target, gait) {
      this.target = target;
      this.moving = true;
      this.log.push(['move', gait, target]);
    },
    stop() {
      this.target = null;
      this.moving = false;
      this.log.push(['stop']);
    },
    jump() {
      this.jumping = 2;
      this.log.push(['jump']);
    },
    playOnce(clip) {
      this.log.push(['once', clip]);
    },
    /** 테스트용: 목표 도착 처리 */
    tick() {
      if (this.target) {
        this.moving = false;
        this.target = null;
      }
      if (this.jumping > 0) this.jumping--;
    },
  };
}

function runner(c) {
  const props = [];
  return {
    props,
    r: new BehaviorRunner(c, {
      startProp(kind) {
        const p = { kind, done: false };
        props.push(p);
        return p;
      },
      clearProps() {
        props.forEach((p) => (p.done = true));
      },
    }),
  };
}

describe('행동 실행기', () => {
  it('걷기: 먼 쪽 끝으로 한 번', () => {
    const c = fakeCharacter();
    const { r } = runner(c);
    r.start('walk');
    r.update(0.016);
    const move = c.log.find((l) => l[0] === 'move');
    expect(move[1]).toBe('walk');
    expect(move[2]).toEqual({ u: 0.5, v: 1 });
    c.tick();
    r.update(0.016);
    expect(r.busy).toBe(false);
  });

  it('아이 뛰기: 시간 동안 왕복 후 정지', () => {
    const c = fakeCharacter();
    const { r } = runner(c);
    r.start('run');
    let t = 0;
    while (r.busy && t < 30) {
      r.update(0.5);
      c.tick();
      t += 0.5;
    }
    const moves = c.log.filter((l) => l[0] === 'move');
    expect(moves.length).toBeGreaterThan(3);
    expect(moves.every((m) => m[1] === 'run')).toBe(true);
    expect(moves[0][2]).not.toEqual(moves[1][2]);
    expect(t).toBeGreaterThanOrEqual(BEHAVIOR_PARAMS.runDuration);
    expect(t).toBeLessThan(BEHAVIOR_PARAMS.runDuration + 2);
  });

  it('제자리 점프 횟수', () => {
    const c = fakeCharacter();
    const { r } = runner(c);
    r.start('jump');
    for (let i = 0; i < 200 && r.busy; i++) {
      r.update(0.05);
      c.tick();
    }
    expect(c.log.filter((l) => l[0] === 'jump')).toHaveLength(
      BEHAVIOR_PARAMS.jumps,
    );
  });

  it('소품 행동은 소품이 끝나면 종료, 취소 시 소품 정리', () => {
    const c = fakeCharacter();
    const { r, props } = runner(c);
    r.start('hammer');
    r.update(0.016);
    expect(props).toHaveLength(1);
    expect(r.busy).toBe(true);
    props[0].done = true;
    r.update(0.016);
    expect(r.busy).toBe(false);

    r.start('drop');
    r.update(0.016);
    expect(c.log.some((l) => l[0] === 'once' && l[1] === 'interact')).toBe(
      true,
    );
    r.cancel();
    expect(props[1].done).toBe(true);
    expect(r.busy).toBe(false);
  });
});
