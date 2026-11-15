import { describe, expect, it } from 'vitest';
import {
  FAST_TIME_CONSTANT,
  cascadeTerms,
  createResponseTable,
  evaluateTerms,
  singleImpactFastMax,
} from '../src/acoustics/index.js';

function integrate(terms, T = 10, dt = 1e-4) {
  let s = 0;
  for (let t = 0; t < T; t += dt) s += evaluateTerms(terms, t) * dt;
  return s;
}

describe('1차계 직렬 응답', () => {
  it('면적 1 (에너지 보존), h(0) = 0', () => {
    const terms = cascadeTerms([0.1, 0.036, FAST_TIME_CONSTANT]);
    expect(integrate(terms)).toBeCloseTo(1, 3);
    expect(evaluateTerms(terms, 0)).toBeCloseTo(0, 9);
  });

  it('같은 τ도 처리', () => {
    const terms = cascadeTerms([0.125, 0.125, 0.036]);
    expect(integrate(terms)).toBeCloseTo(1, 3);
  });

  it('아주 짧은 충격·잔향이면 L_max → L_E + 10·lg(1/τ_F) 상한', () => {
    const terms = [cascadeTerms([1e-4, 2e-4, FAST_TIME_CONSTANT])];
    const peak = singleImpactFastMax([1], createResponseTable(terms, 1e-5));
    expect(10 * Math.log10(peak)).toBeCloseTo(
      10 * Math.log10(1 / FAST_TIME_CONSTANT),
      1,
    );
  });
});
