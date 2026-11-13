import { LEGAL_LIMITS } from '../acoustics/index.js';
import { resolvePresetUnit } from '../simulation/presets.js';
import { renderMeasurementHtml } from './measurementView.js';

/**
 * 좌측 정보 패널(index.html의 #info) 연결
 * 주/야간 전환, 프리셋 세대 선택, 측정 초기화, 세대별 측정 표시
 */
export function initInfoPanel(ctx) {
  const { config } = ctx;
  const btnDay = document.getElementById('btn-day');
  const btnNight = document.getElementById('btn-night');
  const unitSelect = document.getElementById('preset-unit');
  const resultEl = document.getElementById('leq-result');

  btnDay.textContent = `주간 ${LEGAL_LIMITS.day.leq} / ${LEGAL_LIMITS.day.lmax}`;
  btnNight.textContent = `야간 ${LEGAL_LIMITS.night.leq} / ${LEGAL_LIMITS.night.lmax}`;

  btnDay.addEventListener('click', () =>
    config.set('simulation.isNight', false),
  );
  btnNight.addEventListener('click', () =>
    config.set('simulation.isNight', true),
  );

  unitSelect.addEventListener('change', () => {
    config.set('simulation.presetUnit', unitSelect.value);
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    ctx.simulation.reset();
  });

  function syncMode() {
    const isNight = config.simulation.isNight;
    btnDay.classList.toggle('active', !isNight);
    btnNight.classList.toggle('active', isNight);
  }

  /** 세대 선택 목록 갱신 (위층부터, 같은 층은 왼쪽부터) */
  function syncUnitOptions() {
    const units = [...ctx.building.units].sort(
      (a, b) => b.floorLevel - a.floorLevel || a.column - b.column,
    );
    const selected = resolvePresetUnit(
      ctx.building.units,
      config.simulation.presetUnit,
    );
    unitSelect.replaceChildren(
      ...units.map((u) => {
        const option = document.createElement('option');
        option.value = u.name;
        option.textContent = u.name;
        option.selected = u === selected;
        return option;
      }),
    );
  }

  function renderMeasurement(m) {
    resultEl.innerHTML = renderMeasurementHtml(m);
  }

  config.subscribe(({ path }) => {
    if (path === 'simulation.isNight') syncMode();
    if (path === 'simulation.presetUnit') syncUnitOptions();
  });
  ctx.simulation.onMeasurement(renderMeasurement);

  syncMode();
  syncUnitOptions();

  return {
    onBuildingRebuilt() {
      syncUnitOptions();
    },
  };
}
