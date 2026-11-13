/**
 * 층간소음 법정 기준 (직접충격 소음)
 * @see 「공동주택 층간소음의 범위와 기준에 관한 규칙」 별표 (2023. 1. 2. 개정), 이웃사이센터 인용본 (⚠️ law.go.kr 미대조)
 */

/** 주간·야간 기준 dB(A). leq: 1분 등가소음도, lmax: 최고소음도 */
export const LEGAL_LIMITS = Object.freeze({
  day: Object.freeze({ leq: 39, lmax: 57 }),
  night: Object.freeze({ leq: 34, lmax: 52 }),
});

/** 하위 호환: 1분 Leq 기준 */
export const THRESHOLDS = Object.freeze({
  day: LEGAL_LIMITS.day.leq,
  night: LEGAL_LIMITS.night.leq,
});

/** 법정 Leq 측정 구간 (s) */
export const LEGAL_WINDOW_SECONDS = 60;

/** L_max 판정: 1시간에 3회 이상 초과하면 기준 초과 */
export const LMAX_RULE = Object.freeze({ count: 3, periodSeconds: 3600 });

/** 현재 모드 기준 { leq, lmax } */
export function legalLimits(isNight) {
  return isNight ? LEGAL_LIMITS.night : LEGAL_LIMITS.day;
}

/** 하위 호환: 현재 모드 Leq 기준 */
export function legalThresholdDb(isNight) {
  return legalLimits(isNight).leq;
}

/**
 * 세대 판정
 * @param {{ leqMax: number, lmaxCount: number, isSource: boolean, heard: boolean }} m
 * @returns {{ status: 'source'|'quiet'|'over'|'under', leqOver: boolean, lmaxOver: boolean }}
 */
export function judgeUnit(m, limits) {
  const leqOver = m.leqMax >= limits.leq;
  const lmaxOver = m.lmaxCount >= LMAX_RULE.count;
  let status;
  if (m.isSource) status = 'source';
  else if (!m.heard) status = 'quiet';
  else status = leqOver || lmaxOver ? 'over' : 'under';
  return { status, leqOver, lmaxOver };
}
