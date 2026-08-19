import { FALLBACK_LEVEL_LABEL, FestivalType, Region, VenueType } from "@/lib/domain/enums";
import {
  BudgetEstimateRequest,
  BudgetEstimateResponse,
  FestivalRecord,
  ScopeWeightShare,
  ScoredCandidate,
  SimilarFestivalDto,
} from "@/lib/domain/types";
import { clip, quantile, weightedGeometricMean, weightedMean, weightedQuantile } from "@/lib/utils/weighted-statistics";
import { algorithmConfig } from "./algorithm-config";
import { selectCandidates } from "./candidate-selector";
import { calculateConfidence, calculateConfidenceV11 } from "./confidence-calculator";
import { adjustDuration } from "./duration-adjuster";
import { computeSimilarity } from "./similarity-calculator";

const cfg = algorithmConfig;

export function estimateBudget(
  request: BudgetEstimateRequest,
  yearPool: FestivalRecord[]
): BudgetEstimateResponse {
  const region = request.regionCode as Region;
  const festivalType = request.festivalType as FestivalType;
  const venueType = request.venueType as VenueType;
  const durationDays = request.durationDays;
  const district = request.district?.trim() || null;

  const datasetYear = Math.max(...yearPool.map((r) => r.datasetYear));

  // 이상치 완화 기준: 같은 유형 모집단 전체의 P5~P95
  const typePopulationLogBudgets = yearPool
    .filter((r) => r.festivalType === festivalType && r.totalBudgetKrw !== null)
    .map((r) => Math.log(Number(r.totalBudgetKrw)));

  const lowerLogBound =
    typePopulationLogBudgets.length > 0
      ? quantile(typePopulationLogBudgets, cfg.winsorizeLowerPercentile)
      : -Infinity;
  const upperLogBound =
    typePopulationLogBudgets.length > 0
      ? quantile(typePopulationLogBudgets, cfg.winsorizeUpperPercentile)
      : Infinity;

  // 후보 선정 (계층형 fallback)
  const selection = selectCandidates(yearPool, region, district, festivalType, venueType);

  // 유사도 계산 + 기간 보정 + Winsorize
  const scored: ScoredCandidate[] = selection.candidates.map((candidate) => {
    const score = computeSimilarity(region, district, festivalType, venueType, durationDays, candidate);
    const rawBudget = Number(candidate.totalBudgetKrw ?? 0);
    const adjustedBudget = adjustDuration(rawBudget, candidate.durationDays, durationDays);
    const winsorizedBudget = Math.exp(clip(Math.log(adjustedBudget), lowerLogBound, upperLogBound));
    return { record: candidate, score, adjustedBudgetKrw: adjustedBudget, winsorizedBudgetKrw: winsorizedBudget };
  });

  // 유사도 임계값 필터 + 최대 표본 수 제한
  const finalSample = scored
    .filter((c) => c.score.similarity >= cfg.similarityMinThreshold)
    .sort((a, b) => b.score.weight - a.score.weight)
    .slice(0, cfg.maxSampleCount);

  const sampleCount = finalSample.length;

  if (sampleCount === 0) {
    return emptyResponse(datasetYear, selection.level.toString(), FALLBACK_LEVEL_LABEL[selection.level]);
  }

  const values = finalSample.map((c) => c.winsorizedBudgetKrw);
  const weights = finalSample.map((c) => c.score.weight);
  const similarities = finalSample.map((c) => c.score.similarity);
  const hasDurationFlags = finalSample.map((c) => (c.record.durationDays !== null ? 1.0 : 0.0));

  const weightedAverage = weightedMean(values, weights);
  const estimated = weightedGeometricMean(values, weights);
  const p25 = weightedQuantile(values, weights, 0.25);
  const p50 = weightedQuantile(values, weights, 0.5);
  const p60 = weightedQuantile(values, weights, cfg.recommendedBasePercentile);
  const p75 = weightedQuantile(values, weights, 0.75);

  const similarityScoreAvg = weightedMean(similarities, weights);
  const completenessScore = weightedMean(hasDurationFlags, weights);

  const confidence = calculateConfidence(sampleCount, similarityScoreAvg, p25, p50, p75, completenessScore);
  const confidenceV11 = calculateConfidenceV11(
    sampleCount, weights, similarityScoreAvg, p25, p75, completenessScore, selection.level
  );

  // 예비비
  const recommendedBase = Math.max(estimated, p60);
  const contingencyRate =
    cfg.contingencyBaseRate + (1 - confidence.score / 100) * cfg.contingencyMaxExtraRate;
  const recommendedBudget = recommendedBase * (1 + contingencyRate);

  return {
    datasetYear,
    algorithmVersion: cfg.version,
    weightedAverageBudgetKrw: Math.round(weightedAverage),
    estimatedBudgetKrw: Math.round(estimated),
    recommendedBudgetKrw: Math.round(recommendedBudget),
    typicalRange: { minKrw: Math.round(p25), maxKrw: Math.round(p75) },
    p50Krw: Math.round(p50),
    p60Krw: Math.round(p60),
    sampleCount,
    confidence: {
      score: confidence.score,
      level: confidence.level,
      label: confidence.label,
    },
    fallbackLevel: selection.level,
    fallbackLabel: FALLBACK_LEVEL_LABEL[selection.level],
    basis: buildBasis(finalSample, festivalType, region, venueType),
    warnings: buildWarnings(datasetYear, sampleCount, venueType),
    similarFestivals: buildSimilarFestivals(finalSample),
    scopeWeightBreakdown: buildScopeWeightBreakdown(finalSample, selection.originLevelByCandidateId),
  };
}

function emptyResponse(
  datasetYear: number,
  fallbackLevel: string,
  fallbackLabel: string
): BudgetEstimateResponse {
  return {
    datasetYear,
    algorithmVersion: cfg.version,
    weightedAverageBudgetKrw: 0,
    estimatedBudgetKrw: 0,
    recommendedBudgetKrw: 0,
    typicalRange: { minKrw: 0, maxKrw: 0 },
    p50Krw: 0,
    p60Krw: 0,
    sampleCount: 0,
    confidence: { score: 0, level: "LOW", label: "데이터 없음" },
    fallbackLevel,
    fallbackLabel,
    basis: [],
    warnings: ["유사한 축제 데이터가 없어 예산을 추정할 수 없습니다."],
    similarFestivals: [],
    scopeWeightBreakdown: [],
  };
}

function buildBasis(
  sample: ScoredCandidate[],
  festivalType: FestivalType,
  region: Region,
  venueType: VenueType
): string[] {
  return [
    `${sample.length}개 유사 축제 데이터 기반`,
    `축제 유형: ${festivalType}`,
    `지역: ${region}`,
    `장소 유형: ${venueType}`,
  ];
}

function buildWarnings(datasetYear: number, sampleCount: number, venueType: VenueType): string[] {
  const warnings: string[] = [];
  if (sampleCount < algorithmConfig.minSampleCount) {
    warnings.push(`유사 축제 표본이 ${sampleCount}건으로 적어 추정 정확도가 낮을 수 있습니다.`);
  }
  if (venueType === VenueType.UNDECIDED) {
    warnings.push("장소 유형이 미정으로 지정되어 추정 범위가 넓어질 수 있습니다.");
  }
  return warnings;
}

function buildSimilarFestivals(sample: ScoredCandidate[]): SimilarFestivalDto[] {
  return sample.slice(0, 5).map((c) => ({
    festivalName: c.record.festivalName,
    region: c.record.region,
    festivalType: c.record.festivalType,
    venueType: c.record.venueType,
    durationDays: c.record.durationDays,
    budgetKrw: Math.round(c.winsorizedBudgetKrw),
    similarity: Math.round(c.score.similarity * 1000) / 1000,
  }));
}

function buildScopeWeightBreakdown(
  sample: ScoredCandidate[],
  originLevelByCandidateId: Map<number, string>
): ScopeWeightShare[] {
  const totalWeight = sample.reduce((s, c) => s + c.score.weight, 0);
  if (totalWeight === 0) return [];

  const byLevel = new Map<string, number>();
  for (const c of sample) {
    const level = originLevelByCandidateId.get(c.record.id) ?? "UNKNOWN";
    byLevel.set(level, (byLevel.get(level) ?? 0) + c.score.weight);
  }

  return Array.from(byLevel.entries()).map(([level, weight]) => ({
    level,
    label: FALLBACK_LEVEL_LABEL[level as keyof typeof FALLBACK_LEVEL_LABEL] ?? level,
    weightSharePercent: (weight / totalWeight) * 100,
  }));
}
