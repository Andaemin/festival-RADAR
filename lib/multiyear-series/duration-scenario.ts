import { SeriesHistoryDetailDto } from "./series-history-detail";

/**
 * Feature: Series 기간 변경 계획 시뮬레이션.
 *
 * 배경(연구 결과, docs/research-series-duration-visitor.md 등): 개최기간을 duration elasticity로
 * production 예산 계산에 자동 반영하면 오차가 뚜렷하게 악화된다(G0 MdAPE 9.59% → duration
 * elasticity 적용 시 최대 13.44%, 실제 기간 변경 Series에서는 최대 36%까지 악화). 그래서
 * `estimatedBudgetKrw`/`recommendedBudgetKrw`는 durationDays를 전혀 반영하지 않는다 - 이 모듈도
 * 그 값을 절대 바꾸지 않는다.
 *
 * 대신 이 모듈은 "AI가 만든 보정"이 아니라 "사용자가 직접 입력한 변동비"만으로 별도 계획
 * 시나리오(scenarioRecommendedBudgetKrw)를 계산하는 순수 함수만 담는다. 계산은 전부 덧셈/곱셈
 * 뿐이며(§8/§9), 기본값을 만들어 채우지 않는다(variableCostPerDayKrw는 항상 사용자 입력).
 */

export interface DurationComparisonBasis {
  /** 동일 축제의 leakage-safe(과거) 이력 중 가장 최근 record의 개최일수. */
  comparisonDurationDays: number;
  /** 그 record의 연도. */
  comparisonDurationYear: number;
}

/**
 * "기간 비교 기준"을 seriesHistoryDetail에서 그대로 뽑아낸다 - 새로 계산/매칭하지 않는다.
 *
 * own-history eligibility를 통과한(eligibleForSeriesCalculation) record 중 durationDays가 있는
 * 것만 후보로 삼고, 그중 datasetYear가 가장 큰 것을 쓴다. `estimateSource`(LATEST/MEDIAN)와는
 * 의도적으로 무관하다 - §13: MEDIAN branch에서는 "예산 산정에 쓰인 기준"과 "기간 비교 기준"이
 * 서로 다른 record일 수 있고, 이 함수는 오직 후자만 답한다. 호출부는 그 차이를 UI 문구로
 * 구분해야 한다("최근 확인된 개최기간"이라고만 부르고 "예산 산출 기간"이라고 하지 않는다).
 *
 * 과거 개최기간 정보가 전혀 없으면(모든 eligible record의 durationDays===null) null을 반환한다 -
 * 임의 기간을 만들어내지 않는다.
 */
export function deriveComparisonDuration(detail: SeriesHistoryDetailDto): DurationComparisonBasis | null {
  let best: DurationComparisonBasis | null = null;
  for (const r of detail.records) {
    if (!r.eligibleForSeriesCalculation || r.durationDays === null) continue;
    if (best === null || r.datasetYear > best.comparisonDurationYear) {
      best = { comparisonDurationDays: r.durationDays, comparisonDurationYear: r.datasetYear };
    }
  }
  return best;
}

export type DurationChangeStatus = "SAME" | "INCREASE" | "DECREASE" | "UNKNOWN";

/** comparisonDurationDays가 없으면(과거 기간 정보 없음) UNKNOWN - 시뮬레이션 자체를 제공하지 않는다. */
export function computeDurationChangeStatus(comparisonDurationDays: number | null, targetDurationDays: number): DurationChangeStatus {
  if (comparisonDurationDays === null) return "UNKNOWN";
  if (targetDurationDays === comparisonDurationDays) return "SAME";
  return targetDurationDays > comparisonDurationDays ? "INCREASE" : "DECREASE";
}

export interface DurationScenarioResult {
  durationDelta: number;
  durationAdjustmentKrw: number;
  scenarioRecommendedBudgetKrw: number;
}

/**
 * §8/§9 산식 그대로: durationDelta = target - comparison, adjustment = delta × variableCost,
 * scenario = recommendedBudgetKrw + adjustment. 이 함수는 elasticity/비율 계산을 전혀 하지 않는다 -
 * "2일 줄었으니 예산도 비례해서 몇 % 감소"같은 계산은 의도적으로 존재하지 않는다(§9).
 */
export function computeDurationScenario(params: {
  recommendedBudgetKrw: number;
  comparisonDurationDays: number;
  targetDurationDays: number;
  variableCostPerDayKrw: number;
}): DurationScenarioResult {
  const durationDelta = params.targetDurationDays - params.comparisonDurationDays;
  const durationAdjustmentKrw = durationDelta * params.variableCostPerDayKrw;
  return {
    durationDelta,
    durationAdjustmentKrw,
    scenarioRecommendedBudgetKrw: params.recommendedBudgetKrw + durationAdjustmentKrw,
  };
}

export interface VariableCostValidation {
  valid: boolean;
  /** 빈 입력이면 valid=true, value=null(미입력 상태 - 아직 시나리오를 계산하지 않는다). */
  value: number | null;
  errorMessage: string | null;
}

/**
 * §16 — "1일당 변동비" 입력 validation: 빈 값 허용(아직 입력 전), 그 외에는 0 이상의 finite
 * number만 허용한다. 큰 값을 임의로 clamp하지 않는다 - 범위를 넘는다고 값을 조용히 바꾸지 않고
 * 그대로 받아들인다(§16: "지나치게 큰 값도 임의로 보정하지 말되").
 */
export function validateVariableCostInput(raw: string): VariableCostValidation {
  if (raw.trim() === "") return { valid: true, value: null, errorMessage: null };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { valid: false, value: null, errorMessage: "숫자만 입력할 수 있습니다." };
  if (n < 0) return { valid: false, value: null, errorMessage: "0 이상의 값을 입력해주세요." };
  return { valid: true, value: n, errorMessage: null };
}
