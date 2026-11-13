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
    this.elapsed = 0; // 시뮬레이션 경과 시간(초)

    // 💡 주/야간 모드 파라미터
    this.isNightMode = false;
    this.legalThreshold = 39.0; // 주간: 39dB, 야간: 34dB (아랫집 등 수신 세대 기준)

    this.sampleTimer = 0;

    // 💡 발생 지점의 충격 소음 크기
    //    아랫집에는 slabTL만큼 줄어서 전달되므로, 그만큼 높게 설정
    //    (짧은 클릭 → 아랫집 약 28dB, 10초 정도 누르면 아랫집 기준 초과)
    this.baseL0 = 43.0;
    this.waveSpeed = 4.0;
    this.wallTL = 10.0; // 같은 세대 안에서 벽면에 표시할 때의 감쇠 (dB)

    // 💡 세대 간 투과 손실 (dB)
    this.slabTL = 15.0; // 위층 → 아래층 (바닥 슬래브를 통한 충격음)
    this.upwardTL = 25.0; // 아래층 → 위층 (충격음은 위로 잘 안 올라감)
    this.sideTL = 15.0; // 옆 세대 (세대 간 벽)

    // 💡 길게 누르기 파라미터
    this.isPressing = false; // 현재 마우스를 누르고 있는지
    this.pressPoint = null; // 누르고 있는 바닥 위치
    this.pressUnit = null; // 누르고 있는 세대
    this.holdTime = 0; // 누른 시간(초)
    this.emitTimer = 0; // 마지막 파동 생성 후 흐른 시간(초)
    this.emitInterval = 0.1; // 누르는 동안 파동 생성 간격(초) - 짧을수록 색 경계가 매끄러움
    this.pulseOffset = 7.0; // 파동을 촘촘히 만드는 만큼 1개당 세기를 낮춤 (0.5초 간격 대비 5배 → 10·log10(5) ≈ 7dB)
    this.growthRate = 2.0; // 누르고 있는 1초당 증가하는 dB
    this.maxL0 = 60.0; // 파동 1개의 최대 dB
    this.fadeTime = 1.0; // 끝까지 퍼진 파동이 서서히 사라지는 시간(초)

    // 💡 색상 깜빡임 방지: 각 정점의 색은 dB를 부드럽게 따라감
    this.colorSmoothing = 4.0; // 클수록 빠르게 반응, 작을수록 부드러움

    this.initUnits();
    this.initInteraction();
    this.updateDecibelUI();
  }

  // 세대별 측정 버퍼와 정점 캐시 준비
  initUnits() {
    for (const unit of this.units) {
      unit.sampleBuffer = []; // 1초마다 측정한 최대 dB (최근 60개)
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

  // 정점의 월드 좌표(x, z)를 미리 계산해 둠 (메시는 움직이지 않으므로 매 프레임 계산할 필요 없음)
  createSurface(mesh, geometry, isWall) {
    mesh.updateMatrixWorld(true);
    const posAttr = geometry.attributes.position;
    const count = posAttr.count;
    const worldX = new Float32Array(count);
    const worldZ = new Float32Array(count);
    const v = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
      worldX[i] = v.x;
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

    return {
      geometry,
      isWall,
      worldX,
      worldZ,
      bounds,
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
      unit, // 소음이 발생한 세대
      radius: 0.1,
      maxRadius: 12.0,
      time: 0,
      initialDecibel: decibel,
      fade: 1.0, // 1 → 0 으로 서서히 사라짐
    });
  }

  update(delta) {
    this.elapsed += delta;

    // 0. 누르고 있는 동안: 누른 시간에 비례해 더 큰 파동을 주기적으로 생성
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
      // 반지름은 최대치에서 멈춤 → 끝에 닿아도 바로 삭제하지 않음
      w.radius = Math.min(w.radius + this.waveSpeed * delta, w.maxRadius);
      w.time += delta;

      // 💡 감쇠 속도를 천천히 설정 (초당 1.5dB 감소)
      w.initialDecibel -= delta * 1.5;

      // 💡 끝까지 퍼진 파동은 fadeTime 동안 서서히 사라짐
      //    (한 번에 삭제하면 색 영역이 갑자기 줄었다 늘었다 함)
      if (w.radius >= w.maxRadius) {
        w.fade -= delta / this.fadeTime;
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

    // 3. 1초 간격으로 세대별 측정값 수집
    this.sampleTimer += delta;
    if (this.sampleTimer >= 1.0) {
      this.sampleTimer = 0;

      for (const unit of this.units) {
        unit.sampleBuffer.push(unit.currentPeak);
        if (unit.sampleBuffer.length > 60) {
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
      const result = this.updateSurface(surface, reaching);
      if (result.peak > peak) peak = result.peak;
      if (result.colored) stillColored = true;
    }

    unit.currentPeak = peak;
    unit.idle = reaching.length === 0 && !stillColored;
  }

  updateSurface(surface, reaching) {
    const { geometry, isWall, worldX, worldZ, smoothed, bounds } = surface;

    // 💡 성능: 파동마다 한 번만 계산해 두는 값들
    //    dB(r) = L - 5·log10(r)  →  에너지 10^(dB/10) = 10^(L/10) · r^(-1/2)
    //    따라서 정점마다 pow/log10을 계산하지 않고 "계수 / √r" 로 에너지를 구함
    const active = [];
    for (const { w, tl, isSource } of reaching) {
      const L = w.initialDecibel - tl - (isWall ? this.wallTL : 0);
      if (L + 1.5 <= 0) continue; // r=0.5에서도 0dB 이하면 무시

      // dB > 0 이 되는 최대 거리와 현재 파동 반경 중 작은 값까지만 계산
      const audibleRange = Math.max(Math.pow(10, L / 5), 0.5);
      const range = Math.min(w.radius, audibleRange);

      // 이 면의 영역과 전혀 겹치지 않으면 제외
      const nx = Math.max(bounds.minX - w.x, 0, w.x - bounds.maxX);
      const nz = Math.max(bounds.minZ - w.z, 0, w.z - bounds.maxZ);
      if (nx * nx + nz * nz > range * range) continue;

      active.push({
        w,
        L,
        coef: Math.pow(10, L / 10) * w.fade,
        range2: range * range,
        ripple: isSource && !isWall, // 바닥 물결은 소음이 발생한 세대에서만 표시
      });
    }

    // 닿는 파동도 없고 색도 기본색이면 이 면은 건너뜀
    if (active.length === 0 && surface.idle) {
      return { peak: 0, colored: false };
    }

    const posAttr = geometry.attributes.position;
    const colorAttr = geometry.attributes.color;
    const count = posAttr.count;
    const alpha = this.smoothAlpha ?? 1;

    let maxdB = 0;
    let colored = false;
    let displaced = false;

    for (let i = 0; i < count; i++) {
      let totalEnergy = 0;
      let totalDisplacement = 0;

      for (const a of active) {
        const dx = worldX[i] - a.w.x;
        const dz = worldZ[i] - a.w.z;
        const dist2 = dx * dx + dz * dz;
        if (dist2 > a.range2) continue;

        // 거리에 따른 로그 감쇠 + 세대 간 투과 손실 (r은 최소 0.5)
        const dist = Math.sqrt(dist2);
        const r = Math.max(dist, 0.5);
        totalEnergy += a.coef / Math.sqrt(r);

        if (a.ripple) {
          const dB = a.L - 5.0 * Math.log10(r);
          const waveShape =
            Math.cos(dist * 2.0 - a.w.time * 5.0) * Math.exp(-a.w.time * 0.8);
          totalDisplacement += waveShape * (dB / 30.0) * a.w.fade;
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

      // 색은 평활화된 dB로 결정 (측정값 maxdB는 원래 값 사용)
      smoothed[i] += (combineddB - smoothed[i]) * alpha;
      if (smoothed[i] < 0.5 && combineddB <= 0) smoothed[i] = 0;
      if (smoothed[i] > 0) colored = true;

      const color = this.decibelToColor(smoothed[i]);
      colorAttr.setXYZ(i, color.r, color.g, color.b);
    }

    colorAttr.needsUpdate = true;
    if (displaced) {
      posAttr.needsUpdate = true;
      geometry.computeVertexNormals();
    }

    surface.idle = active.length === 0 && !colored;
    return { peak: maxdB, colored };
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

    const meanEnergy = sumEnergy / buffer.length;
    return Math.max(0, 10 * Math.log10(meanEnergy)); // 0dB 미만은 0으로 표시
  }

  // 최근 60초(측정 구간) 안에 소음을 발생시킨 세대인지
  isSourceUnit(unit) {
    return this.elapsed - unit.lastSourceAt <= 60;
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
            <div style="color: #aaa; font-size: 12px; margin-bottom: 6px;">세대별 1분 평균 소음 (Leq)</div>
            ${rows}
            <div style="font-size: 11px; color: #888; margin-top: 8px;">
                (${sampleCount}/60초 측정) · 판정은 소음을 받은 세대 기준
            </div>
        `;
  }

  /**
   * 데시벨 단계별 히트맵 색상 매핑
   */
  decibelToColor(dB) {
    if (dB <= 0) return { r: 0.0, g: 0.5, b: 0.5 }; // 소음 0dB (기본 옥색)

    if (dB < 30) {
      return { r: 0.0, g: 1.0, b: 0.0 }; // 초록색: 30dB 미만
    } else if (dB < this.legalThreshold) {
      return { r: 1.0, g: 1.0, b: 0.0 }; // 노란색: 30dB 이상 ~ 법적 기준 미만
    } else {
      return { r: 1.0, g: 0.0, b: 0.0 }; // 빨간색: 법적 기준 이상 (주간 39dB / 야간 34dB)
    }
  }
}
