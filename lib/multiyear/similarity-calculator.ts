import { algorithmConfig } from "@/lib/services/algorithm-config";
import { VenueType } from "@/lib/domain/enums";
import { typesOverlap } from "./feature-resolver";
import { MultiYearQuery, MultiYearRecordLite, MultiYearSimilarityScore } from "./types";

const cfg = algorithmConfig;

/**
 * baseline S0 전용 "available-feature 재정규화" 유사도. production similarity-calculator.ts와
 * 달리 venueType/durationDays 중 하나라도 없으면 고정 페널티를 주지 않고, 그 feature의 가중치까지
 * 합계에서 완전히 제외해 나머지 가중치로 재정규화한다:
 *   similarity = Σ(featureScore × weight, 두 record 모두 값 있는 feature만) / Σ(weight, 같은 조건)
 * festivalType/region은 후보 풀 진입 조건상 항상 값이 있으므로 항상 포함된다.
 * Spring MultiYearSimilarityCalculator.compute를 그대로 포팅.
 */
export function computeMultiYearSimilarity(query: MultiYearQuery, candidate: MultiYearRecordLite): MultiYearSimilarityScore {
  const typeScore = typesOverlap(query.typeTokens, candidate.typeTokens)
    ? cfg.festivalTypeSameScore
    : cfg.festivalTypeDifferentScore;
  const regionScore = computeRegionScore(query, candidate);

  const venueAvailable = query.venueType !== null && candidate.venueType !== null;
  const venueScore = venueAvailable ? venueTypeScore(query.venueType!, candidate.venueType!) : 0.0;

  const durationAvailable = query.durationDays !== null && candidate.durationDays !== null;
  const durationScore = durationAvailable ? durationScoreOf(query.durationDays!, candidate.durationDays!) : 0.0;

  const weightSum =
    cfg.festivalTypeWeight +
    cfg.regionWeight +
    (venueAvailable ? cfg.venueTypeWeight : 0) +
    (durationAvailable ? cfg.durationWeight : 0);
  const scoreSum =
    typeScore * cfg.festivalTypeWeight +
    regionScore * cfg.regionWeight +
    (venueAvailable ? venueScore * cfg.venueTypeWeight : 0) +
    (durationAvailable ? durationScore * cfg.durationWeight : 0);

  const similarity = weightSum > 0 ? scoreSum / weightSum : 0;
  const weight = similarity * similarity;

  return { typeScore, regionScore, venueAvailable, venueScore, durationAvailable, durationScore, similarity, weight };
}

function computeRegionScore(query: MultiYearQuery, candidate: MultiYearRecordLite): number {
  if (query.district !== null && query.district === candidate.district) {
    return cfg.regionSameDistrictScore;
  }
  if (query.region === candidate.region) {
    return cfg.regionSameProvinceScore;
  }
  return cfg.regionDifferentProvinceScore;
}

function venueTypeScore(requested: VenueType, candidate: VenueType): number {
  if (requested === candidate) return cfg.venueTypeSameScore;
  if (requested === VenueType.UNDECIDED || candidate === VenueType.UNDECIDED) return cfg.venueTypeOneUndecidedScore;
  return cfg.venueTypeDifferentScore;
}

function durationScoreOf(requestedDays: number, candidateDays: number): number {
  const ratio = (requestedDays + 1) / (candidateDays + 1);
  return Math.exp(-Math.abs(Math.log(ratio)));
}
