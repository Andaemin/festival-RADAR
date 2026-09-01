import { MultiYearBudgetEstimateRequest } from "@/lib/multiyear/planning-api-types";
import type { EstimateBasis, RecommendationBasis, RangeBasis, DataQualityBasis } from "@/lib/multiyear-series/apply-planning-semantics";
import type { PlanningReliabilityReasonKey, PlanningReliabilityTier } from "@/lib/multiyear-series/reliability";
import type { ReliabilityBacktestSummary } from "@/lib/multiyear-series/reliability-backtest";
import type { SeriesSignalResponse } from "@/lib/multiyear-series/series-signal";
import type { SeriesSearchResult } from "@/lib/multiyear-series/series-search";
import type { SeriesHistoryDetailDto } from "@/lib/multiyear-series/series-history-detail";
import type {
    DataQualityAuditReason,
    DataQualityAuditSeverity,
    GlobalDataQualityAuditSummary,
    SeriesDataQualityAuditRecord,
    SeriesGroupDataQualitySummary,
} from "@/lib/multiyear-series/data-quality-audit";

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
    /** assistant-tester 진단용 — seriesSignal.status==="MATCHED"일 때만 채워진다(그 외 null).
     *  production 계산에는 관여하지 않는다(표시 전용). */
    seriesHistoryDetail: SeriesHistoryDetailDto | null;
    /** READ-ONLY DIAGNOSTIC(Series Data Quality Audit) — seriesSignal.status==="MATCHED"일 때만
     *  채워진다. severity/reasons는 "REVIEW_REQUIRED"를 뜻할 뿐 "DATA_ERROR_CONFIRMED"가 아니다 -
     *  production 계산(estimatedBudgetKrw 등)에는 관여하지 않는다(표시 전용). */
    seriesDataQualityAudit: SeriesGroupDataQualitySummary | null;
    /** PHASE 19-B — 신규 additive 필드. HIGH(=SERIES_STABLE)/MEDIUM(=SERIES_VOLATILE)/
     *  LOW(=PEER_FALLBACK) - legacy confidence/dataQualityV3와 완전히 독립적으로 계산된다
     *  (computePlanningReliability, lib/multiyear-series/reliability.ts). */
    reliabilityTier: PlanningReliabilityTier;
    /** reliabilityTier에 대응하는 사용자 설명 문구(Phase 18/19-B 확정 문구). */
    reliabilityReason: string;
    /** READ-ONLY DIAGNOSTIC(G0 이후 Reliability Revalidation) — seriesSignal.status==="MATCHED"일
     *  때만 채워진다. reasonKey/historicalDispersion/volatilityThreshold 전부 이미 계산된 값을
     *  그대로 노출할 뿐 production 계산에는 관여하지 않는다(표시 전용). */
    reliabilityDiagnostic: {
        reasonKey: PlanningReliabilityReasonKey;
        /** log(P75/P25) of CPI-adjusted historical budgets - historyCount<2면 null(정의 불가). */
        historicalDispersion: number | null;
        /** 이 planningYear의 leakage-safe calibration threshold - calibration 불가(pool<30)면 null. */
        volatilityThreshold: number | null;
    } | null;
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

/**
 * PHASE 2 — 기존 축제(Series) 검색 read-only API 클라이언트. 결과를 estimate 요청 DTO에
 * 되돌려 보낼 때도 `SeriesSearchResult.canonicalName`/`autoFill.regionCode`/`autoFill.district`처럼
 * 기존 `MultiYearBudgetEstimateRequest` 필드와 1:1 대응되는 값만 쓴다 - groupId 같은 내부
 * 식별자는 애초에 이 응답에 없다(series-search.ts 참고).
 */
export async function searchMultiYearSeries(params: { q: string; planningYear: number; limit?: number }): Promise<SeriesSearchResult[]> {
    const url = new URL("/api/v1/multiyear-series-search", window.location.origin);
    url.searchParams.set("q", params.q);
    url.searchParams.set("planningYear", String(params.planningYear));
    if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));

    const res = await fetch(url.pathname + url.search);
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.message ?? "축제 검색에 실패했습니다.");
    }

    return data.results;
}

export interface DataQualityAuditResponse {
    auditScope: {
        description: string;
        earliestDatasetYear: number;
        latestDatasetYear: number;
        dataRevision: number;
    };
    summary: GlobalDataQualityAuditSummary;
    anomalies: SeriesDataQualityAuditRecord[];
    matchedCount: number;
    returnedCount: number;
    helpText: string;
}

/**
 * READ-ONLY DIAGNOSTIC(Series Data Quality Audit) — `/assistant-tester` 전용 read-only client.
 * production 사용자 플로우는 이 함수를 호출하지 않는다. DB write 없음.
 */
export async function fetchDataQualityAudit(params: {
    severity?: DataQualityAuditSeverity | "ALL";
    reason?: DataQualityAuditReason;
    q?: string;
    limit?: number;
}): Promise<DataQualityAuditResponse> {
    const url = new URL("/api/v1/data-quality-audit", window.location.origin);
    if (params.severity !== undefined) url.searchParams.set("severity", params.severity);
    if (params.reason !== undefined) url.searchParams.set("reason", params.reason);
    if (params.q !== undefined && params.q !== "") url.searchParams.set("q", params.q);
    if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));

    const res = await fetch(url.pathname + url.search);
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.message ?? "데이터 품질 감사 조회에 실패했습니다.");
    }

    return data;
}

export interface ReliabilityAuditResponse {
    dataRevision: number;
    summary: ReliabilityBacktestSummary;
    helpText: string;
}

/**
 * READ-ONLY DIAGNOSTIC(G0 이후 Reliability Revalidation) — `/assistant-tester` 전용 read-only
 * client. leakage-safe 2024~2026 fold backtest 사후 집계를 그대로 돌려받는다. production
 * 사용자 플로우는 이 함수를 호출하지 않는다. DB write 없음. reliability tier 판정식 자체는
 * 전혀 바꾸지 않는다.
 */
export async function fetchReliabilityAudit(): Promise<ReliabilityAuditResponse> {
    const res = await fetch("/api/v1/reliability-audit");
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.message ?? "Reliability 감사 조회에 실패했습니다.");
    }

    return data;
}
