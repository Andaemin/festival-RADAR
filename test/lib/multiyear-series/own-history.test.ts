import { describe, expect, it } from "vitest";
import { CPI_TABLE, tryAdjustForCpi } from "@/lib/multiyear-series/cpi";
import { computeOwnHistorySignal } from "@/lib/multiyear-series/own-history";
import { buildFrozenSeriesModel } from "@/lib/multiyear-series/series-linker";
import { FrozenSeriesModel } from "@/lib/multiyear-series/types";
import { rec } from "./helpers";

/**
 * PHASE 16-C — medianBudgetKrw는 CPI-adjusted다. 기대값은 하드코딩한 매직넘버가 아니라 cpi.ts의
 * 실제 공식으로 계산해서, 두 구현이 우연히 같은 숫자를 내는 게 아니라 실제로 같은 공식을 쓰는지
 * 검증한다. medianBudgetKrwNominal은 기존(Phase 16-C 이전) 계산과 동일해야 한다.
 *
 * PHASE G0 — seriesEstimatedBudget은 이제 medianBudgetKrw 고정이 아니라 latestHistoricalGap(=
 * targetYear-latestHistoricalYear)이 2 이하면 LATEST(latestComparableBudgetKrw), 3 이상이면
 * 기존 MEDIAN(medianBudgetKrw)이다. 아래 3건은 전부 gap<=2인 시나리오라 G0 도입 이후
 * seriesEstimatedBudget이 more/의미상 LATEST 분기에서 나온다 - medianBudgetKrw 자체의 계산
 * 공식(및 그 필드 값)은 전혀 바뀌지 않았으므로 그 부분 assertion은 그대로 유지한다. gap>=3(기존
 * MEDIAN 그대로)과 gap 경계값 자체를 검증하는 테스트는 이 describe block 끝에 별도로 추가했다.
 */
describe("computeOwnHistorySignal - median/latest/geomean 계산", () => {
  it("historical budget이 3건(홀수), gap=1(LATEST 분기) - latestComparableBudgetKrw가 seriesEstimatedBudget이 된다", () => {
    const members = [
      rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", budgetKrw: 100_000_000 }),
      rec({ id: 2, datasetYear: 2018, festivalName: "제2회 가나다축제", budgetKrw: 300_000_000 }),
      rec({ id: 3, datasetYear: 2019, festivalName: "제3회 가나다축제", budgetKrw: 200_000_000 }),
    ];
    const model = buildFrozenSeriesModel(members);
    const target = rec({ id: 100, datasetYear: 2020, festivalName: "제4회 가나다축제" });

    const signal = computeOwnHistorySignal(target, 2020, model);

    expect(signal.historyCount).toBe(3);
    expect(signal.historicalYears).toEqual([2017, 2018, 2019]);
    expect(signal.latestHistoricalYear).toBe(2019);
    expect(signal.latestBudgetKrw).toBe(200_000_000); // SER1(diagnostics 전용)은 여전히 nominal.
    expect(signal.medianBudgetKrwNominal).toBe(200_000_000);
    // targetYear=2020 -> baseYear=2019. 2019년 record(200M) 자체는 ratio=1이라 무보정, 정렬 순서상
    // 여전히 중앙값이므로 CPI 적용 후에도 우연히 200M 그대로다(2017/2018 record가 CPI로 올라가도
    // 순위가 안 바뀜).
    expect(signal.medianBudgetKrw).toBe(200_000_000);
    // gap=2020-2019=1 <= 2 -> LATEST 분기. 2019년 record 자체가 CPI 무보정(anchor)이라
    // latestComparableBudgetKrw도 그대로 200M - medianBudgetKrw와 우연히 같은 값이지만 출처는 다르다.
    expect(signal.latestHistoricalGap).toBe(1);
    expect(signal.estimateSource).toBe("LATEST");
    expect(signal.latestComparableBudgetKrw).toBe(200_000_000);
    expect(signal.seriesEstimatedBudget).toBe(signal.latestComparableBudgetKrw);
  });

  it("historical budget이 2건(짝수), gap=2(LATEST 분기) - medianBudgetKrw는 여전히 두 CPI 환산값의 선형보간이지만 seriesEstimatedBudget에는 안 쓰인다", () => {
    const members = [
      rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", budgetKrw: 100_000_000 }),
      rec({ id: 2, datasetYear: 2018, festivalName: "제2회 가나다축제", budgetKrw: 300_000_000 }),
    ];
    const model = buildFrozenSeriesModel(members);
    const target = rec({ id: 100, datasetYear: 2020, festivalName: "제3회 가나다축제" });

    const signal = computeOwnHistorySignal(target, 2020, model);
    // nominal(CPI 보정 전) median은 기존과 동일하게 유지되는지 먼저 확인.
    expect(signal.medianBudgetKrwNominal).toBe(200_000_000);
    expect(signal.geometricMeanBudgetKrw).toBe(Math.round(Math.sqrt(100_000_000 * 300_000_000))); // 진단 전용 필드 - CPI 미적용 유지.

    // targetYear=2020 -> baseYear=2019(CPI_TABLE[2019]). 실제 cpi.ts 공식으로 기대값을 계산한다.
    const adjusted2017 = tryAdjustForCpi(100_000_000, 2017, 2020)!;
    const adjusted2018 = tryAdjustForCpi(300_000_000, 2018, 2020)!;
    expect(adjusted2017).not.toBeNull();
    const expectedMedian = Math.round((adjusted2017 + adjusted2018) / 2);
    // medianBudgetKrw 자체의 계산은 G0 도입과 무관하게 전혀 바뀌지 않았다(필드로 계속 노출됨).
    expect(signal.medianBudgetKrw).toBe(expectedMedian);
    expect(signal.medianBudgetKrw).not.toBe(signal.medianBudgetKrwNominal); // CPI가 실제로 값을 바꿨는지 확인.

    // PHASE G0 — gap=2020-2018=2 <= 2 -> LATEST 분기. seriesEstimatedBudget은 이제 medianBudgetKrw가
    // 아니라 latest(2018) record의 CPI-adjusted 값 하나다.
    expect(signal.latestHistoricalGap).toBe(2);
    expect(signal.estimateSource).toBe("LATEST");
    expect(signal.latestComparableBudgetKrw).toBe(Math.round(adjusted2018));
    expect(signal.seriesEstimatedBudget).toBe(signal.latestComparableBudgetKrw);
    expect(signal.seriesEstimatedBudget).not.toBe(signal.medianBudgetKrw); // 두 값이 이제 다른 것을 명시적으로 확인.
  });

  it("PHASE 16-C: CPI_TABLE에 baseYear가 없으면(targetYear>=2027) nominal로 fallback한다 - 임의 추정 없음. gap=3이라 MEDIAN 분기도 함께 확인", () => {
    const members = [
      rec({ id: 1, datasetYear: 2023, festivalName: "가나다축제", budgetKrw: 100_000_000 }),
      rec({ id: 2, datasetYear: 2024, festivalName: "제2회 가나다축제", budgetKrw: 300_000_000 }),
    ];
    const model = buildFrozenSeriesModel(members);
    const target = rec({ id: 100, datasetYear: 2027, festivalName: "제3회 가나다축제" });

    expect(CPI_TABLE[2026]).toBeUndefined(); // 전제 확인 - baseYear(2027-1=2026)가 표에 없음.
    const signal = computeOwnHistorySignal(target, 2027, model);

    expect(signal.medianBudgetKrwNominal).toBe(200_000_000);
    // baseYear(2026) CPI가 없으므로 CPI 적용을 포기하고 nominal과 동일한 값으로 fallback한다 -
    // 2025 CPI를 대신 쓰거나 추정하지 않는다. latest 분기도 같은 cpiFullyAvailable 판단을
    // 공유하므로(별도 CPI 재판단 없음) latestComparableBudgetKrw도 nominal(latestBudgetKrw)과 같다.
    expect(signal.medianBudgetKrw).toBe(signal.medianBudgetKrwNominal);
    expect(signal.latestComparableBudgetKrw).toBe(signal.latestBudgetKrw);

    // gap=2027-2024=3 >= 3 -> MEDIAN 분기(기존 로직 그대로, G0 도입 이전과 동일한 결과).
    expect(signal.latestHistoricalGap).toBe(3);
    expect(signal.estimateSource).toBe("MEDIAN");
    expect(signal.seriesEstimatedBudget).toBe(signal.medianBudgetKrw);
  });

  it("PHASE G0 — gap 경계값(1/2/3) 전부: gap<=2는 LATEST, gap>=3는 MEDIAN", () => {
    // 이 festivalSeries에 target을 여러 planningYear로 바꿔가며 물어서 gap만 다르게 만든다(같은
    // historical 4건: 2017/2018/2019/2020). CPI_TABLE이 커버하는 연도 안에서만 비교하도록
    // targetYear를 2021~2023 사이로 잡는다(baseYear=targetYear-1이 전부 CPI_TABLE에 존재).
    const members = [
      rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", budgetKrw: 100_000_000 }),
      rec({ id: 2, datasetYear: 2018, festivalName: "제2회 가나다축제", budgetKrw: 110_000_000 }),
      rec({ id: 3, datasetYear: 2019, festivalName: "제3회 가나다축제", budgetKrw: 120_000_000 }),
      rec({ id: 4, datasetYear: 2020, festivalName: "제4회 가나다축제", budgetKrw: 130_000_000 }),
    ];
    const model = buildFrozenSeriesModel(members);

    // targetYear=2021 -> latestHistoricalYear=2020 -> gap=1 -> LATEST
    const gap1 = computeOwnHistorySignal(rec({ id: 101, datasetYear: 2021, festivalName: "제5회 가나다축제" }), 2021, model);
    expect(gap1.latestHistoricalGap).toBe(1);
    expect(gap1.estimateSource).toBe("LATEST");
    expect(gap1.seriesEstimatedBudget).toBe(gap1.latestComparableBudgetKrw);

    // targetYear=2022 -> latestHistoricalYear=2020 -> gap=2 -> LATEST
    const gap2 = computeOwnHistorySignal(rec({ id: 102, datasetYear: 2022, festivalName: "제6회 가나다축제" }), 2022, model);
    expect(gap2.latestHistoricalGap).toBe(2);
    expect(gap2.estimateSource).toBe("LATEST");
    expect(gap2.seriesEstimatedBudget).toBe(gap2.latestComparableBudgetKrw);

    // targetYear=2023 -> latestHistoricalYear=2020 -> gap=3 -> MEDIAN
    const gap3 = computeOwnHistorySignal(rec({ id: 103, datasetYear: 2023, festivalName: "제7회 가나다축제" }), 2023, model);
    expect(gap3.latestHistoricalGap).toBe(3);
    expect(gap3.estimateSource).toBe("MEDIAN");
    expect(gap3.seriesEstimatedBudget).toBe(gap3.medianBudgetKrw);
    expect(gap3.seriesEstimatedBudget).not.toBe(gap3.latestComparableBudgetKrw);
  });

  it("동일 latest year에 record가 2개면 임의 선택 대신 id가 가장 작은 쪽을 결정적으로 고른다", () => {
    // 셋 다 정규화 이름이 완전히 같아(회차 표기만 다름) deterministic 1단계에서 곧바로 하나의
    // 클러스터로 묶인다 - 같은 연도(2019) record가 섞여도 deterministic 단계는 hasYearOverlap
    // 제약이 없다(그건 fuzzy 자동 union에만 적용되는 안전장치다).
    const members = [
      rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", budgetKrw: 100_000_000 }),
      rec({ id: 5, datasetYear: 2019, festivalName: "제3회 가나다축제", budgetKrw: 999_000_000 }),
      rec({ id: 2, datasetYear: 2019, festivalName: "가나다축제", budgetKrw: 111_000_000 }),
    ];
    const model = buildFrozenSeriesModel(members);
    // members 2/5가 실제로 같은 series로 묶였는지(둘 다 2019년) 전제 확인
    expect(model.groupIdByRecordId.get(2)).toBe(model.groupIdByRecordId.get(5));

    const target = rec({ id: 100, datasetYear: 2021, festivalName: "제5회 가나다축제" });
    const signal = computeOwnHistorySignal(target, 2021, model);
    expect(signal.latestHistoricalYear).toBe(2019);
    // id=2가 id=5보다 작으므로 2의 budget(111,000,000)이 선택돼야 한다.
    expect(signal.latestBudgetKrw).toBe(111_000_000);
  });

  it("leakage rule: matched group의 member라도 planningYear 이상인 연도는 절대 historical로 안 쓴다", () => {
    // buildFrozenSeriesModel이 정상적으로 만드는 그룹은 이미 trainingPool(< targetYear)만으로
    // 구성돼 leakage가 구조적으로 불가능하지만, own-history.ts 자체의 방어적 필터를 직접
    // 검증하기 위해 미래 연도가 섞인 그룹을 손으로 구성한다.
    const futureMember = rec({ id: 1, datasetYear: 2025, festivalName: "가나다축제", budgetKrw: 500_000_000 });
    const pastMember = rec({ id: 2, datasetYear: 2019, festivalName: "가나다축제", budgetKrw: 100_000_000 });
    const model: FrozenSeriesModel = {
      groupIdByRecordId: new Map([
        [1, 1],
        [2, 1],
      ]),
      matchMethodByRecordId: new Map([
        [1, "EXACT"],
        [2, "EXACT"],
      ]),
      groupsById: new Map([
        [1, { groupId: 1, canonicalName: "가나다축제", scope: "REGION_LEVEL", canonicalRegion: "서울", canonicalDistrict: null, firstObservedYear: 2019, lastObservedYear: 2025, members: [futureMember, pastMember] }],
      ]),
      ambiguousTrainingRecordCount: 0,
    };

    const target = rec({ id: 100, datasetYear: 2020, festivalName: "가나다축제" });
    const signal = computeOwnHistorySignal(target, 2020, model);

    // planningYear=2020보다 과거인 pastMember(2019)만 써야 한다 - futureMember(2025)는 제외.
    // (leakage 재확인: futureMember(2025, 500M)가 조금이라도 섞였다면 latestHistoricalYear가
    // 2025가 되거나 median/latest 값이 500M을 반영했을 것 - 아래 assertion이 그걸 잡아낸다.)
    expect(signal.historyCount).toBe(1);
    expect(signal.historicalYears).toEqual([2019]);
    expect(signal.latestBudgetKrw).toBe(100_000_000);
    expect(signal.latestHistoricalYear).toBe(2019);

    // PHASE G0 §5 — historyCount=1이면 latest==median이어야 한다(값이 하나뿐이므로 median의
    // 정의상 자명) - gap과 무관하게 estimateSource가 무엇이든 최종 seriesEstimatedBudget은 항상
    // 같아야 한다(parity). gap=2020-2019=1이므로 이 케이스는 LATEST 분기다.
    expect(signal.latestHistoricalGap).toBe(1);
    expect(signal.estimateSource).toBe("LATEST");
    expect(signal.medianBudgetKrw).toBe(signal.latestComparableBudgetKrw); // historyCount=1 parity
    expect(signal.seriesEstimatedBudget).toBe(100_000_000);
  });

  it("matched group이지만 planningYear보다 과거인 member가 하나도 없으면 signal=null(NO_VALID_HISTORY)", () => {
    const onlyFutureMember = rec({ id: 1, datasetYear: 2025, festivalName: "가나다축제" });
    const model: FrozenSeriesModel = {
      groupIdByRecordId: new Map([[1, 1]]),
      matchMethodByRecordId: new Map([[1, "EXACT"]]),
      groupsById: new Map([
        [1, { groupId: 1, canonicalName: "가나다축제", scope: "REGION_LEVEL", canonicalRegion: "서울", canonicalDistrict: null, firstObservedYear: 2025, lastObservedYear: 2025, members: [onlyFutureMember] }],
      ]),
      ambiguousTrainingRecordCount: 0,
    };
    const target = rec({ id: 100, datasetYear: 2020, festivalName: "가나다축제" });
    const signal = computeOwnHistorySignal(target, 2020, model);

    expect(signal.matchedGroupId).toBe(1); // 매칭 자체는 됐다
    expect(signal.historyCount).toBe(0);
    expect(signal.seriesEstimatedBudget).toBeNull();
    expect(signal.latestBudgetKrw).toBeNull();
    // PHASE G0 — gap을 정의할 latest 자체가 없으므로 null이어야 한다(estimateSource도 마찬가지).
    expect(signal.latestHistoricalGap).toBeNull();
    expect(signal.estimateSource).toBeNull();
    expect(signal.latestComparableBudgetKrw).toBeNull();
  });

  it("series match가 없으면(UNMATCHED) 전부 null", () => {
    const other = rec({ id: 1, datasetYear: 2017, festivalName: "완전히다른행사이름" });
    const model = buildFrozenSeriesModel([other]);
    const target = rec({ id: 100, datasetYear: 2020, festivalName: "가나다축제" });
    const signal = computeOwnHistorySignal(target, 2020, model);

    expect(signal.matchedGroupId).toBeNull();
    expect(signal.seriesEstimatedBudget).toBeNull();
    expect(signal.historyCount).toBe(0);
    expect(signal.latestHistoricalGap).toBeNull();
    expect(signal.estimateSource).toBeNull();
  });

  it("PHASE G0 §5 — historyCount=1이고 gap>=3(MEDIAN 분기)이어도 latest==median parity가 유지된다", () => {
    const members = [rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", budgetKrw: 250_000_000 })];
    const model = buildFrozenSeriesModel(members);
    // targetYear=2021 -> gap=2021-2017=4 >= 3 -> MEDIAN 분기.
    const target = rec({ id: 100, datasetYear: 2021, festivalName: "제2회 가나다축제" });
    const signal = computeOwnHistorySignal(target, 2021, model);

    expect(signal.historyCount).toBe(1);
    expect(signal.latestHistoricalGap).toBe(4);
    expect(signal.estimateSource).toBe("MEDIAN");
    // historyCount=1이면 값이 하나뿐이므로 median이든 latest든 같은 숫자여야 한다(parity) - 분기가
    // 무엇이든 최종 seriesEstimatedBudget이 달라지면 안 된다.
    expect(signal.medianBudgetKrw).toBe(signal.latestComparableBudgetKrw);
    expect(signal.seriesEstimatedBudget).toBe(signal.medianBudgetKrw);
  });
});
