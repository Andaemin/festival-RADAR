import { algorithmConfig } from "@/lib/services/algorithm-config";
import { FallbackLevel, FALLBACK_LEVEL_ORDER } from "@/lib/domain/enums";
import { matcherFor, requiresDistrict, requiresVenue } from "./fallback-tier-matcher";
import { computeMultiYearSimilarity } from "./similarity-calculator";
import { MultiYearCandidateSelectionResult, MultiYearLevelContribution, MultiYearQuery, MultiYearRecordLite } from "./types";
import { bestSimilarity, maxYearWeightShare } from "./year-concentration";

const cfg = algorithmConfig;

/** Spring MultiYearCandidateSelectorV1이 고정한 값 - 다시 튜닝하지 않는다(9개 조합
 *  sensitivity 실험에서 이미 확정됨). */
export const YEAR_CONCENTRATION_CAP = 0.5;
export const QUALITY_LOSS_BUDGET = 0.05;

export interface MultiYearV1SelectionResult extends MultiYearCandidateSelectionResult {
  /** 2단계(quality-bounded 확장)가 실제로 발동했는지. */
  qualityGateActivated: boolean;
  /** 발동 시점에 고정된 유사도 하한(bestSimilarityAtActivation - QUALITY_LOSS_BUDGET). 미발동이면 -Infinity. */
  qualityFloor: number;
  /** 발동 시점의 누적 후보 중 최고 유사도. 미발동이면 NaN. */
  bestSimilarityAtActivation: number;
  /** 발동을 트리거한 시점의 topYearWeightShare. 미발동이면 NaN. */
  topYearShareAtDecision: number;
}

/**
 * baseline S0 selector(V0)는 그대로 두고, "연도 쏠림(concentration)"이 기준을 넘을 때만
 * 더 넓은 tier로 확장하는 V4 Hybrid selector. Spring MultiYearSelectorLabV4Hybrid를
 * cap=0.50/qualityLossBudget=0.05로 고정 포팅한 것 - Spring MultiYearCandidateSelectorV1과
 * 동일한 계약이다.
 *
 * 1단계는 V0와 완전히 동일(strict tier 유지) - 매 tier가 끝날 때마다 표본 수(recommendedSampleCount,
 * S0와 동일 threshold)와 "최신 연도가 누적 weight의 YEAR_CONCENTRATION_CAP을 넘지 않는가"를
 * 함께 확인한다. 둘 다 만족하면 V0와 똑같이 그 tier에서 멈춘다 - concentration 문제가 없는
 * 대부분의 쿼리는 V0와 결과가 완전히 같다.
 *
 * 표본은 충분한데 concentration이 기준을 넘는 경우에만 quality gate가 발동한다: 그 시점까지의
 * 최고 유사도를 기준으로, 이후 더 넓은 tier에서 발견되는 candidate는
 * `similarity >= referenceBestSimilarity - QUALITY_LOSS_BUDGET`인 경우에만 받아들인다
 * ("낮은 유사도 candidate를 단순히 연도 다양성을 위해 채우지 않는다").
 */
export function selectMultiYearCandidatesV1(
  trainingPool: MultiYearRecordLite[],
  query: MultiYearQuery
): MultiYearV1SelectionResult {
  const hasDistrict = query.district !== null;
  const hasVenue = query.venueType !== null;

  const accumulated = new Map<number, MultiYearRecordLite>();
  const originLevelByRecordId = new Map<number, FallbackLevel>();
  const levelBreakdown: MultiYearLevelContribution[] = [];
  let reachedLevel = FallbackLevel.SAME_DISTRICT_TYPE_VENUE;

  let qualityGateActive = false;
  let qualityFloor = -Infinity;
  let bestSimilarityAtActivation = NaN;
  let topYearShareAtDecision = NaN;

  for (const level of FALLBACK_LEVEL_ORDER) {
    if ((requiresDistrict(level) && !hasDistrict) || (requiresVenue(level) && !hasVenue)) continue;

    const sizeBefore = accumulated.size;
    const matcher = matcherFor(level, query);
    for (const record of trainingPool) {
      if (accumulated.has(record.id) || !matcher(record)) continue;
      if (qualityGateActive && computeMultiYearSimilarity(query, record).similarity < qualityFloor) {
        continue; // quality gate 발동 후에는 하한 미달 candidate를 아예 받지 않는다.
      }
      accumulated.set(record.id, record);
      originLevelByRecordId.set(record.id, level);
    }

    levelBreakdown.push({ level, added: accumulated.size - sizeBefore, cumulativeTotal: accumulated.size });
    reachedLevel = level;

    const sizeOk = accumulated.size >= cfg.recommendedSampleCount;
    const topYearShare = maxYearWeightShare(accumulated.values(), query);
    const concentrationOk = topYearShare <= YEAR_CONCENTRATION_CAP;

    if (sizeOk && concentrationOk) break;
    if (sizeOk && !concentrationOk && !qualityGateActive) {
      qualityGateActive = true;
      bestSimilarityAtActivation = bestSimilarity(accumulated.values(), query);
      qualityFloor = bestSimilarityAtActivation - QUALITY_LOSS_BUDGET;
      topYearShareAtDecision = topYearShare;
    }
  }

  return {
    level: reachedLevel,
    candidates: Array.from(accumulated.values()),
    levelBreakdown,
    originLevelByRecordId,
    qualityGateActivated: qualityGateActive,
    qualityFloor,
    bestSimilarityAtActivation,
    topYearShareAtDecision,
  };
}
