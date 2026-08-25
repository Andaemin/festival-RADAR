import { describe, expect, it } from "vitest";
import { resolveSeriesDisplayState } from "@/lib/multiyear-series/planning-ui-display";
import { SERIES_SIGNAL_NOT_REQUESTED, SeriesSignalResponse } from "@/lib/multiyear-series/series-signal";

/**
 * PHASE 9D — resolveSeriesDisplayState가 estimateBasis/seriesSignal 조합마다 정확히 어떤
 * 배지 상태를 돌려주는지 검증한다. 여기서 가장 중요한 건 "MATCHED인데 Peer처럼 보이거나
 * fallback인데 Series가 반영됐다고 표시되는 일이 없어야 한다"(9D 6절)는 것 - 특히 마지막 두
 * 케이스(모순 입력)가 안전하게 NOT_SHOWN으로 방어되는지를 확인한다.
 */
const MATCHED: SeriesSignalResponse = {
  status: "MATCHED",
  matchMethod: "EXACT",
  canonicalName: "한강페스티벌",
  historyCount: 6,
  historicalYears: [2019, 2020, 2021, 2022, 2023, 2024],
  latestHistoricalYear: 2024,
  seriesEstimatedBudgetKrw: 300_000_000,
};

describe("resolveSeriesDisplayState", () => {
  it("estimateBasis=SERIES_HISTORY_MEDIAN + MATCHED -> SERIES_APPLIED (canonicalName/historyCount/historicalYears 그대로 전달)", () => {
    const result = resolveSeriesDisplayState("SERIES_HISTORY_MEDIAN", MATCHED);
    expect(result).toEqual({
      kind: "SERIES_APPLIED",
      canonicalName: "한강페스티벌",
      historyCount: 6,
      historicalYears: [2019, 2020, 2021, 2022, 2023, 2024],
      latestHistoricalYear: 2024,
    });
  });

  it("estimateBasis=PEER_SIMILARITY + UNMATCHED -> UNMATCHED", () => {
    expect(resolveSeriesDisplayState("PEER_SIMILARITY", { status: "UNMATCHED" })).toEqual({ kind: "UNMATCHED" });
  });

  it("estimateBasis=PEER_SIMILARITY + AMBIGUOUS -> AMBIGUOUS", () => {
    expect(resolveSeriesDisplayState("PEER_SIMILARITY", { status: "AMBIGUOUS" })).toEqual({ kind: "AMBIGUOUS" });
  });

  it("estimateBasis=PEER_SIMILARITY + NO_VALID_HISTORY -> NO_VALID_HISTORY", () => {
    const signal: SeriesSignalResponse = { status: "NO_VALID_HISTORY", matchMethod: "EXACT", canonicalName: "단일이력축제" };
    expect(resolveSeriesDisplayState("PEER_SIMILARITY", signal)).toEqual({ kind: "NO_VALID_HISTORY" });
  });

  it("estimateBasis=PEER_SIMILARITY + NOT_REQUESTED -> NOT_SHOWN (festivalName 미입력, 특별한 경고 없음)", () => {
    expect(resolveSeriesDisplayState("PEER_SIMILARITY", SERIES_SIGNAL_NOT_REQUESTED)).toEqual({ kind: "NOT_SHOWN" });
  });

  it("모순 방어: estimateBasis=SERIES_HISTORY_MEDIAN인데 signal이 MATCHED를 뒷받침 못하면 NOT_SHOWN(SERIES_APPLIED를 잘못 주장하지 않음)", () => {
    expect(resolveSeriesDisplayState("SERIES_HISTORY_MEDIAN", { status: "UNMATCHED" })).toEqual({ kind: "NOT_SHOWN" });
    expect(resolveSeriesDisplayState("SERIES_HISTORY_MEDIAN", SERIES_SIGNAL_NOT_REQUESTED)).toEqual({ kind: "NOT_SHOWN" });
  });

  it("모순 방어: estimateBasis=PEER_SIMILARITY인데 signal이 MATCHED면 NOT_SHOWN(fallback인데 Series 반영됐다고 말하지 않음)", () => {
    expect(resolveSeriesDisplayState("PEER_SIMILARITY", MATCHED)).toEqual({ kind: "NOT_SHOWN" });
  });
});
