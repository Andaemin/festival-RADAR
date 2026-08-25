import { FestivalType, Region, VenueType } from "@/lib/domain/enums";
import type { VisitorProfile } from "@/lib/external/visitor-stats";

export type { VisitorProfile };

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
    /**
     * 코퍼스가 실제로 포괄하는 연도 범위 [최소, 최대].
     * 코퍼스가 2017~2026 다년도로 바뀐 뒤, 화면이 "2026년 기준"이라고만 말하면
     * 사실과 다르다. 표시 문구가 이 값을 쓴다.
     */
    datasetYearRange: [number, number];
    cohort: CohortSummary;
    recommendations: Recommendation[];
    saturation: SaturationWarning | null;
    monthDistribution: MonthDistributionEntry[];
    budgetEfficiency: BudgetEfficiencySummary;
    whitespace: WhitespaceReport;
    /** 외부 데이터/LLM 연동 상태. UI가 "왜 이 섹션이 비었는지" 설명하는 데 쓴다. */
    integrations: {
        tourApi: IntegrationStatus;
        /** 전국문화축제표준데이터(지자체 등록 원장). 개최장소·기간·주최기관을 준다. */
        festivalStandard: IntegrationStatus;
        localStory: IntegrationStatus;
        /** LLM 기획안을 이어서 요청할 수 있는지. 실제 생성은 별도 엔드포인트가 담당한다. */
        llm: IntegrationStatus;
    };
    warnings: string[];
}

/**
 * LLM 기획안 응답. 통계 응답과 분리된 엔드포인트가 반환한다.
 *
 * 통계 계산은 15ms인데 LLM은 수 초가 걸린다. 한 응답에 묶으면 화면 전체가 LLM을
 * 기다리게 되므로, 통계를 먼저 그리고 기획안은 뒤따라 채우도록 분리했다.
 */
export interface PlanDraftResponse {
    llmPlan: LlmPlanDraft | null;
    llm: IntegrationStatus;
    /**
     * 통신사 실측 방문자 프로필. LLM이 만든 값이 아니라 API 집계값이다.
     * 외부 API 호출이 필요해 통계 응답이 아닌 이쪽에 함께 실어 보낸다.
     */
    visitorProfile: VisitorProfile | null;
    /**
     * 참고 축제의 실제 개최 정보(전국문화축제표준데이터). 축제명 -> 정보.
     * 통계 응답은 22ms인데 이 조회는 외부 API가 필요해, 기획안과 함께 뒤따라 보낸다.
     */
    festivalVenues: Record<string, FestivalVenueInfo>;
    warnings: string[];
}

/** 근거 축제 표에 덧붙이는 실제 개최 장소·기간. DB에는 없고 표준데이터에서 온다. */
export interface FestivalVenueInfo {
    venue: string | null;
    /** YYYY-MM-DD */
    startDate: string | null;
    endDate: string | null;
}

export interface IntegrationStatus {
    enabled: boolean;
    /** 비활성 사유 또는 오류 메시지. enabled=true면 null. */
    reason: string | null;
}
