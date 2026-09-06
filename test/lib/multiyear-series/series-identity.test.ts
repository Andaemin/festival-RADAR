import { describe, expect, it } from "vitest";
import { Region } from "@/lib/domain/enums";
import { buildSeriesTrainingPool } from "@/lib/multiyear-series/fold";
import { resolveExplicitSeriesIdentity } from "@/lib/multiyear-series/series-identity";
import { buildFrozenSeriesModel } from "@/lib/multiyear-series/series-linker";
import { rec } from "./helpers";

/**
 * PHASE — Explicit Series Identity Routing. 자동 matcher(series-lookup.ts/scoring.ts)는 전혀
 * import하지 않는다 - `resolveExplicitSeriesIdentity`가 그 결과(FrozenSeriesModel)를 그대로
 * canonicalName+region으로만 다시 조회하는 별도 경로임을 순수 함수 레벨에서 확인한다.
 */
function withValid(records: ReturnType<typeof rec>[]) {
  return records.map((r) => ({ ...r, budgetQualityFlag: "VALID" as const }));
}

function buildModel(records: ReturnType<typeof withValid>, cutoffYear: number) {
  const { trainingPool } = buildSeriesTrainingPool(records, cutoffYear);
  return buildFrozenSeriesModel(trainingPool);
}

describe("resolveExplicitSeriesIdentity", () => {
  it("서울거리예술축제 실측 패턴 재현 - district 유무와 무관하게 canonicalName+region만으로 동일 그룹을 찾는다", () => {
    // 실제 데이터 재현: 5개 연도가 district=null(REGION_LEVEL)인 하나의 group.
    const records = withValid([
      rec({ id: 1, datasetYear: 2017, festivalName: "서울거리예술축제", region: Region.SEOUL, districtRaw: null }),
      rec({ id: 2, datasetYear: 2018, festivalName: "제2회 서울거리예술축제", region: Region.SEOUL, districtRaw: null }),
      rec({ id: 3, datasetYear: 2021, festivalName: "제3회 서울거리예술축제", region: Region.SEOUL, districtRaw: null }),
    ]);
    const model = buildModel(records, 2026);
    const resolution = resolveExplicitSeriesIdentity({ canonicalName: "서울거리예술축제", regionCode: "SEOUL" }, Region.SEOUL, model);
    expect(resolution.ambiguous).toBe(false);
    expect(resolution.matchedGroupId).not.toBeNull();
    const group = model.groupsById.get(resolution.matchedGroupId!)!;
    expect(group.canonicalName).toBe("서울거리예술축제");
    expect(group.canonicalDistrict).toBeNull(); // district 없이도 정확히 이 그룹을 다시 찾는다
  });

  it("존재하지 않는 canonicalName+region 조합 - matchedGroupId=null, ambiguous=false(자동 matcher fallback 유도)", () => {
    const records = withValid([rec({ id: 1, datasetYear: 2020, festivalName: "가나다축제", region: Region.SEOUL, districtRaw: null })]);
    const model = buildModel(records, 2026);
    const resolution = resolveExplicitSeriesIdentity({ canonicalName: "존재하지않는축제", regionCode: "SEOUL" }, Region.SEOUL, model);
    expect(resolution.matchedGroupId).toBeNull();
    expect(resolution.ambiguous).toBe(false);
  });

  it("동명이축제 - 같은 canonicalName, 다른 region이면 요청한 region의 그룹만 찾는다(cross-region 안전)", () => {
    const records = withValid([
      rec({ id: 1, datasetYear: 2020, festivalName: "노을축제", region: Region.SEOUL, regionRaw: "서울", districtRaw: null }),
      rec({ id: 2, datasetYear: 2020, festivalName: "노을축제", region: Region.BUSAN, regionRaw: "부산", districtRaw: null }),
    ]);
    const model = buildModel(records, 2026);

    const seoulResolution = resolveExplicitSeriesIdentity({ canonicalName: "노을축제", regionCode: "SEOUL" }, Region.SEOUL, model);
    expect(seoulResolution.ambiguous).toBe(false);
    expect(seoulResolution.matchedGroupId).not.toBeNull();
    expect(model.groupsById.get(seoulResolution.matchedGroupId!)!.canonicalRegion).toBe("서울");

    const busanResolution = resolveExplicitSeriesIdentity({ canonicalName: "노을축제", regionCode: "BUSAN" }, Region.BUSAN, model);
    expect(busanResolution.matchedGroupId).not.toBeNull();
    expect(model.groupsById.get(busanResolution.matchedGroupId!)!.canonicalRegion).toBe("부산");
    expect(busanResolution.matchedGroupId).not.toBe(seoulResolution.matchedGroupId);
  });

  it("ambiguous - 같은 canonicalName+region인데 district가 달라 서로 다른 그룹으로 클러스터링됐다면 임의로 하나를 고르지 않는다", () => {
    // 두 record가 이름/지역은 같지만 district가 하나는 없고(REGION_LEVEL) 하나는 있어서
    // (DISTRICT_LEVEL) 서로 다른 clusterKey -> 서로 다른 group으로 분리된다. 둘 다
    // canonicalName="잠실축제", canonicalRegion="서울"로 겹치므로 identity 조회 시 모호하다.
    const records = withValid([
      rec({ id: 1, datasetYear: 2020, festivalName: "잠실축제", region: Region.SEOUL, districtRaw: null }),
      rec({ id: 2, datasetYear: 2021, festivalName: "잠실축제", region: Region.SEOUL, districtRaw: "송파구" }),
    ]);
    const model = buildModel(records, 2026);

    // 전제 확인: 실제로 서로 다른 두 그룹으로 분리됐는지.
    const matchingGroups = [...model.groupsById.values()].filter((g) => g.canonicalName === "잠실축제" && g.canonicalRegion === "서울");
    expect(matchingGroups.length).toBe(2);

    const resolution = resolveExplicitSeriesIdentity({ canonicalName: "잠실축제", regionCode: "SEOUL" }, Region.SEOUL, model);
    expect(resolution.matchedGroupId).toBeNull();
    expect(resolution.ambiguous).toBe(true);
  });
});
