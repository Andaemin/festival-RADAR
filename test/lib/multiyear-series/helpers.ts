import { FestivalType, Region, VenueType } from "@/lib/domain/enums";
import { SeriesRecordLite } from "@/lib/multiyear-series/types";

/**
 * PHASE 9B/9C 순수 함수 단위 테스트 전용 헬퍼 - DB 없이 SeriesRecordLite를 손으로 만든다.
 * series 판정에 안 쓰이는 필드(sourceSha256/sourceSheet/durationDays)는 무해한 기본값을 채운다.
 *
 * PHASE 2(series-search) — venueType override를 추가했다(기존 호출부는 전부 미지정 시 기존과
 * 동일하게 null이 채워지므로 하위 호환). region은 `??` 대신 `undefined` 여부만으로 기본값을
 * 적용한다 - `??`는 명시적으로 넘긴 `null`도 "미지정"으로 오인해 항상 Region.SEOUL로 되돌리는
 * 버그가 있었다(region이 실제로 null인 케이스를 테스트에서 만들 수 없었음).
 */
export function rec(overrides: {
  id: number;
  datasetYear: number;
  festivalName: string;
  region?: Region | null;
  regionRaw?: string;
  districtRaw?: string | null;
  typeTokens?: Set<FestivalType>;
  typeTokensRaw?: Set<string>;
  venueType?: VenueType | null;
  budgetKrw?: number;
}): SeriesRecordLite {
  return {
    id: overrides.id,
    datasetYear: overrides.datasetYear,
    festivalName: overrides.festivalName,
    sourceSha256: "test-sha",
    sourceSheet: "test-sheet",
    sourceRow: overrides.id,
    region: overrides.region !== undefined ? overrides.region : Region.SEOUL,
    regionRaw: overrides.regionRaw ?? "서울",
    district: overrides.districtRaw ?? null,
    districtRaw: overrides.districtRaw ?? null,
    typeTokens: overrides.typeTokens ?? new Set<FestivalType>([FestivalType.CULTURE_ART]),
    typeTokensRaw: overrides.typeTokensRaw ?? new Set<string>(["CULTURE_ART"]),
    venueType: overrides.venueType ?? null,
    durationDays: null,
    budgetKrw: overrides.budgetKrw ?? 100_000_000,
  };
}
