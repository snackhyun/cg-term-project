/**
 * 콘크리트 슬래브: 굽힘파, 임계주파수, 방사효율, 규준화 바닥충격음레벨
 * @see docs/acoustics-references.md 1, 4절
 */
import { F_REF, octaveEdges } from './bands.js';

/** 공기 중 음속 c0 (m/s) */
export const C0 = 343;

/**
 * 콘크리트 물성 (η_int, ρ, c_L, ν)
 * @see Hopkins et al., Applied Acoustics 113 (2016) Table 1 (✅)
 */
export const CONCRETE = Object.freeze({
  internalLossFactor: 0.005,
  density: 2200,
  longitudinalSpeed: 3800,
  poisson: 0.2,
});

/** 면밀도 m′ = ρ·h (kg/m²) */
export function surfaceDensity(density, thickness) {
  return density * thickness;
}

/**
 * 굽힘파 위상속도 c_B = √(1.8·c_L·h·f)
 * @see 얇은 판 이론 유도식 (⚠️), 참고문서 4a
 */
export function bendingWaveSpeed(
  f,
  thickness,
  cL = CONCRETE.longitudinalSpeed,
) {
  return Math.sqrt(1.8 * cL * thickness * f);
}

/**
 * 굽힘파 군속도 c_g = 2·c_B (분산관계 ω ∝ k²)
 * @see 얇은 판 이론 (⚠️ 교과서 관계, 참고문서에 없음)
 */
export function bendingGroupSpeed(
  f,
  thickness,
  cL = CONCRETE.longitudinalSpeed,
) {
  return 2 * bendingWaveSpeed(f, thickness, cL);
}

/**
 * 임계주파수 f_c = c0²/(1.8·c_L·h)
 * @see 참고문서 4b (⚠️ 유도식)
 */
export function criticalFrequency(thickness, cL = CONCRETE.longitudinalSpeed) {
  return (C0 * C0) / (1.8 * cL * thickness);
}

/**
 * 구조 잔향시간 T_s = 2.2/(f·η_tot)
 * @see ISO 12354-2:2017 부속서 B (Dijckmans et al. 2018 인용, ⚠️)
 */
export function structuralReverbTime(f, lossFactor) {
  return 2.2 / (f * lossFactor);
}

/**
 * 점 주파수 방사효율. f > f_c: 1/√(1 − f_c/f), f ≤ f_c: 1 (상한 가정)
 * @see 교과서 근사 (미검증), 참고문서 1b. f → f_c에서 발산
 */
export function radiationFactorAt(f, fc) {
  return f > fc ? 1 / Math.sqrt(1 - fc / f) : 1;
}

/** ∫ df/√(1 − f_c/f) 부정적분 (f ≥ f_c) */
function sigmaIntegral(f, fc) {
  const q = Math.sqrt(Math.max(f * (f - fc), 0));
  return q + (fc / 2) * Math.log(2 * q + 2 * f - fc);
}

/**
 * 옥타브 평균 방사효율. radiationFactorAt을 대역 안에서 주파수 평균
 * f_c 부근 발산을 임의 상한 없이 처리 (모델 가정, 백색 힘 스펙트럼 기준)
 */
export function radiationFactorOctave(f, fc) {
  const [f1, f2] = octaveEdges(f);
  let area = 0;
  if (fc > f1) area += Math.min(fc, f2) - f1;
  if (f2 > fc) {
    const lo = Math.max(f1, fc);
    area += sigmaIntegral(f2, fc) - sigmaIntegral(lo, fc);
  }
  return area / (f2 - f1);
}

/**
 * 맨 슬래브 대역별 규준화 바닥충격음레벨 (태핑머신, A0 = 10 m²)
 * L_n = 155 − 30·lg m′ + 10·lg T_s + 10·lg σ + 10·lg(f/f_ref)
 * @see ISO 12354-2:2017 부속서 B 식 (1) (Dijckmans et al., Euronoise 2018, ⚠️)
 * @param {number} sigma 방사효율
 */
export function normalizedImpactLevel(f, mPrime, lossFactor, sigma) {
  const Ts = structuralReverbTime(f, lossFactor);
  return (
    155 -
    30 * Math.log10(mPrime) +
    10 * Math.log10(Ts) +
    10 * Math.log10(sigma) +
    10 * Math.log10(f / F_REF)
  );
}

/**
 * 맨 슬래브 단일수치 L_n,w,eq ≈ 164 − 35·lg m′ (100 ≤ m′ ≤ 600). 비교·검증용, 계산에는 안 씀
 * @see ISO 12354-2:2017 부속서 B (Dijckmans et al. 2018 식 (2), ⚠️)
 */
export function weightedImpactLevelEq(mPrime) {
  return 164 - 35 * Math.log10(mPrime);
}

/**
 * 점가진 재료감쇠 13.6·η·r/λ_B (dB). 시각화 참고용
 * @see 참고문서 4c (⚠️ 유도식)
 */
export function materialDampingDb(r, f, lossFactor, thickness, cL) {
  const lambda = bendingWaveSpeed(f, thickness, cL) / f;
  return (13.6 * lossFactor * r) / lambda;
}

/**
 * 원통 확산 10·lg(r/r0) (dB), r < r0이면 0. 가진점 근처 시각화 전용
 * @see 참고문서 4c (⚠️ 유도식)
 */
export function cylindricalSpreadingDb(r, r0 = 1) {
  return r > r0 ? 10 * Math.log10(r / r0) : 0;
}
