import { FESTIVAL_TYPE_DISPLAY, FestivalType, REGION_DISPLAY, Region, VENUE_TYPE_DISPLAY, VenueType } from "@/lib/domain/enums";
import { MetadataResponse } from "@/lib/domain/types";
import { getLatestDatasetYear, loadDistrictsByRegion } from "./festival-record-source";

const DURATION_MINIMUM = 2;
const DURATION_MAXIMUM_RECOMMENDED = 180;

export async function getMetadata(): Promise<MetadataResponse> {
  // 출처는 다년도 원장(MultiYearFestivalRecord)이다. 시군구 목록은 전 연도를 훑어
  // 플래너 코퍼스(2017~2026)와 선택지 범위를 맞춘다 - ./festival-record-source.ts 참고.
  const [datasetYear, districtsByRegion] = await Promise.all([
    getLatestDatasetYear(),
    loadDistrictsByRegion(),
  ]);

  return {
    regions: Object.values(Region).map((r) => ({ code: r, displayName: REGION_DISPLAY[r] })),
    festivalTypes: Object.values(FestivalType).map((t) => ({ code: t, displayName: FESTIVAL_TYPE_DISPLAY[t] })),
    venueTypes: Object.values(VenueType).map((v) => ({ code: v, displayName: VENUE_TYPE_DISPLAY[v] })),
    districtsByRegion,
    duration: { minimum: DURATION_MINIMUM, maximumRecommended: DURATION_MAXIMUM_RECOMMENDED },
    datasetYear,
  };
}
