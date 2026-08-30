import { FESTIVAL_TYPE_DISPLAY, FestivalType, REGION_DISPLAY, Region, VENUE_TYPE_DISPLAY, VenueType } from "@/lib/domain/enums";
import { summarizeBudgetEfficiency } from "./budget-efficiency";
import { toReferenceFestival } from "./reference";
import { activeSinceYear, buildMonthDistribution, evaluateSaturation, findLeastSaturatedMonths } from "./saturation";
import { buildKeywordSeasonality, describeSeason, fitsMonth } from "./seasonality";
import { ClimateNormals, describeMonthClimate } from "./climate-normals";
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
    /**
     * 코퍼스가 포괄하는 연도 범위 [최소, 최대]. 카드 문구에 집계 범위를 밝히는 데만 쓴다.
     * "이미 162건 있습니다"는 그 162건이 10년치라는 사실을 숨긴다.
     */
    datasetYearRange: [number, number];
    /**
     * 기상청 30년 평년값. 시기 카드에 기후 경고를 덧붙이는 데만 쓴다.
     * 없으면 경고 문장이 빠질 뿐 추천은 그대로 나온다(./climate-normals.ts).
     */
    climate?: ClimateNormals;
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

export function generateRecommendations({ request, all, datasetYearRange, climate }: EngineInput): EngineOutput {
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

    // 화이트스페이스는 "이런 형태가 성립하는가"를 묻는 것이라 코퍼스 전체를 본다.
    // 포화도·월별 분포만 최근성 창으로 좁힌다(./saturation.ts의 ACTIVE_WINDOW_YEARS).
    const whitespace = analyzeWhitespace({ national: nationalSameType, region: regionSameType });
    // 소재의 제철. 시기 카드와 소재 카드가 어긋나지 않게 하는 데 쓴다(./seasonality.ts).
    const seasonality = buildKeywordSeasonality(all);
    const activeSince = activeSinceYear(all);
    const monthDistribution = buildMonthDistribution(all, region, festivalType, activeSince);
    const budgetEfficiency = summarizeBudgetEfficiency(
        regionSameType.length >= 8 ? regionSameType : nationalSameType
    );

    const targetMonth = request.startMonth ?? null;
    const saturation = targetMonth ? evaluateSaturation(monthDistribution, targetMonth, activeSince) : null;
    /** 코호트 건수 문구에 붙이는 집계 범위. 포화도의 3개년 창과 혼동되지 않게 항상 밝힌다. */
    const corpusScope = `${datasetYearRange[0]}~${datasetYearRange[1]}년`;
    /** 포화도·시기 카드가 쓰는 최근성 창. */
    const activeScope = `최근 ${datasetYearRange[1] - activeSince + 1}개 연도(${activeSince}~${datasetYearRange[1]}년)`;

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
            summary: `${corpusScope} 전국 ${typeLabel} 축제 중 ${venueCandidate.nationalCount}건이 ${venueCandidate.label} 장소에서 열렸지만, ${regionLabel}의 ${typeLabel} 축제 중에는 ${venueCandidate.regionCount}건뿐입니다.`,
            rationale: [
                `선택하신 장소는 ${VENUE_TYPE_DISPLAY[venueType] ?? venueType}이고, ${corpusScope} ${regionLabel}에서 같은 유형·같은 장소로 열린 축제가 ${cohort.regionSameTypeSameVenue}건입니다.`,
                `${venueCandidate.label}은 전국 사례 ${venueCandidate.nationalCount}건으로 성립 가능성이 확인된 형태입니다.`,
                `${corpusScope} ${regionLabel} ${typeLabel} 축제 ${cohort.regionSameType}건 중 ${venueCandidate.regionCount}건만 이 장소를 씁니다.`,
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
            ? `희망하신 ${targetMonth}월은 ${activeScope} 기준 ${regionLabel} 동일 유형 ${
                  monthDistribution.find((d) => d.month === targetMonth)?.regionSameTypeCount ?? 0
              }건입니다.`
            : `개최월을 아직 정하지 않으셨습니다.`;

        recommendations.push({
            id: `timing-${quiet.month}`,
            kind: "TIMING_SHIFT",
            title: `${quiet.month}월 개최를 검토하세요`,
            summary: `${activeScope} 기준으로 ${quiet.month}월은 전국 축제의 ${(quiet.nationalShare * 100).toFixed(1)}%가 열리는 시기인데, ${regionLabel}의 ${typeLabel} 축제는 ${quiet.regionSameTypeCount}건뿐입니다. 전국 계절 흐름대로라면 ${Math.round(quiet.expectedCount)}건쯤 있었을 자리입니다.`,
            rationale: [
                currentText,
                `${activeScope} ${quiet.month}월 ${regionLabel} 전체 축제는 ${quiet.regionCount}건, 그중 ${typeLabel}은 ${quiet.regionSameTypeCount}건입니다.`,
                // 절대 건수가 아니라 전국 계절성 대비로 고른 달이다(./saturation.ts).
                `${activeScope} 전국 ${quiet.month}월 개최 축제 ${quiet.nationalCount}건(전체의 ${(quiet.nationalShare * 100).toFixed(1)}%)으로 성립하는 시기이며, ${regionLabel}은 기대치 ${Math.round(quiet.expectedCount)}건보다 ${Math.abs(Math.round(quiet.surplus))}건 적습니다.`,
                // 기후 경고. 특이사항이 없는 달이면 문장이 붙지 않는다.
                ...(climate
                    ? [describeMonthClimate(climate, region, quiet.month)].filter((x): x is string => x !== null)
                    : []),
            ],
            opportunityScore: pct(
                1 - quiet.regionSameTypeCount / Math.max(1, cohort.regionSameType)
            ),
            referenceFestivals: proof.map(toReferenceFestival),
        });
    }

    // ── 3. 소재 결합형 (매시업) ───────────────────────────────────────────
    // 소재는 **시기 카드가 고른 달에 성립하는 것**만 후보로 둔다. 시기 카드가 없으면
    // 희망월을 기준으로 본다. 제철을 모르는 소재는 걸러지지 않는다(seasonality.ts 참고).
    const plannedMonth = quiet?.month ?? targetMonth;
    const importedKeyword: WhitespaceAxisEntry | undefined = whitespace.keyword.find(
        (k) => k.regionCount === 0 && fitsMonth(seasonality, k.value, plannedMonth)
    );
    if (importedKeyword) {
        // 지역 정체성 키워드: 유형과 무관하게 이 지역에서 가장 자주 쓰이는 소재.
        const localCounts = new Map<string, number>();
        for (const r of inRegion) {
            for (const k of r.keywords) localCounts.set(k, (localCounts.get(k) ?? 0) + 1);
        }
        // 들여올 소재와 **똑같이** 제철을 본다. 이 검사가 importedKeyword에만 걸려 있던
        // 동안 "벚꽃 × 전어를 9월에" 같은 제목이 나갔다(스윕 1,020장 중 300장, 29.4%).
        // 엔진이 벚꽃의 제철(3·4·5월, 101건 중 99%)을 이미 계산해 두고도 쓰던 것이다.
        // fitsMonth는 제철을 모르는 소재를 통과시키므로 과잉 차단이 되지 않는다.
        const localKeyword = [...localCounts.entries()]
            .filter(([k]) => k !== importedKeyword.value)
            .filter(([k]) => fitsMonth(seasonality, k, plannedMonth))
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
                `${corpusScope} 축제명 ${cohort.nationalSameType}건을 분석해 추출한 소재 태그 기준입니다.`,
                `"${importedKeyword.value}" 전국 사용 ${importedKeyword.nationalCount}건 / ${regionLabel} 사용 ${importedKeyword.regionCount}건.`,
                ...(localKeyword
                    ? [`"${localKeyword[0]}"은 ${regionLabel} 축제 ${localKeyword[1]}건에서 이미 검증된 지역 소재입니다.`]
                    : []),
                // 제철이 확인된 소재만 문장이 붙는다. LLM이 시기를 잘못 잡는 것을 막는다.
                // 두 소재 모두 붙인다 - 제목에 나가는 소재는 둘 다이므로 근거도 둘 다 있어야 한다.
                ...[
                    describeSeason(seasonality, importedKeyword.value),
                    localKeyword ? describeSeason(seasonality, localKeyword[0]) : null,
                ].filter((x): x is string => x !== null),
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
