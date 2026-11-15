import { initGui } from './gui.js';
import { initInfoPanel } from './infoPanel.js';

/** 정보 패널, 건물 설정 패널 초기화 */
export function initUI(ctx) {
  const panel = initInfoPanel(ctx);
  const gui = initGui(ctx);
  const mobile = window.matchMedia('(max-width: 700px)');
  const info = document.getElementById('info');
  function syncPanelLayout() {
    info.open = !mobile.matches;
    gui.open(!mobile.matches);
  }
  mobile.addEventListener('change', syncPanelLayout);
  syncPanelLayout();
  return {
    gui,
    onBuildingRebuilt() {
      panel.onBuildingRebuilt();
    },
  };
}
