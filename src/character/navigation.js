/**
 * 세대 안 이동 영역, 경로
 * 가구: 벽에서 0.9m 이내 → 세대 범위에서 1.0m 들인 사각형만 사용
 */

/** 벽에서 들이는 거리 (m) */
export const WALL_MARGIN = 1.0;

/**
 * 걷는 영역
 * @param {{ bounds: { minX, maxX, minZ, maxZ } }} unit
 * @returns {{ minX, maxX, minZ, maxZ }} 너무 좁으면 가운데 한 줄 또는 한 점
 */
export function walkableRect(unit, margin = WALL_MARGIN) {
  const b = unit.bounds;
  const rect = {};
  for (const [lo, hi] of [
    ['minX', 'maxX'],
    ['minZ', 'maxZ'],
  ]) {
    const a = b[lo] + margin;
    const c = b[hi] - margin;
    if (a <= c) {
      rect[lo] = a;
      rect[hi] = c;
    } else {
      const mid = (b[lo] + b[hi]) / 2;
      rect[lo] = mid;
      rect[hi] = mid;
    }
  }
  return rect;
}

/** 영역 안으로 제한 */
export function clampToRect(rect, x, z) {
  return {
    x: Math.min(rect.maxX, Math.max(rect.minX, x)),
    z: Math.min(rect.maxZ, Math.max(rect.minZ, z)),
  };
}

/** 영역 안 상대 위치(0~1). 폭 0인 축은 0.5 */
export function toNormalized(rect, x, z) {
  const w = rect.maxX - rect.minX;
  const d = rect.maxZ - rect.minZ;
  return {
    u: w > 1e-6 ? (x - rect.minX) / w : 0.5,
    v: d > 1e-6 ? (z - rect.minZ) / d : 0.5,
  };
}

/** 상대 위치 → 월드 x, z */
export function fromNormalized(rect, u, v) {
  return {
    x: rect.minX + (rect.maxX - rect.minX) * u,
    z: rect.minZ + (rect.maxZ - rect.minZ) * v,
  };
}

/** 이보다 짧은 축이면 대각선 경로 (m) */
export const MIN_TRAVERSE = 1.0;

/**
 * 방 가로지르기 경로의 두 끝점. 긴 축 기준, 좁으면 대각선
 * 영역이 한 점이면 두 끝점 동일 (제자리)
 */
export function traverseEndpoints(rect) {
  const w = rect.maxX - rect.minX;
  const d = rect.maxZ - rect.minZ;
  const cx = (rect.minX + rect.maxX) / 2;
  const cz = (rect.minZ + rect.maxZ) / 2;
  if (Math.max(w, d) < MIN_TRAVERSE) {
    return [
      { x: rect.minX, z: rect.minZ },
      { x: rect.maxX, z: rect.maxZ },
    ];
  }
  return d >= w
    ? [
        { x: cx, z: rect.minZ },
        { x: cx, z: rect.maxZ },
      ]
    : [
        { x: rect.minX, z: cz },
        { x: rect.maxX, z: cz },
      ];
}

/** 두 끝점, 현재 위치에서 먼 쪽 먼저 */
export function farEndpointFirst(rect, x, z) {
  const [a, b] = traverseEndpoints(rect);
  const da = Math.hypot(a.x - x, a.z - z);
  const db = Math.hypot(b.x - x, b.z - z);
  return da >= db ? [a, b] : [b, a];
}

/** 각도 -π~π 정규화 */
export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
