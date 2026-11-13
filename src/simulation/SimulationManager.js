/**
 * 층간소음 시뮬레이션
 * 수음 레벨: 대역 전달 모델(acoustics/buildingModel), 거리감쇠 없음
 * 측정: 세대별 소음계(meter.js). 반영 시각 = 충격 + 세대 쌍별 고정 화면 전파 지연
 * 시각화: 파동(waves.js) + 히트맵(heatmap.js), 색 = 세대별 단발 L_AFmax
 *
 * 다른 모듈용 API
 *   addImpact(point, unit, source?, opts?)  unit 바닥 point({ x, z })에 충격 1회. source = sourceLevelDb(type), 생략 시 'click'
 *                                    opts.time: 실제 충격 시각(s, 지난 프레임 안), 생략 시 elapsed
 *                                    opts.wall: 벽 충격(0 뒤, 1 좌, 2 우), point.y = 충격 높이
 *   findUnitAt(x, z, y?)             위치의 세대
 *   onMeasurement(fn)                측정 스냅숏 구독
 *   units, elapsed, model            세대 목록, 경과 시간(s), 현재 음향 모델
 */
import {
  LEGAL_WINDOW_SECONDS,
  createAcousticModel,
  isImpactSource,
  legalLimits,
  sourceLevelDb,
  toDb,
  toEnergy,
  BANDS,
  EXTRAPOLATED_BANDS,
  LMAX_RULE,
} from '../acoustics/index.js';
import { DEFAULT_CONFIG } from '../config.js';
import {
  createHeatColorLUT,
  createSurface,
  getPathCache,
  resetSurface,
  updateSurface,
  HEATMAP_PARAMS,
} from './heatmap.js';
import { PointerInteraction } from './interaction.js';
import { classifyUnit } from './measurement.js';
import { LevelMeter } from './meter.js';
import {
  advanceWaves,
  createWave,
  physicalWaveSpeed,
  visualWaveSpeed,
} from './waves.js';

/** 측정 설정. emitInterval 패널 갱신 간격 (s), maxHistory 재계산용 충격 기록 상한 */
export const MEASUREMENT_PARAMS = {
  emitInterval: 0.25,
  maxHistory: 5000,
};

/** 설정 없이 만들 때 기본값 */
function defaultsFrom(config) {
  return {
    acoustics: { ...(config?.acoustics ?? DEFAULT_CONFIG.acoustics) },
    slowMotion:
      config?.simulation?.slowMotion ?? DEFAULT_CONFIG.simulation.slowMotion,
    windowSeconds:
      config?.simulation?.measurementWindow ??
      DEFAULT_CONFIG.simulation.measurementWindow,
    rippleStrength:
      config?.simulation?.rippleStrength ??
      DEFAULT_CONFIG.simulation.rippleStrength,
  };
}

export class SimulationManager {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.domElement 렌더러 캔버스
   * @param {OrbitControls} [opts.controls] 바닥 누르는 동안 회전 막기
   * @param {object} opts.building createBuilding() 결과
   * @param {object} [opts.config] createConfig() 결과. acoustics·simulation 변경 구독
   */
  constructor({
    camera,
    domElement,
    controls = null,
    building,
    isNight = false,
    config = null,
  }) {
    this.controls = controls;
    this.waves = [];
    this.history = [];
    this.pending = [];
    this.elapsed = 0;
    this.measureStart = 0;
    this.emitTimer = 0;
    this.listeners = new Set();
    this.warnedLegacy = false;

    const d = defaultsFrom(config);
    this.acousticParams = d.acoustics;
    this.slowMotion = d.slowMotion;
    this.windowSeconds = d.windowSeconds;
    this.rippleStrength = d.rippleStrength;

    this.isNightMode = isNight;
    this.limits = legalLimits(isNight);
    this.colorLUT = createHeatColorLUT(this.limits);

    this.interaction = new PointerInteraction({
      camera,
      domElement,
      controls,
      onImpact: (point, unit, source, opts) =>
        this.addImpact(point, unit, source, opts),
    });

    this.unsubscribe = config
      ? config.subscribe(({ section, path, value }) => {
          if (section === 'acoustics')
            this.setAcoustics({ ...config.acoustics });
          if (path === 'simulation.slowMotion') this.setSlowMotion(value);
          if (path === 'simulation.measurementWindow') this.setWindow(value);
          if (path === 'simulation.rippleStrength') this.rippleStrength = value;
        })
      : null;

    this.setBuilding(building);
  }

  get units() {
    return this.building ? this.building.units : [];
  }

  /** 하위 호환: Leq 기준 */
  get legalThreshold() {
    return this.limits.leq;
  }

  /** 화면 파면 속도 (m/s) */
  get visualSpeed() {
    return visualWaveSpeed(this.building.config.slabThickness, this.slowMotion);
  }

  /** 새 건물로 초기화. 파동·측정값 삭제 */
  setBuilding(building) {
    this.building = building;
    this.waves = [];
    this.history = [];
    this.historyFloor = -Infinity;
    this.pending = [];
    this.delayCache = new Map();
    this.rebuildModel();

    this.unitStates = building.units.map((unit) => ({
      unit,
      meter: new LevelMeter(this.model.responseTerms),
      lastSourceAt: -Infinity,
      idle: true,
      surfaces: [
        createSurface(unit.floor, {
          isWall: false,
          levelY: unit.floorY,
          floorLevel: unit.floorLevel,
        }),
        ...unit.walls.map((wall, i) =>
          createSurface(wall, {
            isWall: true,
            line: unit.wallLines[i],
            floorLevel: unit.floorLevel,
          }),
        ),
      ],
    }));
    this.resetMeters();

    const structure = building.group.getObjectByName('structure');
    this.interaction.setUnits(
      building.units,
      structure ? structure.children : [],
    );
    this.emitMeasurement();
  }

  rebuildModel() {
    this.model = createAcousticModel(this.building.config, this.acousticParams);
  }

  /** 음향 파라미터 변경. 기록된 충격을 새 값으로 다시 계산 */
  setAcoustics(params) {
    this.acousticParams = { ...params };
    this.rebuildModel();
    for (const impact of this.history) impact.levels = null;
    for (const w of this.waves) this.applyLevels(w, w.impact);
    this.replay();
  }

  /** 슬로모션 배율 변경. 이후 충격부터 적용 */
  setSlowMotion(value) {
    this.slowMotion = value;
    this.emitMeasurement();
  }

  /** 측정 구간(s) 변경. 기록으로 다시 계산 */
  setWindow(seconds) {
    this.windowSeconds = seconds;
    this.replay();
  }

  setMode(isNight) {
    this.isNightMode = isNight;
    this.limits = legalLimits(isNight);
    this.colorLUT = createHeatColorLUT(this.limits);
    this.replay();
  }

  /** 파동, 측정값, 색, 바닥 변위 초기화 */
  reset() {
    this.waves = [];
    this.history = [];
    this.historyFloor = -Infinity;
    this.pending = [];
    this.interaction.cancel();
    if (this.controls) this.controls.enabled = true;
    for (const state of this.unitStates) {
      state.lastSourceAt = -Infinity;
      state.idle = true;
      for (const surface of state.surfaces) resetSurface(surface);
    }
    this.resetMeters();
    this.emitMeasurement();
  }

  resetMeters() {
    this.measureStart = this.elapsed;
    this.replayTruncated = false;
    for (const state of this.unitStates) {
      state.meter = new LevelMeter(this.model.responseTerms);
      state.meter.reset(this.elapsed);
    }
  }

  /** 충격 1회의 세대별 수음 결과 (현재 모델, 캐시) */
  levelsFor(impact) {
    if (!impact.levels)
      impact.levels = this.model.impactLevels(
        impact.source,
        impact.srcIndex,
        impact.wall,
      );
    return impact.levels;
  }

  applyLevels(wave, impact) {
    const levels = this.levelsFor(impact);
    wave.peaks = Float64Array.from(levels, (l) => l.fastMaxA);
    wave.sourceLevel = toDb(levels[impact.srcIndex].fastMaxA);
  }

  /**
   * @param {{ x: number, z: number }} point 바닥 위 위치 (THREE.Vector3도 가능)
   * @param {object} unit this.units 중 하나
   * @param {object} [source] sourceLevelDb(type) 결과
   * @param {{ time?: number, wall?: number|null }} [opts]
   *   time: 실제 충격 시각 (지연 프레임에서 간격 보존), wall: 벽을 친 경우 0 뒤, 1 좌, 2 우
   */
  addImpact(point, unit, source = sourceLevelDb('click'), opts = {}) {
    const state = this.unitStates[unit?.index];
    if (!state || state.unit !== unit) return;
    if (!isImpactSource(source)) {
      if (!this.warnedLegacy) {
        console.warn(
          'addImpact: sourceLevelDb(type) 결과가 아님, click으로 처리',
          source,
        );
        this.warnedLegacy = true;
      }
      source = sourceLevelDb('click');
    }
    const time = Math.min(opts.time ?? this.elapsed, this.elapsed);
    state.lastSourceAt = time;

    const impact = {
      time,
      srcIndex: unit.index,
      wall: opts.wall ?? null,
      source,
      levels: null,
      arrivals: new Float64Array(this.unitStates.length),
    };
    const speed = this.visualSpeed;
    const delays = this.arrivalDelays(unit, speed);
    const onWall = impact.wall !== null;
    const y = onWall ? (point.y ?? unit.floorY) : unit.floorY;
    const line = onWall ? unit.wallLines[impact.wall] : null;
    const probe = { x: point.x, z: point.z, y, unit, line };
    let maxDist = 0;
    for (const s of this.unitStates) {
      for (const surface of s.surfaces) {
        maxDist = Math.max(maxDist, getPathCache(surface, probe, s.unit).dMax);
      }
    }
    delays.forEach((d, i) => (impact.arrivals[i] = time + d));

    this.history.push(impact);
    while (
      this.history.length > MEASUREMENT_PARAMS.maxHistory ||
      this.history[0].time < this.elapsed - LMAX_RULE.periodSeconds
    ) {
      this.history.shift();
      this.historyFloor = this.history[0].time;
    }
    this.unitStates.forEach((_, i) => {
      if (i !== unit.index) this.queueArrival(impact.arrivals[i], i, impact);
    });

    const wave = createWave({
      point: { x: point.x, z: point.z, y },
      line,
      unit,
      speed,
      maxDist,
      impact,
      onFloor: impact.wall === null,
    });
    advanceWaves([wave], this.elapsed - time);
    this.applyLevels(wave, impact);
    this.waves.push(wave);
  }

  /**
   * 소음계 반영 지연 = 발생 세대 중심 → 세대 최단 경로 / 화면 속도
   * 세대 쌍마다 고정이라 충격 간격 보존 (발생 위치가 움직여도 L_max 불변)
   */
  arrivalDelays(unit, speed) {
    const key = `${unit.index}:${speed}`;
    let delays = this.delayCache.get(key);
    if (delays) return delays;
    const probe = { x: unit.centerX, z: unit.centerZ, y: unit.floorY, unit };
    delays = this.unitStates.map((s, i) => {
      if (i === unit.index) return 0;
      let dMin = Infinity;
      for (const surface of s.surfaces) {
        dMin = Math.min(dMin, getPathCache(surface, probe, s.unit).dMin);
      }
      return dMin / speed;
    });
    this.delayCache.set(key, delays);
    return delays;
  }

  queueArrival(t, unitIndex, impact) {
    const item = { t, unitIndex, impact };
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1].t > t) i--;
    this.pending.splice(i, 0, item);
  }

  /** 도달한 충격을 소음계에 반영하고 now까지 적분 */
  processArrivals(now) {
    const limitE = toEnergy(this.limits.lmax);
    while (this.pending.length && this.pending[0].t <= now) {
      const { t, unitIndex, impact } = this.pending.shift();
      if (impact.time < this.measureStart) continue;
      const l = this.levelsFor(impact)[unitIndex];
      this.unitStates[unitIndex].meter.arrive(
        t,
        l.weights,
        l.bands,
        this.windowSeconds,
        limitE,
      );
    }
    for (const s of this.unitStates) {
      s.meter.advance(now, limitE);
      s.meter.prune(now, this.windowSeconds);
    }
  }

  /**
   * 기록된 충격으로 측정값 다시 계산 (파라미터·모드·구간 변경 시)
   * 기록 상한으로 지워진 구간이 있으면 남은 기록 시작부터 새 측정으로 처리 (replayTruncated)
   */
  replay() {
    if (this.historyFloor > this.measureStart) {
      this.measureStart = this.historyFloor;
      this.replayTruncated = true;
    }
    const start = this.measureStart;
    for (const s of this.unitStates) {
      s.meter = new LevelMeter(this.model.responseTerms);
      s.meter.reset(start);
    }
    this.pending = [];
    for (const impact of this.history) {
      if (impact.time < start) continue;
      impact.arrivals.forEach((t, i) => {
        if (i !== impact.srcIndex)
          this.pending.push({ t, unitIndex: i, impact });
      });
    }
    this.pending.sort((a, b) => a.t - b.t);
    this.processArrivals(this.elapsed);
    this.emitMeasurement();
  }

  /** (x, z) 위치 세대. y 생략 시 가장 아래층 */
  findUnitAt(x, z, y = null) {
    let best = null;
    for (const unit of this.units) {
      const b = unit.bounds;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (y === null) {
        if (!best || unit.floorLevel < best.floorLevel) best = unit;
      } else if (y >= unit.floorY - 0.05 && y <= unit.floorY + unit.height) {
        return unit;
      }
    }
    return best;
  }

  update(delta) {
    this.elapsed += delta;
    // 기존 파동 먼저 진행. 이번 프레임 충격은 addImpact에서 실제 시각만큼만 진행
    advanceWaves(this.waves, delta);

    this.interaction.update(delta);
    this.processArrivals(this.elapsed);

    const frame = {
      alpha: 1 - Math.exp(-HEATMAP_PARAMS.colorRelease * delta),
      lut: this.colorLUT,
      rippleStrength: this.rippleStrength,
    };
    for (const state of this.unitStates) this.updateUnit(state, frame);

    this.emitTimer += delta;
    if (this.emitTimer >= MEASUREMENT_PARAMS.emitInterval) {
      this.emitTimer = 0;
      this.emitMeasurement();
    }
  }

  updateUnit(state, frame) {
    if (this.waves.length === 0 && state.idle) return;
    let colored = false;
    for (const surface of state.surfaces) {
      if (updateSurface(surface, this.waves, state.unit, frame).colored)
        colored = true;
    }
    state.idle = this.waves.length === 0 && !colored;
  }

  /** 측정 구간 안에 소음을 낸 세대 */
  isSourceUnit(state) {
    return this.elapsed - state.lastSourceAt <= this.windowSeconds;
  }

  getMeasurement() {
    const now = this.elapsed;
    const W = this.windowSeconds;
    const slab = this.building.config.slabThickness;
    return {
      isNight: this.isNightMode,
      limits: this.limits,
      threshold: this.limits.leq,
      windowSeconds: W,
      isLegalWindow: W === LEGAL_WINDOW_SECONDS,
      elapsedInWindow: Math.min(now - this.measureStart, W),
      replayTruncated: this.replayTruncated,
      lmaxRule: LMAX_RULE,
      slowMotion: this.slowMotion,
      physicalSpeed: physicalWaveSpeed(slab),
      visualSpeed: this.visualSpeed,
      bands: BANDS,
      extrapolatedBands: EXTRAPOLATED_BANDS,
      floatingFloor: this.acousticParams.floatingFloor,
      units: this.unitStates.map((state) => {
        const m = state.meter;
        const u = {
          index: state.unit.index,
          name: state.unit.name,
          floorLevel: state.unit.floorLevel,
          column: state.unit.column,
          leq: m.leq(now, W),
          leqMax: m.leqMax,
          lmax: m.lmax,
          laf: m.laf,
          lmaxCount: m.exceedanceCount(now),
          bandLeq: m.bandLeq(now, W),
          heard: m.lmax > 0,
          isSource: this.isSourceUnit(state),
        };
        u.status = classifyUnit(u, this.limits);
        return u;
      }),
    };
  }

  /** 측정 결과 구독. 등록 즉시 1회 호출, 해제 함수 반환 */
  onMeasurement(fn) {
    this.listeners.add(fn);
    fn(this.getMeasurement());
    return () => this.listeners.delete(fn);
  }

  emitMeasurement() {
    if (this.listeners.size === 0) return;
    const snapshot = this.getMeasurement();
    for (const fn of this.listeners) fn(snapshot);
  }

  dispose() {
    this.interaction.dispose();
    if (this.unsubscribe) this.unsubscribe();
    this.listeners.clear();
    this.waves = [];
    this.unitStates = [];
  }
}
