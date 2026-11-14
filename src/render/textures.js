/**
 * CC0 PBR 텍스처 로드 (public/assets/textures, 출처는 CREDITS.md)
 * (이름, 타일 크기)마다 1회만 로드, 건물 재생성과 무관하게 공유 (userData.shared)
 */
import * as THREE from 'three';

const BASE = `${import.meta.env?.BASE_URL ?? './'}assets/textures/`;

const loader = new THREE.TextureLoader();
/** `${name}|${tile}` → 텍스처 세트 */
const sets = new Map();
let maxAnisotropy = 8;

/** 렌더러가 지원하는 이방성 필터 상한 반영 */
export function setMaxAnisotropy(value) {
  maxAnisotropy = Math.min(8, value);
}

/**
 * color(sRGB), normal(OpenGL), arm(R AO, G 거칠기, B 금속) 세트
 * UV는 m 단위라고 가정, tile은 텍스처 1장이 덮는 길이 (m)
 * @param {string} name public/assets/textures 아래 폴더 이름
 * @param {number} tile
 * @returns {{ map, normalMap, armMap }}
 */
export function loadPbrSet(name, tile) {
  const key = `${name}|${tile}`;
  if (sets.has(key)) return sets.get(key);
  const make = (file, colorSpace) => {
    const path = `${BASE}${name}/${file}.jpg`;
    const tex = loader.load(path, undefined, undefined, () =>
      console.warn(`텍스처 로드 실패: ${path}`),
    );
    tex.colorSpace = colorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / tile, 1 / tile);
    tex.anisotropy = maxAnisotropy;
    tex.userData.shared = true;
    return tex;
  };
  const set = {
    map: make('color', THREE.SRGBColorSpace),
    normalMap: make('normal', THREE.NoColorSpace),
    armMap: make('arm', THREE.NoColorSpace),
  };
  sets.set(key, set);
  return set;
}
