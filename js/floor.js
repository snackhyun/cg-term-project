import * as THREE from 'three';

export function createFloor() {
    // 1. 바닥 생성
    const floorGeometry = new THREE.PlaneGeometry(16, 16, 64, 64);
    initColors(floorGeometry);

    const material = new THREE.MeshLambertMaterial({ 
        vertexColors: true, 
        wireframe: false,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide 
    });
    
    const floor = new THREE.Mesh(floorGeometry, material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;

    // 2. 수직 벽면 생성 (뒤쪽, 좌측, 우측 벽)
    const wallGeo1 = new THREE.PlaneGeometry(16, 8, 64, 32); // 뒤쪽 벽
    initColors(wallGeo1);
    const backWall = new THREE.Mesh(wallGeo1, material);
    backWall.position.set(0, 4, -8);

    const wallGeo2 = new THREE.PlaneGeometry(16, 8, 64, 32); // 좌측 벽
    initColors(wallGeo2);
    const leftWall = new THREE.Mesh(wallGeo2, material);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-8, 4, 0);

    const wallGeo3 = new THREE.PlaneGeometry(16, 8, 64, 32); // 우측 벽
    initColors(wallGeo3);
    const rightWall = new THREE.Mesh(wallGeo3, material);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(8, 4, 0);

    // 3. 건물 뼈대 프레임 박스
    const frameGeo = new THREE.BoxGeometry(16.2, 8, 16.2);
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x555555, wireframe: true, transparent: true, opacity: 0.4 });
    const buildingFrame = new THREE.Mesh(frameGeo, frameMat);
    buildingFrame.position.y = 4;

    const floorGroup = new THREE.Group();
    floorGroup.add(floor);
    floorGroup.add(backWall);
    floorGroup.add(leftWall);
    floorGroup.add(rightWall);
    floorGroup.add(buildingFrame);
    
    return { 
        floorGroup, 
        floor, 
        floorGeometry, 
        walls: [backWall, leftWall, rightWall],
        wallGeometries: [wallGeo1, wallGeo2, wallGeo3] 
    };
}

function initColors(geometry) {
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        colors[i * 3] = 0.0;
        colors[i * 3 + 1] = 0.6;
        colors[i * 3 + 2] = 0.5; // 기본 옥색
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}