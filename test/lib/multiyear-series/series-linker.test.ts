import { describe, expect, it } from "vitest";
import { buildFrozenSeriesModel } from "@/lib/multiyear-series/series-linker";
import { lookupTarget } from "@/lib/multiyear-series/series-lookup";
import { FrozenSeriesModel } from "@/lib/multiyear-series/types";
import { rec } from "./helpers";

/**
 * Spring FestivalSeriesLinkingService(frozen) 파이프라인 포팅 검증 - DB 없이 손으로 만든
 * 작은 record 집합으로 deterministic/ambiguous/chain 세 가지 대표 경로를 확인한다.
 * 21,399건 전체 golden parity는 scripts/verify-multiyear-series-linker-parity.ts(별도
 * integration verification, 실제 로컬 DB 필요)가 담당한다 - 여기서는 알고리즘의 "모양"만
 * 좁게 재현한다.
 */
describe("buildFrozenSeriesModel - deterministic clustering", () => {
  it("정규화 이름+지역+district가 완전히 같은 record들을 하나의 series로 묶는다", () => {
    const r1 = rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", districtRaw: "강남구" });
    const r2 = rec({ id: 2, datasetYear: 2018, festivalName: "제2회 가나다축제", districtRaw: "강남구" });
    const r3 = rec({ id: 3, datasetYear: 2019, festivalName: "제3회 가나다축제", districtRaw: "강남구" });

    const model = buildFrozenSeriesModel([r1, r2, r3]);

    const g1 = model.groupIdByRecordId.get(1);
    expect(g1).toBeDefined();
    expect(model.groupIdByRecordId.get(2)).toBe(g1);
    expect(model.groupIdByRecordId.get(3)).toBe(g1);
    expect(model.groupsById.get(g1!)!.members).toHaveLength(3);

    // r1의 원문("가나다축제")이 정규화 결과와 같으므로 EXACT, 회차가 붙은 r2/r3는 NORMALIZED_EXACT
    expect(model.matchMethodByRecordId.get(1)).toBe("EXACT");
    expect(model.matchMethodByRecordId.get(2)).toBe("NORMALIZED_EXACT");
    expect(model.matchMethodByRecordId.get(3)).toBe("NORMALIZED_EXACT");
  });

  it("district가 다르면 결정적(EXACT/NORMALIZED_EXACT) 클러스터링 단계에서는 절대 같은 클러스터로 묶이지 않는다", () => {
    // deterministic 단계의 ClusterKey는 district를 포함하므로 district가 다르면 애초에 다른
    // 클러스터로 시작한다(그 뒤 fuzzy 단계에서 이름이 완전히 같으면 district mismatch penalty를
    // 뚫고 다시 합쳐질 수 있다는 것은 scoring.test.ts에서 별도로 검증한다 - 이 테스트는 "1단계
    // 경계"만 확인한다).
    const r1 = rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", districtRaw: "강남구" });
    const r2 = rec({ id: 2, datasetYear: 2018, festivalName: "가나다축제", districtRaw: "서초구" });
    const model = buildFrozenSeriesModel([r1, r2]);
    // 이름이 완전히 같아 fuzzy HIGH로 재병합되므로 최종 group은 같을 수 있다 - 대신 matchMethod가
    // EXACT/NORMALIZED_EXACT(결정적)가 아니라 FUZZY(1단계를 건너뛰고 2단계에서 병합)임을 확인해
    // "1단계에서는 합쳐지지 않았다"는 사실을 간접 검증한다.
    expect(model.matchMethodByRecordId.get(1)).toBe("FUZZY");
    expect(model.matchMethodByRecordId.get(2)).toBe("FUZZY");
  });

  it("서로 다른 축제(이름 유사도 낮음)는 UNMATCHED singleton으로 남는다", () => {
    const r1 = rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제" });
    const r2 = rec({ id: 2, datasetYear: 2018, festivalName: "완전히다른마바사행사" });
    const model = buildFrozenSeriesModel([r1, r2]);
    expect(model.matchMethodByRecordId.get(1)).toBe("UNMATCHED");
    expect(model.matchMethodByRecordId.get(2)).toBe("UNMATCHED");
    expect(model.groupsById.get(model.groupIdByRecordId.get(1)!)!.members).toHaveLength(1);
  });
});

describe("buildFrozenSeriesModel - ambiguous handling", () => {
  it("같은 singleton이 서로 다른 series를 가리키는 HIGH 후보를 2개 이상 받으면 자동 연결하지 않는다", () => {
    // 세 record 모두 공백 표기만 다른 "사실상 같은 문자열"이라 서로 전부 HIGH가 뜨지만,
    // 연도 간격이 전부 2년 이상(>1)이라 strict chain edge 조건(gap<=1)을 만족하지 못해
    // chain으로도 병합되지 않는다 - fuzzy 단계에서 ambiguous로 남아야 한다.
    const r1 = rec({ id: 1, datasetYear: 2017, festivalName: "가나다라마축제" });
    const r2 = rec({ id: 2, datasetYear: 2019, festivalName: "가나 다라마축제" });
    const r3 = rec({ id: 3, datasetYear: 2021, festivalName: "가나다 라마축제" });

    const model = buildFrozenSeriesModel([r1, r2, r3]);

    expect(model.matchMethodByRecordId.get(1)).toBe("UNMATCHED");
    expect(model.matchMethodByRecordId.get(2)).toBe("UNMATCHED");
    expect(model.matchMethodByRecordId.get(3)).toBe("UNMATCHED");
    // 셋 다 서로 다른 singleton group으로 남는다(자동 연결 없음)
    expect(new Set([model.groupIdByRecordId.get(1), model.groupIdByRecordId.get(2), model.groupIdByRecordId.get(3)]).size).toBe(3);
    expect(model.ambiguousTrainingRecordCount).toBeGreaterThan(0);
  });

  it("정상 매칭 경로: target이 단 하나의 series에만 HIGH로 걸리면 ambiguous 아님", () => {
    const r1 = rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제" });
    const r2 = rec({ id: 2, datasetYear: 2018, festivalName: "마바사축제" });
    const model = buildFrozenSeriesModel([r1, r2]);
    const target = rec({ id: 100, datasetYear: 2020, festivalName: "제5회 가나다축제" });
    const lookup = lookupTarget(target, model);
    expect(lookup.ambiguous).toBe(false);
    expect(lookup.matchedGroupId).toBe(model.groupIdByRecordId.get(1));
  });

  it("target이 서로 다른 두 series 모두에 HIGH로 걸리면 lookupTarget은 ambiguous를 반환하고 series signal을 안 준다", () => {
    // lookupTarget의 ambiguity 판정 자체를 독립적으로 검증하기 위해 FrozenSeriesModel을 직접
    // 구성한다(두 개의 서로 다른 series가 이미 존재하는 상황을 손으로 만든다 - buildFrozenSeriesModel이
    // 실제로 이런 모델을 만들어내는지는 위 "ambiguous handling"/"strict chain linking" 테스트가
    // 이미 별도로 검증한다).
    const seriesAMember = rec({ id: 1, datasetYear: 2017, festivalName: "가나다라마축제" });
    const seriesBMember = rec({ id: 2, datasetYear: 2018, festivalName: "가나다라마축제" });
    const model: FrozenSeriesModel = {
      groupIdByRecordId: new Map([
        [1, 10],
        [2, 20],
      ]),
      matchMethodByRecordId: new Map([
        [1, "UNMATCHED"],
        [2, "UNMATCHED"],
      ]),
      groupsById: new Map([
        [10, { groupId: 10, canonicalName: "가나다라마축제", scope: "REGION_LEVEL", canonicalRegion: "서울", canonicalDistrict: null, firstObservedYear: 2017, lastObservedYear: 2017, members: [seriesAMember] }],
        [20, { groupId: 20, canonicalName: "가나다라마축제", scope: "REGION_LEVEL", canonicalRegion: "서울", canonicalDistrict: null, firstObservedYear: 2018, lastObservedYear: 2018, members: [seriesBMember] }],
      ]),
      ambiguousTrainingRecordCount: 0,
    };

    // target 이름은 공백 표기만 다르게 해서(fuzzyKey는 동일, 원문 정규화 이름은 다름) 1단계
    // deterministic exact match(공백 보존 원문 비교)에서는 아무 group도 못 찾고 fuzzy 단계로
    // 넘어가도록 만든다 - 그래야 진짜 "fuzzy 단계 ambiguous" 경로를 테스트하는 것이 된다.
    const target = rec({ id: 100, datasetYear: 2025, festivalName: "가나다 라마축제" });
    const lookup = lookupTarget(target, model);

    expect(lookup.ambiguous).toBe(true);
    expect(lookup.matchedGroupId).toBeNull();
    expect(lookup.matchedCanonicalName).toBeNull();
    expect(lookup.ambiguousGroupIds.sort()).toEqual([10, 20]);
  });
});

describe("buildFrozenSeriesModel - strict chain linking", () => {
  it("인접 연도(gap<=1) HIGH edge가 사슬로 이어지면 전부 하나의 series로 CHAIN_HIGH_CONFIDENCE 병합한다", () => {
    // 실제 발견된 사례("진안고원운장산 고로쇠축제")와 동일한 위상: 3개 record가 공백 표기만
    // 다르고, 인접 연도(2017-2018-2019)라 A-B, B-C는 strict chain edge가 되고, 컴포넌트 전체
    // pairwise 재검증(A-C 포함)도 전부 nameSim=1.0이라 통과한다.
    const r1 = rec({ id: 1, datasetYear: 2017, festivalName: "가나다라마축제" });
    const r2 = rec({ id: 2, datasetYear: 2018, festivalName: "가나 다라마축제" });
    const r3 = rec({ id: 3, datasetYear: 2019, festivalName: "가나다 라마축제" });

    const model = buildFrozenSeriesModel([r1, r2, r3]);

    expect(model.matchMethodByRecordId.get(1)).toBe("CHAIN_HIGH_CONFIDENCE");
    expect(model.matchMethodByRecordId.get(2)).toBe("CHAIN_HIGH_CONFIDENCE");
    expect(model.matchMethodByRecordId.get(3)).toBe("CHAIN_HIGH_CONFIDENCE");

    const g1 = model.groupIdByRecordId.get(1);
    expect(model.groupIdByRecordId.get(2)).toBe(g1);
    expect(model.groupIdByRecordId.get(3)).toBe(g1);
    expect(model.groupsById.get(g1!)!.members).toHaveLength(3);

    // stale-singleton 버그 회귀 방지: chain 병합 이전에 만들어졌던 r1/r2/r3 각자의 singleton
    // group이 groupsById에 orphan으로 남아있으면 안 된다(총 group 수 = 1이어야 함).
    expect(model.groupsById.size).toBe(1);
  });

  it("연도 gap이 1을 넘는 쌍은 chain edge가 아니다(chain은 일반 fuzzy보다 훨씬 보수적)", () => {
    // r1(2017)-r2(2018)은 gap=1이라 chain edge 성립, r4(2020)는 r1/r2 양쪽과 gap=3/2라 edge가
    // 안 생긴다. 셋 다 이름이 공백표기만 달라(fuzzyKey 동일) 일반 fuzzy 단계에서는 서로가 서로에게
    // 전부 HIGH 후보라 3파전 ambiguous로 전부 UNMATCHED가 된 뒤 chain 단계로 넘어간다.
    const r1 = rec({ id: 1, datasetYear: 2017, festivalName: "가나다라마축제" });
    const r2 = rec({ id: 2, datasetYear: 2018, festivalName: "가나 다라마축제" });
    const r4 = rec({ id: 4, datasetYear: 2020, festivalName: "가나다 라마축제" });
    const model = buildFrozenSeriesModel([r1, r2, r4]);

    expect(model.matchMethodByRecordId.get(1)).toBe("CHAIN_HIGH_CONFIDENCE");
    expect(model.matchMethodByRecordId.get(2)).toBe("CHAIN_HIGH_CONFIDENCE");
    expect(model.groupIdByRecordId.get(1)).toBe(model.groupIdByRecordId.get(2));

    // r4는 어느 쪽과도 chain edge(gap<=1)가 없어 컴포넌트 자체가 안 만들어지고 UNMATCHED로 남는다.
    expect(model.matchMethodByRecordId.get(4)).toBe("UNMATCHED");
    expect(model.groupIdByRecordId.get(4)).not.toBe(model.groupIdByRecordId.get(1));
  });
});
