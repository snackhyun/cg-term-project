import { describe, expect, it } from 'vitest';
import {
  computePathDistances,
  countAtLeast,
  unfoldedDistance,
  uniqueLines,
  cornerDistance,
} from '../src/simulation/pathDistance.js';

describe('unfoldedDistance', () => {
  it('x = 상수인 벽을 거치는 거리, 펼쳐서 계산', () => {
    const line = { axis: 'x', value: -2.25 };
    // 바닥 → 벽 2.51m → 아래층 바닥
    const across = 2.25 + 2.51 + 1.25;
    expect(unfoldedDistance(0, 0, -1, 1, line, 2.51, false)).toBeCloseTo(
      Math.hypot(across, 1),
      6,
    );
    // 벽 위 정점은 바닥으로 다시 나가지 않음
    expect(unfoldedDistance(0, 0, -2.25, 1, line, 1.0, true)).toBeCloseTo(
      Math.hypot(2.25 + 1.0, 1),
      6,
    );
  });

  it('z = 상수인 벽도 같은 방식', () => {
    const line = { axis: 'z', value: -3 };
    expect(unfoldedDistance(1, 0, -1, -1, line, 2, false)).toBeCloseTo(
      Math.hypot(2, 3 + 2 + 2),
      6,
    );
  });
});

describe('computePathDistances', () => {
  const surface = {
    isWall: false,
    worldX: new Float32Array([0, 1, -2]),
    worldY: new Float32Array([0, 0, 0]),
    worldZ: new Float32Array([0, 0, 2]),
    line: null,
    levelY: 0,
  };

  it('같은 층 바닥은 수평 직선 거리', () => {
    const d = computePathDistances(surface, { x: 0, y: 0, z: 0 }, false, null);
    expect(Array.from(d)).toEqual([0, 1, expect.closeTo(Math.hypot(2, 2), 5)]);
  });

  it('다른 층 바닥은 가장 짧은 벽 경로', () => {
    const via = [
      { axis: 'x', value: -2.25 },
      { axis: 'x', value: 2.25 },
      { axis: 'z', value: -3 },
    ];
    const impact = { x: 0, y: 2.51, z: 0 }; // 바로 위층 중앙
    const d = computePathDistances(surface, impact, true, via);
    // 원점 정점: 좌·우 벽 모두 2.25 + 2.51 + 2.25
    expect(d[0]).toBeCloseTo(7.01, 5);
    // x = 1 정점: 오른쪽 벽이 더 가까움
    expect(d[1]).toBeCloseTo(2.25 + 2.51 + 1.25, 5);
  });

  it('벽 정점은 바닥을 지나 벽을 타고 오른 높이 더함', () => {
    const wall = {
      isWall: true,
      worldX: new Float32Array([-2.25, -2.25]),
      worldY: new Float32Array([0, 2]),
      worldZ: new Float32Array([0, 0]),
      line: { axis: 'x', value: -2.25 },
      levelY: 0,
    };
    const d = computePathDistances(wall, { x: 0, y: 0, z: 0 }, false, null);
    expect(d[0]).toBeCloseTo(2.25, 5);
    expect(d[1]).toBeCloseTo(4.25, 5);
  });
});

describe('helpers', () => {
  it('uniqueLines는 같은 선을 한 번만', () => {
    const lines = uniqueLines([
      { axis: 'x', value: 2.35 },
      { axis: 'x', value: 2.35 },
      { axis: 'z', value: 2.35 },
    ]);
    expect(lines).toHaveLength(2);
  });

  it('countAtLeast는 내림차순 배열에서 value 이상인 개수', () => {
    const arr = new Float32Array([5, 4, 4, 2, 1]);
    expect(countAtLeast(arr, 4)).toBe(3);
    expect(countAtLeast(arr, 0)).toBe(5);
    expect(countAtLeast(arr, 6)).toBe(0);
  });
});

describe('벽 위 충격 (impact.line)', () => {
  const back = { axis: 'z', value: -3 };
  const left = { axis: 'x', value: -2 };
  const impact = { x: 0, y: 1.5, z: -3, line: back }; // 뒤 벽, 바닥에서 1.5 m

  it('같은 벽 정점: 벽 면 위 직선 거리', () => {
    const surface = {
      isWall: true,
      worldX: new Float32Array([1]),
      worldY: new Float32Array([0.5]),
      worldZ: new Float32Array([-3]),
      line: back,
      levelY: 0,
    };
    expect(computePathDistances(surface, impact, false, null)[0]).toBeCloseTo(
      Math.hypot(1, 1),
      5,
    );
  });

  it('같은 층 바닥: 벽을 타고 1.5 m 내려온 뒤 바닥', () => {
    const surface = {
      isWall: false,
      worldX: new Float32Array([0]),
      worldY: new Float32Array([0]),
      worldZ: new Float32Array([-1]),
      line: null,
      levelY: 0,
    };
    expect(computePathDistances(surface, impact, false, null)[0]).toBeCloseTo(
      1.5 + 2,
      5,
    );
  });

  it('직교 벽: 모서리를 도는 경로', () => {
    const surface = {
      isWall: true,
      worldX: new Float32Array([-2]),
      worldY: new Float32Array([1.5]),
      worldZ: new Float32Array([-2]),
      line: left,
      levelY: 0,
    };
    // 모서리 (−2, −3)까지 2 m + 왼쪽 벽 따라 1 m, 높이 차 0
    expect(computePathDistances(surface, impact, false, null)[0]).toBeCloseTo(
      3,
      5,
    );
    expect(cornerDistance(0, 1.5, -3, -2, 0.5, -2, back, left)).toBeCloseTo(
      Math.hypot(3, 1),
      5,
    );
  });

  it('위층 바닥: 충격 높이에서 위층 바닥까지 벽을 타고 오름', () => {
    const surface = {
      isWall: false,
      worldX: new Float32Array([0]),
      worldY: new Float32Array([2.51]),
      worldZ: new Float32Array([-1]),
      line: null,
      levelY: 2.51,
    };
    expect(computePathDistances(surface, impact, true, [back])[0]).toBeCloseTo(
      2.51 - 1.5 + 2,
      5,
    );
  });
});

describe('평행한 벽 사이 (벽 충격)', () => {
  const left = { axis: 'x', value: -2 };
  const right = { axis: 'x', value: 2 };
  const unit = { floorY: 0, height: 2.3 };

  it('바닥(또는 천장)을 거쳐 감, 방 공기를 가로지르지 않음', () => {
    const impact = { x: -2, y: 1, z: 0, line: left, unit };
    const surface = {
      isWall: true,
      worldX: new Float32Array([2]),
      worldY: new Float32Array([1]),
      worldZ: new Float32Array([0]),
      line: right,
      levelY: undefined,
    };
    // 바닥 경로 1 + 4 + 1 = 6, 천장 경로 1.3 + 4 + 1.3 = 6.6
    expect(computePathDistances(surface, impact, false, null)[0]).toBeCloseTo(
      6,
      5,
    );
  });

  it('세대 간 벽 건너편 면(간격 0.2 m)은 같은 벽으로 봄', () => {
    const impact = { x: 2, y: 1, z: 0, line: right, unit };
    const across = { axis: 'x', value: 2.2 };
    const surface = {
      isWall: true,
      worldX: new Float32Array([2.2]),
      worldY: new Float32Array([1]),
      worldZ: new Float32Array([1]),
      line: across,
      levelY: undefined,
    };
    expect(computePathDistances(surface, impact, false, null)[0]).toBeCloseTo(
      Math.hypot(0.2, 1),
      5,
    );
  });
});
