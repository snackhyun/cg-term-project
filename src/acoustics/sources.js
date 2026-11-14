/**
 * 충격원 대역별 충격력 노출레벨 L_FE (dB re 1 N²·s, 충격 1회)
 * @see docs/acoustics-references.md 9절
 */
import { BANDS, octaveBandwidth } from './bands.js';

/**
 * 태핑머신 (해머 질량, 타격속도, 타격 횟수)
 * @see RION FI-01A 카탈로그, ISO 10140-5 (✅, 해머 질량 0.5 kg은 ⚠️)
 */
export const TAPPING_MACHINE = Object.freeze({
  hammerMass: 0.5,
  impactSpeed: 0.885,
  rate: 10,
});

/** 길게 누르기 파동 간격 = 태핑머신 타격 간격 1/10 s */
export const HOLD_EMIT_INTERVAL = 1 / TAPPING_MACHINE.rate;

/**
 * 뱅머신 L_FE, 63–500 Hz
 * @see JIS A 1418-2:2019 (RION FI-02 카탈로그, ✅)
 */
export const BANG_MACHINE_LFE = Object.freeze({
  63: 40.0,
  125: 22.0,
  250: 11.5,
  500: 5.5,
});

/**
 * 임팩트볼(고무공 2.5 kg, 1 m 낙하) L_FE, 63–500 Hz
 * @see ISO 10140-5 / JIS A 1418-2 (제조사 데이터시트 검색 요약, ⚠️)
 */
export const IMPACT_BALL_LFE = Object.freeze({
  63: 31.0,
  125: 23.0,
  250: 17.0,
  500: 12.5,
});

/**
 * 짧은 단단한 충격 1회의 대역 노출레벨 10·lg(2·I²·Δf), I = m·v
 * @see 참고문서 9b 유도식 (주기 충격열 2·I²·f_r에서 1회분, 강성 바닥 가정)
 */
export function impulseForceExposure(f, impulse) {
  return 10 * Math.log10(2 * impulse * impulse * octaveBandwidth(f));
}

/**
 * 태핑머신 연속 가진의 대역 힘 레벨 L_F,tap = 10·lg(2·I²·f_r·Δf) (dB re 1 N)
 * 63/125/250/500 Hz: 22.4/25.4/28.4/31.4 dB
 * @see 참고문서 9b (유도식, 문헌 대조 안 함)
 */
export function tappingForceLevel(f, tm = TAPPING_MACHINE) {
  const I = tm.hammerMass * tm.impactSpeed;
  return impulseForceExposure(f, I) + 10 * Math.log10(tm.rate);
}

/**
 * 단단한 물체 충격 가정값 (질량 kg, 속도 m/s). 출처 없음, 모델 가정
 * hammer: 망치 머리 0.5 kg × 3 m/s, drop: 1 kg을 0.75 m(탁자 높이)에서 낙하
 */
export const IMPULSE_ASSUMPTIONS = Object.freeze({
  hammer: Object.freeze({ mass: 0.5, speed: 3.0 }),
  drop: Object.freeze({ mass: 1.0, speed: Math.sqrt(2 * 9.81 * 0.75) }),
});

function tableSpectrum(table) {
  return Object.freeze(BANDS.map((f) => table[f] ?? -Infinity));
}

function impulseSpectrum(impulse) {
  return Object.freeze(BANDS.map((f) => impulseForceExposure(f, impulse)));
}

const TAP_IMPULSE = TAPPING_MACHINE.hammerMass * TAPPING_MACHINE.impactSpeed;

/**
 * 충격 유형별 음원. forceExposure는 BANDS 순서, 자료 없는 대역은 -Infinity
 * 대응 관계(아이 한 걸음 = 고무공 1회 등)는 가정. 스펙트럼 형태 근거는 Sato, Lee, Jeon 2007 상관분석
 */
const SOURCES = Object.freeze({
  click: {
    label: '클릭 (태핑머신 해머 1회)',
    basis: 'tapping',
    impulse: TAP_IMPULSE,
  },
  hold: {
    label: '길게 누르기 (태핑머신, 10회/초)',
    basis: 'tapping',
    impulse: TAP_IMPULSE,
  },
  walk: {
    label: '걷기 (구두, 태핑머신 해머 1회)',
    basis: 'tapping',
    impulse: TAP_IMPULSE,
  },
  run: {
    label: '아이 뛰기 (고무공 1회)',
    basis: 'impactBall',
    table: IMPACT_BALL_LFE,
  },
  jump: {
    label: '아이 점프 (뱅머신 1회)',
    basis: 'bangMachine',
    table: BANG_MACHINE_LFE,
  },
  hammer: {
    label: '망치질 (0.5 kg × 3 m/s 충격, 가정)',
    basis: 'impulse',
    impulse: IMPULSE_ASSUMPTIONS.hammer.mass * IMPULSE_ASSUMPTIONS.hammer.speed,
  },
  drop: {
    label: '물건 떨어뜨림 (1 kg, 0.75 m, 가정)',
    basis: 'impulse',
    impulse: IMPULSE_ASSUMPTIONS.drop.mass * IMPULSE_ASSUMPTIONS.drop.speed,
  },
});

/** 지원 충격 유형 */
export const SOURCE_TYPES = Object.freeze(Object.keys(SOURCES));

const CACHE = new Map();

/**
 * 충격 1회 음원 (불변 객체). addImpact(point, unit, source)에 그대로 전달
 * 이름은 하위 호환용, 반환값은 dB 숫자가 아닌 대역 스펙트럼
 * @param {'click'|'hold'|'walk'|'run'|'jump'|'hammer'|'drop'} type
 * @param {{ holdTime?: number, impactSpeed?: number }} [opts]
 *   holdTime: 하위 호환용, 무시 (태핑머신은 일정 세기)
 *   impactSpeed: hammer·drop 충돌 속도 (m/s). 충격량 = 질량 × 속도, 기준(drop 0.75 m 낙하 3.84 m/s,
 *   hammer 3 m/s) 대비 20·lg(v/v_ref) dB. 튕기는 물체의 바운드마다 작아짐. 없으면 기준값
 * @returns {{ type: string, label: string, basis: string, forceExposure: readonly number[] }}
 */
export function sourceLevelDb(type, opts = {}) {
  const def = SOURCES[type];
  if (!def) throw new Error(`알 수 없는 충격 유형: ${type}`);
  const v = opts?.impactSpeed;
  if (def.basis === 'impulse' && Number.isFinite(v) && v > 0) {
    // 충격량 ∝ 속도 → 기준 대비 20·lg(v/v_ref) dB
    const { mass } = IMPULSE_ASSUMPTIONS[type];
    return Object.freeze({
      type,
      label: `${def.label}, ${v.toFixed(2)} m/s`,
      basis: def.basis,
      forceExposure: impulseSpectrum(mass * v),
    });
  }
  let source = CACHE.get(type);
  if (!source) {
    source = Object.freeze({
      type,
      label: def.label,
      basis: def.basis,
      forceExposure: def.table
        ? tableSpectrum(def.table)
        : impulseSpectrum(def.impulse),
    });
    CACHE.set(type, source);
  }
  return source;
}

/** addImpact에 넘어온 값이 음원 객체인지 */
export function isImpactSource(value) {
  return !!value && Array.isArray(value.forceExposure);
}
