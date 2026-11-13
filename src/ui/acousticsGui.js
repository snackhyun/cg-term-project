import { ACOUSTICS_LIMITS } from '../config.js';

const FIELDS = [
  ['density', '콘크리트 밀도 ρ (kg/m³)'],
  ['lossFactor', '손실계수 η'],
  ['dynamicStiffness', '완충재 s′ (MN/m³)'],
  ['screedMass', '뜬바닥 m′ (kg/m²)'],
  ['reverbTime', '잔향시간 T (s)'],
];

const WINDOWS = { '시연용 20초': 20, '법정 1분': 60 };

/**
 * 음향·측정 설정 폴더 (lil-gui). 슬래브·벽 두께는 건물 설정 값 사용
 * 슬라이더를 놓을 때만 config 변경
 */
export function addAcousticsFolder(gui, config) {
  const folder = gui.addFolder('음향 설정');
  const params = { ...config.acoustics };
  const controllers = new Map();

  for (const [key, label] of FIELDS) {
    const { min, max, step } = ACOUSTICS_LIMITS[key];
    const c = folder
      .add(params, key, min, max, step)
      .name(label)
      .onFinishChange((v) => config.set(`acoustics.${key}`, v));
    controllers.set(key, c);
  }
  const ff = folder
    .add(params, 'floatingFloor')
    .name('뜬바닥 사용')
    .onChange((v) => config.set('acoustics.floatingFloor', v));
  controllers.set('floatingFloor', ff);
  const syncFloating = () => {
    for (const k of ['dynamicStiffness', 'screedMass'])
      controllers.get(k).enable(params.floatingFloor);
  };
  syncFloating();

  const sim = {
    slowMotion: config.simulation.slowMotion,
    measurementWindow: config.simulation.measurementWindow,
    rippleStrength: config.simulation.rippleStrength,
  };
  const { min, max, step } = ACOUSTICS_LIMITS.slowMotion;
  folder
    .add(sim, 'slowMotion', min, max, step)
    .name('슬로모션 (1/N 배속)')
    .onFinishChange((v) => config.set('simulation.slowMotion', v));
  const ripple = ACOUSTICS_LIMITS.rippleStrength;
  folder
    .add(sim, 'rippleStrength', ripple.min, ripple.max, ripple.step)
    .name('물결 세기')
    .onFinishChange((v) => config.set('simulation.rippleStrength', v));
  folder
    .add(sim, 'measurementWindow', WINDOWS)
    .name('Leq 측정 구간')
    .onChange((v) => config.set('simulation.measurementWindow', v));

  config.subscribe(({ section, key, value }) => {
    if (section !== 'acoustics' || !controllers.has(key)) return;
    params[key] = value;
    controllers.get(key).updateDisplay();
    if (key === 'floatingFloor') syncFloating();
  });
  return folder;
}
