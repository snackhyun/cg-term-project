/**
 * 시각화용 파동. 파동 1개 = 충격 1회
 * radius: 구조물 표면을 따라 잰 파면 거리. 속도 = 굽힘파 군속도 / 슬로모션 배율
 * 세기는 세대별 물리 계산값(peaks)을 그대로 사용, 거리감쇠 없음
 */
import { FAST_TIME_CONSTANT, bendingGroupSpeed } from '../acoustics/index.js';

/**
 * 시각화 값
 * visualFrequency 파면 속도 기준 대역 (Hz), displayTimeConstant 파면 통과 후 색 감소 시정수 (s),
 * tailSeconds 마지막 정점 통과 후 유지 시간 (바닥 물결 포함), fadeSeconds 끝 페이드
 */
export const WAVE_PARAMS = {
  visualFrequency: 125,
  initialRadius: 0.028,
  displayTimeConstant: FAST_TIME_CONSTANT,
  tailSeconds: 3.0,
  fadeSeconds: 0.5,
};

/** 실제 굽힘파 군속도 (m/s) */
export function physicalWaveSpeed(slabThickness, params = WAVE_PARAMS) {
  return bendingGroupSpeed(params.visualFrequency, slabThickness);
}

/** 화면 파면 속도 (m/s) */
export function visualWaveSpeed(
  slabThickness,
  slowMotion,
  params = WAVE_PARAMS,
) {
  return physicalWaveSpeed(slabThickness, params) / slowMotion;
}

/**
 * @param {object} o
 * @param {{ x: number, z: number }} o.point
 * @param {object} o.unit 발생 세대
 * @param {Float64Array} o.peaks 세대별 단발 L_AFmax 에너지 (발생 세대는 직접 경로값)
 * @param {number} o.sourceLevel 발생 세대 바닥 물결용 dB
 * @param {number} o.speed 화면 파면 속도
 * @param {number} o.maxDist 가장 먼 정점까지 경로 거리
 * @param {boolean} [o.onFloor] 바닥 충격 여부 (아니면 벽, 바닥 물결 없음)
 * @param {object} [o.line] 벽 충격이면 그 벽 선 (경로 거리용)
 */
export function createWave({
  point,
  unit,
  peaks,
  sourceLevel,
  speed,
  maxDist,
  impact,
  onFloor = true,
  line = null,
}) {
  return {
    x: point.x,
    z: point.z,
    y: point.y ?? unit.floorY,
    onFloor,
    line,
    unit,
    impact,
    peaks,
    sourceLevel,
    speed,
    maxDist,
    radius: WAVE_PARAMS.initialRadius,
    time: 0,
    fade: 1,
  };
}

/** delta초 진행, 끝난 파동 제거 */
export function advanceWaves(waves, delta, params = WAVE_PARAMS) {
  for (let i = waves.length - 1; i >= 0; i--) {
    const w = waves[i];
    w.time += delta;
    w.radius = params.initialRadius + w.speed * w.time;
    const end = w.maxDist / w.speed + params.tailSeconds;
    w.fade = Math.min(Math.max((end - w.time) / params.fadeSeconds, 0), 1);
    if (w.time >= end) waves.splice(i, 1);
  }
  return waves;
}
