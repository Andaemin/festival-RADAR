import { algorithmConfig } from "@/lib/services/algorithm-config";
import { calculateConfidence } from "@/lib/services/confidence-calculator";
import { adjustDuration } from "@/lib/services/duration-adjuster";
import {
  clip,
  effectiveSampleSize,
  quantile,
  weightedGeometricMean,
  weightedMean,
  weightedQuantile,
} from "@/lib/utils/weighted-statistics";
import { selectMultiYearCandidates } from "./candidate-selector";
import { computeDataQualityV3 } from "./data-quality-v3";
import { typesOverlap } from "./feature-resolver";
import { computeMultiYearSimilarity } from "./similarity-calculator";
import {
  MultiYearCandidateSelectionResult,
  MultiYearPredictionCandidate,
  MultiYearPredictionResult,
  MultiYearQuery,
  MultiYearRecordLite,
  MultiYearScoredCandidate,
} from "./types";

const cfg = algorithmConfig;

/** predictForQuery(레거시 wrapper)가 고정으로 쓰는 targetYear. Spring MultiYearBacktestFold.PRIMARY_2026. */
export const LEGACY_TARGET_YEAR = 2026;

export interface TrainingPoolResult {
  trainingPool: MultiYearRecordLite[];
  excludedLowQuality: number;
  excludedMissingFeature: number;
}

/**
 * leakage-safe training pool 구성. `datasetYear < targetYear`인 record 중 budgetQualityFlag가
 * VALID이고(그 외는 lowQuality로 제외), region/festivalType이 있는(missingFeature 아닌) 것만
 * 남긴다. Spring MultiYearBacktestDatasetBuilder.build의 training 쪽과 동일 로직.
 *
 * @param records 이미 budgetQualityFlag까지 포함해 로드된 전체(또는 datasetYear < targetYear로
 *                미리 걸러 온) record 목록. datasetYear >= targetYear인 record가 섞여 있어도
 *                이 함수가 다시 한 번 걸러내므로 leakage를 만들지 않는다.
 */
export function buildTrainingPool(
  records: (MultiYearRecordLite & { budgetQualityFlag: string })[],
  targetYear: number
): TrainingPoolResult {
  const trainingPool: MultiYearRecordLite[] = [];
  let excludedLowQuality = 0;
  let excludedMissingFeature = 0;

  for (const r of records) {
    if (r.datasetYear >= targetYear) continue; // training 대상이 아님 (leakage-safe cutoff)

    const lowQuality = r.budgetQualityFlag !== "VALID";
    const missingFeature = r.region === null || r.typeTokens.size === 0;

    if (lowQuality) {
      excludedLowQuality++;
    } else if (missingFeature) {
      excludedMissingFeature++;
    } else {
      trainingPool.push(r);
    }
  }

  return { trainingPool, excludedLowQuality, excludedMissingFeature };
}

export interface FinalSample {
  selection: MultiYearCandidateSelectionResult;
  finalSample: MultiYearScoredCandidate[];
}

/** select(trainingPool, query) -> selection 시그니처. V0(selectMultiYearCandidates)뿐 아니라
 *  V1(selectMultiYearCandidatesV1) 등 어떤 전략을 넣어도 이후 채점 단계는 절대 안 바뀐다 -
 *  Spring MultiYearCandidateSelectionStrategy와 동일한 역할. */
export type MultiYearCandidateSelectorFn = (
  trainingPool: MultiYearRecordLite[],
  query: MultiYearQuery
) => MultiYearCandidateSelectionResult;

/**
 * 후보 선정 -> 유사도 -> 기간보정 -> winsorize -> threshold+상위 N건 컷.
 * Spring MultiYearBacktestService.selectFinalSample + scoreAndFinalize를 그대로 포팅한다
 * (inflation은 이번 baseline 범위 밖이라 항상 미적용).
 *
 * winsorize 기준 모집단은 trainingPool 전체(선정된 후보군이 아니라) 중 같은 festivalType이
 * overlap하는 record의 log-budget 분포다 - trainingPool 자체가 이미 `datasetYear < targetYear`로
 * 걸러져 있으므로 이 모집단도 자동으로 leakage-safe하다.
 *
 * @param selector 기본값은 V0(selectMultiYearCandidates) - 인자를 생략하면 기존 baseline S0와
 *                 완전히 동일하게 동작한다(회귀 없음). V1 parity 검증 등에서만 다른 selector를 넣는다.
 */
export function selectFinalSample(
  trainingPool: MultiYearRecordLite[],
  query: MultiYearQuery,
  selector: MultiYearCandidateSelectorFn = selectMultiYearCandidates
): FinalSample | null {
  const selection = selector(trainingPool, query);
  if (selection.candidates.length === 0) return null;

  const typePopulationLogBudgets = trainingPool
    .filter((r) => typesOverlap(query.typeTokens, r.typeTokens))
    .map((r) => Math.log(r.budgetKrw));

  const lowerLogBound =
    typePopulationLogBudgets.length > 0 ? quantile(typePopulationLogBudgets, cfg.winsorizeLowerPercentile) : -Infinity;
  const upperLogBound =
    typePopulationLogBudgets.length > 0 ? quantile(typePopulationLogBudgets, cfg.winsorizeUpperPercentile) : Infinity;

  const scored: MultiYearScoredCandidate[] = selection.candidates.map((candidate) => {
    const score = computeMultiYearSimilarity(query, candidate);
    const candidateBudgetKrw = candidate.budgetKrw;
    const adjustedBudgetKrw =
      query.durationDays !== null
        ? adjustDuration(candidateBudgetKrw, candidate.durationDays, query.durationDays)
        : candidateBudgetKrw;
    const winsorizedBudgetKrw = Math.exp(clip(Math.log(adjustedBudgetKrw), lowerLogBound, upperLogBound));
    const originLevel = selection.originLevelByRecordId.get(candidate.id) ?? null;
    return { record: candidate, score, adjustedBudgetKrw, winsorizedBudgetKrw, originLevel };
  });

  // Array.prototype.sort는 ES2019+에서 stable 정렬이 보장된다 - weight가 같은 후보끼리는
  // selection.candidates의 원래(선정) 순서가 그대로 유지된다. Java Stream.sorted도 stable이므로
  // 이 tie-break 동작이 Spring 코드와 동일하다.
  const finalSample = scored
    .filter((c) => c.score.similarity >= cfg.similarityMinThreshold)
    .sort((a, b) => b.score.weight - a.score.weight)
    .slice(0, cfg.maxSampleCount);

  if (finalSample.length === 0) return null;
  return { selection, finalSample };
}

interface CoreStats {
  sampleCount: number;
  weightedAverage: number;
  estimated: number;
  p25: number;
  p50: number;
  p60: number;
  p75: number;
  similarityScoreAvg: number;
  completenessScore: number;
  recommendedBudget: number;
  dataQualityV3: number;
}

/**
 * "정답과 비교하지 않는" 순수 통계. Spring MultiYearBacktestService.computeCoreStats를 그대로
 * 포팅한다. legacy confidence는 예비비(contingency) 계산에만 쓰고, dataQualityV3는 완전히
 * 별개의 순수 설명용 지표로 분리해 둔다(요청사항) - 서로의 계산에 영향을 주지 않는다.
 */
function computeCoreStats(fs: FinalSample, weights: number[], districtProvided: boolean): CoreStats {
  const finalSample = fs.finalSample;
  const sampleCount = finalSample.length;
  const values = finalSample.map((c) => c.winsorizedBudgetKrw);
  const similarities = finalSample.map((c) => c.score.similarity);
  const hasDurationFlags = finalSample.map((c) => (c.record.durationDays !== null ? 1 : 0));

  const weightedAverage = weightedMean(values, weights);
  const estimated = weightedGeometricMean(values, weights);
  const p25 = weightedQuantile(values, weights, 0.25);
  const p50 = weightedQuantile(values, weights, 0.5);
  const p60 = weightedQuantile(values, weights, cfg.recommendedBasePercentile);
  const p75 = weightedQuantile(values, weights, 0.75);

  const similarityScoreAvg = weightedMean(similarities, weights);
  const completenessScore = weightedMean(hasDurationFlags, weights);

  // legacy confidence: production/단일연도 confidence-calculator.ts와 동일 공식임을 확인했으므로
  // 그대로 재사용한다(별도 multiyear 전용 구현을 만들지 않음) - 예비비율 계산에만 쓴다.
  const legacyConfidenceScore = calculateConfidence(sampleCount, similarityScoreAvg, p25, p50, p75, completenessScore).score;
  const contingencyRate = cfg.contingencyBaseRate + (1 - legacyConfidenceScore / 100) * cfg.contingencyMaxExtraRate;
  const recommendedBase = Math.max(estimated, p60);
  const recommendedBudget = recommendedBase * (1 + contingencyRate);

  const ess = effectiveSampleSize(weights);
  const originLevels = finalSample.map((c) => c.originLevel);
  const v3 = computeDataQualityV3(ess, similarityScoreAvg, p25, p75, completenessScore, originLevels, weights, districtProvided);

  return {
    sampleCount,
    weightedAverage,
    estimated,
    p25,
    p50,
    p60,
    p75,
    similarityScoreAvg,
    completenessScore,
    recommendedBudget,
    dataQualityV3: v3.score,
  };
}

function emptyResult(targetYear: number, trainingYearFrom: number, trainingYearTo: number): MultiYearPredictionResult {
  return {
    targetYear,
    trainingYearFrom,
    trainingYearTo,
    estimatedBudgetKrw: 0,
    weightedAverageBudgetKrw: 0,
    recommendedBudgetKrw: 0,
    p25Krw: 0,
    p50Krw: 0,
    p75Krw: 0,
    sampleCount: 0,
    distinctYearsUsed: 0,
    earliestSourceYear: null,
    latestSourceYear: null,
    fallbackLevel: "NONE",
    averageSimilarity: 0,
    dataQualityV3: 0,
    topCandidates: [],
  };
}

function toPredictionCandidate(c: MultiYearScoredCandidate): MultiYearPredictionCandidate {
  const r = c.record;
  return {
    sourceYear: r.datasetYear,
    festivalName: r.festivalName,
    region: r.region,
    district: r.district,
    festivalType: [...r.typeTokens].join("|"),
    venueType: r.venueType,
    durationDays: r.durationDays,
    originalBudgetKrw: r.budgetKrw,
    durationAdjustedBudgetKrw: Math.round(c.adjustedBudgetKrw),
    similarity: c.score.similarity,
    finalWeight: c.score.weight,
    fallbackStage: c.originLevel,
  };
}

/**
 * baseline S0 core - targetYear를 인자로 받는 일반화된 버전. Spring
 * MultiYearBacktestService.predictForQuery의 계산 본체(selectFinalSample+computeCoreStats
 * 조립부)에 해당한다. legacy wrapper(predictForQueryLegacy2026)뿐 아니라 향후 다른 targetYear
 * 검증(백테스트 fixture parity 등)에도 이 함수를 그대로 재사용한다.
 *
 * @param trainingPool buildTrainingPool()이 이미 `datasetYear < targetYear` + 품질/feature
 *                     필터까지 적용한 pool. 이 함수 자체는 추가로 연도 필터링을 하지 않는다 -
 *                     호출자가 trainingPool을 targetYear에 맞게 만들어 왔다고 신뢰한다(테스트/백테스트
 *                     검증에서 여러 targetYear를 재사용하기 쉽게 하기 위함).
 * @param selector 기본값 V0 - 생략하면 기존 baseline S0와 100% 동일(회귀 없음). V1 등 다른 selector로
 *                 바꿔도 이 함수 아래(유사도/기간보정/winsorize/threshold+컷/가중통계/confidence/v3)는
 *                 절대 바뀌지 않는다.
 */
export function computeBaselineEstimate(
  targetYear: number,
  trainingYearFrom: number,
  trainingYearTo: number,
  trainingPool: MultiYearRecordLite[],
  query: MultiYearQuery,
  selector: MultiYearCandidateSelectorFn = selectMultiYearCandidates
): MultiYearPredictionResult {
  const fs = selectFinalSample(trainingPool, query, selector);
  if (fs === null) {
    return emptyResult(targetYear, trainingYearFrom, trainingYearTo);
  }

  const weights = fs.finalSample.map((c) => c.score.weight);
  const stats = computeCoreStats(fs, weights, query.district !== null);

  const sampleRecords = fs.finalSample.map((c) => c.record);
  const distinctYearsUsed = new Set(sampleRecords.map((r) => r.datasetYear)).size;
  const earliestSourceYear = Math.min(...sampleRecords.map((r) => r.datasetYear));
  const latestSourceYear = Math.max(...sampleRecords.map((r) => r.datasetYear));

  const topCandidates = fs.finalSample.slice(0, 10).map(toPredictionCandidate);

  return {
    targetYear,
    trainingYearFrom,
    trainingYearTo,
    estimatedBudgetKrw: Math.round(stats.estimated),
    weightedAverageBudgetKrw: Math.round(stats.weightedAverage),
    recommendedBudgetKrw: Math.round(stats.recommendedBudget),
    p25Krw: Math.round(stats.p25),
    p50Krw: Math.round(stats.p50),
    p75Krw: Math.round(stats.p75),
    sampleCount: stats.sampleCount,
    distinctYearsUsed,
    earliestSourceYear,
    latestSourceYear,
    fallbackLevel: fs.selection.level,
    averageSimilarity: stats.similarityScoreAvg,
    dataQualityV3: stats.dataQualityV3,
    topCandidates,
  };
}

/**
 * legacy wrapper - targetYear=2026 고정. Spring MultiYearBacktestService.predictForQuery와
 * 동일 계약: `/budget-assistant` "다년도 실험 분석"이 planningYear를 안 보내면 이 경로로
 * 온다(현재 프로젝트에는 아직 그 화면/라우트가 없지만, 나중에 연결할 때 이 함수 하나만 부르면 된다).
 *
 * @param recordsBeforeTargetYear datasetYear < 2026으로 이미 걸러 온 record 목록을 권장하지만
 *                                (성능), 전체를 넘겨도 buildTrainingPool이 다시 걸러내므로
 *                                안전하다.
 */
export function predictForQueryLegacy2026(
  query: MultiYearQuery,
  recordsBeforeTargetYear: (MultiYearRecordLite & { budgetQualityFlag: string })[]
): MultiYearPredictionResult {
  const targetYear = LEGACY_TARGET_YEAR;
  const trainingYearTo = targetYear - 1;
  const { trainingPool } = buildTrainingPool(recordsBeforeTargetYear, targetYear);
  const trainingYearFrom =
    trainingPool.length > 0 ? Math.min(...trainingPool.map((r) => r.datasetYear)) : targetYear;

  return computeBaselineEstimate(targetYear, trainingYearFrom, trainingYearTo, trainingPool, query);
}
