/**
 * 뜬바닥(완충재 + 마감 모르타르) 바닥충격음 저감량
 * @see docs/acoustics-references.md 2절
 */

/**
 * 뜬바닥 공진주파수 f0 = 160·√(s′/m′)
 * @see EN 12354-2 부속서 C (LNEC, Euronoise 2012 검색 요약, ⚠️)
 * @param {number} dynamicStiffness s′ (MN/m³)
 * @param {number} screedMass 완충재 위 층 면밀도 m′ (kg/m²)
 */
export function floatingFloorResonance(dynamicStiffness, screedMass) {
  return 160 * Math.sqrt(dynamicStiffness / screedMass);
}

/**
 * 대역별 저감량 ΔL. 습식 스크리드 30·lg(f/f0), 감쇠 큰 건식 40·lg(f/f0), f ≤ f0이면 0
 * f0 부근 증폭은 표현 못함
 * @see EN 12354-2 부속서 C (R. Hall, IOA Proc. 검색 요약, ⚠️)
 */
export function floatingFloorImprovement(f, f0, { highlyDamped = false } = {}) {
  if (f <= f0) return 0;
  return (highlyDamped ? 40 : 30) * Math.log10(f / f0);
}
