/**
 * 구조물을 따라간 경로 거리
 *
 * 소리가 공기를 가로지르지 않고 바닥 → 벽 → 천장(윗집 바닥)을 타고 전달된다고 보고,
 * 지나가는 면을 평평하게 펼친 직선 거리
 * (P: 충격 지점, Q: 정점, v: 벽을 타고 오르내린 높이)
 *   x = 상수인 벽을 거칠 때  √((|Px - 벽| + v + |Qx - 벽|)² + (Pz - Qz)²)
 *   z = 상수인 벽을 거칠 때  √((Px - Qx)² + (|Pz - 벽| + v + |Qz - 벽|)²)
 */

/**
 * @param {{ axis: 'x' | 'z', value: number }} line 거쳐 가는 벽이 놓인 선
 * @param {number} v 벽을 타고 오르내린 높이
 * @param {boolean} endsOnWall Q가 그 벽 위의 정점이면 바닥으로 다시 나가지 않음
 */
export function unfoldedDistance(px, pz, qx, qz, line, v, endsOnWall) {
  if (line.axis === 'x') {
    const across =
      Math.abs(px - line.value) +
      v +
      (endsOnWall ? 0 : Math.abs(qx - line.value));
    const along = pz - qz;
    return Math.sqrt(across * across + along * along);
  }
  const across =
    Math.abs(pz - line.value) +
    v +
    (endsOnWall ? 0 : Math.abs(qz - line.value));
  const along = px - qx;
  return Math.sqrt(across * across + along * along);
}

export function uniqueLines(lines) {
  const seen = new Set();
  return lines.filter((l) => {
    const k = `${l.axis}:${l.value.toFixed(3)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 수직 모서리를 돌아 펼친 거리 (벽 위 충격 → 직교하는 벽 정점)
 * @param {{ axis: 'x'|'z', value: number }} from 충격이 놓인 벽 선
 * @param {{ axis: 'x'|'z', value: number }} to 정점이 놓인 벽 선 (from과 직교)
 */
export function cornerDistance(px, py, pz, qx, qy, qz, from, to) {
  const alongFrom =
    from.axis === 'z' ? Math.abs(px - to.value) : Math.abs(pz - to.value);
  const alongTo =
    to.axis === 'z' ? Math.abs(qx - from.value) : Math.abs(qz - from.value);
  const a = alongFrom + alongTo;
  return Math.sqrt(a * a + (qy - py) * (qy - py));
}

/** 이 간격(m) 이하인 같은 방향 벽은 같은 벽(세대 간 벽 양면)으로 봄 */
const PARALLEL_GAP = 0.5;

/**
 * 평행한 두 벽 사이: 친 벽을 타고 바닥(또는 천장)까지, 가로질러, 상대 벽을 타고 정점까지 펼친 거리
 * 바닥·천장 높이는 충격 세대 기준
 */
export function parallelWallDistance(impact, qx, qy, qz, src, gap) {
  const along = src.axis === 'z' ? qx - impact.x : qz - impact.z;
  const floor = impact.unit.floorY;
  const ceiling = floor + impact.unit.height;
  const viaFloor = impact.y - floor + gap + Math.abs(qy - floor);
  const viaCeiling = ceiling - impact.y + gap + Math.abs(ceiling - qy);
  const a = Math.min(viaFloor, viaCeiling);
  return Math.sqrt(a * a + along * along);
}

/**
 * 면의 모든 정점에서 충격 지점까지 경로 거리
 *   같은 층 바닥  수평 직선 거리 (벽 충격이면 그 벽을 타고 내려온 뒤 바닥)
 *   벽           바닥을 지나 이 벽을 타고 오르내린 거리
 *                (벽 충격이면 직교 벽은 모서리를 돌고, 평행한 다른 벽은 바닥·천장을 거침)
 *   다른 층 바닥  viaLines 중 가장 짧은 벽을 타고 오르내린 뒤 바닥을 지나는 거리
 *
 * @param {object} surface { isWall, worldX, worldY, worldZ, line, levelY }
 * @param {object} impact { x, y, z, line?, unit? } y = 충격 높이, line = 벽 충격이면 그 벽 선
 * @returns {Float32Array}
 */
export function computePathDistances(surface, impact, otherLevel, viaLines) {
  const { isWall, worldX, worldY, worldZ, line, levelY } = surface;
  const count = worldX.length;
  const dist = new Float32Array(count);
  const v = Math.abs(levelY - impact.y);
  const src = impact.line ?? null;
  const corner = isWall && src && src.axis !== line.axis;
  const gap = isWall && src && !corner ? Math.abs(src.value - line.value) : 0;
  // 평행한 다른 벽 (세대 간 벽 두께보다 멀리): 바닥이나 천장을 거쳐 감
  const parallel = gap > PARALLEL_GAP && impact.unit;

  for (let i = 0; i < count; i++) {
    let d;
    if (corner) {
      // 직교 벽: 평면 직선은 방 공기를 가로지르므로 모서리 경로만
      d = cornerDistance(
        impact.x,
        impact.y,
        impact.z,
        worldX[i],
        worldY[i],
        worldZ[i],
        src,
        line,
      );
    } else if (parallel) {
      d = parallelWallDistance(
        impact,
        worldX[i],
        worldY[i],
        worldZ[i],
        src,
        gap,
      );
    } else if (isWall) {
      const h = Math.abs(worldY[i] - impact.y);
      d = unfoldedDistance(
        impact.x,
        impact.z,
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
          unfoldedDistance(
            impact.x,
            impact.z,
            worldX[i],
            worldZ[i],
            via,
            v,
            false,
          ),
        );
      }
    } else if (src) {
      d = unfoldedDistance(
        impact.x,
        impact.z,
        worldX[i],
        worldZ[i],
        src,
        v,
        false,
      );
    } else {
      const dx = worldX[i] - impact.x;
      const dz = worldZ[i] - impact.z;
      d = Math.sqrt(dx * dx + dz * dz);
    }
    dist[i] = d;
  }
  return dist;
}

/** 내림차순 배열에서 value 이상인 원소 개수 (이진 탐색) */
export function countAtLeast(sortedDesc, value) {
  let lo = 0;
  let hi = sortedDesc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDesc[mid] >= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
