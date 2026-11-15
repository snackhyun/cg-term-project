import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBuilding } from './building/index.js';
import * as character from './character/index.js';
import { createConfig } from './config.js';
import * as visuals from './render/index.js';
import { SimulationManager } from './simulation/SimulationManager.js';
import { initUI } from './ui/index.js';

const config = createConfig();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.05,
  500,
);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08; // 클수록 손을 뗀 뒤 빨리 멈춤
controls.rotateSpeed = 0.4;
controls.zoomSpeed = 0.6;

/** 모든 모듈이 공유하는 컨텍스트. 구조는 src/render/index.js 상단 주석을 참고하세요. */
const ctx = {
  scene,
  camera,
  renderer,
  controls,
  config,
  building: null,
  simulation: null,
};

visuals.initVisuals(ctx);

ctx.building = createBuilding(config.building);
scene.add(ctx.building.group);

ctx.simulation = new SimulationManager({
  camera,
  domElement: renderer.domElement,
  controls,
  building: ctx.building,
  isNight: config.simulation.isNight,
  config,
});

fitCamera(ctx.building);

const ui = initUI(ctx);
character.initCharacter(ctx);

/** 재생성 예약 여부 (여러 값이 한 번에 바뀌어도 재생성 1회) */
let rebuildQueued = false;
config.subscribe(({ section, path, value }) => {
  if (section === 'building' && !rebuildQueued) {
    rebuildQueued = true;
    queueMicrotask(() => {
      rebuildQueued = false;
      rebuildBuilding();
    });
  }
  if (path === 'simulation.isNight') ctx.simulation.setMode(value);
});

function rebuildBuilding() {
  const prevRadius = boundingRadius(ctx.building);
  ctx.building.dispose();

  ctx.building = createBuilding(config.building);
  scene.add(ctx.building.group);
  ctx.simulation.setBuilding(ctx.building);
  fitCamera(ctx.building, prevRadius);

  ui.onBuildingRebuilt(ctx);
  visuals.onBuildingRebuilt(ctx);
  character.onBuildingRebuilt(ctx);
}

function boundingRadius(building) {
  return building.bounds.getSize(new THREE.Vector3()).length() / 2;
}

/**
 * 건물 전체가 보이도록 카메라 맞춤
 * prevRadius가 있으면 보는 방향 유지, 건물 크기 변화만큼 거리 조정
 */
function fitCamera(building, prevRadius = null) {
  const center = building.bounds.getCenter(new THREE.Vector3());
  const radius = boundingRadius(building);

  let offset;
  if (prevRadius) {
    offset = camera.position.clone().sub(controls.target);
    offset.multiplyScalar(radius / prevRadius);
  } else {
    const aspectFactor = Math.max(1, 1.6 / camera.aspect);
    offset = new THREE.Vector3(0, 15, 40)
      .normalize()
      .multiplyScalar(2.4 * radius * aspectFactor);
  }

  controls.target.copy(center);
  camera.position.copy(center).add(offset);
  controls.update();
}

const timer = new THREE.Timer();
timer.connect(document);

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = Math.min(timer.getDelta(), 0.1);
  controls.update();
  character.update(delta);
  ctx.simulation.update(delta);
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (import.meta.env.DEV) window.__ctx = ctx; // 개발 중 콘솔 디버깅용
