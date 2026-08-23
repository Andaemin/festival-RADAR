import { NextRequest, NextResponse } from "next/server";
import { FESTIVAL_TYPE_DISPLAY, FestivalType, REGION_DISPLAY, Region, VenueType } from "@/lib/domain/enums";
import { enrichByFestivalName, isTourApiEnabled, type TourApiFestivalDetail } from "@/lib/external/tour-api";
import { isLocalStoryEnabled, searchLocalStories, type LocalStory } from "@/lib/external/local-story";
import { generatePlanDraft, isLlmEnabled } from "@/lib/llm/plan-draft";
import { generateRecommendations } from "@/lib/planner/recommendation-engine";
import { loadPlannerCorpus } from "@/lib/planner/record-source";
import { IntegrationStatus, PlanDraftResponse, PlanningRecommendationRequest } from "@/lib/planner/types";

/**
 * LLM 기획안 생성 전용 엔드포인트.
 *
 * 통계 계산은 15ms인데 LLM 호출은 수 초가 걸린다. 한 응답에 묶으면 화면 전체가
 * LLM을 기다리게 되므로 분리했다. 외부 API 조회(TourAPI 상세, 지역 스토리)도
 * 프롬프트 재료로만 쓰이므로 여기서 함께 수행한다.
 *
 * 추천 결과는 클라이언트에서 받지 않고 같은 요청 조건으로 다시 계산한다
 * (엔진이 15ms라 재계산이 큰 페이로드를 왕복시키는 것보다 싸고, 통계 응답과
 *  기획안이 같은 근거를 보게 되는 것도 보장된다).
 */
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
    if (
        !Object.values(Region).includes(regionCode as Region) ||
        !Object.values(FestivalType).includes(festivalType as FestivalType) ||
        !Object.values(VenueType).includes(venueType as VenueType)
    ) {
        return NextResponse.json({ message: "유효하지 않은 코드가 포함되어 있습니다." }, { status: 400 });
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

    const warnings: string[] = [];

    if (!isLlmEnabled()) {
        const llm: IntegrationStatus = { enabled: false, reason: "OPENAI_API_KEY가 설정되지 않았습니다." };
        return NextResponse.json({ llmPlan: null, llm, warnings } satisfies PlanDraftResponse);
    }

    try {
        const corpus = await loadPlannerCorpus();
        if (corpus.records.length === 0) {
            return NextResponse.json({ message: "적재된 축제 데이터가 없습니다." }, { status: 503 });
        }

        const engine = generateRecommendations({ request: body, all: corpus.records });

        // 외부 재료 수집은 서로 독립적이므로 병렬로 돌린다. 어느 쪽이 실패해도
        // 기획안 생성 자체는 진행한다(재료가 줄어들 뿐이다).
        const [tourApiDetails, localStories] = await Promise.all([
            collectTourApiDetails(engine.recommendations, regionCode as Region, planningYear, warnings),
            collectLocalStories(regionCode as Region, warnings),
        ]);

        const llmPlan = await generatePlanDraft({
            regionLabel: REGION_DISPLAY[regionCode as Region] ?? regionCode,
            typeLabel: FESTIVAL_TYPE_DISPLAY[festivalType as FestivalType] ?? festivalType,
            planningYear,
            recommendations: engine.recommendations,
            saturationMessage: engine.saturation?.message ?? null,
            medianCostPerVisitorKrw: engine.budgetEfficiency.medianCostPerVisitorKrw,
            tourApiDetails,
            localStories,
        });

        return NextResponse.json({
            llmPlan,
            llm: { enabled: true, reason: null },
            warnings,
        } satisfies PlanDraftResponse);
    } catch (error) {
        console.error("[POST /api/v1/planning-recommendations/plan-draft]", error);
        const reason = error instanceof Error ? error.message : String(error);
        return NextResponse.json({
            llmPlan: null,
            llm: { enabled: false, reason },
            warnings,
        } satisfies PlanDraftResponse);
    }
}

async function collectTourApiDetails(
    recommendations: ReturnType<typeof generateRecommendations>["recommendations"],
    region: Region,
    planningYear: number,
    warnings: string[]
): Promise<TourApiFestivalDetail[]> {
    if (!isTourApiEnabled()) return [];

    const names = recommendations.flatMap((r) => r.referenceFestivals.slice(0, 2).map((f) => f.festivalName));
    try {
        const enriched = await enrichByFestivalName([...new Set(names)], region, planningYear);
        return [...enriched.values()];
    } catch (e) {
        warnings.push(`TourAPI 조회에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
        return [];
    }
}

async function collectLocalStories(region: Region, warnings: string[]): Promise<LocalStory[]> {
    if (!isLocalStoryEnabled()) return [];

    try {
        const stories = await searchLocalStories(region);
        if (stories.length === 0) warnings.push("지역 스토리 제공자에서 관련 스토리를 찾지 못했습니다.");
        return stories;
    } catch (e) {
        warnings.push(`지역 스토리 조회에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
        return [];
    }
}
