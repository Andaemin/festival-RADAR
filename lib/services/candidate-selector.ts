import { FallbackLevel, FALLBACK_LEVEL_ORDER, FestivalType, Region, VenueType } from "@/lib/domain/enums";
import { CandidateSelectionResult, FestivalRecord, LevelContribution } from "@/lib/domain/types";
import { algorithmConfig } from "./algorithm-config";

type Matcher = (r: FestivalRecord) => boolean;

function matcherFor(
  level: FallbackLevel,
  region: Region,
  district: string | null,
  festivalType: FestivalType,
  venueType: VenueType
): Matcher {
  switch (level) {
    case FallbackLevel.SAME_DISTRICT_TYPE_VENUE:
      return (r) =>
        r.administrativeDistrict === district &&
        r.festivalType === festivalType &&
        r.venueType === venueType;
    case FallbackLevel.SAME_REGION_TYPE_VENUE:
      return (r) =>
        r.region === region &&
        r.festivalType === festivalType &&
        r.venueType === venueType;
    case FallbackLevel.NATIONWIDE_TYPE_VENUE:
      return (r) => r.festivalType === festivalType && r.venueType === venueType;
    case FallbackLevel.SAME_REGION_TYPE:
      return (r) => r.region === region && r.festivalType === festivalType;
    case FallbackLevel.NATIONWIDE_TYPE:
      return (r) => r.festivalType === festivalType;
    case FallbackLevel.GLOBAL_SIMILARITY:
      return () => true;
  }
}

export function selectCandidates(
  eligiblePool: FestivalRecord[],
  region: Region,
  district: string | null,
  festivalType: FestivalType,
  venueType: VenueType
): CandidateSelectionResult {
  const hasDistrict = district !== null && district.trim() !== "";
  const accumulated = new Map<number, FestivalRecord>();
  const originLevelByCandidateId = new Map<number, FallbackLevel>();
  const levelBreakdown: LevelContribution[] = [];
  let reachedLevel = FallbackLevel.SAME_DISTRICT_TYPE_VENUE;

  for (const level of FALLBACK_LEVEL_ORDER) {
    if (level === FallbackLevel.SAME_DISTRICT_TYPE_VENUE && !hasDistrict) continue;

    const sizeBefore = accumulated.size;
    const matcher = matcherFor(level, region, district, festivalType, venueType);

    for (const record of eligiblePool) {
      if (matcher(record) && !accumulated.has(record.id)) {
        accumulated.set(record.id, record);
        originLevelByCandidateId.set(record.id, level);
      }
    }

    levelBreakdown.push({
      level,
      added: accumulated.size - sizeBefore,
      cumulativeTotal: accumulated.size,
    });
    reachedLevel = level;

    if (accumulated.size >= algorithmConfig.recommendedSampleCount) break;
  }

  return {
    level: reachedLevel,
    candidates: Array.from(accumulated.values()),
    levelBreakdown,
    originLevelByCandidateId,
  };
}
