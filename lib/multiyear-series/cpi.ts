/**
 * PHASE 16-C — Series CPI production integration. Phase 16-B(C0~C3 leakage-safe 비교)에서
 * "Series에만 CPI 적용, Peer에는 미적용"(C2)이 확정된 뒤 그 semantics를 그대로 옮긴 값/공식이다.
 * 사용자가 제공한 값을 그대로 쓴다 - 튜닝/추정 절대 금지.
 *
 * Feature: KOSIS CPI OpenAPI 연동 — 이 상수는 production의 유일한 source가 아니게 됐지만(이제
 * KOSIS가 primary, 이 표는 fallback) 값 자체는 삭제/변경하지 않는다. 역할이 바뀐 이유:
 *   1. KOSIS 요청 실패/timeout/invalid response 시 production fallback(lib/inflation/
 *      kosis-cpi-provider.ts 참고)
 *   2. canonical benchmark/regression test의 고정 fixture(§11 — 외부 API 호출로 인한
 *      비결정성을 만들지 않기 위해 test는 항상 이 표만 쓴다)
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
 * adjustedBudget = sourceBudget × cpiTable[planningYear-1] / cpiTable[sourceYear].
 * planningYear 자체의 CPI는 절대 쓰지 않는다(target 자신의 아직 없는 미래 가격 수준을 참조하지
 * 않기 위함 - Phase 16-B 1절 공식 그대로). 공식 자체는 KOSIS 연동 전후로 한 글자도 바뀌지 않았다.
 *
 * @param cpiTable Feature: KOSIS CPI OpenAPI 연동 — 이 계산이 참조할 연도→지수 map. 생략하면
 *                 기존과 완전히 동일하게 static `CPI_TABLE`을 쓴다(모든 기존 호출부/테스트가
 *                 인자 없이 부르므로 동작이 100% 그대로 유지된다). production route만 이 인자에
 *                 KOSIS(또는 그 fallback인 static) resolved table을 명시적으로 넘긴다 - 어느
 *                 쪽이든 "하나의 계산 안에서 한 dataset만" 쓴다(source를 연도별로 섞지 않음, §6).
 *
 * cpiTable에 baseYear(planningYear-1) 또는 sourceYear가 없으면(예: planningYear>=2027이라
 * CPI[2026]이 표에 없는 경우) **null을 반환한다** - 가장 가까운 연도를 대신 쓰거나 추정하지
 * 않는다(Phase 16-C 7절 지시사항, KOSIS 연동 후에도 동일). 호출부가 null을 받으면 nominal(미보정)
 * 값으로 fallback해야 한다 - 이 함수 자체는 fallback을 하지 않는다(순수 계산만).
 */
export function tryAdjustForCpi(
  sourceBudgetKrw: number,
  sourceYear: number,
  planningYear: number,
  cpiTable: Readonly<Record<number, number>> = CPI_TABLE
): number | null {
  const baseYear = planningYear - 1;
  const cpiBase = cpiTable[baseYear];
  const cpiSource = cpiTable[sourceYear];
  if (cpiBase === undefined || cpiSource === undefined) return null;
  return sourceBudgetKrw * (cpiBase / cpiSource);
}
