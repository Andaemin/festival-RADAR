import { FESTIVAL_TYPE_DISPLAY, FestivalType, REGION_DISPLAY, Region, VENUE_TYPE_DISPLAY, VenueType } from "@/lib/domain/enums";
import { summarizeBudgetEfficiency } from "./budget-efficiency";
import { toReferenceFestival } from "./reference";
import { buildMonthDistribution, evaluateSaturation, findLeastSaturatedMonths } from "./saturation";
import {
    CohortSummary,
    PlannerRecord,
    PlanningRecommendationRequest,
    Recommendation,
    WhitespaceAxisEntry,
} from "./types";
import { DURATION_BUCKETS, analyzeWhitespace, durationBucketOf } from "./whitespace";

/** 근거 축제는 카드당 이만큼만 보여준다. */
const REFERENCE_LIMIT = 4;

function pct(score: number): number {
    return Math.round(Math.min(1, Math.max(0, score)) * 100);
}

function byVisitorsDesc(a: PlannerRecord, b: PlannerRecord): number {
    return (b.visitors ?? 0) - (a.visitors ?? 0);
}

export interface EngineInput {
    request: PlanningRecommendationRequest;
    all: PlannerRecord[];
}

export interface EngineOutput {
    cohort: CohortSummary;
    recommendations: Recommendation[];
    saturation: ReturnType<typeof evaluateSaturation>;
    monthDistribution: ReturnType<typeof buildMonthDistribution>;
    budgetEfficiency: ReturnType<typeof summarizeBudgetEfficiency>;
    whitespace: ReturnType<typeof analyzeWhitespace>;
    warnings: string[];
}

export function generateRecommendations({ request, all }: EngineInput): EngineOutput {
    const region = request.regionCode as Region;
    const festivalType = request.festivalType as FestivalType;
    const venueType = request.venueType as VenueType;

    const regionLabel = REGION_DISPLAY[region] ?? request.regionCode;
    const typeLabel = FESTIVAL_TYPE_DISPLAY[festivalType] ?? request.festivalType;

    const nationalSameType = all.filter((r) => r.festivalType === festivalType);
    const inRegion = all.filter((r) => r.region === region);
    const regionSameType = inRegion.filter((r) => r.festivalType === festivalType);

    const cohort: CohortSummary = {
        nationalSameType: nationalSameType.length,
        region: inRegion.length,
        regionSameType: regionSameType.length,
        regionSameTypeSameVenue: regionSameType.filter((r) => r.venueType === venueType).length,
    };

    const warnings: string[] = [];
    if (cohort.nationalSameType < 10) {
        warnings.push(
            `전국 ${typeLabel} 축제 표본이 ${cohort.nationalSameType}건뿐입니다. 추천 근거가 약할 수 있습니다.`
        );
    }
    if (cohort.regionSameType === 0) {
        warnings.push(
            `${regionLabel}에는 ${typeLabel} 축제 사례가 없습니다. 지역 대비 차별화가 아니라 전국 사례 기준으로만 추천합니다.`
        );
    }

    const whitespace = analyzeWhitespace({ national: nationalSameType, region: regionSameType });
    const monthDistribution = buildMonthDistribution(all, region, festivalType);
    const budgetEfficiency = summarizeBudgetEfficiency(
        regionSameType.length >= 8 ? regionSameType : nationalSameType
    );

    const targetMonth = request.startMonth ?? null;
    const saturation = targetMonth ? evaluateSaturation(monthDistribution, targetMonth) : null;

    const recommendations: Recommendation[] = [];

    // ── 1. 장소 전환형 ────────────────────────────────────────────────────
    const venueCandidate = whitespace.venue.find((v) => v.value !== venueType);
    if (venueCandidate) {
        const proof = nationalSameType
            .filter((r) => r.venueType === venueCandidate.value)
            .sort(byVisitorsDesc)
            .slice(0, REFERENCE_LIMIT);

        recommendations.push({
            id: `venue-${venueCandidate.value}`,
            kind: "VENUE_SHIFT",
            title: `장소를 ${venueCandidate.label}으로 바꿔보세요`,
            summary: `전국 ${typeLabel} 축제 중 ${venueCandidate.nationalCount}건이 ${venueCandidate.label} 장소에서 열리지만, ${regionLabel}의 ${typeLabel} 축제 중에는 ${venueCandidate.regionCount}건뿐입니다.`,
            rationale: [
                `선택하신 장소는 ${VENUE_TYPE_DISPLAY[venueType] ?? venueType}이고, ${regionLabel} 내 같은 유형·같은 장소 축제가 이미 ${cohort.regionSameTypeSameVenue}건 있습니다.`,
                `${venueCandidate.label}은 전국 사례 ${venueCandidate.nationalCount}건으로 성립 가능성이 확인된 형태입니다.`,
                `${regionLabel} 내 ${typeLabel} 축제 ${cohort.regionSameType}건 중 ${venueCandidate.regionCount}건만 이 장소를 씁니다.`,
            ],
            opportunityScore: pct(venueCandidate.opportunityScore),
            referenceFestivals: proof.map(toReferenceFestival),
        });
    }

    // ── 2. 시기 이동형 ────────────────────────────────────────────────────
    const quietMonths = findLeastSaturatedMonths(monthDistribution, 3);
    const quiet = quietMonths.find((m) => m.month !== targetMonth) ?? quietMonths[0];
    if (quiet) {
        const proof = nationalSameType
            .filter((r) => r.startMonth === quiet.month)
            .sort(byVisitorsDesc)
            .slice(0, REFERENCE_LIMIT);

        const currentText = targetMonth
            ? `희망하신 ${targetMonth}월은 ${regionLabel} 동일 유형 ${
                  monthDistribution.find((d) => d.month === targetMonth)?.regionSameTypeCount ?? 0
              }건입니다.`
            : `개최월을 아직 정하지 않으셨습니다.`;

        recommendations.push({
            id: `timing-${quiet.month}`,
            kind: "TIMING_SHIFT",
            title: `${quiet.month}월 개최를 검토하세요`,
            summary: `${regionLabel}의 ${typeLabel} 축제 기준으로 ${quiet.month}월은 경쟁이 ${quiet.regionSameTypeCount}건으로 가장 적습니다. 전국적으로는 ${quiet.nationalCount}건이 열려 비수기가 아닌 것도 확인됩니다.`,
            rationale: [
                currentText,
                `${quiet.month}월 ${regionLabel} 전체 축제는 ${quiet.regionCount}건, 그중 ${typeLabel}은 ${quiet.regionSameTypeCount}건입니다.`,
                `전국 ${quiet.month}월 개최 축제가 ${quiet.nationalCount}건이므로, 관객이 없는 시기가 아니라 이 지역에서만 비어 있는 시기입니다.`,
            ],
            opportunityScore: pct(
                1 - quiet.regionSameTypeCount / Math.max(1, cohort.regionSameType)
            ),
            referenceFestivals: proof.map(toReferenceFestival),
        });
    }

    // ── 3. 소재 결합형 (매시업) ───────────────────────────────────────────
    const importedKeyword: WhitespaceAxisEntry | undefined = whitespace.keyword.find(
        (k) => k.regionCount === 0
    );
    if (importedKeyword) {
        // 지역 정체성 키워드: 유형과 무관하게 이 지역에서 가장 자주 쓰이는 소재.
        const localCounts = new Map<string, number>();
        for (const r of inRegion) {
            for (const k of r.keywords) localCounts.set(k, (localCounts.get(k) ?? 0) + 1);
        }
        const localKeyword = [...localCounts.entries()]
            .filter(([k]) => k !== importedKeyword.value)
            .sort((a, b) => b[1] - a[1])[0];

        const proof = nationalSameType
            .filter((r) => r.keywords.includes(importedKeyword.value))
            .sort(byVisitorsDesc)
            .slice(0, REFERENCE_LIMIT);

        const mashupTitle = localKeyword
            ? `"${localKeyword[0]}" × "${importedKeyword.value}" 결합을 시도해보세요`
            : `"${importedKeyword.value}" 소재를 들여오세요`;

        recommendations.push({
            id: `keyword-${importedKeyword.value}`,
            kind: "KEYWORD_MASHUP",
            title: mashupTitle,
            summary: localKeyword
                ? `"${importedKeyword.value}"은 전국 ${typeLabel} 축제 ${importedKeyword.nationalCount}건에서 쓰이지만 ${regionLabel} ${typeLabel} 축제에는 한 건도 없습니다. ${regionLabel}에서 가장 많이 쓰인 소재 "${localKeyword[0]}"(${localKeyword[1]}건)과 결합하면 지역성과 새로움을 동시에 잡을 수 있습니다.`
                : `"${importedKeyword.value}"은 전국 ${typeLabel} 축제 ${importedKeyword.nationalCount}건에서 쓰이지만 ${regionLabel}에는 사례가 없습니다.`,
            rationale: [
                `축제명 ${cohort.nationalSameType}건을 분석해 추출한 소재 태그 기준입니다.`,
                `"${importedKeyword.value}" 전국 사용 ${importedKeyword.nationalCount}건 / ${regionLabel} 사용 ${importedKeyword.regionCount}건.`,
                ...(localKeyword
                    ? [`"${localKeyword[0]}"은 ${regionLabel} 축제 ${localKeyword[1]}건에서 이미 검증된 지역 소재입니다.`]
                    : []),
            ],
            opportunityScore: pct(importedKeyword.opportunityScore),
            referenceFestivals: proof.map(toReferenceFestival),
        });
    }

    // ── 4. 기간 조정형 ────────────────────────────────────────────────────
    const currentBucket = durationBucketOf(request.durationDays);
    const durationCandidate = whitespace.durationBucket.find((d) => d.value !== currentBucket);
    if (durationCandidate) {
        const proof = nationalSameType
            .filter((r) => durationBucketOf(r.durationDays) === durationCandidate.value)
            .sort(byVisitorsDesc)
            .slice(0, REFERENCE_LIMIT);

        const currentLabel =
            DURATION_BUCKETS.find((b) => b.key === currentBucket)?.label ?? `${request.durationDays}일`;

        recommendations.push({
            id: `duration-${durationCandidate.value}`,
            kind: "DURATION_TUNE",
            title: `개최 기간을 ${durationCandidate.label}로 조정해보세요`,
            summary: `현재 계획은 ${currentLabel}입니다. ${regionLabel} ${typeLabel} 축제 중 ${durationCandidate.label} 사례는 ${durationCandidate.regionCount}건으로, 전국 ${durationCandidate.nationalCount}건에 비해 드뭅니다.`,
            rationale: [
                `전국 ${typeLabel} 축제 중 ${durationCandidate.nationalCount}건이 ${durationCandidate.label}입니다.`,
                `${regionLabel}에서는 ${durationCandidate.regionCount}건에 그칩니다.`,
                `기간은 예산·인력과 직결되므로, 아래 근거 축제의 예산 규모를 함께 확인하세요.`,
            ],
            opportunityScore: pct(durationCandidate.opportunityScore),
            referenceFestivals: proof.map(toReferenceFestival),
        });
    }

    // ── 5. 예산 효율 벤치마크 ─────────────────────────────────────────────
    if (budgetEfficiency.medianCostPerVisitorKrw !== null && budgetEfficiency.topEfficient.length > 0) {
        const median = budgetEfficiency.medianCostPerVisitorKrw;
        recommendations.push({
            id: "budget-efficiency",
            kind: "BUDGET_EFFICIENCY",
            title: `1인당 투입비 ${median.toLocaleString("ko-KR")}원을 기준선으로 잡으세요`,
            summary: `비교 코호트 ${budgetEfficiency.sampleCount}건의 1인당 투입비 중앙값입니다. 아래는 방문객이 중앙값 이상이면서 투입비가 가장 낮았던 축제입니다.`,
            rationale: [
                `1인당 투입비 = 총예산 ÷ 직전 방문객 수. 표본 ${budgetEfficiency.sampleCount}건.`,
                `하위 25%는 ${budgetEfficiency.p25CostPerVisitorKrw?.toLocaleString("ko-KR")}원, 상위 25%는 ${budgetEfficiency.p75CostPerVisitorKrw?.toLocaleString("ko-KR")}원입니다.`,
                `방문객 수는 집계 방식(실측/추산)이 축제마다 달라 절대 비교보다 자릿수 감각으로 쓰는 편이 안전합니다.`,
            ],
            opportunityScore: 0,
            referenceFestivals: budgetEfficiency.topEfficient,
        });
    }

    return {
        cohort,
        recommendations: recommendations.sort((a, b) => b.opportunityScore - a.opportunityScore),
        saturation,
        monthDistribution,
        budgetEfficiency,
        whitespace,
        warnings,
    };
}
