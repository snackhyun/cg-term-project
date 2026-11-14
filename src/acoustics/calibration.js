/**
 * 절대 레벨 보정상수 (유일한 맞춤값)
 * 음원 치환식·σ·η 등 미검증 항목의 절대 레벨 오차를 한 번에 흡수
 * @see docs/acoustics-references.md 10-1 (보정 상수 1개 권고)
 */

/**
 * 보정 시나리오: 고무공 1 m 낙하, 표준바닥구조 바로 아래 세대 L_AFmax 목표 47 dB(A)
 * (사후확인 기준 49 dB 이하·45–49 dB 범위의 중앙). 210 mm, ρ 2400, η 0.02, 뜬바닥 s′ 20 / m′ 104, T 0.5 s,
 * 세대 4.5 × 6.0 × 2.3 m, 벽 200 mm, 2층 × 2세대 중 201호(from 2) → 101호(to 0)
 */
export const CALIBRATION_SCENARIO = Object.freeze({
  building: Object.freeze({
    floors: 2,
    unitsPerFloor: 2,
    width: 4.5,
    depth: 6.0,
    height: 2.3,
    slabThickness: 0.21,
    wallThickness: 0.2,
  }),
  acoustics: Object.freeze({
    density: 2400,
    lossFactor: 0.02,
    floatingFloor: true,
    dynamicStiffness: 20,
    screedMass: 104,
    reverbTime: 0.5,
  }),
  source: 'run',
  from: 2,
  to: 0,
  targetLAFmax: 47,
});

/** 보정상수 (dB). 시나리오 결과가 목표값이 되도록 1회 계산해 고정 */
export const CALIBRATION_DB = -6.27;
