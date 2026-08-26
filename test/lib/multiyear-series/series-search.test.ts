import { describe, expect, it } from "vitest";
import { FestivalType, Region, VenueType } from "@/lib/domain/enums";
import { buildFrozenSeriesModel } from "@/lib/multiyear-series/series-linker";
import { buildSeriesSearchResultKey, computeAutoFillForGroup, searchFrozenSeries } from "@/lib/multiyear-series/series-search";
import { rec } from "./helpers";

/**
 * PHASE 2 — series-search.ts 순수 함수 단위 테스트. DB 없이 buildFrozenSeriesModel(기존
 * production 함수, 재구현하지 않음)로 만든 작은 FrozenSeriesModel에 대해 검색/자동기입 판정만
 * 검증한다. Series matcher threshold(HIGH/MEDIUM/LOW)는 이 테스트에서 변경하지 않는다.
 *
 * "MIXED/MISSING이면 임의의 첫 option을 대신 넣지 않는다"는 요구사항은 이 파일의 `autoFill.*`이
 * MIXED/MISSING일 때 항상 null을 반환하는지로 검증한다 - `app/assistant-tester/page.tsx`의
 * handleSelectSeries는 이 null을 그대로 ""(select의 "직접 선택" placeholder)로 옮길 뿐, 별도
 * fallback(metadata 첫 옵션 등)을 두지 않는다. 이 프로젝트에는 React 컴포넌트 테스트 인프라
 * (@testing-library 등)가 없고 이번 Phase에서 새 의존성을 추가하지 않으므로, UI 동작 자체는
 * 이 pure helper 테스트 + 코드 리뷰(handleSelectSeries 3줄 삼항식이 전부 `result.autoFill.*`을
 * 그대로 쓰고 다른 fallback이 없음)로 검증한다.
 */

function firstGroup(model: ReturnType<typeof buildFrozenSeriesModel>) {
  const [group] = model.groupsById.values();
  return group;
}

describe("computeAutoFillForGroup - fieldStatus 판정(10절)", () => {
  it("venueType: null 다수 + 동일 non-null 값 2개 → STABLE(요청 10절/21절 부산국제록페스티벌 사례)", () => {
    const members = [
      rec({ id: 1, datasetYear: 2017, festivalName: "부산국제록페스티벌", region: Region.BUSAN, venueType: null }),
      rec({ id: 2, datasetYear: 2018, festivalName: "부산국제록페스티벌", region: Region.BUSAN, venueType: null }),
      rec({ id: 3, datasetYear: 2019, festivalName: "부산국제록페스티벌", region: Region.BUSAN, venueType: null }),
      rec({ id: 4, datasetYear: 2025, festivalName: "부산국제록페스티벌", region: Region.BUSAN, venueType: VenueType.GREEN }),
      rec({ id: 5, datasetYear: 2026, festivalName: "부산국제록페스티벌", region: Region.BUSAN, venueType: VenueType.GREEN }),
    ];
    const model = buildFrozenSeriesModel(members);
    const group = firstGroup(model);
    expect(group.members).toHaveLength(5);

    const { autoFill, fieldStatus } = computeAutoFillForGroup(group);
    expect(fieldStatus.venueType).toBe("STABLE");
    expect(autoFill.venueType).toBe(VenueType.GREEN);
    expect(fieldStatus.region).toBe("STABLE");
    expect(autoFill.regionCode).toBe(Region.BUSAN);
  });

  it("district: 전부 null → MISSING", () => {
    const members = [
      rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", districtRaw: null }),
      rec({ id: 2, datasetYear: 2018, festivalName: "가나다축제", districtRaw: null }),
    ];
    const model = buildFrozenSeriesModel(members);
    const { autoFill, fieldStatus } = computeAutoFillForGroup(firstGroup(model));
    expect(fieldStatus.district).toBe("MISSING");
    expect(autoFill.district).toBeNull();
  });

  it("venueType: 전부 null → MISSING, 임의 첫 option을 대신 넣지 않는다(autoFill.venueType=null)", () => {
    const members = [
      rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", venueType: null }),
      rec({ id: 2, datasetYear: 2018, festivalName: "가나다축제", venueType: null }),
    ];
    const model = buildFrozenSeriesModel(members);
    const { autoFill, fieldStatus } = computeAutoFillForGroup(firstGroup(model));
    expect(fieldStatus.venueType).toBe("MISSING");
    expect(autoFill.venueType).toBeNull();
  });

  it("region: 모든 member가 region=null(및 동일 regionRaw)이면 MISSING, 임의 첫 option을 대신 넣지 않는다", () => {
    const members = [
      rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", region: null, regionRaw: "알수없음" }),
      rec({ id: 2, datasetYear: 2018, festivalName: "가나다축제", region: null, regionRaw: "알수없음" }),
    ];
    const model = buildFrozenSeriesModel(members);
    const group = firstGroup(model);
    expect(group.members).toHaveLength(2);
    const { autoFill, fieldStatus } = computeAutoFillForGroup(group);
    expect(fieldStatus.region).toBe("MISSING");
    expect(autoFill.regionCode).toBeNull();
  });

  it("district: 동일 값 반복(종로구) → STABLE(대학로 차 없는 거리 축제 사례)", () => {
    const members = [
      rec({ id: 1, datasetYear: 2025, festivalName: "2025 대학로 차 없는 거리 축제", districtRaw: "종로구" }),
      rec({ id: 2, datasetYear: 2026, festivalName: "2026 대학로 차 없는 거리 축제", districtRaw: "종로구" }),
    ];
    const model = buildFrozenSeriesModel(members);
    const { autoFill, fieldStatus } = computeAutoFillForGroup(firstGroup(model));
    expect(fieldStatus.district).toBe("STABLE");
    expect(autoFill.district).toBe("종로구");
  });

  it("venueType: 서로 다른 non-null 값 2종 → MIXED, 자동기입 안 함", () => {
    const members = [
      rec({ id: 1, datasetYear: 2025, festivalName: "테스트축제", venueType: VenueType.OTHER }),
      rec({ id: 2, datasetYear: 2026, festivalName: "테스트축제", venueType: VenueType.VILLAGE }),
    ];
    const model = buildFrozenSeriesModel(members);
    const { autoFill, fieldStatus } = computeAutoFillForGroup(firstGroup(model));
    expect(fieldStatus.venueType).toBe("MIXED");
    expect(autoFill.venueType).toBeNull();
  });

  it("region: 같은 group 안에서 non-null 값 하나로만 일치하면(null 혼재 포함) STABLE, festivalTypes: 동일 set만 관측되면 STABLE", () => {
    // clusterKeyOf의 regionKey는 scope+bucket 자체를 결정하므로(scoring.ts), 서로 다른 non-null
    // Region enum을 가진 record는 애초에 같은 group으로 절대 묶이지 않는다(region이 다르면 다른
    // bucket) - 따라서 "같은 group 안에서 region이 실제로 MIXED"는 구조적으로 도달 불가능한
    // 상태다(코드는 방어적으로 처리하지만 이 케이스로는 재현할 수 없음). 대신 region이 null인
    // member(그러나 regionRaw가 같아 같은 bucket에 들어온 경우)가 섞여도 STABLE로 판정되는지
    // 확인한다 - null은 "값 없음"으로 취급되고 MIXED로 세지 않는다(10절).
    const members = [
      rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", region: Region.SEOUL, regionRaw: "서울", typeTokens: new Set([FestivalType.CULTURE_ART]) }),
      rec({ id: 2, datasetYear: 2018, festivalName: "가나다축제", region: null, regionRaw: "서울", typeTokens: new Set([FestivalType.CULTURE_ART]) }),
    ];
    const model = buildFrozenSeriesModel(members);
    const group = firstGroup(model);
    expect(group.members).toHaveLength(2); // 같은 bucket(regionKey="서울")에 실제로 묶였는지 확인
    const { autoFill, fieldStatus } = computeAutoFillForGroup(group);
    expect(fieldStatus.region).toBe("STABLE");
    expect(autoFill.regionCode).toBe(Region.SEOUL);
    expect(fieldStatus.festivalTypes).toBe("STABLE");
    expect(autoFill.festivalTypes).toEqual([FestivalType.CULTURE_ART]);
  });

  it("festivalTypes: 서로 다른 type set이 관측되면 MIXED", () => {
    const members = [
      rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", typeTokens: new Set([FestivalType.CULTURE_ART]) }),
      rec({ id: 2, datasetYear: 2018, festivalName: "가나다축제", typeTokens: new Set([FestivalType.COMMUNITY]) }),
    ];
    const model = buildFrozenSeriesModel(members);
    const { autoFill, fieldStatus } = computeAutoFillForGroup(firstGroup(model));
    expect(fieldStatus.festivalTypes).toBe("MIXED");
    expect(autoFill.festivalTypes).toEqual([]);
  });
});

describe("searchFrozenSeries - ranking(8절)", () => {
  it("공백 표기가 달라도(차 없는 거리 / 차없는거리) 같은 group을 찾는다", () => {
    const members = [
      rec({ id: 1, datasetYear: 2025, festivalName: "2025 대학로 차 없는 거리 축제", districtRaw: "종로구" }),
      rec({ id: 2, datasetYear: 2026, festivalName: "2026 대학로 차 없는 거리 축제", districtRaw: "종로구" }),
    ];
    const model = buildFrozenSeriesModel(members);

    const withSpace = searchFrozenSeries(model, "차 없는 거리", 10);
    const withoutSpace = searchFrozenSeries(model, "차없는거리", 10);
    expect(withSpace).toHaveLength(1);
    expect(withoutSpace).toHaveLength(1);
    expect(withSpace[0].canonicalName).toBe("대학로 차 없는 거리 축제");
    expect(withoutSpace[0].canonicalName).toBe("대학로 차 없는 거리 축제");
  });

  it("prefix 검색(부산국제록)이 canonicalName 일부만으로도 매칭된다", () => {
    const members = [
      rec({ id: 1, datasetYear: 2017, festivalName: "제18회 부산국제록페스티벌", region: Region.BUSAN }),
      rec({ id: 2, datasetYear: 2025, festivalName: "2025 부산국제록페스티벌", region: Region.BUSAN }),
    ];
    const model = buildFrozenSeriesModel(members);
    const results = searchFrozenSeries(model, "부산국제록", 10);
    expect(results).toHaveLength(1);
    expect(results[0].canonicalName).toBe("부산국제록페스티벌");
    expect(results[0].historyCount).toBe(2);
  });

  it("연도/회차별 alias가 개별 결과로 중복 노출되지 않는다(21절)", () => {
    const members = [
      rec({ id: 1, datasetYear: 2017, festivalName: "제18회 부산국제록페스티벌" }),
      rec({ id: 2, datasetYear: 2018, festivalName: "제19회 부산국제록페스티벌" }),
      rec({ id: 3, datasetYear: 2019, festivalName: "제20회 부산국제록페스티벌" }),
      rec({ id: 4, datasetYear: 2025, festivalName: "2025 부산국제록페스티벌" }),
      rec({ id: 5, datasetYear: 2026, festivalName: "2026 부산국제록페스티벌" }),
    ];
    const model = buildFrozenSeriesModel(members);
    const results = searchFrozenSeries(model, "부산국제록페스티벌", 10);
    expect(results).toHaveLength(1);
    expect(results[0].historyCount).toBe(5);
  });

  it("normalized exact가 prefix/contains보다 항상 먼저 온다", () => {
    const members = [
      rec({ id: 1, datasetYear: 2020, festivalName: "가나다축제" }),
      rec({ id: 2, datasetYear: 2021, festivalName: "가나다축제 with 확장", region: Region.BUSAN }),
    ];
    const model = buildFrozenSeriesModel(members);
    const results = searchFrozenSeries(model, "가나다축제", 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].canonicalName).toBe("가나다축제");
  });

  it("limit을 넘는 결과는 잘린다", () => {
    const members = Array.from({ length: 5 }, (_, i) =>
      rec({ id: i + 1, datasetYear: 2020, festivalName: `테스트축제${i}`, region: Region.SEOUL })
    );
    const model = buildFrozenSeriesModel(members);
    const results = searchFrozenSeries(model, "테스트축제", 2);
    expect(results).toHaveLength(2);
  });

  it("빈 쿼리는 빈 배열을 반환한다", () => {
    const model = buildFrozenSeriesModel([rec({ id: 1, datasetYear: 2020, festivalName: "가나다축제" })]);
    expect(searchFrozenSeries(model, "", 10)).toEqual([]);
    expect(searchFrozenSeries(model, "   ", 10)).toEqual([]);
  });
});

describe("buildSeriesSearchResultKey - React key 충돌 방지(PHASE 5·6절)", () => {
  it("서로 다른 지역의 동명 series가 같은 canonicalName을 가져도 key는 서로 다르다", () => {
    const seoulMembers = [rec({ id: 1, datasetYear: 2020, festivalName: "가을꽃축제", region: Region.SEOUL, regionRaw: "서울" })];
    const busanMembers = [rec({ id: 2, datasetYear: 2020, festivalName: "가을꽃축제", region: Region.BUSAN, regionRaw: "부산" })];
    const model = buildFrozenSeriesModel([...seoulMembers, ...busanMembers]);
    const results = searchFrozenSeries(model, "가을꽃축제", 10);
    // 이름이 같아도 region이 달라 서로 다른 group으로 남아야 한다(클러스터링 자체는 기존 동작).
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.canonicalName === "가을꽃축제")).toBe(true);

    const keys = results.map(buildSeriesSearchResultKey);
    expect(new Set(keys).size).toBe(keys.length); // 충돌 없음(canonicalName만으로는 이 assertion이 실패했을 것)
  });

  it("동일 group에 대해서는 항상 같은 key를 만든다(deterministic)", () => {
    const members = [rec({ id: 1, datasetYear: 2020, festivalName: "부산국제록페스티벌", region: Region.BUSAN })];
    const model = buildFrozenSeriesModel(members);
    const results = searchFrozenSeries(model, "부산국제록페스티벌", 10);
    expect(buildSeriesSearchResultKey(results[0])).toBe(buildSeriesSearchResultKey(results[0]));
  });
});
