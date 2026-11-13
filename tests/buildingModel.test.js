import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_SCENARIO as S,
  createAcousticModel,
  sourceLevelDb,
  toDb,
} from '../src/acoustics/index.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const lafmax = (building, acoustics, type, from = S.from, to = S.to) =>
  toDb(
    createAcousticModel(building, acoustics).impactLevels(
      sourceLevelDb(type),
      from,
    )[to].fastMaxA,
  );
const lae = (building, acoustics, type, from = S.from, to = S.to) =>
  toDb(
    createAcousticModel(building, acoustics).impactLevels(
      sourceLevelDb(type),
      from,
    )[to].exposureA,
  );
const bare = { ...S.acoustics, floatingFloor: false };

describe('보정 (CALIBRATION_DB)', () => {
  it('고무공, 표준바닥구조, 바로 아래 세대 L_AFmax = 47 dB(A)', () => {
    expect(lafmax(S.building, S.acoustics, S.source)).toBeCloseTo(
      S.targetLAFmax,
      1,
    );
  });

  it('보정 시나리오 = 기본 설정', () => {
    expect(S.building).toEqual(DEFAULT_CONFIG.building);
    expect(S.acoustics).toEqual(DEFAULT_CONFIG.acoustics);
  });
});

describe('결과 점검 (보정 외 손으로 맞춘 값 없음)', () => {
  it('가벼운 발걸음 1회는 L_max 기준 이하, 1분 Leq도 이하', () => {
    const L = lafmax(S.building, S.acoustics, 'walk');
    expect(L).toBeLessThan(57);
    expect(
      lae(S.building, S.acoustics, 'walk') - 10 * Math.log10(60),
    ).toBeLessThan(39);
  });

  it('맨 210 mm 슬래브에서 아이가 1분 내내 뛰면 (4걸음/s) Leq 39 초과', () => {
    const leq = lae(S.building, bare, 'run') + 10 * Math.log10(4);
    expect(leq).toBeGreaterThan(39);
  });

  it('뜬바닥은 아이 뛰기보다 망치질을 훨씬 많이 줄임', () => {
    const gain = (t) =>
      lafmax(S.building, bare, t) - lafmax(S.building, S.acoustics, t);
    expect(gain('hammer')).toBeGreaterThan(15);
    expect(gain('run')).toBeLessThan(5);
    expect(gain('hammer') - gain('run')).toBeGreaterThan(10);
  });

  it('슬래브가 얇을수록 시끄러움 (f_c가 63 Hz 대역 끝을 지나는 0.19–0.20 m에서 0.6 dB 이하 역전)', () => {
    const at = (h) =>
      lafmax({ ...S.building, slabThickness: h }, S.acoustics, 'run');
    expect(at(0.12)).toBeGreaterThan(at(0.15));
    expect(at(0.15)).toBeGreaterThan(at(0.21));
    expect(at(0.21)).toBeGreaterThan(at(0.25));
    expect(at(0.25)).toBeGreaterThan(at(0.3));
    let prev = -Infinity;
    for (let i = 30; i >= 12; i--) {
      const L = at(i / 100);
      expect(L).toBeGreaterThan(prev - 0.6);
      prev = L;
    }
  });

  it('η가 작을수록 시끄러움 (절대 레벨)', () => {
    const lo = lae(S.building, { ...S.acoustics, lossFactor: 0.01 }, 'click');
    const hi = lae(S.building, { ...S.acoustics, lossFactor: 0.02 }, 'click');
    expect(lo).toBeGreaterThan(hi);
  });

  it('501호 → 바로 아래(401) > 대각선(402), 먼 층일수록 작음', () => {
    const b = { ...S.building, floors: 5 };
    const m = createAcousticModel(b, S.acoustics);
    const r = m
      .impactLevels(sourceLevelDb('run'), 8)
      .map((u) => toDb(u.fastMaxA));
    expect(r[6]).toBeGreaterThan(r[7]);
    expect(r[6]).toBeGreaterThan(r[4]);
    expect(r[4]).toBeGreaterThan(r[2]);
    expect(r[2]).toBeGreaterThan(r[0]);
    expect(r[0]).toBeGreaterThan(-Infinity);
  });
});

describe('벽 충격', () => {
  const m = () => createAcousticModel(S.building, S.acoustics);
  const lv = (model, wall, to, type = 'hammer') =>
    toDb(model.impactLevels(sourceLevelDb(type), 2, wall)[to].fastMaxA);

  it('201호 오른쪽(세대 간) 벽 → 202호가 가장 큼, 뒤 벽보다 202호에 크게', () => {
    const model = m();
    const right = [0, 1, 3].map((to) => lv(model, 2, to));
    expect(right[2]).toBeGreaterThan(right[0]);
    expect(right[2]).toBeGreaterThan(right[1]);
    expect(lv(model, 2, 3)).toBeGreaterThan(lv(model, 0, 3));
  });

  it('벽 충격에는 뜬바닥 저감 없음', () => {
    const bare = createAcousticModel(S.building, {
      ...S.acoustics,
      floatingFloor: false,
    });
    expect(lv(bare, 2, 3)).toBeCloseTo(lv(m(), 2, 3), 6);
    expect(lv(bare, null, 0)).toBeGreaterThan(lv(m(), null, 0) + 10);
  });

  it('wall 생략 시 바닥 충격과 같음', () => {
    const model = m();
    const a = model.impactLevels(sourceLevelDb('run'), 2)[0].fastMaxA;
    const b = model.impactLevels(sourceLevelDb('run'), 2, null)[0].fastMaxA;
    expect(a).toBe(b);
  });
});
