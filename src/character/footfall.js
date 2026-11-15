/**
 * 발 높이 기반 착지 감지 (히스테리시스)
 * liftHeight 위로 뜨면 준비(arm), 이후 contactHeight 아래로 내려온 프레임에 착지 1회
 * 두 문턱 사이 흔들림은 무시 → 불규칙한 프레임 간격에도 한 걸음에 한 번
 */

/**
 * 기본 문턱
 * liftHeight: 준비 높이(m), contactHeight: 착지 높이(m), minInterval: 같은 발 연속 착지 최소 간격(초)
 */
export const FOOTFALL_DEFAULTS = Object.freeze({
  liftHeight: 0.03,
  contactHeight: 0.01,
  minInterval: 0.1,
});

/** 발 여러 개의 착지 감지기 */
export class FootfallDetector {
  /**
   * @param {number} footCount
   * @param {Partial<typeof FOOTFALL_DEFAULTS>} [options]
   */
  constructor(footCount, options = {}) {
    this.options = { ...FOOTFALL_DEFAULTS, ...options };
    this.feet = Array.from({ length: footCount }, () => ({
      armed: false,
      height: null,
      lastContact: -Infinity,
    }));
  }

  /**
   * 현재 높이로 상태 재설정 (순간이동 등 높이 불연속)
   * 바닥에 닿은 발은 한 번 떠야 다음 착지
   */
  reset(heights = null) {
    this.feet.forEach((foot, i) => {
      const h = heights ? heights[i] : null;
      foot.height = h;
      foot.armed = h !== null && h > this.options.liftHeight;
    });
  }

  /**
   * @param {number} time 누적 시간(초)
   * @param {number[]} heights 발마다 바닥 위 높이(m)
   * @returns {{ foot: number, fraction: number }[]} 이번 프레임 착지 발
   *   fraction: 이전(0)~이번(1) 프레임 사이 문턱 통과 비율
   */
  update(time, heights) {
    const { liftHeight, contactHeight, minInterval } = this.options;
    const events = [];

    heights.forEach((h, i) => {
      const foot = this.feet[i];
      const prev = foot.height;
      foot.height = h;

      if (h > liftHeight) {
        foot.armed = true;
        return;
      }
      if (!foot.armed || h > contactHeight) return;

      foot.armed = false;
      if (time - foot.lastContact < minInterval) return;
      foot.lastContact = time;

      let fraction = 1;
      if (prev !== null && prev > h) {
        fraction = Math.min(
          1,
          Math.max(0, (prev - contactHeight) / (prev - h)),
        );
      }
      events.push({ foot: i, fraction });
    });

    return events;
  }
}
