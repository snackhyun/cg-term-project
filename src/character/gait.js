/**
 * 무릎 없는 다리(Kenney Mini Characters)의 걷기·뛰기·점프 다리·루트 동작
 * 원본 walk/sprint: 두 발 대칭 가위 동작이라 한 발씩 딛는 순간 없음 → 다리·루트만 생성, 팔·머리는 원본
 * 길이: 모델 단위(스케일 전), 각도: 라디안
 * 다리 각도 θ: x축 회전, θ < 0이면 발이 앞(+z)
 */

/** 다리 피벗(엉덩이) 기준 발바닥 치수 (모델 정점 실측) */
export const LEG = Object.freeze({
  length: 0.17625,
  heelZ: -0.102,
  toeZ: 0.131,
});

/**
 * 걷기 파라미터
 * period: 원본 walk 길이, duty: 한 발 지지 비율(> 0.5면 양발 지지 구간), reach: 엉덩이 기준 발 앞뒤 거리
 */
export const WALK = Object.freeze({
  period: 2 / 3,
  duty: 0.52,
  reach: 0.055,
  lift: 0.04,
  flightApex: 0,
});

/** 뛰기 파라미터. duty < 0.5 → 두 발 모두 뜨는 구간 */
export const RUN = Object.freeze({
  period: 0.5,
  duty: 0.34,
  reach: 0.07,
  lift: 0.07,
  flightApex: 0.012,
});

function frac(x) {
  return x - Math.floor(x);
}

function smoothstep(u) {
  return u * u * (3 - 2 * u);
}

/** 발 앞뒤 위치(엉덩이 기준) → 다리 각도 */
export function legAngle(forward) {
  return -Math.asin(Math.max(-1, Math.min(1, forward / LEG.length)));
}

/**
 * 발 최저점(뒤꿈치 또는 발끝) 높이, 루트 기준 (루트 이동·스케일 제외)
 * @param {number} theta 다리 각도
 * @param {number} [lift] 다리 들림
 */
export function footLowestY(theta, lift = 0) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const heel = -LEG.length * c - LEG.heelZ * s;
  const toe = -LEG.length * c - LEG.toeZ * s;
  return LEG.length + lift + Math.min(heel, toe);
}

/** 다리 위상(0~1) → 발 앞뒤 위치, 들림, 지지 여부. 위상 0: 뒤꿈치 착지 */
export function legState(params, phase) {
  const { duty, reach, lift } = params;
  if (phase < duty) {
    const u = phase / duty;
    return { forward: reach * (1 - 2 * u), lift: 0, stance: true };
  }
  const u = (phase - duty) / (1 - duty);
  return {
    forward: reach * (2 * smoothstep(u) - 1),
    lift: lift * Math.sin(Math.PI * u),
    stance: false,
  };
}

/** 어느 발도 바닥을 뚫지 않는 최저 루트 높이 (가장 낮은 발이 바닥에 닿음) */
function groundHeight(legs) {
  let y = -Infinity;
  for (const leg of legs) {
    y = Math.max(y, -footLowestY(legAngle(leg.forward), leg.lift));
  }
  return y;
}

/**
 * 클립 시간 t의 자세. t = 0: 왼발 지지 중간 (원본 팔 흔들기와 같은 위상)
 * @returns {{ rootY, legs: [{ theta, lift, stance }] }}  legs[0] 왼쪽, legs[1] 오른쪽
 */
export function gaitPose(params, t) {
  const phaseL = frac(t / params.period + params.duty / 2);
  const phases = [phaseL, frac(phaseL + 0.5)];
  const legs = phases.map((p) => legState(params, p));

  let rootY = groundHeight(legs);
  if (!legs[0].stance && !legs[1].stance) {
    // 체공: 이륙·착지 높이를 잇는 포물선
    const { duty, reach, flightApex } = params;
    const p = phaseL < 0.5 ? phaseL : phaseL - 0.5;
    const u = (p - duty) / (0.5 - duty);
    const y0 = -footLowestY(legAngle(-reach), 0);
    const y1 = -footLowestY(legAngle(reach), 0);
    rootY = Math.max(rootY, y0 + (y1 - y0) * u + 4 * flightApex * u * (1 - u));
  }

  return {
    rootY,
    legs: legs.map((leg) => ({
      theta: legAngle(leg.forward),
      lift: leg.lift,
      stance: leg.stance,
    })),
  };
}

/** 발 미끄러짐 없는 몸통 속도 (모델 단위/초, timeScale 1) */
export function gaitSpeed(params) {
  return (2 * params.reach) / (params.duty * params.period);
}

/** 자세의 발 최저점 높이 (테스트·디버그용) */
export function poseFootHeights(pose) {
  return pose.legs.map((leg) => pose.rootY + footLowestY(leg.theta, leg.lift));
}

/**
 * 제자리 점프 파라미터
 * crouch·flight·land: 웅크리기·체공·착지 회복 시간(초), apex: 최고 높이(약 0.3m), tuck: 체공 중 다리 벌림 각도
 */
export const JUMP = Object.freeze({
  crouch: 0.2,
  flight: 0.5,
  land: 0.3,
  apex: 0.19,
  tuck: 0.35,
  tuckLift: 0.03,
});

/** 점프 1회 길이 (초) */
export function jumpDuration(params = JUMP) {
  return params.crouch + params.flight + params.land;
}

/**
 * 제자리 점프 1회 자세. 웅크리기·착지 때 루트 스케일로 눌림 표현
 * @returns {{ rootY, squash, legs: [{ theta, lift, stance }] }}
 */
export function jumpPose(t, params = JUMP) {
  const { crouch, flight, land, apex, tuck, tuckLift } = params;
  const airborne = t > crouch && t < crouch + flight;
  let rootY = 0;
  let squash = 1;
  let spread = 0;

  if (t <= crouch) {
    squash = 1 - 0.18 * Math.sin(Math.PI * (t / crouch));
  } else if (airborne) {
    const u = (t - crouch) / flight;
    rootY = 4 * apex * u * (1 - u);
    squash = 1 + 0.08 * Math.sin(Math.PI * u);
    spread = Math.sin(Math.PI * u);
  } else {
    const u = Math.min(1, (t - crouch - flight) / land);
    squash = 1 - 0.2 * Math.sin(Math.PI * u) * (1 - u * 0.3);
  }

  const theta = tuck * spread;
  const lift = tuckLift * spread;
  return {
    rootY,
    squash,
    legs: [
      { theta: -theta, lift, stance: !airborne },
      { theta, lift, stance: !airborne },
    ],
  };
}

/** 샘플링 시각 목록 (기본 30fps) */
export function sampleTimes(duration, fps = 30) {
  const n = Math.max(2, Math.round(duration * fps));
  return Array.from({ length: n + 1 }, (_, i) => (duration * i) / n);
}
