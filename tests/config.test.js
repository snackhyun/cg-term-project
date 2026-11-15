import { describe, expect, it, vi } from 'vitest';
import { createConfig, DEFAULT_CONFIG } from '../src/config.js';

describe('config', () => {
  it('기본값과 덮어쓴 값을 가집니다', () => {
    const config = createConfig({ building: { floors: 3 } });
    expect(config.building.floors).toBe(3);
    expect(config.building.width).toBe(DEFAULT_CONFIG.building.width);
  });

  it('값이 바뀔 때만 구독자에게 알립니다', () => {
    const config = createConfig();
    const fn = vi.fn();
    const off = config.subscribe(fn);
    config.set('building.floors', 4);
    config.set('building.floors', 4);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toMatchObject({
      path: 'building.floors',
      section: 'building',
      key: 'floors',
      value: 4,
      previous: 2,
    });
    off();
    config.set('building.floors', 5);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('없는 경로는 오류입니다', () => {
    expect(() => createConfig().set('building.nope', 1)).toThrow();
  });

  it('resetBuilding은 바뀐 항목만 되돌립니다', () => {
    const config = createConfig({ building: { floors: 4, width: 5 } });
    const fn = vi.fn();
    config.subscribe(fn);
    config.resetBuilding();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(config.building.floors).toBe(2);
  });
});
