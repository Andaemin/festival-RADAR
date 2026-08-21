import { MultiYearRecordLite } from "./types";

/**
 * Budget Planning Assistant 전용 reference pool 필터 - {@link buildTrainingPool}(backtest용,
 * lib/multiyear/baseline-estimator.ts)과 의도적으로 완전히 분리된 함수다.
 *
 * 왜 buildTrainingPool을 재사용/확장하지 않았는가: 그 함수는 backtest fold(고정된 평가 시점) 기준
 * `datasetYear < targetYear`만 만드는 leakage-safe 연구용 필터다. Planning Assistant의
 * INCLUDE_PUBLISHED_SAME_YEAR(= `datasetYear <= planningYear`)처럼 backtest에는 없는 "≤" 개념을
 * 섞어 넣으면 그 함수를 쓰는 모든 backtest 코드(Phase 3 S0/Phase 4 V1 fixture 등)에 실수로
 * leakage 위험을 심을 수 있다 - "backtest fold와 Planning Assistant의 연도 선택 로직은 분리한다"를
 * 코드 구조로 강제하기 위해 필터 자체를 별도로 둔다. 데이터 품질/필수 feature 판정 기준만
 * buildTrainingPool과 동일하게 유지한다(기준이 갈라지면 안 되므로). Spring
 * MultiYearReferenceYearFilter.filter를 그대로 포팅.
 *
 * @param includeSameYear true면 `datasetYear <= planningYear`, false면 `datasetYear < planningYear`
 */
export function filterReferencePool(
  records: (MultiYearRecordLite & { budgetQualityFlag: string })[],
  planningYear: number,
  includeSameYear: boolean
): MultiYearRecordLite[] {
  const result: MultiYearRecordLite[] = [];
  for (const r of records) {
    const withinReferenceWindow = includeSameYear ? r.datasetYear <= planningYear : r.datasetYear < planningYear;
    if (!withinReferenceWindow) continue;

    const lowQuality = r.budgetQualityFlag !== "VALID";
    const missingFeature = r.region === null || r.typeTokens.size === 0;
    if (lowQuality || missingFeature) continue;

    result.push(r);
  }
  return result;
}
