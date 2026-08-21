import type {
    PlanningRecommendationRequest,
    PlanningRecommendationResponse,
} from "@/lib/planner/types";

export type { PlanningRecommendationRequest, PlanningRecommendationResponse };

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
