import { FestivalType, Region } from "@/lib/domain/enums";
import { computeOwnHistorySignal, SeriesEstimateSource } from "./own-history";
import { lookupTarget } from "./series-lookup";
import { buildSyntheticTargetRecord } from "./target-from-query";
import { FrozenSeriesModel, MatchMethod } from "./types";

/**
 * PHASE 9C-A — Series Shadow Integration. Planning API 응답에 additive하게 붙는 seriesSignal의
 * public 계약. `estimatedBudgetKrw`/`recommendedBudgetKrw`/P25~P75/confidence/contingency는
 * 이 모듈이 전혀 건드리지 않는다 - shadow signal일 뿐이다.
 *
 * PHASE 9C-A.1: 이 함수는 더 이상 trainingPool을 직접 만들지 않는다 - 호출부가
 * `lib/multiyear-series/runtime-cache.ts`로 이미 빌드/캐시해 둔 {@link FrozenSeriesModel}을
 * 받는다(target/festivalName과 무관한 model이라 캐시 재사용이 자연스럽다). scoring/matching
 * 판정식은 전혀 바뀌지 않았다 - model을 "누가 언제 만드는지"만 바뀌었다.
 */
export type SeriesSignalStatus = "NOT_REQUESTED" | "MATCHED" | "UNMATCHED" | "AMBIGUOUS" | "NO_VALID_HISTORY";

export interface SeriesSignalResponse {
  status: SeriesSignalStatus;
  matchMethod?: MatchMethod;
  canonicalName?: string;
  historyCount?: number;
  historicalYears?: number[];
  latestHistoricalYear?: number;
  seriesEstimatedBudgetKrw?: number;
  /** PHASE G0 — planningYear - latestHistoricalYear. MATCHED(+VALID history)일 때만 채워진다. */
  latestHistoricalGap?: number;
  /** PHASE G0 — seriesEstimatedBudgetKrw가 최근 comparable budget(LATEST, gap<=2)에서 왔는지
   *  기존 median(MEDIAN, gap>=3, 로직 무변경)에서 왔는지. MATCHED(+VALID history)일 때만 채워진다. */
  estimateSource?: SeriesEstimateSource;
}

export const SERIES_SIGNAL_NOT_REQUESTED: SeriesSignalResponse = { status: "NOT_REQUESTED" };

/**
 * @param model 이 planningYear의 leakage-safe cutoff로 이미 빌드된 {@link FrozenSeriesModel}
 *              (runtime-cache.ts의 getCachedFrozenSeriesModel 참고) - target을 전혀 포함하지 않는다.
 * @param planningYear own-history leakage rule: 이 값보다 과거(`datasetYear < planningYear`)인
 *                      record만 historical로 쓴다 - referenceDataPolicy(INCLUDE_PUBLISHED_SAME_YEAR
 *                      포함)와 무관하게 항상 이 규칙을 강제한다(model 자체가 이미 그 cutoff로
 *                      빌드돼 있고, computeOwnHistorySignal이 방어적으로 다시 한 번 확인한다).
 */
export function computeSeriesSignal(
  festivalName: string,
  region: Region,
  district: string | null,
  typeTokens: Set<FestivalType>,
  planningYear: number,
  model: FrozenSeriesModel
): SeriesSignalResponse {
  const target = buildSyntheticTargetRecord({ festivalName, region, district, typeTokens, planningYear });
  const lookup = lookupTarget(target, model);
  const signal = computeOwnHistorySignal(target, planningYear, model);

  if (lookup.ambiguous) {
    return { status: "AMBIGUOUS" };
  }
  if (signal.matchedGroupId === null) {
    return { status: "UNMATCHED" };
  }
  if (signal.seriesEstimatedBudget === null) {
    return { status: "NO_VALID_HISTORY", matchMethod: signal.targetMatchMethod, canonicalName: signal.matchedCanonicalName ?? undefined };
  }
  return {
    status: "MATCHED",
    matchMethod: signal.targetMatchMethod,
    canonicalName: signal.matchedCanonicalName ?? undefined,
    historyCount: signal.historyCount,
    historicalYears: signal.historicalYears,
    latestHistoricalYear: signal.latestHistoricalYear ?? undefined,
    seriesEstimatedBudgetKrw: signal.seriesEstimatedBudget,
    latestHistoricalGap: signal.latestHistoricalGap ?? undefined,
    estimateSource: signal.estimateSource ?? undefined,
  };
}
