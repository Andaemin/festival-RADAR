import { FallbackLevel } from "@/lib/domain/enums";
import { MultiYearDataQualityV3 } from "./types";

/**
 * production ConfidenceAnalysisRunner의 "confidence v3 후보" 공식을 그대로 포팅한 것이다.
 * 순수 분석/설명용 지표이며 production confidence(legacy)와는 완전히 별개다 - 예비비(contingency)
 * 계산에는 이 점수를 쓰지 않는다(legacy confidence만 쓴다, baseline-estimator.ts 참고).
 * Spring MultiYearDataQualityV3Calculator.compute를 그대로 포팅.
 */
const SAMPLE_QUALITY_DIVISOR = 15.0;
const STABILITY_QUALITY_DIVISOR = 2.0;

const SAMPLE_WEIGHT = 0.2;
const SIMILARITY_WEIGHT = 0.35;
const STABILITY_WEIGHT = 0.2;
const COMPLETENESS_WEIGHT = 0.1;
const LOCAL_EVIDENCE_WEIGHT = 0.15;

export function computeDataQualityV3(
  effectiveSampleSize: number,
  weightedSimilarityAvg: number,
  p25: number,
  p75: number,
  completenessScore: number,
  finalSampleOriginLevels: (FallbackLevel | null)[],
  finalSampleWeights: number[],
  districtProvided: boolean
): MultiYearDataQualityV3 {
  const sampleQuality = 1 - Math.exp(-effectiveSampleSize / SAMPLE_QUALITY_DIVISOR);
  const similarityQuality = weightedSimilarityAvg;
  const stabilityQuality = stabilityQualityOf(p25, p75);
  const completenessQuality = completenessScore;
  const localEvidenceQuality = localEvidenceQualityOf(finalSampleOriginLevels, finalSampleWeights, districtProvided);

  const score =
    (sampleQuality * SAMPLE_WEIGHT +
      similarityQuality * SIMILARITY_WEIGHT +
      stabilityQuality * STABILITY_WEIGHT +
      completenessQuality * COMPLETENESS_WEIGHT +
      localEvidenceQuality * LOCAL_EVIDENCE_WEIGHT) *
    100;

  return { sampleQuality, similarityQuality, stabilityQuality, completenessQuality, localEvidenceQuality, score };
}

function stabilityQualityOf(p25: number, p75: number): number {
  if (p25 <= 0 || p75 <= 0) return 0;
  const ratio = p75 / p25;
  if (!isFinite(ratio) || ratio <= 0) return 0;
  const spread = Math.max(Math.log(ratio), 0);
  return Math.exp(-spread / STABILITY_QUALITY_DIVISOR);
}

function localEvidenceQualityOf(
  originLevels: (FallbackLevel | null)[],
  weights: number[],
  districtProvided: boolean
): number {
  if (originLevels.length !== weights.length || weights.length === 0) return 0;
  let totalWeight = 0;
  let districtWeight = 0;
  let regionWeight = 0;
  for (let i = 0; i < weights.length; i++) {
    totalWeight += weights[i];
    const level = originLevels[i];
    if (level === FallbackLevel.SAME_DISTRICT_TYPE_VENUE) {
      districtWeight += weights[i];
    } else if (level === FallbackLevel.SAME_REGION_TYPE_VENUE || level === FallbackLevel.SAME_REGION_TYPE) {
      regionWeight += weights[i];
    }
    // NATIONWIDE_TYPE_VENUE / NATIONWIDE_TYPE / GLOBAL_SIMILARITY: local evidence에서 제외.
  }
  if (totalWeight <= 0) return 0;
  const districtShare = districtWeight / totalWeight;
  const regionShare = regionWeight / totalWeight;
  return districtProvided ? districtShare + 0.5 * regionShare : regionShare;
}
