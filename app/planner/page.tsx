"use client";

import { useEffect, useState } from "react";
import {
    MayoBtn,
    MayoSelect,
    MayoInput,
    MayoToggle,
    MayoCard,
    MayoAlert,
    MayoTag,
    MayoTable,
    MayoLoadingSpinner,
    MayoDivider,
    MayoProgress,
    MayoAccordion,
    MayoBarChart,
} from "mayoui-react";
import type { MetadataResponse } from "@/lib/domain/types";
import {
    fetchPlanDraft,
    fetchPlanningRecommendations,
    type PlanningRecommendationResponse,
} from "@/lib/api/planning-recommendations";
import type {
    FestivalVenueInfo,
    LlmPlanDraft,
    Recommendation,
    ReferenceFestival,
    VisitorProfile,
} from "@/lib/planner/types";
import MonthChart from "./month-chart";
import WhitespaceGrid from "./whitespace-grid";
import BudgetScatter from "./budget-scatter";

const CURRENT_YEAR = new Date().getFullYear();

const KIND_TAG_COLOR: Record<Recommendation["kind"], "blue" | "green" | "purple" | "orange" | "gray"> = {
    VENUE_SHIFT: "blue",
    TIMING_SHIFT: "green",
    KEYWORD_MASHUP: "purple",
    DURATION_TUNE: "orange",
    BUDGET_EFFICIENCY: "gray",
};
const KIND_LABEL: Record<Recommendation["kind"], string> = {
    VENUE_SHIFT: "장소 전환",
    TIMING_SHIFT: "시기 이동",
    KEYWORD_MASHUP: "소재 결합",
    DURATION_TUNE: "기간 조정",
    BUDGET_EFFICIENCY: "예산 기준",
};

function krw(value: number | null): string {
    if (value === null) return "미상";
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억원`;
    if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만원`;
    return `${value.toLocaleString("ko-KR")}원`;
}

function num(value: number | null, suffix = ""): string {
    return value === null ? "미상" : `${value.toLocaleString("ko-KR")}${suffix}`;
}

function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

function period(start: string | null, end: string | null): string | null {
    if (!start) return null;
    const dot = (d: string) => d.replaceAll("-", ".");
    if (!end) return dot(start);
    return start.slice(0, 4) === end.slice(0, 4)
        ? `${dot(start)}~${dot(end).slice(5)}`
        : `${dot(start)}~${dot(end)}`;
}

function scoreColor(score: number): "green" | "blue" | "purple" | "orange" | "red" {
    if (score >= 80) return "green";
    if (score >= 60) return "blue";
    if (score >= 40) return "purple";
    if (score >= 20) return "orange";
    return "red";
}

function scoreLabel(score: number): string {
    if (score >= 80) return "매우 높음";
    if (score >= 60) return "높음";
    if (score >= 40) return "보통";
    if (score >= 20) return "낮음";
    return "매우 낮음";
}

type RefRow = {
    _key: string;
    festivalName: string;
    venueDetail: React.ReactNode;
    regionLabel: string;
    startMonth: string;
    durationDays: string;
    totalBudgetKrw: string;
    visitors: string;
    costPerVisitorKrw: string;
};

function ReferenceTable({
    items,
    venues,
}: {
    items: ReferenceFestival[];
    venues: Record<string, FestivalVenueInfo>;
}) {
    if (items.length === 0) return null;

    const tableData: RefRow[] = items.map((f, i) => {
        const venue = venues[f.festivalName];
        const actualPeriod = venue ? period(venue.startDate, venue.endDate) : null;
        return {
            _key: `${f.festivalName}-${i}`,
            festivalName: f.festivalName,
            venueDetail: (venue?.venue || actualPeriod) ? (
                <span className="block text-xs mt-0.5" style={{ color: "var(--mayo-text-muted)" }}>
                    {venue?.venue}
                    {venue?.venue && actualPeriod ? " · " : ""}
                    {actualPeriod}
                </span>
            ) : null,
            regionLabel: `${f.regionLabel}${f.district ? ` ${f.district}` : ""}`,
            startMonth: f.startMonth === null ? "미상" : `${f.startMonth}월`,
            durationDays: num(f.durationDays, "일"),
            totalBudgetKrw: krw(f.totalBudgetKrw),
            visitors: num(f.visitors, "명"),
            costPerVisitorKrw: krw(f.costPerVisitorKrw),
        };
    });

    const columns: import("mayoui-react").MayoTableColumn<RefRow>[] = [
        {
            key: "festivalName",
            label: "축제명",
            render: (_val, row) => (
                <span>
                    {row.festivalName}
                    {row.venueDetail}
                </span>
            ),
        },
        { key: "regionLabel", label: "지역" },
        { key: "startMonth", label: "시기" },
        { key: "durationDays", label: "기간" },
        { key: "totalBudgetKrw", label: "예산" },
        { key: "visitors", label: "방문객" },
        { key: "costPerVisitorKrw", label: "1인당" },
    ];

    return (
        <div className="mt-3">
            <p className="text-xs font-medium mb-2" style={{ color: "var(--mayo-text-muted)" }}>근거 축제 (실제 데이터)</p>
            <div className="overflow-x-auto" style={{ minWidth: 520 }}>
                <MayoTable<RefRow>
                    columns={columns}
                    data={tableData}
                    rowKey="_key"
                    bordered
                />
            </div>
            {items.some((f) => venues[f.festivalName]) && (
                <p className="text-[11px] mt-2" style={{ color: "var(--mayo-text-muted)" }}>
                    회색 줄은 전국문화축제표준데이터의 실제 개최 장소·기간입니다.
                </p>
            )}
        </div>
    );
}

export default function PlannerPage() {
    const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
    const [metaError, setMetaError] = useState<string | null>(null);

    const [planningYear, setPlanningYear] = useState(CURRENT_YEAR + 1);
    const [regionCode, setRegionCode] = useState("");
    const [district, setDistrict] = useState("");
    const [festivalType, setFestivalType] = useState("");
    const [venueType, setVenueType] = useState("");
    const [durationDays, setDurationDays] = useState(3);
    const [startMonth, setStartMonth] = useState<number | "">("");
    const [useLlm, setUseLlm] = useState(true);

    const [result, setResult] = useState<PlanningRecommendationResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0);

    const [llmPlan, setLlmPlan] = useState<LlmPlanDraft | null>(null);
    const [visitorProfile, setVisitorProfile] = useState<VisitorProfile | null>(null);
    const [festivalVenues, setFestivalVenues] = useState<Record<string, FestivalVenueInfo>>({});
    const [llmLoading, setLlmLoading] = useState(false);
    const [llmError, setLlmError] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/v1/metadata")
            .then((r) => r.json())
            .then((data) => {
                if (data.message) {
                    setMetaError(data.message);
                } else {
                    setMetadata(data);
                    setRegionCode(data.regions[0]?.code ?? "");
                    setFestivalType(data.festivalTypes[0]?.code ?? "");
                    setVenueType(data.venueTypes[0]?.code ?? "");
                    setDurationDays(data.duration?.minimum ?? 3);
                }
            })
            .catch((e) => setMetaError(String(e)));
    }, []);

    // loading progress animation
    useEffect(() => {
        if (!loading) return;
        let frame: number;
        let start: number | null = null;
        const tick = (ts: number) => {
            if (start === null) start = ts;
            const elapsed = ts - start;
            const pct = Math.min(90, 90 * (1 - Math.exp(-elapsed / 2000)));
            setLoadingProgress(Math.round(pct));
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [loading]);

    const districts = metadata?.districtsByRegion[regionCode] ?? [];

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setResult(null);
        setLlmPlan(null);
        setVisitorProfile(null);
        setFestivalVenues({});
        setLlmError(null);
        setLoading(true);
        setLoadingProgress(0);

        const request = {
            planningYear: Number(planningYear),
            regionCode,
            district: district || undefined,
            festivalType,
            venueType,
            durationDays: Number(durationDays),
            startMonth: startMonth === "" ? undefined : Number(startMonth),
            useLlm,
        };

        try {
            const stats = await fetchPlanningRecommendations(request);
            setLoadingProgress(100);
            setResult(stats);

            if (stats.integrations.llm.enabled) {
                setLlmLoading(true);
                fetchPlanDraft(request)
                    .then((draft) => {
                        setLlmPlan(draft.llmPlan);
                        setVisitorProfile(draft.visitorProfile);
                        setFestivalVenues(draft.festivalVenues ?? {});
                        if (!draft.llmPlan && draft.llm.reason) setLlmError(draft.llm.reason);
                    })
                    .catch((err) => setLlmError(err instanceof Error ? err.message : String(err)))
                    .finally(() => setLlmLoading(false));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }

    const timingCard = result?.recommendations.find((r) => r.kind === "TIMING_SHIFT");
    const recommendedMonth = timingCard ? Number(timingCard.id.replace("timing-", "")) : null;

    const regionLabel =
        metadata?.regions.find((r) => r.code === regionCode)?.displayName ?? regionCode;
    const typeLabel =
        metadata?.festivalTypes.find((t) => t.code === festivalType)?.displayName ?? festivalType;

    const monthOptions = [
        { value: "", label: "미정 — 추천받기" },
        ...Array.from({ length: 12 }, (_, i) => ({
            value: String(i + 1),
            label: `${i + 1}월`,
        })),
    ];

    const regionOptions = (metadata?.regions ?? []).map((r) => ({
        value: r.code,
        label: r.displayName,
    }));

    const districtOptions = [
        { value: "", label: "전체" },
        ...districts.map((d) => ({ value: d, label: d })),
    ];

    const festivalTypeOptions = (metadata?.festivalTypes ?? []).map((t) => ({
        value: t.code,
        label: t.displayName,
    }));

    const venueTypeOptions = (metadata?.venueTypes ?? []).map((v) => ({
        value: v.code,
        label: v.displayName,
    }));

    // opportunity score chart data for recommendations
    const opportunityChartData = result
        ? result.recommendations
            .filter((r) => r.kind !== "BUDGET_EFFICIENCY" && r.opportunityScore > 0)
            .sort((a, b) => b.opportunityScore - a.opportunityScore)
            .map((r) => ({
                label: r.title.length > 8 ? r.title.slice(0, 7) + "…" : r.title,
                점수: r.opportunityScore,
            }))
        : [];

    return (
        <main className="min-h-screen flex flex-col p-3 sm:p-4 lg:p-5 gap-3 sm:gap-4" style={{ background: "var(--mayo-bg-subtle)", color: "var(--mayo-text)" }}>
            {/* 헤더 */}
            <header>
                <h1 className="text-xl sm:text-2xl font-bold" style={{ color: "var(--mayo-text)" }}>축제 기획 추천</h1>
                <p className="text-xs sm:text-sm mt-1" style={{ color: "var(--mayo-text-muted)" }}>
                    전국 축제 개최 데이터를 분석해, <strong>전국에서는 검증됐지만 우리 지역에는 없는</strong>{" "}
                    선택지를 찾아 차별화 방향을 제안합니다.
                </p>
                <MayoDivider />
            </header>

            {metaError && <MayoAlert type="error" title="메타데이터 오류">{metaError}</MayoAlert>}

            {/* 입력 폼 */}
            <form onSubmit={handleSubmit}>
                <MayoCard variant="outlined" padding="md">
                    <div className="flex flex-col gap-4">
                        {/* 지역 + 연도 */}
                        <div>
                            <p className="text-xs font-semibold mb-2" style={{ color: "var(--mayo-text-muted)" }}>어디서, 언제</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                                <MayoSelect
                                    label="광역자치단체"
                                    size="sm"
                                    options={regionOptions}
                                    value={regionCode}
                                    onChange={(e) => { setRegionCode(e.target.value); setDistrict(""); }}
                                />
                                <MayoSelect
                                    label="시군구"
                                    size="sm"
                                    options={districtOptions}
                                    value={district}
                                    onChange={(e) => setDistrict(e.target.value)}
                                />
                                <MayoSelect
                                    label="기획연도"
                                    size="sm"
                                    value={String(planningYear)}
                                    onChange={(e) => setPlanningYear(Number(e.target.value))}
                                    options={Array.from({ length: 7 }, (_, i) => {
                                        const y = CURRENT_YEAR + i;
                                        return { value: String(y), label: `${y}년` };
                                    })}
                                />
                                <MayoSelect
                                    label="희망 개최월"
                                    size="sm"
                                    options={monthOptions}
                                    value={String(startMonth)}
                                    onChange={(e) => setStartMonth(e.target.value === "" ? "" : Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <MayoDivider />

                        {/* 축제 설정 */}
                        <div>
                            <p className="text-xs font-semibold mb-2" style={{ color: "var(--mayo-text-muted)" }}>어떤 축제</p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <MayoSelect
                                    label="축제 유형"
                                    size="sm"
                                    options={festivalTypeOptions}
                                    value={festivalType}
                                    onChange={(e) => setFestivalType(e.target.value)}
                                />
                                <MayoSelect
                                    label="장소 유형"
                                    size="sm"
                                    options={venueTypeOptions}
                                    value={venueType}
                                    onChange={(e) => setVenueType(e.target.value)}
                                />
                                <MayoInput
                                    label={`개최 일수${metadata ? ` (최소 ${metadata.duration.minimum}일)` : ""}`}
                                    type="number"
                                    size="sm"
                                    min={metadata?.duration.minimum ?? 1}
                                    value={durationDays}
                                    onChange={(e) => setDurationDays(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <MayoDivider />

                        {/* 제출 */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                            <MayoBtn type="submit" variant="primary" size="md" color="blue" disabled={loading || !metadata} className="w-full sm:w-auto" style={{ minWidth: 160 }}>
                                {loading ? `분석 중 ${loadingProgress}%` : "추천 받기"}
                            </MayoBtn>
                            <MayoToggle
                                checked={useLlm}
                                onChange={(checked) => setUseLlm(checked)}
                                label="AI 기획안 함께 생성"
                                size="sm"
                                color="blue"
                            />
                        </div>
                    </div>
                </MayoCard>
            </form>

            {/* 로딩 프로그레스 */}
            {loading && <MayoProgress value={loadingProgress} max={100} size="sm" color="blue" label="분석 중" showValue />}

            {error && <MayoAlert type="error">{error}</MayoAlert>}

            {result && (
                <>
                    {/* 코호트 요약 */}
                    <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
                        {[
                            { label: `전국 ${typeLabel}`, value: result.cohort.nationalSameType },
                            { label: `${regionLabel} 전체`, value: result.cohort.region },
                            { label: `${regionLabel} ${typeLabel}`, value: result.cohort.regionSameType },
                            { label: "동일 유형·장소", value: result.cohort.regionSameTypeSameVenue },
                        ].map((s) => (
                            <MetricBox key={s.label} label={s.label} value={`${s.value}건`} />
                        ))}
                    </div>
                    <p className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>
                        {result.datasetYearRange[0] === result.datasetYearRange[1]
                            ? `${result.datasetYear}년`
                            : `${result.datasetYearRange[0]}~${result.datasetYearRange[1]}년`}{" "}
                        전국 축제 개최계획 데이터 기준
                    </p>

                    {/* 포화도 */}
                    {result.saturation && (
                        <MayoAlert
                            type={result.saturation.level === "HIGH" ? "error" : result.saturation.level === "MEDIUM" ? "warning" : "info"}
                            title={result.saturation.level === "HIGH" ? "포화 위험 높음" : result.saturation.level === "MEDIUM" ? "포화 주의" : "포화도 낮음"}
                        >
                            {result.saturation.message}
                        </MayoAlert>
                    )}

                    {/* 기회 점수 요약 — 큰 숫자 카드 */}
                    {result.recommendations.filter((r) => r.kind !== "BUDGET_EFFICIENCY").length > 0 && (
                        <div>
                            <p className="text-sm font-semibold mb-2" style={{ color: "var(--mayo-text)" }}>기회 점수 한눈에 보기</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                                {result.recommendations
                                    .filter((r) => r.kind !== "BUDGET_EFFICIENCY")
                                    .sort((a, b) => b.opportunityScore - a.opportunityScore)
                                    .map((rec) => (
                                        <div
                                            key={rec.id}
                                            className="rounded-xl p-3 text-center"
                                            style={{
                                                background: "var(--mayo-surface)",
                                                border: `2px solid ${rec.opportunityScore >= 60 ? "#10b981" : rec.opportunityScore >= 30 ? "#f59e0b" : "var(--mayo-border)"}`,
                                            }}
                                        >
                                            <p className="text-3xl sm:text-4xl font-black" style={{ color: "var(--mayo-text)" }}>{rec.opportunityScore}</p>
                                            <MayoTag color={scoreColor(rec.opportunityScore)} variant="soft" size="sm">{scoreLabel(rec.opportunityScore)}</MayoTag>
                                            <p className="text-[11px] mt-1.5 leading-tight truncate" style={{ color: "var(--mayo-text-muted)" }}>{rec.title}</p>
                                            <div className="mt-1"><MayoTag color={KIND_TAG_COLOR[rec.kind]} variant="solid" size="sm">{KIND_LABEL[rec.kind]}</MayoTag></div>
                                        </div>
                                    ))
                                }
                            </div>
                        </div>
                    )}

                    {/* 기회 점수 바 차트 + 월별 분포 */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {opportunityChartData.length > 0 && (
                            <MayoCard variant="outlined" padding="md">
                                <p className="text-sm font-semibold mb-2" style={{ color: "var(--mayo-text)" }}>기회 점수 비교</p>
                                <div className="slim-bar-chart">
                                    <MayoBarChart
                                        data={opportunityChartData}
                                        series={[{ key: "점수", color: "#10b981", label: "기회 점수" }]}
                                        height={280}
                                        showGrid
                                    />
                                </div>
                            </MayoCard>
                        )}
                        <MonthChart
                            distribution={result.monthDistribution}
                            targetMonth={startMonth === "" ? null : Number(startMonth)}
                            recommendedMonth={recommendedMonth}
                            regionLabel={regionLabel}
                            typeLabel={typeLabel}
                        />
                    </div>

                    {/* 추천 카드 목록 */}
                    <MayoDivider />
                    <section>
                        <h2 className="text-lg font-bold mb-3" style={{ color: "var(--mayo-text)" }}>
                            {result.planningYear}년 기획 추천 {result.recommendations.length}건
                        </h2>

                        {result.recommendations.length === 0 && (
                            <p className="text-sm" style={{ color: "var(--mayo-text-muted)" }}>
                                조건에 맞는 추천이 없습니다. 지역이나 유형을 넓혀보세요.
                            </p>
                        )}

                        <MayoAccordion
                            multiple
                            bordered
                            items={result.recommendations.map((rec) => ({
                                value: rec.id,
                                label: (
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {rec.kind !== "BUDGET_EFFICIENCY" && (
                                            <span className="text-base font-bold" style={{ color: "var(--mayo-text)" }}>{rec.opportunityScore}</span>
                                        )}
                                        <MayoTag color={KIND_TAG_COLOR[rec.kind]} variant="solid" size="sm">{KIND_LABEL[rec.kind]}</MayoTag>
                                        <span className="font-semibold text-sm" style={{ color: "var(--mayo-text)" }}>{rec.title}</span>
                                        {rec.kind !== "BUDGET_EFFICIENCY" && (
                                            <MayoTag color={scoreColor(rec.opportunityScore)} variant="soft" size="sm">{scoreLabel(rec.opportunityScore)}</MayoTag>
                                        )}
                                    </div>
                                ) as unknown as string,
                                children: (
                                    <div className="flex flex-col gap-2">
                                        <p className="text-sm" style={{ color: "var(--mayo-text-muted)" }}>{rec.summary}</p>
                                        {rec.rationale.length > 0 && (
                                            <ul className="text-xs flex flex-col gap-0.5" style={{ color: "var(--mayo-text-muted)" }}>
                                                {rec.rationale.map((line, i) => (
                                                    <li key={i}>· {line}</li>
                                                ))}
                                            </ul>
                                        )}
                                        <ReferenceTable items={rec.referenceFestivals} venues={festivalVenues} />
                                    </div>
                                ),
                            }))}
                        />
                    </section>

                    {/* 화이트스페이스 */}
                    <MayoDivider />
                    <WhitespaceGrid
                        whitespace={result.whitespace}
                        venueType={venueType}
                        targetMonth={startMonth === "" ? null : Number(startMonth)}
                        datasetYearRange={result.datasetYearRange}
                        regionLabel={regionLabel}
                        typeLabel={typeLabel}
                    />

                    {/* 예산 포지셔닝 */}
                    <MayoDivider />
                    <BudgetScatter
                        budgetEfficiency={result.budgetEfficiency}
                        datasetYearRange={result.datasetYearRange}
                        regionSameTypeCount={result.cohort.regionSameType}
                        regionLabel={regionLabel}
                        typeLabel={typeLabel}
                    />

                    {/* 방문자 구성 */}
                    {visitorProfile && (
                        <>
                            <MayoDivider />
                            <section>
                                <h2 className="text-lg font-bold mb-1" style={{ color: "var(--mayo-text)" }}>방문자 구성</h2>
                                <p className="text-xs mb-3" style={{ color: "var(--mayo-text-muted)" }}>
                                    한국관광공사 통신사 기반 실측치 · {visitorProfile.year}년 {visitorProfile.month}월
                                </p>
                                <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4 mb-3">
                                    <MetricBox
                                        label="외지인·외국인 비율"
                                        value={`${(visitorProfile.outsiderRatio * 100).toFixed(1)}%`}
                                        tag={visitorProfile.outsiderRatio >= visitorProfile.nationalOutsiderRatio ? { label: "평균 이상", color: "green" } : { label: "평균 이하", color: "orange" }}
                                    />
                                    <MetricBox label="전국 평균" value={`${(visitorProfile.nationalOutsiderRatio * 100).toFixed(1)}%`} />
                                    <MetricBox label="17개 시도 중" value={`${visitorProfile.outsiderRatioRank}위`} />
                                    <MetricBox
                                        label="일평균 방문"
                                        value={`${Math.round(visitorProfile.totalVisitors / daysInMonth(visitorProfile.year, visitorProfile.month) / 10000).toLocaleString("ko-KR")}만명`}
                                    />
                                </div>
                                <MayoAlert type="info">
                                    {visitorProfile.outsiderRatio >= visitorProfile.nationalOutsiderRatio
                                        ? "전국 평균보다 외부 유입이 많은 지역입니다. 외지 관광객을 겨냥한 기획이 통할 여지가 있습니다."
                                        : "전국 평균보다 외부 유입이 적은 지역입니다. 외지 관광객 유치보다 지역 주민 참여형 기획이 현실적일 수 있습니다."}
                                </MayoAlert>
                            </section>
                        </>
                    )}

                    {/* AI 기획안 */}
                    {(llmLoading || llmPlan || llmError) && (
                        <>
                            <MayoDivider />
                            <section>
                                <div className="flex items-baseline gap-3 mb-3">
                                    <h2 className="text-lg font-bold" style={{ color: "var(--mayo-text)" }}>AI 기획안 초안</h2>
                                    {llmPlan && <span className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>{llmPlan.model}</span>}
                                </div>

                                {llmLoading && (
                                    <MayoCard variant="outlined" padding="md">
                                        <p className="text-sm mb-3" style={{ color: "var(--mayo-text-muted)" }}>
                                            위 분석 근거로 기획안을 작성하는 중입니다...
                                        </p>
                                        <MayoLoadingSpinner size="md" color="blue" label="기획안 생성 중..." />
                                    </MayoCard>
                                )}

                                {llmError && !llmLoading && (
                                    <MayoAlert type="warning">기획안을 생성하지 못했습니다: {llmError}</MayoAlert>
                                )}

                                {llmPlan && !llmLoading && (
                                    <MayoCard variant="outlined" padding="md">
                                        <p className="text-xs mb-3" style={{ color: "var(--mayo-text-muted)" }}>
                                            위 분석 근거만 입력해 생성했습니다. 수치는 모두 실측값입니다.
                                        </p>
                                        {llmPlan.concept && (
                                            <p className="text-sm mb-4 leading-relaxed" style={{ color: "var(--mayo-text)" }}>{llmPlan.concept}</p>
                                        )}
                                        {[
                                            { title: "프로그램 아이디어", items: llmPlan.programIdeas, color: "blue" as const },
                                            { title: "차별화 포인트", items: llmPlan.differentiationPoints, color: "green" as const },
                                            { title: "유의사항", items: llmPlan.cautions, color: "orange" as const },
                                        ]
                                            .filter((s) => s.items.length > 0)
                                            .map((s) => (
                                                <div key={s.title} className="mb-4 last:mb-0">
                                                    <div className="flex items-center gap-2 mb-1.5">
                                                        <MayoTag color={s.color} variant="solid" size="sm">{s.title}</MayoTag>
                                                    </div>
                                                    <ul className="text-sm flex flex-col gap-1" style={{ color: "var(--mayo-text-muted)" }}>
                                                        {s.items.map((item, i) => (
                                                            <li key={i}>· {item}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            ))}
                                    </MayoCard>
                                )}
                            </section>
                        </>
                    )}

                    {/* 화이트스페이스 상세 + 데이터 연동 상태 — 아코디언 */}
                    <MayoAccordion
                        multiple
                        bordered
                        items={[
                            {
                                value: "whitespace",
                                label: "화이트스페이스 상세",
                                children: (
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        {(
                                            [
                                                ["장소", result.whitespace.venue],
                                                ["시기", result.whitespace.month],
                                                ["기간", result.whitespace.durationBucket],
                                                ["소재", result.whitespace.keyword],
                                            ] as const
                                        ).map(([label, entries]) => (
                                            <div key={label}>
                                                <p className="text-sm font-medium mb-2" style={{ color: "var(--mayo-text)" }}>{label}</p>
                                                {entries.length === 0 ? (
                                                    <p className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>근거가 충분한 항목이 없습니다.</p>
                                                ) : (
                                                    <MayoTable<{ value: string; label: string; nationalCount: number; regionCount: number; opportunityScore: number }>
                                                        columns={[
                                                            { key: "label", label: "항목" },
                                                            { key: "nationalCount", label: "전국" },
                                                            { key: "regionCount", label: "지역" },
                                                            {
                                                                key: "opportunityScore",
                                                                label: "기회",
                                                                render: (val) => String(Math.round((val as number) * 100)),
                                                            },
                                                        ]}
                                                        data={entries.slice(0, 8)}
                                                        rowKey="value"
                                                        bordered
                                                    />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ),
                            },
                            {
                                value: "integrations",
                                label: "데이터 연동 상태",
                                children: (
                                    <div className="flex flex-col gap-2">
                                        {(
                                            [
                                                ["TourAPI 4.0 (축제 상세 프로그램)", result.integrations.tourApi],
                                                ["전국문화축제표준데이터 (개최장소·기간·주최)", result.integrations.festivalStandard],
                                                ["지역 스토리 (설화·향토자산)", result.integrations.localStory],
                                                ["AI 기획안 생성", result.integrations.llm],
                                            ] as const
                                        ).map(([label, status]) => (
                                            <div key={label} className="flex items-center gap-2">
                                                <MayoTag color={status.enabled ? "green" : "gray"} variant={status.enabled ? "solid" : "soft"} size="sm">
                                                    {status.enabled ? "ON" : "OFF"}
                                                </MayoTag>
                                                <span className="text-sm" style={{ color: status.enabled ? "var(--mayo-text)" : "var(--mayo-text-muted)" }}>{label}</span>
                                                {status.reason && <span className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>— {status.reason}</span>}
                                            </div>
                                        ))}
                                        {result.warnings.length > 0 && (
                                            <div className="mt-2">
                                                <MayoAlert type="warning">
                                                    <ul className="text-xs flex flex-col gap-1">
                                                        {result.warnings.map((w, i) => (
                                                            <li key={i}>· {w}</li>
                                                        ))}
                                                    </ul>
                                                </MayoAlert>
                                            </div>
                                        )}
                                    </div>
                                ),
                            },
                        ]}
                    />
                </>
            )}

            {/* 결과 없을 때 안내 */}
            {!result && !loading && !error && (
                <MayoAlert type="info" title="사용 방법">
                    기획 조건을 입력하고 &quot;추천 받기&quot; 버튼을 누르면 분석 결과가 여기 표시됩니다.
                </MayoAlert>
            )}
        </main>
    );
}

function MetricBox({ label, value, tag, sub }: {
    label: string;
    value: string;
    sub?: string;
    tag?: { label: string; color: "green" | "blue" | "purple" | "orange" | "red" | "gray" };
}) {
    return (
        <div style={{ background: "var(--mayo-surface)", border: "1px solid var(--mayo-border)", borderRadius: 8, padding: "10px 14px" }}>
            <p className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>{label}</p>
            <div className="flex items-center gap-2 mt-0.5">
                <p className="text-lg font-bold" style={{ color: "var(--mayo-text)" }}>{value}</p>
                {tag && <MayoTag color={tag.color} variant="soft" size="sm">{tag.label}</MayoTag>}
            </div>
            {sub && <p className="text-xs mt-0.5" style={{ color: "var(--mayo-text-muted)" }}>{sub}</p>}
        </div>
    );
}
