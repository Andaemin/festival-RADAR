import { quantile } from "@/lib/utils/weighted-statistics";
import { tryAdjustForCpi } from "./cpi";
import { lookupTarget } from "./series-lookup";
import { FrozenSeriesModel, MatchMethod, SeriesRecordLite } from "./types";

/**
 * PHASE 9B-2 — Own-history signal primitives. matched historical series의 과거 예산으로
 * latestBudget/medianBudget/geometricMeanBudget 등을 계산하는 layer다.
 *
 * PHASE 9C-C부터 `computeSeriesSignal`(lib/multiyear-series/series-signal.ts)을 거쳐 실제
 * public Planning API 응답(estimatedBudgetKrw 등)에 연결되어 있다 - 더 이상 진단 전용이 아니다.
 * Phase 9A-Safety 결론에 따라 production candidate 값은
 * `seriesEstimatedBudget = median(valid historical planned budgets)`으로 고정한다 - 단
 * latestBudget(SER1)도 함께 계산해 둔다(제거하지 않음, diagnostics/history-count reliability
 * 연구용). PHASE 16-C부터 이 median은 CPI-adjusted다(Phase 16-B C2 확정 semantics) - 아래
 * `medianBudgetKrw`/`medianBudgetKrwNominal` 필드 설명 참고.
 *
 * actual-budget bucket에 따른 adaptive routing(예: actual>=1B -> median, <1B -> blend)은
 * 절대 하지 않는다 - inference 시점에는 actualBudget을 알 수 없어 그런 라우팅 자체가 성립하지
 * 않는다(Phase 9A-Safety 결론).
 */
export interface OwnHistorySignal {
  targetRecordId: number;
  targetMatchMethod: MatchMethod;
  ambiguous: boolean;
  matchedGroupId: number | null;
  matchedCanonicalName: string | null;

  historyCount: number;
  historicalYears: number[];
  latestHistoricalYear: number | null;

  /** SER1(raw) - production에 적용하지 않는다. diagnostics/history-count reliability 연구용으로만 유지. */
  latestBudgetKrw: number | null;
  /**
   * production candidate 값(Phase 9A-Safety 결론: median이 large-under 개선을 상당 부분 유지하면서
   * catastrophic tail을 가장 안정적으로 억제함). PHASE 16-C부터 이 값은 CPI-adjusted median이다
   * (Phase 16-B에서 leakage-safe 검증 완료된 C2 semantics - Series에만 CPI 적용, Peer는 미적용).
   * CPI_TABLE에 없는 연도가 관련되면(예: planningYear>=2027) {@link medianBudgetKrwNominal}과
   * 동일한 값으로 자동 fallback한다(임의 추정 금지, cpi.ts 참고).
   */
  medianBudgetKrw: number | null;
  /** PHASE 16-C — CPI 보정 전 nominal median(과거 값 그대로). medianBudgetKrw와 분리해서 보존한다
   *  (진단/비교/CPI-unavailable fallback 대상 - production estimatedBudget 계산에는 쓰이지 않는다). */
  medianBudgetKrwNominal: number | null;
  geometricMeanBudgetKrw: number | null;

  /**
   * PHASE 9C-B — range semantics 실험용(진단 전용, 어떤 confidence/recommendation 공식에도
   * 아직 연결하지 않는다). historical VALID budget들의 비가중 P25/P75(quantile 선형보간, peer의
   * weightedQuantile과는 다른 - series는 후보 weighting 개념이 없다). historyCount=1이면
   * P25=P50=P75=그 값 하나가 되므로 "신뢰 가능한 interval"로 취급하면 안 된다 - 호출부가
   * historyCount로 직접 걸러야 한다(이 함수는 강제로 null 처리하지 않는다 - 값 자체는 정확하다).
   */
  seriesP25Krw: number | null;
  seriesP75Krw: number | null;
  /** historical VALID budget 원본 배열(오름차순 정렬) - range/spread 진단용. */
  historicalBudgetsKrw: number[];

  /** = medianBudgetKrw. Series 없거나 ambiguous이거나 VALID history가 없으면 null. */
  seriesEstimatedBudget: number | null;
}

function nullSignal(target: SeriesRecordLite, matchMethod: MatchMethod, ambiguous: boolean): OwnHistorySignal {
  return {
    targetRecordId: target.id,
    targetMatchMethod: matchMethod,
    ambiguous,
    matchedGroupId: null,
    matchedCanonicalName: null,
    historyCount: 0,
    historicalYears: [],
    latestHistoricalYear: null,
    latestBudgetKrw: null,
    medianBudgetKrw: null,
    medianBudgetKrwNominal: null,
    geometricMeanBudgetKrw: null,
    seriesP25Krw: null,
    seriesP75Krw: null,
    historicalBudgetsKrw: [],
    seriesEstimatedBudget: null,
  };
}

/**
 * @param targetYear leakage rule: `datasetYear < targetYear`인 group member만 historical로
 *                    쓴다 - planningYear Y에 대해 참조 연도는 반드시 target보다 과거여야 한다.
 *                    group은 이미 그 fold의 training pool(=datasetYear<targetYear로 구성됨)만
 *                    으로 만들어졌으므로 이 필터는 방어적 재확인이다(leakage 방지 이중 체크).
 */
export function computeOwnHistorySignal(target: SeriesRecordLite, targetYear: number, model: FrozenSeriesModel): OwnHistorySignal {
  const lookup = lookupTarget(target, model);

  if (lookup.matchedGroupId === null) {
    // series 없음(UNMATCHED) 또는 ambiguous - signal=null.
    return nullSignal(target, lookup.matchMethod, lookup.ambiguous);
  }

  const group = model.groupsById.get(lookup.matchedGroupId)!;
  const historical = group.members
    .filter((m) => m.datasetYear < targetYear)
    .sort((a, b) => (a.datasetYear !== b.datasetYear ? a.datasetYear - b.datasetYear : a.id - b.id));

  if (historical.length === 0) {
    // VALID history가 없음(그룹은 매칭됐지만 target보다 과거인 member가 없는 경우) - signal=null.
    const base = nullSignal(target, lookup.matchMethod, lookup.ambiguous);
    return { ...base, matchedGroupId: group.groupId, matchedCanonicalName: group.canonicalName };
  }

  const latestYear = Math.max(...historical.map((h) => h.datasetYear));
  const latestYearRecords = historical.filter((h) => h.datasetYear === latestYear).sort((a, b) => a.id - b.id);
  // 동일 latest year에 record가 2개 이상(비정상 케이스)이면 임의 선택하지 않고 id가 가장 작은
  // 쪽을 결정적으로 고른다(Phase 9A와 동일 tie-break).
  const latestRecord = latestYearRecords[0];

  const budgets = historical.map((h) => h.budgetKrw);
  const sortedBudgets = [...budgets].sort((a, b) => a - b);
  const medianBudgetKrwNominal = Math.round(quantile(budgets, 0.5));
  const geometricMeanBudgetKrw = Math.round(Math.exp(budgets.reduce((s, b) => s + Math.log(b), 0) / budgets.length));
  const seriesP25Krw = Math.round(quantile(budgets, 0.25));
  const seriesP75Krw = Math.round(quantile(budgets, 0.75));

  // PHASE 16-C — Series CPI production 반영(Phase 16-B C2 확정: Series에만 CPI 적용, Peer는
  // 미적용). historical budget 각각을 targetYear-1 가격 수준으로 환산한 뒤 median을 계산해
  // production estimatedBudget에 쓴다. historyCount/matchMethod/historicalYears/latestBudgetKrw
  // 등 identity·diagnostics 필드는 전혀 건드리지 않는다 - 오직 median(=seriesEstimatedBudget)만
  // 바뀐다. CPI_TABLE에 없는 연도가 하나라도 관련되면(예: targetYear>=2027) 전부 nominal로
  // fallback한다(가장 가까운 연도를 대신 쓰거나 추정하지 않는다 - cpi.ts 참고).
  const adjustedBudgets = historical.map((h) => tryAdjustForCpi(h.budgetKrw, h.datasetYear, targetYear));
  const cpiFullyAvailable = adjustedBudgets.every((v): v is number => v !== null);
  const medianBudgetKrw = cpiFullyAvailable ? Math.round(quantile(adjustedBudgets as number[], 0.5)) : medianBudgetKrwNominal;

  return {
    targetRecordId: target.id,
    targetMatchMethod: lookup.matchMethod,
    ambiguous: lookup.ambiguous,
    matchedGroupId: group.groupId,
    matchedCanonicalName: group.canonicalName,
    historyCount: historical.length,
    historicalYears: [...new Set(historical.map((h) => h.datasetYear))].sort((a, b) => a - b),
    latestHistoricalYear: latestYear,
    latestBudgetKrw: latestRecord.budgetKrw,
    medianBudgetKrw,
    medianBudgetKrwNominal,
    geometricMeanBudgetKrw,
    seriesP25Krw,
    seriesP75Krw,
    historicalBudgetsKrw: sortedBudgets,
    seriesEstimatedBudget: medianBudgetKrw,
  };
}
