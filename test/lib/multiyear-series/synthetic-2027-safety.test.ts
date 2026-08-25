import { describe, expect, it } from "vitest";
import { FestivalType, Region } from "@/lib/domain/enums";
import { applySeriesPlanningSemantics, SERIES_PLANNING_BUFFER_RATE } from "@/lib/multiyear-series/apply-planning-semantics";
import { CPI_TABLE } from "@/lib/multiyear-series/cpi";
import { computeLeakageSafeVolatilityThreshold, computePlanningReliability } from "@/lib/multiyear-series/reliability";
import { SeriesRecordWithQuality } from "@/lib/multiyear-series/record-loader";
import { buildFrozenSeriesModel } from "@/lib/multiyear-series/series-linker";
import { computeSeriesSignal } from "@/lib/multiyear-series/series-signal";
import { rec } from "./helpers";

/**
 * PHASE 19-B Part 6 — "2027 synthetic safety test". 실제 2027 target 데이터는 존재하지 않으므로
 * (보유 데이터는 2017~2026) 정확도 검증(empirical validation)은 애초에 불가능하다 - 이 파일은
 * 정확도를 절대 주장하지 않는다. 대신 planningYear=2027(CPI_TABLE[2026] 없음) 상황에서
 * production 파이프라인 전체(estimate CPI fallback -> reliability -> threshold rule)가:
 *   1) nominal fallback으로 정상 동작하고
 *   2) 예외 없이 완주하며
 *   3) 미래 데이터를 전혀 참조하지 않는지(같은 planningYear에 대해 <2027 데이터가 그대로면 결과가
 *      바뀌지 않는지)
 * 만 확인하는 순수 안전성(safety) 회귀다.
 */
describe("2027 synthetic safety - CPI[2026] 부재 상황에서 전체 파이프라인이 안전하게 동작한다", () => {
  const REGION = Region.SEOUL;
  const TYPES = new Set([FestivalType.CULTURE_ART]);

  function buildRecords(): SeriesRecordWithQuality[] {
    return [
      rec({ id: 1, datasetYear: 2024, festivalName: "가나다축제", region: REGION, typeTokens: TYPES, budgetKrw: 100_000_000 }),
      rec({ id: 2, datasetYear: 2025, festivalName: "제2회 가나다축제", region: REGION, typeTokens: TYPES, budgetKrw: 120_000_000 }),
      rec({ id: 3, datasetYear: 2026, festivalName: "제3회 가나다축제", region: REGION, typeTokens: TYPES, budgetKrw: 150_000_000 }),
    ].map((r) => ({ ...r, budgetQualityFlag: "VALID" as const }));
  }

  it("전제 확인: baseYear(2026)가 CPI_TABLE에 없다", () => {
    expect(CPI_TABLE[2026]).toBeUndefined();
    expect(CPI_TABLE[2025]).toBeDefined(); // 2026 planningYear(baseYear=2025)까지는 정상 커버.
  });

  it("estimate: nominal fallback으로 예외 없이 seriesEstimatedBudgetKrw가 계산된다", () => {
    const records = buildRecords();
    const trainingPool = records; // planningYear=2027 기준 전부 과거(<2027)라 그대로 training pool.
    const model = buildFrozenSeriesModel(trainingPool);

    expect(() => computeSeriesSignal("제4회 가나다축제", REGION, null, TYPES, 2027, model)).not.toThrow();

    const signal = computeSeriesSignal("제4회 가나다축제", REGION, null, TYPES, 2027, model);
    expect(signal.status).toBe("MATCHED");
    expect(signal.seriesEstimatedBudgetKrw).toBeDefined();
    // nominal fallback: CPI 미적용이므로 [100M,120M,150M]의 median=120M 그대로.
    expect(signal.seriesEstimatedBudgetKrw).toBe(120_000_000);
  });

  it("recommendation: CPI 미적용 여부와 무관하게 고정 +5% buffer가 예외 없이 적용된다", () => {
    const records = buildRecords();
    const model = buildFrozenSeriesModel(records);
    const signal = computeSeriesSignal("제4회 가나다축제", REGION, null, TYPES, 2027, model);

    const applied = applySeriesPlanningSemantics({ estimatedBudgetKrw: 0, recommendedBudgetKrw: 0, p60Krw: 0 }, signal);
    expect(applied.recommendedBudgetKrw).toBe(Math.round(signal.seriesEstimatedBudgetKrw! * (1 + SERIES_PLANNING_BUFFER_RATE)));
  });

  it("threshold rule: planningYear=2027이어도 예외 없이 계산되고, <2027 데이터만 쓴다(미래 데이터 미참조)", () => {
    const records = buildRecords(); // 최대 datasetYear=2026
    expect(() => computeLeakageSafeVolatilityThreshold(records, 2027)).not.toThrow();

    const withoutFuture = computeLeakageSafeVolatilityThreshold(records, 2027);
    const withSyntheticFuture: SeriesRecordWithQuality[] = [
      ...records,
      { ...rec({ id: 99, datasetYear: 2027, festivalName: "완전다른미래축제", region: REGION, typeTokens: TYPES, budgetKrw: 999_000_000 }), budgetQualityFlag: "VALID" as const },
    ];
    const withFuture = computeLeakageSafeVolatilityThreshold(withSyntheticFuture, 2027);

    // 2027 planningYear 기준으로 2027년 레코드 자체는 절대 pool에 들어가면 안 된다(yh<2027 루프).
    expect(withFuture).toEqual(withoutFuture);
  });

  it("reliability: planningYear=2027 전체 파이프라인(estimate CPI fallback -> signal -> threshold -> reliability)이 예외 없이 완주하고 유효한 tier를 반환한다", () => {
    const records = buildRecords();
    const model = buildFrozenSeriesModel(records);
    const signal = computeSeriesSignal("제4회 가나다축제", REGION, null, TYPES, 2027, model);
    const thresholdResult = computeLeakageSafeVolatilityThreshold(records, 2027);

    expect(() =>
      computePlanningReliability(signal, "제4회 가나다축제", REGION, null, TYPES, 2027, model, thresholdResult.threshold)
    ).not.toThrow();

    const reliability = computePlanningReliability(signal, "제4회 가나다축제", REGION, null, TYPES, 2027, model, thresholdResult.threshold);
    expect(["HIGH", "MEDIUM", "LOW"]).toContain(reliability.tier);
    expect(reliability.reasonText.length).toBeGreaterThan(0);
    // 이 target은 seriesApplied이므로(위 estimate 테스트에서 MATCHED 확인) LOW(PEER_FALLBACK)일 수 없다.
    expect(reliability.tier).not.toBe("LOW");
  });

  it("UNMATCHED(series 없음) 상황에서도 planningYear=2027에서 예외 없이 항상 LOW를 반환한다", () => {
    const records = buildRecords();
    const model = buildFrozenSeriesModel(records);
    const signal = computeSeriesSignal("완전히 다른 이름의 축제", REGION, null, TYPES, 2027, model);
    expect(signal.status).toBe("UNMATCHED");

    const thresholdResult = computeLeakageSafeVolatilityThreshold(records, 2027);
    const reliability = computePlanningReliability(signal, "완전히 다른 이름의 축제", REGION, null, TYPES, 2027, model, thresholdResult.threshold);
    expect(reliability.tier).toBe("LOW");
  });
});
