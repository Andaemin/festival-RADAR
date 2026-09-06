/** POST /api/v1/multiyear-budget-estimates 요청 본문. 기존 프로덕션 BudgetEstimateRequest와
 *  필드 성격은 같되, festivalTypes는 배열이라 다년도 데이터의 복수 유형을 그대로 지원한다. */
export interface MultiYearBudgetEstimateRequest {
  regionCode: string;
  district?: string;
  festivalTypes: string[];
  venueType: string;
  durationDays: number;
  planningYear: number;
  /** 생략하면 HISTORICAL_ONLY(가장 안전한 기본값). */
  referenceDataPolicy?: string;
  /** PHASE 9C-A(Series Shadow Integration) — optional. 있을 때만 추가로 series signal(반복
   *  개최 축제의 자기 과거 예산 이력)을 계산해 응답의 `seriesSignal`에 additive하게 담는다.
   *  없거나 빈 문자열이면 `seriesSignal.status`가 NOT_REQUESTED이고, 그 외 기존 응답 필드
   *  (estimatedBudgetKrw/recommendedBudgetKrw/P25~P75/dataQualityV3 등)는 이 필드가 없을 때와
   *  100% 동일하다 - 필수 항목이 아니다. */
  festivalName?: string;
  /** PHASE — Explicit Series Identity Routing. 사용자가 `/budget-estimator` 검색 결과에서
   *  기존 축제를 직접 선택했을 때만 채워 보내는 additive 필드 - groupId는 절대 아니다(임시
   *  counter라 왕복 금지, lib/multiyear-series/series-identity.ts 참고). 선택 시점의
   *  canonicalName + 현재 regionCode만 담는다. 없거나, canonicalName이 festivalName과 다르거나,
   *  regionCode가 이번 요청의 regionCode와 다르면 서버는 이 필드를 조용히 무시하고 기존 자동
   *  matcher(district 포함 전체 lookupTarget) 경로 그대로 동작한다 - 필수 항목이 아니다. */
  selectedSeriesIdentity?: {
    canonicalName: string;
    regionCode: string;
  };
}
