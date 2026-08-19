import { FESTIVAL_TYPE_DISPLAY, FestivalType, REGION_DISPLAY, Region, VENUE_TYPE_DISPLAY, VenueType } from "@/lib/domain/enums";
import { MetadataResponse } from "@/lib/domain/types";
import { prisma } from "@/lib/db/prisma";

const DURATION_MINIMUM = 2;
const DURATION_MAXIMUM_RECOMMENDED = 180;

export async function getMetadata(): Promise<MetadataResponse> {
  // 최신 datasetYear 조회
  const latestBatch = await prisma.festivalRecord.aggregate({
    _max: { datasetYear: true },
  });
  const datasetYear = latestBatch._max.datasetYear ?? 0;

  // 시군구 목록: 최신 연도 데이터에서 지역별로 묶어서 추출
  const records =
    datasetYear === 0
      ? []
      : await prisma.festivalRecord.findMany({
          where: { datasetYear },
          select: { region: true, administrativeDistrict: true },
        });

  const districtsByRegion: Record<string, string[]> = {};
  for (const r of records) {
    if (!r.administrativeDistrict) continue;
    const key = r.region as string;
    if (!districtsByRegion[key]) districtsByRegion[key] = [];
    if (!districtsByRegion[key].includes(r.administrativeDistrict)) {
      districtsByRegion[key].push(r.administrativeDistrict);
    }
  }
  // 각 지역의 시군구 목록 정렬
  for (const key of Object.keys(districtsByRegion)) {
    districtsByRegion[key].sort();
  }

  return {
    regions: Object.values(Region).map((r) => ({ code: r, displayName: REGION_DISPLAY[r] })),
    festivalTypes: Object.values(FestivalType).map((t) => ({ code: t, displayName: FESTIVAL_TYPE_DISPLAY[t] })),
    venueTypes: Object.values(VenueType).map((v) => ({ code: v, displayName: VENUE_TYPE_DISPLAY[v] })),
    districtsByRegion,
    duration: { minimum: DURATION_MINIMUM, maximumRecommended: DURATION_MAXIMUM_RECOMMENDED },
    datasetYear,
  };
}
