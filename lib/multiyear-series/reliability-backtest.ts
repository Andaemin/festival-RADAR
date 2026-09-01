import { quantile } from "@/lib/utils/weighted-statistics";
import { applySeriesPlanningSemantics } from "./apply-planning-semantics";
import { buildSeriesEvalTargets, buildSeriesTrainingPool } from "./fold";
import { SeriesEstimateSource } from "./own-history";
import { SeriesRecordWithQuality } from "./record-loader";
import {
  computeCpiAdjustedVolatility,
  computeLeakageSafeVolatilityThreshold,
  computePlanningReliability,
  PlanningReliabilityTier,
} from "./reliability";
import { buildFrozenSeriesModel } from "./series-linker";
import { lookupTarget } from "./series-lookup";
import { computeSeriesSignal } from "./series-signal";
import { buildSyntheticTargetRecord } from "./target-from-query";

/**
 * PHASE — G0 이후 Reliability Revalidation. READ-ONLY DIAGNOSTIC이다 - reliability tier
 * 판정식/threshold(reliability.ts)를 단 한 줄도 재정의하지 않고, 실제 production 함수
 * (`computeSeriesSignal`/`applySeriesPlanningSemantics`/`computePlanningReliability`/
 * `computeCpiAdjustedVolatility`/`computeLeakageSafeVolatilityThreshold`)를 leakage-safe
 * backtest(2024/2025/2026 fold, `lib/multiyear-series/fold.ts`와 동일 fold 정의)에 그대로
 * 적용해 "이 tier가 실제로 얼마나 다른 결과를 냈는가"만 사후에 집계한다.
 *
 * 이 모듈은 production serving 경로(route.ts)에서 호출되지 않는다 - `/assistant-tester` 전용
 * read-only 진단 endpoint에서만 쓰인다(계산 비용이 커서 매 estimate 요청마다 부르면 안 된다).
 */

export const RELIABILITY_BACKTEST_FOLD_YEARS = [2024, 2025, 2026] as const;

export type ReliabilityTierLabel = "HIGH" | "MEDIUM";

export interface ReliabilityBacktestTierSummary {
  tier: ReliabilityTierLabel;
  n: number;
  estimateMdApe: number | null;
  estimateP90Ape: number | null;
  estimateP95Ape: number | null;
  recommendationMdApe: number | null;
  /** log(P75/P25) of CPI-adjusted historical budgets - historyCount<2인 대상(volatility 정의
   *  불가)은 이 median 계산에서 제외된다(별도로 singleHistoryCount에 그 수를 표시). */
  historicalDispersionMedian: number | null;
  singleHistoryCount: number;
  multiHistoryCount: number;
  estimateSourceLatestCount: number;
  estimateSourceMedianCount: number;
  estimateSourceLatestMdApe: number | null;
  estimateSourceMedianMdApe: number | null;
}

export interface ReliabilityBacktestSummary {
  foldYears: number[];
  seriesN: number;
  tiers: ReliabilityBacktestTierSummary[];
}

interface BacktestRow {
  tier: PlanningReliabilityTier;
  historyCount: number;
  volatility: number | null;
  estimateSource: SeriesEstimateSource;
  estimated: number;
  recommended: number;
  actual: number;
}

function ape(estimate: number, actual: number): number | null {
  if (actual <= 0) return null;
  const v = Math.abs(estimate - actual) / actual;
  return Number.isFinite(v) ? v : null;
}

function apeStats(rows: BacktestRow[], valueOf: (r: BacktestRow) => number) {
  const apes = rows.map((r) => ape(valueOf(r), r.actual)).filter((v): v is number => v !== null);
  if (apes.length === 0) return { mdApe: null, p90Ape: null, p95Ape: null };
  return { mdApe: quantile(apes, 0.5), p90Ape: quantile(apes, 0.9), p95Ape: quantile(apes, 0.95) };
}

/**
 * `allSeriesRecords`(이미 로드된 전체 series-linked record 스냅샷)만으로 계산 가능한 순수 함수.
 * DB 쿼리를 직접 하지 않는다(호출부가 `getCachedSeriesRecords` 등으로 이미 로드한 결과를 넘긴다).
 * 비용이 크다(fold 3개 × 각 fold의 threshold 재계산 + eval target 순회) - 호출부가 캐싱해야 한다.
 */
export function computeReliabilityBacktestSummary(allSeriesRecords: SeriesRecordWithQuality[]): ReliabilityBacktestSummary {
  const rows: BacktestRow[] = [];

  for (const targetYear of RELIABILITY_BACKTEST_FOLD_YEARS) {
    const { trainingPool } = buildSeriesTrainingPool(allSeriesRecords, targetYear);
    const evalTargets = buildSeriesEvalTargets(allSeriesRecords, targetYear);
    const model = buildFrozenSeriesModel(trainingPool);
    const thresholdResult = computeLeakageSafeVolatilityThreshold(allSeriesRecords, targetYear);

    for (const target of evalTargets) {
      if (target.region === null) continue;
      const signal = computeSeriesSignal(target.festivalName, target.region, target.district, target.typeTokens, targetYear, model);
      const seriesApplied = signal.status === "MATCHED" && signal.seriesEstimatedBudgetKrw !== undefined;
      if (!seriesApplied) continue;

      const applied = applySeriesPlanningSemantics({ estimatedBudgetKrw: 0, recommendedBudgetKrw: 0, p60Krw: 0 }, signal);
      const reliability = computePlanningReliability(
        signal,
        target.festivalName,
        target.region,
        target.district,
        target.typeTokens,
        targetYear,
        model,
        thresholdResult.threshold
      );

      const syntheticTarget = buildSyntheticTargetRecord({
        festivalName: target.festivalName,
        region: target.region,
        district: target.district,
        typeTokens: target.typeTokens,
        planningYear: targetYear,
      });
      const lookup = lookupTarget(syntheticTarget, model);
      const historical =
        lookup.matchedGroupId !== null
          ? model.groupsById.get(lookup.matchedGroupId)!.members.filter((m) => m.datasetYear < targetYear)
          : [];
      const volatility = computeCpiAdjustedVolatility(historical, targetYear);

      rows.push({
        tier: reliability.tier,
        historyCount: signal.historyCount!,
        volatility,
        estimateSource: signal.estimateSource!,
        estimated: applied.estimatedBudgetKrw,
        recommended: applied.recommendedBudgetKrw,
        actual: target.budgetKrw,
      });
    }
  }

  function summarizeTier(tier: ReliabilityTierLabel): ReliabilityBacktestTierSummary {
    const tRows = rows.filter((r) => r.tier === tier);
    const estStats = apeStats(tRows, (r) => r.estimated);
    const recStats = apeStats(tRows, (r) => r.recommended);
    const vols = tRows.map((r) => r.volatility).filter((v): v is number => v !== null);
    const latestRows = tRows.filter((r) => r.estimateSource === "LATEST");
    const medianRows = tRows.filter((r) => r.estimateSource === "MEDIAN");
    return {
      tier,
      n: tRows.length,
      estimateMdApe: estStats.mdApe,
      estimateP90Ape: estStats.p90Ape,
      estimateP95Ape: estStats.p95Ape,
      recommendationMdApe: recStats.mdApe,
      historicalDispersionMedian: vols.length > 0 ? quantile(vols, 0.5) : null,
      singleHistoryCount: tRows.filter((r) => r.historyCount <= 1).length,
      multiHistoryCount: tRows.filter((r) => r.historyCount >= 2).length,
      estimateSourceLatestCount: latestRows.length,
      estimateSourceMedianCount: medianRows.length,
      estimateSourceLatestMdApe: apeStats(latestRows, (r) => r.estimated).mdApe,
      estimateSourceMedianMdApe: apeStats(medianRows, (r) => r.estimated).mdApe,
    };
  }

  return {
    foldYears: [...RELIABILITY_BACKTEST_FOLD_YEARS],
    seriesN: rows.length,
    tiers: [summarizeTier("HIGH"), summarizeTier("MEDIUM")],
  };
}
