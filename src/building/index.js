/**
 * 설정값으로 건물 생성 (층 수 1~5, 층당 세대 수 1~4)
 *
 * createBuilding(buildingConfig) → Building
 *   group      scene에 추가할 최상위 그룹 (구조체 + 모든 세대 + 가구·창호)
 *   units      1층부터, 같은 층은 왼쪽부터 정렬된 세대 목록 (unit.index 순서)
 *   config     범위를 정리한 건물 설정
 *   layout     computeBuildingLayout() 결과
 *   bounds     건물 전체 범위 (THREE.Box3)
 *   materials  src/render에서 받은 재질
 *   dispose()  geometry, 재질, 텍스처 해제 후 scene에서 제거
 *
 * Unit = layout.js의 세대 정보 + { group, floor, floorGeometry, walls: [뒤, 좌, 우], wallGeometries, label }
 * UV는 m 단위 (텍스처 밀도가 세대 크기와 무관)
 */
import * as THREE from 'three';
import {
  createBuildingMaterials,
  decorateBuilding,
  releaseBuilding,
} from '../render/index.js';
import { computeBuildingLayout, segmentsFor } from './layout.js';

export {
  computeBuildingLayout,
  normalizeBuildingConfig,
  unitName,
} from './layout.js';

/** 히트맵 면과 콘크리트 면 사이 간격 (z-fighting 방지) */
const SURFACE_OFFSET = 0.003;

/**
 * 건물 생성
 * @param {object} buildingConfig config.building
 */
export function createBuilding(buildingConfig) {
  const layout = computeBuildingLayout(buildingConfig);
  const materials = createBuildingMaterials(layout.config);
  const group = new THREE.Group();
  group.name = 'building';

  const structureGroup = new THREE.Group();
  structureGroup.name = 'structure';
  for (const box of layout.structure) {
    structureGroup.add(createStructureMesh(box, layout, materials));
  }
  group.add(structureGroup);

  const units = layout.units.map((info) => {
    const unit = createUnit(info, materials, layout.segmentsPerMeter);
    group.add(unit.group);
    return unit;
  });

  const bounds = new THREE.Box3(
    new THREE.Vector3(...layout.bounds.min),
    new THREE.Vector3(...layout.bounds.max),
  );

  const building = {
    group,
    units,
    config: layout.config,
    layout,
    bounds,
    materials,
    dispose() {
      releaseBuilding(building);
      disposeObject(group);
      group.removeFromParent();
    },
  };

  decorateBuilding(building);
  group.updateMatrixWorld(true);
  return building;
}

/** BoxGeometry 면 순서: +x, -x, +y, -y, +z, -z */
const FACE = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 };

/**
 * 구조체 상자의 면별 재질 키
 * 앞쪽 단면은 노출 콘크리트, 바깥 면은 외장, 슬래브 아랫면은 천장
 */
function faceMaterialKeys(box, layout) {
  const keys = Array(6).fill('structure');
  const { floors, unitsPerFloor } = layout.config;
  if (box.kind === 'slab') {
    keys[FACE.nz] = keys[FACE.px] = keys[FACE.nx] = 'facadeBand';
    if (box.floorLevel === floors) keys[FACE.py] = 'roof';
    if (box.floorLevel > 0) keys[FACE.ny] = 'ceiling';
  } else if (box.kind === 'backWall') {
    keys[FACE.nz] = keys[FACE.px] = keys[FACE.nx] = 'facade';
  } else if (box.kind === 'partyWall') {
    if (box.column === 0) keys[FACE.nx] = 'facade';
    if (box.column === unitsPerFloor) keys[FACE.px] = 'facade';
  }
  return keys;
}

/** 콘크리트 상자 1개 (면별 재질, 월드 좌표 기준 m 단위 UV) */
function createStructureMesh(box, layout, materials) {
  const size = box.max.map((v, i) => v - box.min[i]);
  const center = box.min.map((v, i) => (v + box.max[i]) / 2);
  const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  setBoxWorldUVs(geo, center);

  const faceMaterials = faceMaterialKeys(box, layout).map(
    (k) => materials[k] ?? materials.structure,
  );
  const mesh = new THREE.Mesh(geo, groupFacesByMaterial(geo, faceMaterials));
  mesh.position.set(center[0], center[1], center[2]);
  mesh.name = `${box.kind}-${box.floorLevel}`;
  mesh.userData.kind = box.kind;
  mesh.userData.floorLevel = box.floorLevel;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * 같은 재질 면끼리 index를 모아 그룹 수(draw call) 최소화
 * @returns {THREE.Material | THREE.Material[]} 재질이 1개면 배열 대신 단일 재질
 */
function groupFacesByMaterial(geo, faceMaterials) {
  const unique = [...new Set(faceMaterials)];
  if (unique.length === 1) {
    geo.clearGroups();
    return unique[0];
  }
  const src = geo.index.array;
  const indices = [];
  const faceGroups = geo.groups.map((g) => ({ ...g }));
  geo.clearGroups();
  unique.forEach((material, mi) => {
    const start = indices.length;
    for (const g of faceGroups) {
      if (faceMaterials[g.materialIndex] !== material) continue;
      for (let i = g.start; i < g.start + g.count; i++) indices.push(src[i]);
    }
    geo.addGroup(start, indices.length - start, mi);
  });
  geo.setIndex(indices);
  return unique;
}

/** 상자 각 면의 UV를 월드 좌표(m)로 설정 */
function setBoxWorldUVs(geo, center) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (const group of geo.groups) {
    const face = group.materialIndex;
    for (let i = group.start; i < group.start + group.count; i++) {
      const vi = geo.index.getX(i);
      const x = pos.getX(vi) + center[0];
      const y = pos.getY(vi) + center[1];
      const z = pos.getZ(vi) + center[2];
      if (face <= FACE.nx) uv.setXY(vi, z, y);
      else if (face <= FACE.ny) uv.setXY(vi, x, z);
      else uv.setXY(vi, x, y);
    }
  }
  uv.needsUpdate = true;
}

/** 평면 UV(0~1)를 m 단위로 변환. swap이면 u, v 축 교환 */
function scalePlaneUVs(geometry, sizeU, sizeV, offsetU = 0, swap = false) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i) * sizeU + offsetU;
    const v = uv.getY(i) * sizeV;
    if (swap) uv.setXY(i, v, u);
    else uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

/**
 * 세대 1개: 바닥, 뒤·좌·우 벽 안쪽 면, 외곽선, 호수 라벨
 * 앞쪽은 개방, 라벨은 앞쪽 천장 바로 아래 (뒤쪽은 위층 슬래브에 가려짐)
 */
function createUnit(info, materials, segmentsPerMeter) {
  const {
    width: W,
    depth: D,
    height: H,
    centerX: cx,
    centerZ: cz,
    floorY,
  } = info;

  const floorGeometry = new THREE.PlaneGeometry(
    W,
    D,
    segmentsFor(W, segmentsPerMeter),
    segmentsFor(D, segmentsPerMeter),
  );
  initHeatmapColors(floorGeometry);
  scalePlaneUVs(floorGeometry, W, D, cx, true); // 마루 결을 깊이 방향으로
  const floor = new THREE.Mesh(floorGeometry, materials.floor);
  floor.name = `${info.name}-floor`;
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, floorY + SURFACE_OFFSET, cz);
  floor.userData.unitIndex = info.index; // 피킹 시 세대 판별
  floor.receiveShadow = true;

  const hSeg = segmentsFor(H, segmentsPerMeter);
  const backGeo = new THREE.PlaneGeometry(
    W,
    H,
    segmentsFor(W, segmentsPerMeter),
    hSeg,
  );
  initHeatmapColors(backGeo);
  scalePlaneUVs(backGeo, W, H, cx);
  const backWall = new THREE.Mesh(backGeo, materials.wall);
  backWall.position.set(cx, floorY + H / 2, cz - D / 2 + SURFACE_OFFSET);

  const leftGeo = new THREE.PlaneGeometry(
    D,
    H,
    segmentsFor(D, segmentsPerMeter),
    hSeg,
  );
  initHeatmapColors(leftGeo);
  scalePlaneUVs(leftGeo, D, H, cx);
  const leftWall = new THREE.Mesh(leftGeo, materials.wall);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(cx - W / 2 + SURFACE_OFFSET, floorY + H / 2, cz);

  const rightGeo = new THREE.PlaneGeometry(
    D,
    H,
    segmentsFor(D, segmentsPerMeter),
    hSeg,
  );
  initHeatmapColors(rightGeo);
  scalePlaneUVs(rightGeo, D, H, cx + 0.5);
  const rightWall = new THREE.Mesh(rightGeo, materials.wall);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(cx + W / 2 - SURFACE_OFFSET, floorY + H / 2, cz);

  backWall.name = `${info.name}-wall-back`;
  leftWall.name = `${info.name}-wall-left`;
  rightWall.name = `${info.name}-wall-right`;
  for (const wall of [backWall, leftWall, rightWall]) wall.receiveShadow = true;

  const frameBox = new THREE.BoxGeometry(W, H, D);
  const frameGeo = new THREE.EdgesGeometry(frameBox);
  frameBox.dispose();
  const frame = new THREE.LineSegments(frameGeo, materials.frame);
  frame.name = `${info.name}-frame`;
  frame.position.set(cx, floorY + H / 2, cz);

  const label = createLabel(info.name);
  label.position.set(cx, floorY + H - 0.28, cz + D / 2 - 0.3);

  const group = new THREE.Group();
  group.name = info.name;
  group.add(floor, backWall, leftWall, rightWall, frame, label);

  return {
    ...info,
    group,
    floor,
    floorGeometry,
    walls: [backWall, leftWall, rightWall],
    wallGeometries: [backGeo, leftGeo, rightGeo],
    label,
  };
}

/** 호수 라벨 스프라이트 */
function createLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(15, 15, 20, 0.75)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
  sprite.scale.set(1.12, 0.42, 1);
  return sprite;
}

/** RGBA 정점 색 초기화. A가 0이면 재질 바탕색 그대로 (src/render 참고) */
function initHeatmapColors(geometry) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 4);
  const attr = new THREE.BufferAttribute(colors, 4);
  attr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('color', attr);
  geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
}

const TEXTURE_KEYS = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'emissiveMap',
  'envMap',
  'lightMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'specularMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'anisotropyMap',
  'specularColorMap',
  'specularIntensityMap',
  'gradientMap',
  'matcap',
];

/**
 * 하위 오브젝트의 geometry, 재질, 텍스처 해제
 * userData.shared가 true인 geometry, 재질, 텍스처는 제외. InstancedMesh는 인스턴스 버퍼도 해제
 */
export function disposeObject(root) {
  const geometries = new Set();
  const materials = new Set();
  const instanced = [];
  root.traverse((obj) => {
    if (obj.isInstancedMesh) instanced.push(obj);
    if (obj.geometry && !obj.geometry.userData?.shared)
      geometries.add(obj.geometry);
    if (obj.material) {
      for (const m of Array.isArray(obj.material)
        ? obj.material
        : [obj.material]) {
        materials.add(m);
      }
    }
  });

  const textures = new Set();
  for (const m of materials) {
    if (m.userData?.shared) continue;
    for (const key of TEXTURE_KEYS) {
      const tex = m[key];
      if (tex && tex.isTexture && !tex.userData?.shared) textures.add(tex);
    }
    if (m.uniforms) {
      for (const u of Object.values(m.uniforms)) {
        if (u?.value?.isTexture && !u.value.userData?.shared)
          textures.add(u.value);
      }
    }
    m.dispose();
  }
  for (const t of textures) t.dispose();
  for (const g of geometries) g.dispose();
  for (const mesh of instanced) mesh.dispose();
}
