import { initGui } from './gui.js';
import { initInfoPanel } from './infoPanel.js';

/** 정보 패널, 건물 설정 패널 초기화 */
export function initUI(ctx) {
  const panel = initInfoPanel(ctx);
  const gui = initGui(ctx);
  return {
    gui,
    onBuildingRebuilt() {
      panel.onBuildingRebuilt();
    },
  };
}
