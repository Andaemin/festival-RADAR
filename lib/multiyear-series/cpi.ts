/**
 * PHASE 16-C — Series CPI production integration. Phase 16-B(C0~C3 leakage-safe 비교)에서
 * "Series에만 CPI 적용, Peer에는 미적용"(C2)이 확정된 뒤 그 semantics를 그대로 옮긴 값/공식이다.
 * 사용자가 제공한 값을 그대로 쓴다 - 튜닝/외부 조회/추정 절대 금지.
 */
export const CPI_TABLE: Readonly<Record<number, number>> = Object.freeze({
  2017: 97.645,
  2018: 99.086,
  2019: 99.466,
  2020: 100.0,
  2021: 102.5,
  2022: 107.72,
  2023: 111.59,
  2024: 114.18,
  2025: 116.61,
});

/**
 * adjustedBudget = sourceBudget × CPI[planningYear-1] / CPI[sourceYear].
 * planningYear 자체의 CPI는 절대 쓰지 않는다(target 자신의 아직 없는 미래 가격 수준을 참조하지
 * 않기 위함 - Phase 16-B 1절 공식 그대로).
 *
 * CPI_TABLE에 baseYear(planningYear-1) 또는 sourceYear가 없으면(예: planningYear>=2027이라
 * CPI[2026]이 표에 없는 경우) **null을 반환한다** - 가장 가까운 연도를 대신 쓰거나 추정하지
 * 않는다(Phase 16-C 7절 지시사항). 호출부가 null을 받으면 nominal(미보정) 값으로 fallback해야
 * 한다 - 이 함수 자체는 fallback을 하지 않는다(순수 계산만).
 */
export function tryAdjustForCpi(sourceBudgetKrw: number, sourceYear: number, planningYear: number): number | null {
  const baseYear = planningYear - 1;
  const cpiBase = CPI_TABLE[baseYear];
  const cpiSource = CPI_TABLE[sourceYear];
  if (cpiBase === undefined || cpiSource === undefined) return null;
  return sourceBudgetKrw * (cpiBase / cpiSource);
}
