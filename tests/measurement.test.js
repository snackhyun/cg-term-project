import { describe, expect, it } from 'vitest';
import {
  LMAX_RULE,
  bandResponseTerms,
  toDb,
  toEnergy,
} from '../src/acoustics/index.js';
import { classifyUnit } from '../src/simulation/measurement.js';
import { LevelMeter, rollingLeq } from '../src/simulation/meter.js';

const terms = bandResponseTerms(0.02, 0.5);
const nb = terms.length;
const oneBand = (b, L) => {
  const w = new Float64Array(nb);
  w[b] = toEnergy(L);
  return w;
};

describe('rollingLeq', () => {
  it('분모는 항상 구간 길이', () => {
    expect(rollingLeq([{ t: 1, energyA: toEnergy(50) }], 2, 20)).toBeCloseTo(
      50 - 10 * Math.log10(20),
      6,
    );
    expect(rollingLeq([], 2, 20)).toBe(-Infinity);
  });

  it('구간 밖 노출 제외', () => {
    expect(rollingLeq([{ t: 1, energyA: 1e5 }], 30, 20)).toBe(-Infinity);
  });
});

describe('LevelMeter', () => {
  it('Leq = 노출 에너지 합 / 구간', () => {
    const m = new LevelMeter(terms);
    m.reset(0);
    for (let i = 0; i < 10; i++)
      m.arrive(i, oneBand(1, 60), oneBand(1, 0), 20, toEnergy(57));
    m.advance(10, toEnergy(57));
    expect(m.leq(10, 20)).toBeCloseTo(60 + 10 - 10 * Math.log10(20), 6);
    expect(m.leqMax).toBeCloseTo(m.leq(10, 20), 6);
  });

  it('L_max는 노출레벨 + 10·lg(1/τ_F) 이하, 초과 1회 = 상승 1번', () => {
    const m = new LevelMeter(terms);
    m.reset(0);
    m.arrive(0, oneBand(3, 60), oneBand(3, 0), 20, toEnergy(57));
    m.advance(2, toEnergy(57));
    expect(m.lmax).toBeLessThan(60 + 9.04);
    expect(m.lmax).toBeGreaterThan(60);
    expect(m.exceedanceCount(2)).toBe(1);
    expect(m.laf).toBeLessThan(5);
  });

  it('1시간 지난 초과는 세지 않음', () => {
    const m = new LevelMeter(terms);
    m.reset(0);
    m.arrive(0, oneBand(3, 60), oneBand(3, 0), 20, toEnergy(57));
    m.advance(1, toEnergy(57));
    expect(m.exceedanceCount(LMAX_RULE.periodSeconds + 1)).toBe(0);
  });

  it('대역별 Leq', () => {
    const m = new LevelMeter(terms);
    m.reset(0);
    const bands = new Float64Array(nb).fill(-Infinity);
    bands[0] = 70;
    m.arrive(0, oneBand(0, 43.8), bands, 20, toEnergy(57));
    expect(m.bandLeq(1, 20)[0]).toBeCloseTo(70 - 10 * Math.log10(20), 6);
    expect(toDb(0)).toBe(-Infinity);
  });
});

describe('classifyUnit', () => {
  it('발생 > 조용 > 초과/이하', () => {
    const lim = { leq: 39, lmax: 57 };
    const u = { leqMax: 39, lmaxCount: 0, isSource: false, heard: true };
    expect(classifyUnit({ ...u, isSource: true }, lim)).toBe('source');
    expect(classifyUnit({ ...u, heard: false }, lim)).toBe('quiet');
    expect(classifyUnit(u, lim)).toBe('over');
    expect(classifyUnit({ ...u, leqMax: 38.9 }, lim)).toBe('under');
  });
});
