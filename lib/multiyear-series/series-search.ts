import { FestivalType, Region, VenueType } from "@/lib/domain/enums";
import { fuzzyKey, normalizeFestivalName } from "./festival-name-normalizer";
import { resolveDistrictKey } from "./scoring";
import { FrozenSeriesGroup, FrozenSeriesModel, SeriesRecordLite, SeriesScope } from "./types";

/**
 * PHASE 2(assistant-tester 기존 축제 검색/자동기입) — autocomplete 전용 read-only 검색 계층.
 *
 * 이 파일은 순수 함수만 담는다 - DB/Prisma를 전혀 import하지 않는다(route.ts가 이미 캐시된
 * {@link FrozenSeriesModel}을 만들어 넘겨준다). Series matcher(scoring.ts/series-linker.ts)의
 * threshold/판정식은 이 파일에서 절대 재정의하지 않는다 - 검색 순위는 그 matcher와 완전히 별개의
 * 단순 deterministic lookup ranking이다.
 *
 * "groupId를 외부에 노출하지 않는다"는 원칙을 지킨다 - {@link SeriesSearchResult}에 groupId
 * 필드가 없다(Phase 1에서 확인: groupId는 buildFrozenSeriesModel 실행마다 새로 매겨지는 임시
 * counter라 DB PK가 아니고, 재계산 시점에 따라 다른 그룹을 가리킬 수 있다). 클라이언트는 선택한
 * series의 canonicalName(및 자동기입된 region/district)을 estimate 요청의 festivalName/
 * regionCode/district 필드에 그대로 실어 보내면, 서버가 항상 같은 lookupTarget 결과를
 * 재현한다(§8 참고).
 */

export type FieldStatus = "STABLE" | "MIXED" | "MISSING";

export interface SeriesSearchAutoFill {
  regionCode: Region | null;
  district: string | null;
  festivalTypes: FestivalType[];
  venueType: VenueType | null;
}

export interface SeriesSearchFieldStatus {
  region: FieldStatus;
  district: FieldStatus;
  festivalTypes: FieldStatus;
  venueType: FieldStatus;
}

export interface SeriesSearchResult {
  canonicalName: string;
  scope: SeriesScope;
  /** STABLE일 때만 채워진다(그 외 null) - "가능한 metadata만 보여준다"는 원칙(요청 14절). */
  regionCode: Region | null;
  district: string | null;
  firstObservedYear: number;
  lastObservedYear: number;
  historyCount: number;
  autoFill: SeriesSearchAutoFill;
  fieldStatus: SeriesSearchFieldStatus;
}

/** 검색 비교에 쓰는 정규화 키 - 기존 정규화기(normalizeFestivalName)를 그대로 재사용하고,
 *  거기에 fuzzyKey(공백 제거)까지 적용한다. "차 없는 거리"/"차없는거리"처럼 공백 표기 차이가
 *  있어도 같은 축제를 찾을 수 있어야 한다는 요구사항(7절) 때문이다 - 이 공백-무시 비교는
 *  scoring.ts의 fuzzy 채점(nameSimilarity)이 이미 fuzzyKey를 쓰는 것과 동일한 관례를 따른 것뿐,
 *  새 정규화 규칙을 추가한 것이 아니다. */
function searchKey(rawName: string): string {
  return fuzzyKey(normalizeFestivalName(rawName));
}

type RankTier = 1 | 2 | 3 | 4 | 5 | 6;

function bestTierForGroup(group: FrozenSeriesGroup, queryKey: string): RankTier | null {
  const canonicalKey = searchKey(group.canonicalName);
  if (canonicalKey === queryKey) return 1;

  const memberKeys = group.members.map((m) => searchKey(m.festivalName));
  if (memberKeys.some((k) => k === queryKey)) return 2;

  if (canonicalKey.startsWith(queryKey)) return 3;
  if (memberKeys.some((k) => k.startsWith(queryKey))) return 4;

  if (canonicalKey.includes(queryKey)) return 5;
  if (memberKeys.some((k) => k.includes(queryKey))) return 6;

  return null;
}

/** non-null 값 개수 기준으로 STABLE/MIXED/MISSING을 판정한다(10절 - null/결측은 "실제 값"으로
 *  세지 않는다. venueType의 2017~2024 구조적 결측이 대표 사례). */
function statusFromValues<T>(values: (T | null)[]): { status: FieldStatus; unique: T[] } {
  const nonNull = values.filter((v): v is T => v !== null);
  const unique = [...new Set(nonNull)];
  if (unique.length === 0) return { status: "MISSING", unique: [] };
  if (unique.length === 1) return { status: "STABLE", unique };
  return { status: "MIXED", unique };
}

/** festivalTypes는 "레코드 하나가 가진 유형 집합 전체"를 하나의 값으로 비교한다(10절 - 각
 *  historical record의 non-empty type set을 비교, 동일한 set만 관측되면 STABLE). Set은 값
 *  비교가 안 되므로 정렬 후 join한 문자열을 비교 키로 쓴다. */
function typeSetKey(types: Set<FestivalType>): string {
  return [...types].sort().join("|");
}

function computeFestivalTypesStatus(members: SeriesRecordLite[]): { status: FieldStatus; representative: FestivalType[] } {
  const nonEmptySets = members.map((m) => m.typeTokens).filter((s) => s.size > 0);
  if (nonEmptySets.length === 0) return { status: "MISSING", representative: [] };
  const uniqueKeys = new Set(nonEmptySets.map(typeSetKey));
  if (uniqueKeys.size > 1) return { status: "MIXED", representative: [] };
  return { status: "STABLE", representative: [...nonEmptySets[0]].sort() };
}

/** 하나의 FrozenSeriesGroup으로부터 자동기입 값/필드 상태를 계산한다(10절 정책). */
export function computeAutoFillForGroup(group: FrozenSeriesGroup): { autoFill: SeriesSearchAutoFill; fieldStatus: SeriesSearchFieldStatus } {
  const members = group.members;

  const regionResult = statusFromValues(members.map((m) => m.region));
  const districtResult = statusFromValues(members.map((m) => resolveDistrictKey(m)));
  const venueResult = statusFromValues(members.map((m) => m.venueType));
  const typesResult = computeFestivalTypesStatus(members);

  return {
    autoFill: {
      regionCode: regionResult.status === "STABLE" ? regionResult.unique[0] : null,
      district: districtResult.status === "STABLE" ? districtResult.unique[0] : null,
      festivalTypes: typesResult.status === "STABLE" ? typesResult.representative : [],
      venueType: venueResult.status === "STABLE" ? venueResult.unique[0] : null,
    },
    fieldStatus: {
      region: regionResult.status,
      district: districtResult.status,
      festivalTypes: typesResult.status,
      venueType: venueResult.status,
    },
  };
}

function toSearchResult(group: FrozenSeriesGroup): SeriesSearchResult {
  const { autoFill, fieldStatus } = computeAutoFillForGroup(group);
  return {
    canonicalName: group.canonicalName,
    scope: group.scope,
    // 상단 표시용 필드도 autoFill과 동일하게 STABLE일 때만 노출한다(중복 판정 로직을 만들지
    // 않기 위해 - "가능한 metadata만 보여준다"는 요구사항을 자동으로 만족시킨다).
    regionCode: autoFill.regionCode,
    district: autoFill.district,
    firstObservedYear: group.firstObservedYear,
    lastObservedYear: group.lastObservedYear,
    historyCount: group.members.length,
    autoFill,
    fieldStatus,
  };
}

/**
 * PHASE 5(6절) — UI list rendering(React key)용 deterministic composite key. groupId는 절대
 * 쓰지 않는다(임시 counter라 재계산마다 바뀔 수 있음 - series-search.ts 상단 설명 참고).
 * canonicalName만으로는 서로 다른 지역의 동명 series가 있을 때 key가 충돌할 수 있어, scope/
 * region/district/관측연도까지 포함한 문자열을 만든다 - 이 값 자체는 서버로 전송되지 않고
 * 오직 화면 렌더링 키로만 쓰인다.
 */
export function buildSeriesSearchResultKey(r: SeriesSearchResult): string {
  return [r.canonicalName, r.scope, r.regionCode ?? "", r.district ?? "", r.firstObservedYear, r.lastObservedYear].join("|");
}

/**
 * FrozenSeriesModel 안의 group들을 이름으로 검색해 deterministic하게 순위를 매긴다(8절).
 * Series matcher(scoring.ts)의 HIGH/MEDIUM/LOW threshold는 전혀 참조하지 않는다 - 이 함수는
 * "표시 순서"만 결정하는 별개의 lookup이다.
 */
export function searchFrozenSeries(model: FrozenSeriesModel, query: string, limit: number): SeriesSearchResult[] {
  const queryKey = searchKey(query);
  if (queryKey === "") return [];

  const scored: { group: FrozenSeriesGroup; tier: RankTier }[] = [];
  for (const group of model.groupsById.values()) {
    const tier = bestTierForGroup(group, queryKey);
    if (tier !== null) scored.push({ group, tier });
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    // 8절 - 동일 tier 내 deterministic secondary ordering(canonicalName/region/district/firstObservedYear).
    // groupId는 절대 정렬 키로 쓰지 않는다(임시 counter이므로).
    const nameCmp = a.group.canonicalName.localeCompare(b.group.canonicalName, "ko");
    if (nameCmp !== 0) return nameCmp;
    const regionCmp = a.group.canonicalRegion.localeCompare(b.group.canonicalRegion, "ko");
    if (regionCmp !== 0) return regionCmp;
    const districtCmp = (a.group.canonicalDistrict ?? "").localeCompare(b.group.canonicalDistrict ?? "", "ko");
    if (districtCmp !== 0) return districtCmp;
    return a.group.firstObservedYear - b.group.firstObservedYear;
  });

  return scored.slice(0, limit).map((s) => toSearchResult(s.group));
}
