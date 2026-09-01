import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { FestivalType, Region } from "@/lib/domain/enums";
import { CPI_TABLE } from "@/lib/multiyear-series/cpi";
import { buildSeriesTrainingPool } from "@/lib/multiyear-series/fold";
import { computeOwnHistorySignal } from "@/lib/multiyear-series/own-history";
import { loadAllSeriesRecords } from "@/lib/multiyear-series/record-loader";
import { computeLeakageSafeVolatilityThreshold, computePlanningReliability, tierFromVolatility } from "@/lib/multiyear-series/reliability";
import { buildFrozenSeriesModel } from "@/lib/multiyear-series/series-linker";
import { computeSeriesSignal } from "@/lib/multiyear-series/series-signal";
import { buildSyntheticTargetRecord } from "@/lib/multiyear-series/target-from-query";
import { rec } from "./helpers";

/**
 * PHASE — Final Production Benchmark & Future-Year Safety. 실제 DB(2017~2026)를 읽기 전용으로
 * 사용한다. G0 formula/gap threshold/CPI 정책/reliability threshold 로직은 이 Phase에서 전혀
 * 바뀌지 않는다 - 이미 존재하는 production 함수를 미래 planningYear에 적용했을 때도 안전하게
 * 동작하는지만 확인한다.
 */
const FUTURE_YEARS = [2027, 2028, 2029, 2030, 2035];

describe("10. Future-Year Safety — 기본 범위(2027~2035)에서 crash/NaN/Infinity/negative 없음", () => {
  it.each(FUTURE_YEARS)("planningYear=%i: Series model 생성 정상, 전체 evalTarget에 대해 NaN/Infinity/음수 없음", async (targetYear) => {
    const allSeriesRecords = await loadAllSeriesRecords(prisma);
    expect(() => buildSeriesTrainingPool(allSeriesRecords, targetYear)).not.toThrow();
    const { trainingPool } = buildSeriesTrainingPool(allSeriesRecords, targetYear);
    expect(() => buildFrozenSeriesModel(trainingPool)).not.toThrow();
    const model = buildFrozenSeriesModel(trainingPool);

    // 실제 존재하는 몇몇 festivalName으로 signal을 계산해 안전성 확인(전수는 아니지만 대표 샘플).
    const sampleNames = ["부산국제록페스티벌", "밀양아리랑대축제", "청송사과축제", "완전히 새로운 미래 축제 이름"];
    for (const name of sampleNames) {
      const signal = computeSeriesSignal(name, Region.BUSAN, null, new Set([FestivalType.CULTURE_ART]), targetYear, model);
      expect(signal).toBeDefined();
      if (signal.seriesEstimatedBudgetKrw !== undefined) {
        expect(Number.isFinite(signal.seriesEstimatedBudgetKrw)).toBe(true);
        expect(signal.seriesEstimatedBudgetKrw).toBeGreaterThan(0);
      }
    }
  }, 30_000);

  it.each(FUTURE_YEARS)("planningYear=%i: leakage-safe — historicalYears가 전부 < planningYear", async (targetYear) => {
    const allSeriesRecords = await loadAllSeriesRecords(prisma);
    const { trainingPool } = buildSeriesTrainingPool(allSeriesRecords, targetYear);
    const model = buildFrozenSeriesModel(trainingPool);
    const signal = computeSeriesSignal("부산국제록페스티벌", Region.BUSAN, null, new Set([FestivalType.CULTURE_ART]), targetYear, model);
    if (signal.historicalYears) {
      expect(signal.historicalYears.every((y) => y < targetYear)).toBe(true);
      // 현재 보유 데이터가 2026까지이므로, 미래 targetYear라도 실제로 쓰이는 연도는 항상 <=2026이다.
      expect(signal.historicalYears.every((y) => y <= 2026)).toBe(true);
    }
  });
});

describe("11. Future leakage — trainingPool 자체가 미래 데이터를 생성/보간하지 않는다", () => {
  it.each(FUTURE_YEARS)("planningYear=%i: trainingPool의 모든 record가 datasetYear <= 2026(실제 최대 보유 연도)", async (targetYear) => {
    const allSeriesRecords = await loadAllSeriesRecords(prisma);
    const { trainingPool } = buildSeriesTrainingPool(allSeriesRecords, targetYear);
    const maxYear = Math.max(...trainingPool.map((r) => r.datasetYear));
    expect(maxYear).toBeLessThanOrEqual(2026);
    expect(trainingPool.every((r) => r.datasetYear < targetYear)).toBe(true);
  });
});

describe("12. G0 gap transition future test(pure function 레벨, 실제 부산국제록페스티벌)", () => {
  it("latestHistoricalYear=2026 series가 planningYear 경과에 따라 LATEST->MEDIAN으로 자연 전환된다", async () => {
    const allSeriesRecords = await loadAllSeriesRecords(prisma);
    const expected: { year: number; gap: number; source: "LATEST" | "MEDIAN" }[] = [
      { year: 2027, gap: 1, source: "LATEST" },
      { year: 2028, gap: 2, source: "LATEST" },
      { year: 2029, gap: 3, source: "MEDIAN" },
      { year: 2030, gap: 4, source: "MEDIAN" },
    ];
    for (const { year, gap, source } of expected) {
      const { trainingPool } = buildSeriesTrainingPool(allSeriesRecords, year);
      const model = buildFrozenSeriesModel(trainingPool);
      const signal = computeSeriesSignal("부산국제록페스티벌", Region.BUSAN, null, new Set([FestivalType.CULTURE_ART]), year, model);
      expect(signal.status).toBe("MATCHED");
      expect(signal.latestHistoricalYear).toBe(2026);
      expect(signal.latestHistoricalGap).toBe(gap);
      expect(signal.estimateSource).toBe(source);
    }
  });
});

describe("13. CPI future fallback — CPI_TABLE 미지원 연도에서 all-or-nothing nominal fallback(LATEST/MEDIAN 둘 다)", () => {
  it("전제 확인: CPI_TABLE에 2026 이상이 없다(2027+ planningYear는 baseYear=planningYear-1이 항상 CPI 미지원)", () => {
    expect(CPI_TABLE[2026]).toBeUndefined();
    for (const y of FUTURE_YEARS) {
      expect(CPI_TABLE[y - 1]).toBeUndefined();
    }
  });

  it("LATEST branch(gap<=2, 2027/2028) — nominal fallback으로 예외 없이 계산되고 latestComparableBudgetKrw=latestBudgetKrw(nominal)", async () => {
    const allSeriesRecords = await loadAllSeriesRecords(prisma);
    for (const targetYear of [2027, 2028]) {
      const { trainingPool } = buildSeriesTrainingPool(allSeriesRecords, targetYear);
      const model = buildFrozenSeriesModel(trainingPool);
      const target = buildSyntheticTargetRecord({
        festivalName: "부산국제록페스티벌",
        region: Region.BUSAN,
        district: null,
        typeTokens: new Set([FestivalType.CULTURE_ART]),
        planningYear: targetYear,
      });
      expect(() => computeOwnHistorySignal(target, targetYear, model)).not.toThrow();
      const ownSignal = computeOwnHistorySignal(target, targetYear, model);
      expect(ownSignal.estimateSource).toBe("LATEST");
      expect(ownSignal.latestComparableBudgetKrw).toBe(ownSignal.latestBudgetKrw); // CPI 미적용 = nominal 그대로
    }
  });

  it("MEDIAN branch(gap>=3, 2029/2030) — nominal fallback으로 예외 없이 계산되고 medianBudgetKrw=medianBudgetKrwNominal", async () => {
    const allSeriesRecords = await loadAllSeriesRecords(prisma);
    for (const targetYear of [2029, 2030]) {
      const { trainingPool } = buildSeriesTrainingPool(allSeriesRecords, targetYear);
      const model = buildFrozenSeriesModel(trainingPool);
      const target = buildSyntheticTargetRecord({
        festivalName: "부산국제록페스티벌",
        region: Region.BUSAN,
        district: null,
        typeTokens: new Set([FestivalType.CULTURE_ART]),
        planningYear: targetYear,
      });
      expect(() => computeOwnHistorySignal(target, targetYear, model)).not.toThrow();
      const ownSignal = computeOwnHistorySignal(target, targetYear, model);
      expect(ownSignal.estimateSource).toBe("MEDIAN");
      expect(ownSignal.medianBudgetKrw).toBe(ownSignal.medianBudgetKrwNominal); // CPI 미적용 = nominal 그대로
      expect(ownSignal.medianBudgetKrw).not.toBeNull();
    }
  });
});

describe("15. Reliability future safety — calibration pool 부족/threshold=null에서도 crash 없이 fallback", () => {
  it(
    "실제 미래 연도(2027/2035)는 calibration pool이 충분해 threshold가 항상 계산되고, 보유 데이터가 2026까지라 두 planningYear의 threshold가 saturate(동일)된다",
    async () => {
      const allSeriesRecords = await loadAllSeriesRecords(prisma);
      const r2027 = computeLeakageSafeVolatilityThreshold(allSeriesRecords, 2027);
      const r2035 = computeLeakageSafeVolatilityThreshold(allSeriesRecords, 2035);
      for (const result of [r2027, r2035]) {
        expect(result.usable).toBe(true);
        expect(result.threshold).not.toBeNull();
        expect(Number.isFinite(result.threshold!)).toBe(true);
      }
      // yh<planningYear 루프가 2027~2034 구간을 더 돌아도(실제 evalTarget이 없어) skip되므로,
      // 계산 결과 자체는 2027이든 2035든 동일한 calibration pool(2018~2026 real fold)로 saturate된다.
      expect(r2035.threshold).toBe(r2027.threshold);
      expect(r2035.poolN).toBe(r2027.poolN);
    },
    120_000
  );

  it("합성 데이터로 calibration pool<30(threshold=null)을 강제해도 tierFromVolatility/computePlanningReliability가 crash 없이 HIGH로 안전하게 fallback한다", () => {
    // pool이 극소(threshold=null)인 상황을 직접 구성 - 실제 production fallback 방향(HIGH 기본값)을
    // 재확인한다(tier 로직 자체는 변경하지 않는다).
    expect(tierFromVolatility(5, 0.5, null)).toBe("HIGH");
    expect(tierFromVolatility(5, null, 0.1)).toBe("HIGH");
    expect(tierFromVolatility(1, 999, null)).toBe("HIGH"); // historyCount<=1이 항상 최우선

    const records = [
      rec({ id: 1, datasetYear: 2024, festivalName: "합성단독축제", region: Region.SEOUL, typeTokens: new Set([FestivalType.CULTURE_ART]), budgetKrw: 100 }),
    ].map((r) => ({ ...r, budgetQualityFlag: "VALID" as const }));
    const { trainingPool } = buildSeriesTrainingPool(records, 2035);
    const model = buildFrozenSeriesModel(trainingPool);
    const signal = computeSeriesSignal("합성단독축제", Region.SEOUL, null, new Set([FestivalType.CULTURE_ART]), 2035, model);
    expect(() =>
      computePlanningReliability(signal, "합성단독축제", Region.SEOUL, null, new Set([FestivalType.CULTURE_ART]), 2035, model, null)
    ).not.toThrow();
    const reliability = computePlanningReliability(signal, "합성단독축제", Region.SEOUL, null, new Set([FestivalType.CULTURE_ART]), 2035, model, null);
    expect(reliability.tier).toBe("HIGH");
  });
});
