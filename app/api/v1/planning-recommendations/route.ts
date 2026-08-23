import { NextRequest, NextResponse } from "next/server";
import { FestivalType, Region, VenueType } from "@/lib/domain/enums";
import { isTourApiEnabled } from "@/lib/external/tour-api";
import { isLocalStoryEnabled, localStoryProviderName } from "@/lib/external/local-story";
import { isLlmEnabled } from "@/lib/llm/plan-draft";
import { generateRecommendations } from "@/lib/planner/recommendation-engine";
import { loadPlannerCorpus } from "@/lib/planner/record-source";
import {
    IntegrationStatus,
    PlanningRecommendationRequest,
    PlanningRecommendationResponse,
} from "@/lib/planner/types";

export async function POST(request: NextRequest) {
    let body: PlanningRecommendationRequest;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ message: "요청 본문이 올바른 JSON 형식이 아닙니다." }, { status: 400 });
    }

    const { planningYear, regionCode, festivalType, venueType, durationDays, startMonth } = body;

    if (!regionCode || !festivalType || !venueType || !durationDays) {
        return NextResponse.json(
            { message: "regionCode, festivalType, venueType, durationDays는 필수 항목입니다." },
            { status: 400 }
        );
    }
    if (!Object.values(Region).includes(regionCode as Region)) {
        return NextResponse.json({ message: `유효하지 않은 지역 코드입니다: ${regionCode}` }, { status: 400 });
    }
    if (!Object.values(FestivalType).includes(festivalType as FestivalType)) {
        return NextResponse.json({ message: `유효하지 않은 축제 유형입니다: ${festivalType}` }, { status: 400 });
    }
    if (!Object.values(VenueType).includes(venueType as VenueType)) {
        return NextResponse.json({ message: `유효하지 않은 장소 유형입니다: ${venueType}` }, { status: 400 });
    }
    if (typeof durationDays !== "number" || durationDays < 1) {
        return NextResponse.json({ message: "durationDays는 1 이상의 숫자여야 합니다." }, { status: 400 });
    }
    if (startMonth !== undefined && (typeof startMonth !== "number" || startMonth < 1 || startMonth > 12)) {
        return NextResponse.json({ message: "startMonth는 1~12 사이의 숫자여야 합니다." }, { status: 400 });
    }
    if (typeof planningYear !== "number" || planningYear < 2000) {
        return NextResponse.json({ message: "planningYear는 유효한 연도여야 합니다." }, { status: 400 });
    }

    try {
        const corpus = await loadPlannerCorpus();
        if (corpus.records.length === 0) {
            return NextResponse.json(
                { message: "적재된 축제 데이터가 없습니다. 먼저 데이터를 임포트하세요." },
                { status: 503 }
            );
        }

        const engine = generateRecommendations({ request: body, all: corpus.records });
        const warnings = [...engine.warnings];

        // ── 외부 데이터 연동 상태 ─────────────────────────────────────────
        // 여기서는 "쓸 수 있는가"만 판정한다. TourAPI 상세 조회는 네트워크 왕복이
        // 필요하고 LLM 프롬프트에만 쓰이므로 plan-draft 라우트로 옮겼다.
        const tourApi: IntegrationStatus = isTourApiEnabled()
            ? { enabled: true, reason: null }
            : { enabled: false, reason: "TOUR_API_SERVICE_KEY가 설정되지 않았습니다." };

        // 지역 스토리도 LLM 프롬프트에만 쓰이므로 조회는 plan-draft 라우트가 한다.
        const localStory: IntegrationStatus = isLocalStoryEnabled()
            ? { enabled: true, reason: `출처: ${localStoryProviderName()}` }
            : { enabled: false, reason: "지역 스토리 제공자를 사용할 수 없습니다." };

        // ── LLM 가용 여부 ────────────────────────────────────────────────
        // 실제 생성은 POST /api/v1/planning-recommendations/plan-draft 가 담당한다.
        const llm: IntegrationStatus = !isLlmEnabled()
            ? { enabled: false, reason: "OPENAI_API_KEY가 설정되지 않았습니다." }
            : body.useLlm === false
              ? { enabled: false, reason: "요청에서 LLM 사용을 끄셨습니다." }
              : { enabled: true, reason: null };

        const response: PlanningRecommendationResponse = {
            planningYear,
            datasetYear: corpus.datasetYear,
            cohort: engine.cohort,
            recommendations: engine.recommendations,
            saturation: engine.saturation,
            monthDistribution: engine.monthDistribution,
            budgetEfficiency: engine.budgetEfficiency,
            whitespace: engine.whitespace,
            integrations: { tourApi, localStory, llm },
            warnings,
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error("[POST /api/v1/planning-recommendations]", error);
        return NextResponse.json({ message: "추천 생성 중 오류가 발생했습니다." }, { status: 500 });
    }
}
