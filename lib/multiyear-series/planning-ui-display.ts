import { EstimateBasis } from "./apply-planning-semantics";
import { SeriesSignalResponse } from "./series-signal";

/**
 * PHASE 9D — Planning UI Series Integration. Planning UI가 "동일 축제 이력이 반영됐다"고
 * 말할지, fallback 문구를 보여줄지, 아무것도 표시하지 않을지를 결정하는 순수 함수다.
 *
 * <p>핵심 요구사항(9D 6절): "Series MATCHED인데 화면이 Peer estimate처럼 설명하거나, fallback인데
 * Series가 반영됐다고 표시하는 일이 없어야 한다." 이를 문구를 손으로 맞추는 대신 구조적으로
 * 보장한다 - SERIES_APPLIED 배지는 `estimateBasis`(실제 API가 계산에 쓴 근거)가
 * `SERIES_HISTORY_MEDIAN`일 때만 나올 수 있고, seriesSignal.status가 그걸 뒷받침하지 못하면
 * (있을 수 없지만) 방어적으로 아무것도 표시하지 않는다 - 잘못된 확신을 주는 것보다 안전하다.</p>
 */

export type SeriesDisplayState =
  | { kind: "SERIES_APPLIED"; canonicalName: string; historyCount: number; historicalYears: number[]; latestHistoricalYear: number | undefined }
  | { kind: "UNMATCHED" }
  | { kind: "AMBIGUOUS" }
  | { kind: "NO_VALID_HISTORY" }
  /** festivalName 미입력(NOT_REQUESTED), 또는 basis와 signal이 서로 모순되는 방어적 상황 - 아무 배지도 띄우지 않는다. */
  | { kind: "NOT_SHOWN" };

export function resolveSeriesDisplayState(estimateBasis: EstimateBasis, seriesSignal: SeriesSignalResponse): SeriesDisplayState {
  if (estimateBasis === "SERIES_HISTORY_MEDIAN") {
    if (seriesSignal.status === "MATCHED" && seriesSignal.canonicalName !== undefined && seriesSignal.historyCount !== undefined) {
      return {
        kind: "SERIES_APPLIED",
        canonicalName: seriesSignal.canonicalName,
        historyCount: seriesSignal.historyCount,
        historicalYears: seriesSignal.historicalYears ?? [],
        latestHistoricalYear: seriesSignal.latestHistoricalYear,
      };
    }
    // estimateBasis는 series라는데 signal이 그걸 뒷받침 못하는 모순 상태 - 절대 있어서는 안 되지만
    // (route.ts에서 둘은 항상 같은 판정에서 나옴), 방어적으로 아무것도 주장하지 않는다.
    return { kind: "NOT_SHOWN" };
  }

  // estimateBasis === PEER_SIMILARITY. seriesSignal.status로 어떤 fallback 문구를 보여줄지 결정한다.
  switch (seriesSignal.status) {
    case "UNMATCHED":
      return { kind: "UNMATCHED" };
    case "AMBIGUOUS":
      return { kind: "AMBIGUOUS" };
    case "NO_VALID_HISTORY":
      return { kind: "NO_VALID_HISTORY" };
    case "NOT_REQUESTED":
      return { kind: "NOT_SHOWN" };
    case "MATCHED":
      // estimateBasis는 peer라는데 signal은 MATCHED인 모순 상태 - 위와 대칭적으로 방어.
      return { kind: "NOT_SHOWN" };
  }
}

/** UNMATCHED/AMBIGUOUS/NO_VALID_HISTORY 각각에 대응하는 고정 문구(9D 3절). */
export const SERIES_FALLBACK_MESSAGE: Record<"UNMATCHED" | "AMBIGUOUS" | "NO_VALID_HISTORY", string> = {
  UNMATCHED: "동일 축제의 과거 이력을 확인하지 못해 유사 축제 데이터를 기준으로 계산했습니다.",
  AMBIGUOUS: "동일 축제 여부를 안정적으로 판별하기 어려워 유사 축제 데이터만 사용했습니다.",
  NO_VALID_HISTORY: "동일 축제 이력은 확인됐지만 활용 가능한 예산 데이터가 없어 유사 축제 데이터를 기준으로 계산했습니다.",
};
