import { FestivalType, Region, VenueType } from "@/lib/domain/enums";
import { FestivalRecord, SimilarityScore } from "@/lib/domain/types";
import { algorithmConfig } from "./algorithm-config";

const cfg = algorithmConfig;

function festivalTypeScore(requested: FestivalType, candidate: FestivalType): number {
  return requested === candidate ? cfg.festivalTypeSameScore : cfg.festivalTypeDifferentScore;
}

function regionScore(
  requestedRegion: Region,
  requestedDistrict: string | null,
  candidateRegion: Region,
  candidateDistrict: string | null
): number {
  if (requestedDistrict && requestedDistrict === candidateDistrict) {
    return cfg.regionSameDistrictScore;
  }
  if (requestedRegion === candidateRegion) {
    return cfg.regionSameProvinceScore;
  }
  return cfg.regionDifferentProvinceScore;
}

function venueTypeScore(requested: VenueType, candidate: VenueType): number {
  if (requested === candidate) return cfg.venueTypeSameScore;
  if (requested === VenueType.UNDECIDED || candidate === VenueType.UNDECIDED) {
    return cfg.venueTypeOneUndecidedScore;
  }
  return cfg.venueTypeDifferentScore;
}

function durationScore(requestedDays: number, candidateDays: number | null): number {
  if (candidateDays === null) return cfg.durationMissingScore;
  const ratio = (requestedDays + 1) / (candidateDays + 1);
  return Math.exp(-Math.abs(Math.log(ratio)));
}

export function computeSimilarity(
  requestedRegion: Region,
  requestedDistrict: string | null,
  requestedType: FestivalType,
  requestedVenueType: VenueType,
  requestedDurationDays: number,
  candidate: FestivalRecord
): SimilarityScore {
  const typeScore = festivalTypeScore(requestedType, candidate.festivalType);
  const rScore = regionScore(
    requestedRegion,
    requestedDistrict,
    candidate.region,
    candidate.administrativeDistrict
  );
  const vScore = venueTypeScore(requestedVenueType, candidate.venueType);
  const dScore = durationScore(requestedDurationDays, candidate.durationDays);

  const similarity =
    typeScore * cfg.festivalTypeWeight +
    rScore * cfg.regionWeight +
    vScore * cfg.venueTypeWeight +
    dScore * cfg.durationWeight;

  const weight = similarity * similarity;

  return { typeScore, regionScore: rScore, venueScore: vScore, durationScore: dScore, similarity, weight };
}
