/**
 * 조명, 재질, 가구, 보기 모드
 *
 * ctx (src/main.js에서 생성, 모든 모듈이 같은 객체 공유)
 *   scene       THREE.Scene
 *   camera      THREE.PerspectiveCamera
 *   renderer    THREE.WebGLRenderer
 *   controls    OrbitControls
 *   config      createConfig() 결과 (src/config.js)
 *   building    createBuilding() 결과 (src/building/index.js). 초기화 전 null
 *   simulation  SimulationManager (src/simulation/SimulationManager.js). 초기화 전 null
 * 건물 재생성 시 ctx.building이 새 객체로 교체되므로 매번 ctx.building에서 읽기
 *
 * 계약
 *   initVisuals(ctx)
 *     renderer, scene, camera 생성 직후, 첫 건물 전 1회 호출
 *     렌더러 설정, 하늘, 조명, 지면, 보기 모드·주야간 구독
 *
 *   createBuildingMaterials(buildingConfig) → { floor, wall, structure, frame, ceiling, facade, facadeBand, roof }
 *     createBuilding()마다 호출. 모두 공유 재질(userData.shared)이라 재생성 때 dispose되지 않음
 *       floor, wall  세대 바닥·벽 안쪽 히트맵 면 (PlaneGeometry, uv는 m 단위, color 속성 RGBA)
 *       structure    노출 콘크리트 (슬래브·벽 단면)
 *       ceiling, facade, facadeBand, roof  천장, 외벽, 층 띠, 지붕
 *       frame        세대 외곽선 (히트맵 모드에서만 표시)
 *
 *   decorateBuilding(building) / releaseBuilding(building)
 *     createBuilding() 마지막과 dispose() 시작에서 호출. 가구·소품 추가, 그림자·지면 맞춤
 *
 *   onBuildingRebuilt(ctx)
 *     건물 재생성 후 호출 (첫 생성 때는 호출 안 됨)
 *
 *   applyHeatmapOverlay(material) → material
 *     three 내장 재질(MeshLambert, MeshStandard, MeshPhysical 등)에 히트맵 오버레이 적용
 *
 *   applyInteriorLighting(material) → material
 *     실내 천장등(야간)과 안쪽 간접광 감쇠 적용. 실내에 두는 메시(캐릭터 등)에 사용
 *
 * 히트맵 오버레이
 *   히트맵 면의 geometry.attributes.color는 itemSize 4 (Float32)
 *     RGB  소음 단계 색 (선형 색공간, three 정점 색 규약과 동일)
 *     A    오버레이 세기. 0dB에서 0, 20dB까지 서서히 1
 *   diffuseColor.rgb = mix(바탕, heat.rgb, heat.a × uHeatAmount), 바탕은 color × map
 *   '#include <color_fragment>' 청크 교체 방식 (onBeforeCompile)
 *
 * 보기 모드 (config.view.mode)
 *   real     실사. 오버레이·바닥 물결 없음
 *   mixed    텍스처 + 히트맵 (기본)
 *   heatmap  단색 바탕 + 히트맵, 가구 숨김, 외곽선 표시
 */
import {
  applyHeatmapOverlay,
  applyInteriorLighting,
  getBuildingMaterialSet,
  HEATMAP_BASE_COLOR,
  interiorUniforms,
  setSurfaceDetail,
  viewUniforms,
} from './materials.js';
import { createEnvironment } from './environment.js';
import {
  addFurniture,
  loadFurnitureModels,
  releaseFurniture,
} from './furniture.js';
import { setMaxAnisotropy } from './textures.js';

export { applyHeatmapOverlay, applyInteriorLighting, HEATMAP_BASE_COLOR };

/** 보기 모드 목록 (GUI 표시 이름 → 값) */
export const VIEW_MODES = { 실사: 'real', 혼합: 'mixed', 히트맵: 'heatmap' };

let env = null;
let ctxRef = null;
let viewMode = 'mixed';
let nightBlend = 0;

/** 시각화 초기화 */
export function initVisuals(ctx) {
  ctxRef = ctx;
  setMaxAnisotropy(ctx.renderer.capabilities.getMaxAnisotropy());
  env = createEnvironment(ctx, {
    onBlend: (t) => {
      nightBlend = t;
      updateGlow();
    },
  });
  env.setNight(Boolean(ctx.config.simulation.isNight), true);
  setViewMode(ctx.config.get('view.mode') ?? 'mixed');
  loadFurnitureModels();

  ctx.config.subscribe(({ path, value }) => {
    if (path === 'simulation.isNight') env.setNight(Boolean(value));
    if (path === 'view.mode') setViewMode(value);
  });
}

/** 공유 재질 세트 */
export function createBuildingMaterials(/* buildingConfig */) {
  const m = getBuildingMaterialSet();
  return {
    floor: m.floor,
    wall: m.wall,
    structure: m.structure,
    frame: m.frame,
    ceiling: m.ceiling,
    facade: m.facade,
    facadeBand: m.facadeBand,
    roof: m.roof,
  };
}

/** 건물에 가구·소품 추가, 실내 조명 격자와 그림자 범위 갱신 */
export function decorateBuilding(building) {
  const { layout } = building;
  const c = layout.config;
  const first = layout.units[0];
  interiorUniforms.uRoomGrid.value.set(
    first.bounds.minX,
    c.width + c.wallThickness,
    layout.storeyHeight,
    c.unitsPerFloor,
  );
  interiorUniforms.uRoomSize.value.set(c.width, c.height, c.depth, c.floors);

  addFurniture(building);
  applyVisibility(building);
  env?.fitToBuilding(building);
}

/** 건물 dispose 직전 정리 */
export function releaseBuilding(building) {
  releaseFurniture(building);
}

/** 재생성 후 처리 (decorateBuilding에서 이미 처리) */
export function onBuildingRebuilt(/* ctx */) {}

/** 히트맵 색 발광: 야간일수록 강하게 */
function updateGlow() {
  const on = viewMode !== 'real';
  viewUniforms.uHeatGlow.value = on ? 0.12 + 0.5 * nightBlend : 0;
}

/** 모드별 가구·외곽선 표시 */
function applyVisibility(building) {
  if (!building) return;
  const heat = viewMode === 'heatmap';
  for (const name of ['furniture', 'fixtures']) {
    const g = building.group.getObjectByName(name);
    if (g) g.visible = !heat;
  }
}

/**
 * 보기 모드 변경
 * @param {'real' | 'mixed' | 'heatmap'} mode
 */
export function setViewMode(mode) {
  viewMode = Object.values(VIEW_MODES).includes(mode) ? mode : 'mixed';
  const real = viewMode === 'real';
  const heat = viewMode === 'heatmap';
  viewUniforms.uHeatAmount.value = real ? 0 : 1;
  viewUniforms.uHeatFlat.value = heat ? 1 : 0;
  viewUniforms.uRipple.value = real ? 0 : 1;
  updateGlow();
  setSurfaceDetail(!heat);
  getBuildingMaterialSet().frame.visible = heat;
  applyVisibility(ctxRef?.building);
}
