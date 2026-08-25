import { describe, expect, it } from "vitest";
import { applySeriesPlanningSemantics, PeerPlanningEstimate, SERIES_PLANNING_BUFFER_RATE } from "@/lib/multiyear-series/apply-planning-semantics";
import { SERIES_SIGNAL_NOT_REQUESTED, SeriesSignalResponse } from "@/lib/multiyear-series/series-signal";

/**
 * PHASE 9C-C — applySeriesPlanningSemantics의 5가지 seriesSignal status 분기를 DB 없이
 * 전부 검증한다. peer 값 자체(P25/P50/P60/P75/dataQualityV3/sampleCount 등)는 이 함수가
 * 아예 받지도 반환하지도 않으므로("estimatedBudgetKrw/recommendedBudgetKrw만 계산") 호출부가
 * peer 결과를 그대로 응답에 흘려보내는 것으로 "peer 통계는 변경되지 않는다"가 구조적으로
 * 보장된다 - 이 테스트는 estimatedBudgetKrw/recommendedBudgetKrw/basis metadata만 좁게 확인한다.
 *
 * PHASE 19-A: SERIES 분기의 recommendedBudgetKrw는 이제 peer와 완전히 무관한 고정
 * +5%(SERIES_PLANNING_BUFFER_RATE) buffer다 - 아래 PEER fixture는 PEER_FALLBACK 분기의
 * pass-through 검증에만 쓰인다(SERIES 분기 계산에는 전혀 관여하지 않는다).
 */
const PEER: PeerPlanningEstimate = {
  estimatedBudgetKrw: 100_000_000,
  recommendedBudgetKrw: 100_000_000, // PHASE 19-A: peer도 이제 contingency 없음(=max(estimated,p60))
  p60Krw: 90_000_000,
};

function matchedSignal(seriesEstimatedBudgetKrw: number): SeriesSignalResponse {
  return {
    status: "MATCHED",
    matchMethod: "EXACT",
    canonicalName: "테스트축제",
    historyCount: 3,
    historicalYears: [2022, 2023, 2024],
    latestHistoricalYear: 2024,
    seriesEstimatedBudgetKrw,
  };
}

describe("applySeriesPlanningSemantics", () => {
  it("MATCHED: estimatedBudget=seriesMedian, recommendedBudget=seriesMedian*1.05(고정 buffer)", () => {
    const seriesMedian = 200_000_000;
    const result = applySeriesPlanningSemantics(PEER, matchedSignal(seriesMedian));

    expect(SERIES_PLANNING_BUFFER_RATE).toBe(0.05);
    expect(result.estimatedBudgetKrw).toBe(seriesMedian);
    expect(result.recommendedBudgetKrw).toBe(Math.round(seriesMedian * 1.05));
    expect(result.recommendedBudgetKrw).toBe(210_000_000); // 200_000_000 * 1.05
    expect(result.estimateBasis).toBe("SERIES_HISTORY_MEDIAN");
    expect(result.recommendationBasis).toBe("SERIES_HISTORY_WITH_FIXED_BUFFER");
    expect(result.rangeBasis).toBe("PEER_EMPIRICAL_P25_P75");
    expect(result.dataQualityBasis).toBe("PEER_SAMPLE");
  });

  it("PHASE 19-A: peer의 estimatedBudgetKrw/recommendedBudgetKrw/p60Krw가 무엇이든(=legacy confidence가 어떻게 변하든) SERIES 분기 recommendedBudgetKrw는 seriesMedian*1.05로 완전히 동일하다", () => {
    const seriesMedian = 300_000_000;
    const peerLowContingency: PeerPlanningEstimate = { estimatedBudgetKrw: 80_000_000, recommendedBudgetKrw: 80_000_000, p60Krw: 70_000_000 };
    const peerHighP60: PeerPlanningEstimate = { estimatedBudgetKrw: 80_000_000, recommendedBudgetKrw: 999_000_000, p60Krw: 500_000_000 };

    const resultA = applySeriesPlanningSemantics(peerLowContingency, matchedSignal(seriesMedian));
    const resultB = applySeriesPlanningSemantics(peerHighP60, matchedSignal(seriesMedian));

    expect(resultA.recommendedBudgetKrw).toBe(Math.round(seriesMedian * 1.05));
    expect(resultB.recommendedBudgetKrw).toBe(Math.round(seriesMedian * 1.05));
    expect(resultA.recommendedBudgetKrw).toBe(resultB.recommendedBudgetKrw); // peer가 완전히 달라도 series recommendation은 불변
  });

  it("NOT_REQUESTED: peer 결과를 완전히 그대로 반환한다(festivalName 없는 요청과 동일)", () => {
    const result = applySeriesPlanningSemantics(PEER, SERIES_SIGNAL_NOT_REQUESTED);
    expect(result.estimatedBudgetKrw).toBe(PEER.estimatedBudgetKrw);
    expect(result.recommendedBudgetKrw).toBe(PEER.recommendedBudgetKrw);
    expect(result.estimateBasis).toBe("PEER_SIMILARITY");
    expect(result.recommendationBasis).toBe("PEER_PLANNING");
  });

  it("UNMATCHED: peer 결과 그대로", () => {
    const result = applySeriesPlanningSemantics(PEER, { status: "UNMATCHED" });
    expect(result.estimatedBudgetKrw).toBe(PEER.estimatedBudgetKrw);
    expect(result.recommendedBudgetKrw).toBe(PEER.recommendedBudgetKrw);
    expect(result.estimateBasis).toBe("PEER_SIMILARITY");
    expect(result.recommendationBasis).toBe("PEER_PLANNING");
  });

  it("AMBIGUOUS: peer 결과 그대로(fallback)", () => {
    const result = applySeriesPlanningSemantics(PEER, { status: "AMBIGUOUS" });
    expect(result.estimatedBudgetKrw).toBe(PEER.estimatedBudgetKrw);
    expect(result.recommendedBudgetKrw).toBe(PEER.recommendedBudgetKrw);
    expect(result.estimateBasis).toBe("PEER_SIMILARITY");
    expect(result.recommendationBasis).toBe("PEER_PLANNING");
  });

  it("NO_VALID_HISTORY: peer 결과 그대로(fallback) - matchedGroupId는 있어도 seriesEstimatedBudgetKrw가 없으므로", () => {
    const result = applySeriesPlanningSemantics(PEER, {
      status: "NO_VALID_HISTORY",
      matchMethod: "EXACT",
      canonicalName: "테스트축제",
    });
    expect(result.estimatedBudgetKrw).toBe(PEER.estimatedBudgetKrw);
    expect(result.recommendedBudgetKrw).toBe(PEER.recommendedBudgetKrw);
    expect(result.estimateBasis).toBe("PEER_SIMILARITY");
    expect(result.recommendationBasis).toBe("PEER_PLANNING");
  });

  it("모든 status에서 rangeBasis/dataQualityBasis는 항상 Peer 기반으로 고정된다(Series 채택 안 함)", () => {
    const statuses: SeriesSignalResponse[] = [
      matchedSignal(150_000_000),
      SERIES_SIGNAL_NOT_REQUESTED,
      { status: "UNMATCHED" },
      { status: "AMBIGUOUS" },
      { status: "NO_VALID_HISTORY" },
    ];
    for (const s of statuses) {
      const result = applySeriesPlanningSemantics(PEER, s);
      expect(result.rangeBasis).toBe("PEER_EMPIRICAL_P25_P75");
      expect(result.dataQualityBasis).toBe("PEER_SAMPLE");
    }
  });

  it("historyCount=1이어도 이번 Phase에서는 별도 gate 없이 MATCHED와 동일하게 series 값을 쓴다", () => {
    const signal: SeriesSignalResponse = {
      status: "MATCHED",
      matchMethod: "EXACT",
      canonicalName: "단일이력축제",
      historyCount: 1,
      historicalYears: [2024],
      latestHistoricalYear: 2024,
      seriesEstimatedBudgetKrw: 50_000_000,
    };
    const result = applySeriesPlanningSemantics(PEER, signal);
    expect(result.estimatedBudgetKrw).toBe(50_000_000);
    expect(result.estimateBasis).toBe("SERIES_HISTORY_MEDIAN");
  });
});
