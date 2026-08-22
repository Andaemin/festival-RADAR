import type {
    PlanDraftResponse,
    PlanningRecommendationRequest,
    PlanningRecommendationResponse,
} from "@/lib/planner/types";

export type { PlanDraftResponse, PlanningRecommendationRequest, PlanningRecommendationResponse };

export async function fetchPlanningRecommendations(
    body: PlanningRecommendationRequest
): Promise<PlanningRecommendationResponse> {
    const res = await fetch("/api/v1/planning-recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.message ?? "추천을 가져오지 못했습니다.");
    }

    return data;
}

/**
 * LLM 기획안을 별도로 요청한다.
 *
 * 통계는 즉시(수십 ms) 나오는데 LLM은 수 초가 걸리므로, 화면이 통계를 먼저 그리고
 * 기획안은 뒤따라 채우도록 엔드포인트를 나눴다.
 */
export async function fetchPlanDraft(
    body: PlanningRecommendationRequest
): Promise<PlanDraftResponse> {
    const res = await fetch("/api/v1/planning-recommendations/plan-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.message ?? "AI 기획안을 가져오지 못했습니다.");
    }

    return data;
}
