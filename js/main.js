import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBuilding } from './floor.js';
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

// 💡 건물 전체(2층 × 2세대)가 보이도록 카메라를 멀리, 약간 위에서 바라봄
camera.position.set(0, 22, 40);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 7, 0); // 건물 중앙을 기준으로 회전
controls.enableDamping = true;
controls.dampingFactor = 0.08; // 관성 감쇠 (기본 0.05) - 클수록 손을 뗀 뒤 빨리 멈춤
controls.rotateSpeed = 0.4; // 드래그 회전 속도 (기본 1.0) - 작을수록 천천히 회전
controls.zoomSpeed = 0.6; // 휠 확대/축소 속도 (기본 1.0)
controls.update();

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 30, 20);
scene.add(directionalLight);

const { buildingGroup, units } = createBuilding();
scene.add(buildingGroup);

// controls를 넘겨서 바닥을 누르는 동안에는 카메라가 돌지 않게 함
const simulation = new SimulationManager(camera, units, controls);
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  const delta = Math.min(clock.getDelta(), 0.1); // 탭 전환 등으로 프레임이 끊겼을 때 값이 튀지 않도록 제한
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
