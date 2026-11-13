import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createFloor } from './floor.js';
import { SimulationManager } from './simulation.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0b);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

camera.position.set(0, 14, 20);
camera.lookAt(0, 2, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08; // 관성 감쇠 (기본 0.05) - 클수록 손을 뗀 뒤 빨리 멈춤
controls.rotateSpeed = 0.4; // 드래그 회전 속도 (기본 1.0) - 작을수록 천천히 회전
controls.zoomSpeed = 0.6; // 휠 확대/축소 속도 (기본 1.0)

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 15, 10);
scene.add(directionalLight);

const { floorGroup, floor, floorGeometry, walls, wallGeometries } =
  createFloor();
scene.add(floorGroup);

const simulation = new SimulationManager(
  camera,
  floor,
  floorGeometry,
  walls,
  wallGeometries,
);
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  const delta = clock.getDelta();
  simulation.update(delta);
  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 💡 버튼 클릭 시 실행되는 글로벌 함수 (UI 및 시뮬레이터 모드 동시 반영)
window.switchMode = (isNight) => {
  const btnDay = document.getElementById('btn-day');
  const btnNight = document.getElementById('btn-night');

  if (isNight) {
    btnDay.classList.remove('active');
    btnNight.classList.add('active');
  } else {
    btnNight.classList.remove('active');
    btnDay.classList.add('active');
  }

  simulation.setMode(isNight);
};
