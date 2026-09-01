import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { loadAllSeriesRecords } from "@/lib/multiyear-series/record-loader";
import {
  computeReliabilityBacktestSummary,
  RELIABILITY_BACKTEST_FOLD_YEARS,
  ReliabilityBacktestSummary,
} from "@/lib/multiyear-series/reliability-backtest";

/**
 * G0 이후 Reliability Revalidation — READ-ONLY DIAGNOSTIC 모듈 골든 테스트. 실제 DB(2017~2026)를
 * 읽기 전용으로 사용한다. 이 모듈은 새 판정식을 만들지 않으므로, 여기서 확인하는 것은 "production
 * 함수(computeSeriesSignal/applySeriesPlanningSemantics/computePlanningReliability)를 leakage-safe
 * backtest에 그대로 적용했을 때 나오는 실제 분포"다 - baseline parity(spec 1절) 재현이 핵심이다.
 *
 * 계산 비용이 크므로(fold 3개 × 각 fold 재평가) beforeAll에서 딱 한 번만 계산해 모든 it()이 공유한다.
 */
describe("computeReliabilityBacktestSummary - baseline parity(spec 1절)", () => {
  let summary: ReliabilityBacktestSummary;

  beforeAll(async () => {
    const allSeriesRecords = await loadAllSeriesRecords(prisma);
    summary = computeReliabilityBacktestSummary(allSeriesRecords);
  }, 120_000);

  it("Series n≈2242, HIGH/MEDIUM 분포, Estimate MdAPE가 알려진 production benchmark와 일치한다", () => {
    expect(summary.foldYears).toEqual([...RELIABILITY_BACKTEST_FOLD_YEARS]);
    expect(summary.seriesN).toBe(2242);

    const high = summary.tiers.find((t) => t.tier === "HIGH")!;
    const medium = summary.tiers.find((t) => t.tier === "MEDIUM")!;
    expect(high.n).toBe(1200);
    expect(medium.n).toBe(1042);
    expect(high.n + medium.n).toBe(summary.seriesN);

    // G0 production benchmark(연구 문서 재현값)와 parity - 소수점 오차만 허용.
    expect(high.estimateMdApe).toBeCloseTo(0.0928, 3);
    expect(medium.estimateMdApe).toBeCloseTo(0.1, 3);
  });

  it("historical dispersion(volatility) median이 HIGH < MEDIUM으로 뚜렷하게 분리된다(정확도보다 훨씬 큰 차이)", () => {
    const high = summary.tiers.find((t) => t.tier === "HIGH")!;
    const medium = summary.tiers.find((t) => t.tier === "MEDIUM")!;

    expect(high.historicalDispersionMedian).not.toBeNull();
    expect(medium.historicalDispersionMedian).not.toBeNull();
    expect(medium.historicalDispersionMedian!).toBeGreaterThan(high.historicalDispersionMedian! * 3);
  });

  it("HIGH는 SINGLE_HISTORY와 MULTI_HISTORY의 혼합이고 MEDIUM은 항상 historyCount>=2다", () => {
    const high = summary.tiers.find((t) => t.tier === "HIGH")!;
    const medium = summary.tiers.find((t) => t.tier === "MEDIUM")!;

    expect(high.singleHistoryCount).toBeGreaterThan(0);
    expect(high.singleHistoryCount + high.multiHistoryCount).toBe(high.n);
    expect(medium.singleHistoryCount).toBe(0);
  });

  it("estimateSource(LATEST/MEDIAN)별 MdAPE 차이가 tier 차이보다 훨씬 크다(LATEST branch가 정확도 개선의 주 원인)", () => {
    for (const t of summary.tiers) {
      expect(t.estimateSourceLatestMdApe).not.toBeNull();
      expect(t.estimateSourceMedianMdApe).not.toBeNull();
      // LATEST가 MEDIAN보다 명확히 더 정확하다(두 tier 모두에서 일관되게).
      expect(t.estimateSourceLatestMdApe!).toBeLessThan(t.estimateSourceMedianMdApe!);
    }
  });

  it("빈 records - n=0, MdAPE 전부 null(예외 없이 안전하게 처리)", () => {
    const empty = computeReliabilityBacktestSummary([]);
    expect(empty.seriesN).toBe(0);
    for (const t of empty.tiers) {
      expect(t.n).toBe(0);
      expect(t.estimateMdApe).toBeNull();
      expect(t.historicalDispersionMedian).toBeNull();
    }
  });
});
