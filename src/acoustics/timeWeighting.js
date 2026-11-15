/**
 * 충격 1회의 시간 응답과 Fast 시간가중 (L_AF, L_max)
 * 슬래브 잔향(T_s) → 실내 잔향(T) → Fast(τ = 0.125 s) 1차계 3단 직렬, 각 단 DC 이득 1
 */
import { BANDS } from './bands.js';
import { energyDecayTimeConstant } from './room.js';
import { structuralReverbTime } from './slab.js';

/** Fast 시정수 (s) @see IEC 61672-1 (참고문서 10-1, τ = 0.125 s) */
export const FAST_TIME_CONSTANT = 0.125;

/**
 * Π 1/(1 + s·τ_k) 임펄스 응답 h(t) = Σ c_k·e^(−t/τ_k)의 계수
 * c_k = τ_k^(n−2) / Π_{m≠k}(τ_k − τ_m). 같은 τ는 1e-4 비율로 벌려 처리
 * @returns {{ tau: number, coef: number }[]}
 */
export function cascadeTerms(taus) {
  const t = [...taus].sort((a, b) => a - b);
  for (let i = 1; i < t.length; i++) {
    if (t[i] - t[i - 1] < 1e-4 * t[i]) t[i] = t[i - 1] * (1 + 1e-4);
  }
  const n = t.length;
  return t.map((tk, k) => {
    let den = 1;
    for (let m = 0; m < n; m++) if (m !== k) den *= tk - t[m];
    return { tau: tk, coef: Math.pow(tk, n - 2) / den };
  });
}

/** 항 목록으로 h(t) 계산 */
export function evaluateTerms(terms, t) {
  let y = 0;
  for (const { tau, coef } of terms) y += coef * Math.exp(-t / tau);
  return y;
}

/**
 * 대역별 응답 항. 각 대역 [τ_slab(f), τ_room, τ_F]
 * τ_slab = T_s/(6 ln10), T_s = 2.2/(f·η)
 * @returns {{ tau: number, coef: number }[][]} BANDS 순서
 */
export function bandResponseTerms(lossFactor, reverbTime) {
  const tauRoom = energyDecayTimeConstant(reverbTime);
  return BANDS.map((f) =>
    cascadeTerms([
      energyDecayTimeConstant(structuralReverbTime(f, lossFactor)),
      tauRoom,
      FAST_TIME_CONSTANT,
    ]),
  );
}

/**
 * 대역별 h_b(t) 표. 범위는 0 ~ 가장 늦은 대역 최대점
 * 각 h_b는 단봉형(1차계 직렬)이라 합의 최대도 이 범위 안
 */
export function createResponseTable(terms, dt = 0.002) {
  const peakTimes = terms.map((band) => {
    let best = 0;
    let tBest = 0;
    let tauMax = 0;
    for (const { tau } of band) tauMax = Math.max(tauMax, tau);
    for (let t = dt; t <= 8 * tauMax; t += dt) {
      const y = evaluateTerms(band, t);
      if (y > best) [best, tBest] = [y, t];
    }
    return tBest;
  });
  const steps = Math.ceil(Math.max(...peakTimes) / dt) + 2;
  const values = terms.map((band) => {
    const arr = new Float64Array(steps);
    for (let i = 0; i < steps; i++) arr[i] = evaluateTerms(band, i * dt);
    return arr;
  });
  return { dt, steps, values };
}

/**
 * 충격 1회의 Fast 최대값 (에너지 비)
 * @param {ArrayLike<number>} weights 대역별 A가중 노출 에너지 (p²·s / p0²)
 * @param {{ steps: number, values: Float64Array[] }} table createResponseTable 결과
 */
export function singleImpactFastMax(weights, table) {
  let best = 0;
  for (let i = 0; i < table.steps; i++) {
    let y = 0;
    for (let b = 0; b < weights.length; b++)
      y += weights[b] * table.values[b][i];
    if (y > best) best = y;
  }
  return best;
}
