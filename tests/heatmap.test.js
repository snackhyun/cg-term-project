import { describe, expect, it } from 'vitest';
import { createHeatColorLUT, heatColor } from '../src/simulation/heatmap.js';

const day = { leq: 39, lmax: 57 };

describe('heatColor', () => {
  it('0 dB는 오버레이 없음, 0–20 dB 서서히', () => {
    expect(heatColor(0, day).a).toBe(0);
    expect(heatColor(10, day).a).toBeCloseTo(0.5, 6);
    expect(heatColor(20, day).a).toBe(1);
  });

  it('초록 < Leq 기준 ≤ 노랑 < L_max 기준 ≤ 빨강', () => {
    expect(heatColor(30, day)).toEqual({ r: 0, g: 1, b: 0, a: 1 });
    expect(heatColor(45, day)).toEqual({ r: 1, g: 1, b: 0, a: 1 });
    expect(heatColor(58, day)).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(heatColor(53, { leq: 34, lmax: 52 })).toEqual({
      r: 1,
      g: 0,
      b: 0,
      a: 1,
    });
  });

  it('LUT는 RGBA 4개씩', () => {
    const lut = createHeatColorLUT(day);
    expect(lut.length % 4).toBe(0);
    expect(lut[3]).toBe(0);
  });
});

describe('updateSurface 색 최고값', () => {
  it('정점 색 최고값 = 파동의 단발 L_AFmax (60 dB)', async () => {
    const THREE = await import('three');
    const { createSurface, updateSurface } =
      await import('../src/simulation/heatmap.js');
    const { createWave, advanceWaves } =
      await import('../src/simulation/waves.js');
    const geo = new THREE.PlaneGeometry(6, 6, 12, 12);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(
        new Float32Array(geo.attributes.position.count * 4),
        4,
      ),
    );
    const unit = { index: 0, floorLevel: 0, floorY: 0, wallLines: [] };
    const surface = createSurface(new THREE.Mesh(geo), {
      isWall: false,
      levelY: 0,
      floorLevel: 0,
    });
    const other = { ...unit, index: 1 };
    const wave = createWave({
      point: { x: -3, z: 0 },
      unit: other,
      peaks: Float64Array.from([1e6, 0]),
      sourceLevel: 0,
      speed: 4.2,
      maxDist: 9,
    });
    const frame = { alpha: 1, lut: createHeatColorLUT(day) };
    let best = 0;
    for (let t = 0; t < 3; t += 0.004) {
      advanceWaves([wave], 0.004);
      updateSurface(surface, [wave], unit, frame);
      best = Math.max(best, ...surface.smoothed);
    }
    expect(best).toBeGreaterThan(59.7);
    expect(best).toBeLessThan(60.3);
  });
});
