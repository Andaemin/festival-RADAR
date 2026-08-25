import { FestivalType, Region } from "@/lib/domain/enums";
import { SeriesRecordLite } from "@/lib/multiyear-series/types";

/**
 * PHASE 9B/9C 순수 함수 단위 테스트 전용 헬퍼 - DB 없이 SeriesRecordLite를 손으로 만든다.
 * series 판정에 안 쓰이는 필드(sourceSha256/sourceSheet/venueType/durationDays)는 무해한
 * 기본값을 채운다.
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
  budgetKrw?: number;
}): SeriesRecordLite {
  return {
    id: overrides.id,
    datasetYear: overrides.datasetYear,
    festivalName: overrides.festivalName,
    sourceSha256: "test-sha",
    sourceSheet: "test-sheet",
    sourceRow: overrides.id,
    region: overrides.region ?? Region.SEOUL,
    regionRaw: overrides.regionRaw ?? "서울",
    district: overrides.districtRaw ?? null,
    districtRaw: overrides.districtRaw ?? null,
    typeTokens: overrides.typeTokens ?? new Set<FestivalType>([FestivalType.CULTURE_ART]),
    typeTokensRaw: overrides.typeTokensRaw ?? new Set<string>(["CULTURE_ART"]),
    venueType: null,
    durationDays: null,
    budgetKrw: overrides.budgetKrw ?? 100_000_000,
  };
}
