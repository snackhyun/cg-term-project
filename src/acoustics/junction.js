/**
 * 접합부 진동저감지수 K_ij와 현장 속도레벨차
 * @see docs/acoustics-references.md 3절
 */
import { C0 } from './slab.js';
import { F_REF } from './bands.js';

/** 질량비 지수 M = lg(m′⊥i / m′i). 구조체 질량만 (마감층 제외) */
export function massRatioExponent(mPerp, mI) {
  return Math.log10(mPerp / mI);
}

/**
 * 강접합 십자형, 직진 경로 K13 = 8.7 + 17.1·M + 5.7·M² (주파수 무관)
 * T형·L형 접합에도 대용 (T형 계수 미확인, 참고문서 3b 권고)
 * @see EN 12354-1 부속서 E (Ramis et al., Arch. Acoust. 37(2) 2012 식 (4), ⚠️)
 */
export function kijCrossStraight(M) {
  return 8.7 + 17.1 * M + 5.7 * M * M;
}

/**
 * 강접합 십자형, 꺾임 경로 K12 = 8.7 + 5.7·M² (주파수 무관)
 * @see EN 12354-1 부속서 E (Ramis et al. 2012 식 (5), ⚠️)
 */
export function kijCrossCorner(M) {
  return 8.7 + 5.7 * M * M;
}

/**
 * 등가흡음길이 a = 2.2·π²·S/(c0·T_s)·√(f_ref/f)
 * @see ISO 12354-1:2017 §3.2.6 (✅ 공식 미리보기)
 */
export function absorptionLength(area, Ts, f) {
  return ((2.2 * Math.PI ** 2 * area) / (C0 * Ts)) * Math.sqrt(F_REF / f);
}

/**
 * 현장 속도레벨차 D_v,ij,situ = K_ij − 10·lg(l_ij/√(a_i·a_j))
 * @see ISO 12354-1:2017 §3.2.6 정의식 변형 (✅), Ramis et al. 2012 식 (13)
 */
export function velocityLevelDifference(kij, length, ai, aj) {
  return kij - 10 * Math.log10(length / Math.sqrt(ai * aj));
}
