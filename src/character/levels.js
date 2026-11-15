/**
 * 충격 세기 조회 (acoustics 값은 그대로 전달)
 */
import { sourceLevelDb } from '../acoustics/index.js';

/** 아직 정의되지 않은 유형의 임시 대체 */
const FALLBACK = Object.freeze({ jump: 'run', drop: 'hammer' });
const warned = new Set();

/**
 * sourceLevelDb 래퍼. 모르는 유형이면 대체 유형, 그것도 없으면 null
 * @param {string} type
 * @param {object} [opts]
 */
export function impactLevel(type, opts = undefined, lookup = sourceLevelDb) {
  try {
    return lookup(type, opts);
  } catch (err) {
    const fallback = FALLBACK[type];
    if (!warned.has(type)) {
      warned.add(type);
      console.warn(
        `충격 유형 '${type}' 없음 → '${fallback ?? '없음'}' 사용`,
        err,
      );
    }
    if (!fallback) return null;
    try {
      return lookup(fallback, opts);
    } catch {
      return null;
    }
  }
}
