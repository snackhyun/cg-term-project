/**
 * 건물 전체 대역별 전달 모델
 * 음원 L_FE → 슬래브 L_n − L_F,tap → 뜬바닥 −ΔL → 접합부 경로 → 수음실 보정 → 보정상수
 * @see docs/acoustics-references.md 10절, 부록 "공식 → 코드 → 테스트"
 */
import { A_WEIGHTING, BANDS, toDb, toEnergy } from './bands.js';
import { CALIBRATION_DB } from './calibration.js';
import {
  floatingFloorImprovement,
  floatingFloorResonance,
} from './floatingFloor.js';
import {
  absorptionLength,
  kijCrossCorner,
  kijCrossStraight,
  massRatioExponent,
  velocityLevelDifference,
} from './junction.js';
import { roomCorrectionDb } from './room.js';
import {
  criticalFrequency,
  normalizedImpactLevel,
  radiationFactorOctave,
  structuralReverbTime,
  surfaceDensity,
} from './slab.js';
import { tappingForceLevel } from './sources.js';
import {
  bandResponseTerms,
  createResponseTable,
  singleImpactFastMax,
} from './timeWeighting.js';

/**
 * 구조 요소와 접합부
 * 요소: 슬래브 구획(세대 바닥 W×D), 세대 간 벽(D×H), 뒤쪽 외벽(W×H)
 * 접합부: 슬래브–벽 선 접합만 (벽–벽 수직 모서리 접합 생략)
 */
export function buildStructure(b) {
  const { floors, unitsPerFloor: n, width: W, depth: D, height: H } = b;
  const elements = [];
  const add = (e) => (elements.push(e), elements.length - 1);

  const slab = [];
  for (let k = 0; k <= floors; k++) {
    slab.push([]);
    for (let c = 0; c < n; c++) {
      slab[k].push(
        add({ kind: 'slab', k, c, area: W * D, thickness: b.slabThickness }),
      );
    }
  }
  const party = [];
  const back = [];
  for (let f = 0; f < floors; f++) {
    party.push([]);
    back.push([]);
    for (let j = 0; j <= n; j++) {
      party[f].push(
        add({
          kind: 'partyWall',
          f,
          j,
          area: D * H,
          thickness: b.wallThickness,
        }),
      );
    }
    for (let c = 0; c < n; c++) {
      back[f].push(
        add({
          kind: 'backWall',
          f,
          c,
          area: W * H,
          thickness: b.wallThickness,
        }),
      );
    }
  }

  const junctions = [];
  const link = (i, j, path, length, perpThickness) => {
    if (i === undefined || j === undefined) return;
    junctions.push({ i, j, path, length, perpThickness });
  };

  for (let k = 0; k <= floors; k++) {
    for (let j = 0; j <= n; j++) {
      const slabs = [slab[k][j - 1], slab[k][j]].filter((e) => e !== undefined);
      const walls = [party[k]?.[j], party[k - 1]?.[j]].filter(
        (e) => e !== undefined,
      );
      if (slabs.length === 2)
        link(slabs[0], slabs[1], 'straight', D, b.wallThickness);
      if (walls.length === 2)
        link(walls[0], walls[1], 'straight', D, b.slabThickness);
      for (const s of slabs)
        for (const w of walls) link(s, w, 'corner', D, b.wallThickness);
    }
    for (let c = 0; c < n; c++) {
      const s = slab[k][c];
      const walls = [back[k]?.[c], back[k - 1]?.[c]].filter(
        (e) => e !== undefined,
      );
      if (walls.length === 2)
        link(walls[0], walls[1], 'straight', W, b.slabThickness);
      for (const w of walls) link(s, w, 'corner', W, b.wallThickness);
    }
  }

  const rooms = [];
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < n; c++) {
      rooms.push({
        floorSlab: slab[f][c],
        walls: [back[f][c], party[f][c], party[f][c + 1]],
        elements: [
          slab[f][c],
          slab[f + 1][c],
          party[f][c],
          party[f][c + 1],
          back[f][c],
        ],
        volume: W * D * H,
      });
    }
  }
  return { elements, junctions, rooms };
}

/**
 * 접합부 K_ij. 십자형 식 (T형·L형도 대용)
 * M = lg(m′⊥i/m′i). 직진: ⊥ = 접합부의 다른 종류 요소, 꺾임: ⊥ = j
 */
function junctionK(path, mi, mPerp) {
  const M = massRatioExponent(mPerp, mi);
  return path === 'corner' ? kijCrossCorner(M) : kijCrossStraight(M);
}

/** 단순 다익스트라. 가중치 = 대역 b의 D_v */
function shortestDv(nElements, adjacency, start, b) {
  const dist = new Float64Array(nElements).fill(Infinity);
  const done = new Uint8Array(nElements);
  dist[start] = 0;
  for (let iter = 0; iter < nElements; iter++) {
    let u = -1;
    for (let v = 0; v < nElements; v++) {
      if (!done[v] && (u < 0 || dist[v] < dist[u])) u = v;
    }
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = 1;
    for (const { to, dv } of adjacency[u]) {
      const d = dist[u] + dv[b];
      if (d < dist[to]) dist[to] = d;
    }
  }
  return dist;
}

/**
 * 건물·음향 파라미터로 전달 모델 생성
 * @param {object} building config.building (정리된 값)
 * @param {{ density, lossFactor, floatingFloor, dynamicStiffness, screedMass, reverbTime }} params
 */
export function createAcousticModel(building, params) {
  const { density, lossFactor: eta, reverbTime } = params;
  const structure = buildStructure(building);
  const { elements, junctions, rooms } = structure;
  const nb = BANDS.length;

  for (const e of elements) {
    e.mPrime = surfaceDensity(density, e.thickness);
    e.fc = criticalFrequency(e.thickness);
    e.sigma = BANDS.map((f) => radiationFactorOctave(f, e.fc));
    e.absorption = BANDS.map((f) =>
      absorptionLength(e.area, structuralReverbTime(f, eta), f),
    );
  }

  const adjacency = elements.map(() => []);
  for (const jn of junctions) {
    const ei = elements[jn.i];
    const ej = elements[jn.j];
    const mPerp = surfaceDensity(density, jn.perpThickness);
    const dvFor = (a, c) => {
      const K = junctionK(
        jn.path,
        a.mPrime,
        jn.path === 'corner' ? c.mPrime : mPerp,
      );
      return BANDS.map((_, b) =>
        Math.max(
          0,
          velocityLevelDifference(
            K,
            jn.length,
            a.absorption[b],
            c.absorption[b],
          ),
        ),
      );
    };
    adjacency[jn.i].push({ to: jn.j, dv: dvFor(ei, ej) });
    adjacency[jn.j].push({ to: jn.i, dv: dvFor(ej, ei) });
  }

  const slabMass = surfaceDensity(density, building.slabThickness);
  const slabFc = criticalFrequency(building.slabThickness);
  const slabSigma = BANDS.map((f) => radiationFactorOctave(f, slabFc));
  /** 맨 슬래브 L_n (옥타브 평균 σ) */
  const Ln = BANDS.map((f, b) =>
    normalizedImpactLevel(f, slabMass, eta, slabSigma[b]),
  );
  const LFtap = BANDS.map((f) => tappingForceLevel(f));

  const f0 = params.floatingFloor
    ? floatingFloorResonance(params.dynamicStiffness, params.screedMass)
    : null;
  const floatingFloorDb = BANDS.map((f) =>
    f0 === null ? 0 : floatingFloorImprovement(f, f0),
  );

  const roomCorrection = rooms.map((r) =>
    roomCorrectionDb(r.volume, reverbTime),
  );
  const responseTerms = bandResponseTerms(eta, reverbTime);
  const responseTable = createResponseTable(responseTerms);

  const pathCache = new Map();

  /** 가진 요소 id. wall: null 바닥, 0 뒤, 1 좌, 2 우 (unit.walls 순서) */
  function excitedElement(srcIndex, wall) {
    const room = rooms[srcIndex];
    return wall === null || wall === undefined
      ? room.floorSlab
      : room.walls[wall];
  }

  const LnCache = new Map();

  /**
   * 가진 요소의 L_n. 벽 가진도 같은 평판식 (부속서 B는 바닥용, 벽 적용은 확장 가정)
   */
  function excitedLn(id) {
    let v = LnCache.get(id);
    if (!v) {
      const el = elements[id];
      v = BANDS.map((f, b) =>
        normalizedImpactLevel(f, el.mPrime, eta, el.sigma[b]),
      );
      LnCache.set(id, v);
    }
    return v;
  }

  /**
   * 가진 요소 기준 세대별 상대 레벨 10·lg Σ_e (σ_e·S_e)/(σ_i·S_i)·10^(−ΔV_e/10)
   * ΔV_e = 가장 덜 줄어드는 접합부 경로의 D_v 합. 음원 세대 자신은 직접 방사(0 dB)
   * @param {number|null} [wall] null 바닥, 0 뒤, 1 좌, 2 우
   */
  function relativeLevels(srcIndex, wall = null) {
    const key = `${srcIndex}:${wall}`;
    let rel = pathCache.get(key);
    if (rel) return rel;
    const start = excitedElement(srcIndex, wall);
    const src = elements[start];
    const dvByBand = BANDS.map((_, b) =>
      shortestDv(elements.length, adjacency, start, b),
    );
    rel = rooms.map((room, r) => {
      if (r === srcIndex) return new Float64Array(nb);
      const out = new Float64Array(nb);
      for (let b = 0; b < nb; b++) {
        let e = 0;
        for (const id of room.elements) {
          const el = elements[id];
          const dv = dvByBand[b][id];
          if (dv === Infinity) continue;
          e +=
            ((el.sigma[b] * el.area) / (src.sigma[b] * src.area)) *
            toEnergy(-dv);
        }
        out[b] = toDb(e);
      }
      return out;
    });
    pathCache.set(key, rel);
    return rel;
  }

  /** 대역 전달량 (dB): L_E,rx = L_FE + 이 값 (− ΔL은 바닥 가진만) */
  function transferDb(srcIndex, dstIndex, wall = null) {
    const rel = relativeLevels(srcIndex, wall)[dstIndex];
    const LnSrc = excitedLn(excitedElement(srcIndex, wall));
    return BANDS.map(
      (_, b) =>
        LnSrc[b] -
        LFtap[b] +
        rel[b] -
        roomCorrection[dstIndex] +
        CALIBRATION_DB,
    );
  }

  /**
   * 충격 1회의 세대별 수음 결과
   * @returns {{ bands: Float64Array, weights: Float64Array, exposureA: number, fastMaxA: number }[]}
   *   bands: 대역 노출레벨 L_E (dB re p0²·s), weights: A가중 노출 에너지,
   *   exposureA: Σweights (L_AE 에너지), fastMaxA: 단발 L_AFmax 에너지
   * @param {number|null} [wall] 벽을 친 경우 0 뒤, 1 좌, 2 우. 뜬바닥 저감 없음
   */
  function impactLevels(source, srcIndex, wall = null) {
    const onFloor = wall === null || wall === undefined;
    return rooms.map((_, dst) => {
      const T = transferDb(srcIndex, dst, wall);
      const bands = new Float64Array(nb);
      const weights = new Float64Array(nb);
      let exposureA = 0;
      for (let b = 0; b < nb; b++) {
        bands[b] =
          source.forceExposure[b] + T[b] - (onFloor ? floatingFloorDb[b] : 0);
        weights[b] = toEnergy(bands[b] + A_WEIGHTING[b]);
        exposureA += weights[b];
      }
      return {
        bands,
        weights,
        exposureA,
        fastMaxA: singleImpactFastMax(weights, responseTable),
      };
    });
  }

  return {
    params: { ...params },
    building: { ...building },
    structure,
    slab: { mPrime: slabMass, fc: slabFc, sigma: slabSigma, Ln },
    tappingForceLevel: LFtap,
    floatingFloorResonance: f0,
    floatingFloorDb,
    roomCorrection,
    responseTerms,
    responseTable,
    relativeLevels,
    transferDb,
    impactLevels,
  };
}
