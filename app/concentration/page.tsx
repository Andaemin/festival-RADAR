"use client";

import { useState, useMemo } from "react";
import {
    MayoSelect,
    MayoBtn,
    MayoCard,
    MayoLoadingSpinner,
    MayoAlert,
    MayoTag,
    MayoBarChart,
    MayoLineChart,
    MayoTable,
    MayoDivider,
    MayoProgress,
    MayoAccordion,
} from "mayoui-react";

/** 시도 코드 */
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

/** 시군구 코드 */
const SIGNGU_CODES: Record<string, { code: string; name: string }[]> = {
    "11": [
        { code: "11110", name: "종로구" }, { code: "11140", name: "중구" },
        { code: "11170", name: "용산구" }, { code: "11200", name: "성동구" },
        { code: "11215", name: "광진구" }, { code: "11230", name: "동대문구" },
        { code: "11260", name: "중랑구" }, { code: "11290", name: "성북구" },
        { code: "11305", name: "강북구" }, { code: "11320", name: "도봉구" },
        { code: "11350", name: "노원구" }, { code: "11380", name: "은평구" },
        { code: "11410", name: "서대문구" }, { code: "11440", name: "마포구" },
        { code: "11470", name: "양천구" }, { code: "11500", name: "강서구" },
        { code: "11530", name: "구로구" }, { code: "11545", name: "금천구" },
        { code: "11560", name: "영등포구" }, { code: "11590", name: "동작구" },
        { code: "11620", name: "관악구" }, { code: "11650", name: "서초구" },
        { code: "11680", name: "강남구" }, { code: "11710", name: "송파구" },
        { code: "11740", name: "강동구" },
    ],
    "26": [
        { code: "26110", name: "중구" }, { code: "26140", name: "서구" },
        { code: "26170", name: "동구" }, { code: "26200", name: "영도구" },
        { code: "26230", name: "부산진구" }, { code: "26260", name: "동래구" },
        { code: "26290", name: "남구" }, { code: "26320", name: "북구" },
        { code: "26350", name: "해운대구" }, { code: "26380", name: "사하구" },
        { code: "26410", name: "금정구" }, { code: "26440", name: "강서구" },
        { code: "26470", name: "연제구" }, { code: "26500", name: "수영구" },
        { code: "26530", name: "사상구" }, { code: "26710", name: "기장군" },
    ],
    "27": [
        { code: "27110", name: "중구" }, { code: "27140", name: "동구" },
        { code: "27170", name: "서구" }, { code: "27200", name: "남구" },
        { code: "27230", name: "북구" }, { code: "27260", name: "수성구" },
        { code: "27290", name: "달서구" }, { code: "27710", name: "달성군" },
    ],
    "28": [
        { code: "28110", name: "중구" }, { code: "28140", name: "동구" },
        { code: "28177", name: "미추홀구" }, { code: "28185", name: "연수구" },
        { code: "28200", name: "남동구" }, { code: "28237", name: "부평구" },
        { code: "28245", name: "계양구" }, { code: "28260", name: "서구" },
        { code: "28710", name: "강화군" }, { code: "28720", name: "옹진군" },
    ],
    "29": [
        { code: "29110", name: "동구" }, { code: "29140", name: "서구" },
        { code: "29155", name: "남구" }, { code: "29170", name: "북구" },
        { code: "29200", name: "광산구" },
    ],
    "30": [
        { code: "30110", name: "동구" }, { code: "30140", name: "중구" },
        { code: "30170", name: "서구" }, { code: "30200", name: "유성구" },
        { code: "30230", name: "대덕구" },
    ],
    "31": [
        { code: "31110", name: "중구" }, { code: "31140", name: "남구" },
        { code: "31170", name: "동구" }, { code: "31200", name: "북구" },
        { code: "31710", name: "울주군" },
    ],
    "36": [{ code: "36110", name: "세종특별자치시" }],
    "41": [
        { code: "41111", name: "수원시 장안구" }, { code: "41113", name: "수원시 권선구" },
        { code: "41115", name: "수원시 팔달구" }, { code: "41117", name: "수원시 영통구" },
        { code: "41131", name: "성남시 수정구" }, { code: "41133", name: "성남시 중원구" },
        { code: "41135", name: "성남시 분당구" }, { code: "41150", name: "의정부시" },
        { code: "41171", name: "안양시 만안구" }, { code: "41173", name: "안양시 동안구" },
        { code: "41190", name: "부천시" }, { code: "41210", name: "광명시" },
        { code: "41220", name: "평택시" }, { code: "41281", name: "고양시 덕양구" },
        { code: "41285", name: "고양시 일산동구" }, { code: "41287", name: "고양시 일산서구" },
        { code: "41360", name: "남양주시" }, { code: "41390", name: "시흥시" },
        { code: "41461", name: "용인시 처인구" }, { code: "41463", name: "용인시 기흥구" },
        { code: "41465", name: "용인시 수지구" }, { code: "41480", name: "파주시" },
        { code: "41570", name: "김포시" }, { code: "41590", name: "화성시" },
        { code: "41610", name: "광주시" }, { code: "41820", name: "가평군" },
        { code: "41830", name: "양평군" },
    ],
    "43": [
        { code: "43111", name: "청주시 상당구" }, { code: "43112", name: "청주시 서원구" },
        { code: "43113", name: "청주시 흥덕구" }, { code: "43114", name: "청주시 청원구" },
        { code: "43130", name: "충주시" }, { code: "43150", name: "제천시" },
        { code: "43720", name: "보은군" }, { code: "43730", name: "옥천군" },
        { code: "43810", name: "단양군" },
    ],
    "44": [
        { code: "44131", name: "천안시 동남구" }, { code: "44133", name: "천안시 서북구" },
        { code: "44150", name: "공주시" }, { code: "44180", name: "보령시" },
        { code: "44200", name: "아산시" }, { code: "44210", name: "서산시" },
        { code: "44230", name: "논산시" }, { code: "44270", name: "당진시" },
        { code: "44760", name: "부여군" }, { code: "44825", name: "태안군" },
    ],
    "46": [
        { code: "46110", name: "목포시" }, { code: "46130", name: "여수시" },
        { code: "46150", name: "순천시" }, { code: "46170", name: "나주시" },
        { code: "46730", name: "구례군" }, { code: "46800", name: "완도군" },
        { code: "46860", name: "해남군" }, { code: "46810", name: "진도군" },
    ],
    "47": [
        { code: "47111", name: "포항시 남구" }, { code: "47113", name: "포항시 북구" },
        { code: "47130", name: "경주시" }, { code: "47150", name: "김천시" },
        { code: "47170", name: "안동시" }, { code: "47190", name: "구미시" },
        { code: "47210", name: "영주시" }, { code: "47280", name: "문경시" },
        { code: "47930", name: "울진군" },
    ],
    "48": [
        { code: "48121", name: "창원시 의창구" }, { code: "48123", name: "창원시 성산구" },
        { code: "48125", name: "창원시 마산합포구" }, { code: "48170", name: "진주시" },
        { code: "48220", name: "통영시" }, { code: "48250", name: "김해시" },
        { code: "48310", name: "거제시" }, { code: "48840", name: "남해군" },
        { code: "48850", name: "하동군" },
    ],
    "50": [
        { code: "50110", name: "제주시" }, { code: "50130", name: "서귀포시" },
    ],
    "51": [
        { code: "51110", name: "춘천시" }, { code: "51130", name: "원주시" },
        { code: "51150", name: "강릉시" }, { code: "51170", name: "동해시" },
        { code: "51190", name: "태백시" }, { code: "51210", name: "속초시" },
        { code: "51760", name: "평창군" }, { code: "51770", name: "정선군" },
        { code: "51810", name: "인제군" }, { code: "51820", name: "고성군" },
        { code: "51830", name: "양양군" },
    ],
    "52": [
        { code: "52111", name: "전주시 완산구" }, { code: "52113", name: "전주시 덕진구" },
        { code: "52130", name: "군산시" }, { code: "52140", name: "익산시" },
        { code: "52190", name: "남원시" }, { code: "52730", name: "무주군" },
        { code: "52790", name: "고창군" }, { code: "52800", name: "부안군" },
    ],
};

interface ConcentrationItem {
    baseYmd: string;
    areaCd: string;
    areaNm: string;
    signguCd: string;
    signguNm: string;
    tAtsNm: string;
    cnctrRate: string;
}

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

function formatDate(ymd: string) {
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function getRateLevel(rate: number): { label: string; color: "green" | "blue" | "purple" | "red" } {
    if (rate < 30) return { label: "여유", color: "green" };
    if (rate < 60) return { label: "보통", color: "blue" };
    if (rate < 80) return { label: "혼잡", color: "purple" };
    return { label: "매우혼잡", color: "red" };
}

function getDayLabel(ymd: string) {
    const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`);
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return days[d.getDay()];
}

function fmtNum(n: number): string {
    if (n >= 1e8) return `${(n / 1e8).toFixed(1)}억`;
    if (n >= 1e4) return `${(n / 1e4).toFixed(0)}만`;
    return n.toLocaleString();
}

export default function ConcentrationPage() {
    const [areaCd, setAreaCd] = useState("");
    const [signguCd, setSignguCd] = useState("");
    const [selectedAttraction, setSelectedAttraction] = useState("");
    const [loading, setLoading] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [allItems, setAllItems] = useState<ConcentrationItem[]>([]);
    const [totalCount, setTotalCount] = useState(0);

    // visitor stats
    const [visitorProfiles, setVisitorProfiles] = useState<VisitorProfile[]>([]);
    const [visitorLoading, setVisitorLoading] = useState(false);
    const [visitorError, setVisitorError] = useState<string | null>(null);
    const [visitorMonth, setVisitorMonth] = useState(() => {
        const now = new Date();
        // default to 2 months ago (data may lag)
        const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });

    const districts = SIGNGU_CODES[areaCd] ?? [];

    async function handleSearch() {
        if (!areaCd || !signguCd) {
            setError("시도와 시군구를 선택해주세요.");
            return;
        }
        setError(null);
        setLoading(true);
        setLoadingProgress(0);
        setAllItems([]);
        setSelectedAttraction("");

        // progress animation
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

        try {
            const params = new URLSearchParams({ areaCd, signguCd, numOfRows: "1000" });
            const res = await fetch(`/api/v1/concentration?${params}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.message ?? "조회 실패");

            setAllItems(data.items);
            setTotalCount(data.totalCount);
            setLoadingProgress(100);
            if (data.items.length === 0) {
                setError("해당 지역의 관광지 데이터가 없습니다.");
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
        } finally {
            cancelAnimationFrame(frame);
            setLoading(false);
        }
    }

    async function handleVisitorFetch() {
        const [yearStr, monthStr] = visitorMonth.split("-");
        const year = Number(yearStr);
        const month = Number(monthStr);
        if (!year || !month) return;

        setVisitorLoading(true);
        setVisitorError(null);
        try {
            const res = await fetch(`/api/v1/visitor-stats?year=${year}&month=${month}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.message ?? "조회 실패");
            setVisitorProfiles(data.profiles ?? []);
        } catch (e) {
            setVisitorError(e instanceof Error ? e.message : "방문자 데이터 조회 실패");
        } finally {
            setVisitorLoading(false);
        }
    }

    // 관광지 목록 (고유)
    const attractions = useMemo(() => {
        const set = new Set(allItems.map((i) => i.tAtsNm));
        return [...set].sort();
    }, [allItems]);

    // 선택된 관광지의 데이터만 필터
    const items = useMemo(() => {
        if (!selectedAttraction) return [];
        return allItems.filter((i) => i.tAtsNm === selectedAttraction);
    }, [allItems, selectedAttraction]);

    // 관광지별 평균 집중률
    const attractionAvg = useMemo(() => {
        const map = new Map<string, number[]>();
        for (const item of allItems) {
            const arr = map.get(item.tAtsNm) ?? [];
            arr.push(Number(item.cnctrRate));
            map.set(item.tAtsNm, arr);
        }
        return [...map.entries()]
            .map(([name, rates]) => ({
                name,
                avg: rates.reduce((a, b) => a + b, 0) / rates.length,
                max: Math.max(...rates),
                min: Math.min(...rates),
                count: rates.length,
            }))
            .sort((a, b) => b.avg - a.avg);
    }, [allItems]);

    // 선택된 관광지의 일별 집중률 (라인 차트용)
    const dailyAvg = useMemo(() => {
        return items
            .map((item) => ({
                label: `${item.baseYmd.slice(4, 6)}/${item.baseYmd.slice(6, 8)}(${getDayLabel(item.baseYmd)})`,
                집중률: Math.round(Number(item.cnctrRate) * 10) / 10,
                _ymd: item.baseYmd,
            }))
            .sort((a, b) => a._ymd.localeCompare(b._ymd));
    }, [items]);

    // 요약 통계
    const summary = useMemo(() => {
        if (items.length === 0) return null;
        const rates = items.map((i) => Number(i.cnctrRate));
        const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
        const max = Math.max(...rates);
        const min = Math.min(...rates);
        const maxItem = items.find((i) => Number(i.cnctrRate) === max);
        return { avg, max, min, maxItem, attractionCount: attractions.length, days: items.length };
    }, [items, attractions]);

    // 관광지별 바 차트 (평균 집중률 상위 10개)
    const attractionBarData = useMemo(() => {
        return attractionAvg.slice(0, 10).map((a) => ({
            label: a.name.length > 8 ? a.name.slice(0, 7) + "…" : a.name,
            평균: Math.round(a.avg * 10) / 10,
            최대: Math.round(a.max * 10) / 10,
        }));
    }, [attractionAvg]);

    // 테이블 데이터
    const tableData = useMemo(() => {
        return attractionAvg.map((a, i) => ({
            rank: i + 1,
            name: a.name,
            avg: Math.round(a.avg * 10) / 10,
            max: Math.round(a.max * 10) / 10,
            min: Math.round(a.min * 10) / 10,
            days: a.count,
        }));
    }, [attractionAvg]);

    // visitor chart data
    const visitorBarData = useMemo(() => {
        if (!visitorProfiles.length) return [];
        return [...visitorProfiles]
            .sort((a, b) => b.totalVisitors - a.totalVisitors)
            .map((p) => ({
                label: p.regionLabel,
                총방문자: Math.round(p.totalVisitors / 1e4),
                외지인: Math.round(p.outsiderVisitors / 1e4),
                외국인: Math.round(p.foreignVisitors / 1e4),
            }));
    }, [visitorProfiles]);

    const outsiderRatioData = useMemo(() => {
        if (!visitorProfiles.length) return [];
        return [...visitorProfiles]
            .sort((a, b) => b.outsiderRatio - a.outsiderRatio)
            .map((p) => ({
                label: p.regionLabel,
                외지인비율: Math.round(p.outsiderRatio * 1000) / 10,
            }));
    }, [visitorProfiles]);

    const selectedAreaName = AREA_CODES.find((a) => a.code === areaCd)?.name ?? "";
    const selectedSignguName = districts.find((d) => d.code === signguCd)?.name ?? "";

    // highlight the selected area in visitor data
    const selectedAreaProfile = useMemo(() => {
        if (!visitorProfiles.length || !selectedAreaName) return null;
        return visitorProfiles.find((p) => selectedAreaName.startsWith(p.regionLabel) || p.regionLabel.startsWith(selectedAreaName.slice(0, 2)));
    }, [visitorProfiles, selectedAreaName]);

    return (
        <main className="min-h-screen flex flex-col p-4 lg:p-5 gap-4" style={{ background: "var(--mayo-bg-subtle)" }}>
            {/* 헤더 */}
            <header>
                <h1 className="text-xl font-bold" style={{ color: "var(--mayo-text)" }}>
                    관광지 집중률 예측
                </h1>
                <p className="text-sm mt-0.5" style={{ color: "var(--mayo-text-muted)" }}>
                    한국관광공사 빅데이터 기반 향후 30일간 관광지별 방문자 집중률 예측 분석
                </p>
                <MayoDivider />
            </header>

            {/* 검색 폼 — 한 줄 그리드 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end" style={{ background: "var(--mayo-surface)", border: "1px solid var(--mayo-border)", borderRadius: 8, padding: "12px 16px" }}>
                <MayoSelect
                    label="시도"
                    size="sm"
                    placeholder="시도 선택"
                    value={areaCd}
                    onChange={(e) => {
                        setAreaCd(e.target.value);
                        setSignguCd("");
                        setAllItems([]);
                        setSelectedAttraction("");
                    }}
                    options={AREA_CODES.map((a) => ({ value: a.code, label: a.name }))}
                />
                <MayoSelect
                    label="시군구"
                    size="sm"
                    placeholder="시군구 선택"
                    value={signguCd}
                    onChange={(e) => {
                        setSignguCd(e.target.value);
                        setAllItems([]);
                        setSelectedAttraction("");
                    }}
                    options={districts.map((d) => ({ value: d.code, label: d.name }))}
                    disabled={!areaCd}
                />
                {attractions.length > 0 ? (
                    <MayoSelect
                        label={`관광지 (${attractions.length}개)`}
                        size="sm"
                        placeholder="관광지를 선택하세요"
                        value={selectedAttraction}
                        onChange={(e) => setSelectedAttraction(e.target.value)}
                        options={attractions.map((name) => ({ value: name, label: name }))}
                    />
                ) : (
                    <div />
                )}
                <MayoBtn
                    variant="primary"
                    size="sm"
                    color="blue"
                    onClick={handleSearch}
                    disabled={loading || !areaCd || !signguCd}
                    className="w-full"
                >
                    {loading ? "불러오는 중..." : "관광지 불러오기"}
                </MayoBtn>
            </div>

            {/* 로딩 프로그레스 */}
            {loading && (
                <MayoProgress value={loadingProgress} max={100} size="sm" color="blue" label="데이터 로드 중" showValue />
            )}

            {/* 에러 */}
            {error && <MayoAlert type="error" title="오류">{error}</MayoAlert>}

            {/* 검색 결과 태그 */}
            {!loading && allItems.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                    <MayoTag color="blue" variant="solid" size="sm">{selectedAreaName} {selectedSignguName}</MayoTag>
                    <MayoTag color="gray" variant="soft" size="sm">관광지 {attractions.length}개</MayoTag>
                    <MayoTag color="gray" variant="soft" size="sm">총 {totalCount}건</MayoTag>
                    {selectedAttraction && (
                        <MayoTag color="green" variant="solid" size="sm">{selectedAttraction}</MayoTag>
                    )}
                </div>
            )}

            {/* ───── 집중률 분석 결과 (관광지 선택 시) ───── */}
            {!loading && selectedAttraction && items.length > 0 && summary && (
                <>
                    {/* 요약 메트릭 카드 */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <MetricBox label="관광지" value={selectedAttraction} sub={`${selectedAreaName} ${selectedSignguName}`} />
                        <MetricBox label="예측 기간" value={`${summary.days}일`} />
                        <MetricBox
                            label="평균 집중률"
                            value={`${summary.avg.toFixed(1)}%`}
                            tag={getRateLevel(summary.avg)}
                        />
                        <MetricBox
                            label="최고 집중률"
                            value={`${summary.max.toFixed(1)}%`}
                            tag={getRateLevel(summary.max)}
                            sub={summary.maxItem ? formatDate(summary.maxItem.baseYmd) : undefined}
                        />
                    </div>

                    {/* 차트 + 테이블 — 세로 배치 */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* 일별 추이 라인 차트 */}
                        <MayoCard variant="outlined" padding="md">
                            <MayoLineChart
                                title={`${selectedAttraction} 일별 집중률 추이`}
                                data={dailyAvg}
                                series={[{ key: "집중률", color: "#2e8af2", label: "집중률(%)" }]}
                                height={280}
                                showGrid
                                showLegend
                                showDots
                            />
                        </MayoCard>

                        {/* 관광지별 평균 집중률 바 차트 (상위 10개) */}
                        {attractionBarData.length > 0 && (
                            <MayoCard variant="outlined" padding="md">
                                <MayoBarChart
                                    title="관광지별 집중률 비교 (상위 10)"
                                    data={attractionBarData}
                                    series={[
                                        { key: "평균", color: "#2e8af2", label: "평균(%)" },
                                        { key: "최대", color: "#f97316", label: "최대(%)" },
                                    ]}
                                    height={280}
                                    showGrid
                                    showLegend
                                />
                            </MayoCard>
                        )}
                    </div>

                    {/* 전체 관광지 테이블 */}
                    <MayoCard variant="outlined" padding="md">
                        <p className="text-sm font-semibold mb-2" style={{ color: "var(--mayo-text)" }}>
                            전체 관광지 집중률 순위
                        </p>
                        <MayoTable
                            columns={[
                                { key: "rank", label: "순위", width: 60, sortable: true },
                                { key: "name", label: "관광지명", sortable: true },
                                {
                                    key: "avg",
                                    label: "평균 집중률(%)",
                                    width: 150,
                                    sortable: true,
                                    render: (val: unknown) => {
                                        const num = typeof val === "string" ? parseFloat(val) : Number(val);
                                        const lvl = getRateLevel(num);
                                        return (
                                            <div className="flex items-center gap-2">
                                                <span>{num}</span>
                                                <MayoTag color={lvl.color} variant="soft" size="sm">{lvl.label}</MayoTag>
                                            </div>
                                        );
                                    },
                                },
                                { key: "max", label: "최대(%)", width: 100, sortable: true },
                                { key: "min", label: "최소(%)", width: 100, sortable: true },
                                { key: "days", label: "예측일수", width: 90, sortable: true },
                            ]}
                            data={tableData as unknown as Record<string, unknown>[]}
                            rowKey="name"
                            striped
                            bordered
                            emptyText="데이터가 없습니다."
                        />
                    </MayoCard>

                    {/* 원시 데이터 (접을 수 있도록 아코디언) */}
                    <MayoAccordion
                        multiple
                        bordered
                        items={[
                            {
                                value: "raw",
                                label: `원시 데이터 (${items.length}건)`,
                                children: (
                                    <MayoTable
                                        columns={[
                                            { key: "baseYmd", label: "날짜", width: 130, sortable: true, render: (v: unknown) => `${formatDate(String(v))} (${getDayLabel(String(v))})` },
                                            { key: "areaNm", label: "시도", width: 110 },
                                            { key: "signguNm", label: "시군구", width: 110 },
                                            { key: "tAtsNm", label: "관광지명", sortable: true },
                                            {
                                                key: "cnctrRate",
                                                label: "집중률(%)",
                                                width: 140,
                                                sortable: true,
                                                render: (val: unknown) => {
                                                    const n = Number(val);
                                                    const lvl = getRateLevel(n);
                                                    return (
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-semibold">{n.toFixed(1)}</span>
                                                            <MayoTag color={lvl.color} variant="soft" size="sm">{lvl.label}</MayoTag>
                                                        </div>
                                                    );
                                                },
                                            },
                                        ]}
                                        data={items.slice(0, 200) as unknown as Record<string, unknown>[]}
                                        rowKey="baseYmd"
                                        striped
                                        bordered
                                        emptyText="데이터가 없습니다."
                                    />
                                ),
                            },
                        ]}
                    />
                </>
            )}

            {/* ───── 지역별 관광 수요 강도 ───── */}
            <MayoDivider />
            <section>
                <h2 className="text-lg font-bold mb-1" style={{ color: "var(--mayo-text)" }}>
                    지역별 관광 수요 강도
                </h2>
                <p className="text-xs mb-3" style={{ color: "var(--mayo-text-muted)" }}>
                    이동통신 기반 광역시도별 방문자 수 및 외지인 비율 비교
                </p>

                <div className="flex items-end gap-3 mb-4" style={{ background: "var(--mayo-surface)", border: "1px solid var(--mayo-border)", borderRadius: 8, padding: "10px 14px" }}>
                    <div className="flex-1 max-w-xs">
                        <label className="text-xs font-medium block mb-1" style={{ color: "var(--mayo-text-muted)" }}>조회 월</label>
                        <input
                            type="month"
                            value={visitorMonth}
                            onChange={(e) => setVisitorMonth(e.target.value)}
                            className="w-full rounded border px-2 py-1 text-sm"
                            style={{ background: "var(--mayo-bg)", color: "var(--mayo-text)", borderColor: "var(--mayo-border)" }}
                        />
                    </div>
                    <MayoBtn
                        variant="primary"
                        size="sm"
                        color="green"
                        onClick={handleVisitorFetch}
                        disabled={visitorLoading}
                    >
                        {visitorLoading ? "불러오는 중..." : "방문자 데이터 조회"}
                    </MayoBtn>
                </div>

                {visitorLoading && (
                    <div className="flex justify-center py-8">
                        <MayoLoadingSpinner size="md" color="green" label="방문자 데이터를 불러오는 중..." />
                    </div>
                )}

                {visitorError && <MayoAlert type="error" title="방문자 데이터 오류">{visitorError}</MayoAlert>}

                {!visitorLoading && visitorProfiles.length > 0 && (
                    <>
                        {/* 선택 지역 하이라이트 */}
                        {selectedAreaProfile && (
                            <div className="flex items-center gap-2 flex-wrap mb-3">
                                <MayoTag color="green" variant="solid" size="sm">{selectedAreaProfile.regionLabel}</MayoTag>
                                <MayoTag color="blue" variant="soft" size="sm">
                                    총 방문자 {fmtNum(selectedAreaProfile.totalVisitors)}명
                                </MayoTag>
                                <MayoTag color="purple" variant="soft" size="sm">
                                    외지인 비율 {(selectedAreaProfile.outsiderRatio * 100).toFixed(1)}%
                                </MayoTag>
                                <MayoTag color="gray" variant="soft" size="sm">
                                    전국 {selectedAreaProfile.outsiderRatioRank}위 / 17개 시도
                                </MayoTag>
                            </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {/* 총 방문자 수 비교 */}
                            <MayoCard variant="outlined" padding="md">
                                <MayoBarChart
                                    title="시도별 방문자 수 (만명)"
                                    data={visitorBarData}
                                    series={[
                                        { key: "외지인", color: "#8b5cf6", label: "외지인(만)" },
                                        { key: "외국인", color: "#f97316", label: "외국인(만)" },
                                        { key: "총방문자", color: "#2e8af2", label: "총방문자(만)" },
                                    ]}
                                    height={340}
                                    showGrid
                                    showLegend
                                />
                            </MayoCard>

                            {/* 외지인 비율 비교 */}
                            <MayoCard variant="outlined" padding="md">
                                <MayoBarChart
                                    title="시도별 외지인 비율 (%)"
                                    data={outsiderRatioData}
                                    series={[
                                        { key: "외지인비율", color: "#10b981", label: "외지인 비율(%)" },
                                    ]}
                                    height={340}
                                    showGrid
                                    showLegend
                                />
                            </MayoCard>
                        </div>

                        {/* 방문자 상세 테이블 */}
                        <MayoCard variant="outlined" padding="md" className="mt-4">
                            <p className="text-sm font-semibold mb-2" style={{ color: "var(--mayo-text)" }}>
                                시도별 방문자 상세
                            </p>
                            <MayoTable
                                columns={[
                                    { key: "regionLabel", label: "시도", sortable: true },
                                    {
                                        key: "totalVisitors",
                                        label: "총 방문자",
                                        sortable: true,
                                        render: (v: unknown) => fmtNum(Number(v)),
                                    },
                                    {
                                        key: "localVisitors",
                                        label: "현지인",
                                        sortable: true,
                                        render: (v: unknown) => fmtNum(Number(v)),
                                    },
                                    {
                                        key: "outsiderVisitors",
                                        label: "외지인",
                                        sortable: true,
                                        render: (v: unknown) => fmtNum(Number(v)),
                                    },
                                    {
                                        key: "foreignVisitors",
                                        label: "외국인",
                                        sortable: true,
                                        render: (v: unknown) => fmtNum(Number(v)),
                                    },
                                    {
                                        key: "outsiderRatio",
                                        label: "외지인 비율",
                                        width: 130,
                                        sortable: true,
                                        render: (v: unknown) => {
                                            const n = Number(v);
                                            const pct = (n * 100).toFixed(1);
                                            const color = n > 0.5 ? "purple" : n > 0.3 ? "blue" : "gray";
                                            return (
                                                <div className="flex items-center gap-1">
                                                    <span>{pct}%</span>
                                                    <MayoTag color={color as "purple" | "blue" | "gray"} variant="soft" size="sm">
                                                        {n > 0.5 ? "높음" : n > 0.3 ? "보통" : "낮음"}
                                                    </MayoTag>
                                                </div>
                                            );
                                        },
                                    },
                                    {
                                        key: "outsiderRatioRank",
                                        label: "순위",
                                        width: 70,
                                        sortable: true,
                                    },
                                ]}
                                data={
                                    [...visitorProfiles]
                                        .sort((a, b) => a.outsiderRatioRank - b.outsiderRatioRank) as unknown as Record<string, unknown>[]
                                }
                                rowKey="regionLabel"
                                striped
                                bordered
                            />
                        </MayoCard>
                    </>
                )}
            </section>

            {/* 검색 전 안내 */}
            {!loading && allItems.length === 0 && !error && (
                <MayoAlert type="info" title="사용 방법">
                    시도와 시군구를 선택한 뒤 &quot;관광지 불러오기&quot; 버튼을 눌러주세요.
                    관광지 목록에서 원하는 관광지를 선택하면 집중률 분석 결과를 확인할 수 있습니다.
                    하단의 &quot;방문자 데이터 조회&quot;를 통해 지역별 관광 수요도 함께 비교할 수 있습니다.
                </MayoAlert>
            )}
        </main>
    );
}

/** 메트릭 카드 */
function MetricBox({ label, value, sub, tag }: {
    label: string;
    value: string;
    sub?: string;
    tag?: { label: string; color: "green" | "blue" | "purple" | "red" };
}) {
    return (
        <div style={{ background: "var(--mayo-surface)", border: "1px solid var(--mayo-border)", borderRadius: 8, padding: "10px 14px" }}>
            <p className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>{label}</p>
            <div className="flex items-center gap-2 mt-0.5">
                <p className="text-lg font-bold truncate" style={{ color: "var(--mayo-text)" }}>{value}</p>
                {tag && <MayoTag color={tag.color} variant="soft" size="sm">{tag.label}</MayoTag>}
            </div>
            {sub && <p className="text-xs mt-0.5" style={{ color: "var(--mayo-text-muted)" }}>{sub}</p>}
        </div>
    );
}
