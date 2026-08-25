import { MultiYearBudgetEstimateRequest } from "@/lib/multiyear/planning-api-types";
import type { EstimateBasis, RecommendationBasis, RangeBasis, DataQualityBasis } from "@/lib/multiyear-series/apply-planning-semantics";
import type { PlanningReliabilityTier } from "@/lib/multiyear-series/reliability";
import type { SeriesSignalResponse } from "@/lib/multiyear-series/series-signal";

export interface MultiYearYearWeightShareDto {
    year: number;
    candidateCount: number;
    weightShare: number;
}

export interface MultiYearPredictionCandidateDto {
    sourceYear: number;
    festivalName: string;
    region: string | null;
    district: string | null;
    festivalType: string;
    venueType: string | null;
    durationDays: number | null;
    originalBudgetKrw: number;
    durationAdjustedBudgetKrw: number;
    similarity: number;
    finalWeight: number;
    fallbackStage: string | null;
}

export interface MultiYearBudgetEstimateResponse {
    model: string;
    planningYear: number;
    requestedReferenceDataPolicy: string;
    appliedReferenceDataPolicy: string;
    referenceYearFrom: number;
    referenceYearTo: number;
    /** referencePool(선택 이전) 실제 datasetYear 범위 - "참조 대상 데이터". referenceYearTo(정책상
     *  허용 상한)와 다를 수 있다(보유 데이터가 정책 허용 범위보다 짧을 때). */
    referencePoolEarliestYear: number | null;
    referencePoolLatestYear: number | null;
    estimatedBudgetKrw: number;
    weightedAverageBudgetKrw: number;
    recommendedBudgetKrw: number;
    p25Krw: number;
    p50Krw: number;
    p60Krw: number;
    p75Krw: number;
    sampleCount: number;
    distinctYearsUsed: number;
    effectiveYearCount: number;
    earliestSourceYear: number | null;
    latestSourceYear: number | null;
    fallbackLevel: string;
    averageSimilarity: number;
    /** legacy(v1.0) 신뢰도 지표 - PHASE 19-A부터 recommendation 계산에 쓰이지 않는다(하위 호환을
     *  위해 필드/계산은 유지). 사용자 신뢰도 표시에는 아래 reliabilityTier/reliabilityReason을
     *  쓴다 - 이 값과 섞어 쓰지 않는다. */
    dataQualityV3: number;
    yearWeightBreakdown: MultiYearYearWeightShareDto[];
    topCandidates: MultiYearPredictionCandidateDto[];
    /** PHASE 9C-C — festivalName이 없거나 series를 쓸 수 없으면 항상 PEER_SIMILARITY/PEER_PLANNING이고
     *  이때 estimatedBudgetKrw/recommendedBudgetKrw는 이 필드가 생기기 전과 100% 동일한 값이다.
     *  PHASE 19-A부터 SERIES_HISTORY_WITH_FIXED_BUFFER는 고정 +5% buffer를 뜻한다(더 이상
     *  confidence-derived contingency가 아니다 - apply-planning-semantics.ts 참고). */
    estimateBasis: EstimateBasis;
    recommendationBasis: RecommendationBasis;
    rangeBasis: RangeBasis;
    dataQualityBasis: DataQualityBasis;
    /** PHASE 9C-A — festivalName 미입력 시 항상 { status: "NOT_REQUESTED" }. */
    seriesSignal: SeriesSignalResponse;
    /** PHASE 19-B — 신규 additive 필드. HIGH(=SERIES_STABLE)/MEDIUM(=SERIES_VOLATILE)/
     *  LOW(=PEER_FALLBACK) - legacy confidence/dataQualityV3와 완전히 독립적으로 계산된다
     *  (computePlanningReliability, lib/multiyear-series/reliability.ts). */
    reliabilityTier: PlanningReliabilityTier;
    /** reliabilityTier에 대응하는 사용자 설명 문구(Phase 18/19-B 확정 문구). */
    reliabilityReason: string;
}

export async function estimateMultiYearBudget(body: MultiYearBudgetEstimateRequest): Promise<MultiYearBudgetEstimateResponse> {
    const res = await fetch("/api/v1/multiyear-budget-estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.message ?? "다년도 계획예산 추정에 실패했습니다.");
    }

    return data;
}
