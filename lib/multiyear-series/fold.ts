import { SeriesRecordWithQuality } from "./record-loader";
import { SeriesRecordLite } from "./types";

/** Spring MultiYearBacktestFold와 동일한 fold 정의: Primary 2025/2026 + Secondary 2024. */
export const SERIES_FOLD_TARGET_YEARS = [2024, 2025, 2026] as const;

export interface SeriesTrainingPoolResult {
  trainingPool: SeriesRecordLite[];
  excludedLowQuality: number;
  excludedMissingFeature: number;
}

/**
 * leakage-safe training pool 구성 - 기존 `lib/multiyear/baseline-estimator.ts`의
 * `buildTrainingPool`과 완전히 같은 기준(datasetYear < targetYear, budgetQualityFlag===VALID,
 * region/typeTokens 존재)이다. 타입이 `SeriesRecordWithQuality`라 별도 함수로 둔다 - 로직 자체는
 * baseline과 동일해야 두 경로의 trainingPool이 정확히 같아진다(Spring이 series 실험에서 baseline
 * backtest와 같은 datasetBuilder를 재사용한 것과 동일한 설계).
 */
export function buildSeriesTrainingPool(records: SeriesRecordWithQuality[], targetYear: number): SeriesTrainingPoolResult {
  const trainingPool: SeriesRecordLite[] = [];
  let excludedLowQuality = 0;
  let excludedMissingFeature = 0;

  for (const r of records) {
    if (r.datasetYear >= targetYear) continue; // leakage-safe cutoff

    const lowQuality = r.budgetQualityFlag !== "VALID";
    const missingFeature = r.region === null || r.typeTokens.size === 0;

    if (lowQuality) {
      excludedLowQuality++;
    } else if (missingFeature) {
      excludedMissingFeature++;
    } else {
      trainingPool.push(r);
    }
  }

  return { trainingPool, excludedLowQuality, excludedMissingFeature };
}

/** target(evalTarget) 목록 - datasetYear === targetYear, 동일한 품질/feature 기준. */
export function buildSeriesEvalTargets(records: SeriesRecordWithQuality[], targetYear: number): SeriesRecordLite[] {
  return records.filter((r) => {
    if (r.datasetYear !== targetYear) return false;
    if (r.budgetQualityFlag !== "VALID") return false;
    if (r.region === null || r.typeTokens.size === 0) return false;
    return true;
  });
}
