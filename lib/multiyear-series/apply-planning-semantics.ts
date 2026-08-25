import { SeriesSignalResponse } from "./series-signal";

/**
 * PHASE 9C-C — Series-aware Planning API Integration. Phase 9C-B에서 확정한 semantics를 순수
 * 함수로 배선한다: 새 알고리즘/threshold/weight를 만들지 않고, 이미 계산된 peer 결과와
 * seriesSignal 두 값만 받아서 "어느 쪽을 최종 estimate/recommendation으로 쓸지"만 결정한다.
 *
 * <p><b>estimatedBudgetKrw</b>: series MATCHED(+VALID history)면 `seriesSignal.seriesEstimatedBudgetKrw`
 * (=historical VALID budgets median), 아니면 기존 peer `estimatedBudgetKrw` 그대로.</p>
 *
 * <p><b>recommendedBudgetKrw(PHASE 19-A 갱신)</b>: series MATCHED면
 * `seriesEstimatedBudgetKrw * (1 + SERIES_PLANNING_BUFFER_RATE)` - Phase 18에서 legacy
 * confidence가 individual risk를 설명하지 못한다는 결론과, Phase 18-B에서 검증한 "고정 +5%
 * buffer가 HIGH/MEDIUM 두 reliability tier 모두에서 기존 confidence-derived contingency와
 * 동등하거나 우월하다"는 결과에 따라, peer 결과를 전혀 읽지 않는 고정 buffer로 대체했다(이전:
 * peer의 `recommendedBudgetKrw`/`estimatedBudgetKrw`/`p60Krw`에서 역산한 existingContingency -
 * Phase 18-B 이후로는 peer도 자체 contingency가 없어 이 역산이 항상 0이 되므로 애초에 무의미해졌다).
 * `PeerPlanningEstimate.recommendedBudgetKrw`/`p60Krw`는 PEER_FALLBACK 분기의 단순 pass-through를
 * 위해 인터페이스에는 남겨두지만 SERIES 분기 계산에는 더 이상 쓰이지 않는다. KRW 반올림은 기존과
 * 동일하게 `Math.round`를 그대로 쓴다.</p>
 *
 * <p><b>P25/P50/P60/P75/weightedAverage/sampleCount/dataQualityV3 등 peer evidence/statistics는
 * 이 함수가 절대 건드리지 않는다</b> - 호출부가 원래 peer 결과 객체를 그대로 응답에 쓰고, 이
 * 함수는 estimatedBudgetKrw/recommendedBudgetKrw 두 필드와 additive basis metadata만 돌려준다
 * (Phase 9C-B 4절 range coverage 실험 결론: series P25~P75는 peer보다 좁고 실제 값을 덜
 * 포함하므로 public range로 채택하지 않는다).</p>
 */

/**
 * PHASE 19-B Part 4 감사 결과 - "SERIES_HISTORY_MEDIAN"은 그대로 유지한다. Phase 16-C부터
 * CPI-adjusted median이 됐지만(own-history.ts) 이 literal 자체는 "CPI 적용 여부"를 주장하지
 * 않으므로("nominal"이라고도 안 했다) 여전히 사실과 어긋나지 않는다 - 그리고 이 값은
 * `app/assistant-tester/page.tsx`(resolveSeriesDisplayState)가 실제로 gate 조건에 쓰는 literal이라
 * 이번 Phase의 "UI 수정 금지" 제약상 임의로 바꿀 수 없다. CPI 적용 여부는 코드 주석/reliability
 * reason 문구로 설명한다.
 */
export type EstimateBasis = "PEER_SIMILARITY" | "SERIES_HISTORY_MEDIAN";
/**
 * PHASE 19-B Part 3 감사 - SERIES 쪽 literal을 `SERIES_HISTORY_WITH_CONTINGENCY`에서
 * `SERIES_HISTORY_WITH_FIXED_BUFFER`로 갱신했다(Phase 19-A부터 더 이상 contingency가 아니라
 * 고정 +5% buffer이므로 - 아래 함수 구현 참고). `PEER_PLANNING`은 애초에 "peer 기반 planning
 * 값"이라는 뜻만 담고 있고 특정 공식(contingency 유무)을 주장하지 않으므로 `max(estimated,P60)`
 * semantics와 어긋나지 않는다 - 그대로 유지한다.
 */
export type RecommendationBasis = "PEER_PLANNING" | "SERIES_HISTORY_WITH_FIXED_BUFFER";
/**
 * PHASE 19-B Part 4 감사 - "PEER_EMPIRICAL"이라는 literal 자체가 이미 "이 range는 Series
 * uncertainty interval이 아니라 유사 축제(Peer) 실측 분포"임을 정확히 표현하고 있어 그대로
 * 유지한다(Series P25/P75는 애초에 public range로 채택된 적이 없다 - Phase 9C-B 결론).
 */
export type RangeBasis = "PEER_EMPIRICAL_P25_P75";
/** PHASE 19-B Part 4 감사 - dataQualityV3는 Series 여부와 무관하게 항상 peer sample 기반이므로
 *  "PEER_SAMPLE" 그대로 유지한다. */
export type DataQualityBasis = "PEER_SAMPLE";

/**
 * PHASE 19-A — Phase 18-B Part 4에서 검증된 SERIES_APPLIED 고정 planning buffer. 모든
 * SERIES_APPLIED 대상에 예외 없이 동일하게 적용한다 - reliability tier(HIGH/MEDIUM)나 legacy
 * confidence/dataQualityV3에 따라 값이 달라지지 않는다(Phase 18-B Part 3: tier별 buffer
 * 재최적화는 하지 않기로 확정).
 */
export const SERIES_PLANNING_BUFFER_RATE = 0.05;

/** applySeriesPlanningSemantics 입력 - 기존 Planning V1(estimateForPlanning) 결과 중 이 계산에 필요한 필드만.
 *  `recommendedBudgetKrw`/`p60Krw`는 PEER_FALLBACK pass-through용으로만 쓰인다(PHASE 19-A부터
 *  SERIES 분기는 이 두 필드를 읽지 않는다 - 아래 함수 구현 참고). */
export interface PeerPlanningEstimate {
  estimatedBudgetKrw: number;
  recommendedBudgetKrw: number;
  p60Krw: number;
}

export interface SeriesPlanningSemantics {
  estimatedBudgetKrw: number;
  recommendedBudgetKrw: number;
  estimateBasis: EstimateBasis;
  recommendationBasis: RecommendationBasis;
  rangeBasis: RangeBasis;
  dataQualityBasis: DataQualityBasis;
}

/**
 * @param peer 기존 Planning V1(estimateForPlanning) 결과 - 변경하지 않고 읽기만 한다.
 * @param seriesSignal `computeSeriesSignal`의 결과. status가 MATCHED이고
 *                      `seriesEstimatedBudgetKrw`가 있을 때만 series 값을 쓴다 - NOT_REQUESTED/
 *                      UNMATCHED/AMBIGUOUS/NO_VALID_HISTORY는 전부 동일하게 peer 그대로
 *                      (historyCount=1도 이 Phase에서는 별도 gate 없이 MATCHED와 동일하게 처리한다 -
 *                      Phase 9C-B safety audit에서 구조적 문제가 없다고 판단됨).
 */
export function applySeriesPlanningSemantics(peer: PeerPlanningEstimate, seriesSignal: SeriesSignalResponse): SeriesPlanningSemantics {
  if (seriesSignal.status === "MATCHED" && seriesSignal.seriesEstimatedBudgetKrw !== undefined) {
    const estimatedBudgetKrw = seriesSignal.seriesEstimatedBudgetKrw;
    // PHASE 19-A: 고정 +5% buffer - peer(existingContingency)를 전혀 참조하지 않는다.
    const recommendedBudgetKrw = Math.round(estimatedBudgetKrw * (1 + SERIES_PLANNING_BUFFER_RATE));
    return {
      estimatedBudgetKrw,
      recommendedBudgetKrw,
      estimateBasis: "SERIES_HISTORY_MEDIAN",
      recommendationBasis: "SERIES_HISTORY_WITH_FIXED_BUFFER",
      rangeBasis: "PEER_EMPIRICAL_P25_P75",
      dataQualityBasis: "PEER_SAMPLE",
    };
  }

  return {
    estimatedBudgetKrw: peer.estimatedBudgetKrw,
    recommendedBudgetKrw: peer.recommendedBudgetKrw,
    estimateBasis: "PEER_SIMILARITY",
    recommendationBasis: "PEER_PLANNING",
    rangeBasis: "PEER_EMPIRICAL_P25_P75",
    dataQualityBasis: "PEER_SAMPLE",
  };
}
