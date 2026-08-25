import { FestivalType, Region } from "@/lib/domain/enums";
import { quantile } from "@/lib/utils/weighted-statistics";
import { tryAdjustForCpi } from "./cpi";
import { buildSeriesEvalTargets, buildSeriesTrainingPool } from "./fold";
import { SeriesRecordWithQuality } from "./record-loader";
import { lookupTarget } from "./series-lookup";
import { buildFrozenSeriesModel } from "./series-linker";
import { computeSeriesSignal, SeriesSignalResponse } from "./series-signal";
import { buildSyntheticTargetRecord } from "./target-from-query";
import { FrozenSeriesModel, SeriesRecordLite } from "./types";

/**
 * PHASE 19-A — Final Reliability Production Integration. Phase 17에서 확정하고 Phase 18/18-B에서
 * leakage-safe하게 재검증한 3-tier reliability(HIGH=SERIES_STABLE/MEDIUM=SERIES_VOLATILE/
 * LOW=PEER_FALLBACK)와, 그 tier를 가르는 CPI-adjusted volatility threshold의 production 구현이다.
 *
 * <p>이 모듈은 새 정의를 만들지 않는다 - 전부 Phase 17/18/18-B에서 이미 검증된 규칙을 그대로
 * 옮긴 것이다:</p>
 * <ul>
 *   <li>volatility = log(P75/P25) of CPI-adjusted historical(<targetYear) VALID budgets
 *       (Phase 17/18 정의, own-history.ts의 CPI fallback 정책과 동일하게 관련 연도 중 CPI_TABLE에
 *       없는 해가 하나라도 있으면 전부 nominal로 fallback).</li>
 *   <li>historyCount&lt;=1 -&gt; 항상 HIGH(volatility 계산 불가, Phase 17/18에서 경험적으로도
 *       가장 안정적이었던 관측과 일치).</li>
 *   <li>threshold(Y) = {구성: `datasetYear` in [earliestOofYear, Y-1]인 모든 과거 backtest target
 *       중 그 target 자신의 fold에서 SERIES_APPLIED + historyCount&gt;=2인 대상}의 CPI-adjusted
 *       volatility 전체의 median(Phase 18-B Part 6). 미래(&gt;=Y) 데이터는 절대 참조하지 않는다.</li>
 *   <li>threshold 계산이 불가능(pool&lt;{@link RELIABILITY_MIN_CALIBRATION_N})하면 HIGH로
 *       기본 처리(Phase 18-B Part F와 동일 fallback 방향).</li>
 * </ul>
 *
 * <p>{@link computeLeakageSafeVolatilityThreshold}는 연도 수만큼 {@link FrozenSeriesModel}을
 * 다시 만들고 그 해의 모든 evalTarget에 signal을 계산하므로 비용이 크다 - 매 API 요청마다 부르면
 * 안 된다. `runtime-cache.ts`의 `getCachedVolatilityThreshold`가 (dataRevision, cutoff) 단위로
 * 캐싱해 재사용한다(이 파일 자체는 캐싱을 모른다 - 순수 계산만 한다).</p>
 */

export type PlanningReliabilityTier = "HIGH" | "MEDIUM" | "LOW";
export type PlanningReliabilityReasonKey = "SERIES_STABLE" | "SERIES_STABLE_SINGLE_HISTORY" | "SERIES_VOLATILE" | "PEER_FALLBACK";

export interface PlanningReliabilityResult {
  tier: PlanningReliabilityTier;
  reasonKey: PlanningReliabilityReasonKey;
  reasonText: string;
}

/** Phase 18-B Part 6에서 쓴 것과 동일한 leakage-safe calibration 사용 가능 최소 pool 크기. */
export const RELIABILITY_MIN_CALIBRATION_N = 30;

/**
 * PHASE 19-B — festivalName이 없어(seriesSignal이 NOT_REQUESTED로 고정된) `model`/`threshold`가
 * 애초에 필요 없는 호출에 쓰는 placeholder. `computePlanningReliability`는 `seriesApplied`가
 * false면 이 인자들을 전혀 읽지 않으므로(아래 구현 참고) 항상 안전하다 - 호출부가 "festivalName
 * 없으면 reliability 계산을 건너뛴다" 같은 별도 분기를 만들지 않고 한 곳에서만
 * `computePlanningReliability`를 부르도록 하기 위한 순수 편의 상수다(빈 배열이라 빌드 비용도
 * 무시할 수준).
 */
export const EMPTY_FROZEN_SERIES_MODEL: FrozenSeriesModel = buildFrozenSeriesModel([]);

/**
 * 사용자 노출용 reason 문구(Phase 19-A Part 8 확정, Phase 31-B에서 SERIES_STABLE_SINGLE_HISTORY
 * 분리) - API/UI에 `reliabilityReason`으로 연결되어 있다.
 *
 * PHASE 31-B — historyCount<=1인 SERIES_STABLE(HIGH) 대상은 애초에 "연도별 변동"을 측정할 수
 * 없다(tierFromVolatility의 historyCount<=1 분기, volatility 계산 자체가 정의되지 않음). 기존
 * SERIES_STABLE 문구("...연도별 예산 변동이 비교적 안정적입니다")는 이 경우 실제로는 측정하지
 * 못한 것을 "측정해봤더니 안정적이었다"처럼 표현해 근거를 과장할 소지가 있었다(Phase 20/30에서
 * 확인 - HIGH의 47.58%가 이 케이스). 이 fix는 tier 산정/threshold/routing/estimate/
 * recommendation을 전혀 바꾸지 않고, 오직 이 문구만 historyCount에 따라 정확하게 분리한다:
 * historyCount>=2(실제로 변동을 측정해서 안정적이었던 경우)는 기존 문구를 그대로 유지하고,
 * historyCount<=1(측정 자체가 불가능했던 경우)은 "변동이 안정적"이라는 주장을 하지 않는
 * 별도 문구를 쓴다.
 */
const REASON_TEXT: Record<PlanningReliabilityReasonKey, string> = {
  SERIES_STABLE: "동일 축제의 과거 예산 이력을 활용했고, 물가 보정 후 연도별 예산 변동이 비교적 안정적입니다.",
  SERIES_STABLE_SINGLE_HISTORY: "동일 축제의 과거 예산 이력을 활용해 예산을 추정했습니다.",
  SERIES_VOLATILE: "동일 축제의 과거 예산 이력을 활용했지만, 물가 보정 후 연도별 예산 변동폭이 큰 편입니다.",
  PEER_FALLBACK: "동일 축제의 충분한 과거 예산 이력을 확인하지 못해 유사 축제 데이터를 기반으로 추정했습니다.",
};

/**
 * threshold 재계산 모집단의 시작 연도 - 데이터에 하드코딩된 2018을 박아넣지 않고, 실제 보유
 * 데이터의 최소 datasetYear+1로 도출한다(leakage-safe training pool이 최소 1건이라도 존재하려면
 * targetYear >= minDatasetYear+1이어야 한다).
 */
export function earliestOofYear(allSeriesRecords: { datasetYear: number }[]): number {
  const minYear = allSeriesRecords.reduce((min, r) => Math.min(min, r.datasetYear), Infinity);
  if (!Number.isFinite(minYear)) return Infinity; // 데이터가 아예 없으면 계산 불가
  return minYear + 1;
}

/**
 * CPI-adjusted historical volatility = log(P75/P25). Phase 18-B Part 6 정의를 그대로 재사용한다.
 *
 * @param historical group의 historical(< targetYear) member들의 (budgetKrw, datasetYear) 목록.
 * @param targetYear 이 volatility가 속한 target의 planningYear - CPI base year(targetYear-1)를
 *                    정한다.
 * @returns historyCount&lt;2거나 P25/P75가 0 이하(invalid/nonpositive edge case, 실제 VALID
 *          budget 데이터에서는 관측된 적 없음)면 null.
 */
export function computeCpiAdjustedVolatility(historical: { budgetKrw: number; datasetYear: number }[], targetYear: number): number | null {
  if (historical.length < 2) return null;

  // own-history.ts의 medianBudgetKrw CPI fallback과 대칭 정책: 관련 연도 중 하나라도
  // CPI_TABLE에 없으면(예: 이 target 자신의 planningYear>=2027) 전부 nominal로 fallback한다.
  // PHASE 19-A 최종 보고 참고 - Phase 18-B는 실제 2027 target으로 이 case를 테스트하지 못했다
  // (2018~2026 데이터만 존재) - own-history.ts에 이미 적용된 fallback 정책을 대칭 적용한 것이며
  // 새 정책을 발명한 것이 아니다.
  const adjustedRaw = historical.map((h) => tryAdjustForCpi(h.budgetKrw, h.datasetYear, targetYear));
  const cpiOk = adjustedRaw.every((v): v is number => v !== null);
  const budgets = (cpiOk ? (adjustedRaw as number[]) : historical.map((h) => h.budgetKrw)).slice().sort((a, b) => a - b);

  if (budgets.some((b) => b <= 0)) return null; // invalid/nonpositive guard(방어적 - 실관측 없음)

  const p25 = quantile(budgets, 0.25);
  const p75 = quantile(budgets, 0.75);
  if (p25 <= 0) return null;
  return Math.log(p75 / p25);
}

/**
 * target의 historical(< targetYear) group member 목록 - own-history.ts의 historical 필터와
 * 동일 기준. `computeSeriesSignal`이 이미 내부에서 한 번 lookupTarget을 하지만, 이 프로젝트
 * 전반에서 써 온 "독립 재계산을 통한 cross-check" 관례를 따라 여기서도 별도로 lookupTarget한다
 * (own-history.ts/series-signal.ts 공개 표면을 바꾸지 않기 위함이기도 하다 - Phase 19-A Part 0
 * "Series matcher 유지").
 */
function historicalMembers(
  festivalName: string,
  region: Region,
  district: string | null,
  typeTokens: Set<FestivalType>,
  targetYear: number,
  model: FrozenSeriesModel
): SeriesRecordLite[] {
  const target = buildSyntheticTargetRecord({ festivalName, region, district, typeTokens, planningYear: targetYear });
  const lookup = lookupTarget(target, model);
  if (lookup.matchedGroupId === null) return [];
  const group = model.groupsById.get(lookup.matchedGroupId)!;
  return group.members.filter((m) => m.datasetYear < targetYear);
}

/** historyCount/volatility/threshold로부터 tier를 정하는 순수 판정식(Phase 17/18/18-B 규칙). */
export function tierFromVolatility(historyCount: number, volatility: number | null, threshold: number | null): PlanningReliabilityTier {
  if (historyCount <= 1) return "HIGH";
  if (threshold === null || volatility === null) return "HIGH"; // calibration 불가/계산 불가 -> STABLE 기본값
  return volatility <= threshold ? "HIGH" : "MEDIUM";
}

/**
 * 실제 serving 시점에 부를 진입점. `seriesSignal`은 이미 계산되어 있어야 한다(route.ts가 이미
 * `computeSeriesSignal`을 호출하므로 그 결과를 재사용 - 이 함수가 중복으로 signal을 다시 만들지
 * 않는다). festivalName/region/district/typeTokens/planningYear/model은 그 `computeSeriesSignal`
 * 호출에 쓴 것과 정확히 같은 값을 넘겨야 한다.
 *
 * @param threshold `getCachedVolatilityThreshold`(runtime-cache.ts)가 계산한 이 planningYear의
 *                   threshold. null이면 calibration 불가로 처리(HIGH 기본값).
 */
export function computePlanningReliability(
  seriesSignal: SeriesSignalResponse,
  festivalName: string,
  region: Region,
  district: string | null,
  typeTokens: Set<FestivalType>,
  planningYear: number,
  model: FrozenSeriesModel,
  threshold: number | null
): PlanningReliabilityResult {
  const seriesApplied = seriesSignal.status === "MATCHED" && seriesSignal.seriesEstimatedBudgetKrw !== undefined;
  if (!seriesApplied) {
    return { tier: "LOW", reasonKey: "PEER_FALLBACK", reasonText: REASON_TEXT.PEER_FALLBACK };
  }

  const historical = historicalMembers(festivalName, region, district, typeTokens, planningYear, model);
  const historyCount = historical.length;
  const volatility = computeCpiAdjustedVolatility(historical, planningYear);
  const tier = tierFromVolatility(historyCount, volatility, threshold);
  // PHASE 31-B — tier 산정 로직(tierFromVolatility)은 그대로다. reasonKey만 historyCount<=1을
  // 별도로 구분한다: 이 경우 volatility 자체가 정의되지 않으므로(위 computeCpiAdjustedVolatility
  // 참고, historyCount<2면 항상 null) "변동이 안정적"이라는 주장을 할 근거가 없다.
  let reasonKey: PlanningReliabilityReasonKey;
  if (tier === "MEDIUM") {
    reasonKey = "SERIES_VOLATILE";
  } else if (historyCount <= 1) {
    reasonKey = "SERIES_STABLE_SINGLE_HISTORY";
  } else {
    reasonKey = "SERIES_STABLE";
  }
  return { tier, reasonKey, reasonText: REASON_TEXT[reasonKey] };
}

export interface VolatilityThresholdResult {
  threshold: number | null;
  poolN: number;
  usable: boolean;
}

/**
 * PHASE 18-B Part 6의 leakage-safe threshold 생성 규칙의 production 구현. planningYear=Y에
 * 대해 `datasetYear`가 [earliestOofYear, Y-1] 범위인 모든 과거 backtest target을 그 target
 * 자신의 fold(연도 Yh)에서 다시 채점해, SERIES_APPLIED로 분류되고 historyCount&gt;=2인 대상만
 * 모아 각자의 CPI-adjusted volatility(자기 자신의 base year Yh-1 기준)를 계산하고 그 전체의
 * median을 threshold로 쓴다.
 *
 * 미래(target-year Y 또는 그 이후) 데이터는 전혀 참조하지 않는다 - 루프가 `yh < planningYear`
 * 범위만 돈다. 따라서 planningYear가 보유 데이터 최대 연도보다 미래여도(예: 2027, 2030) 항상
 * 계산 가능하다(그 시점에 실제로 존재하는 과거 데이터만으로).
 *
 * 비용이 크다(연도 수 × 그 해 evalTarget 수만큼 FrozenSeriesModel 재구성 + signal 계산) - 매
 * 요청마다 부르지 말고 runtime-cache.ts의 getCachedVolatilityThreshold를 통해 캐싱된 결과를 써야
 * 한다.
 */
export function computeLeakageSafeVolatilityThreshold(allSeriesRecords: SeriesRecordWithQuality[], planningYear: number): VolatilityThresholdResult {
  const earliest = earliestOofYear(allSeriesRecords);
  const pool: number[] = [];

  for (let yh = earliest; yh < planningYear; yh++) {
    const { trainingPool } = buildSeriesTrainingPool(allSeriesRecords, yh);
    const evalTargets = buildSeriesEvalTargets(allSeriesRecords, yh);
    if (trainingPool.length === 0 || evalTargets.length === 0) continue;

    const model = buildFrozenSeriesModel(trainingPool);
    for (const t of evalTargets) {
      if (t.region === null) continue; // buildSeriesEvalTargets가 이미 걸렀지만 타입 방어
      const signal = computeSeriesSignal(t.festivalName, t.region, t.district, t.typeTokens, yh, model);
      const seriesApplied = signal.status === "MATCHED" && signal.seriesEstimatedBudgetKrw !== undefined;
      if (!seriesApplied) continue;

      const historical = historicalMembers(t.festivalName, t.region, t.district, t.typeTokens, yh, model);
      if (historical.length < 2) continue;

      const vol = computeCpiAdjustedVolatility(historical, yh);
      if (vol !== null) pool.push(vol);
    }
  }

  const usable = pool.length >= RELIABILITY_MIN_CALIBRATION_N;
  return { threshold: usable ? quantile(pool, 0.5) : null, poolN: pool.length, usable };
}
