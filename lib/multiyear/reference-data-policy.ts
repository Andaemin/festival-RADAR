/**
 * Budget Planning Assistant가 어떤 연도까지의 참고 개최계획 데이터를 쓸지 결정하는 정책.
 * `planningYear`(기획하려는 연도) 기준이며, backtest의 leakage-safe 평가 정책(datasetYear <
 * targetYear, buildTrainingPool)과는 완전히 별개다 - 절대 섞이지 않는다.
 * Spring ReferenceDataPolicy를 그대로 포팅.
 */
export enum ReferenceDataPolicy {
  /** referenceYear < planningYear. 예: 2027 기획 -> 2017~2026 전체를 참고 데이터로 사용. */
  HISTORICAL_ONLY = "HISTORICAL_ONLY",
  /** referenceYear <= planningYear. planningYear 자체의 데이터셋이 PUBLISHED_PLAN_COMPLETE일 때만 유효 -
   *  아니면 estimateForPlanning이 자동으로 HISTORICAL_ONLY로 낮춰 적용하고 appliedReferenceDataPolicy에
   *  그 사실을 그대로 드러낸다(요청 정책을 조용히 바꿔치기하지 않는다). */
  INCLUDE_PUBLISHED_SAME_YEAR = "INCLUDE_PUBLISHED_SAME_YEAR",
}

/** "그 해 축제가 모두 개최·집행 완료됐다"는 뜻이 아니다 - "해당 연도(datasetYear)의 지역축제
 *  개최계획(예산 포함) 데이터셋 원본이 공개 기준으로 완성되어, 아직 그 해 축제가 실제로 열리기
 *  전이라도 계획예산 참고자료로 안전하게 쓸 수 있다"는 뜻이다. Spring
 *  MultiYearDatasetPublicationStatusValue와 동일 정의. */
export type MultiYearPublicationStatusValue = "PARTIAL" | "PUBLISHED_PLAN_COMPLETE";

/**
 * requested != INCLUDE_PUBLISHED_SAME_YEAR면 그대로 HISTORICAL_ONLY다. same-year를 요청했을 때만
 * publication status를 조회해서, PUBLISHED_PLAN_COMPLETE로 명시적으로 표시된 연도만 통과시킨다.
 * row가 없는 연도(statusLookup이 null 반환)는 PARTIAL과 동일하게 취급한다(안전한 기본값) -
 * Spring resolveEffectivePolicy와 동일.
 */
export function resolveEffectivePolicy(
  planningYear: number,
  requested: ReferenceDataPolicy,
  statusLookup: (year: number) => MultiYearPublicationStatusValue | null
): ReferenceDataPolicy {
  if (requested !== ReferenceDataPolicy.INCLUDE_PUBLISHED_SAME_YEAR) {
    return ReferenceDataPolicy.HISTORICAL_ONLY;
  }
  const status = statusLookup(planningYear);
  const publishedComplete = status === "PUBLISHED_PLAN_COMPLETE";
  return publishedComplete ? ReferenceDataPolicy.INCLUDE_PUBLISHED_SAME_YEAR : ReferenceDataPolicy.HISTORICAL_ONLY;
}
