/**
 * 캐릭터 모델 로드, 클립 구성
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  JUMP,
  LEG,
  RUN,
  WALK,
  gaitPose,
  jumpDuration,
  jumpPose,
  sampleTimes,
} from './gait.js';

/** 모델 경로 (public/ 기준) */
export const MODEL_URL = `${import.meta.env.BASE_URL}assets/character/character-female-b.glb`;

/** 아이 키 (m) */
export const CHARACTER_HEIGHT = 1.15;

const LEG_NAMES = ['leg-left', 'leg-right'];
/** 원본 GLB에 있어야 하는 클립 */
export const REQUIRED_CLIPS = ['idle', 'walk', 'sprint', 'jump'];
/** 원본에서 대체할 트랙 (다리, 루트) */
const REPLACED = /^(root|leg-left|leg-right)\./;

function quatX(theta) {
  return [Math.sin(theta / 2), 0, 0, Math.cos(theta / 2)];
}

/** 원본 클립 트랙을 times에 맞춰 반복 샘플링 */
function resampleTrack(track, times, sourceDuration) {
  const interp = track.createInterpolant();
  const size = track.getValueSize();
  const values = new Float32Array(times.length * size);
  times.forEach((t, i) => {
    const v = interp.evaluate(t % sourceDuration);
    values.set(v.slice(0, size), i * size);
  });
  return new track.constructor(track.name, times, values);
}

/**
 * 자세 함수로 다리·루트 트랙 생성
 * @param {(t:number) => {rootY:number, squash?:number, legs:{theta:number, lift:number}[]}} poseAt
 */
function poseTracks(poseAt, times, legRest) {
  const rootPos = [];
  const rootScale = [];
  const legQuat = [[], []];
  const legPos = [[], []];
  for (const t of times) {
    const pose = poseAt(t);
    rootPos.push(0, pose.rootY, 0);
    const s = pose.squash ?? 1;
    rootScale.push(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    pose.legs.forEach((leg, i) => {
      legQuat[i].push(...quatX(leg.theta));
      const r = legRest[i];
      legPos[i].push(r.x, r.y + leg.lift, r.z);
    });
  }
  return [
    new THREE.VectorKeyframeTrack('root.position', times, rootPos),
    new THREE.VectorKeyframeTrack('root.scale', times, rootScale),
    ...LEG_NAMES.flatMap((name, i) => [
      new THREE.QuaternionKeyframeTrack(
        `${name}.quaternion`,
        times,
        legQuat[i],
      ),
      new THREE.VectorKeyframeTrack(`${name}.position`, times, legPos[i]),
    ]),
  ];
}

/** 원본 팔·머리 + 생성한 다리 트랙으로 걷기·뛰기 클립 */
function buildGaitClip(name, source, params, legRest) {
  const times = sampleTimes(params.period, 60);
  const kept = source.tracks
    .filter((t) => !REPLACED.test(t.name))
    .map((t) => resampleTrack(t, times, source.duration));
  const tracks = [
    ...kept,
    ...poseTracks((t) => gaitPose(params, t), times, legRest),
  ];
  return new THREE.AnimationClip(name, params.period, tracks);
}

/** 제자리 점프 1회 클립 (팔·머리는 원본 jump) */
function buildJumpClip(source, legRest) {
  const duration = jumpDuration(JUMP);
  const times = sampleTimes(duration, 60);
  const kept = source.tracks
    .filter((t) => !REPLACED.test(t.name))
    .map((t) => resampleTrack(t, times, source.duration));
  const tracks = [...kept, ...poseTracks((t) => jumpPose(t), times, legRest)];
  return new THREE.AnimationClip('jump', duration, tracks);
}

/**
 * 모델 로드
 * @returns {Promise<ReturnType<typeof assembleCharacter>>}
 */
export async function loadCharacterModel(url = MODEL_URL) {
  const gltf = await new GLTFLoader().loadAsync(url);
  return assembleCharacter(gltf.scene, gltf.animations);
}

/**
 * 로드한 장면 + 클립 → 캐릭터 구성 (스케일, 발 표식, 클립)
 * @param {THREE.Object3D} model glTF 장면
 * @param {THREE.AnimationClip[]} animations
 * @param {{ modelHeight?: number }} [opts] 메시 없는 장면(테스트)용 모델 키
 * @returns {{ root: THREE.Group, model: THREE.Object3D, scale: number, clips: Record<string, THREE.AnimationClip>, feet: {heel: THREE.Object3D, toe: THREE.Object3D}[], dispose: () => void }}
 */
export function assembleCharacter(model, animations, opts = {}) {
  let height = opts.modelHeight;
  if (!height) {
    const box = new THREE.Box3().setFromObject(model);
    height = box.max.y - box.min.y;
  }
  const scale = CHARACTER_HEIGHT / height;

  const root = new THREE.Group();
  root.name = 'character';
  const body = new THREE.Group();
  body.scale.setScalar(scale);
  body.add(model);
  root.add(body);

  model.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = false;
      obj.frustumCulled = false; // 스킨 메시 경계는 정지 자세 기준
    }
  });

  const legs = LEG_NAMES.map((n) => model.getObjectByName(n));
  if (legs.some((l) => !l)) throw new Error('캐릭터 다리 본 없음');
  const legRest = legs.map((l) => l.position.clone());

  const feet = legs.map((leg) => {
    const heel = new THREE.Object3D();
    heel.position.set(0, -LEG.length, LEG.heelZ);
    const toe = new THREE.Object3D();
    toe.position.set(0, -LEG.length, LEG.toeZ);
    leg.add(heel, toe);
    return { heel, toe };
  });

  const byName = Object.fromEntries(animations.map((c) => [c.name, c]));
  for (const n of REQUIRED_CLIPS) {
    if (!byName[n]) throw new Error(`캐릭터 클립 없음: ${n}`);
  }

  const clips = {
    idle: byName.idle,
    walk: buildGaitClip('walk', byName.walk, WALK, legRest),
    run: buildGaitClip('run', byName.sprint, RUN, legRest),
    jump: buildJumpClip(byName.jump, legRest),
  };
  if (byName['interact-right']) clips.interact = byName['interact-right'];

  return {
    root,
    model,
    scale,
    clips,
    feet,
    dispose() {
      root.removeFromParent();
      const skeletons = new Set();
      root.traverse((obj) => {
        if (obj.isSkinnedMesh) skeletons.add(obj.skeleton);
        if (!obj.isMesh) return;
        obj.geometry.dispose();
        for (const m of [obj.material].flat()) {
          for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
          m.dispose();
        }
      });
      for (const sk of skeletons) sk.dispose();
    },
  };
}
