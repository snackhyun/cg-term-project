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
        this.legalThreshold = 39.0;          // 주간: 39dB, 야간: 34dB
        
        this.sampleBuffer = [];              
        this.sampleTimer = 0;                
        
        // 💡 1회 클릭 기본 소음 (28dB) -> 3회 연타 시 40dB 이상 폭증하도록 설정
        this.baseL0 = 28.0;                  
        this.waveSpeed = 4.0;                
        this.wallTL = 10.0;                  // 벽체 투과 손실 (dB)

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

    initInteraction() {
        window.addEventListener('pointerdown', (event) => {
            if (event.target.tagName !== 'CANVAS') return;

            this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersects = this.raycaster.intersectObject(this.floor);

            if (intersects.length > 0) {
                const point = intersects[0].point;
                this.addImpact(point);
            }
        });
    }

    addImpact(point) {
        this.waves.push({
            x: point.x,
            z: point.z,
            radius: 0.1,
            maxRadius: 12.0,
            time: 0,
            initialDecibel: this.baseL0
        });
    }

    update(delta) {
        // 1. 파동 소멸 시간 완화 (연타 시 소음 중첩이 선명하게 유지되도록 조정)
        for (let i = this.waves.length - 1; i >= 0; i--) {
            const w = this.waves[i];
            w.radius += this.waveSpeed * delta;
            w.time += delta;
            
            // 💡 감쇠 속도를 천천히 설정 (초당 1.5dB 감소)
            w.initialDecibel -= delta * 1.5;

            if (w.radius > w.maxRadius || w.initialDecibel <= 0) {
                this.waves.splice(i, 1);
            }
        }

        // 2. 바닥 및 벽면 히트맵 업데이트
        const peakFloor = this.updateGeometry(this.floor, this.floorGeometry, false);
        let peakWall = 0;
        this.walls.forEach((wall, idx) => {
            const geo = this.wallGeometries[idx];
            const dB = this.updateGeometry(wall, geo, true);
            if (dB > peakWall) peakWall = dB;
        });

        const currentPeakdB = this.waves.length > 0 ? Math.max(peakFloor, peakWall) : 0;

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
        const modeText = this.isNightMode ? '🌙 야간 (기준 34dB)' : '☀️ 주간 (기준 39dB)';
        
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
                        
                        // 로그 감쇠 수식
                        let dB = w.initialDecibel - 5.0 * Math.log10(r);
                        
                        if (isWall) dB -= this.wallTL;

                        if (dB > 0) {
                            totalEnergy += Math.pow(10, dB / 10);
                            const waveShape = Math.cos(dist * 2.0 - w.time * 5.0) * Math.exp(-w.time * 0.8);
                            totalDisplacement += waveShape * (dB / 30.0);
                        }
                    }
                }
            }

            // 💡 에너지 합성 공식 적용 (파동 3개 이상 중첩 시 40dB 돌파)
            const combineddB = totalEnergy > 0 ? 10 * Math.log10(totalEnergy) : 0;
            if (combineddB > maxdBInGeometry) maxdBInGeometry = combineddB;

            if (!isWall) {
                posAttr.setZ(i, Math.max(0, totalDisplacement * 0.25));
            }

            const color = this.decibelToColor(combineddB);
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
            return { r: 0.0, g: 1.0, b: 0.0 };          // 1회 클릭 (초록색 / 약 28dB)
        } else if (dB < this.legalThreshold) {
            return { r: 1.0, g: 1.0, b: 0.0 };          // 2회 클릭 (노란색 / 약 32~36dB)
        } else {
            return { r: 1.0, g: 0.0, b: 0.0 };          // 3회 이상 클릭 (빨간색 / 39dB 이상)
        }
    }
}