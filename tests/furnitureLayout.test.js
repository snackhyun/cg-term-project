import { describe, expect, it } from 'vitest';
import { computeBuildingLayout } from '../src/building/layout.js';
import {
  FURNITURE_BAND,
  intersectsClearZone,
  isInsideRoom,
  planUnitFurniture,
} from '../src/building/furnitureLayout.js';

const sizes = [];
for (const width of [3.0, 4.5, 8.0])
  for (const depth of [4.0, 6.0, 10.0])
    for (const height of [2.1, 2.3, 3.0]) sizes.push({ width, depth, height });

function overlap(a, b) {
  return (
    a.minX < b.maxX - 1e-6 &&
    b.minX < a.maxX - 1e-6 &&
    a.minZ < b.maxZ - 1e-6 &&
    b.minZ < a.maxZ - 1e-6
  );
}

describe('planUnitFurniture', () => {
  it('모든 크기에서 가구는 벽 0.9m 이내, 캐릭터 영역(1.0m 안쪽)은 비어 있음', () => {
    for (const size of sizes) {
      const layout = computeBuildingLayout({
        ...size,
        floors: 5,
        unitsPerFloor: 4,
      });
      for (const unit of layout.units) {
        const items = planUnitFurniture(unit);
        expect(items.length).toBeGreaterThan(0);
        const b = unit.bounds;
        const child = {
          minX: b.minX + 1.0,
          maxX: b.maxX - 1.0,
          minZ: b.minZ + 1.0,
          maxZ: b.maxZ - 1.0,
        };
        for (const it of items) {
          expect(isInsideRoom(it.footprint, b)).toBe(true);
          expect(intersectsClearZone(it.footprint, b, FURNITURE_BAND)).toBe(
            false,
          );
          expect(overlap(it.footprint, child)).toBe(false);
          expect(it.y + it.height).toBeLessThanOrEqual(unit.height);
        }
      }
    }
  });

  it('바닥에 놓인 가구끼리 겹치지 않음', () => {
    const layout = computeBuildingLayout({ floors: 5, unitsPerFloor: 4 });
    const stacked = new Set(['tv', 'upperCabinet', 'deskChair']);
    for (const unit of layout.units) {
      const floorItems = planUnitFurniture(unit).filter(
        (it) => !stacked.has(it.key),
      );
      for (let i = 0; i < floorItems.length; i++)
        for (let j = i + 1; j < floorItems.length; j++)
          expect(
            overlap(floorItems[i].footprint, floorItems[j].footprint),
          ).toBe(false);
    }
  });

  it('같은 세대는 항상 같은 배치, 세대마다 조금씩 다름', () => {
    const layout = computeBuildingLayout({ floors: 2, unitsPerFloor: 4 });
    const a = planUnitFurniture(layout.units[0]);
    expect(planUnitFurniture(layout.units[0])).toEqual(a);
    const keys = layout.units.map((u) =>
      planUnitFurniture(u)
        .map((it) => it.key)
        .join(','),
    );
    expect(new Set(keys).size).toBeGreaterThan(1);
  });
});
