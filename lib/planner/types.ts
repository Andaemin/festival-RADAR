import { FestivalType, Region, VenueType } from "@/lib/domain/enums";

/** 추천 엔진이 사용하는 축제 1건의 경량 표현. FestivalRecord에서 필요한 필드만 뽑는다. */
export interface PlannerRecord {
    id: number;
    festivalName: string;
    region: Region;
    district: string | null;
    festivalType: FestivalType;
    venueType: VenueType;
    startMonth: number | null;
    durationDays: number | null;
    totalBudgetKrw: number | null;
    visitors: number | null;
    /** 축제명에서 추출한 소재 토큰. keyword-mining이 채운다. */
    keywords: string[];
}

export interface PlanningRecommendationRequest {
    planningYear: number;
    regionCode: string;
    district?: string;
    festivalType: string;
    venueType: string;
    durationDays: number;
    /** 희망 개최월(1~12). 미지정이면 시기 추천을 엔진이 직접 고른다. */
    startMonth?: number;
    /** LLM 기획안 생성 여부. 서버에 OPENAI_API_KEY가 없으면 무시된다. */
    useLlm?: boolean;
}

/** 추천 근거로 제시하는 실제 축제 1건. 수치는 모두 DB 실측값이다. */
export interface ReferenceFestival {
    festivalName: string;
    regionLabel: string;
    district: string | null;
    festivalTypeLabel: string;
    venueTypeLabel: string;
    startMonth: number | null;
    durationDays: number | null;
    totalBudgetKrw: number | null;
    visitors: number | null;
    costPerVisitorKrw: number | null;
}

export type RecommendationKind =
    | "VENUE_SHIFT"
    | "TIMING_SHIFT"
    | "KEYWORD_MASHUP"
    | "DURATION_TUNE"
    | "BUDGET_EFFICIENCY";

export interface Recommendation {
    id: string;
    kind: RecommendationKind;
    title: string;
    summary: string;
    /** 사람이 읽는 근거 문장. 각 문장은 evidence의 수치에서 파생된다. */
    rationale: string[];
    /** 0~100. 코호트 근거량과 차별화 정도를 함께 반영한다. */
    opportunityScore: number;
    referenceFestivals: ReferenceFestival[];
}

/** 시기·지역 포화도 경고 1건. */
export interface SaturationWarning {
    month: number;
    competingCount: number;
    sameTypeCompetingCount: number;
    /** LOW / MEDIUM / HIGH */
    level: "LOW" | "MEDIUM" | "HIGH";
    message: string;
}

export interface MonthDistributionEntry {
    month: number;
    nationalCount: number;
    regionCount: number;
    regionSameTypeCount: number;
}

export interface BudgetEfficiencySummary {
    /** 유사 코호트의 1인당 투입비 중앙값 */
    medianCostPerVisitorKrw: number | null;
    /** 하위 25% (효율이 좋은 쪽) 경계 */
    p25CostPerVisitorKrw: number | null;
    p75CostPerVisitorKrw: number | null;
    sampleCount: number;
    /** 저비용·고방문 상위 사례 */
    topEfficient: ReferenceFestival[];
}

export interface WhitespaceAxisEntry {
    value: string;
    label: string;
    nationalCount: number;
    regionCount: number;
    /** 0~1. 전국 근거 대비 지역 내 희소성. */
    opportunityScore: number;
}

export interface WhitespaceReport {
    venue: WhitespaceAxisEntry[];
    month: WhitespaceAxisEntry[];
    keyword: WhitespaceAxisEntry[];
    durationBucket: WhitespaceAxisEntry[];
}

export interface CohortSummary {
    /** 전국 동일 유형 */
    nationalSameType: number;
    /** 해당 지역 전체 */
    region: number;
    /** 해당 지역 동일 유형 */
    regionSameType: number;
    /** 해당 지역 동일 유형·동일 장소 */
    regionSameTypeSameVenue: number;
}

/** LLM이 덧붙인 기획안. 수치는 만들지 않고 evidence를 서술로 옮기기만 한다. */
export interface LlmPlanDraft {
    model: string;
    concept: string;
    programIdeas: string[];
    differentiationPoints: string[];
    cautions: string[];
}

export interface PlanningRecommendationResponse {
    planningYear: number;
    datasetYear: number;
    cohort: CohortSummary;
    recommendations: Recommendation[];
    saturation: SaturationWarning | null;
    monthDistribution: MonthDistributionEntry[];
    budgetEfficiency: BudgetEfficiencySummary;
    whitespace: WhitespaceReport;
    /** 외부 데이터/LLM 연동 상태. UI가 "왜 이 섹션이 비었는지" 설명하는 데 쓴다. */
    integrations: {
        tourApi: IntegrationStatus;
        localStory: IntegrationStatus;
        llm: IntegrationStatus;
    };
    llmPlan: LlmPlanDraft | null;
    warnings: string[];
}

export interface IntegrationStatus {
    enabled: boolean;
    /** 비활성 사유 또는 오류 메시지. enabled=true면 null. */
    reason: string | null;
}
