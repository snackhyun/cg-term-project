/**
 * 공유 재질과 셰이더 패치
 * 재질은 처음 1회만 생성, 건물 재생성 때 dispose되지 않도록 userData.shared 지정
 */
import * as THREE from 'three';
import { loadPbrSet } from './textures.js';

/** 히트맵 0dB 기본색 (옥색) */
export const HEATMAP_BASE_COLOR = new THREE.Color().setRGB(
  0.0,
  0.6,
  0.5,
  THREE.SRGBColorSpace,
);

/**
 * 보기 모드 uniform (모든 히트맵 재질이 같은 객체 공유)
 *   uHeatAmount  오버레이 세기 배율 (실사 0)
 *   uHeatGlow    히트맵 색 자체 발광 (야간에도 보이도록)
 *   uHeatFlat    바탕을 단색으로 바꾸는 정도 (히트맵 모드 1)
 *   uRipple      바닥 물결 표시 (실사 0)
 */
export const viewUniforms = {
  uHeatAmount: { value: 1 },
  uHeatGlow: { value: 0.15 },
  uHeatFlat: { value: 0 },
  uHeatFlatColor: { value: HEATMAP_BASE_COLOR.clone() },
  uRipple: { value: 1 },
};

/**
 * 실내 조명 uniform (세대마다 실제 광원을 두는 대신 셰이더에서 계산)
 *   uRoomGrid      첫 세대 minX, 세대 간격, 층 높이, 층당 세대 수
 *   uRoomSize      세대 폭, 천장고, 깊이, 층 수
 *   uInteriorLight 천장등 색 × 세기 (0이면 꺼짐)
 *   uRoomAO        안쪽 깊은 곳 간접광 감쇠 (0 없음 ~ 1 최대)
 */
export const interiorUniforms = {
  uRoomGrid: { value: new THREE.Vector4(0, 4.7, 2.51, 1) },
  uRoomSize: { value: new THREE.Vector4(4.5, 2.3, 6, 1) },
  uInteriorLight: { value: new THREE.Color(0, 0, 0) },
  uRoomAO: { value: 0.55 },
};

/** shader 소스의 chunk 뒤(또는 대신)에 코드 삽입, 없으면 경고 */
function inject(source, chunk, code, { replace = false } = {}) {
  const tag = `#include <${chunk}>`;
  if (!source.includes(tag)) {
    console.warn(`셰이더 패치 실패: ${tag} 없음`);
    return source;
  }
  return source.replace(tag, replace ? code : `${tag}\n${code}`);
}

/** onBeforeCompile 연결 (기존 콜백과 캐시 키 유지) */
function chainPatch(material, key, patch) {
  const prev = material.onBeforeCompile;
  const prevKeyFn = material.customProgramCacheKey;
  // 기본 키 함수는 호출 시점의 onBeforeCompile 소스를 쓰므로 교체 전 값을 고정
  const baseKey =
    prevKeyFn === THREE.Material.prototype.customProgramCacheKey
      ? prev.toString()
      : null;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    patch(shader);
  };
  material.customProgramCacheKey = () =>
    `${baseKey ?? prevKeyFn.call(material)}|${key}`;
  material.needsUpdate = true;
  return material;
}

const HEATMAP_FRAGMENT = /* glsl */ `
#if defined( USE_COLOR_ALPHA )
	diffuseColor.rgb = mix( diffuseColor.rgb, uHeatFlatColor, uHeatFlat );
	diffuseColor.rgb = mix( diffuseColor.rgb, vColor.rgb, vColor.a * uHeatAmount );
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor.rgb;
#endif
`;

const HEATMAP_EMISSIVE = /* glsl */ `
#if defined( USE_COLOR_ALPHA )
	totalEmissiveRadiance += vColor.rgb * ( vColor.a * uHeatAmount * uHeatGlow );
#endif
`;

/**
 * 히트맵 오버레이 적용 (three 내장 재질)
 * diffuseColor = mix(바탕, vColor.rgb, vColor.a × uHeatAmount)
 * @param {THREE.Material} material
 * @returns {THREE.Material}
 */
export function applyHeatmapOverlay(material) {
  material.vertexColors = true;
  return chainPatch(material, 'heatmap-overlay', (shader) => {
    Object.assign(shader.uniforms, viewUniforms);
    shader.fragmentShader = inject(
      shader.fragmentShader,
      'common',
      /* glsl */ `
uniform float uHeatAmount;
uniform float uHeatGlow;
uniform float uHeatFlat;
uniform vec3 uHeatFlatColor;`,
    );
    shader.fragmentShader = inject(
      shader.fragmentShader,
      'color_fragment',
      HEATMAP_FRAGMENT,
      { replace: true },
    );
    shader.fragmentShader = inject(
      shader.fragmentShader,
      'emissivemap_fragment',
      HEATMAP_EMISSIVE,
    );
  });
}

/** 바닥 물결 표시 on/off (평면 로컬 z 변위와 법선) */
function applyRippleGate(material) {
  return chainPatch(material, 'ripple-gate', (shader) => {
    shader.uniforms.uRipple = viewUniforms.uRipple;
    shader.vertexShader = inject(
      shader.vertexShader,
      'common',
      'uniform float uRipple;',
    );
    shader.vertexShader = inject(
      shader.vertexShader,
      'beginnormal_vertex',
      'objectNormal = normalize( mix( vec3( 0.0, 0.0, 1.0 ), objectNormal, uRipple ) );',
    );
    shader.vertexShader = inject(
      shader.vertexShader,
      'begin_vertex',
      'transformed.z *= uRipple;',
    );
  });
}

const INTERIOR_VERTEX = /* glsl */ `
{
	vec4 interiorPos = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		interiorPos = instanceMatrix * interiorPos;
	#endif
	vInteriorPos = ( modelMatrix * interiorPos ).xyz;
}
`;

const INTERIOR_PARS = /* glsl */ `
varying vec3 vInteriorPos;
uniform vec4 uRoomGrid;
uniform vec4 uRoomSize;
uniform vec3 uInteriorLight;
uniform float uRoomAO;
`;

const INTERIOR_FRAGMENT = /* glsl */ `
{
	vec3 p = vInteriorPos;
	float col = clamp( floor( ( p.x - uRoomGrid.x + 0.5 * ( uRoomGrid.y - uRoomSize.x ) ) / uRoomGrid.y ), 0.0, uRoomGrid.w - 1.0 );
	float lvl = clamp( floor( ( p.y + 0.05 ) / uRoomGrid.z ), 0.0, uRoomSize.w - 1.0 );
	vec3 roomCenter = vec3( uRoomGrid.x + uRoomSize.x * 0.5 + col * uRoomGrid.y, lvl * uRoomGrid.z + uRoomSize.y * 0.5, 0.0 );
	vec3 rel = abs( p - roomCenter ) - vec3( uRoomSize.x * 0.5 + 0.02, uRoomSize.y * 0.5 + 0.06, uRoomSize.z * 0.5 + 0.02 );
	float inside = step( max( rel.x, max( rel.y, rel.z ) ), 0.0 );

	float depthT = clamp( ( p.z + uRoomSize.z * 0.5 ) / max( uRoomSize.z, 0.01 ), 0.0, 1.0 );
	float heightT = clamp( ( p.y - lvl * uRoomGrid.z ) / uRoomSize.y, 0.0, 1.0 );
	float ao = mix( 1.0 - uRoomAO, 1.0, smoothstep( 0.0, 1.0, depthT ) ) * ( 1.0 - 0.25 * uRoomAO * heightT );
	ao = mix( 1.0, ao, inside );
	reflectedLight.indirectDiffuse *= ao;
	reflectedLight.indirectSpecular *= ao;

	vec3 lampWorld = vec3( roomCenter.x, lvl * uRoomGrid.z + uRoomSize.y - 0.2, 0.0 );
	vec3 L = ( viewMatrix * vec4( lampWorld, 1.0 ) ).xyz - geometryPosition;
	float d2 = dot( L, L );
	L *= inversesqrt( max( d2, 1e-4 ) );
	float ndl = saturate( dot( normal, L ) );
	float falloff = 1.0 / ( 1.0 + 0.12 * d2 );
	float variation = 0.8 + 0.4 * fract( sin( dot( vec2( col, lvl ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	vec3 interior = uInteriorLight * ( inside * variation * falloff * ( ndl + 0.35 ) );
	reflectedLight.directDiffuse += interior * BRDF_Lambert( diffuseColor.rgb );
}
`;

/**
 * 실내 조명 적용: 세대 천장등 빛(그림자 없음)과 안쪽 간접광 감쇠
 * 세대 수와 무관하게 광원 0개, 프래그먼트당 상수 비용
 * @param {THREE.Material} material MeshStandardMaterial 등 조명 계산이 있는 내장 재질
 * @returns {THREE.Material}
 */
export function applyInteriorLighting(material) {
  return chainPatch(material, 'interior-light', (shader) => {
    Object.assign(shader.uniforms, interiorUniforms);
    shader.vertexShader = inject(
      shader.vertexShader,
      'common',
      'varying vec3 vInteriorPos;',
    );
    shader.vertexShader = inject(
      shader.vertexShader,
      'project_vertex',
      INTERIOR_VERTEX,
    );
    shader.fragmentShader = inject(
      shader.fragmentShader,
      'common',
      INTERIOR_PARS,
    );
    shader.fragmentShader = inject(
      shader.fragmentShader,
      'lights_fragment_end',
      INTERIOR_FRAGMENT,
    );
  });
}

/** PBR 재질 (arm 텍스처를 거칠기·AO에 사용) */
function pbr(setName, tile, params = {}) {
  const set = loadPbrSet(setName, tile);
  const material = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.armMap,
    aoMap: set.armMap,
    aoMapIntensity: 0.6,
    metalness: 0,
    ...params,
  });
  material.userData.shared = true;
  return material;
}

function plain(params) {
  const material = new THREE.MeshStandardMaterial(params);
  material.userData.shared = true;
  return material;
}

let buildingSet = null;

/**
 * 건물 재질 세트 (1회 생성 후 공유)
 * 텍스처 크기는 m 단위 UV 기준, 건물 크기가 바뀌어도 밀도 일정
 */
export function getBuildingMaterialSet() {
  if (buildingSet) return buildingSet;

  const floor = applyInteriorLighting(
    applyRippleGate(
      applyHeatmapOverlay(
        pbr('laminate_floor_02', 1.7, {
          color: 0xeee6dc,
          roughness: 0.85,
          normalScale: new THREE.Vector2(0.6, 0.6),
        }),
      ),
    ),
  );
  const wall = applyInteriorLighting(
    applyHeatmapOverlay(
      pbr('white_stucco', 2.0, {
        color: 0xf6efe4,
        normalScale: new THREE.Vector2(0.35, 0.35),
      }),
    ),
  );
  const ceiling = applyInteriorLighting(
    pbr('white_stucco', 2.0, {
      color: 0xf7f6f3,
      normalScale: new THREE.Vector2(0.2, 0.2),
    }),
  );
  const structure = pbr('white_plaster_02', 1.0, {
    color: 0xbfc1c3,
    normalScale: new THREE.Vector2(0.8, 0.8),
  });
  const facade = pbr('painted_plaster_wall', 2.0, {
    color: 0xf2ede4,
    normalScale: new THREE.Vector2(0.25, 0.25),
  });
  const facadeBand = pbr('white_plaster_02', 1.0, {
    color: 0xa9adb3,
    normalScale: new THREE.Vector2(0.6, 0.6),
  });
  const roof = pbr('white_plaster_02', 1.0, { color: 0x9a9690 });
  const frame = new THREE.LineBasicMaterial({
    color: 0x555555,
    transparent: true,
    opacity: 0.4,
  });
  frame.userData.shared = true;

  const baseboard = applyInteriorLighting(
    plain({ color: 0xece8e1, roughness: 0.45 }),
  );
  const windowFrame = plain({
    color: 0x3b3f44,
    roughness: 0.4,
    metalness: 0.6,
  });
  const glass = plain({
    color: 0x2a3a48,
    roughness: 0.05,
    metalness: 0.2,
    emissive: 0x000000,
  });
  const lampPanel = plain({
    color: 0xf4f4f2,
    roughness: 0.4,
    emissive: 0x000000,
  });

  buildingSet = {
    floor,
    wall,
    ceiling,
    structure,
    facade,
    facadeBand,
    roof,
    frame,
    baseboard,
    windowFrame,
    glass,
    lampPanel,
  };
  return buildingSet;
}

/** 히트맵 모드에서 바닥·벽 질감 끄기 (법선맵 세기) */
export function setSurfaceDetail(on) {
  const set = getBuildingMaterialSet();
  set.floor.normalScale.setScalar(on ? 0.6 : 0);
  set.wall.normalScale.setScalar(on ? 0.35 : 0);
  set.floor.aoMapIntensity = on ? 0.6 : 0;
  set.wall.aoMapIntensity = on ? 0.6 : 0;
}

let furnitureSet = null;

/** 가구 공용 재질 (Kenney 모델의 재질 이름 → 재질) */
export function getFurnitureMaterials() {
  if (furnitureSet) return furnitureSet;
  const m = (params) => applyInteriorLighting(plain(params));
  furnitureSet = {
    wood: m({ color: 0xc9a27a, roughness: 0.55 }),
    woodDark: m({ color: 0x7a5a40, roughness: 0.55 }),
    carpet: m({ color: 0x8f8a83, roughness: 0.95 }),
    carpetBlue: m({ color: 0x5c6c82, roughness: 0.95 }),
    carpetWhite: m({ color: 0xece8e2, roughness: 0.9 }),
    metal: m({ color: 0xb9bdc0, roughness: 0.35, metalness: 0.7 }),
    metalLight: m({ color: 0xeceeed, roughness: 0.3, metalness: 0.2 }),
    metalMedium: m({ color: 0x6a7075, roughness: 0.4, metalness: 0.6 }),
    metalDark: m({ color: 0x2f3236, roughness: 0.35, metalness: 0.4 }),
    glass: m({
      color: 0xa8c4cc,
      roughness: 0.05,
      transparent: true,
      opacity: 0.45,
    }),
    plant: m({ color: 0x4e7f45, roughness: 0.8 }),
    lamp: m({ color: 0xfff1d6, roughness: 0.6, emissive: 0x000000 }),
    default: m({ color: 0xdedbd6, roughness: 0.6 }),
  };
  return furnitureSet;
}
