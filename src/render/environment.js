/**
 * 하늘, 조명, 지면, 주변 나무와 주간·야간 전환
 * 실내 천장등은 실제 광원 대신 셰이더(applyInteriorLighting)로 처리
 */
import * as THREE from 'three';
import {
  getBuildingMaterialSet,
  getFurnitureMaterials,
  interiorUniforms,
} from './materials.js';
import { loadPbrSet } from './textures.js';

/** 주간·야간 설정값 (색은 sRGB hex) */
const PRESETS = {
  day: {
    skyTop: 0x5b8fd0,
    skyHorizon: 0xdbe6ef,
    skyBottom: 0xcfd8de,
    sun: 0xfff0dc,
    sunIntensity: 2.6,
    hemiSky: 0xe4ecf7,
    hemiGround: 0x9a8f7e,
    hemiIntensity: 0.9,
    envIntensity: 0.8,
    interior: 0xffd9a8,
    interiorIntensity: 0.0,
    roomAO: 0.45,
    glow: 0.0,
    exposure: 1.0,
  },
  night: {
    skyTop: 0x050914,
    skyHorizon: 0x1a2236,
    skyBottom: 0x0b0d12,
    sun: 0x9fb6ff,
    sunIntensity: 0.25,
    hemiSky: 0x24304d,
    hemiGround: 0x0c0c10,
    hemiIntensity: 0.25,
    envIntensity: 0.05,
    interior: 0xffdcb4,
    interiorIntensity: 4.5,
    roomAO: 0.7,
    glow: 1.0,
    exposure: 1.1,
  },
};

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
	vDir = normalize( position );
	vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
	gl_Position = p.xyww;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
varying vec3 vDir;
void main() {
	float h = vDir.y;
	vec3 c = h > 0.0
		? mix( uHorizon, uTop, pow( smoothstep( 0.0, 1.0, h ), 0.6 ) )
		: mix( uHorizon, uBottom, smoothstep( 0.0, 0.15, -h ) );
	gl_FragColor = vec4( c, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

/** 그라데이션 하늘 구 */
function createSky(radius) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 16),
    material,
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

/** 하늘색으로 만든 환경맵 (주간·야간 각 1회) */
function createEnvMap(renderer, preset) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const sky = createSky(50);
  setSkyColors(sky.material, preset);
  scene.add(sky);
  const target = pmrem.fromScene(scene, 0.02, 0.1, 100);
  sky.geometry.dispose();
  sky.material.dispose();
  pmrem.dispose();
  return target.texture;
}

function setSkyColors(material, p) {
  material.uniforms.uTop.value.set(p.skyTop);
  material.uniforms.uHorizon.value.set(p.skyHorizon);
  material.uniforms.uBottom.value.set(p.skyBottom);
}

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

/** 두 hex 색 보간 결과를 target에 저장 */
function lerpHex(target, a, b, t) {
  return target.copy(tmpA.set(a)).lerp(tmpB.set(b), t);
}

/** 나무 1그루용 geometry (줄기, 수관) */
function createTreeParts() {
  const trunk = new THREE.CylinderGeometry(0.12, 0.16, 1, 7);
  trunk.translate(0, 0.5, 0);
  const crown = new THREE.IcosahedronGeometry(1, 1);
  return { trunk, crown };
}

/**
 * 환경 생성
 * @param {object} ctx
 * @param {{ onBlend?: (t: number) => void }} [opts] 주야간 보간값(0 주간 ~ 1 야간) 변경 알림
 * @returns {{ setNight(isNight: boolean, immediate?: boolean), fitToBuilding(building) }}
 */
export function createEnvironment(ctx, { onBlend } = {}) {
  const { scene, renderer } = ctx;

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const sky = createSky(400);
  sky.name = 'sky';
  scene.add(sky);
  scene.fog = new THREE.Fog(0xdbe6ef, 70, 300);

  scene.environment = createEnvMap(renderer, PRESETS.day);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3(0.55, 0.9, 0.75).normalize();

  const grassSet = loadPbrSet('leafy_grass', 2.0);
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassSet.map,
    normalMap: grassSet.normalMap,
    roughnessMap: grassSet.armMap,
    color: 0xb4c49a,
  });
  const groundGeo = new THREE.PlaneGeometry(900, 900);
  groundGeo.rotateX(-Math.PI / 2);
  const uv = groundGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, uv.getX(i) * 900, uv.getY(i) * 900);
  const ground = new THREE.Mesh(groundGeo, grassMat);
  ground.name = 'ground';
  ground.receiveShadow = true;
  scene.add(ground);

  const paveSet = loadPbrSet('hexagonal_concrete_paving', 1.6);
  const paveMat = new THREE.MeshStandardMaterial({
    map: paveSet.map,
    normalMap: paveSet.normalMap,
    roughnessMap: paveSet.armMap,
    aoMap: paveSet.armMap,
    color: 0xe0ddd6,
  });
  const apron = new THREE.Mesh(new THREE.BufferGeometry(), paveMat);
  apron.name = 'apron';
  apron.receiveShadow = true;
  scene.add(apron);

  const tree = createTreeParts();
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x6b5442,
    roughness: 0.9,
  });
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0x557a44,
    roughness: 0.85,
    flatShading: true,
  });
  const TREE_MAX = 24;
  const trunks = new THREE.InstancedMesh(tree.trunk, trunkMat, TREE_MAX);
  const crowns = new THREE.InstancedMesh(tree.crown, crownMat, TREE_MAX);
  for (const m of [trunks, crowns]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.count = 0;
    scene.add(m);
  }

  let nightT = 0;
  let target = 0;
  let lastTime = performance.now();
  const glassEmissive = new THREE.Color(0xffc98f);

  function apply(t) {
    const d = PRESETS.day;
    const n = PRESETS.night;
    const mix = (a, b) => a + (b - a) * t;
    lerpHex(sky.material.uniforms.uTop.value, d.skyTop, n.skyTop, t);
    lerpHex(
      sky.material.uniforms.uHorizon.value,
      d.skyHorizon,
      n.skyHorizon,
      t,
    );
    lerpHex(sky.material.uniforms.uBottom.value, d.skyBottom, n.skyBottom, t);
    scene.fog.color.copy(sky.material.uniforms.uHorizon.value);
    lerpHex(sun.color, d.sun, n.sun, t);
    sun.intensity = mix(d.sunIntensity, n.sunIntensity);
    lerpHex(hemi.color, d.hemiSky, n.hemiSky, t);
    lerpHex(hemi.groundColor, d.hemiGround, n.hemiGround, t);
    hemi.intensity = mix(d.hemiIntensity, n.hemiIntensity);
    scene.environmentIntensity = mix(d.envIntensity, n.envIntensity);
    renderer.toneMappingExposure = mix(d.exposure, n.exposure);

    interiorUniforms.uInteriorLight.value
      .set(n.interior)
      .multiplyScalar(t * n.interiorIntensity);
    interiorUniforms.uRoomAO.value = mix(d.roomAO, n.roomAO);

    const mats = getBuildingMaterialSet();
    mats.glass.emissive.copy(glassEmissive).multiplyScalar(0.55 * t);
    mats.lampPanel.emissive.set(0xfff1dc).multiplyScalar(2.0 * t);
    getFurnitureMaterials()
      .lamp.emissive.set(0xffd9a0)
      .multiplyScalar(1.5 * t);
    onBlend?.(t);
  }

  /** 하늘 렌더 직전: 카메라 추종, 주야간 전환 진행 */
  sky.onBeforeRender = (r, s, cam) => {
    sky.position.copy(cam.position);
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    if (nightT !== target) {
      const step = dt / 0.8;
      nightT =
        target > nightT
          ? Math.min(target, nightT + step)
          : Math.max(target, nightT - step);
      apply(nightT);
    }
  };

  function setNight(isNight, immediate = false) {
    target = isNight ? 1 : 0;
    if (immediate) {
      nightT = target;
      apply(nightT);
    }
    lastTime = performance.now();
  }

  /**
   * 건물 크기에 맞춤
   * 보도블록, 나무(뒤·양옆만), 그림자 정사영 범위(건물 + 지면 그림자 끝), 큰 건물은 그림자맵 4096
   */
  function fitToBuilding(building) {
    const b = building.bounds;
    const groundY = b.min.y - 0.002;
    ground.position.y = groundY - 0.01;

    const margin = { side: 3, back: 3, front: 6 };
    const x0 = b.min.x - margin.side;
    const x1 = b.max.x + margin.side;
    const z0 = b.min.z - margin.back;
    const z1 = b.max.z + margin.front;
    const w = x1 - x0;
    const d = z1 - z0;
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    const auv = geo.attributes.uv;
    for (let i = 0; i < auv.count; i++)
      auv.setXY(i, auv.getX(i) * w + x0, auv.getY(i) * d + z0);
    apron.geometry.dispose();
    apron.geometry = geo;
    apron.position.set((x0 + x1) / 2, groundY, (z0 + z1) / 2);

    let i = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const place = (x, z, s) => {
      if (i >= TREE_MAX) return;
      const h = 2.2 * s;
      trunks.setMatrixAt(
        i,
        m.compose(
          new THREE.Vector3(x, groundY, z),
          q,
          new THREE.Vector3(s, h, s),
        ),
      );
      crowns.setMatrixAt(
        i,
        m.compose(
          new THREE.Vector3(x, groundY + h + 0.9 * s, z),
          q,
          new THREE.Vector3(1.5 * s, 1.8 * s, 1.5 * s),
        ),
      );
      i++;
    };
    const rand = (k) => {
      const v = Math.sin(k * 127.1 + 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const spacing = 4.5;
    for (let x = x0 + 1.5, k = 0; x <= x1 - 1; x += spacing, k++)
      place(x, z0 - 1.6, 0.6 + 0.3 * rand(k));
    for (let z = z0 + 2, k = 50; z <= z1; z += spacing, k++) {
      place(x0 - 1.6, z, 0.6 + 0.3 * rand(k));
      place(x1 + 1.6, z, 0.6 + 0.3 * rand(k + 100));
    }
    trunks.count = crowns.count = i;
    trunks.instanceMatrix.needsUpdate =
      crowns.instanceMatrix.needsUpdate = true;
    trunks.computeBoundingSphere();
    crowns.computeBoundingSphere();

    const center = b.getCenter(new THREE.Vector3());
    const radius = b.getSize(new THREE.Vector3()).length() / 2;
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(sunDir, radius * 3 + 10);
    const cam = sun.shadow.camera;
    const rot = new THREE.Matrix4().lookAt(
      sun.position,
      center,
      new THREE.Vector3(0, 1, 0),
    );
    const inv = rot.clone().invert();
    const pts = [];
    for (const x of [b.min.x - 1, b.max.x + 1])
      for (const y of [b.min.y, b.max.y + 0.5])
        for (const z of [b.min.z - 1, b.max.z + 1]) {
          const p = new THREE.Vector3(x, y, z);
          pts.push(p.clone());
          const t = (p.y - groundY) / sunDir.y;
          pts.push(p.clone().addScaledVector(sunDir, -t));
        }
    const lb = new THREE.Box3();
    for (const p of pts)
      lb.expandByPoint(p.sub(sun.position).applyMatrix4(inv));
    cam.left = lb.min.x;
    cam.right = lb.max.x;
    cam.bottom = lb.min.y;
    cam.top = lb.max.y;
    cam.near = Math.max(0.1, -lb.max.z - 2);
    cam.far = -lb.min.z + 2;
    cam.updateProjectionMatrix();
    const extent = Math.max(lb.max.x - lb.min.x, lb.max.y - lb.min.y);
    const size = extent > 30 ? 4096 : 2048;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  }

  return { setNight, fitToBuilding, sun, hemi };
}
