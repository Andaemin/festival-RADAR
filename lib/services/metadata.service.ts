import { unstable_cache } from "next/cache";
import { FESTIVAL_TYPE_DISPLAY, FestivalType, REGION_DISPLAY, Region, VENUE_TYPE_DISPLAY, VenueType } from "@/lib/domain/enums";
import { MetadataResponse } from "@/lib/domain/types";
import { getLatestDatasetYear, loadDistrictsByRegion } from "./festival-record-source";

const DURATION_MINIMUM = 2;
const DURATION_MAXIMUM_RECOMMENDED = 180;

/** 메타데이터 캐시 수명(초). 원장은 CSV 재적재 때만 바뀌므로 넉넉히 잡는다. */
const METADATA_CACHE_SECONDS = 3600;
export const METADATA_CACHE_TAG = "metadata";

async function buildMetadata(): Promise<MetadataResponse> {
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

/**
 * 플래너 셀렉트 보기(지역·시군구·유형·기간)의 원천. 원장 DB 조회 2회가 들어가는데 값이
 * 재적재 전까지는 변하지 않으므로 Next Data Cache에 올려 요청마다 DB를 치지 않게 한다.
 * 재적재 직후 바로 반영해야 하면 `revalidateTag(METADATA_CACHE_TAG)`를 호출하면 된다.
 */
export const getMetadata = unstable_cache(buildMetadata, [METADATA_CACHE_TAG], {
  revalidate: METADATA_CACHE_SECONDS,
  tags: [METADATA_CACHE_TAG],
});
