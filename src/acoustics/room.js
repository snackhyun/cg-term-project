/**
 * 규준화 레벨 → 수음실 레벨 보정
 * @see docs/acoustics-references.md 5절
 */

/** 기준 등가흡음면적 A0 (주거, m²) @see ISO 12354-2:2017 §3.1.1 (✅) */
export const A0 = 10;

/** 기준 잔향시간 T0 (주거, s) @see ISO 12354-2:2017 §3.1.2 (✅) */
export const T0 = 0.5;

/** Sabine 상수 C_sab (s/m) @see ISO 12354-2:2017 식 (3) (✅) */
export const C_SAB = 0.16;

/** Sabine 등가흡음면적 A = 0.16·V/T */
export function sabineAbsorption(volume, reverbTime) {
  return (C_SAB * volume) / reverbTime;
}

/**
 * 수음실 보정 10·lg(A/A0). L_i = L′_n − 이 값
 * @see ISO 12354-2:2017 §3.1.1 (✅)
 */
export function roomCorrectionDb(volume, reverbTime) {
  return 10 * Math.log10(sabineAbsorption(volume, reverbTime) / A0);
}

/**
 * 잔향 에너지 감쇠 시정수 τ = T/(6·ln 10) (60 dB 감쇠 시간 T의 정의에서)
 */
export function energyDecayTimeConstant(reverbTime) {
  return reverbTime / (6 * Math.LN10);
}
