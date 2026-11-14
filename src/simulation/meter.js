/**
 * 세대별 소음계: A가중 Leq(구간 에너지 평균), L_AF(Fast), L_max, L_max 초과 횟수
 * 충격 도달 시각에 대역별 노출 에너지를 받아 1차계 3단 응답(acoustics/timeWeighting)을 정확히 적분
 */
import { LMAX_RULE, toDb, toEnergy } from '../acoustics/index.js';

/** 적분 간격 (s) */
export const METER_SUBSTEP = 0.002;

/** 이보다 작은 상태 에너지는 0으로 (−60 dB) */
const SILENT_ENERGY = 1e-6;

/**
 * 구간 Leq = 10·lg(Σ E_A,i / T_w). 구간 시작 전 무음 가정, 분모는 항상 T_w
 * @param {{ t: number, energyA: number }[]} exposures 도달 시각순
 */
export function rollingLeq(exposures, now, windowSeconds) {
  let e = 0;
  for (const x of exposures)
    if (x.t > now - windowSeconds && x.t <= now) e += x.energyA;
  return toDb(e / windowSeconds);
}

/** 세대 1개 소음계 */
export class LevelMeter {
  /**
   * @param {{ tau: number, coef: number }[][]} terms 대역별 응답 항 (bandResponseTerms)
   */
  constructor(terms) {
    this.terms = terms;
    const n = terms.reduce((s, b) => s + b.length, 0);
    this.state = new Float64Array(n);
    this.coef = new Float64Array(n);
    this.tau = new Float64Array(n);
    this.band = new Uint8Array(n);
    let i = 0;
    terms.forEach((band, b) => {
      for (const { tau, coef } of band) {
        this.tau[i] = tau;
        this.coef[i] = coef;
        this.band[i] = b;
        i++;
      }
    });
    this.stepDecay = this.tau.map((t) => Math.exp(-METER_SUBSTEP / t));
    this.reset(0);
  }

  /** 측정값 초기화 */
  reset(now) {
    this.state.fill(0);
    this.t = now;
    this.lastArrival = -Infinity;
    this.exposures = [];
    this.leqMax = -Infinity;
    this.lmax = -Infinity;
    this.laf = -Infinity;
    this.exceedances = [];
    this.above = false;
  }

  /**
   * now까지 적분, L_max·초과 횟수 갱신
   * @param {number} limitEnergy L_max 기준 에너지 10^(L/10)
   */
  advance(now, limitEnergy) {
    while (this.t < now) {
      let total = 0;
      for (let i = 0; i < this.state.length; i++)
        total += Math.abs(this.state[i]);
      if (total < SILENT_ENERGY) {
        this.state.fill(0);
        this.t = now;
        this.laf = -Infinity;
        this.above = false;
        return;
      }
      const dt = Math.min(METER_SUBSTEP, now - this.t);
      let y = 0;
      for (let i = 0; i < this.state.length; i++) {
        this.state[i] *=
          dt === METER_SUBSTEP
            ? this.stepDecay[i]
            : Math.exp(-dt / this.tau[i]);
        y += this.state[i];
      }
      this.t += dt;
      this.observe(Math.max(y, 0), limitEnergy);
    }
  }

  /** 순간 L_AF 기록 */
  observe(y, limitEnergy) {
    const L = toDb(y);
    this.laf = L;
    if (L > this.lmax) this.lmax = L;
    const above = y >= limitEnergy;
    if (above && !this.above) this.exceedances.push(this.t);
    this.above = above;
  }

  /**
   * 충격 도달
   * @param {Float64Array} weights 대역별 A가중 노출 에너지
   * @param {Float64Array} bands 대역 노출레벨 L_E (dB, A보정 전)
   */
  arrive(t, weights, bands, windowSeconds, limitEnergy) {
    this.advance(t, limitEnergy);
    let energyA = 0;
    for (let i = 0; i < this.state.length; i++) {
      this.state[i] += weights[this.band[i]] * this.coef[i];
    }
    for (let b = 0; b < weights.length; b++) energyA += weights[b];
    const bandEnergy = Float64Array.from(bands, toEnergy);
    this.exposures.push({ t, energyA, bandEnergy });
    this.lastArrival = t;
    this.prune(t, windowSeconds);
    const leq = rollingLeq(this.exposures, t, windowSeconds);
    if (leq > this.leqMax) this.leqMax = leq;
  }

  /** 구간 밖 노출, 1시간 지난 초과 기록 삭제 */
  prune(now, windowSeconds) {
    while (
      this.exposures.length &&
      this.exposures[0].t <= now - windowSeconds
    ) {
      this.exposures.shift();
    }
    while (
      this.exceedances.length &&
      this.exceedances[0] <= now - LMAX_RULE.periodSeconds
    ) {
      this.exceedances.shift();
    }
  }

  /** 현재 구간 Leq dB(A) */
  leq(now, windowSeconds) {
    return rollingLeq(this.exposures, now, windowSeconds);
  }

  /** 현재 구간 대역별 Leq (dB, A보정 전) */
  bandLeq(now, windowSeconds) {
    const nb = this.terms.length;
    const e = new Float64Array(nb);
    for (const x of this.exposures) {
      if (x.t <= now - windowSeconds || x.t > now) continue;
      for (let b = 0; b < nb; b++) e[b] += x.bandEnergy[b];
    }
    return Array.from(e, (v) => toDb(v / windowSeconds));
  }

  /** 최근 1시간 L_max 초과 횟수 */
  exceedanceCount(now) {
    let n = 0;
    for (const t of this.exceedances)
      if (t > now - LMAX_RULE.periodSeconds) n++;
    return n;
  }
}
