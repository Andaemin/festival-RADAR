"use client";

import { useEffect, useState } from "react";
import {
    MayoBtn,
    MayoSelect,
    MayoInput,
    MayoToggle,
    MayoCard,
    MayoAlert,
    MayoBadge,
    MayoTable,
    MayoLoadingSpinner,
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

const CURRENT_YEAR = new Date().getFullYear();

const KIND_BADGE: Record<Recommendation["kind"], string> = {
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

/** "2026-04-01" + "2026-04-08" -> "2026.04.01~04.08". 해가 넘어가면 종료일도 연도를 붙인다. */
function period(start: string | null, end: string | null): string | null {
    if (!start) return null;
    const dot = (d: string) => d.replaceAll("-", ".");
    if (!end) return dot(start);
    return start.slice(0, 4) === end.slice(0, 4)
        ? `${dot(start)}~${dot(end).slice(5)}`
        : `${dot(start)}~${dot(end)}`;
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
    /** 축제명 -> 실제 개최 장소·기간(전국문화축제표준데이터). 기획안과 함께 뒤늦게 도착한다. */
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
        <div className="pt-3 mt-4" style={{ borderTop: "1px solid var(--mayo-border)" }}>
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
    const [showWhitespace, setShowWhitespace] = useState(false);

    // AI 기획안은 통계와 분리해 뒤따라 받는다. 통계는 수십 ms, LLM은 수 초가 걸린다.
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
            setResult(stats);

            // 통계를 먼저 그린 뒤 기획안을 이어서 받는다. 실패해도 통계는 남는다.
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

    return (
        <main
            className="min-h-screen p-8"
            style={{ background: "var(--mayo-bg-subtle)", color: "var(--mayo-text)" }}
        >
            <div className="max-w-4xl mx-auto">
                <h1 className="text-2xl font-bold mb-1">축제 기획 추천</h1>
                <p className="text-sm mb-6" style={{ color: "var(--mayo-text-secondary)" }}>
                    전국 축제 개최 데이터를 분석해, <strong>전국에서는 검증됐지만 우리 지역에는 없는</strong>{" "}
                    선택지를 찾아 차별화 방향을 제안합니다. 모든 수치는 실제 데이터에서 계산됩니다.
                </p>

                {metaError && (
                    <div className="mb-4">
                        <MayoAlert type="error" title="메타데이터 오류">
                            메타데이터를 불러오지 못했습니다: {metaError}
                        </MayoAlert>
                    </div>
                )}

                <MayoCard variant="outlined" padding="md" className="mb-6">
                    <form onSubmit={handleSubmit}>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <MayoInput
                                label="기획연도"
                                type="number"
                                size="md"
                                min={CURRENT_YEAR}
                                value={planningYear}
                                onChange={(e) => setPlanningYear(Number(e.target.value))}
                            />

                            <MayoSelect
                                label="희망 개최월 (선택)"
                                size="md"
                                options={monthOptions}
                                value={String(startMonth)}
                                onChange={(e) =>
                                    setStartMonth(e.target.value === "" ? "" : Number(e.target.value))
                                }
                            />

                            <MayoSelect
                                label="광역자치단체"
                                size="md"
                                options={regionOptions}
                                value={regionCode}
                                onChange={(e) => {
                                    setRegionCode(e.target.value);
                                    setDistrict("");
                                }}
                            />

                            <MayoSelect
                                label="시군구 (선택)"
                                size="md"
                                options={districtOptions}
                                value={district}
                                onChange={(e) => setDistrict(e.target.value)}
                            />

                            <MayoSelect
                                label="축제 유형"
                                size="md"
                                options={festivalTypeOptions}
                                value={festivalType}
                                onChange={(e) => setFestivalType(e.target.value)}
                            />

                            <MayoSelect
                                label="장소 유형"
                                size="md"
                                options={venueTypeOptions}
                                value={venueType}
                                onChange={(e) => setVenueType(e.target.value)}
                            />

                            <MayoInput
                                label={`개최 일수${metadata ? ` (최소 ${metadata.duration.minimum}일)` : ""}`}
                                type="number"
                                size="md"
                                min={metadata?.duration.minimum ?? 1}
                                value={durationDays}
                                onChange={(e) => setDurationDays(Number(e.target.value))}
                            />

                            <div className="flex items-end pb-1">
                                <MayoToggle
                                    checked={useLlm}
                                    onChange={(checked) => setUseLlm(checked)}
                                    label="AI 기획안 초안도 함께 생성"
                                    size="md"
                                    color="blue"
                                />
                            </div>
                        </div>

                        <div className="mt-5">
                            <MayoBtn type="submit" variant="primary" size="md" disabled={loading || !metadata}>
                                {loading ? "분석 중..." : "추천 받기"}
                            </MayoBtn>
                        </div>
                    </form>
                </MayoCard>

                {error && (
                    <div className="mb-6">
                        <MayoAlert type="error">
                            {error}
                        </MayoAlert>
                    </div>
                )}

                {result && (
                    <div className="flex flex-col gap-6">
                        {/* 코호트 요약 */}
                        <MayoCard variant="outlined" padding="md">
                            <h2 className="text-base font-bold mb-1">분석 기준</h2>
                            <p className="text-xs mb-4" style={{ color: "var(--mayo-text-muted)" }}>
                                {result.datasetYearRange[0] === result.datasetYearRange[1]
                                    ? `${result.datasetYear}년`
                                    : `${result.datasetYearRange[0]}~${result.datasetYearRange[1]}년`}{" "}
                                전국 축제 개최계획 데이터 기준
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                {[
                                    { label: `전국 ${typeLabel}`, value: result.cohort.nationalSameType },
                                    { label: `${regionLabel} 전체`, value: result.cohort.region },
                                    { label: `${regionLabel} ${typeLabel}`, value: result.cohort.regionSameType },
                                    { label: "동일 유형·장소", value: result.cohort.regionSameTypeSameVenue },
                                ].map((s) => (
                                    <MayoCard key={s.label} variant="outlined" padding="sm">
                                        <div className="text-2xl font-bold">{s.value}</div>
                                        <div className="text-xs mt-0.5" style={{ color: "var(--mayo-text-muted)" }}>{s.label}</div>
                                    </MayoCard>
                                ))}
                            </div>
                        </MayoCard>

                        {/* 포화도 */}
                        {result.saturation && (
                            <MayoAlert
                                type={
                                    result.saturation.level === "HIGH"
                                        ? "error"
                                        : result.saturation.level === "MEDIUM"
                                          ? "warning"
                                          : "info"
                                }
                                title={
                                    result.saturation.level === "HIGH"
                                        ? "포화 위험 높음"
                                        : result.saturation.level === "MEDIUM"
                                          ? "포화 주의"
                                          : "포화도 낮음"
                                }
                            >
                                {result.saturation.message}
                            </MayoAlert>
                        )}

                        {/* 월별 분포 */}
                        <MonthChart
                            distribution={result.monthDistribution}
                            targetMonth={startMonth === "" ? null : Number(startMonth)}
                            recommendedMonth={recommendedMonth}
                            regionLabel={regionLabel}
                            typeLabel={typeLabel}
                        />

                        {/* 추천 카드 */}
                        <section className="flex flex-col gap-4">
                            <h2 className="text-lg font-bold">
                                {result.planningYear}년 기획 추천 {result.recommendations.length}건
                            </h2>

                            {result.recommendations.length === 0 && (
                                <p className="text-sm" style={{ color: "var(--mayo-text-secondary)" }}>
                                    조건에 맞는 추천이 없습니다. 지역이나 유형을 넓혀보세요.
                                </p>
                            )}

                            {result.recommendations.map((rec) => (
                                <MayoCard key={rec.id} variant="outlined" padding="md">
                                    <div className="flex items-start justify-between gap-4 mb-2">
                                        <div>
                                            <div className="mb-2">
                                                <MayoBadge color="gray" variant="soft" size="sm">
                                                    {KIND_BADGE[rec.kind]}
                                                </MayoBadge>
                                            </div>
                                            <h3 className="font-bold">{rec.title}</h3>
                                        </div>
                                        {rec.kind !== "BUDGET_EFFICIENCY" && (
                                            <div className="text-right shrink-0">
                                                <div className="text-xl font-bold">{rec.opportunityScore}</div>
                                                <div className="text-[10px]" style={{ color: "var(--mayo-text-muted)" }}>기회점수</div>
                                            </div>
                                        )}
                                    </div>

                                    <p className="text-sm mb-4" style={{ color: "var(--mayo-text-secondary)" }}>{rec.summary}</p>

                                    {rec.rationale.length > 0 && (
                                        <ul className="list-disc pl-5 text-sm flex flex-col gap-1" style={{ color: "var(--mayo-text-secondary)" }}>
                                            {rec.rationale.map((line, i) => (
                                                <li key={i}>{line}</li>
                                            ))}
                                        </ul>
                                    )}

                                    <ReferenceTable items={rec.referenceFestivals} venues={festivalVenues} />
                                </MayoCard>
                            ))}
                        </section>

                        {/* 방문자 구성 - 통신사 실측값. LLM 생성물이 아니다 */}
                        {visitorProfile && (
                            <MayoCard variant="outlined" padding="md">
                                <h2 className="text-base font-bold mb-1">방문자 구성</h2>
                                <p className="text-xs mb-4" style={{ color: "var(--mayo-text-muted)" }}>
                                    한국관광공사 통신사 기반 실측치 · {visitorProfile.year}년 {visitorProfile.month}월
                                </p>

                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                                    {[
                                        {
                                            label: "외지인·외국인 비율",
                                            value: `${(visitorProfile.outsiderRatio * 100).toFixed(1)}%`,
                                        },
                                        {
                                            label: "전국 평균",
                                            value: `${(visitorProfile.nationalOutsiderRatio * 100).toFixed(1)}%`,
                                        },
                                        { label: "17개 시도 중", value: `${visitorProfile.outsiderRatioRank}위` },
                                        {
                                            label: "월 총 방문",
                                            value: `${Math.round(visitorProfile.totalVisitors / 10000).toLocaleString("ko-KR")}만명`,
                                        },
                                    ].map((s) => (
                                        <div key={s.label}>
                                            <div className="text-xl font-bold">{s.value}</div>
                                            <div className="text-xs mt-0.5" style={{ color: "var(--mayo-text-muted)" }}>{s.label}</div>
                                        </div>
                                    ))}
                                </div>

                                <p className="text-sm" style={{ color: "var(--mayo-text-secondary)" }}>
                                    {visitorProfile.outsiderRatio >= visitorProfile.nationalOutsiderRatio
                                        ? "전국 평균보다 외부 유입이 많은 지역입니다. 외지 관광객을 겨냥한 기획이 통할 여지가 있습니다."
                                        : "전국 평균보다 외부 유입이 적은 지역입니다. 외지 관광객 유치보다 지역 주민 참여형 기획이 현실적일 수 있습니다."}
                                </p>
                            </MayoCard>
                        )}

                        {/* AI 기획안 - 통계보다 늦게 도착한다 */}
                        {(llmLoading || llmPlan || llmError) && (
                            <MayoCard variant="outlined" padding="md">
                                <div className="flex items-baseline justify-between gap-4 mb-3">
                                    <h2 className="text-base font-bold">AI 기획안 초안</h2>
                                    {llmPlan && (
                                        <span className="text-[11px]" style={{ color: "var(--mayo-text-muted)" }}>{llmPlan.model}</span>
                                    )}
                                </div>

                                {llmLoading && (
                                    <div aria-live="polite">
                                        <p className="text-sm mb-4" style={{ color: "var(--mayo-text-muted)" }}>
                                            위 분석 근거로 기획안을 작성하는 중입니다...
                                        </p>
                                        <MayoLoadingSpinner size="md" color="blue" label="기획안 생성 중..." />
                                    </div>
                                )}

                                {llmError && !llmLoading && (
                                    <MayoAlert type="warning">
                                        기획안을 생성하지 못했습니다: {llmError}
                                    </MayoAlert>
                                )}

                                {llmPlan && !llmLoading && (
                                    <>
                                        <p className="text-xs mb-4" style={{ color: "var(--mayo-text-muted)" }}>
                                            위 분석 근거만 입력해 생성했습니다. 수치는 모두 위 카드에서 나온 실측값입니다.
                                        </p>

                                        {llmPlan.concept && (
                                            <p className="text-sm mb-4 leading-relaxed">{llmPlan.concept}</p>
                                        )}

                                        {[
                                            { title: "프로그램 아이디어", items: llmPlan.programIdeas },
                                            { title: "차별화 포인트", items: llmPlan.differentiationPoints },
                                            { title: "유의사항", items: llmPlan.cautions },
                                        ]
                                            .filter((s) => s.items.length > 0)
                                            .map((s) => (
                                                <div key={s.title} className="mb-4 last:mb-0">
                                                    <h3 className="text-sm font-medium mb-1.5">{s.title}</h3>
                                                    <ul className="list-disc pl-5 text-sm flex flex-col gap-1" style={{ color: "var(--mayo-text-secondary)" }}>
                                                        {s.items.map((item, i) => (
                                                            <li key={i}>{item}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            ))}
                                    </>
                                )}
                            </MayoCard>
                        )}

                        {/* 화이트스페이스 상세 */}
                        <MayoCard variant="outlined" padding="md">
                            <MayoBtn
                                variant="ghost"
                                size="md"
                                type="button"
                                onClick={() => setShowWhitespace((v) => !v)}
                            >
                                화이트스페이스 상세{" "}
                                <span className="text-xs font-normal" style={{ color: "var(--mayo-text-muted)" }}>
                                    {showWhitespace ? "접기" : "펼치기"}
                                </span>
                            </MayoBtn>

                            {showWhitespace && (
                                <div className="mt-4 grid gap-6 sm:grid-cols-2">
                                    {(
                                        [
                                            ["장소", result.whitespace.venue],
                                            ["시기", result.whitespace.month],
                                            ["기간", result.whitespace.durationBucket],
                                            ["소재", result.whitespace.keyword],
                                        ] as const
                                    ).map(([label, entries]) => (
                                        <div key={label}>
                                            <h3 className="text-sm font-medium mb-2">{label}</h3>
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
                            )}
                        </MayoCard>

                        {/* 연동 상태 + 경고 */}
                        <MayoCard variant="outlined" padding="md">
                            <h2 className="text-base font-bold mb-3">데이터 연동 상태</h2>
                            <ul className="text-sm flex flex-col gap-2">
                                {(
                                    [
                                        ["TourAPI 4.0 (축제 상세 프로그램)", result.integrations.tourApi],
                                        [
                                            "전국문화축제표준데이터 (개최장소·기간·주최)",
                                            result.integrations.festivalStandard,
                                        ],
                                        ["지역 스토리 (설화·향토자산)", result.integrations.localStory],
                                        ["AI 기획안 생성", result.integrations.llm],
                                    ] as const
                                ).map(([label, status]) => (
                                    <li key={label} className="flex items-start gap-2">
                                        <span className="shrink-0">{status.enabled ? "✅" : "⬜"}</span>
                                        <span>
                                            <span className={status.enabled ? "" : ""} style={status.enabled ? {} : { color: "var(--mayo-text-muted)" }}>{label}</span>
                                            {status.reason && (
                                                <span className="block text-xs" style={{ color: "var(--mayo-text-muted)" }}>{status.reason}</span>
                                            )}
                                        </span>
                                    </li>
                                ))}
                            </ul>

                            {result.warnings.length > 0 && (
                                <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--mayo-border)" }}>
                                    <MayoAlert type="warning">
                                        <ul className="text-xs flex flex-col gap-1">
                                            {result.warnings.map((w, i) => (
                                                <li key={i}>· {w}</li>
                                            ))}
                                        </ul>
                                    </MayoAlert>
                                </div>
                            )}
                        </MayoCard>
                    </div>
                )}
            </div>
        </main>
    );
}
