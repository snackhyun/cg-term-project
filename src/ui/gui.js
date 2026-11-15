import GUI from 'lil-gui';
import { BUILDING_LIMITS } from '../config.js';
import { VIEW_MODES } from '../render/index.js';
import { addAcousticsFolder } from './acousticsGui.js';

const BUILDING_FIELDS = [
  ['floors', '층 수'],
  ['unitsPerFloor', '층당 세대 수'],
  ['width', '세대 폭 (m)'],
  ['depth', '세대 깊이 (m)'],
  ['height', '천장고 (m)'],
  ['slabThickness', '슬래브 두께 (m)'],
  ['wallThickness', '벽 두께 (m)'],
];

/**
 * 건물 파라미터 패널(lil-gui) 생성
 * 슬라이더를 놓았을 때만 config 반영 (드래그 중 재생성 방지)
 */
export function initGui(ctx) {
  const { config } = ctx;
  const gui = new GUI({ title: '건물 설정' });
  const params = { ...config.building };
  const controllers = new Map();

  for (const [key, label] of BUILDING_FIELDS) {
    const { min, max, step } = BUILDING_LIMITS[key];
    const c = gui
      .add(params, key, min, max, step)
      .name(label)
      .onFinishChange((value) => config.set(`building.${key}`, value));
    controllers.set(key, c);
  }

  gui.add({ reset: () => config.resetBuilding() }, 'reset').name('기본값으로');

  /** 보기 모드 (실사 / 혼합 / 히트맵) */
  const view = { mode: config.view.mode };
  gui
    .add(view, 'mode', VIEW_MODES)
    .name('보기 모드')
    .onChange((value) => config.set('view.mode', value));

  addAcousticsFolder(gui, config);

  config.subscribe(({ section, key, value }) => {
    if (section !== 'building' || !controllers.has(key)) return;
    params[key] = value;
    controllers.get(key).updateDisplay();
  });

  return gui;
}
