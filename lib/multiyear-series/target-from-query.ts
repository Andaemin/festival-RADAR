import { FestivalType, Region } from "@/lib/domain/enums";
import { SeriesRecordLite } from "./types";

/**
 * PHASE 9C-A — Planning API 요청(festivalName + query)을 series lookup 대상으로 쓸 "가상의"
 * {@link SeriesRecordLite}로 변환한다. 이 target은 DB record가 아니다 - id는 실제 DB id와 절대
 * 충돌하지 않는 음수 sentinel을 쓴다(자동증가 PK는 항상 양수).
 *
 * budgetKrw/venueType/durationDays 등 series 판정에 쓰이지 않는 필드는 series-linker.ts/
 * series-lookup.ts가 절대 읽지 않으므로 안전한 더미값으로 채운다.
 *
 * district는 요청에서 온 원문 그대로 `districtRaw`에 싣는다 - Spring frozen 규칙과 동일하게
 * DistrictPlaceholderNormalizer(district-placeholder-normalizer.ts)가 이 값을 다시 판정한다
 * (예: 사용자가 "본청"을 district로 보내면 REGION_LEVEL로 취급됨).
 */
export function buildSyntheticTargetRecord(params: {
  festivalName: string;
  region: Region;
  district: string | null;
  typeTokens: Set<FestivalType>;
  planningYear: number;
}): SeriesRecordLite {
  return {
    id: -1,
    datasetYear: params.planningYear,
    festivalName: params.festivalName,
    sourceSha256: "",
    sourceSheet: "",
    sourceRow: 0,
    region: params.region,
    regionRaw: "",
    district: params.district,
    districtRaw: params.district,
    typeTokens: params.typeTokens,
    typeTokensRaw: new Set<string>(params.typeTokens),
    venueType: null,
    durationDays: null,
    budgetKrw: 0,
  };
}
