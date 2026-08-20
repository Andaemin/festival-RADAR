import { algorithmConfig } from "@/lib/services/algorithm-config";
import { FallbackLevel, FALLBACK_LEVEL_ORDER } from "@/lib/domain/enums";
import { typesOverlap } from "./feature-resolver";
import { MultiYearCandidateSelectionResult, MultiYearLevelContribution, MultiYearQuery, MultiYearRecordLite } from "./types";

const cfg = algorithmConfig;

/**
 * baseline S0 계층형 fallback 후보 선정. Spring MultiYearCandidateSelector를 그대로 포팅한다 -
 * 정렬/dedup/threshold 순서를 바꾸지 않는다:
 *
 * - 레벨은 FALLBACK_LEVEL_ORDER 순서로만 순회한다.
 * - 레벨 내에서는 trainingPool 배열 순서 그대로 훑는다(정렬하지 않음).
 * - 이미 accumulated에 있는 record.id는 건너뛴다(putIfAbsent와 동일 - 먼저 도달한 레벨이
 *   origin으로 고정된다. 이후 레벨에서 다시 나와도 origin은 덮어쓰지 않는다).
 * - accumulated.size() >= recommendedSampleCount에 도달하면 그 레벨까지만 채우고 멈춘다
 *   (그 레벨 자체는 끝까지 훑는다 - 중간에 끊지 않는다).
 */
function matcherFor(level: FallbackLevel, query: MultiYearQuery): (r: MultiYearRecordLite) => boolean {
  switch (level) {
    case FallbackLevel.SAME_DISTRICT_TYPE_VENUE:
      return (r) => query.district === r.district && typeMatches(query, r) && r.venueType === query.venueType;
    case FallbackLevel.SAME_REGION_TYPE_VENUE:
      return (r) => r.region === query.region && typeMatches(query, r) && r.venueType === query.venueType;
    case FallbackLevel.NATIONWIDE_TYPE_VENUE:
      return (r) => typeMatches(query, r) && r.venueType === query.venueType;
    case FallbackLevel.SAME_REGION_TYPE:
      return (r) => r.region === query.region && typeMatches(query, r);
    case FallbackLevel.NATIONWIDE_TYPE:
      return (r) => typeMatches(query, r);
    case FallbackLevel.GLOBAL_SIMILARITY:
      return () => true;
  }
}

function typeMatches(query: MultiYearQuery, candidate: MultiYearRecordLite): boolean {
  return typesOverlap(query.typeTokens, candidate.typeTokens);
}

export function selectMultiYearCandidates(
  trainingPool: MultiYearRecordLite[],
  query: MultiYearQuery
): MultiYearCandidateSelectionResult {
  const hasDistrict = query.district !== null;
  const hasVenue = query.venueType !== null;

  const accumulated = new Map<number, MultiYearRecordLite>();
  const originLevelByRecordId = new Map<number, FallbackLevel>();
  const levelBreakdown: MultiYearLevelContribution[] = [];
  let reachedLevel = FallbackLevel.SAME_DISTRICT_TYPE_VENUE;

  for (const level of FALLBACK_LEVEL_ORDER) {
    const requiresDistrict = level === FallbackLevel.SAME_DISTRICT_TYPE_VENUE;
    const requiresVenue =
      level === FallbackLevel.SAME_DISTRICT_TYPE_VENUE ||
      level === FallbackLevel.SAME_REGION_TYPE_VENUE ||
      level === FallbackLevel.NATIONWIDE_TYPE_VENUE;
    if ((requiresDistrict && !hasDistrict) || (requiresVenue && !hasVenue)) continue;

    const sizeBefore = accumulated.size;
    const matcher = matcherFor(level, query);
    for (const record of trainingPool) {
      if (matcher(record) && !accumulated.has(record.id)) {
        accumulated.set(record.id, record);
        originLevelByRecordId.set(record.id, level);
      }
    }

    levelBreakdown.push({ level, added: accumulated.size - sizeBefore, cumulativeTotal: accumulated.size });
    reachedLevel = level;
    if (accumulated.size >= cfg.recommendedSampleCount) break;
  }

  return {
    level: reachedLevel,
    candidates: Array.from(accumulated.values()),
    levelBreakdown,
    originLevelByRecordId,
  };
}
