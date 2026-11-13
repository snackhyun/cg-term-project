import * as THREE from 'three';

export class SimulationManager {
  /**
   * @param {THREE.Camera} camera
   * @param {Array} units     floor.js의 createBuilding()이 만든 세대 목록
   * @param {OrbitControls} [controls]  바닥을 누르는 동안 카메라 회전을 막기 위해 사용 (선택)
   */
  constructor(camera, units, controls = null) {
    this.camera = camera;
    this.units = units;
    this.controls = controls;
    this.floors = units.map((u) => u.floor);

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.waves = [];
    this.scheduledImpacts = []; // 프리셋에서 일정 시간 뒤에 발생시킬 충격 목록
    this.elapsed = 0; // 시뮬레이션 경과 시간(초)

    // 💡 주/야간 모드 파라미터
    this.isNightMode = false;
    this.legalThreshold = 39.0; // 주간: 39dB, 야간: 34dB (아랫집 등 수신 세대 기준)

    this.sampleTimer = 0;
    this.windowSeconds = 20; // 시연 반응성을 위해 20초 슬라이딩 윈도우 적용

    // 💡 단발 충격은 기준 이하로 유지되고, 연속/반복 소음만 기준을 넘도록 세기 보정
    //    아랫집에는 바닥 투과 손실 + 벽을 타고 내려가는 거리 감쇠만큼 줄어서 전달되므로 높게 설정
    this.baseL0 = 42.0; // 1회 클릭 기본 세기
    this.waveSpeed = 16.0; // 파동이 구조물(바닥·벽·천장)을 따라 퍼지는 속도
    this.waveLifetime = 1.4; // 파동이 사라지기 시작하는 시간(초)

    // 💡 세대 간 투과 손실 (dB)
    this.slabTL = 6.0; // 위층 → 아래층 (바닥 슬래브를 통한 충격음, 벽을 타고 내려가며 거리 감쇠가 추가로 생김)
    this.upwardTL = 25.0; // 아래층 → 위층 (충격음은 위로 잘 안 올라감)
    this.sideTL = 14.0; // 옆 세대 (세대 간 벽)

    // 💡 소음을 낸 세대의 색은 "아랫집에 전달되는 수준"으로 표시
    //    (발생 세기 그대로 칠하면 짧은 클릭에도 바로 빨간색이 되므로 낮춰서 표시 → 짧은 클릭은 초록색)
    //    색에만 적용되며, Leq 측정값에는 영향 없음
    this.sourceColorOffset = 14.0;

    // 💡 길게 누르기 파라미터
    this.isPressing = false; // 현재 마우스를 누르고 있는지
    this.pressPoint = null; // 누르고 있는 바닥 위치
    this.pressUnit = null; // 누르고 있는 세대
    this.holdTime = 0; // 누른 시간(초)
    this.emitTimer = 0; // 마지막 파동 생성 후 흐른 시간(초)
    this.emitInterval = 0.1; // 누르는 동안 파동 생성 간격(초) - 짧을수록 색 경계가 매끄러움
    this.pulseOffset = 7.0; // 파동을 촘촘히 만드는 만큼 1개당 세기를 낮춤 (0.5초 간격 대비 5배 → 10·log10(5) ≈ 7dB)
    this.growthRate = 2.5; // 누르고 있는 1초당 증가하는 dB
    this.maxL0 = 60.0; // 파동 1개의 최대 dB
    this.fadeTime = 0.8; // waveLifetime이 지난 파동이 서서히 사라지는 시간(초)
    this.edgeWidth = 2.5; // 퍼져 나가는 원의 테두리를 부드럽게 하는 폭 (색 표시용)

    // 💡 색상 깜빡임 방지: 각 정점의 색은 dB를 부드럽게 따라감
    this.colorSmoothing = 5.0; // 클수록 빠르게 반응, 작을수록 부드러움

    this.initUnits();
    this.initInteraction();
    this.updateDecibelUI();
  }

  // 세대별 측정 버퍼와 정점 캐시 준비
  initUnits() {
    for (const unit of this.units) {
      unit.sampleBuffer = []; // 1초마다 측정한 최대 dB (최근 windowSeconds개)
      unit.currentPeak = 0; // 이번 프레임의 최대 dB
      unit.lastSourceAt = -Infinity; // 마지막으로 소음을 발생시킨 시각
      unit.idle = true; // 색이 모두 기본색으로 돌아왔는지

      unit.surfaces = [
        this.createSurface(unit.floor, unit.floorGeometry, false),
        ...unit.walls.map((wall, i) =>
          this.createSurface(wall, unit.wallGeometries[i], true),
        ),
      ];
    }
  }

  // 정점의 월드 좌표를 미리 계산해 둠 (메시는 움직이지 않으므로 매 프레임 계산할 필요 없음)
  createSurface(mesh, geometry, isWall) {
    mesh.updateMatrixWorld(true);
    const posAttr = geometry.attributes.position;
    const count = posAttr.count;
    const worldX = new Float32Array(count);
    const worldY = new Float32Array(count);
    const worldZ = new Float32Array(count);
    const v = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
      worldX[i] = v.x;
      worldY[i] = v.y;
      worldZ[i] = v.z;
    }

    // 면의 x, z 범위 (파동이 이 면에 닿는지 빠르게 판단하는 데 사용)
    const bounds = {
      minX: Infinity,
      maxX: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
    };
    for (let i = 0; i < count; i++) {
      bounds.minX = Math.min(bounds.minX, worldX[i]);
      bounds.maxX = Math.max(bounds.maxX, worldX[i]);
      bounds.minZ = Math.min(bounds.minZ, worldZ[i]);
      bounds.maxZ = Math.max(bounds.maxZ, worldZ[i]);
    }

    // 벽이면 어느 선 위에 놓였는지 (x = 상수인 벽인지, z = 상수인 벽인지)
    let line = null;
    if (isWall) {
      line =
        bounds.maxX - bounds.minX < 1e-3
          ? { axis: 'x', value: bounds.minX }
          : { axis: 'z', value: bounds.minZ };
    }

    return {
      geometry,
      isWall,
      worldX,
      worldY,
      worldZ,
      bounds,
      line, // 벽이 놓인 선 (바닥이면 null)
      levelY: worldY[0], // 바닥 높이 (바닥일 때 사용)
      pathCache: new Map(), // 충격 지점별 정점 경로 거리 캐시
      smoothed: new Float32Array(count), // 정점별 평활화된 dB
      idle: true, // 색이 모두 기본색인지
    };
  }

  // 발생 세대 → 수신 세대 투과 손실 (dB)
  getTransmissionLoss(src, dst) {
    if (src === dst) return 0;

    const levelDiff = dst.floorLevel - src.floorLevel;
    let tl = 0;
    if (levelDiff < 0) tl += this.slabTL * -levelDiff; // 아래층으로
    if (levelDiff > 0) tl += this.upwardTL * levelDiff; // 위층으로
    if (dst.column !== src.column) tl += this.sideTL; // 옆 세대 (대각선이면 둘 다 더함)
    return tl;
  }

  setMode(isNight) {
    this.isNightMode = isNight;
    this.legalThreshold = isNight ? 34.0 : 39.0;
    this.updateDecibelUI();
  }

  // 💡 소음 프리셋: 201호 바닥 중앙에서 미리 정해 둔 충격을 발생시킴 (index.html 버튼에서 호출)
  triggerPreset(type) {
    const targetUnit =
      this.units.find((u) => u.name === '201호') || this.units[0];
    const centerPoint = targetUnit.floor.position.clone();

    if (type === 'walk') {
      // 가벼운 발걸음 2보: 약한 파동만 퍼지고 기준 이하 유지
      this.addImpact(centerPoint, targetUnit, 42.0);
      this.scheduledImpacts.push({
        delay: 0.6,
        point: new THREE.Vector3(
          centerPoint.x + 1.2,
          centerPoint.y,
          centerPoint.z + 0.8,
        ),
        unit: targetUnit,
        decibel: 42.0,
      });
    } else if (type === 'run') {
      // 아이 뛰기: 연속 발구름 14회 -> 지속 소음으로 기준 초과
      for (let i = 0; i < 14; i++) {
        const offsetX = (i % 2 === 0 ? -1 : 1) * 0.8;
        const offsetZ = (i - 6.5) * 0.4;
        const pt = new THREE.Vector3(
          centerPoint.x + offsetX,
          centerPoint.y,
          centerPoint.z + offsetZ,
        );
        if (i === 0) {
          this.addImpact(pt, targetUnit, 56.0);
        } else {
          this.scheduledImpacts.push({
            delay: i * 0.25,
            point: pt,
            unit: targetUnit,
            decibel: 56.0,
          });
        }
      }
    } else if (type === 'hammer') {
      // 💡 망치질 1회 단발 타격: 순간적으로 강한 파동이 퍼지지만 1번만 치면 기준 이하 유지!
      // (버튼을 3~4번 연속 클릭하면 에너지가 누적되어 기준 초과로 전환됨)
      this.addImpact(centerPoint, targetUnit, 56.0);
    }
  }

  // 💡 측정 초기화: 파동·예약된 충격·측정값을 모두 지우고 색과 바닥 변위를 기본 상태로 되돌림
  reset() {
    this.waves = [];
    this.scheduledImpacts = [];
    this.isPressing = false;
    this.pressPoint = null;
    this.pressUnit = null;
    this.sampleTimer = 0;
    if (this.controls) this.controls.enabled = true;

    const baseColor = this.decibelToColor(0);

    for (const unit of this.units) {
      unit.sampleBuffer = [];
      unit.currentPeak = 0;
      unit.lastSourceAt = -Infinity;
      unit.idle = true;

      for (const surface of unit.surfaces) {
        surface.smoothed.fill(0);
        surface.idle = true;

        const posAttr = surface.geometry.attributes.position;
        const colorAttr = surface.geometry.attributes.color;
        const count = posAttr.count;

        for (let i = 0; i < count; i++) {
          if (!surface.isWall) {
            posAttr.setZ(i, 0);
          }
          colorAttr.setXYZ(i, baseColor.r, baseColor.g, baseColor.b);
        }

        colorAttr.needsUpdate = true;
        if (!surface.isWall) {
          posAttr.needsUpdate = true;
          surface.geometry.computeVertexNormals();
        }
      }
    }

    this.updateDecibelUI();
  }

  // 화면 좌표 → 클릭한 세대 바닥 위의 3D 좌표 ({ point, unit } 또는 null)
  pickFloor(event) {
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.floors);
    if (intersects.length === 0) return null;

    const hit = intersects[0];
    return {
      point: hit.point.clone(),
      unit: this.units[hit.object.userData.unitIndex],
    };
  }

  initInteraction() {
    // 누르기 시작: 첫 파동을 바로 생성하고 누르기 상태 시작
    // (capture 단계에서 처리해 OrbitControls보다 먼저 카메라 회전을 막음)
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (event.target.tagName !== 'CANVAS') return;

        const picked = this.pickFloor(event);
        if (!picked) return; // 바닥이 아닌 곳을 누르면 평소처럼 카메라 회전

        if (this.controls) this.controls.enabled = false;

        this.isPressing = true;
        this.pressPoint = picked.point;
        this.pressUnit = picked.unit;
        this.holdTime = 0;
        this.emitTimer = 0;
        this.addImpact(picked.point, picked.unit, this.baseL0);
      },
      { capture: true },
    );

    // 누른 채로 움직이면 충격 위치도 따라감 (다른 세대 바닥으로 옮겨 갈 수도 있음)
    window.addEventListener('pointermove', (event) => {
      if (!this.isPressing) return;
      const picked = this.pickFloor(event);
      if (picked) {
        this.pressPoint = picked.point;
        this.pressUnit = picked.unit;
      }
    });

    // 손을 떼면 증폭 종료 (캔버스 밖에서 떼도 동작하도록 window에 등록)
    const stopPress = () => {
      this.isPressing = false;
      this.pressPoint = null;
      this.pressUnit = null;
      if (this.controls) this.controls.enabled = true;
    };
    window.addEventListener('pointerup', stopPress, { capture: true });
    window.addEventListener('pointercancel', stopPress, { capture: true });
  }

  addImpact(point, unit, decibel = this.baseL0) {
    unit.lastSourceAt = this.elapsed;
    this.waves.push({
      x: point.x,
      z: point.z,
      y: unit.floorY, // 충격이 일어난 바닥 높이
      unit, // 소음이 발생한 세대
      radius: 0.1, // 파동 앞부분까지의 경로 거리 (구조물 표면을 따라 잰 거리)
      maxRadius: 45.0, // 아래·위층 바닥까지 닿을 수 있도록 충분히 크게
      time: 0,
      initialDecibel: decibel,
      fade: 1.0, // 1 → 0 으로 서서히 사라짐
      fadeElapsed: 0, // 사라지기 시작한 뒤 흐른 시간(초)
    });
  }

  update(delta) {
    this.elapsed += delta;

    // 0-1. 프리셋에서 예약해 둔 충격을 시간에 맞춰 발생
    for (let i = this.scheduledImpacts.length - 1; i >= 0; i--) {
      const item = this.scheduledImpacts[i];
      item.delay -= delta;
      if (item.delay <= 0) {
        this.addImpact(item.point, item.unit, item.decibel);
        this.scheduledImpacts.splice(i, 1);
      }
    }

    // 0-2. 누르고 있는 동안: 누른 시간에 비례해 더 큰 파동을 주기적으로 생성
    if (this.isPressing && this.pressPoint) {
      this.holdTime += delta;
      this.emitTimer += delta;

      if (this.emitTimer >= this.emitInterval) {
        this.emitTimer -= this.emitInterval;
        const dB =
          Math.min(this.baseL0 + this.growthRate * this.holdTime, this.maxL0) -
          this.pulseOffset;
        this.addImpact(this.pressPoint, this.pressUnit, dB);
      }
    }

    // 1. 파동 확산 및 감쇠
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.radius = Math.min(w.radius + this.waveSpeed * delta, w.maxRadius);
      w.time += delta;

      // 💡 시간에 따른 감쇠 (초당 3dB 감소)
      w.initialDecibel -= delta * 3.0;

      // 💡 waveLifetime이 지난 파동은 fadeTime 동안 서서히 사라짐
      //    (한 번에 삭제하면 색 영역이 갑자기 줄었다 늘었다 함)
      //    직선으로 줄이면 끝에서 뚝 끊겨 보이므로 코사인 곡선(천천히 → 빠르게 → 천천히)으로 감소
      if (w.time >= this.waveLifetime) {
        w.fadeElapsed += delta;
        const p = Math.min(w.fadeElapsed / this.fadeTime, 1);
        w.fade = 0.5 * (1 + Math.cos(Math.PI * p));
      }

      if (w.fade <= 0 || w.initialDecibel <= 0) {
        this.waves.splice(i, 1);
      }
    }

    // 2. 세대별 바닥 및 벽면 히트맵 업데이트
    this.smoothAlpha = 1 - Math.exp(-this.colorSmoothing * delta);
    for (const unit of this.units) {
      this.updateUnit(unit);
    }

    // 3. 1초 간격으로 세대별 측정값 수집 (최근 windowSeconds초만 유지)
    this.sampleTimer += delta;
    if (this.sampleTimer >= 1.0) {
      this.sampleTimer = 0;

      for (const unit of this.units) {
        unit.sampleBuffer.push(unit.currentPeak);
        if (unit.sampleBuffer.length > this.windowSeconds) {
          unit.sampleBuffer.shift();
        }
      }
      this.updateDecibelUI();
    }
  }

  // 세대 하나의 모든 면(바닥 + 벽) 갱신
  updateUnit(unit) {
    // 이 세대에 닿는 파동만 추리고, 세대 간 투과 손실을 미리 계산
    const reaching = [];
    for (const w of this.waves) {
      const tl = this.getTransmissionLoss(w.unit, unit);
      if (w.initialDecibel - tl > 0) {
        reaching.push({ w, tl, isSource: w.unit === unit });
      }
    }

    // 닿는 파동도 없고 색도 이미 기본색이면 계산 생략 (성능)
    if (reaching.length === 0 && unit.idle) {
      unit.currentPeak = 0;
      return;
    }

    let peak = 0;
    let stillColored = false;
    for (const surface of unit.surfaces) {
      const result = this.updateSurface(surface, reaching, unit);
      if (result.peak > peak) peak = result.peak;
      if (result.colored) stillColored = true;
    }

    unit.currentPeak = peak;
    unit.idle = reaching.length === 0 && !stillColored;
  }

  /**
   * 💡 구조물을 따라간 경로 거리
   *    소리는 공기 중을 직선으로 가로지르지 않고 바닥 → 벽 → 천장(윗집 바닥)을 타고 전달된다고 보고,
   *    지나가는 면들을 평평하게 펼쳤을 때의 직선 거리로 계산한다.
   *
   *    (P: 충격 지점, Q: 정점, line: 거쳐 가는 벽이 놓인 선, v: 벽을 타고 오르내린 높이)
   *    x = 상수인 벽을 거칠 때:  √( (|Px - 벽| + v + |Qx - 벽|)² + (Pz - Qz)² )
   *    z = 상수인 벽을 거칠 때:  √( (Px - Qx)² + (|Pz - 벽| + v + |Qz - 벽|)² )
   */
  unfoldedDistance(px, pz, qx, qz, line, v, endsOnWall) {
    // endsOnWall: 정점 Q가 그 벽 위에 있으면 벽에서 바닥으로 다시 나가지 않음
    if (line.axis === 'x') {
      const across =
        Math.abs(px - line.value) +
        v +
        (endsOnWall ? 0 : Math.abs(qx - line.value));
      const along = pz - qz;
      return Math.sqrt(across * across + along * along);
    } else {
      const across =
        Math.abs(pz - line.value) +
        v +
        (endsOnWall ? 0 : Math.abs(qz - line.value));
      const along = px - qx;
      return Math.sqrt(across * across + along * along);
    }
  }

  /**
   * 충격 지점 하나에 대한 정점별 경로 거리를 계산해 캐시에 저장
   * 누르고 있는 동안 생기는 파동은 모두 같은 지점에서 나오므로 한 번만 계산하면 됨 (성능)
   */
  getPathCache(surface, w, unit) {
    const key = `${w.unit.index}:${w.x.toFixed(2)}:${w.z.toFixed(2)}`;
    const cached = surface.pathCache.get(key);
    if (cached) return cached;

    const { isWall, worldX, worldY, worldZ, line, levelY } = surface;
    const count = worldX.length;
    const dist = new Float32Array(count);
    const invSqrtR = new Float32Array(count);

    // 경로 종류
    //  - 같은 높이의 바닥 (발생 세대 바닥, 옆집 바닥) → 수평 직선 거리
    //  - 벽 정점 → 바닥(또는 천장)을 지나 이 벽을 타고 오르내림
    //  - 다른 층 바닥 → 벽을 타고 내려가거나 올라온 뒤 바닥을 지나감 (가장 짧은 벽 경로 선택)
    const otherLevel = !isWall && Math.abs(levelY - w.y) > 1e-3;
    const viaLines = otherLevel
      ? this.uniqueLines([...unit.wallLines, ...w.unit.wallLines])
      : null;
    const v = otherLevel ? Math.abs(levelY - w.y) : 0;

    for (let i = 0; i < count; i++) {
      let d;
      if (isWall) {
        const h = Math.abs(worldY[i] - w.y); // 벽을 타고 오르내린 높이
        d = this.unfoldedDistance(
          w.x,
          w.z,
          worldX[i],
          worldZ[i],
          line,
          h,
          true,
        );
      } else if (otherLevel) {
        d = Infinity;
        for (const via of viaLines) {
          d = Math.min(
            d,
            this.unfoldedDistance(
              w.x,
              w.z,
              worldX[i],
              worldZ[i],
              via,
              v,
              false,
            ),
          );
        }
      } else {
        const dx = worldX[i] - w.x;
        const dz = worldZ[i] - w.z;
        d = Math.sqrt(dx * dx + dz * dz);
      }
      dist[i] = d;
      invSqrtR[i] = 1 / Math.sqrt(Math.max(d, 0.5));
    }

    const result = { dist, invSqrtR };
    surface.pathCache.set(key, result);
    if (surface.pathCache.size > 16) {
      // 오래된 것부터 삭제 (드래그로 지점이 계속 바뀌는 경우 메모리 제한)
      surface.pathCache.delete(surface.pathCache.keys().next().value);
    }
    return result;
  }

  // 같은 벽 선이 두 번 들어가지 않도록 정리
  uniqueLines(lines) {
    const seen = new Set();
    return lines.filter((l) => {
      const k = `${l.axis}:${l.value.toFixed(3)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  updateSurface(surface, reaching, unit) {
    const { geometry, isWall, bounds } = surface;
    const smoothed = surface.smoothed;

    // 💡 성능: 같은 충격 지점에서 나온 파동끼리 묶음
    //    dB(r) = L - 5·log10(r)  →  에너지 10^(dB/10) = 10^(L/10) · r^(-1/2)
    //    정점까지의 경로 거리 r은 같은 지점에서 나온 파동끼리 모두 같으므로,
    //    "파동 앞부분이 이미 지나간 파동들의 계수 합 × 1/√r" 로 한 번에 계산할 수 있음
    const groups = new Map();
    for (const { w, tl, isSource } of reaching) {
      const L = w.initialDecibel - tl;
      if (L + 1.5 <= 0) continue; // r=0.5에서도 0dB 이하면 무시

      // 이 면의 영역과 전혀 겹치지 않으면 제외
      // (경로 거리는 항상 수평 거리 이상이므로 수평 거리로 먼저 걸러도 안전)
      const nx = Math.max(bounds.minX - w.x, 0, w.x - bounds.maxX);
      const nz = Math.max(bounds.minZ - w.z, 0, w.z - bounds.maxZ);
      if (nx * nx + nz * nz > w.radius * w.radius) continue;

      const path = this.getPathCache(surface, w, unit); // 정점별 경로 거리 (캐시)
      let g = groups.get(path);
      if (!g) {
        g = {
          path,
          waves: [],
          colorScale: isSource ? Math.pow(10, -this.sourceColorOffset / 10) : 1, // 색 계산용 에너지 보정
          ripple: isSource && !isWall, // 바닥 물결은 소음이 발생한 세대에서만 표시
        };
        groups.set(path, g);
      }
      g.waves.push({
        w,
        L,
        coef: Math.pow(10, L / 10) * w.fade,
        radius: w.radius,
      });
    }

    // 닿는 파동도 없고 색도 기본색이면 이 면은 건너뜀
    if (groups.size === 0 && surface.idle) {
      return { peak: 0, colored: false };
    }

    // 묶음마다 파동을 반경이 큰 순서(먼저 생긴 순서)로 정렬하고 계수 누적합을 만들어 둠
    const groupList = [...groups.values()];
    for (const g of groupList) {
      g.waves.sort((a, b) => b.radius - a.radius);
      const n = g.waves.length;
      g.radii = new Float32Array(n);
      g.prefix = new Float64Array(n + 1); // prefix[k] = 앞의 k개 파동 계수 합
      for (let k = 0; k < n; k++) {
        g.radii[k] = g.waves[k].radius;
        g.prefix[k + 1] = g.prefix[k] + g.waves[k].coef;
      }
    }

    const posAttr = geometry.attributes.position;
    const colorAttr = geometry.attributes.color;
    const count = posAttr.count;
    const alpha = this.smoothAlpha ?? 1;
    const edgeWidth = this.edgeWidth;

    let maxdB = 0;
    let colored = false;
    let displaced = false;

    for (let i = 0; i < count; i++) {
      let totalEnergy = 0; // 측정용 (실제 세기)
      let colorEnergy = 0; // 색 표시용 (발생 세대는 sourceColorOffset만큼 낮춤)
      let totalDisplacement = 0;

      for (const g of groupList) {
        // 구조물을 따라간 경로 거리 (미리 계산해 둔 값 사용)
        const dist = g.path.dist[i];
        const inv = g.path.invSqrtR[i]; // 1/√r (r은 최소 0.5)

        // 파동 앞부분이 이 정점을 지나간 파동 수 (반경 ≥ dist)
        const k = this.countAtLeast(g.radii, dist);
        if (k === 0) continue;

        // 거리에 따른 로그 감쇠 + 세대 간 투과 손실: 에너지 = 계수 합 / √r
        totalEnergy += g.prefix[k] * inv;

        // 퍼져 나가는 원의 테두리 부근(edgeWidth 이내)은 색을 점점 옅게 (경계가 칼같이 끊기지 않도록)
        const m = this.countAtLeast(g.radii, dist + edgeWidth);
        let colorCoef = g.prefix[m];
        for (let j = m; j < k; j++) {
          colorCoef += (g.waves[j].coef * (g.radii[j] - dist)) / edgeWidth;
        }
        colorEnergy += colorCoef * inv * g.colorScale;

        if (g.ripple) {
          for (let j = 0; j < k; j++) {
            const { w, L } = g.waves[j];
            const dB = L - 5.0 * Math.log10(Math.max(dist, 0.5));
            if (dB <= 0) continue;
            const waveShape =
              Math.cos(dist * 2.0 - w.time * 5.0) * Math.exp(-w.time * 0.8);
            totalDisplacement += waveShape * (dB / 30.0) * w.fade;
          }
        }
      }

      // 💡 에너지 합성 공식: 여러 파동의 에너지를 더한 뒤 dB로 변환 (L = 10·log10(Σ10^(Li/10)))
      const combineddB = totalEnergy > 1 ? 10 * Math.log10(totalEnergy) : 0;
      if (combineddB > maxdB) maxdB = combineddB;

      if (!isWall) {
        const z = Math.max(0, totalDisplacement * 0.25);
        if (z !== posAttr.getZ(i)) {
          posAttr.setZ(i, z);
          displaced = true;
        }
      }

      // 색은 평활화된 표시용 dB로 결정 (측정값 maxdB는 실제 세기 사용)
      const colordB = colorEnergy > 1 ? 10 * Math.log10(colorEnergy) : 0;
      smoothed[i] += (colordB - smoothed[i]) * alpha;
      if (smoothed[i] < 0.5 && colordB <= 0) smoothed[i] = 0;
      if (smoothed[i] > 0) colored = true;

      const color = this.decibelToColor(smoothed[i]);
      colorAttr.setXYZ(i, color.r, color.g, color.b);
    }

    colorAttr.needsUpdate = true;
    if (displaced) {
      posAttr.needsUpdate = true;
      geometry.computeVertexNormals();
    }

    surface.idle = groups.size === 0 && !colored;
    return { peak: maxdB, colored };
  }

  // 내림차순으로 정렬된 배열에서 value 이상인 원소 개수 (이진 탐색)
  countAtLeast(sortedDesc, value) {
    let lo = 0;
    let hi = sortedDesc.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedDesc[mid] >= value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  calculateLeq1Min(unit) {
    const buffer = unit.sampleBuffer;
    if (buffer.length === 0) return 0;

    let sumEnergy = 0;
    for (const dB of buffer) {
      if (dB > 0) {
        sumEnergy += Math.pow(10, dB / 10);
      }
    }

    if (sumEnergy === 0) return 0;

    // 20초 기준 분모 적용 (단발 충격 1회는 기준 이하 유지, 반복/연속 소음만 기준 초과)
    const denominator = Math.max(buffer.length, this.windowSeconds);
    const meanEnergy = sumEnergy / denominator;
    return Math.max(0, 10 * Math.log10(meanEnergy)); // 0dB 미만은 0으로 표시
  }

  // 최근 windowSeconds초(측정 구간) 안에 소음을 발생시킨 세대인지
  isSourceUnit(unit) {
    return this.elapsed - unit.lastSourceAt <= this.windowSeconds;
  }

  updateDecibelUI() {
    const uiElement = document.getElementById('leq-result');
    if (!uiElement) return;

    const modeText = this.isNightMode
      ? '🌙 야간 (기준 34dB)'
      : '☀️ 주간 (기준 39dB)';
    const sampleCount = this.units[0] ? this.units[0].sampleBuffer.length : 0;

    // 위층부터 표시 (201, 202 / 101, 102)
    const ordered = [...this.units].sort(
      (a, b) => b.floorLevel - a.floorLevel || a.column - b.column,
    );

    const rows = ordered
      .map((unit) => {
        const leq = this.calculateLeq1Min(unit);

        let statusClass = 'status-safe';
        let statusText = '⚪ 고요함';

        if (this.isSourceUnit(unit)) {
          // 소음을 낸 세대는 법적 판정 대상이 아님 (기준은 피해 세대에서 측정)
          statusClass = 'status-source';
          statusText = '🔊 발생 세대';
        } else if (leq === 0) {
          statusText = '⚪ 고요함';
        } else if (leq >= this.legalThreshold) {
          statusClass = 'status-danger';
          statusText = '⚠️ 기준 초과';
        } else {
          statusText = '✅ 기준 이하';
        }

        return `
          <div class="unit-row">
            <span class="unit-name">${unit.name}</span>
            <span class="unit-leq">${leq.toFixed(1)} dB</span>
            <span class="status-badge ${statusClass}">${statusText}</span>
          </div>`;
      })
      .join('');

    uiElement.innerHTML = `
      <div style="color: #aaa; margin-bottom: 8px;"><b>현재 설정:</b> ${modeText}</div>
      <div style="color: #aaa; font-size: 12px; margin-bottom: 6px;">세대별 평균 소음 (Leq)</div>
      ${rows}
      <div style="font-size: 11px; color: #888; margin-top: 8px;">
        (${sampleCount}/${this.windowSeconds}초 측정) · 반복·연속 소음 시 기준 초과
      </div>
    `;
  }

  /**
   * 데시벨 단계별 히트맵 색상 매핑
   */
  decibelToColor(dB) {
    const base = { r: 0.0, g: 0.6, b: 0.5 }; // 기본 옥색 (floor.js의 초기색과 동일)
    const green = { r: 0.0, g: 1.0, b: 0.0 };
    const yellow = { r: 1.0, g: 1.0, b: 0.0 };
    const red = { r: 1.0, g: 0.0, b: 0.0 };
    const blend = 2.0; // 단계 경계 바로 아래 2dB 구간에서 색을 섞어 계단처럼 바뀌지 않게 함

    if (dB <= 0) return base; // 소음 0dB
    if (dB < 20) return this.mixColor(base, green, dB / 20); // 0~20dB: 옥색 → 초록 (서서히 나타나고 사라짐)
    if (dB < 30 - blend) return green; // 초록색: 30dB 미만
    if (dB < 30)
      return this.mixColor(green, yellow, (dB - (30 - blend)) / blend);
    const t = this.legalThreshold;
    if (dB < t - blend) return yellow; // 노란색: 30dB 이상 ~ 법적 기준 미만
    if (dB < t) return this.mixColor(yellow, red, (dB - (t - blend)) / blend);
    return red; // 빨간색: 법적 기준 이상 (주간 39dB / 야간 34dB)
  }

  // 두 색을 t(0~1) 비율로 부드럽게 섞음 (smoothstep)
  mixColor(a, b, t) {
    const k = t * t * (3 - 2 * t);
    return {
      r: a.r + (b.r - a.r) * k,
      g: a.g + (b.g - a.g) * k,
      b: a.b + (b.b - a.b) * k,
    };
  }
}
