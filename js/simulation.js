import * as THREE from 'three';

export class SimulationManager {
  constructor(camera, floor, floorGeometry, walls, wallGeometries) {
    this.camera = camera;
    this.floor = floor;
    this.floorGeometry = floorGeometry;
    this.walls = walls;
    this.wallGeometries = wallGeometries;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.waves = [];

    // 💡 주/야간 모드 파라미터
    this.isNightMode = false;
    this.legalThreshold = 39.0; // 주간: 39dB, 야간: 34dB

    this.sampleBuffer = [];
    this.sampleTimer = 0;

    // 💡 첫 충격 소음 (28dB) - 길게 누를수록 이 값에서부터 커짐
    this.baseL0 = 28.0;
    this.waveSpeed = 4.0;
    this.wallTL = 10.0; // 벽체 투과 손실 (dB)

    // 💡 길게 누르기 파라미터
    this.isPressing = false; // 현재 마우스를 누르고 있는지
    this.pressPoint = null; // 누르고 있는 바닥 위치
    this.holdTime = 0; // 누른 시간(초)
    this.emitTimer = 0; // 마지막 파동 생성 후 흐른 시간(초)
    this.emitInterval = 0.1; // 누르는 동안 파동 생성 간격(초) - 짧을수록 색 경계가 매끄러움
    this.pulseOffset = 7.0; // 파동을 촘촘히 만드는 만큼 1개당 세기를 낮춤 (0.5초 간격 대비 5배 → 10·log10(5) ≈ 7dB)
    this.growthRate = 2.0; // 누르고 있는 1초당 증가하는 dB
    this.maxL0 = 45.0; // 파동 1개의 최대 dB
    this.fadeTime = 1.0; // 끝까지 퍼진 파동이 서서히 사라지는 시간(초)

    // 💡 색상 깜빡임 방지: 각 정점의 색은 dB를 부드럽게 따라감
    this.colorSmoothing = 4.0; // 클수록 빠르게 반응, 작을수록 부드러움
    this.smoothedDB = new Map(); // geometry → 정점별 평활화된 dB

    this.initInteraction();
    this.initUIControls();
  }

  initUIControls() {
    this.updateDecibelUI(0);
  }

  setMode(isNight) {
    this.isNightMode = isNight;
    this.legalThreshold = isNight ? 34.0 : 39.0;
    this.updateDecibelUI(this.calculateLeq1Min());
  }

  // 화면 좌표 → 바닥 위 3D 좌표 (바닥이 아니면 null)
  getFloorPoint(event) {
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.floor);
    return intersects.length > 0 ? intersects[0].point.clone() : null;
  }

  initInteraction() {
    // 누르기 시작: 첫 파동(28dB)을 바로 생성하고 누르기 상태 시작
    window.addEventListener('pointerdown', (event) => {
      if (event.target.tagName !== 'CANVAS') return;

      const point = this.getFloorPoint(event);
      if (!point) return;

      this.isPressing = true;
      this.pressPoint = point;
      this.holdTime = 0;
      this.emitTimer = 0;
      this.addImpact(point, this.baseL0);
    });

    // 누른 채로 움직이면 충격 위치도 따라감
    window.addEventListener('pointermove', (event) => {
      if (!this.isPressing) return;
      const point = this.getFloorPoint(event);
      if (point) this.pressPoint = point;
    });

    // 손을 떼면 증폭 종료 (캔버스 밖에서 떼도 동작하도록 window에 등록)
    const stopPress = () => {
      this.isPressing = false;
      this.pressPoint = null;
    };
    window.addEventListener('pointerup', stopPress);
    window.addEventListener('pointercancel', stopPress);
  }

  addImpact(point, decibel = this.baseL0) {
    this.waves.push({
      x: point.x,
      z: point.z,
      radius: 0.1,
      maxRadius: 12.0,
      time: 0,
      initialDecibel: decibel,
      fade: 1.0, // 1 → 0 으로 서서히 사라짐
    });
  }

  update(delta) {
    // 0. 누르고 있는 동안: 누른 시간에 비례해 더 큰 파동을 주기적으로 생성
    if (this.isPressing && this.pressPoint) {
      this.holdTime += delta;
      this.emitTimer += delta;

      if (this.emitTimer >= this.emitInterval) {
        this.emitTimer -= this.emitInterval;
        const dB =
          Math.min(this.baseL0 + this.growthRate * this.holdTime, this.maxL0) -
          this.pulseOffset;
        this.addImpact(this.pressPoint, dB);
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

    // 2. 바닥 및 벽면 히트맵 업데이트
    this.smoothAlpha = 1 - Math.exp(-this.colorSmoothing * delta);
    const peakFloor = this.updateGeometry(
      this.floor,
      this.floorGeometry,
      false,
    );
    let peakWall = 0;
    this.walls.forEach((wall, idx) => {
      const geo = this.wallGeometries[idx];
      const dB = this.updateGeometry(wall, geo, true);
      if (dB > peakWall) peakWall = dB;
    });

    const currentPeakdB =
      this.waves.length > 0 ? Math.max(peakFloor, peakWall) : 0;

    // 3. 1초 간격 측정 수집
    this.sampleTimer += delta;
    if (this.sampleTimer >= 1.0) {
      this.sampleTimer = 0;

      this.sampleBuffer.push(currentPeakdB);

      if (this.sampleBuffer.length > 60) {
        this.sampleBuffer.shift();
      }

      const leq = this.calculateLeq1Min();
      this.updateDecibelUI(leq);
    }
  }

  calculateLeq1Min() {
    if (this.sampleBuffer.length === 0) return 0;

    let sumEnergy = 0;
    for (const dB of this.sampleBuffer) {
      if (dB > 0) {
        sumEnergy += Math.pow(10, dB / 10);
      }
    }

    if (sumEnergy === 0) return 0;

    const meanEnergy = sumEnergy / this.sampleBuffer.length;
    return 10 * Math.log10(meanEnergy);
  }

  updateDecibelUI(leq) {
    const uiElement = document.getElementById('leq-result');
    if (!uiElement) return;

    const isExceeded = leq >= this.legalThreshold;
    const modeText = this.isNightMode
      ? '🌙 야간 (기준 34dB)'
      : '☀️ 주간 (기준 39dB)';

    let statusClass = 'status-safe';
    let statusText = '✅ 정상 (대기 중)';

    if (leq === 0) {
      statusClass = 'status-safe';
      statusText = '⚪ 고요함 (소음 없음)';
    } else if (isExceeded) {
      statusClass = 'status-danger';
      statusText = '⚠️ 법적 기준 초과 (위반)';
    } else {
      statusClass = 'status-safe';
      statusText = '✅ 정상 (기준 이하)';
    }

    uiElement.innerHTML = `
            <div style="color: #aaa; margin-bottom: 4px;"><b>현재 설정:</b> ${modeText}</div>
            <div style="font-size: 15px; margin-bottom: 4px;">
                <b>1분 평균 소음 (Leq):</b> <span style="color:#ffcc00; font-weight:bold;">${leq.toFixed(1)} dB</span>
            </div>
            <div>
                <span class="status-badge ${statusClass}">${statusText}</span>
                <span style="font-size: 11px; color: #888; margin-left: 6px;">(${this.sampleBuffer.length}/60초 측정)</span>
            </div>
        `;
  }

  updateGeometry(mesh, geometry, isWall) {
    const posAttr = geometry.attributes.position;
    const colorAttr = geometry.attributes.color;
    const count = posAttr.count;

    mesh.updateMatrixWorld();
    const worldPos = new THREE.Vector3();
    let maxdBInGeometry = 0;

    let smoothed = this.smoothedDB.get(geometry);
    if (!smoothed) {
      smoothed = new Float32Array(count);
      this.smoothedDB.set(geometry, smoothed);
    }
    const alpha = this.smoothAlpha ?? 1;

    for (let i = 0; i < count; i++) {
      worldPos.fromBufferAttribute(posAttr, i);
      worldPos.applyMatrix4(mesh.matrixWorld);

      let totalEnergy = 0;
      let totalDisplacement = 0;

      if (this.waves.length > 0) {
        for (const w of this.waves) {
          const dx = worldPos.x - w.x;
          const dz = worldPos.z - w.z;
          const dist = Math.sqrt(dx * dx + dz * dz);

          if (dist <= w.radius) {
            const r = Math.max(dist, 0.5);

            // 거리에 따른 로그 감쇠: 충격 지점에서 멀어질수록 dB 감소
            let dB = w.initialDecibel - 5.0 * Math.log10(r);

            if (isWall) dB -= this.wallTL;

            if (dB > 0) {
              totalEnergy += Math.pow(10, dB / 10) * w.fade;
              const waveShape =
                Math.cos(dist * 2.0 - w.time * 5.0) * Math.exp(-w.time * 0.8);
              totalDisplacement += waveShape * (dB / 30.0) * w.fade;
            }
          }
        }
      }

      // 💡 에너지 합성 공식: 여러 파동의 에너지를 더한 뒤 dB로 변환 (L = 10·log10(Σ10^(Li/10)))
      const combineddB = totalEnergy > 0 ? 10 * Math.log10(totalEnergy) : 0;
      if (combineddB > maxdBInGeometry) maxdBInGeometry = combineddB;

      if (!isWall) {
        posAttr.setZ(i, Math.max(0, totalDisplacement * 0.25));
      }

      // 색은 평활화된 dB로 결정 (측정값 maxdBInGeometry는 원래 값 사용)
      smoothed[i] += (combineddB - smoothed[i]) * alpha;
      if (smoothed[i] < 0.5) smoothed[i] = combineddB > 0 ? smoothed[i] : 0;
      const color = this.decibelToColor(smoothed[i]);
      colorAttr.setXYZ(i, color.r, color.g, color.b);
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    geometry.computeVertexNormals();

    return maxdBInGeometry;
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
