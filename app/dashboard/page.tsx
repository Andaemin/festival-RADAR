"use client";

import { useState, useMemo, useEffect } from "react";
import {
    MayoSelect,
    MayoBtn,
    MayoCard,
    MayoLoadingSpinner,
    MayoAlert,
    MayoTag,
    MayoBarChart,
    MayoTable,
    MayoDivider,
    MayoPieChart,
    MayoDatePicker,
    MayoProgress,
} from "mayoui-react";

const AREA_CODES = [
    { code: "11", name: "서울특별시" },
    { code: "26", name: "부산광역시" },
    { code: "27", name: "대구광역시" },
    { code: "28", name: "인천광역시" },
    { code: "29", name: "광주광역시" },
    { code: "30", name: "대전광역시" },
    { code: "31", name: "울산광역시" },
    { code: "36", name: "세종특별자치시" },
    { code: "41", name: "경기도" },
    { code: "43", name: "충청북도" },
    { code: "44", name: "충청남도" },
    { code: "46", name: "전라남도" },
    { code: "47", name: "경상북도" },
    { code: "48", name: "경상남도" },
    { code: "50", name: "제주특별자치도" },
    { code: "51", name: "강원특별자치도" },
    { code: "52", name: "전북특별자치도" },
];

/** 시도 코드 → 짧은 라벨 매핑 (API의 regionLabel과 매칭용) */
const CODE_TO_SHORT: Record<string, string> = {
    "11": "서울", "26": "부산", "27": "대구", "28": "인천",
    "29": "광주", "30": "대전", "31": "울산", "36": "세종",
    "41": "경기", "43": "충북", "44": "충남", "46": "전남",
    "47": "경북", "48": "경남", "50": "제주", "51": "강원", "52": "전북",
};

interface VisitorProfile {
    regionLabel: string;
    localVisitors: number;
    outsiderVisitors: number;
    foreignVisitors: number;
    totalVisitors: number;
    outsiderRatio: number;
    nationalOutsiderRatio: number;
    outsiderRatioRank: number;
}

function fmtNum(n: number): string {
    if (n >= 1e8) return `${(n / 1e8).toFixed(1)}억`;
    if (n >= 1e4) return `${(n / 1e4).toFixed(0)}만`;
    return n.toLocaleString();
}

/** 현지인·외지인이 모두 0이면 데이터 이상으로 판단 */
function hasDataAnomaly(p: VisitorProfile): boolean {
    return p.localVisitors === 0 && p.outsiderVisitors === 0 && p.totalVisitors > 0;
}

export default function DashboardPage() {
    const [filterArea, setFilterArea] = useState("");
    const [visitorDate, setVisitorDate] = useState(() => {
        const now = new Date();
        const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });

    const [profiles, setProfiles] = useState<VisitorProfile[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fetched, setFetched] = useState(false);

    async function fetchData(dateStr?: string) {
        const d = dateStr ?? visitorDate;
        const parts = d.split("-");
        const year = Number(parts[0]);
        const month = Number(parts[1]);
        if (!year || !month) return;

        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/v1/visitor-stats?year=${year}&month=${month}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.message ?? "조회 실패");
            setProfiles(data.profiles ?? []);
            setFetched(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : "방문자 데이터 조회 실패");
        } finally {
            setLoading(false);
        }
    }

    // 첫 로드 시 자동 조회
    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 월 변경 시 자동 조회
    function handleDateChange(value: string) {
        setVisitorDate(value);
        fetchData(value);
    }

    // 필터된 프로필
    const filteredLabel = filterArea ? CODE_TO_SHORT[filterArea] ?? "" : "";
    const filtered = useMemo(() => {
        if (!filterArea) return profiles;
        return profiles.filter(
            (p) => p.regionLabel === filteredLabel || p.regionLabel.startsWith(filteredLabel),
        );
    }, [profiles, filterArea, filteredLabel]);

    // 전국 요약
    const summary = useMemo(() => {
        if (!profiles.length) return null;
        const totalVisitors = profiles.reduce((a, p) => a + p.totalVisitors, 0);
        const totalOutsider = profiles.reduce((a, p) => a + p.outsiderVisitors, 0);
        const totalForeign = profiles.reduce((a, p) => a + p.foreignVisitors, 0);
        const totalLocal = profiles.reduce((a, p) => a + p.localVisitors, 0);
        const avgOutsiderRatio = totalVisitors > 0 ? (totalOutsider + totalForeign) / totalVisitors : 0;
        const topRegion = [...profiles].sort((a, b) => b.totalVisitors - a.totalVisitors)[0];
        const topOutsider = [...profiles].sort((a, b) => b.outsiderRatio - a.outsiderRatio)[0];
        return { totalVisitors, totalOutsider, totalForeign, totalLocal, avgOutsiderRatio, topRegion, topOutsider };
    }, [profiles]);

    // 선택 지역 요약
    const selectedProfile = useMemo(() => {
        if (!filterArea || !profiles.length) return null;
        return profiles.find(
            (p) => p.regionLabel === filteredLabel || p.regionLabel.startsWith(filteredLabel),
        ) ?? null;
    }, [profiles, filterArea, filteredLabel]);

    // 이상 데이터 지역 목록
    const anomalyRegions = useMemo(() => {
        return new Set(profiles.filter(hasDataAnomaly).map((p) => p.regionLabel));
    }, [profiles]);

    // 차트 데이터 — 전국 or 필터
    const barData = useMemo(() => {
        const src = filterArea ? filtered : [...profiles].sort((a, b) => b.totalVisitors - a.totalVisitors);
        return src.map((p) => ({
            label: anomalyRegions.has(p.regionLabel) ? `${p.regionLabel} ⚠` : p.regionLabel,
            총방문자: Math.round(p.totalVisitors / 1e4),
            외지인: Math.round(p.outsiderVisitors / 1e4),
            외국인: Math.round(p.foreignVisitors / 1e4),
        }));
    }, [profiles, filtered, filterArea, anomalyRegions]);

    const ratioData = useMemo(() => {
        const src = filterArea ? filtered : [...profiles].sort((a, b) => b.outsiderRatio - a.outsiderRatio);
        return src.map((p) => ({
            label: anomalyRegions.has(p.regionLabel) ? `${p.regionLabel} ⚠` : p.regionLabel,
            외지인비율: Math.round(p.outsiderRatio * 1000) / 10,
        }));
    }, [profiles, filtered, filterArea, anomalyRegions]);

    // 파이 차트 — 선택 지역 or 전국 Top 5
    const pieData = useMemo(() => {
        if (selectedProfile) {
            const anomaly = hasDataAnomaly(selectedProfile);
            return [
                { label: "현지인", value: selectedProfile.localVisitors, color: anomaly ? "#fbbf24" : "#2e8af2" },
                { label: "외지인", value: selectedProfile.outsiderVisitors, color: anomaly ? "#f59e0b" : "#8b5cf6" },
                { label: "외국인", value: selectedProfile.foreignVisitors, color: anomaly ? "#d97706" : "#f97316" },
            ];
        }
        if (!profiles.length) return [];
        const top5 = [...profiles].sort((a, b) => b.totalVisitors - a.totalVisitors).slice(0, 5);
        const colors = ["#2e8af2", "#8b5cf6", "#f97316", "#10b981", "#ef4444"];
        return top5.map((p, i) => ({
            label: p.regionLabel,
            value: p.totalVisitors,
            color: colors[i],
        }));
    }, [profiles, selectedProfile]);

    const selectedAreaName = AREA_CODES.find((a) => a.code === filterArea)?.name ?? "";
    const displayTitle = filterArea ? `${selectedAreaName} 관광 수요` : "전국 관광 수요 강도";

    // 조회 중인 년·월 라벨
    const dateParts = visitorDate.split("-");
    const displayYear = dateParts[0];
    const displayMonth = Number(dateParts[1]);

    // 지역 필터 시 전국 대비 비교 데이터
    const comparisonData = useMemo(() => {
        if (!filterArea || !selectedProfile || !summary) return null;
        const nationalAvgTotal = summary.totalVisitors / profiles.length;
        const nationalAvgOutsider = summary.totalOutsider / profiles.length;
        const nationalAvgForeign = summary.totalForeign / profiles.length;
        return {
            totalVsNational: nationalAvgTotal > 0 ? selectedProfile.totalVisitors / nationalAvgTotal : 0,
            outsiderVsNational: nationalAvgOutsider > 0 ? selectedProfile.outsiderVisitors / nationalAvgOutsider : 0,
            foreignVsNational: nationalAvgForeign > 0 ? selectedProfile.foreignVisitors / nationalAvgForeign : 0,
            nationalAvgRatio: summary.avgOutsiderRatio,
        };
    }, [filterArea, selectedProfile, summary, profiles.length]);

    return (
        <main className="min-h-screen flex flex-col p-4 lg:p-5 gap-4" style={{ background: "var(--mayo-bg-subtle)" }}>
            {/* 헤더 */}
            <header>
                <h1 className="text-xl font-bold" style={{ color: "var(--mayo-text)" }}>대시보드</h1>
                <p className="text-sm mt-0.5" style={{ color: "var(--mayo-text-muted)" }}>
                    한국관광공사 빅데이터 지역별 방문자수(KT·SKT 이동통신 실측) 기반 시도별 관광 수요 현황
                </p>
                <MayoDivider />
            </header>

            {/* 필터 바 */}
            <div
                className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
                style={{ background: "var(--mayo-surface)", border: "1px solid var(--mayo-border)", borderRadius: 8, padding: "12px 16px" }}
            >
                <MayoSelect
                    label="지역 필터"
                    size="sm"
                    placeholder="전국 (전체)"
                    value={filterArea}
                    onChange={(e) => setFilterArea(e.target.value)}
                    options={[
                        { value: "", label: "전국 (전체)" },
                        ...AREA_CODES.map((a) => ({ value: a.code, label: a.name })),
                    ]}
                />
                <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: "var(--mayo-text-muted)" }}>조회 월</label>
                    <MayoDatePicker
                        value={visitorDate}
                        onChange={handleDateChange}
                        placeholder="조회할 월 선택"
                        mode="month"
                    />
                </div>
                <MayoBtn
                    variant="primary"
                    size="sm"
                    color="blue"
                    onClick={() => fetchData()}
                    disabled={loading}
                    className="w-full"
                >
                    {loading ? "불러오는 중..." : "조회"}
                </MayoBtn>
            </div>

            {/* 로딩 */}
            {loading && (
                <div className="flex justify-center py-12">
                    <MayoLoadingSpinner size="md" color="blue" label="방문자 데이터를 불러오는 중..." />
                </div>
            )}

            {/* 에러 */}
            {error && <MayoAlert type="error" title="오류">{error}</MayoAlert>}

            {/* 데이터 있을 때 */}
            {!loading && fetched && profiles.length > 0 && (
                <>
                    {/* 요약 메트릭 카드 */}
                    {!filterArea && summary && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <MetricBox label="전국 총 방문자" value={fmtNum(summary.totalVisitors)} sub={`외지인 ${fmtNum(summary.totalOutsider)} · 외국인 ${fmtNum(summary.totalForeign)}`} />
                            <MetricBox
                                label="전국 평균 외지인 비율"
                                value={`${(summary.avgOutsiderRatio * 100).toFixed(1)}%`}
                            />
                            <MetricBox
                                label="방문자 1위"
                                value={summary.topRegion?.regionLabel ?? "-"}
                                sub={`${fmtNum(summary.topRegion?.totalVisitors ?? 0)}명`}
                                tagColor="blue"
                                tagLabel="방문자 최다"
                            />
                            <MetricBox
                                label="외지인 비율 1위"
                                value={summary.topOutsider?.regionLabel ?? "-"}
                                sub={`${(summary.topOutsider?.outsiderRatio * 100).toFixed(1) ?? 0}%`}
                                tagColor="purple"
                                tagLabel="유입력 최고"
                            />
                        </div>
                    )}

                    {/* 선택 지역 메트릭 */}
                    {filterArea && selectedProfile && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <MetricBox label="지역" value={selectedAreaName} sub={`전국 외지인 비율 ${selectedProfile.outsiderRatioRank}위 / 17개 시도`} />
                            <MetricBox label="총 방문자" value={fmtNum(selectedProfile.totalVisitors)} sub={`현지인 ${fmtNum(selectedProfile.localVisitors)}`} />
                            <MetricBox label="외지인" value={fmtNum(selectedProfile.outsiderVisitors)} sub={`비율 ${(selectedProfile.outsiderRatio * 100).toFixed(1)}%`} tagColor="purple" tagLabel={selectedProfile.outsiderRatio > 0.5 ? "높음" : selectedProfile.outsiderRatio > 0.3 ? "보통" : "낮음"} />
                            <MetricBox label="외국인" value={fmtNum(selectedProfile.foreignVisitors)} />
                        </div>
                    )}

                    {/* 차트 영역 */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* 방문자 수 — 전국: 바 차트 / 특정 지역: 프로그레스 바 */}
                        <MayoCard variant="outlined" padding="md">
                            <p className="text-sm font-semibold mb-2" style={{ color: "var(--mayo-text)" }}>{displayTitle} — 방문자 수 {filterArea ? "" : "(만명)"}</p>
                            {filterArea && selectedProfile ? (
                                <div className="flex flex-col gap-4 py-2">
                                    {hasDataAnomaly(selectedProfile) && (
                                        <MayoAlert type="warning" title="데이터 주의">
                                            현지인·외지인 수치가 0으로, 해당 월 데이터가 불완전할 수 있습니다.
                                        </MayoAlert>
                                    )}
                                    <VisitorProgressRow
                                        label="총 방문자"
                                        value={selectedProfile.totalVisitors}
                                        max={selectedProfile.totalVisitors}
                                        color="blue"
                                        warn={hasDataAnomaly(selectedProfile)}
                                    />
                                    <VisitorProgressRow
                                        label="현지인"
                                        value={selectedProfile.localVisitors}
                                        max={selectedProfile.totalVisitors}
                                        color="green"
                                        warn={hasDataAnomaly(selectedProfile) && selectedProfile.localVisitors === 0}
                                    />
                                    <VisitorProgressRow
                                        label="외지인"
                                        value={selectedProfile.outsiderVisitors}
                                        max={selectedProfile.totalVisitors}
                                        color="purple"
                                        warn={hasDataAnomaly(selectedProfile) && selectedProfile.outsiderVisitors === 0}
                                    />
                                    <VisitorProgressRow
                                        label="외국인"
                                        value={selectedProfile.foreignVisitors}
                                        max={selectedProfile.totalVisitors}
                                        color="red"
                                    />
                                </div>
                            ) : (
                                <MayoBarChart
                                    data={barData}
                                    series={[
                                        { key: "외지인", color: "#8b5cf6", label: "외지인(만)" },
                                        { key: "외국인", color: "#f97316", label: "외국인(만)" },
                                        { key: "총방문자", color: "#2e8af2", label: "총방문자(만)" },
                                    ]}
                                    height={340}
                                    showGrid
                                    showLegend
                                />
                            )}
                        </MayoCard>

                        {/* 외지인 비율 — 전국: 바 차트 / 특정 지역: 전국 대비 비교 */}
                        <MayoCard variant="outlined" padding="md">
                            <p className="text-sm font-semibold mb-2" style={{ color: "var(--mayo-text)" }}>
                                {displayTitle} — {filterArea ? "전국 평균 대비" : "외지인 비율 (%)"}
                            </p>
                            {filterArea && selectedProfile && comparisonData ? (
                                <div className="flex flex-col gap-5 py-2">
                                    <ComparisonRow
                                        label="총 방문자"
                                        ratio={comparisonData.totalVsNational}
                                        color="#2e8af2"
                                    />
                                    <ComparisonRow
                                        label="외지인 수"
                                        ratio={comparisonData.outsiderVsNational}
                                        color="#8b5cf6"
                                    />
                                    <ComparisonRow
                                        label="외국인 수"
                                        ratio={comparisonData.foreignVsNational}
                                        color="#f97316"
                                    />
                                    <div className="mt-1 pt-3" style={{ borderTop: "1px solid var(--mayo-border)" }}>
                                        <div className="flex justify-between items-center text-sm">
                                            <span style={{ color: "var(--mayo-text-muted)" }}>외지인 비율</span>
                                            <span>
                                                <strong style={{ color: "var(--mayo-text)", fontSize: "1rem" }}>
                                                    {(selectedProfile.outsiderRatio * 100).toFixed(1)}%
                                                </strong>
                                                <span className="ml-2 text-xs" style={{ color: "var(--mayo-text-muted)" }}>
                                                    (전국 평균 {(comparisonData.nationalAvgRatio * 100).toFixed(1)}%)
                                                </span>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <MayoBarChart
                                        data={ratioData}
                                        series={[
                                            { key: "외지인비율", color: "#10b981", label: "외지인 비율(%)" },
                                        ]}
                                        height={340}
                                        showGrid
                                        showLegend
                                    />
                                    {anomalyRegions.size > 0 && (
                                        <p className="text-xs mt-2" style={{ color: "#f59e0b" }}>
                                            ⚠ 일부 지역({[...anomalyRegions].join(", ")})은 현지인·외지인 데이터가 0으로 비율이 부정확할 수 있습니다.
                                        </p>
                                    )}
                                </>
                            )}
                        </MayoCard>
                    </div>

                    {/* 파이 차트 + 인사이트 */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <MayoCard variant="outlined" padding="md">
                            <p className="text-sm font-semibold mb-2" style={{ color: "var(--mayo-text)" }}>
                                {selectedProfile ? `${selectedAreaName} 방문자 구성` : "방문자 수 상위 5개 시도"}
                            </p>
                            <div className="flex justify-center">
                                <MayoPieChart data={pieData} size={200} showLegend />
                            </div>
                            {selectedProfile && hasDataAnomaly(selectedProfile) && (
                                <p className="text-xs mt-2" style={{ color: "#f59e0b" }}>
                                    ⚠ 현지인·외지인 데이터가 0으로 구성 비율이 부정확할 수 있습니다.
                                </p>
                            )}
                        </MayoCard>

                        <MayoCard variant="outlined" padding="md">
                            <p className="text-sm font-semibold mb-2" style={{ color: "var(--mayo-text)" }}>
                                인사이트 — {displayYear}년 {displayMonth}월
                            </p>
                            <div className="flex flex-col gap-3" style={{ color: "var(--mayo-text)" }}>
                                {selectedProfile ? (
                                    <>
                                        <InsightRow
                                            emoji="📍"
                                            content={<>{displayYear}년 {displayMonth}월 {selectedAreaName}의 총 방문자는 <Hl>{fmtNum(selectedProfile.totalVisitors)}명</Hl>입니다.</>}
                                        />
                                        <InsightRow
                                            emoji="🧳"
                                            content={<>외지인 비율 <Hl>{(selectedProfile.outsiderRatio * 100).toFixed(1)}%</Hl>로 전국 <Hl>{selectedProfile.outsiderRatioRank}위</Hl>입니다.</>}
                                        />
                                        <InsightRow
                                            emoji={selectedProfile.outsiderRatio > selectedProfile.nationalOutsiderRatio ? "🔥" : "💡"}
                                            content={
                                                selectedProfile.outsiderRatio > selectedProfile.nationalOutsiderRatio
                                                    ? <>전국 평균보다 외지인 비율이 <Hl color="#10b981">높아</Hl> 관광 유입이 활발한 지역입니다.</>
                                                    : <>전국 평균보다 외지인 비율이 <Hl color="#ef4444">낮아</Hl>, 외부 관광객 유치 전략이 필요합니다.</>
                                            }
                                        />
                                        <InsightRow
                                            emoji="🌍"
                                            content={<>외국인 방문자는 <Hl>{fmtNum(selectedProfile.foreignVisitors)}명</Hl>으로 전체의 <Hl>{((selectedProfile.foreignVisitors / selectedProfile.totalVisitors) * 100).toFixed(1)}%</Hl>를 차지합니다.</>}
                                        />
                                    </>
                                ) : summary ? (
                                    <>
                                        <InsightRow
                                            emoji="📊"
                                            content={<>{displayYear}년 {displayMonth}월 전국 총 방문자는 <Hl>{fmtNum(summary.totalVisitors)}명</Hl>입니다.</>}
                                        />
                                        <InsightRow
                                            emoji="🏆"
                                            content={<>방문자 수 1위는 <Hl>{summary.topRegion?.regionLabel}</Hl>(<Hl>{fmtNum(summary.topRegion?.totalVisitors ?? 0)}명</Hl>)입니다.</>}
                                        />
                                        <InsightRow
                                            emoji="🧳"
                                            content={<>외지인 비율 1위는 <Hl>{summary.topOutsider?.regionLabel}</Hl>(<Hl>{(summary.topOutsider?.outsiderRatio * 100).toFixed(1)}%</Hl>)입니다.</>}
                                        />
                                        <InsightRow
                                            emoji="💡"
                                            content={<>상단의 지역 필터에서 시도를 선택하면 해당 지역의 상세 분석을 확인할 수 있습니다.</>}
                                        />
                                    </>
                                ) : null}
                            </div>
                        </MayoCard>
                    </div>

                    {/* 상세 테이블 */}
                    <MayoCard variant="outlined" padding="md">
                        <p className="text-sm font-semibold mb-2" style={{ color: "var(--mayo-text)" }}>
                            {filterArea ? `${selectedAreaName} 상세` : "시도별 방문자 상세"}
                        </p>
                        <MayoTable
                            columns={[
                                { key: "regionLabel", label: "시도", sortable: true },
                                { key: "totalVisitors", label: "총 방문자", sortable: true, render: (v: unknown, row: Record<string, unknown>) => {
                                    const anomaly = Number(row.localVisitors) === 0 && Number(row.outsiderVisitors) === 0 && Number(v) > 0;
                                    return <span style={anomaly ? { color: "#f59e0b" } : undefined}>{fmtNum(Number(v))}{anomaly ? " ⚠" : ""}</span>;
                                }},
                                { key: "localVisitors", label: "현지인", sortable: true, render: (v: unknown) => fmtNum(Number(v)) },
                                { key: "outsiderVisitors", label: "외지인", sortable: true, render: (v: unknown) => fmtNum(Number(v)) },
                                { key: "foreignVisitors", label: "외국인", sortable: true, render: (v: unknown) => fmtNum(Number(v)) },
                                {
                                    key: "outsiderRatio",
                                    label: "외지인 비율 ⓘ",
                                    width: 150,
                                    sortable: true,
                                    render: (v: unknown) => {
                                        const n = Number(v);
                                        const pct = (n * 100).toFixed(1);
                                        const color = n > 0.5 ? "purple" : n > 0.3 ? "blue" : "gray";
                                        return (
                                            <div className="flex items-center gap-1" title="(외지인 + 외국인) / 총 방문자">
                                                <span>{pct}%</span>
                                                <MayoTag color={color as "purple" | "blue" | "gray"} variant="soft" size="sm">
                                                    {n > 0.5 ? "높음" : n > 0.3 ? "보통" : "낮음"}
                                                </MayoTag>
                                            </div>
                                        );
                                    },
                                },
                                { key: "outsiderRatioRank", label: "순위", width: 70, sortable: true },
                            ]}
                            data={
                                (filterArea
                                    ? filtered
                                    : [...profiles].sort((a, b) => a.outsiderRatioRank - b.outsiderRatioRank)
                                ) as unknown as Record<string, unknown>[]
                            }
                            rowKey="regionLabel"
                            striped
                            bordered
                        />
                        <p className="text-xs mt-2" style={{ color: "var(--mayo-text-muted)" }}>
                            ⓘ 외지인 비율 = (외지인 + 외국인) / 총 방문자. 외지인과 외국인을 합산한 외부 유입 비율입니다.
                        </p>
                    </MayoCard>
                </>
            )}

            {/* 데이터 없을 때 안내 */}
            {!loading && fetched && profiles.length === 0 && !error && (
                <MayoAlert type="info" title="데이터 없음">
                    해당 월의 방문자 데이터가 없습니다. 다른 월을 선택해 주세요.
                </MayoAlert>
            )}

            {!loading && !fetched && !error && (
                <MayoAlert type="info" title="데이터 로딩 중">
                    방문자 데이터를 불러오고 있습니다...
                </MayoAlert>
            )}
        </main>
    );
}

function MetricBox({ label, value, sub, tagColor, tagLabel }: {
    label: string;
    value: string;
    sub?: string;
    tagColor?: "green" | "blue" | "purple" | "red" | "gray";
    tagLabel?: string;
}) {
    return (
        <div style={{ background: "var(--mayo-surface)", border: "1px solid var(--mayo-border)", borderRadius: 8, padding: "10px 14px" }}>
            <p className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>{label}</p>
            <div className="flex items-center gap-2 mt-0.5">
                <p className="text-lg font-bold truncate" style={{ color: "var(--mayo-text)" }}>{value}</p>
                {tagColor && tagLabel && <MayoTag color={tagColor} variant="soft" size="sm">{tagLabel}</MayoTag>}
            </div>
            {sub && <p className="text-xs mt-0.5" style={{ color: "var(--mayo-text-muted)" }}>{sub}</p>}
        </div>
    );
}

function InsightRow({ emoji, content }: { emoji: string; content: React.ReactNode }) {
    return (
        <div className="flex items-start gap-2.5 text-[0.9rem] leading-relaxed">
            <span className="shrink-0 text-base">{emoji}</span>
            <span>{content}</span>
        </div>
    );
}

function Hl({ children, color }: { children: React.ReactNode; color?: string }) {
    return (
        <strong style={{ color: color ?? "var(--mayo-text)", fontWeight: 700 }}>{children}</strong>
    );
}

function ComparisonRow({ label, ratio, color }: { label: string; ratio: number; color: string }) {
    const pct = Math.min(ratio * 100, 200);
    const display = ratio >= 10 ? `${ratio.toFixed(0)}x` : `${ratio.toFixed(1)}x`;
    return (
        <div>
            <div className="flex justify-between items-center mb-1.5">
                <span className="text-sm font-medium" style={{ color: "var(--mayo-text)" }}>{label}</span>
                <span className="text-sm font-bold" style={{ color }}>
                    전국 평균 대비 {display}
                </span>
            </div>
            <div className="w-full h-2 rounded-full" style={{ background: "var(--mayo-bg-subtle)" }}>
                <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(pct / 2, 100)}%`, background: color, opacity: 0.8 }}
                />
            </div>
            <div className="flex justify-between mt-0.5">
                <span className="text-[10px]" style={{ color: "var(--mayo-text-muted)" }}>0x</span>
                <span className="text-[10px]" style={{ color: "var(--mayo-text-muted)" }}>전국 평균 (1x)</span>
                <span className="text-[10px]" style={{ color: "var(--mayo-text-muted)" }}>2x</span>
            </div>
        </div>
    );
}

function VisitorProgressRow({ label, value, max, color, warn }: {
    label: string;
    value: number;
    max: number;
    color: "blue" | "green" | "purple" | "red";
    warn?: boolean;
}) {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    return (
        <div>
            <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium" style={{ color: warn ? "#f59e0b" : "var(--mayo-text)" }}>
                    {label}{warn ? " ⚠" : ""}
                </span>
                <span className="text-sm" style={{ color: warn ? "#f59e0b" : "var(--mayo-text-muted)" }}>
                    {fmtNum(value)}명 ({pct}%)
                </span>
            </div>
            {warn ? (
                <div className="w-full h-2.5 rounded-full" style={{ background: "var(--mayo-bg-subtle)" }}>
                    <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(pct, 2)}%`, background: "#f59e0b" }}
                    />
                </div>
            ) : (
                <MayoProgress value={pct} max={100} color={color} size="md" />
            )}
        </div>
    );
}
