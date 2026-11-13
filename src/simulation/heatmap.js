/**
 * 히트맵 면(바닥, 벽) 갱신. 정점별 RGBA 색과 바닥 물결 변위
 * color 속성: RGB = 소음 색(선형), A = 오버레이 세기 (src/render 참고)
 * 정점 색 = 그 세대의 단발 L_AFmax(물리 계산값). 파면 도착 시각만 슬로모션
 */
import * as THREE from 'three';
import { cylindricalSpreadingDb } from '../acoustics/index.js';
import { WAVE_PARAMS } from './waves.js';
import {
  computePathDistances,
  countAtLeast,
  uniqueLines,
} from './pathDistance.js';

/**
 * 시각화 값 (물리값 아님)
 * edgeWidth 파면 테두리 폭 (m, 색이 차오르는 구간), colorRelease 색 감소 평활화 (1/s, 증가는 즉시,
 * 작을수록 반복 충격에서 색이 덜 깜빡임), ripple* 발생 세대 바닥 물결 (rad/m, rad/s, 1/s, dB 배율,
 * 물결 세기 1일 때 최대 변위 m), pathCacheSize 면별 충격 지점 캐시 수
 */
export const HEATMAP_PARAMS = {
  edgeWidth: 1.0,
  colorRelease: 1.25,
  rippleWaveNumber: 2.0 / 0.28,
  rippleAngularSpeed: 5.0,
  rippleDecay: 3.0,
  rippleDbScale: 30.0,
  rippleAmplitude: 0.25 * 0.28,
  pathCacheSize: 16,
};

const GREEN = { r: 0.0, g: 1.0, b: 0.0 };
const YELLOW = { r: 1.0, g: 1.0, b: 0.0 };
const RED = { r: 1.0, g: 0.0, b: 0.0 };
/** 경계 아래 색 섞기 폭 (dB) */
const BLEND = 2.0;
const OVERLAY_RAMP_DB = 20;

function smoothstep01(t) {
  return t * t * (3 - 2 * t);
}

function mixColor(a, b, t) {
  const k = smoothstep01(t);
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

/**
 * dB(A) → 색(sRGB)과 오버레이 세기
 * 초록 < Leq 기준 ≤ 노랑 < L_max 기준 ≤ 빨강. 0–20 dB 오버레이 서서히
 * @param {{ leq: number, lmax: number }} limits
 */
export function heatColor(dB, limits) {
  if (dB <= 0) return { ...GREEN, a: 0 };
  if (dB < OVERLAY_RAMP_DB)
    return { ...GREEN, a: smoothstep01(dB / OVERLAY_RAMP_DB) };
  const { leq, lmax } = limits;
  let c;
  if (dB < leq - BLEND) c = GREEN;
  else if (dB < leq) c = mixColor(GREEN, YELLOW, (dB - (leq - BLEND)) / BLEND);
  else if (dB < lmax - BLEND) c = YELLOW;
  else if (dB < lmax) c = mixColor(YELLOW, RED, (dB - (lmax - BLEND)) / BLEND);
  else c = RED;
  return { ...c, a: 1 };
}

/** sRGB → 선형 */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const LUT_STEP = 0.05;
const LUT_MAX_DB = 120;
const LUT_LAST = Math.round(LUT_MAX_DB / LUT_STEP);

/** dB → RGBA(선형) 표 */
export function createHeatColorLUT(limits) {
  const lut = new Float32Array((LUT_LAST + 1) * 4);
  for (let i = 0; i <= LUT_LAST; i++) {
    const c = heatColor(i * LUT_STEP, limits);
    lut[i * 4] = srgbToLinear(c.r);
    lut[i * 4 + 1] = srgbToLinear(c.g);
    lut[i * 4 + 2] = srgbToLinear(c.b);
    lut[i * 4 + 3] = c.a;
  }
  return lut;
}

function lutOffset(dB) {
  if (!(dB > 0)) return 0;
  return Math.min(Math.round(dB / LUT_STEP), LUT_LAST) * 4;
}

/**
 * 정점 월드 좌표 미리 계산 (면은 고정)
 * @param {object} opts { isWall, line (벽이 놓인 선), levelY (바닥 높이), floorLevel }
 */
export function createSurface(
  mesh,
  { isWall, line = null, levelY, floorLevel },
) {
  mesh.updateMatrixWorld(true);
  const geometry = mesh.geometry;
  const posAttr = geometry.attributes.position;
  const count = posAttr.count;
  const worldX = new Float32Array(count);
  const worldY = new Float32Array(count);
  const worldZ = new Float32Array(count);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
    worldX[i] = v.x;
    worldY[i] = v.y;
    worldZ[i] = v.z;
  }
  return {
    mesh,
    geometry,
    isWall,
    worldX,
    worldY,
    worldZ,
    line,
    levelY,
    floorLevel,
    pathCache: new Map(),
    smoothed: new Float32Array(count),
    idle: true,
  };
}

/**
 * 충격 지점별 정점 경로 거리 캐시 { dist, dMin, dMax, spreading, expBySpeed }
 * 길게 누르기 파동은 같은 지점이라 1회 계산
 */
export function getPathCache(surface, w, unit) {
  const src = w.line ? `${w.line.axis}${w.line.value.toFixed(3)}` : 'floor';
  const key = `${w.unit.index}:${src}:${w.x.toFixed(2)}:${w.y.toFixed(2)}:${w.z.toFixed(2)}`;
  const cached = surface.pathCache.get(key);
  if (cached) return cached;

  const otherLevel =
    !surface.isWall && surface.floorLevel !== w.unit.floorLevel;
  const viaLines = otherLevel
    ? uniqueLines([...unit.wallLines, ...w.unit.wallLines])
    : null;
  const dist = computePathDistances(surface, w, otherLevel, viaLines);

  let dMin = Infinity;
  let dMax = 0;
  const spreading = new Float32Array(dist.length);
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] < dMin) dMin = dist[i];
    if (dist[i] > dMax) dMax = dist[i];
    spreading[i] = cylindricalSpreadingDb(dist[i]);
  }

  const result = { dist, dMin, dMax, spreading, expBySpeed: new Map() };
  surface.pathCache.set(key, result);
  if (surface.pathCache.size > HEATMAP_PARAMS.pathCacheSize) {
    surface.pathCache.delete(surface.pathCache.keys().next().value);
  }
  return result;
}

/** e^((d − d_min)/(v·τ)): 파면 지연을 정점별 계수로 분리 */
function delayFactors(path, speed, tau) {
  let arr = path.expBySpeed.get(speed);
  if (!arr) {
    arr = new Float64Array(path.dist.length);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.exp((path.dist[i] - path.dMin) / (speed * tau));
    }
    path.expBySpeed.set(speed, arr);
  }
  return arr;
}

/**
 * 면 색·물결 갱신
 * 정점 에너지 = Σ_w P_u,w · exp(−(t_w − t_full(d))/τ), 테두리 안에서는 P_u,w · 선형 증가
 * t_full(d) = (d + edgeWidth − r0)/v. 최고값 = P_u,w (단발 L_AFmax)
 * @param {object[]} waves 진행 중인 파동
 * @param {{ alpha: number, lut: Float32Array, rippleStrength?: number }} frame
 *   alpha = 색 감소 평활화 계수, rippleStrength = 바닥 물결 배율 (0 = 평평)
 * @returns {{ colored: boolean }}
 */
export function updateSurface(surface, waves, unit, frame) {
  const { geometry, isWall, smoothed } = surface;
  const P = HEATMAP_PARAMS;
  const tau = WAVE_PARAMS.displayTimeConstant;

  const groups = new Map();
  for (const w of waves) {
    const peak = w.peaks[unit.index];
    if (!(peak > 1)) continue;
    const path = getPathCache(surface, w, unit);
    if (w.radius < path.dMin) continue;
    let bySpeed = groups.get(path);
    if (!bySpeed) groups.set(path, (bySpeed = new Map()));
    let g = bySpeed.get(w.speed);
    if (!g) {
      g = {
        path,
        speed: w.speed,
        waves: [],
        ripple: w.unit === unit && !isWall && w.onFloor !== false,
      };
      bySpeed.set(w.speed, g);
    }
    // 감쇠 시작 = 파면 테두리가 다 지난 시각 (그때 색 = peak)
    const fullAt =
      (path.dMin + P.edgeWidth - WAVE_PARAMS.initialRadius) / w.speed;
    g.waves.push({
      w,
      coef: peak * Math.exp(-(w.time - fullAt) / tau) * w.fade,
      ramp: peak * w.fade,
      radius: w.radius,
    });
  }

  if (groups.size === 0 && surface.idle) return { colored: false };

  const groupList = [...groups.values()].flatMap((m) => [...m.values()]);
  for (const g of groupList) {
    g.waves.sort((a, b) => b.radius - a.radius);
    const n = g.waves.length;
    g.radii = new Float32Array(n);
    g.prefix = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) {
      g.radii[k] = g.waves[k].radius;
      g.prefix[k + 1] = g.prefix[k] + g.waves[k].coef;
    }
    g.delay = delayFactors(g.path, g.speed, tau);
  }

  const posAttr = geometry.attributes.position;
  // PlaneGeometry 로컬 z = 면 법선
  const posArr = posAttr.array;
  const colorAttr = geometry.attributes.color;
  const colorArr = colorAttr.array;
  const count = posAttr.count;
  const { alpha, lut } = frame;
  const rippleScale = P.rippleAmplitude * (frame.rippleStrength ?? 1);
  const edgeWidth = P.edgeWidth;

  let colored = false;
  let displaced = false;

  for (let i = 0; i < count; i++) {
    let energy = 0;
    let displacement = 0;

    for (const g of groupList) {
      const dist = g.path.dist[i];
      const k = countAtLeast(g.radii, dist);
      if (k === 0) continue;
      const m = countAtLeast(g.radii, dist + edgeWidth);
      energy += g.prefix[m] * g.delay[i];
      for (let j = m; j < k; j++)
        energy += (g.waves[j].ramp * (g.radii[j] - dist)) / edgeWidth;

      if (g.ripple && rippleScale > 0) {
        const spread = g.path.spreading[i];
        for (let j = 0; j < k; j++) {
          const { w } = g.waves[j];
          const dB = w.sourceLevel - spread;
          if (dB <= 0) continue;
          const shape =
            Math.cos(
              dist * P.rippleWaveNumber - w.time * P.rippleAngularSpeed,
            ) * Math.exp(-w.time * P.rippleDecay);
          displacement += shape * (dB / P.rippleDbScale) * w.fade;
        }
      }
    }

    if (!isWall) {
      const z = Math.max(0, displacement * rippleScale);
      if (z !== posArr[i * 3 + 2]) {
        posArr[i * 3 + 2] = z;
        displaced = true;
      }
    }

    const target = energy > 1 ? 10 * Math.log10(energy) : 0;
    if (target >= smoothed[i]) smoothed[i] = target;
    else smoothed[i] += (target - smoothed[i]) * alpha;
    if (smoothed[i] < 0.5 && target <= 0) smoothed[i] = 0;
    if (smoothed[i] > 0) colored = true;

    const o = lutOffset(smoothed[i]);
    colorArr[i * 4] = lut[o];
    colorArr[i * 4 + 1] = lut[o + 1];
    colorArr[i * 4 + 2] = lut[o + 2];
    colorArr[i * 4 + 3] = lut[o + 3];
  }

  colorAttr.needsUpdate = true;
  if (displaced) {
    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  surface.idle = groups.size === 0 && !colored;
  return { colored };
}

/** 색, 변위, 캐시 초기화 */
export function resetSurface(surface) {
  surface.smoothed.fill(0);
  surface.idle = true;
  surface.pathCache.clear();

  const { geometry, isWall } = surface;
  geometry.attributes.color.array.fill(0);
  geometry.attributes.color.needsUpdate = true;
  if (!isWall) {
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.array[i * 3 + 2] = 0;
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }
}
