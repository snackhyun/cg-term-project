/**
 * 측정 패널 HTML (SimulationManager.getMeasurement() 스냅숏 → 문자열)
 */
import { judgeUnit } from '../acoustics/index.js';

/** 레벨 막대 눈금 상한 (dB) */
const LEVEL_SCALE = 80;

const STATUS = {
  source: { className: 'is-source', text: '발생' },
  quiet: { className: 'is-quiet', text: '조용' },
  under: { className: 'is-under', text: '기준 이하' },
};

/** dB 표시. 무음은 – */
function fmt(dB) {
  return Number.isFinite(dB) && dB > 0 ? dB.toFixed(1) : '–';
}

/** 레벨 막대 위치 (%) */
function percent(dB) {
  if (!Number.isFinite(dB) || dB <= 0) return 0;
  return Math.min(100, (dB / LEVEL_SCALE) * 100);
}

/** 판정 상태와 초과 사유 */
function statusFor(u, limits) {
  const j = judgeUnit(u, limits);
  if (j.status !== 'over') return STATUS[j.status] ?? STATUS.quiet;
  const why = j.leqOver && j.lmaxOver ? 'Leq·Lmax' : j.leqOver ? 'Leq' : 'Lmax';
  return { className: 'is-over', text: `${why} 초과` };
}

/** 세대 1줄 */
function unitRow(u, m) {
  const status = statusFor(u, m.limits);
  const peakLeq =
    Number.isFinite(u.leqMax) && u.leqMax - u.leq > 0.05
      ? `<small>최고 ${fmt(u.leqMax)}</small>`
      : '';
  const count =
    u.lmaxCount > 0 ? `<small class="count">${u.lmaxCount}회 초과</small>` : '';
  const bar = `--level:${percent(u.leq).toFixed(1)}%;--limit:${percent(m.limits.leq).toFixed(1)}%`;
  return `
    <div class="unit-row ${status.className}">
      <span class="unit-name">${u.name}</span>
      <span class="num">${fmt(u.leq)}${peakLeq}</span>
      <span class="num">${fmt(u.lmax)}${count}</span>
      <span class="status">${status.text}</span>
      <span class="level" style="${bar}"></span>
    </div>`;
}

/**
 * 측정 패널 본문
 * @param {object} m getMeasurement() 결과
 */
export function renderMeasurementHtml(m) {
  const mode = m.isNight ? '야간 기준' : '주간 기준';
  const windowText = m.isLegalWindow
    ? '법정 1분 구간'
    : `시연용 ${m.windowSeconds}초 구간 (법정 1분 아님)`;
  const truncated = m.replayTruncated
    ? ' · 기록 상한으로 최근 기록만 재계산'
    : '';
  const ordered = [...m.units].sort(
    (a, b) => b.floorLevel - a.floorLevel || a.column - b.column,
  );
  return `
    <div class="meas-head">
      <span>${mode}</span>
      <span class="num">Leq ${m.limits.leq} · Lmax ${m.limits.lmax} dB(A)</span>
    </div>
    <div class="meas-meta">${windowText} · <span class="num">${m.elapsedInWindow.toFixed(0)}/${m.windowSeconds}</span>초${truncated}</div>
    <div class="unit-row unit-head">
      <span>세대</span><span>Leq</span><span>Lmax</span><span></span>
    </div>
    <div class="unit-rows">${ordered.map((u) => unitRow(u, m)).join('')}</div>`;
}
