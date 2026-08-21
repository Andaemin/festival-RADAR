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
}
