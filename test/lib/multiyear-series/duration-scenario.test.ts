import { describe, expect, it } from "vitest";
import {
  computeDurationChangeStatus,
  computeDurationScenario,
  deriveComparisonDuration,
  validateVariableCostInput,
} from "@/lib/multiyear-series/duration-scenario";
import type { SeriesHistoryDetailDto, SeriesHistoryRecordDetailDto } from "@/lib/multiyear-series/series-history-detail";

/**
 * Feature: Series 기간 변경 계획 시뮬레이션 — 20절 최소 테스트 A~D, H를 여기서 순수 함수
 * 단위로 검증한다(이 프로젝트에는 컴포넌트 렌더링 인프라가 없다 - planning-ui-display.test.ts와
 * 동일한 관례). E(Peer 미표시)/F(Series 변경 시 reset)/G(duration만 변경)는 page.tsx의 조건부
 * 렌더링(seriesDisplay.kind==="SERIES_APPLIED")과 useEffect(deps: selectedSeries/planningYear/
 * festivalMode)로 구현되며, 브라우저 acceptance(§22)로 확인한다.
 */

function fakeRecord(overrides: Partial<SeriesHistoryRecordDetailDto> = {}): SeriesHistoryRecordDetailDto {
  return {
    datasetYear: 2024,
    festivalName: "테스트축제",
    region: null,
    district: null,
    festivalTypes: [],
    venueType: null,
    durationDays: 3,
    originalBudgetKrw: 1_000_000_000,
    cpiAdjustedBudgetKrw: 1_000_000_000,
    eligibleForSeriesCalculation: true,
    usedAsPointEstimateSource: true,
    exclusionReason: null,
    ...overrides,
  };
}

function fakeDetail(records: SeriesHistoryRecordDetailDto[], overrides: Partial<SeriesHistoryDetailDto> = {}): SeriesHistoryDetailDto {
  return {
    canonicalName: "테스트축제",
    firstObservedYear: 2020,
    lastObservedYear: 2024,
    displayedRecordCount: records.length,
    eligibleForSeriesCalculationCount: records.filter((r) => r.eligibleForSeriesCalculation).length,
    excludedCount: records.filter((r) => !r.eligibleForSeriesCalculation).length,
    cpiFullyAvailable: true,
    estimateSource: "LATEST",
    latestHistoricalYear: 2024,
    latestHistoricalGap: 1,
    records,
    ...overrides,
  };
}

describe("deriveComparisonDuration", () => {
  it("eligible record 중 가장 최근 datasetYear의 durationDays를 쓴다", () => {
    const detail = fakeDetail([
      fakeRecord({ datasetYear: 2021, durationDays: 5 }),
      fakeRecord({ datasetYear: 2023, durationDays: 3 }),
      fakeRecord({ datasetYear: 2022, durationDays: 4 }),
    ]);
    expect(deriveComparisonDuration(detail)).toEqual({ comparisonDurationDays: 3, comparisonDurationYear: 2023 });
  });

  it("가장 최근 record의 durationDays가 null이면 그 다음으로 최근인, durationDays가 있는 record를 쓴다", () => {
    const detail = fakeDetail([
      fakeRecord({ datasetYear: 2022, durationDays: 4 }),
      fakeRecord({ datasetYear: 2023, durationDays: null }),
    ]);
    expect(deriveComparisonDuration(detail)).toEqual({ comparisonDurationDays: 4, comparisonDurationYear: 2022 });
  });

  it("eligibleForSeriesCalculation=false인 record는 후보에서 제외한다(계산 제외 record)", () => {
    const detail = fakeDetail([
      fakeRecord({ datasetYear: 2023, durationDays: 7, eligibleForSeriesCalculation: false, usedAsPointEstimateSource: false }),
      fakeRecord({ datasetYear: 2021, durationDays: 3 }),
    ]);
    expect(deriveComparisonDuration(detail)).toEqual({ comparisonDurationDays: 3, comparisonDurationYear: 2021 });
  });

  it("H: MEDIAN estimateSource여도 가장 최근 historical duration을 그대로 비교 기준으로 쓴다(예산 산정 기준과 별개)", () => {
    const detail = fakeDetail(
      [
        fakeRecord({ datasetYear: 2020, durationDays: 3, usedAsPointEstimateSource: true }),
        fakeRecord({ datasetYear: 2021, durationDays: 5, usedAsPointEstimateSource: true }),
        fakeRecord({ datasetYear: 2022, durationDays: 4, usedAsPointEstimateSource: true }),
      ],
      { estimateSource: "MEDIAN", latestHistoricalYear: 2022, latestHistoricalGap: 4 }
    );
    // MEDIAN 예산 산정은 세 record 전체의 median을 쓰지만, 기간 비교는 여전히 가장 최근(2022)의
    // durationDays=4만 쓴다 - "예산 산정 기준"과 "기간 비교 기준"을 섞지 않는다는 13절 요구사항.
    expect(deriveComparisonDuration(detail)).toEqual({ comparisonDurationDays: 4, comparisonDurationYear: 2022 });
  });

  it("과거 개최기간 정보가 전혀 없으면(모든 eligible record의 durationDays===null) null - 임의 기간을 만들지 않는다", () => {
    const detail = fakeDetail([fakeRecord({ durationDays: null }), fakeRecord({ datasetYear: 2023, durationDays: null })]);
    expect(deriveComparisonDuration(detail)).toBeNull();
  });
});

describe("computeDurationChangeStatus", () => {
  it("A: historical=3, target=3 -> SAME", () => {
    expect(computeDurationChangeStatus(3, 3)).toBe("SAME");
  });
  it("B: historical=3, target=5 -> INCREASE", () => {
    expect(computeDurationChangeStatus(3, 5)).toBe("INCREASE");
  });
  it("C: historical=5, target=3 -> DECREASE", () => {
    expect(computeDurationChangeStatus(5, 3)).toBe("DECREASE");
  });
  it("comparisonDurationDays가 null이면 UNKNOWN", () => {
    expect(computeDurationChangeStatus(null, 5)).toBe("UNKNOWN");
  });
});

describe("computeDurationScenario", () => {
  it("B: 기간 증가 — historical=3, target=5, variable=30,000,000원/일 -> adjustment=+60,000,000", () => {
    const result = computeDurationScenario({
      recommendedBudgetKrw: 2_000_000_000,
      comparisonDurationDays: 3,
      targetDurationDays: 5,
      variableCostPerDayKrw: 30_000_000,
    });
    expect(result).toEqual({
      durationDelta: 2,
      durationAdjustmentKrw: 60_000_000,
      scenarioRecommendedBudgetKrw: 2_060_000_000,
    });
  });

  it("C: 기간 감소 — historical=5, target=3, variable=30,000,000원/일 -> adjustment=-60,000,000", () => {
    const result = computeDurationScenario({
      recommendedBudgetKrw: 2_000_000_000,
      comparisonDurationDays: 5,
      targetDurationDays: 3,
      variableCostPerDayKrw: 30_000_000,
    });
    expect(result).toEqual({
      durationDelta: -2,
      durationAdjustmentKrw: -60_000_000,
      scenarioRecommendedBudgetKrw: 1_940_000_000,
    });
  });

  it("A: delta=0이면 조정금액도 0 - 시나리오 예산은 추천 예산과 동일", () => {
    const result = computeDurationScenario({
      recommendedBudgetKrw: 2_000_000_000,
      comparisonDurationDays: 3,
      targetDurationDays: 3,
      variableCostPerDayKrw: 30_000_000,
    });
    expect(result).toEqual({ durationDelta: 0, durationAdjustmentKrw: 0, scenarioRecommendedBudgetKrw: 2_000_000_000 });
  });

  it("추천 계획예산 자체는 이 함수의 입력으로만 쓰이고 절대 재계산되지 않는다(그대로 통과)", () => {
    const result = computeDurationScenario({
      recommendedBudgetKrw: 1_234_567_890,
      comparisonDurationDays: 3,
      targetDurationDays: 3,
      variableCostPerDayKrw: 0,
    });
    expect(result.scenarioRecommendedBudgetKrw).toBe(1_234_567_890);
  });
});

describe("validateVariableCostInput", () => {
  it("D: 빈 값은 valid=true, value=null(아직 입력 전 - baseline 유지)", () => {
    expect(validateVariableCostInput("")).toEqual({ valid: true, value: null, errorMessage: null });
    expect(validateVariableCostInput("   ")).toEqual({ valid: true, value: null, errorMessage: null });
  });

  it("0 이상의 숫자는 valid=true", () => {
    expect(validateVariableCostInput("0")).toEqual({ valid: true, value: 0, errorMessage: null });
    expect(validateVariableCostInput("30000000")).toEqual({ valid: true, value: 30_000_000, errorMessage: null });
  });

  it("음수는 invalid", () => {
    const result = validateVariableCostInput("-1");
    expect(result.valid).toBe(false);
    expect(result.value).toBeNull();
  });

  it("숫자가 아닌 입력은 invalid", () => {
    const result = validateVariableCostInput("abc");
    expect(result.valid).toBe(false);
    expect(result.value).toBeNull();
  });

  it("지나치게 큰 값도 임의로 clamp하지 않고 그대로 valid", () => {
    expect(validateVariableCostInput("999999999999")).toEqual({ valid: true, value: 999_999_999_999, errorMessage: null });
  });
});
