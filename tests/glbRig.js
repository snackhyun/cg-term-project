/**
 * 테스트용 GLB 읽기 (노드 계층 + 애니메이션만, 메시·텍스처 제외)
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const FORMAT = {
  5126: ['getFloat32', 4],
  5123: ['getUint16', 2],
  5121: ['getUint8', 1],
};

/** GLB → { json, accessor(i) } */
export function readGlb(path) {
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;

  function accessor(i) {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const n = COMPONENTS[a.type];
    const [getter, size] = FORMAT[a.componentType];
    const stride = bv.byteStride ?? size * n;
    const base = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out = [];
    for (let k = 0; k < a.count; k++) {
      const row = [];
      for (let c = 0; c < n; c++)
        row.push(view[getter](base + k * stride + c * size, true));
      out.push(row);
    }
    return out;
  }
  return { json, accessor };
}

const PATHS = {
  translation: 'position',
  rotation: 'quaternion',
  scale: 'scale',
};

/** 노드 계층(Object3D)과 AnimationClip 목록 */
export function loadRig(path) {
  const { json, accessor } = readGlb(path);
  const objects = json.nodes.map((n) => {
    const o = new THREE.Object3D();
    o.name = n.name ?? '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  json.nodes.forEach((n, i) =>
    (n.children ?? []).forEach((c) => objects[i].add(objects[c])),
  );
  const scene = new THREE.Group();
  for (const i of json.scenes[json.scene ?? 0].nodes) scene.add(objects[i]);

  const animations = json.animations.map((anim) => {
    const tracks = anim.channels.map((ch) => {
      const s = anim.samplers[ch.sampler];
      const times = accessor(s.input).map((r) => r[0]);
      const values = accessor(s.output).flat();
      const name = `${json.nodes[ch.target.node].name}.${PATHS[ch.target.path]}`;
      const Track =
        ch.target.path === 'rotation'
          ? THREE.QuaternionKeyframeTrack
          : THREE.VectorKeyframeTrack;
      return new Track(name, times, values);
    });
    return new THREE.AnimationClip(anim.name, -1, tracks);
  });

  const meshTop = Math.max(
    ...json.meshes.flatMap((m) =>
      m.primitives.map((p) => json.accessors[p.attributes.POSITION].max[1]),
    ),
  );
  return { json, accessor, scene, animations, meshTop };
}
