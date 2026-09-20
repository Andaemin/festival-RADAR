import { describe, expect, it } from "vitest";
import { buildFrozenSeriesModel, mergeMultiMemberGroups } from "@/lib/multiyear-series/series-linker";
import { lookupTarget } from "@/lib/multiyear-series/series-lookup";
import { FrozenSeriesGroup, FrozenSeriesModel, SeriesRecordLite } from "@/lib/multiyear-series/types";
import { rec } from "./helpers";

/** mergeMultiMemberGroups 단위 테스트 전용 헬퍼 - FrozenSeriesGroup을 손으로 만든다. */
function grp(overrides: {
  groupId: number;
  canonicalName: string;
  scope?: "DISTRICT_LEVEL" | "REGION_LEVEL";
  canonicalRegion?: string;
  canonicalDistrict?: string | null;
  members: SeriesRecordLite[];
}): FrozenSeriesGroup {
  const years = overrides.members.map((m) => m.datasetYear);
  return {
    groupId: overrides.groupId,
    canonicalName: overrides.canonicalName,
    scope: overrides.scope ?? "DISTRICT_LEVEL",
    canonicalRegion: overrides.canonicalRegion ?? "서울",
    canonicalDistrict: overrides.canonicalDistrict !== undefined ? overrides.canonicalDistrict : "강남구",
    firstObservedYear: Math.min(...years),
    lastObservedYear: Math.max(...years),
    members: overrides.members,
  };
}
function groupsMap(groups: FrozenSeriesGroup[]): Map<number, FrozenSeriesGroup> {
  return new Map(groups.map((g) => [g.groupId, g]));
}
function recordIdMap(groups: FrozenSeriesGroup[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const g of groups) for (const r of g.members) m.set(r.id, g.groupId);
  return m;
}

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

/**
 * research-series-merge-impact.md — 다인원 cluster 간 안전 병합(mergeMultiMemberGroups) 단위 테스트.
 * 기존 EXACT/NORMALIZED_EXACT/FUZZY/CHAIN_HIGH_CONFIDENCE 판정(위 describe들)은 이 단계가 전혀
 * 건드리지 않으므로, 여기서는 "이미 이력 2건 이상인 group끼리의 안전한 병합" 자체만 좁게 검증한다.
 */
describe("mergeMultiMemberGroups - 다인원 cluster 간 안전 병합", () => {
  it("[시나리오3] multi-member <-> multi-member: 이름 사실상 동일 + 연도 미중복이면 하나로 합친다", () => {
    const a = grp({ groupId: 1, canonicalName: "가나다라마축제", members: [rec({ id: 1, datasetYear: 2017, festivalName: "가나다라마축제" }), rec({ id: 2, datasetYear: 2018, festivalName: "가나다라마축제" })] });
    const b = grp({ groupId: 2, canonicalName: "가나 다라마축제", members: [rec({ id: 3, datasetYear: 2020, festivalName: "가나 다라마축제" }), rec({ id: 4, datasetYear: 2021, festivalName: "가나 다라마축제" })] });

    const result = mergeMultiMemberGroups(groupsMap([a, b]), recordIdMap([a, b]));

    expect(result.groupsById.size).toBe(1);
    expect(result.appliedMerges).toHaveLength(1);
    const survivorId = result.groupIdByRecordId.get(1)!;
    for (const id of [1, 2, 3, 4]) expect(result.groupIdByRecordId.get(id)).toBe(survivorId);
    expect(result.groupsById.get(survivorId)!.members).toHaveLength(4);
  });

  it("[시나리오4/5] 직접 연결은 안전하지만 전이적 결과가 연도 중복이면 그 union만 차단하고, root는 최신 상태로 갱신된다", () => {
    // 지침의 예시 그대로: A(2021,2022) + B(2019,2023)는 안전하게 합칠 수 있지만, 그 뒤
    // (A+B)와 C(2022,2024)는 2022년이 겹쳐 차단돼야 한다 - 개별 edge(A-C, B-C)만 봐서는 안 되고
    // "A+B 전체"의 연도로 재검사해야 한다.
    const a = grp({ groupId: 1, canonicalName: "가나다라마축제", members: [rec({ id: 1, datasetYear: 2021, festivalName: "가나다라마축제" }), rec({ id: 2, datasetYear: 2022, festivalName: "가나다라마축제" })] });
    const b = grp({ groupId: 2, canonicalName: "가나 다라마축제", members: [rec({ id: 3, datasetYear: 2019, festivalName: "가나 다라마축제" }), rec({ id: 4, datasetYear: 2023, festivalName: "가나 다라마축제" })] });
    const c = grp({ groupId: 3, canonicalName: "가나다 라마축제", members: [rec({ id: 5, datasetYear: 2022, festivalName: "가나다 라마축제" }), rec({ id: 6, datasetYear: 2024, festivalName: "가나다 라마축제" })] });

    const result = mergeMultiMemberGroups(groupsMap([a, b, c]), recordIdMap([a, b, c]));

    // A+B만 합쳐지고 C는 분리된 채 남는다 -> 최종 group은 2개.
    expect(result.groupsById.size).toBe(2);
    expect(result.appliedMerges).toHaveLength(1);

    const abRoot = result.groupIdByRecordId.get(1)!;
    expect(result.groupIdByRecordId.get(3)).toBe(abRoot); // B도 같은 root
    expect(result.groupsById.get(abRoot)!.members).toHaveLength(4);

    const cRoot = result.groupIdByRecordId.get(5)!;
    expect(cRoot).not.toBe(abRoot);
    expect(result.groupsById.get(cRoot)!.members).toHaveLength(2);

    // [시나리오5] union 이후 root가 바뀜: A(firstYear=2021)보다 B(firstYear=2019)가 더 이르므로
    // survivor는 B의 원래 groupId(2)가 된다 - A(id=1)의 최초 groupId(1)로 남지 않는다.
    expect(abRoot).toBe(2);
    expect(result.groupIdByRecordId.get(1)).not.toBe(1);
  });

  it("[시나리오6] 이미 같은 cluster로 합쳐진 group 쌍은 재평가 시 아무 일도 하지 않는다(중복 union 없음)", () => {
    // A-B, A-C 순서로 먼저 합쳐지고 나면 B-C 후보를 평가할 시점엔 이미 find(B)===find(C)라
    // 아무 병합도 일어나지 않아야 한다(A/B/C 전부 서로 연도 미중복이라 안전하게 3개 다 합쳐짐).
    const a = grp({ groupId: 100, canonicalName: "마바사축제", members: [rec({ id: 10, datasetYear: 2017, festivalName: "마바사축제" }), rec({ id: 11, datasetYear: 2018, festivalName: "마바사축제" })] });
    const b = grp({ groupId: 101, canonicalName: "마바 사축제", members: [rec({ id: 12, datasetYear: 2020, festivalName: "마바 사축제" }), rec({ id: 13, datasetYear: 2021, festivalName: "마바 사축제" })] });
    const c = grp({ groupId: 102, canonicalName: "마 바사축제", members: [rec({ id: 14, datasetYear: 2023, festivalName: "마 바사축제" }), rec({ id: 15, datasetYear: 2024, festivalName: "마 바사축제" })] });

    const result = mergeMultiMemberGroups(groupsMap([a, b, c]), recordIdMap([a, b, c]));

    expect(result.groupsById.size).toBe(1); // 셋 다 하나로 합쳐짐(연도 충돌 없음)
    expect(result.appliedMerges).toHaveLength(2); // 3개 group을 하나로 묶는 데 필요한 union은 2번뿐(3번째는 재평가라 스킵)
    const root = result.groupIdByRecordId.get(10)!;
    for (const id of [10, 11, 12, 13, 14, 15]) expect(result.groupIdByRecordId.get(id)).toBe(root);
    expect(result.groupsById.get(root)!.members).toHaveLength(6);
  });

  it("[시나리오7] 이름이 사실상 같아도 지역(region)이 다르면 합치지 않는다(기존 차단 규칙 유지)", () => {
    const a = grp({ groupId: 1, canonicalName: "가나다라마축제", canonicalRegion: "서울", members: [rec({ id: 1, datasetYear: 2017, festivalName: "가나다라마축제", region: undefined, regionRaw: "서울" }), rec({ id: 2, datasetYear: 2018, festivalName: "가나다라마축제", regionRaw: "서울" })] });
    const b = grp({ groupId: 2, canonicalName: "가나 다라마축제", canonicalRegion: "부산", members: [rec({ id: 3, datasetYear: 2020, festivalName: "가나 다라마축제", regionRaw: "부산" }), rec({ id: 4, datasetYear: 2021, festivalName: "가나 다라마축제", regionRaw: "부산" })] });

    const result = mergeMultiMemberGroups(groupsMap([a, b]), recordIdMap([a, b]));

    expect(result.appliedMerges).toHaveLength(0);
    expect(result.groupsById.size).toBe(2);
    expect(result.groupIdByRecordId.get(1)).not.toBe(result.groupIdByRecordId.get(3));
  });

  it("[시나리오7-b] scope(DISTRICT_LEVEL vs REGION_LEVEL)가 다르면 합치지 않는다", () => {
    const a = grp({ groupId: 1, canonicalName: "가나다라마축제", scope: "DISTRICT_LEVEL", canonicalDistrict: "강남구", members: [rec({ id: 1, datasetYear: 2017, festivalName: "가나다라마축제", districtRaw: "강남구" }), rec({ id: 2, datasetYear: 2018, festivalName: "가나다라마축제", districtRaw: "강남구" })] });
    const b = grp({ groupId: 2, canonicalName: "가나 다라마축제", scope: "REGION_LEVEL", canonicalDistrict: null, members: [rec({ id: 3, datasetYear: 2020, festivalName: "가나 다라마축제", districtRaw: null }), rec({ id: 4, datasetYear: 2021, festivalName: "가나 다라마축제", districtRaw: null })] });

    const result = mergeMultiMemberGroups(groupsMap([a, b]), recordIdMap([a, b]));

    expect(result.appliedMerges).toHaveLength(0);
    expect(result.groupsById.size).toBe(2);
  });

  it("[시나리오8] group을 넣는 순서를 바꿔도 최종 결과(합쳐진 묶음/구성원)는 동일하다", () => {
    const a = grp({ groupId: 1, canonicalName: "가나다라마축제", members: [rec({ id: 1, datasetYear: 2021, festivalName: "가나다라마축제" }), rec({ id: 2, datasetYear: 2022, festivalName: "가나다라마축제" })] });
    const b = grp({ groupId: 2, canonicalName: "가나 다라마축제", members: [rec({ id: 3, datasetYear: 2019, festivalName: "가나 다라마축제" }), rec({ id: 4, datasetYear: 2023, festivalName: "가나 다라마축제" })] });
    const c = grp({ groupId: 3, canonicalName: "가나다 라마축제", members: [rec({ id: 5, datasetYear: 2022, festivalName: "가나다 라마축제" }), rec({ id: 6, datasetYear: 2024, festivalName: "가나다 라마축제" })] });

    const forward = mergeMultiMemberGroups(groupsMap([a, b, c]), recordIdMap([a, b, c]));
    const reversed = mergeMultiMemberGroups(groupsMap([c, b, a]), recordIdMap([c, b, a]));

    const normalize = (r: ReturnType<typeof mergeMultiMemberGroups>) =>
      [...r.groupsById.values()]
        .map((g) => [...g.members.map((m) => m.id)].sort((x, y) => x - y).join(","))
        .sort();
    expect(normalize(forward)).toEqual(normalize(reversed));
    expect(forward.appliedMerges.length).toBe(reversed.appliedMerges.length);
  });

  it("이력 1건짜리 singleton group은 이 단계의 대상이 아니다(기존 fuzzy/chain 단계 전담 영역 유지)", () => {
    const singleton = grp({ groupId: 1, canonicalName: "가나다라마축제", members: [rec({ id: 1, datasetYear: 2017, festivalName: "가나다라마축제" })] });
    const multi = grp({ groupId: 2, canonicalName: "가나 다라마축제", members: [rec({ id: 2, datasetYear: 2019, festivalName: "가나 다라마축제" }), rec({ id: 3, datasetYear: 2020, festivalName: "가나 다라마축제" })] });

    const result = mergeMultiMemberGroups(groupsMap([singleton, multi]), recordIdMap([singleton, multi]));

    expect(result.appliedMerges).toHaveLength(0);
    expect(result.groupsById.size).toBe(2);
    expect(result.groupsById.get(1)).toBe(singleton); // 원본 그대로 보존(재구성 없음)
  });

  it("고정 fixture: 연결된 record ID 집합과 개최연도 집합을 카운트가 아니라 정확한 값으로 직접 검사한다", () => {
    // 실제 발견 사례(화성 뱃놀이 축제/양평 용문산 산나물 축제)의 위상을 그대로 딴 4-group
    // 고정 fixture: X(안전 병합 대상, id 1000-1001), Y(X와 안전, id 1002-1004),
    // Z(X와는 안전하지만 Y와 병합된 이후의 Y root와는 연도가 겹쳐 차단돼야 함, id 1005-1006).
    // 카운트(toHaveLength)가 아니라 실제 record id 집합과 연도 집합을 하드코딩해서 비교한다 -
    // 현재 출력값을 그대로 golden으로 복사한 것이 아니라, 지침의 안전 규칙("X+Y는 되지만
    // (X+Y)+Z는 2020이 겹쳐서 안 된다")을 손으로 미리 계산한 기대값이다.
    const x = grp({
      groupId: 1000,
      canonicalName: "가나다라마바축제",
      members: [rec({ id: 1000, datasetYear: 2017, festivalName: "가나다라마바축제" }), rec({ id: 1001, datasetYear: 2018, festivalName: "가나다라마바축제" })],
    });
    const y = grp({
      groupId: 1002,
      canonicalName: "가나 다라마바축제",
      members: [
        rec({ id: 1002, datasetYear: 2019, festivalName: "가나 다라마바축제" }),
        rec({ id: 1003, datasetYear: 2020, festivalName: "가나 다라마바축제" }),
        rec({ id: 1004, datasetYear: 2021, festivalName: "가나 다라마바축제" }),
      ],
    });
    const z = grp({
      groupId: 1005,
      canonicalName: "가나다 라마바축제",
      members: [rec({ id: 1005, datasetYear: 2020, festivalName: "가나다 라마바축제" }), rec({ id: 1006, datasetYear: 2022, festivalName: "가나다 라마바축제" })],
    });

    const result = mergeMultiMemberGroups(groupsMap([x, y, z]), recordIdMap([x, y, z]));

    // 손으로 미리 계산한 기대값: X+Y가 합쳐진 root의 구성 record id는 정확히 {1000,1001,1002,1003,1004}이고
    // 그 연도 집합은 정확히 {2017,2018,2019,2020,2021}이다. Z(id 1005,1006)는 분리된 채 남는다.
    const xyRoot = result.groupIdByRecordId.get(1000)!;
    const xyGroup = result.groupsById.get(xyRoot)!;
    expect(new Set(xyGroup.members.map((m) => m.id))).toEqual(new Set([1000, 1001, 1002, 1003, 1004]));
    expect(new Set(xyGroup.members.map((m) => m.datasetYear))).toEqual(new Set([2017, 2018, 2019, 2020, 2021]));

    const zRoot = result.groupIdByRecordId.get(1005)!;
    expect(zRoot).not.toBe(xyRoot);
    const zGroup = result.groupsById.get(zRoot)!;
    expect(new Set(zGroup.members.map((m) => m.id))).toEqual(new Set([1005, 1006]));
    expect(new Set(zGroup.members.map((m) => m.datasetYear))).toEqual(new Set([2020, 2022]));

    // Z가 X나 Y 어느 쪽 record id와도 같은 group에 속하지 않는지 명시적으로 확인.
    for (const zId of [1005, 1006]) {
      for (const xyId of [1000, 1001, 1002, 1003, 1004]) {
        expect(result.groupIdByRecordId.get(zId)).not.toBe(result.groupIdByRecordId.get(xyId));
      }
    }
  });
});

describe("buildFrozenSeriesModel - 다인원 cluster 병합 통합(전체 파이프라인) + 회귀 fixture", () => {
  it("[시나리오1 회귀] singleton <-> singleton 기존 fuzzy 연결은 그대로 동작한다", () => {
    const r1 = rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제" });
    const r2 = rec({ id: 2, datasetYear: 2019, festivalName: "가나 다축제" });
    const model = buildFrozenSeriesModel([r1, r2]);
    expect(model.matchMethodByRecordId.get(1)).toBe("FUZZY");
    expect(model.groupIdByRecordId.get(1)).toBe(model.groupIdByRecordId.get(2));
    expect(model.groupsById.size).toBe(1);
  });

  it("[시나리오2 회귀] multi-member <-> singleton은 기존 1~4단계에서 이미 처리되고, 새 5단계는 개입하지 않는다", () => {
    const r1 = rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제" });
    const r2 = rec({ id: 2, datasetYear: 2018, festivalName: "제2회 가나다축제" }); // r1과 EXACT/NORMALIZED_EXACT로 이미 2건 group
    const r3 = rec({ id: 3, datasetYear: 2020, festivalName: "가나 다축제" }); // singleton, fuzzy로 위 group에 흡수돼야 함
    const model = buildFrozenSeriesModel([r1, r2, r3]);

    expect(model.matchMethodByRecordId.get(3)).toBe("FUZZY");
    expect(model.groupIdByRecordId.get(3)).toBe(model.groupIdByRecordId.get(1));
    expect(model.groupsById.get(model.groupIdByRecordId.get(1)!)!.members).toHaveLength(3);
  });

  it("[시나리오9 fixture-1] 실제 발견 사례 재현: '화성 뱃놀이 축제' 유형 - 3개 표기 중 두 표기가 연도를 공유하면 그 병합만 차단된다", () => {
    // research-series-merge-impact.md STEP2 발견 사례("화성 뱃놀이 축제" 충돌 연도=[2024])의
    // 구조를 축소 재현: 표기 A/B/C가 전부 이름 사실상 동일 + HIGH band지만, A와 C가 2021년을
    // 공유한다(원본 사례는 서로 다른 표기 사이의 실제 연도 겹침이 원인이었다 - 한 표기 내부의
    // 중복 연도가 아니라 **두 표기 사이의** 겹침이 병합을 막아야 하는 진짜 조건이다).
    const groupA = [2017, 2018, 2019, 2020, 2021].map((y, i) => rec({ id: 100 + i, datasetYear: y, festivalName: "화성 뱃놀이 축제" }));
    const groupB = [2022, 2023].map((y, i) => rec({ id: 200 + i, datasetYear: y, festivalName: "화성뱃놀이축제" }));
    const groupC = [2021, 2024].map((y, i) => rec({ id: 300 + i, datasetYear: y, festivalName: "화성뱃놀이 축제" })); // 2021이 A와 겹침

    const model = buildFrozenSeriesModel([...groupA, ...groupB, ...groupC]);

    // 셋 다 하나로 합쳐지면 2021년이 중복되므로, 최종적으로 2개 group으로만 나뉘어야 한다
    // (A-B는 안전해서 합쳐지고 C가 분리되거나, 처리 순서에 따라 다른 조합이 될 수도 있다 -
    // 어느 쪽이든 "셋 다 하나"만은 되면 안 된다는 안전 속성만 확인한다).
    const rootA = model.groupIdByRecordId.get(100)!;
    const rootB = model.groupIdByRecordId.get(200)!;
    const rootC = model.groupIdByRecordId.get(300)!;
    const distinctRoots = new Set([rootA, rootB, rootC]);
    expect(distinctRoots.size).toBe(2);

    const totalMembers = [...distinctRoots].reduce((sum, r) => sum + model.groupsById.get(r)!.members.length, 0);
    expect(totalMembers).toBe(9); // 5+2+2, 유실 없음

    // 최종적으로 어느 group에도 같은 연도가 두 번 이상 나타나면 안 된다(핵심 무결성 확인).
    for (const g of model.groupsById.values()) {
      const years = g.members.map((m) => m.datasetYear);
      expect(new Set(years).size).toBe(years.length);
    }
  });

  it("[시나리오9 fixture-2] 실제 발견 사례 재현: '양평 용문산 산나물 축제' 유형 - 3표기가 서로 다른 두 표기와 각각 연도가 겹치면 그 두 표기만 분리된다", () => {
    // 실제 사례는 세 표기 모두가 서로 뒤엉켜 있었다(2019/2020/2025 중복) - 축소 재현:
    // X(2017,2018) + Y(2019,2020) + Z(2019,2021) - X-Y, X-Z는 안전하지만 Y-Z는 2019가 겹친다.
    const x = [2017, 2018].map((y, i) => rec({ id: 400 + i, datasetYear: y, festivalName: "양평용문산산나물축제" }));
    const yGroup = [2019, 2020].map((y, i) => rec({ id: 500 + i, datasetYear: y, festivalName: "양평 용문산 산나물 축제" }));
    const z = [2019, 2021].map((y, i) => rec({ id: 600 + i, datasetYear: y, festivalName: "양평용문산 산나물축제" }));

    const model = buildFrozenSeriesModel([...x, ...yGroup, ...z]);

    // X는 Y, Z 양쪽 모두와 안전하게 합쳐질 수 있지만(연도 미중복), Y와 Z는 서로 2019가 겹친다.
    // 점수 동점 시 처리 순서에 따라 최종적으로 X+Y 또는 X+Z 둘 중 하나만 합쳐지고 나머지 하나는
    // 분리된 채 남아야 한다(셋 다 하나로 합쳐지면 안 됨 - 그러면 2019가 중복된다).
    const rootX = model.groupIdByRecordId.get(400)!;
    const rootY = model.groupIdByRecordId.get(500)!;
    const rootZ = model.groupIdByRecordId.get(600)!;
    const distinctRoots = new Set([rootX, rootY, rootZ]);
    expect(distinctRoots.size).toBe(2); // 셋이 두 그룹으로 나뉜다(하나로 뭉치지 않음)

    for (const g of model.groupsById.values()) {
      const years = g.members.map((m) => m.datasetYear);
      expect(new Set(years).size).toBe(years.length); // 어느 group도 연도 중복 없음
    }
  });
});
