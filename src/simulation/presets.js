/**
 * 프리셋 세대 선택
 * 충격은 캐릭터 행동(src/character/behaviors.js)의 발 착지·소품 타격에서 발생
 */

/** 기본 프리셋 세대: 최상층 첫 세대 */
export function defaultPresetUnit(units) {
  if (units.length === 0) return null;
  const top = Math.max(...units.map((u) => u.floorLevel));
  return units.find((u) => u.floorLevel === top && u.column === 0) ?? units[0];
}

/** 이름으로 세대 찾기. 없으면 기본 세대 */
export function resolvePresetUnit(units, name) {
  return (
    (name && units.find((u) => u.name === name)) || defaultPresetUnit(units)
  );
}
