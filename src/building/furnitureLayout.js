/**
 * 세대 가구 배치 계산 (three.js, DOM 의존 없음)
 *
 * 가구는 벽에서 FURNITURE_BAND(0.9m) 이내만, 방 가운데와 열린 앞면은 비움.
 * 캐릭터 이동 영역(벽에서 1.0m 안쪽)과 겹치지 않음.
 *
 * planUnitFurniture(unit) → Item[]
 *   Item { key, x, z, y, yaw, length, depth, height, mirror, footprint }
 *     x, z       바닥 위 중심 (월드 좌표, m)
 *     y          바닥에서 띄운 높이 (상부장, TV)
 *     yaw        y축 회전. 모델 앞면 +z, 길이 방향 x
 *     length, depth, height  모델 x, z, y 크기 (m)
 *     mirror     좌우 반전 모델 사용 여부 (침대 머리 방향)
 *     footprint  { minX, maxX, minZ, maxZ }
 */

/** 가구를 둘 수 있는 벽에서의 거리 (m) */
export const FURNITURE_BAND = 0.9;
/** 벽과 가구 사이 */
const WALL_GAP = 0.03;
/** 가구끼리 간격 */
const ITEM_GAP = 0.06;
/** 열린 앞면과의 거리 */
const FRONT_MARGIN = 0.3;

/** 가구별 크기 (m). length는 벽 방향, depth는 방 안쪽 방향 */
export const FURNITURE_CATALOG = {
  sofa: { length: 1.9, depth: 0.82, height: 0.86 },
  sofaDesign: { length: 2.0, depth: 0.78, height: 0.76 },
  console: { length: 1.0, depth: 0.4, height: 0.72 },
  floorLamp: { length: 0.32, depth: 0.32, height: 1.6 },
  tvStand: { length: 1.6, depth: 0.45, height: 0.5 },
  tv: { length: 1.1, depth: 0.18, height: 0.7 },
  bed: { length: 2.0, depth: 0.85, height: 0.52 },
  nightstand: { length: 0.45, depth: 0.4, height: 0.5 },
  desk: { length: 1.2, depth: 0.6, height: 0.75 },
  deskChair: { length: 0.5, depth: 0.42, height: 0.9 },
  bookcase: { length: 0.8, depth: 0.35, height: 1.8 },
  cabinet: { length: 1.4, depth: 0.45, height: 1.3 },
  kitchenCabinet: { length: 0.6, depth: 0.6, height: 0.86 },
  kitchenSink: { length: 0.8, depth: 0.6, height: 0.86 },
  kitchenStove: { length: 0.6, depth: 0.6, height: 0.86 },
  fridge: { length: 0.75, depth: 0.65, height: 1.8 },
  upperCabinet: { length: 0.8, depth: 0.33, height: 0.65 },
  plant: { length: 0.4, depth: 0.4, height: 0.8 },
};

/** 시드 고정 난수 (mulberry32) */
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

/**
 * 벽 기준 좌표 변환
 * @param {'back' | 'left' | 'right'} side
 * @returns {{ side, yaw, toWorld: (s: number, out: number) => { x, z } }} s 벽 방향 위치, out 벽에서의 거리
 */
function makeWall(side, b) {
  if (side === 'back') {
    return {
      side,
      toWorld: (s, out) => ({ x: s, z: b.minZ + out }),
      yaw: 0,
    };
  }
  if (side === 'left') {
    return {
      side,
      toWorld: (s, out) => ({ x: b.minX + out, z: s }),
      yaw: Math.PI / 2,
    };
  }
  return {
    side,
    toWorld: (s, out) => ({ x: b.maxX - out, z: s }),
    yaw: -Math.PI / 2,
  };
}

/** 벽 위 s 지점의 가구 1개 */
function makeItem(wall, key, sCenter, opts = {}) {
  const size = FURNITURE_CATALOG[key];
  const out = opts.out ?? WALL_GAP;
  const { x, z } = wall.toWorld(sCenter, out + size.depth / 2);
  const alongX = wall.side === 'back';
  const hx = (alongX ? size.length : size.depth) / 2;
  const hz = (alongX ? size.depth : size.length) / 2;
  return {
    key,
    x,
    z,
    y: opts.y ?? 0,
    yaw: wall.yaw + (opts.faceWall ? Math.PI : 0),
    length: size.length,
    depth: size.depth,
    height: size.height,
    mirror: Boolean(opts.asymmetric && wall.side === 'left'),
    footprint: { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz },
  };
}

/**
 * [start, end] 구간에 차례로 배치, 자리가 없으면 생략
 * @param {object[]} specs { key, atEnd?, gapAfter?, extras?(s, wall) → Item[] }
 */
function packWall(wall, start, end, specs) {
  const items = [];
  let lo = start;
  let hi = end;
  for (const spec of specs.filter((s) => s.atEnd)) {
    const L = FURNITURE_CATALOG[spec.key].length;
    if (hi - L < lo) continue;
    const s = hi - L / 2;
    items.push(makeItem(wall, spec.key, s, spec));
    hi -= L + ITEM_GAP;
  }
  for (const spec of specs.filter((s) => !s.atEnd)) {
    const L = FURNITURE_CATALOG[spec.key].length;
    if (lo + L > hi) continue;
    const s = lo + L / 2;
    items.push(makeItem(wall, spec.key, s, spec));
    if (spec.extras) items.push(...spec.extras(s, wall));
    lo += L + (spec.gapAfter ?? ITEM_GAP);
  }
  return items;
}

/** TV 받침 위 TV */
const withTv = (s, wall) => [
  makeItem(wall, 'tv', s, { out: 0.1, y: FURNITURE_CATALOG.tvStand.height }),
];
/** 책상 앞 의자 */
const withChair = (s, wall) => [
  makeItem(wall, 'deskChair', s, { out: 0.44, faceWall: true }),
];

/** 거실형, 침실형, 원룸형 중 하나 선택 */
function chooseVariant(rng) {
  const sofa = pick(rng, ['sofa', 'sofaDesign']);
  const kitchen = [
    { key: 'fridge' },
    { key: 'kitchenSink' },
    { key: 'kitchenStove' },
    { key: 'kitchenCabinet' },
  ];
  const variants = [
    {
      name: 'living',
      back: [...kitchen, { key: 'bookcase', atEnd: true }],
      sideA: [{ key: sofa }, { key: 'floorLamp' }],
      sideB: [
        { key: 'console' },
        { key: 'tvStand', extras: withTv },
        { key: 'plant', atEnd: true },
      ],
      cornerA: false,
    },
    {
      name: 'bedroom',
      back: [{ key: 'nightstand' }, { key: 'cabinet' }, { key: 'bookcase' }],
      sideA: [{ key: 'bed', asymmetric: true }],
      sideB: [
        { key: 'bookcase' },
        { key: 'desk', extras: withChair },
        { key: 'plant', atEnd: true },
      ],
      cornerA: true,
    },
    {
      name: 'studio',
      back: [...kitchen.slice(0, 3), { key: 'bookcase', atEnd: true }],
      sideA: [{ key: 'bed', asymmetric: true }, { key: 'floorLamp' }],
      sideB: [{ key: sofa }, { key: 'plant', atEnd: true }],
      cornerA: true,
    },
  ];
  return pick(rng, variants);
}

/**
 * 세대 1개의 가구 배치
 * 뒷벽은 모서리 가구(침대) 쪽부터 채움. 범위 밖·가운데 영역에 걸치는 가구는 마지막에 제외
 * @param {object} unit layout.js 세대 정보 ({ index, bounds, height, ... })
 * @param {number} [seed] 기본값은 세대 번호 기반
 * @returns {object[]} Item 목록
 */
export function planUnitFurniture(unit, seed = unit.index * 7919 + 17) {
  const rng = createRng(seed);
  const b = unit.bounds;
  const variant = chooseVariant(rng);
  const flip = rng() < 0.5;
  const sideA = flip ? 'right' : 'left';
  const sideB = flip ? 'left' : 'right';

  const items = [];
  const sideStart = b.minZ + FURNITURE_BAND + ITEM_GAP;
  const sideEnd = b.maxZ - FRONT_MARGIN;

  const cornerStart = b.minZ + WALL_GAP;
  items.push(
    ...packWall(
      makeWall(sideA, b),
      variant.cornerA ? cornerStart : sideStart,
      sideEnd,
      variant.sideA,
    ),
  );
  items.push(
    ...packWall(makeWall(sideB, b), sideStart, sideEnd, variant.sideB),
  );

  let backLo = b.minX + WALL_GAP;
  let backHi = b.maxX - WALL_GAP;
  if (variant.cornerA) {
    const reserve = FURNITURE_BAND + ITEM_GAP;
    if (sideA === 'left') backLo = b.minX + reserve;
    else backHi = b.maxX - reserve;
  }
  const backSpecs = variant.back;
  const backWall = makeWall('back', b);
  const fromLeft = variant.cornerA ? sideA === 'left' : rng() < 0.5;
  let backItems;
  if (fromLeft) {
    backItems = packWall(backWall, backLo, backHi, backSpecs);
  } else {
    const mirrorX = (x) => b.minX + b.maxX - x;
    backItems = packWall(
      backWall,
      mirrorX(backHi),
      mirrorX(backLo),
      backSpecs,
    ).map((it) => {
      const x = mirrorX(it.x);
      const hx = (it.footprint.maxX - it.footprint.minX) / 2;
      return {
        ...it,
        x,
        footprint: { ...it.footprint, minX: x - hx, maxX: x + hx },
      };
    });
  }
  items.push(...backItems);

  const upper = FURNITURE_CATALOG.upperCabinet;
  const upperY = Math.min(1.45, unit.height - upper.height - 0.05);
  for (const it of backItems) {
    if (!['kitchenSink', 'kitchenStove', 'kitchenCabinet'].includes(it.key))
      continue;
    const item = makeItem(backWall, 'upperCabinet', it.x, { y: upperY });
    const hx = it.length / 2;
    items.push({
      ...item,
      length: it.length,
      footprint: { ...item.footprint, minX: it.x - hx, maxX: it.x + hx },
    });
  }

  return items.filter(
    (it) =>
      it.y + it.height <= unit.height &&
      isInsideRoom(it.footprint, b) &&
      !intersectsClearZone(it.footprint, b),
  );
}

/** footprint가 방 안에 있는지 */
export function isInsideRoom(f, b, eps = 1e-6) {
  return (
    f.minX >= b.minX - eps &&
    f.maxX <= b.maxX + eps &&
    f.minZ >= b.minZ - eps &&
    f.maxZ <= b.maxZ + eps
  );
}

/** 방 가운데(벽에서 band 안쪽) 영역과 겹치는지 */
export function intersectsClearZone(f, b, band = FURNITURE_BAND) {
  return (
    f.minX < b.maxX - band &&
    f.maxX > b.minX + band &&
    f.minZ < b.maxZ - band &&
    f.maxZ > b.minZ + band
  );
}
