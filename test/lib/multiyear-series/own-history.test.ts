import { describe, expect, it } from "vitest";
import { CPI_TABLE, tryAdjustForCpi } from "@/lib/multiyear-series/cpi";
import { computeOwnHistorySignal } from "@/lib/multiyear-series/own-history";
import { buildFrozenSeriesModel } from "@/lib/multiyear-series/series-linker";
import { FrozenSeriesModel } from "@/lib/multiyear-series/types";
import { rec } from "./helpers";

/**
 * PHASE 16-C — medianBudgetKrw(=seriesEstimatedBudget)는 이제 CPI-adjusted다. 이 파일의 기존
 * "median 계산" 테스트들은 그 사실을 반영해 업데이트한다 - 기대값은 하드코딩한 매직넘버가 아니라
 * cpi.ts의 실제 공식으로 계산해서, 두 구현이 우연히 같은 숫자를 내는 게 아니라 실제로 같은 공식을
 * 쓰는지 검증한다. medianBudgetKrwNominal은 기존(Phase 16-C 이전) 계산과 동일해야 한다.
 */
describe("computeOwnHistorySignal - median/latest/geomean 계산", () => {
  it("historical budget이 3건(홀수)이면 median은 가운데 값 - CPI 환산 후에도(우연히 anchor연도라 무보정)", () => {
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
    // 순위가 안 바뀜) - 아래 4번째 테스트가 실제로 값이 바뀌는 CPI 적용 사례를 검증한다.
    expect(signal.medianBudgetKrw).toBe(200_000_000);
    expect(signal.seriesEstimatedBudget).toBe(signal.medianBudgetKrw);
  });

  it("historical budget이 2건(짝수)이면 CPI-adjusted median은 두 CPI 환산값의 선형보간(중간)", () => {
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
    expect(signal.medianBudgetKrw).toBe(expectedMedian);
    expect(signal.medianBudgetKrw).not.toBe(signal.medianBudgetKrwNominal); // CPI가 실제로 값을 바꿨는지 확인.
    expect(signal.seriesEstimatedBudget).toBe(signal.medianBudgetKrw);
  });

  it("PHASE 16-C: CPI_TABLE에 baseYear가 없으면(targetYear>=2027) nominal로 fallback한다 - 임의 추정 없음", () => {
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
    // 2025 CPI를 대신 쓰거나 추정하지 않는다.
    expect(signal.medianBudgetKrw).toBe(signal.medianBudgetKrwNominal);
    expect(signal.seriesEstimatedBudget).toBe(signal.medianBudgetKrw);
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
    expect(signal.historyCount).toBe(1);
    expect(signal.historicalYears).toEqual([2019]);
    expect(signal.latestBudgetKrw).toBe(100_000_000);
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
  });

  it("series match가 없으면(UNMATCHED) 전부 null", () => {
    const other = rec({ id: 1, datasetYear: 2017, festivalName: "완전히다른행사이름" });
    const model = buildFrozenSeriesModel([other]);
    const target = rec({ id: 100, datasetYear: 2020, festivalName: "가나다축제" });
    const signal = computeOwnHistorySignal(target, 2020, model);

    expect(signal.matchedGroupId).toBeNull();
    expect(signal.seriesEstimatedBudget).toBeNull();
    expect(signal.historyCount).toBe(0);
  });
});
