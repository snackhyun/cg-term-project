/**
 * 음향 모델 진입점. 순수 함수만 (three·DOM 의존 없음)
 * 대역별 건축음향 식: docs/acoustics-references.md, 부록 "공식 → 코드 → 테스트"
 *
 * 다른 모듈용 API
 *   sourceLevelDb(type, opts?)   충격 1회 음원 (불변 객체, 내용은 불투명하게 취급)
 *   createAcousticModel(b, p)    건물·음향 파라미터 → 세대 간 대역 전달 모델
 *   legalLimits(isNight)         { leq, lmax } dB(A)
 */
export * from './bands.js';
export * from './buildingModel.js';
export * from './calibration.js';
export * from './floatingFloor.js';
export * from './junction.js';
export * from './legal.js';
export * from './room.js';
export * from './slab.js';
export * from './sources.js';
export * from './timeWeighting.js';
