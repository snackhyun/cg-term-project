import { describe, expect, it } from 'vitest';
import {
  A_WEIGHTING,
  BANDS,
  CONCRETE,
  HOLD_EMIT_INTERVAL,
  LEGAL_LIMITS,
  absorptionLength,
  aWeightedSumDb,
  aWeightingAt,
  bendingWaveSpeed,
  criticalFrequency,
  cylindricalSpreadingDb,
  floatingFloorImprovement,
  floatingFloorResonance,
  judgeUnit,
  kijCrossCorner,
  kijCrossStraight,
  legalLimits,
  legalThresholdDb,
  massRatioExponent,
  materialDampingDb,
  normalizedImpactLevel,
  radiationFactorAt,
  radiationFactorOctave,
  roomCorrectionDb,
  sourceLevelDb,
  SOURCE_TYPES,
  structuralReverbTime,
  surfaceDensity,
  tappingForceLevel,
  velocityLevelDifference,
  weightedImpactLevelEq,
} from '../src/acoustics/index.js';

const cL = CONCRETE.longitudinalSpeed;

/** 참고문서 1a */
describe('맨 슬래브 단일수치 (1a)', () => {
  it('210 mm, ρ 2400 → m′ 504, L_n,w,eq 69.4 dB', () => {
    const m = surfaceDensity(2400, 0.21);
    expect(m).toBeCloseTo(504, 6);
    expect(weightedImpactLevelEq(m)).toBeCloseTo(69.4, 1);
    expect(weightedImpactLevelEq(surfaceDensity(2300, 0.21))).toBeCloseTo(
      70.1,
      1,
    );
  });
});

/** 참고문서 1b, 4절 */
describe('굽힘파·임계주파수·대역별 L_n', () => {
  it('f_c = 81.9 Hz (h 0.21, c_L 3800)', () => {
    expect(criticalFrequency(0.21, cL)).toBeCloseTo(81.9, 1);
  });

  it('c_B 표 (63/125/250/500 Hz)', () => {
    const expected = [300.8, 423.7, 599.2, 847.5];
    [63, 125, 250, 500].forEach((f, i) =>
      expect(bendingWaveSpeed(f, 0.21, cL)).toBeCloseTo(expected[i], 1),
    );
  });

  it('5 m 재료감쇠는 1 dB 미만 (η 0.005 / 0.02)', () => {
    expect(materialDampingDb(5, 63, 0.005, 0.21, cL)).toBeCloseTo(0.07, 2);
    expect(materialDampingDb(5, 500, 0.02, 0.21, cL)).toBeCloseTo(0.8, 2);
    expect(cylindricalSpreadingDb(5)).toBeCloseTo(7.0, 1);
  });

  it('L_n 표 (η 0.02, 점 주파수 σ): 64.3 / 66.7 / 65.2 / 64.7', () => {
    const fc = criticalFrequency(0.21, cL);
    const expected = [64.3, 66.7, 65.2, 64.7];
    [63, 125, 250, 500].forEach((f, i) => {
      const L = normalizedImpactLevel(f, 504, 0.02, radiationFactorAt(f, fc));
      expect(L).toBeCloseTo(expected[i], 1);
    });
    expect(structuralReverbTime(63, 0.02)).toBeCloseTo(1.75, 2);
  });

  it('η 0.01이면 모든 대역 +3.0 dB', () => {
    const d =
      normalizedImpactLevel(250, 504, 0.01, 1) -
      normalizedImpactLevel(250, 504, 0.02, 1);
    expect(d).toBeCloseTo(3.0, 1);
  });

  it('옥타브 평균 σ: f_c를 포함하지 않는 대역은 점 값과 비슷, 발산 없음', () => {
    const fc = criticalFrequency(0.21, cL);
    expect(radiationFactorOctave(1000, fc)).toBeCloseTo(
      radiationFactorAt(1000, fc),
      1,
    );
    expect(radiationFactorOctave(30, fc)).toBe(1);
    for (let h = 0.12; h <= 0.3; h += 0.005) {
      const s = radiationFactorOctave(125, criticalFrequency(h, cL));
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeLessThan(3);
    }
  });
});

/** 참고문서 2절 */
describe('뜬바닥 (2a, 2b)', () => {
  it('m′ 104, s′ 10/20/40 → f0 49.6/70.2/99.2, ΔL 표', () => {
    const table = {
      10: [49.6, [3.1, 12.0, 21.1, 30.1]],
      20: [70.2, [0, 7.5, 16.6, 25.6]],
      40: [99.2, [0, 3.0, 12.0, 21.1]],
    };
    for (const [s, [f0, dl]] of Object.entries(table)) {
      const r = floatingFloorResonance(Number(s), 104);
      expect(r).toBeCloseTo(f0, 1);
      [63, 125, 250, 500].forEach((f, i) =>
        expect(floatingFloorImprovement(f, r)).toBeCloseTo(dl[i], 1),
      );
    }
  });

  it('감쇠 큰 건식은 40·lg', () => {
    expect(
      floatingFloorImprovement(200, 100, { highlyDamped: true }),
    ).toBeCloseTo(12.04, 2);
  });
});

/** 참고문서 3절 */
describe('접합부 (3a, 3c, 3d)', () => {
  it('슬래브 504 / 벽 480: M −0.0212, K13 8.34, K12 8.70', () => {
    const M = massRatioExponent(480, 504);
    expect(M).toBeCloseTo(-0.0212, 4);
    expect(kijCrossStraight(M)).toBeCloseTo(8.34, 2);
    expect(kijCrossCorner(M)).toBeCloseTo(8.7, 2);
  });

  it('D_v,situ: 125 Hz a 4.07/2.03 → 6.91 dB, 500 Hz → 9.92 dB', () => {
    const K = kijCrossStraight(massRatioExponent(480, 504));
    const at = (f) => {
      const Ts = structuralReverbTime(f, 0.02);
      return [absorptionLength(20, Ts, f), absorptionLength(10, Ts, f)];
    };
    const [a1, a2] = at(125);
    expect(a1).toBeCloseTo(4.07, 2);
    expect(a2).toBeCloseTo(2.03, 1);
    expect(velocityLevelDifference(K, 4, a1, a2)).toBeCloseTo(6.91, 2);
    const [b1, b2] = at(500);
    expect(velocityLevelDifference(K, 4, b1, b2)).toBeCloseTo(9.92, 2);
  });
});

/** 참고문서 5절 */
describe('수음실 보정 (5a)', () => {
  it('3.9 × 4.5 × 2.4 m, T 0.5 s → −1.3 dB', () => {
    expect(roomCorrectionDb(3.9 * 4.5 * 2.4, 0.5)).toBeCloseTo(1.3, 1);
  });
});

/** 참고문서 6절 */
describe('A특성 (6)', () => {
  it('표값과 해석식이 0.1 dB 안에서 일치 (정확한 밑-10 중심주파수)', () => {
    BANDS.forEach((f, b) => {
      const exact = Math.pow(10, Math.round(10 * Math.log10(f)) / 10);
      expect(Math.abs(aWeightingAt(exact) - A_WEIGHTING[b])).toBeLessThan(0.06);
    });
  });

  it('[70, 65, 60, 55] dB → 55.9 dB(A)', () => {
    expect(aWeightedSumDb([70, 65, 60, 55])).toBeCloseTo(55.9, 1);
  });
});

/** 참고문서 7절 */
describe('법정 기준 (7)', () => {
  it('주간 39/57, 야간 34/52', () => {
    expect(LEGAL_LIMITS.day).toEqual({ leq: 39, lmax: 57 });
    expect(legalLimits(true)).toEqual({ leq: 34, lmax: 52 });
    expect(legalThresholdDb(false)).toBe(39);
  });

  it('Leq 또는 L_max 3회 이상이면 초과, 발생 세대는 판정 제외', () => {
    const lim = LEGAL_LIMITS.day;
    const base = { leqMax: 30, lmaxCount: 0, isSource: false, heard: true };
    expect(judgeUnit(base, lim).status).toBe('under');
    expect(judgeUnit({ ...base, leqMax: 39 }, lim)).toMatchObject({
      status: 'over',
      leqOver: true,
    });
    expect(judgeUnit({ ...base, lmaxCount: 2 }, lim).status).toBe('under');
    expect(judgeUnit({ ...base, lmaxCount: 3 }, lim)).toMatchObject({
      status: 'over',
      lmaxOver: true,
    });
    expect(judgeUnit({ ...base, leqMax: 60, isSource: true }, lim).status).toBe(
      'source',
    );
    expect(judgeUnit({ ...base, heard: false }, lim).status).toBe('quiet');
  });
});

/** 참고문서 9절 */
describe('음원 (9)', () => {
  it('태핑머신 대역 힘 레벨 22.4 / 25.4 / 28.4 / 31.4 dB', () => {
    const expected = [22.4, 25.4, 28.4, 31.4];
    [63, 125, 250, 500].forEach((f, i) =>
      expect(tappingForceLevel(f)).toBeCloseTo(expected[i], 1),
    );
  });

  it('뱅머신·고무공은 표값 그대로, 자료 없는 대역은 −∞', () => {
    expect(sourceLevelDb('jump').forceExposure.slice(0, 4)).toEqual([
      40, 22, 11.5, 5.5,
    ]);
    expect(sourceLevelDb('run').forceExposure.slice(0, 4)).toEqual([
      31, 23, 17, 12.5,
    ]);
    expect(sourceLevelDb('run').forceExposure[4]).toBe(-Infinity);
  });

  it('태핑형 1회 노출 = L_F,tap − 10·lg(10)', () => {
    const click = sourceLevelDb('click').forceExposure;
    BANDS.forEach((f, b) =>
      expect(click[b]).toBeCloseTo(tappingForceLevel(f) - 10, 9),
    );
    expect(HOLD_EMIT_INTERVAL).toBeCloseTo(0.1, 9);
  });

  it('지원 유형과 불변 반환값', () => {
    for (const t of [
      'click',
      'hold',
      'walk',
      'run',
      'jump',
      'hammer',
      'drop',
    ]) {
      expect(SOURCE_TYPES).toContain(t);
      expect(Object.isFrozen(sourceLevelDb(t))).toBe(true);
    }
    expect(sourceLevelDb('hold', { holdTime: 5 })).toBe(sourceLevelDb('hold'));
    expect(() => sourceLevelDb('unknown')).toThrow();
  });
});

describe('충돌 속도에 따른 낙하 음원', () => {
  it('충격량 ∝ 속도: 속도 절반이면 6.02 dB 작음, opts 없으면 기준값', () => {
    const ref = sourceLevelDb('drop').forceExposure;
    const v0 = Math.sqrt(2 * 9.81 * 0.75);
    const half = sourceLevelDb('drop', { impactSpeed: v0 / 2 }).forceExposure;
    BANDS.forEach((_, b) =>
      expect(ref[b] - half[b]).toBeCloseTo(20 * Math.log10(2), 6),
    );
    const same = sourceLevelDb('drop', { impactSpeed: v0 }).forceExposure;
    BANDS.forEach((_, b) => expect(same[b]).toBeCloseTo(ref[b], 9));
    expect(sourceLevelDb('drop', { impactSpeed: NaN })).toBe(
      sourceLevelDb('drop'),
    );
    expect(sourceLevelDb('drop', { intensity: 0.3 })).toBe(
      sourceLevelDb('drop'),
    );
    expect(sourceLevelDb('run', { impactSpeed: 1 })).toBe(sourceLevelDb('run'));
  });
});
