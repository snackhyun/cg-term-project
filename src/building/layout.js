/**
 * 건물 배치 계산 (three.js, DOM 의존 없음)
 *
 * 좌표 (m)
 *   x  세대가 늘어선 방향. column 0이 가장 왼쪽, 건물 중심 x = 0
 *   y  위쪽. 1층 바닥 윗면 y = 0
 *   z  깊이 방향. 뒤쪽 벽 안쪽 면 z = -depth/2, 앞쪽(z = +depth/2) 개방
 *
 *   ┌──┬──────┬──┬──────┬──┐  ← 지붕 슬래브
 *   │벽│ 201호 │벽│ 202호 │벽│  ← 2층 (floorLevel 1)
 *   ├──┴──────┴──┴──────┴──┤  ← 슬래브 (두께 slabThickness)
 *   │벽│ 101호 │벽│ 102호 │벽│  ← 1층 (floorLevel 0)
 *   └──────────────────────┘  ← 바닥 슬래브
 */
import { BUILDING_LIMITS, DEFAULT_CONFIG } from '../config.js';

/** 히트맵 분할 밀도 상한 (기존 밀도, 1칸 ≈ 0.28m에 3분할). 정점 색은 CPU 계산이라 큰 건물은 낮춤 */
const MAX_SEGMENTS_PER_METER = 10.7;
const MIN_SEGMENTS_PER_METER = 4;
/** 건물 전체 히트맵 정점 수 (대략) */
const VERTEX_BUDGET = 80000;
const MAX_SEGMENTS = 96;
const MIN_SEGMENTS = 6;

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

/** 설정값을 허용 범위로 자르기, 층 수·세대 수는 정수 */
export function normalizeBuildingConfig(cfg = {}) {
  const out = { ...DEFAULT_CONFIG.building };
  for (const key of Object.keys(out)) {
    let v = Number(cfg[key] ?? out[key]);
    if (!Number.isFinite(v)) v = DEFAULT_CONFIG.building[key];
    const lim = BUILDING_LIMITS[key];
    if (key === 'floors' || key === 'unitsPerFloor') v = Math.round(v);
    out[key] = clamp(v, lim.min, lim.max);
  }
  return out;
}

/** 3층 2번째 세대 → '302호' */
export function unitName(floorLevel, column) {
  return `${floorLevel + 1}${String(column + 1).padStart(2, '0')}호`;
}

/**
 * 건물 배치
 * @param {object} cfg config.building
 * @returns {{ config, units, structure, bounds, storeyHeight, segmentsPerMeter }}
 *   units      1층부터, 같은 층은 왼쪽부터 정렬
 *              { index, name, floorLevel, column, floorY, centerX, centerZ,
 *                width, depth, height, bounds: { minX, maxX, minZ, maxZ }, wallLines }
 *              wallLines  벽 안쪽 면이 놓인 선 (뒤, 좌, 우, 벽 메시와 같은 순서). 층간 경로 계산용
 *   structure  콘크리트 상자 { kind: 'slab' | 'partyWall' | 'backWall', floorLevel, min, max }
 *              partyWall은 column(0 ~ 층당 세대 수, 양 끝이 외벽) 포함
 *   bounds     { min: [x, y, z], max: [x, y, z] }
 */
export function computeBuildingLayout(cfg) {
  const config = normalizeBuildingConfig(cfg);
  const {
    floors,
    unitsPerFloor: n,
    width: W,
    depth: D,
    height: H,
    slabThickness: S,
    wallThickness: T,
  } = config;

  const storeyHeight = H + S;
  const pitchX = W + T;
  const totalWidth = n * W + (n + 1) * T;
  const x0 = -totalWidth / 2;
  const halfD = D / 2;

  const units = [];
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < n; c++) {
      const centerX = x0 + T + W / 2 + c * pitchX;
      const floorY = f * storeyHeight;
      units.push({
        index: units.length,
        name: unitName(f, c),
        floorLevel: f,
        column: c,
        floorY,
        centerX,
        centerZ: 0,
        width: W,
        depth: D,
        height: H,
        bounds: {
          minX: centerX - W / 2,
          maxX: centerX + W / 2,
          minZ: -halfD,
          maxZ: halfD,
        },
        wallLines: [
          { axis: 'z', value: -halfD },
          { axis: 'x', value: centerX - W / 2 },
          { axis: 'x', value: centerX + W / 2 },
        ],
      });
    }
  }

  // 상자끼리 겹치면 앞면 z-fighting, 겹치지 않게 분할
  const structure = [];
  for (let k = 0; k <= floors; k++) {
    // k번째 슬래브 윗면 = k층 바닥, k = floors는 지붕
    const top = k * storeyHeight;
    structure.push({
      kind: 'slab',
      floorLevel: k,
      min: [x0, top - S, -halfD - T],
      max: [x0 + totalWidth, top, halfD],
    });
  }
  for (let f = 0; f < floors; f++) {
    const y0 = f * storeyHeight;
    for (let j = 0; j <= n; j++) {
      const wx = x0 + j * pitchX;
      structure.push({
        kind: 'partyWall',
        floorLevel: f,
        column: j,
        min: [wx, y0, -halfD],
        max: [wx + T, y0 + H, halfD],
      });
    }
    structure.push({
      kind: 'backWall',
      floorLevel: f,
      min: [x0, y0, -halfD - T],
      max: [x0 + totalWidth, y0 + H, -halfD],
    });
  }

  const areaPerUnit = W * D + W * H + 2 * D * H;
  const totalArea = areaPerUnit * units.length;
  const segmentsPerMeter = clamp(
    Math.sqrt(VERTEX_BUDGET / totalArea),
    MIN_SEGMENTS_PER_METER,
    MAX_SEGMENTS_PER_METER,
  );

  return {
    config,
    units,
    structure,
    bounds: {
      min: [x0, -S, -halfD - T],
      max: [x0 + totalWidth, floors * storeyHeight, halfD],
    },
    storeyHeight,
    segmentsPerMeter,
  };
}

/** length(m)를 segmentsPerMeter 밀도로 나눌 때의 분할 수 */
export function segmentsFor(length, segmentsPerMeter) {
  return clamp(
    Math.round(length * segmentsPerMeter),
    MIN_SEGMENTS,
    MAX_SEGMENTS,
  );
}
