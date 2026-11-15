/**
 * 캐릭터 모듈. 아이 캐릭터, 프리셋 행동, 클릭 이동
 *
 * ctx (src/main.js)
 *   scene, camera, renderer, controls, config
 *   building    createBuilding() 결과. 재생성 시 새 객체
 *   simulation  SimulationManager (재생성에도 같은 인스턴스)
 *
 * 계약
 *   initCharacter(ctx)       첫 건물·시뮬레이션 생성 후 1회
 *   update(delta)            매 프레임 simulation.update() 전. delta 최대 0.1초
 *   onBuildingRebuilt(ctx)   건물 재생성 후
 *
 * 충격: 발 착지 순간 그 발 위치에서 ctx.simulation.addImpact(point, unit, impactLevel(type))
 *   type  'walk' | 'run' | 'jump' | 'hammer' | 'drop'
 * 메시는 ctx.scene에 직접 추가 (building.group 아래는 재생성 때 dispose)
 */
import * as THREE from 'three';
import { resolvePresetUnit } from '../simulation/presets.js';
import { BehaviorRunner } from './behaviors.js';
import { Character } from './Character.js';
import { impactLevel } from './levels.js';
import { loadCharacterModel } from './model.js';
import {
  clampToRect,
  fromNormalized,
  toNormalized,
  traverseEndpoints,
  walkableRect,
} from './navigation.js';
import { DropProp, HammerProp } from './props.js';
import { initCharacterUI } from './ui.js';

/** 소품 위치: 캐릭터 앞 거리 (m) */
const PROP_DISTANCE = { hammer: 0.5, drop: 0.35 };
/** 더블클릭 판정 (초, m) */
const DOUBLE_CLICK = { time: 0.35, distance: 0.6 };

/** 모듈 상태. pending: 로드 전 요청, mode: 'impact' | 'character', impactLog: 개발용 기록 */
const state = {
  ctx: null,
  character: null,
  runner: null,
  props: [],
  pending: null,
  mode: 'impact',
  follow: false,
  lastClick: { time: -Infinity, x: 0, z: 0 },
  ui: null,
  impactLog: [],
};

function units() {
  return state.ctx.building.units;
}

function presetUnit() {
  return resolvePresetUnit(units(), state.ctx.config.simulation.presetUnit);
}

function findUnitByName(name) {
  return units().find((u) => u.name === name) ?? null;
}

/** 충격 전달 */
function emitImpact(unit, impact) {
  const level = impactLevel(impact.type, impact.opts);
  if (level === null) return;
  state.ctx.simulation.addImpact({ x: impact.x, z: impact.z }, unit, level);
  if (import.meta.env.DEV) {
    state.impactLog.push({ t: performance.now(), unit: unit.name, ...impact });
    if (state.impactLog.length > 200) state.impactLog.shift();
  }
}

function clearProps() {
  for (const prop of state.props) prop.dispose();
  state.props = [];
}

/** 캐릭터 앞 소품 위치. 걷는 영역 밖이면 방 가운데 쪽으로 돌아섬 */
function propPoint(kind) {
  const c = state.character;
  const rect = walkableRect(c.unit);
  const d = PROP_DISTANCE[kind];
  const pos = c.position;
  let x = pos.x + Math.sin(c.heading) * d;
  let z = pos.z + Math.cos(c.heading) * d;
  const inside = clampToRect(rect, x, z);
  if (inside.x !== x || inside.z !== z) {
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    if (Math.hypot(cx - pos.x, cz - pos.z) > 1e-3) c.face(cx, cz);
    else c.face(pos.x, pos.z + 1);
    x = pos.x + Math.sin(c.heading) * d;
    z = pos.z + Math.cos(c.heading) * d;
  }
  return { x, z };
}

function startProp(kind) {
  const c = state.character;
  const at = propPoint(kind);
  const prop =
    kind === 'hammer'
      ? new HammerProp(state.ctx.scene, c.unit, at, c.heading)
      : new DropProp(state.ctx.scene, c.unit, at);
  state.props.push(prop);
  return prop;
}

/** 프리셋 실행. 다른 세대면 그 세대로 옮긴 뒤 시작 */
export function runPreset(name) {
  if (!state.character) {
    state.pending = { type: 'preset', name };
    return;
  }
  const unit = presetUnit();
  if (!unit) return;
  const c = state.character;
  state.runner.cancel();
  if (c.unit !== unit) {
    const n = c.normalizedPosition();
    const p = fromNormalized(walkableRect(unit), n.u, n.v);
    c.popTo(unit, p.x, p.z, () => state.runner.start(name));
  } else {
    state.runner.start(name);
  }
}

/** 행동 정지 (감속 후 대기) */
export function stopBehavior() {
  state.pending = null;
  state.runner?.cancel();
}

/** 측정 초기화: 즉시 대기 */
export function resetCharacter() {
  stopBehavior();
  state.character?.resetPose();
}

/** 클릭 이동. 다른 세대면 열린 앞쪽(+z) 가운데에 나타나 걸어감 */
function moveToPoint(unit, x, z, run) {
  const c = state.character;
  state.runner.cancel();
  const go = () => {
    const rect = walkableRect(unit);
    const p = clampToRect(rect, x, z);
    state.runner.startCommand(
      {
        type: 'move',
        target: toNormalized(rect, p.x, p.z),
        gait: run ? 'run' : 'walk',
      },
      'click',
    );
  };
  if (c.unit !== unit) {
    const rect = walkableRect(unit);
    c.popTo(unit, (rect.minX + rect.maxX) / 2, rect.maxZ, go);
  } else {
    go();
  }
}

/** PointerInteraction 훅: 캐릭터 이동 모드면 클릭을 가져감 */
function handleFloorDown(picked, event) {
  if (state.mode !== 'character') return false;
  const now = performance.now() / 1000;
  const { x, z } = picked.point;
  const last = state.lastClick;
  const double =
    event.detail >= 2 ||
    (now - last.time < DOUBLE_CLICK.time &&
      Math.hypot(x - last.x, z - last.z) < DOUBLE_CLICK.distance);
  state.lastClick = { time: now, x, z };
  if (!state.character) {
    state.pending = {
      type: 'move',
      unitName: picked.unit.name,
      x,
      z,
      run: event.shiftKey || double,
    };
    return true;
  }
  moveToPoint(picked.unit, x, z, event.shiftKey || double);
  return true;
}

export function setInteractionMode(mode) {
  state.mode = mode === 'character' ? 'character' : 'impact';
}

export function setFollowCamera(on) {
  state.follow = on;
}

/** 첫 배치: 프리셋 세대 걷는 영역 한쪽 끝 */
function initialPlacement() {
  const unit = presetUnit();
  const [a] = traverseEndpoints(walkableRect(unit));
  state.character.place(unit, a.x, a.z);
  state.character.face(unit.centerX, unit.centerZ);
}

function flushPending() {
  const p = state.pending;
  state.pending = null;
  if (!p) return;
  if (p.type === 'preset') runPreset(p.name);
  if (p.type === 'move') {
    const unit = findUnitByName(p.unitName);
    if (unit) moveToPoint(unit, p.x, p.z, p.run);
  }
}

export function initCharacter(ctx) {
  state.ctx = ctx;
  state.ui = initCharacterUI({
    runPreset,
    stop: stopBehavior,
    reset: resetCharacter,
    setMode: setInteractionMode,
    setFollow: setFollowCamera,
  });

  if (ctx.simulation.interaction) {
    ctx.simulation.interaction.onFloorDown = handleFloorDown;
  }

  loadCharacterModel()
    .then((model) => {
      state.character = new Character(model);
      state.runner = new BehaviorRunner(state.character, {
        startProp,
        clearProps,
      });
      ctx.scene.add(model.root);
      initialPlacement();
      flushPending();
      if (import.meta.env.DEV) window.__character = state;
    })
    .catch((err) => {
      console.error('캐릭터 모델 로드 실패', err);
      state.ui?.setUnavailable();
    });
}

const _followPrev = new THREE.Vector3();

const _followGoal = new THREE.Vector3();

/** 카메라가 보는 점을 캐릭터 쪽으로 서서히 이동 (시점 방향 유지) */
function updateFollow(delta) {
  const { camera, controls } = state.ctx;
  const p = state.character.position;
  _followPrev.copy(controls.target);
  _followGoal.set(p.x, p.y + 0.6, p.z);
  controls.target.lerp(_followGoal, 1 - Math.exp(-5 * delta));
  camera.position.add(controls.target).sub(_followPrev);
}

export function update(delta) {
  const c = state.character;
  if (!c) return;
  state.runner.update(delta);
  for (const impact of c.update(delta)) emitImpact(c.unit, impact);
  for (const prop of state.props) {
    for (const impact of prop.update(delta)) emitImpact(prop.unit, impact);
    if (prop.done) prop.dispose();
  }
  state.props = state.props.filter((prop) => !prop.done);
  if (state.follow) updateFollow(delta);
}

/** 이전 세대 기준 위치를 새 세대로 옮김 */
function remap(oldUnit, newUnit, x, z) {
  const n = toNormalized(walkableRect(oldUnit), x, z);
  return fromNormalized(walkableRect(newUnit), n.u, n.v);
}

/** 건물 재생성: 같은 이름 세대로 캐릭터·소품 이동, 없으면 기본 세대에서 대기 */
export function onBuildingRebuilt(ctx) {
  state.ctx = ctx;
  if (
    ctx.simulation.interaction &&
    ctx.simulation.interaction.onFloorDown !== handleFloorDown
  ) {
    ctx.simulation.interaction.onFloorDown = handleFloorDown;
  }
  const c = state.character;
  if (!c || !c.unit) return;

  state.props = state.props.filter((prop) => {
    const unit = findUnitByName(prop.unit.name);
    if (!unit) {
      prop.dispose();
      prop.done = true;
      return false;
    }
    prop.setPlacement(unit, remap(prop.unit, unit, prop.at.x, prop.at.z));
    return true;
  });

  if (c.pop) {
    const unit = findUnitByName(c.pop.unit.name);
    if (unit) {
      const p = remap(c.pop.unit, unit, c.pop.x, c.pop.z);
      Object.assign(c.pop, { unit, x: p.x, z: p.z });
    } else {
      c.pop = null;
      c.group.scale.setScalar(1);
    }
  }

  const old = c.unit;
  const unit = findUnitByName(old.name);
  if (unit) {
    const p = remap(old, unit, c.position.x, c.position.z);
    c.place(unit, p.x, p.z);
  } else {
    state.runner.cancel();
    c.resetPose();
    const fallback = presetUnit();
    c.place(fallback, fallback.centerX, fallback.centerZ);
  }
}
