import { computeCoreStats, selectFinalSample, toPredictionCandidate } from "./baseline-estimator";
import { selectMultiYearCandidatesV1 } from "./candidate-selector-v1";
import { MultiYearPublicationStatusValue, ReferenceDataPolicy, resolveEffectivePolicy } from "./reference-data-policy";
import { filterReferencePool } from "./reference-year-filter";
import { MultiYearPredictionCandidate, MultiYearQuery, MultiYearRecordLite } from "./types";
import { buildYearWeightBreakdown, effectiveYearCount, MultiYearYearWeightShare } from "./year-concentration";

/** Spring MultiYearExperimentalEstimateService의 model identifier와 동일 - 레거시 S0
 *  (MULTIYEAR_BASELINE_S0)와 명확히 구분한다. */
export const MULTIYEAR_PLANNING_MODEL = "MULTIYEAR_PLANNING_V1";

export interface MultiYearPlanningEstimateResult {
  planningYear: number;
  requestedReferenceDataPolicy: ReferenceDataPolicy;
  appliedReferenceDataPolicy: ReferenceDataPolicy;
  referenceYearFrom: number;
  referenceYearTo: number;
  estimatedBudgetKrw: number;
  weightedAverageBudgetKrw: number;
  recommendedBudgetKrw: number;
  p25Krw: number;
  p50Krw: number;
  p60Krw: number;
  p75Krw: number;
  sampleCount: number;
  distinctYearsUsed: number;
  effectiveYearCount: number;
  earliestSourceYear: number | null;
  latestSourceYear: number | null;
  fallbackLevel: string;
  averageSimilarity: number;
  dataQualityV3: number;
  yearWeightBreakdown: MultiYearYearWeightShare[];
  topCandidates: MultiYearPredictionCandidate[];
}

function emptyPlanningResult(
  planningYear: number,
  requested: ReferenceDataPolicy,
  applied: ReferenceDataPolicy,
  referenceYearFrom: number,
  referenceYearTo: number
): MultiYearPlanningEstimateResult {
  return {
    planningYear,
    requestedReferenceDataPolicy: requested,
    appliedReferenceDataPolicy: applied,
    referenceYearFrom,
    referenceYearTo,
    estimatedBudgetKrw: 0,
    weightedAverageBudgetKrw: 0,
    recommendedBudgetKrw: 0,
    p25Krw: 0,
    p50Krw: 0,
    p60Krw: 0,
    p75Krw: 0,
    sampleCount: 0,
    distinctYearsUsed: 0,
    effectiveYearCount: 0,
    earliestSourceYear: null,
    latestSourceYear: null,
    fallbackLevel: "NONE",
    averageSimilarity: 0,
    dataQualityV3: 0,
    yearWeightBreakdown: [],
    topCandidates: [],
  };
}

/**
 * planningYear를 직접 받는 일반화된 예측 진입점. Spring
 * MultiYearBacktestService.estimateForPlanning을 그대로 포팅한다. predictForQueryLegacy2026(S0,
 * targetYear=2026 고정)과 완전히 독립적인 경로다 - 서로 다른 selector(V1)/다른 연도 범위(publication
 * policy 기반)를 쓴다. 유사도/기간보정/winsorize/threshold+상위N건컷/가중통계/legacy confidence/v3는
 * baseline-estimator.ts의 selectFinalSample+computeCoreStats를 그대로 재사용한다 - 이 함수 자체는
 * 새 계산식을 추가하지 않는다.
 *
 * @param requestedPolicy 호출자가 요청한 정책. INCLUDE_PUBLISHED_SAME_YEAR인데 planningYear
 *                        데이터셋이 아직 PUBLISHED_PLAN_COMPLETE로 표시돼 있지 않으면 자동으로
 *                        HISTORICAL_ONLY로 낮춰 적용한다 - 결과의 appliedReferenceDataPolicy로 확인 가능.
 * @param allRecords 필터링 전 전체 record - planningYear보다 미래인 record가 섞여 있어도 이 함수가
 *                   절대 포함시키지 않는다(leakage-safe, filterReferencePool 참고).
 * @param publicationStatusByYear loadPublicationStatusByYear()가 만든 연도->상태 Map.
 */
export function estimateForPlanning(
  query: MultiYearQuery,
  planningYear: number,
  requestedPolicy: ReferenceDataPolicy,
  allRecords: (MultiYearRecordLite & { budgetQualityFlag: string })[],
  publicationStatusByYear: Map<number, MultiYearPublicationStatusValue>
): MultiYearPlanningEstimateResult {
  const appliedPolicy = resolveEffectivePolicy(planningYear, requestedPolicy, (year) => publicationStatusByYear.get(year) ?? null);
  const includeSameYear = appliedPolicy === ReferenceDataPolicy.INCLUDE_PUBLISHED_SAME_YEAR;
  const referencePool = filterReferencePool(allRecords, planningYear, includeSameYear);

  const referenceYearFrom =
    referencePool.length > 0 ? Math.min(...referencePool.map((r) => r.datasetYear)) : planningYear;
  const referenceYearTo = includeSameYear ? planningYear : planningYear - 1;

  const fs = selectFinalSample(referencePool, query, selectMultiYearCandidatesV1);
  if (fs === null) {
    return emptyPlanningResult(planningYear, requestedPolicy, appliedPolicy, referenceYearFrom, referenceYearTo);
  }

  const weights = fs.finalSample.map((c) => c.score.weight);
  const stats = computeCoreStats(fs, weights, query.district !== null);

  const sampleRecords = fs.finalSample.map((c) => c.record);
  const distinctYearsUsed = new Set(sampleRecords.map((r) => r.datasetYear)).size;
  const earliestSourceYear = Math.min(...sampleRecords.map((r) => r.datasetYear));
  const latestSourceYear = Math.max(...sampleRecords.map((r) => r.datasetYear));

  const yearWeightRows = fs.finalSample.map((c, i) => ({ datasetYear: c.record.datasetYear, weight: weights[i] }));
  const effYearCount = effectiveYearCount(yearWeightRows);
  const yearWeightBreakdown = buildYearWeightBreakdown(yearWeightRows);

  const topCandidates = fs.finalSample.slice(0, 10).map(toPredictionCandidate);

  return {
    planningYear,
    requestedReferenceDataPolicy: requestedPolicy,
    appliedReferenceDataPolicy: appliedPolicy,
    referenceYearFrom,
    referenceYearTo,
    estimatedBudgetKrw: Math.round(stats.estimated),
    weightedAverageBudgetKrw: Math.round(stats.weightedAverage),
    recommendedBudgetKrw: Math.round(stats.recommendedBudget),
    p25Krw: Math.round(stats.p25),
    p50Krw: Math.round(stats.p50),
    p60Krw: Math.round(stats.p60),
    p75Krw: Math.round(stats.p75),
    sampleCount: stats.sampleCount,
    distinctYearsUsed,
    effectiveYearCount: effYearCount,
    earliestSourceYear,
    latestSourceYear,
    fallbackLevel: fs.selection.level,
    averageSimilarity: stats.similarityScoreAvg,
    dataQualityV3: stats.dataQualityV3,
    yearWeightBreakdown,
    topCandidates,
  };
}
