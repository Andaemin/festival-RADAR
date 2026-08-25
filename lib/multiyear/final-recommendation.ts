/**
 * PHASE 19-A — Peer(PEER_FALLBACK) 최종 recommendation을 estimator(`baseline-estimator.ts`의
 * `computeCoreStats`)로부터 분리한 순수 함수. Phase 17/18/18-B 결론(legacy confidence는
 * individual risk를 설명하지 못하고, `max(estimated, P60)`이 confidence-derived contingency 포함
 * variant보다 aggregate MdAPE/overprediction/severe overprediction 전 지표에서 우월)에 따라
 * confidence-derived contingency를 완전히 제거한다.
 *
 * <p>이 함수는 의도적으로 `computeCoreStats`(레거시 S0 - `predictForQueryLegacy2026`/
 * Spring MultiYearBacktestService.predictForQuery parity 대상, `scripts/verify-multiyear-baseline.ts`
 * golden fixture) 내부를 바꾸지 않는다 - 그 경로는 이번 Phase의 대상이 아닌 별도의 Spring-frozen
 * 레거시 계약이다. Planning V1(`estimateForPlanning`, `scripts/verify-multiyear-planning-estimate.ts`
 * golden fixture 대상)만 이 함수를 호출해 자신의 `recommendedBudgetKrw`를 다시 계산한다 - 그
 * 결과로 Planning V1의 recommendedBudget은 이제 Spring 원본 golden fixture와 값이 달라지는데,
 * 이는 실수가 아니라 이번 Phase가 의도한 변경이다(레거시 fixture는 갱신하지 않았다 - 최종 보고
 * 참고).</p>
 *
 * <p>시그니처에 confidence/dataQuality 관련 인자가 전혀 없다는 것 자체가 "legacy confidence로부터
 * 완전히 분리됐다"는 구조적 증거다 - 호출부가 실수로 그런 값을 넘기려 해도 타입 자체가 받지
 * 않는다.</p>
 */
export function computeFinalPeerRecommendation(estimatedBudgetKrw: number, p60Krw: number): number {
  return Math.max(estimatedBudgetKrw, p60Krw);
}
