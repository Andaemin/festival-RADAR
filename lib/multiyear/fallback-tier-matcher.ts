import { FallbackLevel } from "@/lib/domain/enums";
import { typesOverlap } from "./feature-resolver";
import { MultiYearQuery, MultiYearRecordLite } from "./types";

/**
 * FallbackLevel 6단계 각각의 "이 record가 이 단계 조건을 만족하는가" 판정 로직 - Spring
 * MultiYearFallbackTierMatcher를 그대로 포팅한다.
 *
 * candidate-selector.ts(S0/V0) 자체는 이 파일을 쓰지 않는다 - Spring이 "V0 공식은 절대
 * 안 건드린다"는 원칙 때문에 V0 로직을 복사해 별도 유틸리티를 만든 것과 동일한 이유로,
 * V0는 원본 그대로 두고 이 파일은 candidate-selector-v1.ts(V4 Hybrid)만 사용한다.
 * 판정 규칙 자체는 candidate-selector.ts의 matcherFor/typeMatches와 완전히 동일하다.
 */
export function requiresDistrict(level: FallbackLevel): boolean {
  return level === FallbackLevel.SAME_DISTRICT_TYPE_VENUE;
}

export function requiresVenue(level: FallbackLevel): boolean {
  return (
    level === FallbackLevel.SAME_DISTRICT_TYPE_VENUE ||
    level === FallbackLevel.SAME_REGION_TYPE_VENUE ||
    level === FallbackLevel.NATIONWIDE_TYPE_VENUE
  );
}

export function typeMatches(query: MultiYearQuery, candidate: MultiYearRecordLite): boolean {
  return typesOverlap(query.typeTokens, candidate.typeTokens);
}

export function matcherFor(level: FallbackLevel, query: MultiYearQuery): (r: MultiYearRecordLite) => boolean {
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
