import { describe, expect, it } from 'vitest';
import { FootfallDetector } from '../src/character/footfall.js';
import { RUN, WALK, gaitPose, poseFootHeights } from '../src/character/gait.js';

/** 합성 발 높이: 주기 T, 지지 비율 duty, 최고 높이 lift (m) */
function synthHeight(t, { T = 0.5, duty = 0.4, lift = 0.08, phase = 0 } = {}) {
  const p = (((t / T + phase) % 1) + 1) % 1;
  if (p < duty) return 0;
  return lift * Math.sin((Math.PI * (p - duty)) / (1 - duty));
}

/** 합성 데이터의 실제 착지 시각 (p = 0) */
function trueContacts(duration, { T = 0.5, phase = 0 } = {}) {
  const out = [];
  for (let k = 0; ; k++) {
    const t = (k - phase) * T;
    if (t > duration) break;
    if (t > 1e-9) out.push(t);
  }
  return out;
}

/** dt 목록으로 검출 실행 */
function run(detector, dts, heightsAt) {
  let t = 0;
  const events = [];
  detector.reset(heightsAt(0));
  for (const dt of dts) {
    t += dt;
    for (const e of detector.update(t, heightsAt(t))) events.push({ ...e, t });
  }
  return events;
}

function constantDts(duration, dt) {
  return Array.from({ length: Math.round(duration / dt) }, () => dt);
}

/** 재현 가능한 의사 난수 */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('FootfallDetector', () => {
  const opts = { T: 0.5, duty: 0.4, lift: 0.08 };

  for (const [label, dt] of [
    ['60fps', 1 / 60],
    ['20fps', 1 / 20],
    ['10fps (delta 상한)', 0.1],
  ]) {
    it(`${label}: 착지마다 정확히 1회`, () => {
      const duration = 5;
      const events = run(
        new FootfallDetector(1),
        constantDts(duration, dt),
        (t) => [synthHeight(t, opts)],
      );
      const truth = trueContacts(duration, opts);
      expect(events).toHaveLength(truth.length);
      events.forEach((e, i) => {
        expect(e.t - truth[i]).toBeGreaterThanOrEqual(-1e-9);
        expect(e.t - truth[i]).toBeLessThanOrEqual(dt + 1e-9);
      });
    });
  }

  it('불규칙한 프레임 간격에서도 누락·중복 없음', () => {
    const r = rng(7);
    const dts = [];
    let total = 0;
    while (total < 8) {
      const dt = 0.004 + r() * 0.096; // 4~100ms
      dts.push(dt);
      total += dt;
    }
    const events = run(new FootfallDetector(1), dts, (t) => [
      synthHeight(t, opts),
    ]);
    expect(events).toHaveLength(trueContacts(total, opts).length);
  });

  it('문턱 근처 떨림은 한 번만 셈', () => {
    const d = new FootfallDetector(1);
    d.reset([0.1]);
    const seq = [0.05, 0.009, 0.012, 0.008, 0.02, 0.009, 0.0];
    const hits = seq.flatMap((h, i) => d.update(0.3 + i * 0.016, [h]));
    expect(hits).toHaveLength(1);
  });

  it('처음부터 바닥에 있는 발은 세지 않음', () => {
    const d = new FootfallDetector(2);
    d.reset([0, 0]);
    expect(d.update(0.1, [0, 0])).toHaveLength(0);
    expect(d.update(0.2, [0.005, 0.0])).toHaveLength(0);
  });

  it('반쯤만 뜬 발(블렌딩 중)은 다시 세지 않음', () => {
    const d = new FootfallDetector(1);
    d.reset([0.1]);
    expect(d.update(0.1, [0.0])).toHaveLength(1);
    // liftHeight(0.03) 아래에서 들썩임
    for (const [i, h] of [0.02, 0.0, 0.025, 0.0].entries()) {
      expect(d.update(0.2 + i * 0.1, [h])).toHaveLength(0);
    }
  });

  it('두 발은 각각 셈, 문턱 통과 비율', () => {
    const d = new FootfallDetector(2);
    d.reset([0.05, 0.05]);
    const hits = d.update(0.1, [0.0, 0.03]);
    expect(hits.map((h) => h.foot)).toEqual([0]);
    expect(hits[0].fraction).toBeCloseTo(0.8);
    const next = d.update(0.2, [0.0, 0.0]);
    expect(next.map((h) => h.foot)).toEqual([1]);
    expect(next[0].fraction).toBeCloseTo(2 / 3);
  });

  it('클립 반복 경계(시간 되감기)에서도 연속 높이면 정상', () => {
    // 반복 클립: 같은 높이 함수를 반복 시간으로 평가
    const clip = 0.5;
    const events = run(new FootfallDetector(1), constantDts(3, 1 / 30), (t) => [
      synthHeight(t % clip, opts),
    ]);
    expect(events).toHaveLength(trueContacts(3, opts).length);
  });

  it('minInterval 안의 재착지는 무시', () => {
    const d = new FootfallDetector(1, { minInterval: 0.2 });
    d.reset([0.1]);
    expect(d.update(0.1, [0])).toHaveLength(1);
    d.update(0.15, [0.05]);
    expect(d.update(0.2, [0])).toHaveLength(0);
  });
});

describe('생성한 걸음 자세의 발 높이로 검출', () => {
  const S = 1.59; // 모델 단위 → m

  for (const [name, params] of [
    ['walk', WALK],
    ['run', RUN],
  ]) {
    for (const dt of [1 / 60, 1 / 24, 0.1]) {
      it(`${name} ${Math.round(1 / dt)}fps: 한 주기에 두 번, 왼발·오른발 번갈아`, () => {
        const cycles = 6;
        const duration = params.period * cycles;
        const heightsAt = (t) =>
          poseFootHeights(gaitPose(params, t)).map((h) => h * S);
        const events = run(
          new FootfallDetector(2),
          constantDts(duration, dt),
          heightsAt,
        );
        expect(events.length).toBeGreaterThanOrEqual(2 * cycles - 1);
        expect(events.length).toBeLessThanOrEqual(2 * cycles);
        for (let i = 1; i < events.length; i++) {
          expect(events[i].foot).not.toBe(events[i - 1].foot);
        }
      });
    }
  }

  it('walk 착지 시각은 뒤꿈치 착지(위상 0) 직후 0.06초 이내', () => {
    const dt = 1 / 120;
    const heightsAt = (t) =>
      poseFootHeights(gaitPose(WALK, t)).map((h) => h * S);
    const events = run(
      new FootfallDetector(2),
      constantDts(WALK.period * 4, dt),
      heightsAt,
    );
    // 왼발 뒤꿈치 착지: t = (1 - duty/2) * period + k * period
    const strikeL = (1 - WALK.duty / 2) * WALK.period;
    for (const e of events.filter((ev) => ev.foot === 0)) {
      const k = Math.round((e.t - strikeL) / WALK.period);
      const err = e.t - (strikeL + k * WALK.period);
      expect(err).toBeGreaterThanOrEqual(-0.02);
      expect(err).toBeLessThanOrEqual(0.06);
    }
  });
});
