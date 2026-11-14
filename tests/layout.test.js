import { describe, expect, it } from 'vitest';
import {
  computeBuildingLayout,
  normalizeBuildingConfig,
  segmentsFor,
} from '../src/building/layout.js';

const base = {
  width: 4.5,
  depth: 6.0,
  height: 2.3,
  slabThickness: 0.21,
  wallThickness: 0.2,
};

function overlaps(a, b, eps = 1e-9) {
  return [0, 1, 2].every(
    (i) => a.min[i] < b.max[i] - eps && b.min[i] < a.max[i] - eps,
  );
}

describe('computeBuildingLayout (3층 × 3세대)', () => {
  const layout = computeBuildingLayout({
    ...base,
    floors: 3,
    unitsPerFloor: 3,
  });

  it('세대 9개를 1층부터 왼쪽부터 만듭니다', () => {
    expect(layout.units.map((u) => u.name)).toEqual([
      '101호',
      '102호',
      '103호',
      '201호',
      '202호',
      '203호',
      '301호',
      '302호',
      '303호',
    ]);
    layout.units.forEach((u, i) => expect(u.index).toBe(i));
  });

  it('층 높이는 천장고 + 슬래브 두께입니다', () => {
    const storey = 2.3 + 0.21;
    for (const u of layout.units)
      expect(u.floorY).toBeCloseTo(u.floorLevel * storey, 9);
    expect(layout.storeyHeight).toBeCloseTo(storey, 9);
  });

  it('옆 세대와는 벽 두께만큼 떨어져 있고 건물은 가운데 정렬입니다', () => {
    const [a, b, c] = layout.units;
    expect(b.bounds.minX - a.bounds.maxX).toBeCloseTo(0.2, 9);
    expect(c.bounds.minX - b.bounds.maxX).toBeCloseTo(0.2, 9);
    expect(b.centerX).toBeCloseTo(0, 9);
    expect(layout.bounds.min[0]).toBeCloseTo(-layout.bounds.max[0], 9);
    expect(layout.bounds.max[0] - layout.bounds.min[0]).toBeCloseTo(
      3 * 4.5 + 4 * 0.2,
      9,
    );
  });

  it('벽 선은 뒤쪽·좌측·우측 안쪽 면입니다', () => {
    const u = layout.units[4]; // 202호
    expect(u.wallLines).toEqual([
      { axis: 'z', value: -3 },
      { axis: 'x', value: u.centerX - 2.25 },
      { axis: 'x', value: u.centerX + 2.25 },
    ]);
  });

  it('구조체: 슬래브 4장 + 층마다 칸막이 벽 4개 + 뒤쪽 벽 1개, 서로 겹치지 않습니다', () => {
    const count = (kind) =>
      layout.structure.filter((b) => b.kind === kind).length;
    expect(count('slab')).toBe(4);
    expect(count('partyWall')).toBe(12);
    expect(count('backWall')).toBe(3);
    for (let i = 0; i < layout.structure.length; i++) {
      for (let j = i + 1; j < layout.structure.length; j++) {
        expect(overlaps(layout.structure[i], layout.structure[j])).toBe(false);
      }
    }
  });

  it('세대 내부 공간은 구조체와 겹치지 않습니다', () => {
    for (const u of layout.units) {
      const room = {
        min: [u.bounds.minX, u.floorY, u.bounds.minZ],
        max: [u.bounds.maxX, u.floorY + u.height, u.bounds.maxZ],
      };
      for (const box of layout.structure)
        expect(overlaps(room, box)).toBe(false);
    }
  });
});

describe('computeBuildingLayout (기타 구성)', () => {
  it('1층 × 1세대도 만들 수 있습니다', () => {
    const layout = computeBuildingLayout({
      ...base,
      floors: 1,
      unitsPerFloor: 1,
    });
    expect(layout.units).toHaveLength(1);
    expect(layout.units[0].name).toBe('101호');
    expect(layout.units[0].centerX).toBeCloseTo(0, 9);
  });

  it('건물이 커지면 정점 밀도를 낮춥니다', () => {
    const small = computeBuildingLayout({
      ...base,
      floors: 2,
      unitsPerFloor: 2,
    });
    const big = computeBuildingLayout({ ...base, floors: 5, unitsPerFloor: 4 });
    expect(big.units).toHaveLength(20);
    expect(big.segmentsPerMeter).toBeLessThan(small.segmentsPerMeter);
    // 기본 크기에서는 기존과 같은 48분할 (4.5m)
    expect(segmentsFor(4.5, small.segmentsPerMeter)).toBe(48);
  });
});

describe('normalizeBuildingConfig', () => {
  it('범위를 벗어난 값은 잘라내고 층·세대 수는 정수로 만듭니다', () => {
    const c = normalizeBuildingConfig({
      floors: 9,
      unitsPerFloor: 2.6,
      width: 1,
      slabThickness: 'x',
    });
    expect(c.floors).toBe(5);
    expect(c.unitsPerFloor).toBe(3);
    expect(c.width).toBe(3);
    expect(c.slabThickness).toBe(0.21);
  });
});
