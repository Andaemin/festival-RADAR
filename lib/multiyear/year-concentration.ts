import { computeMultiYearSimilarity } from "./similarity-calculator";
import { MultiYearQuery, MultiYearRecordLite } from "./types";

/**
 * 연도 쏠림(concentration) 진단용 순수 함수 - Spring MultiYearSelectorLabV4Hybrid의
 * maxYearWeightShare/bestSimilarity, MultiYearSelectorLabConcentrationAnalyzer의
 * effectiveYearCount 계산과 동일한 정의를 공유한다. candidate-selector-v1.ts(선정 로직 내부의
 * 실시간 게이트 판단)와 검증 스크립트(V0/V1 진단값 비교) 양쪽에서 재사용한다.
 */

/** 주어진 후보 집합에서, similarity²(weight) 기준으로 가장 비중 높은 연도가 전체 weight의
 *  몇 %를 차지하는지. Spring V4Hybrid.maxYearWeightShare와 동일. */
export function maxYearWeightShare(records: Iterable<MultiYearRecordLite>, query: MultiYearQuery): number {
  const weightByYear = new Map<number, number>();
  let total = 0;
  for (const r of records) {
    const similarity = computeMultiYearSimilarity(query, r).similarity;
    const weight = similarity * similarity;
    weightByYear.set(r.datasetYear, (weightByYear.get(r.datasetYear) ?? 0) + weight);
    total += weight;
  }
  if (total <= 0) return 0;
  let max = 0;
  for (const w of weightByYear.values()) max = Math.max(max, w);
  return max / total;
}

/** 주어진 후보 집합 중 query에 대한 최고 similarity. Spring V4Hybrid.bestSimilarity와 동일. */
export function bestSimilarity(records: Iterable<MultiYearRecordLite>, query: MultiYearQuery): number {
  let best = 0;
  for (const r of records) {
    best = Math.max(best, computeMultiYearSimilarity(query, r).similarity);
  }
  return best;
}

/** Simpson effective number: 1 / Σ(weightShare²). weightShare는 datasetYear별 weight 비중.
 *  Spring MultiYearSelectorLabConcentrationAnalyzer/MultiYearBacktestService.effectiveYearCount와 동일. */
export function effectiveYearCount(records: { datasetYear: number; weight: number }[]): number {
  const weightByYear = new Map<number, number>();
  let total = 0;
  for (const r of records) {
    weightByYear.set(r.datasetYear, (weightByYear.get(r.datasetYear) ?? 0) + r.weight);
    total += r.weight;
  }
  if (total <= 0) return 0;
  let sumSquaredShare = 0;
  for (const w of weightByYear.values()) {
    const share = w / total;
    sumSquaredShare += share * share;
  }
  return sumSquaredShare > 0 ? 1 / sumSquaredShare : 0;
}

/** 최신(가장 큰 datasetYear) 연도의 weight 비중. */
export function latestYearWeightShare(records: { datasetYear: number; weight: number }[]): number {
  const weightByYear = new Map<number, number>();
  let total = 0;
  for (const r of records) {
    weightByYear.set(r.datasetYear, (weightByYear.get(r.datasetYear) ?? 0) + r.weight);
    total += r.weight;
  }
  if (total <= 0 || weightByYear.size === 0) return 0;
  const latestYear = Math.max(...weightByYear.keys());
  return (weightByYear.get(latestYear) ?? 0) / total;
}
