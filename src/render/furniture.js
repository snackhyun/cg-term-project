/**
 * 가구(Kenney Furniture Kit, CC0)와 세대 소품(천장등, 걸레받이, 뒷면 창호)
 * 모델·geometry·재질은 1회만 만들어 공유, 건물마다 InstancedMesh만 새로 생성
 * 가구는 피킹 대상(구조체)이 아니므로 클릭은 가구를 지나 바닥에 닿음
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { planUnitFurniture } from '../building/furnitureLayout.js';
import { getBuildingMaterialSet, getFurnitureMaterials } from './materials.js';

const BASE = `${import.meta.env?.BASE_URL ?? './'}assets/furniture/`;

/**
 * 배치 키 → 모델 파일, 앞면 +z·길이 x로 맞추는 회전(yaw)
 */
const MODELS = {
  sofa: { file: 'loungeSofa', yaw: 0 },
  sofaDesign: { file: 'loungeDesignSofa', yaw: 0 },
  console: { file: 'sideTable', yaw: 0 },
  floorLamp: { file: 'lampRoundFloor', yaw: 0 },
  tvStand: { file: 'cabinetTelevision', yaw: 0 },
  tv: { file: 'televisionModern', yaw: 0 },
  bed: { file: 'bedSingle', yaw: 0 },
  nightstand: { file: 'cabinetBedDrawerTable', yaw: 0 },
  desk: { file: 'desk', yaw: 0 },
  deskChair: { file: 'chairDesk', yaw: 0 },
  bookcase: { file: 'bookcaseClosed', yaw: 0 },
  cabinet: { file: 'bookcaseClosedWide', yaw: 0 },
  kitchenCabinet: { file: 'kitchenCabinet', yaw: 0 },
  kitchenSink: { file: 'kitchenSink', yaw: 0 },
  kitchenStove: { file: 'kitchenStove', yaw: 0 },
  fridge: { file: 'kitchenFridge', yaw: 0 },
  upperCabinet: { file: 'kitchenCabinetUpper', yaw: 0 },
  plant: { file: 'pottedPlant', yaw: 0 },
};

/** 키 → { geometry, mirrored, materials } (1×1×1로 정규화, 바닥 중심이 원점) */
const prototypes = {};
let loadPromise = null;
/** 모델 로드 전에 만들어진 건물 */
const pending = new Set();

/** Kenney 재질 이름 → 공용 재질 키 */
function materialKey(name = '') {
  const known = getFurnitureMaterials();
  return name in known ? name : 'default';
}

/** 정점 순서를 뒤집어 좌우 반전 geometry의 앞면 방향 유지 */
function flipWinding(geometry) {
  for (const attr of Object.values(geometry.attributes)) {
    const a = attr.array;
    const n = attr.itemSize;
    for (let t = 0; t < attr.count; t += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (t + 1) * n + k;
        const i2 = (t + 2) * n + k;
        const tmp = a[i1];
        a[i1] = a[i2];
        a[i2] = tmp;
      }
    }
    attr.needsUpdate = true;
  }
}

/** glTF 장면 → 재질별로 묶은 단일 geometry (1×1×1 정규화) */
function buildPrototype(scene, yaw) {
  scene.updateMatrixWorld(true);
  const parts = new Map();
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    let g = obj.geometry.index
      ? obj.geometry.toNonIndexed()
      : obj.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(obj.matrixWorld);
    const key = materialKey(obj.material?.name);
    if (!parts.has(key)) parts.set(key, []);
    parts.get(key).push(g);
  });

  const keys = [...parts.keys()];
  const perMaterial = keys.map((k) => {
    const list = parts.get(k);
    const merged = list.length > 1 ? mergeGeometries(list) : list[0];
    if (list.length > 1) list.forEach((g) => g.dispose());
    return merged;
  });
  const geometry = mergeGeometries(perMaterial, true);
  perMaterial.forEach((g) => g.dispose());

  geometry.rotateY(yaw);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const size = box.getSize(new THREE.Vector3());
  geometry.translate(
    -(box.min.x + box.max.x) / 2,
    -box.min.y,
    -(box.min.z + box.max.z) / 2,
  );
  geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.shared = true;

  const mirrored = geometry.clone();
  mirrored.scale(-1, 1, 1);
  flipWinding(mirrored);
  mirrored.userData.shared = true;

  const all = getFurnitureMaterials();
  return { geometry, mirrored, materials: keys.map((k) => all[k]) };
}

/**
 * 아직 없는 모델 로드. 성공한 모델만 등록, 실패한 모델은 다음 건물 생성 때 재시도
 * @returns {Promise<void>}
 */
export function loadFurnitureModels() {
  if (loadPromise) return loadPromise;
  const loader = new GLTFLoader();
  const missing = Object.entries(MODELS).filter(([key]) => !prototypes[key]);
  loadPromise = Promise.allSettled(
    missing.map(async ([key, { file, yaw }]) => {
      const gltf = await loader.loadAsync(`${BASE}${file}.glb`);
      prototypes[key] = buildPrototype(gltf.scene, yaw);
      gltf.scene.traverse((obj) => {
        if (obj.isMesh) {
          obj.geometry.dispose();
          obj.material.dispose?.();
        }
      });
    }),
  ).then((results) => {
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) {
      console.warn(`가구 모델 ${failed.length}개 로드 실패`, failed[0].reason);
    }
    for (const building of pending) fillFurniture(building);
    pending.clear();
    loadPromise = null;
  });
  return loadPromise;
}

/** 모든 모델 준비 여부 */
function allLoaded() {
  return Object.keys(MODELS).every((key) => prototypes[key]);
}

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);

/** 가구 배치를 InstancedMesh로 채움 */
function fillFurniture(building) {
  const group = building.group.getObjectByName('furniture');
  if (!group || building.disposed || building.furnitureFilled) return;
  building.furnitureFilled = true;

  const byKey = new Map();
  for (const unit of building.units) {
    for (const item of planUnitFurniture(unit)) {
      const k = `${item.key}|${item.mirror ? 1 : 0}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push({ item, floorY: unit.floorY });
    }
  }

  for (const [k, list] of byKey) {
    const [key, mirror] = k.split('|');
    const proto = prototypes[key];
    if (!proto) continue;
    const mesh = new THREE.InstancedMesh(
      mirror === '1' ? proto.mirrored : proto.geometry,
      proto.materials,
      list.length,
    );
    list.forEach(({ item, floorY }, i) => {
      tmpPos.set(item.x, floorY + 0.004 + item.y, item.z);
      tmpQuat.setFromAxisAngle(yAxis, item.yaw);
      tmpScale.set(item.length, item.height, item.depth);
      mesh.setMatrixAt(i, tmpMatrix.compose(tmpPos, tmpQuat, tmpScale));
    });
    mesh.name = `furniture-${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

const shared = {};

/** 소품 geometry (1회 생성, 공유) */
function sharedGeometry(name, create) {
  if (!shared[name]) {
    shared[name] = create();
    shared[name].userData.shared = true;
  }
  return shared[name];
}

/** 인스턴스 행렬 목록으로 InstancedMesh 생성 */
function instanced(name, geometry, material, matrices, shadow = true) {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.name = name;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

/** 위치·크기 → 행렬 (회전 없음) */
function boxMatrix(x, y, z, sx, sy, sz) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion(),
    new THREE.Vector3(sx, sy, sz),
  );
}

/** 천장등, 걸레받이, 뒷면 창호 (창은 바깥 벽면에서 2cm 돌출) */
function createFixtures(building) {
  const mats = getBuildingMaterialSet();
  const box = sharedGeometry('box', () => new THREE.BoxGeometry(1, 1, 1));
  const disc = sharedGeometry(
    'disc',
    () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
  );
  const pane = sharedGeometry('pane', () => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateY(Math.PI);
    return g;
  });

  const { wallThickness: T } = building.config;
  const lamps = [];
  const boards = [];
  const frames = [];
  const panes = [];
  const bh = 0.07;
  const bt = 0.012;
  for (const u of building.units) {
    const { minX, maxX, minZ, maxZ } = u.bounds;
    const y0 = u.floorY;
    lamps.push(
      boxMatrix(u.centerX, y0 + u.height - 0.02, u.centerZ, 0.56, 0.04, 0.56),
    );

    const by = y0 + bh / 2;
    boards.push(
      boxMatrix(u.centerX, by, minZ + 0.003 + bt / 2, u.width, bh, bt),
      boxMatrix(minX + 0.003 + bt / 2, by, (minZ + maxZ) / 2, bt, bh, u.depth),
      boxMatrix(maxX - 0.003 - bt / 2, by, (minZ + maxZ) / 2, bt, bh, u.depth),
    );

    const ww = Math.min(1.8, u.width * 0.45);
    const wy0 = y0 + 0.9;
    const wy1 = y0 + u.height - 0.25;
    const wh = wy1 - wy0;
    const wz = minZ - T - 0.02;
    const f = 0.05;
    const wcy = (wy0 + wy1) / 2;
    frames.push(
      boxMatrix(u.centerX, wy0 + f / 2, wz, ww + f, f, 0.05),
      boxMatrix(u.centerX, wy1 - f / 2, wz, ww + f, f, 0.05),
      boxMatrix(u.centerX - ww / 2, wcy, wz, f, wh, 0.05),
      boxMatrix(u.centerX + ww / 2, wcy, wz, f, wh, 0.05),
      boxMatrix(u.centerX, wcy, wz, f * 0.6, wh, 0.05),
    );
    panes.push(boxMatrix(u.centerX, wcy, wz - 0.005, ww, wh, 1));
  }

  return [
    instanced('ceiling-lamps', disc, mats.lampPanel, lamps, false),
    instanced('baseboards', box, mats.baseboard, boards, false),
    instanced('window-frames', box, mats.windowFrame, frames),
    instanced('window-panes', pane, mats.glass, panes, false),
  ];
}

/**
 * 건물에 가구와 소품 추가 (createBuilding에서 호출)
 * 모델 로드 전이면 빈 그룹을 두고 로드 후 채움
 */
export function addFurniture(building) {
  const group = new THREE.Group();
  group.name = 'furniture';
  building.group.add(group);

  const fixtures = new THREE.Group();
  fixtures.name = 'fixtures';
  fixtures.add(...createFixtures(building));
  building.group.add(fixtures);

  if (allLoaded()) fillFurniture(building);
  else {
    pending.add(building);
    loadFurnitureModels();
  }
}

/** 건물 dispose 시 로드 대기 목록에서 제거 */
export function releaseFurniture(building) {
  building.disposed = true;
  pending.delete(building);
}
