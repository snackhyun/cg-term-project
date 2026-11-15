/**
 * 바닥·벽 클릭, 길게 누르기, 드래그 → 충격
 * 누르는 즉시 'click' 1회, 누르는 동안 HOLD_EMIT_INTERVAL(0.1 s, 태핑머신 간격)마다 'hold' 1회
 * 누르는 동안 OrbitControls 회전 막기
 */
import * as THREE from 'three';
import { HOLD_EMIT_INTERVAL, sourceLevelDb } from '../acoustics/index.js';

export class PointerInteraction {
  /**
   * @param {object} opts
   * @param {(point: THREE.Vector3, unit: object, source: object, opts: { wall: number|null }) => void} opts.onImpact
   *   source = sourceLevelDb(type), wall: null 바닥, 0 뒤, 1 좌, 2 우
   */
  constructor({ camera, domElement, controls = null, onImpact }) {
    this.camera = camera;
    this.domElement = domElement;
    this.controls = controls;
    this.onImpact = onImpact;
    /** 바닥 클릭 훅 (picked, event) => true면 충격 대신 처리됨 */
    this.onFloorDown = null;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.units = [];
    this.floors = [];
    this.pickTargets = [];

    this.isPressing = false;
    this.pressPoint = null;
    this.pressUnit = null;
    this.pressWall = null;
    this.wallMap = new Map();
    this.holdTime = 0;
    this.emitTimer = 0;

    this.handleDown = this.handleDown.bind(this);
    this.handleMove = this.handleMove.bind(this);
    this.cancel = this.cancel.bind(this);

    // OrbitControls보다 먼저 받기 위해 capture
    window.addEventListener('pointerdown', this.handleDown, { capture: true });
    window.addEventListener('pointermove', this.handleMove);
    // 캔버스 밖에서 손을 떼도 멈추도록 window
    window.addEventListener('pointerup', this.cancel, { capture: true });
    window.addEventListener('pointercancel', this.cancel, { capture: true });
  }

  /**
   * @param {object[]} units
   * @param {THREE.Object3D[]} [occluders] 면을 가리는 불투명 메시 (콘크리트 구조체)
   */
  setUnits(units, occluders = []) {
    this.cancel();
    this.units = units;
    this.floors = units.map((u) => u.floor);
    this.wallMap = new Map();
    units.forEach((u) =>
      u.walls.forEach((mesh, wall) =>
        this.wallMap.set(mesh, { unitIndex: u.index, wall }),
      ),
    );
    this.pickTargets = [...this.floors, ...this.wallMap.keys(), ...occluders];
  }

  /**
   * 포인터 위치의 세대 바닥·벽 { point, unit, wall }. 없으면 null
   * wall: null 바닥, 0 뒤, 1 좌, 2 우. 가장 가까운 것이 콘크리트면 가려진 면이라 무시
   */
  pickSurface(event) {
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickTargets, false)[0];
    if (!hit) return null;
    const floorIndex = hit.object.userData.unitIndex;
    if (floorIndex !== undefined) {
      return {
        point: hit.point.clone(),
        unit: this.units[floorIndex],
        wall: null,
      };
    }
    const w = this.wallMap.get(hit.object);
    if (!w) return null;
    return {
      point: hit.point.clone(),
      unit: this.units[w.unitIndex],
      wall: w.wall,
    };
  }

  /** 바닥만 { point, unit } (하위 호환) */
  pickFloor(event) {
    const picked = this.pickSurface(event);
    return picked && picked.wall === null ? picked : null;
  }

  handleDown(event) {
    if (event.target !== this.domElement) return;
    if (event.button !== 0) return;

    const picked = this.pickSurface(event);
    if (!picked) return;
    // 캐릭터 이동 모드 등에서 바닥 클릭 가로채기
    if (picked.wall === null && this.onFloorDown?.(picked, event)) return;

    if (this.controls) this.controls.enabled = false;

    this.isPressing = true;
    this.pressPoint = picked.point;
    this.pressUnit = picked.unit;
    this.pressWall = picked.wall;
    this.holdTime = 0;
    this.emitTimer = 0;
    this.onImpact(picked.point, picked.unit, sourceLevelDb('click'), {
      wall: picked.wall,
    });
  }

  handleMove(event) {
    if (!this.isPressing) return;
    const picked = this.pickSurface(event);
    if (picked) {
      this.pressPoint = picked.point;
      this.pressUnit = picked.unit;
      this.pressWall = picked.wall;
    }
  }

  cancel() {
    const wasPressing = this.isPressing;
    this.isPressing = false;
    this.pressPoint = null;
    this.pressUnit = null;
    if (wasPressing && this.controls) this.controls.enabled = true;
  }

  update(delta) {
    if (!this.isPressing || !this.pressPoint) return;
    this.holdTime += delta;
    this.emitTimer += delta;

    if (this.emitTimer >= HOLD_EMIT_INTERVAL) {
      this.emitTimer -= HOLD_EMIT_INTERVAL;
      this.onImpact(
        this.pressPoint,
        this.pressUnit,
        sourceLevelDb('hold', { holdTime: this.holdTime }),
        { wall: this.pressWall },
      );
    }
  }

  dispose() {
    this.cancel();
    window.removeEventListener('pointerdown', this.handleDown, {
      capture: true,
    });
    window.removeEventListener('pointermove', this.handleMove);
    window.removeEventListener('pointerup', this.cancel, { capture: true });
    window.removeEventListener('pointercancel', this.cancel, { capture: true });
  }
}
