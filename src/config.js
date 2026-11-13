/**
 * 건물·시뮬레이션 설정과 변경 알림 (길이 단위 m)
 *
 *   const config = createConfig();
 *   config.building.floors                  // 읽기
 *   config.set('building.floors', 3)        // 변경 후 구독자에게 알림
 *   const off = config.subscribe(({ path, value, previous }) => {});
 *
 * 직접 대입하면 알림이 가지 않으므로 값은 set()으로만 바꿉니다.
 */

export const BUILDING_LIMITS = {
  floors: { min: 1, max: 5, step: 1 },
  unitsPerFloor: { min: 1, max: 4, step: 1 },
  width: { min: 3.0, max: 8.0, step: 0.1 },
  depth: { min: 4.0, max: 10.0, step: 0.1 },
  height: { min: 2.1, max: 3.0, step: 0.05 },
  slabThickness: { min: 0.12, max: 0.3, step: 0.01 },
  wallThickness: { min: 0.1, max: 0.3, step: 0.01 },
};

/** 음향·측정 파라미터 범위 */
export const ACOUSTICS_LIMITS = {
  density: { min: 2000, max: 2600, step: 50 },
  lossFactor: { min: 0.005, max: 0.05, step: 0.001 },
  dynamicStiffness: { min: 5, max: 60, step: 1 },
  screedMass: { min: 40, max: 200, step: 2 },
  reverbTime: { min: 0.3, max: 1.5, step: 0.05 },
  slowMotion: { min: 20, max: 500, step: 10 },
  rippleStrength: { min: 0, max: 1, step: 0.05 },
};

export const DEFAULT_CONFIG = Object.freeze({
  building: Object.freeze({
    floors: 2,
    unitsPerFloor: 2,
    width: 4.5, // 세대 안목 폭 (x)
    depth: 6.0, // 세대 안목 깊이 (z)
    height: 2.3, // 천장고
    slabThickness: 0.21, // 표준바닥구조 기준 210mm
    wallThickness: 0.2,
  }),
  simulation: Object.freeze({
    isNight: false,
    presetUnit: null, // 프리셋 세대 이름. null이면 최상층 첫 세대
    slowMotion: 200, // 화면 파면 속도 = 실제 굽힘파 군속도 / slowMotion
    measurementWindow: 20, // Leq 구간 (s). 법정 60, 시연용 20
    rippleStrength: 0.3, // 발생 세대 바닥 물결 세기 (0 = 평평, 표시용)
  }),
  /** 음향 파라미터. 슬래브·벽 두께는 building 값 사용 */
  acoustics: Object.freeze({
    density: 2400, // 콘크리트 밀도 ρ (kg/m³)
    lossFactor: 0.02, // 전체 손실계수 η_tot (가정)
    floatingFloor: true, // 뜬바닥(완충재 + 마감 모르타르)
    dynamicStiffness: 20, // 완충재 동탄성계수 s′ (MN/m³, 가정)
    screedMass: 104, // 완충재 위 층 면밀도 m′ (kg/m²)
    reverbTime: 0.5, // 수음실 잔향시간 T (s)
  }),
  /** 화면 표시 */
  view: Object.freeze({
    mode: 'mixed', // 'real' 실사 | 'mixed' 혼합 | 'heatmap' 히트맵
  }),
});

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * @param {object} [overrides] 기본값 위에 덮어쓸 값 (예: { building: { floors: 3 } })
 */
export function createConfig(overrides = {}) {
  const data = deepClone(DEFAULT_CONFIG);
  for (const [section, values] of Object.entries(overrides)) {
    Object.assign(data[section] ?? (data[section] = {}), values);
  }

  const listeners = new Set();

  const config = {
    building: data.building,
    simulation: data.simulation,
    view: data.view,
    acoustics: data.acoustics,

    get(path) {
      const [section, key] = path.split('.');
      return data[section]?.[key];
    },

    /** 값이 실제로 바뀌었을 때만 알림. @returns {boolean} 변경 여부 */
    set(path, value) {
      const [section, key] = path.split('.');
      if (!data[section] || !(key in data[section])) {
        throw new Error(`알 수 없는 설정 경로: ${path}`);
      }
      const previous = data[section][key];
      if (previous === value) return false;
      data[section][key] = value;
      const change = { path, section, key, value, previous };
      for (const fn of [...listeners]) fn(change, config);
      return true;
    },

    resetBuilding() {
      for (const [key, value] of Object.entries(DEFAULT_CONFIG.building)) {
        config.set(`building.${key}`, value);
      }
    },

    /** @returns {() => void} 구독 해제 함수 */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    snapshot() {
      return deepClone(data);
    },
  };

  return config;
}
