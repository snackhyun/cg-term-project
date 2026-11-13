import * as THREE from 'three';

// 💡 세대(큐브) 1개의 크기
export const UNIT_SIZE = 16; // 가로·세로 (m 단위처럼 사용)
export const UNIT_HEIGHT = 8; // 층고
const UNIT_GAP = 1.0; // 세대 사이 간격 (벽·슬래브 두께를 시각적으로 표현)

/**
 * 2층 × 2세대 건물 생성
 *
 *   ┌──────┬──────┐
 *   │ 201호 │ 202호 │  ← 2층 (floorLevel 1)
 *   ├──────┼──────┤
 *   │ 101호 │ 102호 │  ← 1층 (floorLevel 0)
 *   └──────┴──────┘
 */
export function createBuilding() {
  const buildingGroup = new THREE.Group();
  const units = [];

  const layout = [
    { name: '101호', floorLevel: 0, column: 0 },
    { name: '102호', floorLevel: 0, column: 1 },
    { name: '201호', floorLevel: 1, column: 0 },
    { name: '202호', floorLevel: 1, column: 1 },
  ];

  const step = UNIT_SIZE + UNIT_GAP;
  for (const info of layout) {
    const offsetX = (info.column - 0.5) * step; // 좌우 배치 (가운데 정렬)
    const offsetY = info.floorLevel * (UNIT_HEIGHT + UNIT_GAP); // 층 높이

    const unit = createUnit(info.name, offsetX, offsetY);
    unit.floorLevel = info.floorLevel;
    unit.column = info.column;
    unit.index = units.length;
    unit.floorY = offsetY; // 바닥 높이

    // 💡 벽이 놓인 선 (파동이 벽을 타고 위·아래층으로 갈 때의 경로 계산에 사용)
    const half = UNIT_SIZE / 2;
    unit.wallLines = [
      { axis: 'z', value: -half }, // 뒤쪽 벽 (z = -8)
      { axis: 'x', value: offsetX - half }, // 좌측 벽
      { axis: 'x', value: offsetX + half }, // 우측 벽
    ];
    unit.floor.userData.unitIndex = unit.index; // 클릭한 바닥이 어느 세대인지 찾기 위함

    buildingGroup.add(unit.group);
    units.push(unit);
  }

  return { buildingGroup, units };
}

/**
 * 세대 1개 생성 (바닥 + 뒤·좌·우 벽 + 외곽 프레임 + 호수 라벨)
 * 앞쪽 벽은 내부가 보이도록 비워 둠
 */
function createUnit(name, offsetX, offsetY) {
  const half = UNIT_SIZE / 2;

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    wireframe: false,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });

  // 1. 바닥 (위층 세대의 바닥 = 아래층 세대의 천장 역할)
  const floorGeometry = new THREE.PlaneGeometry(UNIT_SIZE, UNIT_SIZE, 48, 48);
  initColors(floorGeometry);
  const floor = new THREE.Mesh(floorGeometry, material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(offsetX, offsetY, 0);

  // 2. 수직 벽면 (뒤쪽, 좌측, 우측)
  const wallGeo1 = new THREE.PlaneGeometry(UNIT_SIZE, UNIT_HEIGHT, 48, 24); // 뒤쪽 벽
  initColors(wallGeo1);
  const backWall = new THREE.Mesh(wallGeo1, material);
  backWall.position.set(offsetX, offsetY + UNIT_HEIGHT / 2, -half);

  const wallGeo2 = new THREE.PlaneGeometry(UNIT_SIZE, UNIT_HEIGHT, 48, 24); // 좌측 벽
  initColors(wallGeo2);
  const leftWall = new THREE.Mesh(wallGeo2, material);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(offsetX - half, offsetY + UNIT_HEIGHT / 2, 0);

  const wallGeo3 = new THREE.PlaneGeometry(UNIT_SIZE, UNIT_HEIGHT, 48, 24); // 우측 벽
  initColors(wallGeo3);
  const rightWall = new THREE.Mesh(wallGeo3, material);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(offsetX + half, offsetY + UNIT_HEIGHT / 2, 0);

  // 3. 세대 외곽 프레임 박스
  const frameGeo = new THREE.BoxGeometry(
    UNIT_SIZE + 0.2,
    UNIT_HEIGHT,
    UNIT_SIZE + 0.2,
  );
  const frameMat = new THREE.MeshBasicMaterial({
    color: 0x555555,
    wireframe: true,
    transparent: true,
    opacity: 0.4,
  });
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.set(offsetX, offsetY + UNIT_HEIGHT / 2, 0);

  // 4. 호수 라벨 (뒤쪽 벽 위쪽에 표시)
  const label = createLabel(name);
  label.position.set(offsetX, offsetY + UNIT_HEIGHT - 1.0, -half + 0.3);

  const group = new THREE.Group();
  group.add(floor, backWall, leftWall, rightWall, frame, label);

  return {
    name,
    group,
    floor,
    floorGeometry,
    walls: [backWall, leftWall, rightWall],
    wallGeometries: [wallGeo1, wallGeo2, wallGeo3],
    label,
  };
}

// 캔버스에 글자를 그려 스프라이트로 만든 호수 라벨
function createLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(15, 15, 20, 0.75)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false }),
  );
  sprite.scale.set(4, 1.5, 1);
  return sprite;
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
