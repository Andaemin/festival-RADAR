import { MultiYearBudgetEstimateRequest } from "@/lib/multiyear/planning-api-types";

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
    dataQualityV3: number;
    yearWeightBreakdown: MultiYearYearWeightShareDto[];
    topCandidates: MultiYearPredictionCandidateDto[];
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
