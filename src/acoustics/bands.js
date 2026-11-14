/**
 * 옥타브 대역, A특성, dB·에너지 변환
 * @see docs/acoustics-references.md 6절
 */

/** 옥타브 중심 주파수 (Hz) */
export const BANDS = Object.freeze([63, 125, 250, 500, 1000, 2000]);

/** 표준 상세모델 범위(125–2000 Hz 옥타브) 밖이라 외삽인 대역 */
export const EXTRAPOLATED_BANDS = Object.freeze([63]);

/**
 * 옥타브 A특성 보정값 (dB), BANDS 순서
 * @see IEC 61672-1:2013 표값 (해석식으로 재계산해 일치 확인, ⚠️)
 */
export const A_WEIGHTING = Object.freeze([-26.2, -16.1, -8.6, -3.2, 0, 1.2]);

/** 기준 주파수 f_ref (Hz) */
export const F_REF = 1000;

/**
 * IEC 61672-1 A특성 해석식 (검증용)
 * @see Wikipedia "A-weighting" (IEC 61672-1:2013 인용, ⚠️)
 */
export function aWeightingAt(f) {
  const ra = (x) =>
    (12194 ** 2 * x ** 4) /
    ((x * x + 20.6 ** 2) *
      Math.sqrt((x * x + 107.7 ** 2) * (x * x + 737.9 ** 2)) *
      (x * x + 12194 ** 2));
  return 20 * Math.log10(ra(f)) - 20 * Math.log10(ra(1000));
}

/** 옥타브 대역 경계 [f/√2, f·√2] */
export function octaveEdges(f) {
  return [f / Math.SQRT2, f * Math.SQRT2];
}

/** 옥타브 대역폭 Δf = f/√2 */
export function octaveBandwidth(f) {
  return f / Math.SQRT2;
}

/** dB → 에너지 비 10^(L/10) */
export function toEnergy(dB) {
  return Math.pow(10, dB / 10);
}

/** 에너지 비 → dB. 0 이하면 -Infinity */
export function toDb(energy) {
  return energy > 0 ? 10 * Math.log10(energy) : -Infinity;
}

/** 레벨 에너지 합 10·lg Σ10^(L/10) */
export function energySumDb(levels) {
  let e = 0;
  for (const L of levels) e += toEnergy(L);
  return toDb(e);
}

/** 대역 레벨 → A가중 합 dB(A) */
export function aWeightedSumDb(bandLevels) {
  let e = 0;
  for (let b = 0; b < bandLevels.length; b++) {
    e += toEnergy(bandLevels[b] + A_WEIGHTING[b]);
  }
  return toDb(e);
}
