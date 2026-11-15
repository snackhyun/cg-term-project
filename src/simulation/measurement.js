/**
 * 세대 판정 (표시용 상태)
 */
import { judgeUnit } from '../acoustics/index.js';

/**
 * 'source' 발생 세대(판정 제외), 'quiet' 들리지 않음, 'over' Leq 또는 L_max 기준 초과, 'under' 기준 이하
 * @param {{ leqMax: number, lmaxCount: number, isSource: boolean, heard: boolean }} u
 * @param {{ leq: number, lmax: number }} limits
 * @returns {'source'|'quiet'|'over'|'under'}
 */
export function classifyUnit(u, limits) {
  return judgeUnit(u, limits).status;
}
