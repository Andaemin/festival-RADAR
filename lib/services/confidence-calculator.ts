import { FallbackLevel } from "@/lib/domain/enums";
import { ConfidenceResult, ConfidenceV11Result, ConfidenceV12Result } from "@/lib/domain/types";
import { effectiveSampleSize } from "@/lib/utils/weighted-statistics";
import { algorithmConfig } from "./algorithm-config";

const cfg = algorithmConfig;

type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

function resolveLevel(score: number, sampleCount: number): { level: ConfidenceLevel; label: string } {
  if (sampleCount < cfg.confidenceInsufficientSampleThreshold) return { level: "LOW", label: "데이터 부족" };
  if (score >= cfg.confidenceHighThreshold) return { level: "HIGH", label: "높음" };
  if (score >= cfg.confidenceMediumThreshold) return { level: "MEDIUM", label: "보통" };
  return { level: "LOW", label: "낮음" };
}

/** legacy v1.0 신뢰도 계산 */
export function calculateConfidence(
  sampleCount: number,
  weightedSimilarityAvg: number,
  p25: number,
  p50: number,
  p75: number,
  completenessScore: number
): ConfidenceResult {
  const sampleScore = Math.min(sampleCount / cfg.confidenceSampleScoreDivisor, 1.0);

  const cap = cfg.confidenceDispersionCap;
  const dispersionRatio = Math.min((p75 - p25) / Math.max(p50, 1), cap) / cap;
  const stabilityScore = 1 - dispersionRatio;

  const confidenceRatio =
    sampleScore * cfg.confidenceSampleWeight +
    weightedSimilarityAvg * cfg.confidenceSimilarityWeight +
    stabilityScore * cfg.confidenceStabilityWeight +
    completenessScore * cfg.confidenceCompletenessWeight;

  let score = confidenceRatio * 100;
  if (sampleCount < cfg.confidenceLowSampleCap) {
    score = Math.min(score, cfg.confidenceLowSampleCapScore);
  }

  const { level, label } = resolveLevel(score, sampleCount);
  return { score, level, label, sampleScore, similarityScore: weightedSimilarityAvg, stabilityScore, completenessScore };
}

/** v1.1 후보 공식 (비교 전용) */
export function calculateConfidenceV11(
  rawSampleCount: number,
  weights: number[],
  weightedSimilarityAvg: number,
  p25: number,
  p75: number,
  completenessScore: number,
  fallbackLevel: FallbackLevel
): ConfidenceV11Result {
  const ess = effectiveSampleSize(weights);
  const effectiveSampleScore = Math.min(ess / cfg.confidenceV11EffectiveSampleDivisor, 1.0);
  const stabilityScore = stabilityScoreV11(p25, p75);
  const scopeScore = scopeScoreFor(fallbackLevel);

  const confidenceRatio =
    effectiveSampleScore * cfg.confidenceV11SampleWeight +
    weightedSimilarityAvg * cfg.confidenceV11SimilarityWeight +
    stabilityScore * cfg.confidenceV11StabilityWeight +
    completenessScore * cfg.confidenceV11CompletenessWeight +
    scopeScore * cfg.confidenceV11ScopeWeight;

  let score = confidenceRatio * 100;
  if (rawSampleCount < cfg.confidenceLowSampleCap) {
    score = Math.min(score, cfg.confidenceLowSampleCapScore);
  }

  const { level, label } = resolveLevel(score, rawSampleCount);
  return { score, level, label, effectiveSampleSize: ess, effectiveSampleScore, stabilityScore, scopeScore };
}

/** v1.2 후보 공식 (scope 제외, 비교 전용) */
export function calculateConfidenceV12(
  rawSampleCount: number,
  effectiveSampleScore: number,
  weightedSimilarityAvg: number,
  stabilityScoreV11Value: number,
  completenessScore: number
): ConfidenceV12Result {
  const confidenceRatio =
    effectiveSampleScore * cfg.confidenceV12SampleWeight +
    weightedSimilarityAvg * cfg.confidenceV12SimilarityWeight +
    stabilityScoreV11Value * cfg.confidenceV12StabilityWeight +
    completenessScore * cfg.confidenceV12CompletenessWeight;

  let score = confidenceRatio * 100;
  if (rawSampleCount < cfg.confidenceLowSampleCap) {
    score = Math.min(score, cfg.confidenceLowSampleCapScore);
  }

  const { level, label } = resolveLevel(score, rawSampleCount);
  return { score, level, label };
}

function stabilityScoreV11(p25: number, p75: number): number {
  if (p25 <= 0 || p75 <= 0) return 0;
  const ratio = p75 / p25;
  if (!isFinite(ratio) || ratio <= 0) return 0;
  const spread = Math.max(0, Math.log(ratio));
  return 1.0 / (1.0 + spread);
}

function scopeScoreFor(level: FallbackLevel): number {
  switch (level) {
    case FallbackLevel.SAME_DISTRICT_TYPE_VENUE: return cfg.scopeScoreSameDistrictTypeVenue;
    case FallbackLevel.SAME_REGION_TYPE_VENUE: return cfg.scopeScoreSameRegionTypeVenue;
    case FallbackLevel.NATIONWIDE_TYPE_VENUE: return cfg.scopeScoreNationwideTypeVenue;
    case FallbackLevel.SAME_REGION_TYPE: return cfg.scopeScoreSameRegionType;
    case FallbackLevel.NATIONWIDE_TYPE: return cfg.scopeScoreNationwideType;
    case FallbackLevel.GLOBAL_SIMILARITY: return cfg.scopeScoreGlobalSimilarity;
  }
}
