import { NextRequest, NextResponse } from "next/server";
import { FESTIVAL_TYPE_DISPLAY, FestivalType, REGION_DISPLAY, Region, VenueType } from "@/lib/domain/enums";
import { enrichByFestivalName, isTourApiEnabled, type TourApiFestivalDetail } from "@/lib/external/tour-api";
import { isRegionalCultureEnabled, searchLocalStories } from "@/lib/external/regional-culture";
import { generatePlanDraft, isLlmEnabled } from "@/lib/llm/plan-draft";
import { generateRecommendations } from "@/lib/planner/recommendation-engine";
import { loadPlannerCorpus } from "@/lib/planner/record-source";
import {
    IntegrationStatus,
    LlmPlanDraft,
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

        // ── 외부 데이터 연동 (키가 없으면 조용히 건너뛴다) ────────────────
        const tourApi: IntegrationStatus = isTourApiEnabled()
            ? { enabled: true, reason: null }
            : { enabled: false, reason: "TOUR_API_SERVICE_KEY가 설정되지 않았습니다." };

        let tourApiDetails: TourApiFestivalDetail[] = [];
        if (tourApi.enabled) {
            const names = engine.recommendations.flatMap((r) =>
                r.referenceFestivals.slice(0, 2).map((f) => f.festivalName)
            );
            try {
                const enriched = await enrichByFestivalName(
                    [...new Set(names)],
                    regionCode as Region,
                    planningYear
                );
                tourApiDetails = [...enriched.values()];
            } catch (e) {
                tourApi.enabled = false;
                tourApi.reason = e instanceof Error ? e.message : String(e);
                warnings.push(`TourAPI 조회에 실패했습니다: ${tourApi.reason}`);
            }
        }

        const regionalCulture: IntegrationStatus = isRegionalCultureEnabled()
            ? { enabled: true, reason: null }
            : { enabled: false, reason: "REGIONAL_CULTURE_SERVICE_KEY / BASE_URL이 설정되지 않았습니다." };

        if (regionalCulture.enabled) {
            try {
                // 지역 설화·향토자산은 추천 카드의 스토리 근거로만 쓰므로 실패해도 무시한다.
                const stories = await searchLocalStories(REGION_DISPLAY[regionCode as Region] ?? regionCode);
                if (stories.length === 0) {
                    warnings.push("지역N문화 API에서 관련 스토리를 찾지 못했습니다.");
                }
            } catch (e) {
                regionalCulture.enabled = false;
                regionalCulture.reason = e instanceof Error ? e.message : String(e);
            }
        }

        // ── LLM 기획안 (선택) ─────────────────────────────────────────────
        let llm: IntegrationStatus = isLlmEnabled()
            ? { enabled: true, reason: null }
            : { enabled: false, reason: "OPENAI_API_KEY가 설정되지 않았습니다." };
        let llmPlan: LlmPlanDraft | null = null;

        if (body.useLlm === false) {
            llm = { enabled: false, reason: "요청에서 LLM 사용을 끄셨습니다." };
        } else if (llm.enabled) {
            try {
                llmPlan = await generatePlanDraft({
                    regionLabel: REGION_DISPLAY[regionCode as Region] ?? regionCode,
                    typeLabel: FESTIVAL_TYPE_DISPLAY[festivalType as FestivalType] ?? festivalType,
                    planningYear,
                    recommendations: engine.recommendations,
                    saturationMessage: engine.saturation?.message ?? null,
                    medianCostPerVisitorKrw: engine.budgetEfficiency.medianCostPerVisitorKrw,
                    tourApiDetails,
                });
            } catch (e) {
                llm = { enabled: false, reason: e instanceof Error ? e.message : String(e) };
                warnings.push(`LLM 기획안 생성에 실패했습니다: ${llm.reason}`);
            }
        }

        const response: PlanningRecommendationResponse = {
            planningYear,
            datasetYear: corpus.datasetYear,
            cohort: engine.cohort,
            recommendations: engine.recommendations,
            saturation: engine.saturation,
            monthDistribution: engine.monthDistribution,
            budgetEfficiency: engine.budgetEfficiency,
            whitespace: engine.whitespace,
            integrations: { tourApi, regionalCulture, llm },
            llmPlan,
            warnings,
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error("[POST /api/v1/planning-recommendations]", error);
        return NextResponse.json({ message: "추천 생성 중 오류가 발생했습니다." }, { status: 500 });
    }
}
