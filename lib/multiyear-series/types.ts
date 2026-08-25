import { REGION_DISPLAY, Region } from "@/lib/domain/enums";
import { MultiYearRecordLite } from "@/lib/multiyear/types";

/**
 * PHASE 9B-1 — Spring `FestivalSeries`/`FestivalSeriesMembership`/`MatchMethod`/`MatchConfidence`/
 * `SeriesScope`의 TypeScript 포팅. 기존 `lib/multiyear/*`(baseline/planning estimator)와 완전히
 * 별도 모듈이다 - 이 모듈을 추가해도 기존 `/api/v1/budget-estimates`, Planning V1(estimateForPlanning)
 * 경로는 전혀 바뀌지 않는다.
 */

export type SeriesScope = "DISTRICT_LEVEL" | "REGION_LEVEL";

export type MatchMethod = "EXACT" | "NORMALIZED_EXACT" | "FUZZY" | "CHAIN_HIGH_CONFIDENCE" | "MANUAL" | "UNMATCHED";

export type MatchConfidence = "HIGH" | "MEDIUM" | "LOW";

/**
 * series linker 전용 경량 레코드. 기존 baseline이 쓰는 {@link MultiYearRecordLite}를 그대로
 * 확장하되(같은 trainingPool을 재사용할 수 있도록), series 판정에만 필요한 raw 필드를 더한다:
 *
 * - `regionRaw`: Spring resolveRegionKey의 최후 fallback(regionCode 없을 때 원문).
 * - `districtRaw`: placeholder 정규화를 거치기 전 원문(district_raw) - 기존 `district`
 *   필드(importer가 만든 canonical 컬럼)는 series 판정에 쓰지 않는다. Spring
 *   DistrictPlaceholderNormalizer를 이 모듈에서 다시 적용해야 하기 때문이다.
 * - `typeTokensRaw`: festival_type 컬럼의 모든 raw 토큰 집합(OTHER/UNKNOWN 포함, 필터링 없음) -
 *   Spring FestivalSeriesLinkingService.splitTypes와 동일. 기존 `typeTokens`(production
 *   FestivalType 5종으로 필터링됨, missing-feature 판정에만 사용)와는 다른 용도다.
 */
export interface SeriesRecordLite extends MultiYearRecordLite {
  regionRaw: string;
  districtRaw: string | null;
  typeTokensRaw: Set<string>;
}

export interface ClusterKey {
  scope: SeriesScope;
  regionKey: string;
  districtKey: string | null;
  normalizedName: string;
}

/** training-only historical series 그룹 1개(합성 groupId - DB PK 아님, 이 실행 안에서만 유효). */
export interface FrozenSeriesGroup {
  groupId: number;
  canonicalName: string;
  scope: SeriesScope;
  canonicalRegion: string;
  canonicalDistrict: string | null;
  firstObservedYear: number;
  lastObservedYear: number;
  members: SeriesRecordLite[];
}

export interface FrozenSeriesModel {
  groupIdByRecordId: Map<number, number>;
  matchMethodByRecordId: Map<number, MatchMethod>;
  groupsById: Map<number, FrozenSeriesGroup>;
  /** training 쪽에서 fuzzy 단계 중 서로 다른 series를 가리키는 HIGH 후보 2개 이상이라 자동
   *  연결되지 않은(그리고 chain linking으로도 해소되지 않은) record 수. */
  ambiguousTrainingRecordCount: number;
}

export interface TargetSeriesMatch {
  targetRecordId: number;
  matchMethod: MatchMethod;
  ambiguous: boolean;
  matchedGroupId: number | null;
  matchedCanonicalName: string | null;
  bestScore: number | null;
  bestNameSimilarity: number | null;
  ambiguousGroupIds: number[];
}

/** Spring FestivalSeriesLinkingService.ClusterKey.of(record)의 region 우선순위 포팅. */
export function resolveRegionKey(r: { region: Region | null; regionRaw: string }): string {
  if (r.region !== null) return REGION_DISPLAY[r.region];
  const trimmed = r.regionRaw?.trim();
  return trimmed ? trimmed : "UNKNOWN";
}
