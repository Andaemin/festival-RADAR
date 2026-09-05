"use client";

import { useEffect, useState } from "react";
import type { MetadataResponse } from "@/lib/domain/types";
import { FALLBACK_LEVEL_LABEL, FallbackLevel, FESTIVAL_TYPE_DISPLAY, REGION_DISPLAY, VENUE_TYPE_DISPLAY } from "@/lib/domain/enums";
import {
    DataQualityAuditResponse,
    estimateMultiYearBudget,
    fetchDataQualityAudit,
    fetchReliabilityAudit,
    MultiYearBudgetEstimateResponse,
    MultiYearPredictionCandidateDto,
    ReliabilityAuditResponse,
    searchMultiYearSeries,
} from "@/lib/api/multiyear-budget-estimates";
import { resolveSeriesDisplayState, SERIES_FALLBACK_MESSAGE } from "@/lib/multiyear-series/planning-ui-display";
import { buildSeriesSearchResultKey, type SeriesSearchResult } from "@/lib/multiyear-series/series-search";
import type { SeriesHistoryDetailDto, SeriesHistoryExclusionReason } from "@/lib/multiyear-series/series-history-detail";
import type { DataQualityAuditReason, DataQualityAuditSeverity, SeriesDataQualityAuditRecord } from "@/lib/multiyear-series/data-quality-audit";
import { quantile } from "@/lib/utils/weighted-statistics";
import {
    MayoAccordion,
    MayoAlert,
    MayoBarChart,
    MayoBadge,
    MayoBtn,
    MayoCard,
    MayoDivider,
    MayoInput,
    MayoLoadingSpinner,
    MayoPieChart,
    MayoProgress,
    MayoSelect,
    MayoTable,
    MayoTag,
    MayoToggle,
} from "mayoui-react";

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MIN_LENGTH = 2;

/** PHASE 6 — "과년도에 개최했던 축제"(EXISTING) vs "신규 축제"(NEW)를 먼저 명시적으로 고르게
 *  한다. 검색어는 festivalName을 자동 확정하지 않는다 - EXISTING mode의 festivalName은 오직
 *  selectedSeries.canonicalName으로만 결정된다. */
export type FestivalMode = "EXISTING" | "NEW";

/** PHASE 6 — 검색어(seriesSearchText)를 직접 수정한 값이 현재 선택된 series의 canonicalName과
 *  달라지면 stale metadata를 초기화해야 한다는 순수 판정. */
export function shouldResetMetadataOnNameEdit(newValue: string, selectedSeries: SeriesSearchResult | null): boolean {
    return selectedSeries !== null && newValue !== selectedSeries.canonicalName;
}

/** PHASE 6 — durationDays validation: 비어있지 않고, finite number이고, 0보다 커야 한다. */
export function isDurationValid(durationDays: number | ""): boolean {
    return durationDays !== "" && Number.isFinite(durationDays) && durationDays > 0;
}

/**
 * PHASE 6 — 계산 버튼 비활성 사유를 "라벨 목록"으로 계산한다(순서 고정: 기존 축제 선택 → 지역 →
 * 유형 → 장소 → 기간). EXISTING mode에서는 selectedSeries가 실제로 있어야 한다 - 검색어만
 * 입력되고 목록에서 아무것도 선택하지 않은 상태(ambiguous free-text)는 submit 불가 대상이다.
 */
export function computeMissingRequiredFields(fields: {
    festivalMode: FestivalMode;
    selectedSeries: SeriesSearchResult | null;
    regionCode: string;
    festivalTypes: string[];
    venueType: string;
    durationDays: number | "";
}): string[] {
    const missing: string[] = [];
    if (fields.festivalMode === "EXISTING" && fields.selectedSeries === null) missing.push("기존 축제 선택");
    if (!fields.regionCode) missing.push("광역자치단체");
    if (fields.festivalTypes.length === 0) missing.push("축제 유형");
    if (!fields.venueType) missing.push("장소 유형");
    if (!isDurationValid(fields.durationDays)) missing.push("개최일수");
    return missing;
}

/** PHASE 6 — STABLE/MIXED/MISSING 내부 문자열을 화면에 직접 노출하지 않기 위한 사용자 문구
 *  변환. STABLE은 값 자체가 있으므로 별도 힌트가 필요 없다(null 반환). */
export function seriesFieldHint(status: "STABLE" | "MIXED" | "MISSING"): string | null {
    if (status === "MIXED") return "과거 개최 정보가 연도별로 달라 직접 선택해주세요.";
    if (status === "MISSING") return "과거 데이터에 해당 정보가 없습니다.";
    return null;
}

/** PHASE 6 — planningYear가 바뀔 때 이미 선택된 series가 있었다면(leakage-safe pool 자체가
 *  달라지므로) 그 선택에서 나온 festivalName/자동입력 metadata까지 함께 지워야 한다는 순수
 *  판정. 선택이 없었다면(자유입력 중이었다면) 아무것도 지우지 않는다. */
export function shouldClearSeriesMetadataOnPlanningYearChange(selectedSeries: SeriesSearchResult | null): boolean {
    return selectedSeries !== null;
}

/**
 * 다년도 계획예산 추정 페이지.
 *
 * `estimateMultiYearBudget()`(production API, `/api/v1/multiyear-budget-estimates`)이
 * 돌려주는 값을 "읽고 설명"하기만 한다 - 알고리즘을 다시 계산하지 않는다. 유일한 예외는
 * §10의 recommendation formula 검산(§14/§15 문서 공식을 production이 실제로 지키는지 표시용으로
 * 재확인하는 것)이며, 이 결과로 API 값을 대체하지 않는다(불일치가 나오면 그대로 경고만 띄운다).
 *
 * 2026 단년도(`/api/v1/budget-estimates`, `BudgetEstimateResponse`) 관련 UI/state/handler는
 * 이 페이지에서 완전히 제거했다 - production API 자체나 다른 소비자(`lib/services/budget-estimator.ts`
 * 등)는 건드리지 않았다.
 */
export default function BudgetEstimatorPage() {
    const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
    const [metaError, setMetaError] = useState<string | null>(null);

    // PHASE 6 — "과년도에 개최했던 축제" vs "신규 축제"를 먼저 명시적으로 고른다. EXISTING을
    // 기본값으로 둔다 - 핵심 기능(과거 데이터 검색)을 먼저 마주치게 하되, 상단에 항상
    // 현재 모드가 표시되므로 어느 쪽이든 사용자가 헷갈리지 않는다.
    const [festivalMode, setFestivalMode] = useState<FestivalMode>("EXISTING");
    // PHASE 6 — 검색어(seriesSearchText)와 확정된 festivalName을 논리적으로 분리한다. EXISTING
    // mode의 festivalName은 오직 selectedSeries.canonicalName으로만 정해진다 - 검색창에 입력
    // 중인 문자열 자체가 곧바로 request의 festivalName이 되지 않는다.
    const [seriesSearchText, setSeriesSearchText] = useState("");

    // 다년도 계획예산 폼 상태
    const [festivalName, setFestivalName] = useState("");
    const [regionCode, setRegionCode] = useState("");
    const [district, setDistrict] = useState("");
    const [festivalTypes, setFestivalTypes] = useState<string[]>([]);
    const [venueType, setVenueType] = useState("");
    // PHASE 6 — 기본값을 3에서 빈 문자열로 바꿨다. Series는 durationDays를 자동입력하지 않고
    // Peer는 사용자의 계획값을 실제로 계산에 쓰므로, "이미 그럴듯한 숫자가 채워져 있어 무심코
    // 그대로 제출"하는 위험을 없애기 위해 처음부터 빈 상태로 시작한다.
    const [durationDays, setDurationDays] = useState<number | "">("");
    const [planningYear, setPlanningYear] = useState(2027);

    const [result, setResult] = useState<MultiYearBudgetEstimateResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    // PHASE 7 — Top peer candidates 표의 "N일 기준 조정 예산" 헤더에 실제 요청에 쓰인 목표
    // 개최일수를 그대로 보여주기 위한 스냅샷(라이브 폼 durationDays가 결과 표시 이후 바뀌어도
    // 이미 계산된 결과의 헤더 문구가 같이 흔들리지 않게 한다).
    const [submittedDurationDays, setSubmittedDurationDays] = useState<number | null>(null);
    const [loadingProgress, setLoadingProgress] = useState(0);

    // PHASE 6 — 기존 축제 검색(FestivalSeries autocomplete) 상태. selectedSeries는 UI 표시
    // 전용이며(어떤 series를 기반으로 자동입력됐는지), estimate 요청에는 절대 실리지 않는다
    // (groupId round-trip 금지). festivalName/regionCode/district/festivalTypes/venueType은
    // 기존 form state를 그대로 재사용해 자동기입한다 - 별도 "series 전용" 필드를 만들지 않는다.
    const [seriesSearchResults, setSeriesSearchResults] = useState<SeriesSearchResult[]>([]);
    const [seriesSearchLoading, setSeriesSearchLoading] = useState(false);
    const [seriesSearchOpen, setSeriesSearchOpen] = useState(false);
    const [selectedSeries, setSelectedSeries] = useState<SeriesSearchResult | null>(null);
    // PHASE 6 — festivalName을 직접 수정해 선택돼 있던 series의 metadata를 초기화했을 때만
    // true. "즉시 안내"가 목적이라 별도 toast 없이 이 boolean 하나로 인라인 문구를 켠다 - 새
    // series 선택/제출/연도 변경처럼 문맥이 바뀌면 각 핸들러에서 다시 false로 되돌린다.
    const [metadataResetNotice, setMetadataResetNotice] = useState(false);

    useEffect(() => {
        fetch("/api/v1/metadata")
            .then((r) => r.json())
            .then((data) => {
                if (data.message) {
                    setMetaError(data.message);
                } else {
                    setMetadata(data);
                    setRegionCode(data.regions[0]?.code ?? "");
                    setFestivalTypes(data.festivalTypes[0]?.code ? [data.festivalTypes[0].code] : []);
                    setVenueType(data.venueTypes[0]?.code ?? "");
                }
            })
            .catch((e) => setMetaError(String(e)));
    }, []);

    // PHASE 6 — metadata의 district 옵션과 현재 선택된 series가 제공한 안정 district를 union한다.
    // Series의 district가 지금 선택된 regionCode와 다른 series의 것이면(예: 사용자가 series 선택
    // 후 region을 직접 다른 값으로 바꾼 경우) 섞지 않는다 - 엉뚱한 지역의 구가 목록에 끼어들지
    // 않도록.
    const metadataDistricts = metadata?.districtsByRegion[regionCode] ?? [];
    const seriesDistrictToUnion =
        selectedSeries && selectedSeries.fieldStatus.district === "STABLE" && selectedSeries.autoFill.regionCode === regionCode
            ? selectedSeries.autoFill.district
            : null;
    const districts =
        seriesDistrictToUnion !== null && !metadataDistricts.includes(seriesDistrictToUnion)
            ? [...metadataDistricts, seriesDistrictToUnion].sort()
            : metadataDistricts;

    function toggleFestivalType(code: string) {
        setFestivalTypes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
    }

    /**
     * PHASE 6 — EXISTING mode 검색창(seriesSearchText) 전용 change handler. 검색어 자체는
     * festivalName이 아니다 - 결과를 클릭해야만(handleSelectSeries) festivalName이 확정된다
     * (ambiguous free-text path 제거). 이미 선택된 series가 있는 상태에서 검색어를 다시 고치면
     * (다른 축제를 찾는 중이라는 뜻) 이전 선택과 그 자동입력 metadata를 즉시 초기화한다.
     * 2자 미만으로 줄어들면 검색 결과/드롭다운도 이 이벤트 핸들러에서 즉시 정리한다(아래 검색
     * effect는 실제 네트워크 요청·debounce timer만 담당 - effect 본문에서 동기 setState를
     * 피하기 위함).
     */
    function handleSeriesSearchTextChange(value: string) {
        setSeriesSearchText(value);
        if (shouldResetMetadataOnNameEdit(value, selectedSeries)) {
            setSelectedSeries(null);
            setFestivalName("");
            setRegionCode("");
            setDistrict("");
            setFestivalTypes([]);
            setVenueType("");
            setMetadataResetNotice(true);
        }
        if (value.trim() === "") {
            setMetadataResetNotice(false);
        }
        if (value.trim().length < SEARCH_MIN_LENGTH) {
            setSeriesSearchResults([]);
            setSeriesSearchOpen(false);
            setSeriesSearchLoading(false);
        }
    }

    /** PHASE 6 — NEW mode의 festivalName은 완전한 자유입력(선택 사항)이다. EXISTING mode 전용
     *  상태(seriesSearchText/selectedSeries)와 전혀 얽히지 않는다 - mode 전환 시 이미 전부
     *  비워져 있다(handleFestivalModeChange). */
    function handleNewFestivalNameChange(value: string) {
        setFestivalName(value);
    }

    /**
     * PHASE 6 — 축제 구분(EXISTING/NEW) 전환. 어느 방향으로 전환하든 이전 mode의 잔여 상태
     * (검색어/선택된 series/자동입력된 metadata/확정 festivalName)를 전부 초기화한다 -
     * "신규 → 기존 전환 시 신규 free-text festivalName을 Series festivalName으로 오인"하는
     * 문제와 "기존 축제 mode에서 자동입력됐던 metadata가 신규 mode로 넘어가 남는" 문제를 동시에
     * 막는다. planningYear/durationDays는 유지한다(사용자가 이미 입력한 계획 정보는 축제
     * 구분과 무관).
     */
    function handleFestivalModeChange(mode: FestivalMode) {
        setFestivalMode(mode);
        setSeriesSearchText("");
        setSelectedSeries(null);
        setSeriesSearchResults([]);
        setSeriesSearchOpen(false);
        setMetadataResetNotice(false);
        setFestivalName("");
        setRegionCode("");
        setDistrict("");
        setFestivalTypes([]);
        setVenueType("");
    }

    /** PHASE 6 — 2자 이상 입력 시에만, 약 250ms debounce로 검색한다(EXISTING mode에서만 - NEW
     *  mode에서는 seriesSearchText가 항상 빈 값이라 사실상 no-op이지만 mode 조건도 명시적으로
     *  건다). 이미 선택된 series의 이름과 검색어가 정확히 같으면(=방금 선택 직후) 재검색하지
     *  않는다 - 선택하자마자 같은 이름으로 dropdown이 다시 열리는 것을 막기 위함이다. setState는
     *  전부 debounce timer 콜백/그 안의 promise 콜백에서만 호출한다(effect 본문에서 동기
     *  setState 없음). */
    useEffect(() => {
        if (festivalMode !== "EXISTING") return;
        const trimmed = seriesSearchText.trim();
        if (trimmed.length < SEARCH_MIN_LENGTH) return;
        if (selectedSeries && trimmed === selectedSeries.canonicalName) return;

        let cancelled = false;
        const timer = setTimeout(() => {
            setSeriesSearchLoading(true);
            searchMultiYearSeries({ q: trimmed, planningYear: Number(planningYear), limit: 10 })
                .then((results) => {
                    if (cancelled) return;
                    setSeriesSearchResults(results);
                    setSeriesSearchOpen(true);
                })
                .catch(() => {
                    if (cancelled) return;
                    // 검색 실패가 목록 자체를 못 보여줄 뿐 다른 상태를 건드리지 않는다.
                    setSeriesSearchResults([]);
                    setSeriesSearchOpen(true);
                })
                .finally(() => {
                    if (!cancelled) setSeriesSearchLoading(false);
                });
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [seriesSearchText, planningYear, selectedSeries, festivalMode]);

    /**
     * PHASE 6 — planningYear가 바뀌면 leakage-safe search pool 자체가 달라지므로, 이미 선택된
     * series를 재검증 없이 그대로 두지 않는다(선택 해제 후 재선택 요구). 선택이 있었다면 그
     * 선택에서 나온 festivalName/자동입력 metadata까지 함께 지운다 - 그렇지 않으면 "연결이
     * 끊긴 선택"의 자동입력 값만 남는 stale metadata 문제가 재발한다. NEW mode이거나 애초에
     * 선택이 없었다면(자유입력 중이었다면) planningYear 변경만으로 사용자가 입력해 둔 값을
     * 지우지 않는다.
     */
    function handlePlanningYearChange(value: number) {
        setPlanningYear(value);
        if (shouldClearSeriesMetadataOnPlanningYearChange(selectedSeries)) {
            setFestivalName("");
            setRegionCode("");
            setDistrict("");
            setFestivalTypes([]);
            setVenueType("");
        }
        setSelectedSeries(null);
        setSeriesSearchResults([]);
        setSeriesSearchOpen(false);
        setMetadataResetNotice(false);
    }

    /**
     * PHASE 6 — autocomplete 결과 선택. festivalName은 canonicalName으로 고정하고, STABLE 필드만
     * 자동기입한다. MIXED/MISSING 필드는 "값을 추측해 넣지 않는다"는 원칙에 따라 전부 빈 값
     * ("" / [])으로 초기화한다 — region/venueType도 metadata 첫 옵션을 대신 넣지 않는다(임의의
     * 첫 값이 사용자가 실제로 선택한 값처럼 제출될 위험이 있기 때문). 빈 값은 "직접 선택"
     * placeholder(아래 select) 상태이며, 실제 metadata enum 값으로 취급하지 않는다 - submit도
     * 이 빈 값이 남아 있으면 막는다(아래 canSubmit 참고). seriesSearchText도 canonicalName으로
     * 맞춰 검색창과 확정값이 항상 같은 문자열을 보여주게 한다.
     * durationDays/planningYear는 절대 건드리지 않는다(Series 최종 예산 산식이 durationDays를
     * 쓰지 않는다는 사실과, 사용자가 입력한 기간을 보존해야 한다는 요구사항은 서로 다른 층위이며
     * 이 함수는 후자만 담당한다).
     */
    function handleSelectSeries(result: SeriesSearchResult) {
        setSeriesSearchText(result.canonicalName);
        setFestivalName(result.canonicalName);
        setSelectedSeries(result);
        setSeriesSearchOpen(false);
        setSeriesSearchResults([]);
        setMetadataResetNotice(false);

        setRegionCode(result.fieldStatus.region === "STABLE" && result.autoFill.regionCode ? result.autoFill.regionCode : "");
        setDistrict(result.fieldStatus.district === "STABLE" && result.autoFill.district ? result.autoFill.district : "");
        setFestivalTypes(result.fieldStatus.festivalTypes === "STABLE" ? result.autoFill.festivalTypes : []);
        setVenueType(result.fieldStatus.venueType === "STABLE" && result.autoFill.venueType ? result.autoFill.venueType : "");
    }

    // 로딩 프로그레스 시뮬레이션 — loading=true 동안 0→90%까지 점진적으로 올리고,
    // 완료 시 100%로 마무리한다. 실제 API 응답 시간을 모르므로 감속 곡선으로 시뮬레이션.
    useEffect(() => {
        if (!loading) return;
        let frame: number;
        let start: number | null = null;
        const tick = (ts: number) => {
            if (start === null) start = ts;
            const elapsed = ts - start;
            // 5초에 걸쳐 0→90%까지 감속 곡선
            const pct = Math.min(90, 90 * (1 - Math.exp(-elapsed / 2000)));
            setLoadingProgress(Math.round(pct));
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [loading]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!canSubmit) return;
        setError(null);
        setResult(null);
        setMetadataResetNotice(false);
        setLoading(true);
        setLoadingProgress(0);
        try {
            const data = await estimateMultiYearBudget({
                regionCode,
                district: district || undefined,
                festivalTypes,
                venueType,
                durationDays: Number(durationDays),
                planningYear: Number(planningYear),
                referenceDataPolicy: "HISTORICAL_ONLY",
                festivalName: festivalName.trim() || undefined,
            });
            setLoadingProgress(100);
            setResult(data);
            setSubmittedDurationDays(Number(durationDays));
        } catch (e) {
            setError(e instanceof Error ? e.message : "다년도 계획예산 추정에 실패했습니다.");
        } finally {
            setLoading(false);
        }
    }

    // PHASE 6 — Series autofill이 region/venueType을 MIXED/MISSING으로 판정하면 ""(직접 선택
    // placeholder)로 남는다 - 이 값은 실제 metadata enum이 아니므로 submit 전에 반드시 채워야
    // 한다. durationDays=""도 같은 목록에 포함한다(Number("")===0이 그대로 request에 실리는
    // 것을 막음). EXISTING mode에서 selectedSeries가 없으면("검색어만 있고 선택 안 함") 그
    // 자체가 최우선 누락 사유다(ambiguous free-text path 제거).
    const missingRequiredFields = computeMissingRequiredFields({ festivalMode, selectedSeries, regionCode, festivalTypes, venueType, durationDays });
    const canSubmit = missingRequiredFields.length === 0;
    // PHASE 6 — "과거 이력이 연도별로 달라 자동입력하지 않았습니다" 설명은 실제로 series 선택에서
    // 비롯된 필드(지역/유형/장소)가 비어 있을 때만 붙인다 - 개최일수와 "기존 축제 선택" 자체는
    // 이 설명 대상이 아니다.
    const missingDueToSeries =
        selectedSeries !== null && (missingRequiredFields.includes("광역자치단체") || missingRequiredFields.includes("축제 유형") || missingRequiredFields.includes("장소 유형"));

    // PHASE 6 — "자동 설정" 표시는 selectedSeries가 있고 현재 live 값이 그 시점의 autoFill 값과
    // 여전히 같을 때만 켠다. 별도의 "user modified" state를 추적하지 않는 가장 단순한 구현(파생값
    // 이라 사용자가 값을 바꾸는 순간 자동으로 꺼진다).
    const regionAutoFilled = selectedSeries !== null && selectedSeries.fieldStatus.region === "STABLE" && regionCode === selectedSeries.autoFill.regionCode;
    const districtAutoFilled = selectedSeries !== null && selectedSeries.fieldStatus.district === "STABLE" && district === selectedSeries.autoFill.district;
    const festivalTypesAutoFilled =
        selectedSeries !== null &&
        selectedSeries.fieldStatus.festivalTypes === "STABLE" &&
        festivalTypes.length === selectedSeries.autoFill.festivalTypes.length &&
        festivalTypes.every((t) => (selectedSeries.autoFill.festivalTypes as string[]).includes(t));
    const venueAutoFilled = selectedSeries !== null && selectedSeries.fieldStatus.venueType === "STABLE" && venueType === selectedSeries.autoFill.venueType;

    return (
        <main className="min-h-screen flex flex-col p-4 lg:p-5 gap-4" style={{ background: "var(--mayo-bg-subtle)", color: "var(--mayo-text)" }}>
            {/* ── 헤더 ── */}
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: "var(--mayo-text)" }}>💰 예산 추정</h1>
                    <p className="text-sm mt-1" style={{ color: "var(--mayo-text-muted)" }}>2017~2026 공개 축제 계획 데이터 기반 다년도 계획예산 추정</p>
                </div>
                <div className="flex items-center gap-2">
                    {result && <MayoTag color="green" variant="soft" size="sm">{result.estimateBasis === "SERIES_HISTORY_MEDIAN" ? "SERIES" : "PEER"}</MayoTag>}
                    {result && <MayoTag color={result.reliabilityTier === "HIGH" ? "green" : result.reliabilityTier === "MEDIUM" ? "purple" : "gray"} variant="soft" size="sm">{RELIABILITY_LABEL[result.reliabilityTier]}</MayoTag>}
                </div>
            </header>

            {metaError && <MayoAlert type="error">메타데이터 오류: {metaError}</MayoAlert>}

            {/* ── 입력 폼 ── */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">

                {/* Step 1: 기본 설정 */}
                <MayoCard variant="outlined" padding="md">
                    <p className="text-xs font-semibold mb-3" style={{ color: "var(--mayo-text-muted)" }}>STEP 1 — 기본 설정</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <MayoSelect
                            label="계획연도"
                            size="sm"
                            value={String(planningYear)}
                            onChange={(e) => handlePlanningYearChange(Number(e.target.value))}
                            options={Array.from({ length: 7 }, (_, i) => {
                                const y = 2024 + i;
                                return { value: String(y), label: `${y}년` };
                            })}
                        />
                        <MayoSelect
                            label="축제 구분"
                            size="sm"
                            value={festivalMode}
                            onChange={(e) => handleFestivalModeChange(e.target.value as FestivalMode)}
                            options={[
                                { value: "EXISTING", label: "기존 축제 (과거 데이터 검색)" },
                                { value: "NEW", label: "신규 축제" },
                            ]}
                        />
                        {festivalMode === "NEW" && (
                            <MayoInput label="축제명 (선택)" type="text" size="sm" placeholder="신규 축제 이름" value={festivalName} onChange={(e) => handleNewFestivalNameChange(e.target.value)} />
                        )}
                    </div>
                </MayoCard>

                {/* Step 2: 축제 검색 (기존 축제만) */}
                {festivalMode === "EXISTING" && (
                    <MayoCard variant="outlined" padding="md">
                        <p className="text-xs font-semibold mb-3" style={{ color: "var(--mayo-text-muted)" }}>STEP 2 — 축제 검색</p>

                        {/* 선택된 시리즈 하이라이트 */}
                        {selectedSeries && (
                            <div className="mb-3 rounded-lg p-3" style={{ background: "var(--mayo-bg-subtle)", border: "1px solid var(--mayo-primary, #10b981)" }}>
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-sm font-bold" style={{ color: "var(--mayo-text)" }}>{selectedSeries.canonicalName}</span>
                                    <MayoTag color="green" variant="solid" size="sm">선택됨</MayoTag>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <MayoTag color="gray" variant="soft" size="sm">이력 {selectedSeries.historyCount}회 · {selectedSeries.firstObservedYear}~{selectedSeries.lastObservedYear}</MayoTag>
                                    {selectedSeries.fieldStatus.region === "STABLE" && <MayoTag color="blue" variant="soft" size="sm">{REGION_DISPLAY[selectedSeries.autoFill.regionCode!]}</MayoTag>}
                                    {selectedSeries.fieldStatus.festivalTypes === "STABLE" && selectedSeries.autoFill.festivalTypes.map((t) => (
                                        <MayoTag key={t} color="purple" variant="soft" size="sm">{FESTIVAL_TYPE_DISPLAY[t]}</MayoTag>
                                    ))}
                                    {selectedSeries.fieldStatus.venueType === "STABLE" && <MayoTag color="orange" variant="soft" size="sm">{VENUE_TYPE_DISPLAY[selectedSeries.autoFill.venueType!]}</MayoTag>}
                                    {selectedSeries.fieldStatus.district === "STABLE" && <MayoTag color="gray" variant="soft" size="sm">{selectedSeries.autoFill.district}</MayoTag>}
                                </div>
                            </div>
                        )}

                        {metadataResetNotice && !selectedSeries && (
                            <div className="mb-3">
                                <MayoAlert type="warning">검색어 변경으로 이전 선택이 초기화되었습니다. 목록에서 다시 선택해주세요.</MayoAlert>
                            </div>
                        )}

                        <MayoInput
                            label="축제명 검색"
                            type="text"
                            size="sm"
                            placeholder="2자 이상 입력하면 과거 데이터에서 검색합니다"
                            value={seriesSearchText}
                            onChange={(e) => handleSeriesSearchTextChange(e.target.value)}
                        />

                        {/* 검색 로딩 */}
                        {seriesSearchLoading && (
                            <div className="mt-2">
                                <MayoProgress value={70} max={100} size="sm" color="blue" label="축제 데이터 검색 중" />
                            </div>
                        )}

                        {/* 검색 결과 리스트 (인라인) */}
                        {!seriesSearchLoading && seriesSearchResults.length > 0 && (
                            <div className="mt-3 flex flex-col gap-1.5">
                                <p className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>검색 결과 {seriesSearchResults.length}건</p>
                                {seriesSearchResults.map((r) => (
                                    <button
                                        key={buildSeriesSearchResultKey(r)}
                                        type="button"
                                        onClick={() => handleSelectSeries(r)}
                                        className="w-full text-left rounded-lg p-3 transition-opacity hover:opacity-80"
                                        style={{ background: "var(--mayo-surface)", border: "1px solid var(--mayo-border)" }}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-semibold text-sm" style={{ color: "var(--mayo-text)" }}>{r.canonicalName}</span>
                                            <div className="flex items-center gap-1.5">
                                                {r.regionCode && <MayoTag color="blue" variant="soft" size="sm">{REGION_DISPLAY[r.regionCode]}</MayoTag>}
                                                <MayoTag color="gray" variant="soft" size="sm">{r.historyCount}회</MayoTag>
                                            </div>
                                        </div>
                                        <p className="text-xs mt-0.5" style={{ color: "var(--mayo-text-muted)" }}>
                                            {r.firstObservedYear}~{r.lastObservedYear}년 개최
                                        </p>
                                    </button>
                                ))}
                            </div>
                        )}
                        {!seriesSearchLoading && seriesSearchText.trim().length >= SEARCH_MIN_LENGTH && seriesSearchResults.length === 0 && !selectedSeries && (
                            <p className="mt-2 text-xs" style={{ color: "var(--mayo-text-muted)" }}>검색 결과 없음 — 축제 구분을 &quot;신규 축제&quot;로 변경해주세요.</p>
                        )}
                    </MayoCard>
                )}

                {/* Step 3: 세부 조건 */}
                <MayoCard variant="outlined" padding="md">
                    <p className="text-xs font-semibold mb-3" style={{ color: "var(--mayo-text-muted)" }}>
                        {festivalMode === "EXISTING" ? "STEP 3" : "STEP 2"} — 세부 조건
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-start">
                        <MayoSelect
                            label={regionAutoFilled ? "광역자치단체 ✓" : "광역자치단체"}
                            size="sm"
                            placeholder="선택"
                            value={regionCode}
                            onChange={(e) => { setRegionCode(e.target.value); setDistrict(""); }}
                            disabled={!metadata}
                            options={metadata?.regions.map((r) => ({ value: r.code, label: r.displayName })) ?? []}
                        />
                        <MayoSelect
                            label={districtAutoFilled ? "시군구 ✓" : "시군구"}
                            size="sm"
                            placeholder="선택 안 함"
                            value={district}
                            onChange={(e) => setDistrict(e.target.value)}
                            disabled={districts.length === 0}
                            options={districts.map((d) => ({ value: d, label: d }))}
                        />
                        <MayoSelect
                            label={venueAutoFilled ? "장소 유형 ✓" : "장소 유형"}
                            size="sm"
                            placeholder="선택"
                            value={venueType}
                            onChange={(e) => setVenueType(e.target.value)}
                            disabled={!metadata}
                            options={metadata?.venueTypes.map((v) => ({ value: v.code, label: v.displayName })) ?? []}
                        />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 items-start">
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium" style={{ color: "var(--mayo-text)" }}>
                                축제 유형 {festivalTypesAutoFilled && <span style={{ color: "var(--mayo-primary, #10b981)" }}>✓</span>}
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                                {metadata?.festivalTypes.map((t) => (
                                    <MayoToggle key={t.code} checked={festivalTypes.includes(t.code)} onChange={() => toggleFestivalType(t.code)} label={t.displayName} size="sm" color="blue" />
                                ))}
                            </div>
                        </div>
                        <MayoInput label="개최 일수" type="number" size="sm" min={2} max={180} placeholder="예: 3" value={durationDays} onChange={(e) => setDurationDays(e.target.value === "" ? "" : Number(e.target.value))} />
                    </div>
                </MayoCard>

                {/* 제출 */}
                <div className="flex items-center gap-3">
                    <MayoBtn type="submit" disabled={loading || !metadata || !canSubmit} variant="primary" color="green" size="md" style={{ minWidth: 180 }}>
                        {loading ? `계산 중 ${loadingProgress}%` : "계획예산 계산"}
                    </MayoBtn>
                    {!canSubmit && (
                        <p className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>
                            필요 항목: <span className="font-semibold">{missingRequiredFields.join(" · ")}</span>
                            {missingDueToSeries && " (과거 이력이 연도별로 달라 자동입력 안 됨)"}
                        </p>
                    )}
                </div>
            </form>

            {error && <MayoAlert type="error">{error}</MayoAlert>}

            {/* ── 로딩 프로그레스 ── */}
            {loading && (
                <MayoCard variant="outlined" padding="md">
                    <p className="text-sm font-medium mb-2">다년도 계획예산 계산 중...</p>
                    <MayoProgress value={loadingProgress} max={100} size="md" color="green" label="분석 진행률" showValue />
                </MayoCard>
            )}

            {/* ── 결과 대시보드 ── */}
            {!result && !loading && (
                <MayoCard variant="outlined" padding="lg">
                    <p className="text-sm text-center" style={{ color: "var(--mayo-text-muted)" }}>
                        위에서 조건을 입력하고 계산을 실행하면 결과가 여기 표시됩니다.
                    </p>
                </MayoCard>
            )}
            {result && !loading && <ResultPane result={result} requestedDurationDays={submittedDurationDays} />}

            {/* ── 전체 감사 (항상 표시) ── */}
            <MayoAccordion
                bordered
                items={[
                    { value: "data-quality", label: "전체 데이터 품질 감사 (Series Data Quality Audit)", children: <GlobalDataQualityAuditInner /> },
                    { value: "reliability", label: "전체 Reliability 감사 (G0 이후 재검증, leakage-safe backtest)", children: <GlobalReliabilityAuditInner /> },
                ]}
            />
        </main>
    );
}

const fmt = (n: number) => new Intl.NumberFormat("ko-KR").format(n) + "원";
/** 통계값 카드처럼 밀도 높은 표에서만 쓰는 압축 표기(억 단위). 정밀 검산이 필요한 곳(추천 공식
 *  검산 등)에는 절대 쓰지 않고 항상 fmt()의 원 단위 그대로를 쓴다. */
const fmtEok = (n: number) => (n / 100_000_000).toFixed(2) + "억";

const ESTIMATE_BASIS_LABEL: Record<string, string> = {
    SERIES_HISTORY_MEDIAN: "동일 축제 이력 기반 (SERIES)",
    PEER_SIMILARITY: "유사 축제 기반 (PEER)",
};
const RELIABILITY_LABEL: Record<string, string> = { HIGH: "신뢰도 높음", MEDIUM: "신뢰도 보통", LOW: "신뢰도 낮음" };
const RELIABILITY_BADGE_COLOR: Record<string, "green" | "purple" | "gray"> = {
    HIGH: "green",
    MEDIUM: "purple",
    LOW: "gray",
};
/** 등급 의미 설명(고정 문구) — production `reliabilityReason`을 대체하지 않는다.
 *  reliabilityReason은 항상 그대로 별도로 함께 보여준다(source of truth).
 *  HIGH의 이 짧은 문구는 historyCount=1/>=2 두 경우 모두에 공통으로 맞는 표현만 쓴다 - "연도별
 *  변동이 안정적"처럼 historyCount=1에서는 성립하지 않는 주장은 여기 절대 넣지 않는다(그 구분은
 *  production reliabilityReason 자체가 이미 정확히 하고 있으므로, 이 요약 문구가 새로 주장하지
 *  않아도 된다). */
const RELIABILITY_MEANING: Record<string, string> = {
    HIGH: "동일 축제 과거 이력을 활용했습니다.",
    MEDIUM: "동일 축제 이력은 있으나 과거 계획예산의 변동이 상대적으로 큽니다.",
    LOW: "동일 축제 자체 이력이 부족해 유사 축제를 기반으로 추정했습니다. 축제별 규모 차이의 영향을 받을 수 있으므로 아래 비교 표본과 참고 범위를 함께 확인하세요.",
};

/** "Series history" 진단 필드 — seriesSignal.status별로 사람이 바로 이해할 수 있는 문구. */
function seriesHistorySummary(result: MultiYearBudgetEstimateResponse): string {
    const s = result.seriesSignal;
    switch (s.status) {
        case "MATCHED":
            return s.canonicalName !== undefined && s.historyCount !== undefined ? `${s.canonicalName} (${s.historyCount}회 이력)` : "매칭됨";
        case "NOT_REQUESTED":
            return "축제명 미입력 — Series 조회 안 함";
        case "UNMATCHED":
            return "동일 축제 매칭 안 됨";
        case "AMBIGUOUS":
            return "동일 축제 판별 불가(중복 후보) — Peer로 대체";
        case "NO_VALID_HISTORY":
            return "매칭됐으나 활용 가능한 과거 예산 없음 — Peer로 대체";
    }
}

function ResultPane({ result, requestedDurationDays }: { result: MultiYearBudgetEstimateResponse; requestedDurationDays: number | null }) {
    const isSeries = result.estimateBasis === "SERIES_HISTORY_MEDIAN";
    const seriesDisplay = resolveSeriesDisplayState(result.estimateBasis, result.seriesSignal);
    const noSample = result.sampleCount === 0;

    // Peer 통계 차트 데이터
    const peerChartData = result.sampleCount > 0 ? [
        { label: "P25", value: result.p25Krw / 1e8 },
        { label: "P50", value: result.p50Krw / 1e8 },
        { label: "P60", value: result.p60Krw / 1e8 },
        { label: "P75", value: result.p75Krw / 1e8 },
        { label: "예상", value: result.estimatedBudgetKrw / 1e8 },
        { label: "추천", value: result.recommendedBudgetKrw / 1e8 },
    ] : [];

    // 연도별 반영 비중 차트 데이터
    const yearWeightChartData = result.yearWeightBreakdown.map((y) => ({
        label: String(y.year),
        weight: Math.round(y.weightShare * 100),
        count: y.candidateCount,
    }));

    // 추정 방식 도넛
    const basisPieData = [
        { label: isSeries ? "SERIES (동일축제)" : "PEER (유사축제)", value: 1, color: isSeries ? "#10b981" : "#6366f1" },
    ];

    // 신뢰도 도넛 — 비율 시각화
    const reliabilityPieData = [
        { label: "신뢰도 근거", value: result.reliabilityTier === "HIGH" ? 90 : result.reliabilityTier === "MEDIUM" ? 60 : 30, color: result.reliabilityTier === "HIGH" ? "#10b981" : result.reliabilityTier === "MEDIUM" ? "#8b5cf6" : "#9ca3af" },
        { label: "", value: result.reliabilityTier === "HIGH" ? 10 : result.reliabilityTier === "MEDIUM" ? 40 : 70, color: "var(--mayo-bg-subtle)" },
    ];

    // Series fallback 메시지
    const seriesFallbackKind = seriesDisplay.kind;

    // Accordion 상세 섹션
    const accordionItems = [
        {
            value: "basis",
            label: "예산 산정 근거 및 추천 공식 검증",
            children: (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <p className="text-xs font-semibold mb-2">산정 근거</p>
                        <FieldGrid rows={[
                            ["Estimate basis", <MayoTag key="eb" color="blue" variant="soft" size="sm">{result.estimateBasis}</MayoTag>],
                            ["Recommendation basis", <MayoTag key="rb" color="purple" variant="soft" size="sm">{result.recommendationBasis}</MayoTag>],
                            ["Sample count", `${result.sampleCount}건`],
                            ["Reference year range", result.earliestSourceYear !== null && result.latestSourceYear !== null ? `${result.earliestSourceYear}~${result.latestSourceYear} (${result.distinctYearsUsed}개 연도)` : "—"],
                        ]} />
                    </div>
                    <RecommendationCheckCard result={result} />
                </div>
            ),
        },
        {
            value: "reliability",
            label: `신뢰도 상세 — ${RELIABILITY_LABEL[result.reliabilityTier]}`,
            children: <ReliabilityCard result={result} />,
        },
        ...(seriesDisplay.kind === "SERIES_APPLIED" ? [{
            value: "series",
            label: "Series 경로 상세",
            children: <SeriesHistoryCard seriesDisplay={seriesDisplay as Extract<ReturnType<typeof resolveSeriesDisplayState>, { kind: "SERIES_APPLIED" }>} />,
        }] : []),
        ...(seriesDisplay.kind === "SERIES_APPLIED" && result.seriesHistoryDetail ? [{
            value: "series-history",
            label: "동일 축제 과거 이력",
            children: <SeriesHistoryDetailCard detail={result.seriesHistoryDetail} result={result} />,
        }] : []),
        ...(seriesDisplay.kind === "SERIES_APPLIED" ? [{
            value: "future-year",
            label: "Future-year 진단",
            children: <FutureYearSafetyCard result={result} />,
        }] : []),
        {
            value: "algorithm",
            label: "알고리즘 적용값 / 데이터 사용 현황",
            children: (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <AlgorithmValuesCard result={result} />
                    <DataUsageCard result={result} />
                </div>
            ),
        },
        ...(result.topCandidates.length > 0 ? [{
            value: "candidates",
            label: `유사 축제 상위 ${result.topCandidates.length}건 (전체 ${result.sampleCount}건 중)`,
            children: <CandidatesCard candidates={result.topCandidates} sampleCount={result.sampleCount} requestedDurationDays={requestedDurationDays} />,
        }] : []),
        {
            value: "raw",
            label: "개발자 정보 — Raw API Response",
            children: (
                <pre className="p-3 rounded overflow-x-auto max-h-96 overflow-y-auto text-xs" style={{ background: "var(--mayo-bg-subtle)", color: "var(--mayo-text-secondary)" }}>
                    {JSON.stringify(result, null, 2)}
                </pre>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-3">
            {noSample && (
                <MayoAlert type="warning">비교 가능한 유사 축제 표본 없음 (sampleCount=0) — 예상/추천 예산은 0원입니다.</MayoAlert>
            )}

            {(seriesFallbackKind === "UNMATCHED" || seriesFallbackKind === "AMBIGUOUS" || seriesFallbackKind === "NO_VALID_HISTORY") && (
                <MayoAlert type="info">{SERIES_FALLBACK_MESSAGE[seriesFallbackKind]}</MayoAlert>
            )}

            {/* Row 1: 핵심 메트릭 4개 */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                <MetricBox label="예상 예산" value={fmt(result.estimatedBudgetKrw)} />
                <MetricBox label="추천 계획 예산" value={fmt(result.recommendedBudgetKrw)} highlight />
                <MetricBox label="추정 방식" value={isSeries ? "SERIES" : "PEER"} sub={ESTIMATE_BASIS_LABEL[result.estimateBasis]} />
                <MetricBox label="신뢰도" value={RELIABILITY_LABEL[result.reliabilityTier] ?? result.reliabilityTier} reliabilityColor={RELIABILITY_BADGE_COLOR[result.reliabilityTier]} />
            </div>

            {/* Row 2: 차트 3개 — Peer분포 바차트 + 연도별 비중 바차트 + 추정방식/신뢰도 도넛 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {peerChartData.length > 0 && (
                    <MayoCard variant="outlined" padding="sm">
                        <p className="text-xs font-semibold mb-1">예산 분포 (억원)</p>
                        <MayoBarChart
                            data={peerChartData}
                            series={[{ key: "value", label: "예산(억)", color: "#6366f1" }]}
                            height={180}
                            showGrid
                        />
                    </MayoCard>
                )}
                {yearWeightChartData.length > 0 && (
                    <MayoCard variant="outlined" padding="sm">
                        <p className="text-xs font-semibold mb-1">연도별 반영 비중 (%)</p>
                        <MayoBarChart
                            data={yearWeightChartData}
                            series={[{ key: "weight", label: "비중(%)", color: "#10b981" }]}
                            height={180}
                            showGrid
                        />
                    </MayoCard>
                )}
                <MayoCard variant="outlined" padding="sm">
                    <p className="text-xs font-semibold mb-1">추정 방식 / 신뢰도</p>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col items-center">
                            <MayoPieChart data={basisPieData} size={100} donut showLegend />
                        </div>
                        <div className="flex flex-col items-center">
                            <MayoPieChart data={reliabilityPieData} size={100} donut />
                            <span className="text-[10px] mt-1 font-semibold" style={{ color: "var(--mayo-text-muted)" }}>{RELIABILITY_LABEL[result.reliabilityTier]}</span>
                        </div>
                    </div>
                </MayoCard>
            </div>

            {/* Row 3: Peer 핵심 통계 — 한 줄 태그 */}
            {result.sampleCount > 0 && (
                <MayoCard variant="outlined" padding="sm">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold">Peer 통계</span>
                        <MayoTag color="gray" variant="outline" size="sm">표본 {result.sampleCount}건</MayoTag>
                        <MayoTag color="gray" variant="outline" size="sm">유사도 {(result.averageSimilarity * 100).toFixed(1)}%</MayoTag>
                        <MayoTag color="blue" variant="soft" size="sm">P25 {fmtEok(result.p25Krw)}</MayoTag>
                        <MayoTag color="blue" variant="soft" size="sm">P50 {fmtEok(result.p50Krw)}</MayoTag>
                        <MayoTag color="purple" variant="soft" size="sm">P60 {fmtEok(result.p60Krw)}</MayoTag>
                        <MayoTag color="blue" variant="soft" size="sm">P75 {fmtEok(result.p75Krw)}</MayoTag>
                        <MayoTag color="green" variant="solid" size="sm">추천 {fmtEok(result.recommendedBudgetKrw)}</MayoTag>
                        <MayoTag color="gray" variant="outline" size="sm">Fallback {FALLBACK_LEVEL_LABEL[result.fallbackLevel as FallbackLevel] ?? result.fallbackLevel}</MayoTag>
                    </div>
                </MayoCard>
            )}

            {/* Row 4: 상세 섹션 — MayoAccordion */}
            <MayoAccordion items={accordionItems} multiple bordered />
        </div>
    );
}

/**
 * PHASE 6 — "과거 이력 기반 기본 정보" 요약 블록의 한 줄. STABLE이면 실제 값 + "자동 설정"
 * 태그, MIXED/MISSING이면 각각 "직접 선택"/"정보 없음"만 보여준다(내부 STABLE/MIXED/MISSING
 * 문자열 자체는 노출하지 않음).
 */
function MetricBox({ label, value, sub, highlight, reliabilityColor }: { label: string; value: string; sub?: string; highlight?: boolean; reliabilityColor?: "green" | "purple" | "gray" }) {
    return (
        <MayoCard variant="outlined" padding="sm">
            <div className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>{label}</span>
                <span className="text-lg font-bold" style={highlight ? { color: "var(--mayo-primary, #2563eb)" } : undefined}>
                    {reliabilityColor ? <MayoBadge color={reliabilityColor} variant="soft" size="md">{value}</MayoBadge> : value}
                </span>
                {sub && <span className="text-[11px]" style={{ color: "var(--mayo-text-muted)" }}>{sub}</span>}
            </div>
        </MayoCard>
    );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <MayoCard variant="outlined" padding="md">
            <p className="font-semibold text-sm mb-3">{title}</p>
            {children}
        </MayoCard>
    );
}

function FieldGrid({ rows }: { rows: [string, React.ReactNode][] }) {
    return (
        <dl className="grid grid-cols-[9rem_1fr] gap-y-2 gap-x-3 text-sm">
            {rows.map(([label, value], i) => (
                <div key={i} className="contents">
                    <dt style={{ color: "var(--mayo-text-muted)" }}>{label}</dt>
                    <dd>{value}</dd>
                </div>
            ))}
        </dl>
    );
}

/**
 * PHASE — recommendation formula 검산(표시 전용). §14/§15 문서에 확정된 공식을, API가 이미
 * 돌려준 값(estimatedBudgetKrw/p60Krw)만 가지고 재현해 recommendedBudgetKrw와 일치하는지
 * 비교한다. 이 계산 결과로 UI가 production 값을 덮어쓰지 않는다 - 불일치가 있으면 그 사실만
 * 그대로 드러낸다.
 *
 * Peer 분기는 API가 이미 반올림된 estimatedBudgetKrw/p60Krw를 클라이언트에 내려주므로 그 값의
 * max()를 쓴다 - production 내부(`computeFinalPeerRecommendation`)는 반올림 전 원본 float으로
 * max를 구한 뒤 한 번만 반올림하므로, 두 피연산자가 반올림 경계에서 정확히 맞물리는 극히 드문
 * 경우 ±1원 차이가 이론상 가능하다(클라이언트가 원본 float에 접근할 수 없어 발생하는 표시 전용
 * 한계 - 실제 3,432건 backtest에서는 한 번도 관측되지 않았다).
 */
function RecommendationCheckCard({ result }: { result: MultiYearBudgetEstimateResponse }) {
    const isSeries = result.estimateBasis === "SERIES_HISTORY_MEDIAN";
    const expected = isSeries
        ? Math.round(result.estimatedBudgetKrw * 1.05)
        : Math.max(result.estimatedBudgetKrw, result.p60Krw);
    const pass = expected === result.recommendedBudgetKrw;
    const formulaText = isSeries
        ? `${fmt(result.estimatedBudgetKrw)} × 1.05`
        : `max(${fmt(result.estimatedBudgetKrw)}, ${fmt(result.p60Krw)})`;

    return (
        <Card title="추천 공식 검증 (표시 전용 — production 계산을 변경하지 않음)">
            <div className="flex items-center gap-2 mb-3">
                <MayoBadge color={pass ? "green" : "red"} variant="soft" size="sm">
                    {pass ? "PASS" : "API recommendation mismatch"}
                </MayoBadge>
                <span className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>
                    {isSeries ? "Series: recommendedBudget = estimatedBudget × 1.05" : "Peer: recommendedBudget = max(estimatedBudget, P60)"}
                </span>
            </div>
            <div className="font-mono text-xs rounded p-3 flex flex-col gap-0.5" style={{ background: "var(--mayo-bg-subtle)" }}>
                <div>{formulaText}</div>
                <div>= {fmt(expected)} <span style={{ color: "var(--mayo-text-muted)" }}>(공식 검산값)</span></div>
                <div className="pt-1 mt-1" style={{ borderTop: "1px solid var(--mayo-border)" }}>API recommendedBudgetKrw = {fmt(result.recommendedBudgetKrw)}</div>
                <div>일치 = {pass ? "✓" : `✗ (차이 ${fmt(Math.abs(expected - result.recommendedBudgetKrw))})`}</div>
            </div>
        </Card>
    );
}

/**
 * 신뢰도 상세 카드 — "왜 이 등급인가"와 "이 등급이 실제로 무엇을 의미하는가"를 함께 보여준다.
 *
 * - reliabilityReason(production API 원문)은 source of truth로 그대로 노출한다 - UI가 재작성하지
 *   않는다. historyCount=1 HIGH를 "연도별 변동이 안정적"이라고 절대 표현하지 않는 이유도, 그
 *   구분을 이 문구가 아니라 production reliabilityReason 자체가 이미 정확히 하고 있기 때문이다.
 * - RELIABILITY_MEANING은 보조 설명(고정, 짧은 한 줄)이며 reliabilityReason과
 *   모순되지 않는 수준의 일반론만 담는다.
 * - LOW일 때만 "왜 낮은가?"/"확인하면 좋은 값"을 추가로 펼쳐 보여준다 - fallbackLevel/sampleCount/
 *   averageSimilarity/P25~P75를 바로 옆에서 확인할 수 있게 한다.
 */
function ReliabilityCard({ result }: { result: MultiYearBudgetEstimateResponse }) {
    const tier = result.reliabilityTier;
    const isLow = tier === "LOW";

    return (
        <Card title="신뢰도">
            <div className="flex items-center gap-2 mb-2">
                <MayoBadge color={tier === "HIGH" ? "green" : tier === "MEDIUM" ? "purple" : "gray"} variant="soft" size="md">
                    {tier} · {RELIABILITY_LABEL[tier] ?? tier}
                </MayoBadge>
            </div>

            <p className="text-sm" style={{ color: "var(--mayo-text)" }}>{RELIABILITY_MEANING[tier] ?? ""}</p>
            <p className="text-xs mt-1.5" style={{ color: "var(--mayo-text-muted)" }}>
                API 근거 문구(reliabilityReason): <span style={{ color: "var(--mayo-text-secondary)" }}>&ldquo;{result.reliabilityReason}&rdquo;</span>
            </p>

            {isLow && (
                <>
                <MayoDivider />
                <div className="flex flex-col gap-3">
                    <div>
                        <p className="text-xs font-semibold mb-1" style={{ color: "var(--mayo-text-secondary)" }}>왜 낮은가?</p>
                        <p className="text-xs" style={{ color: "var(--mayo-text-secondary)" }}>
                            → {seriesHistorySummary(result)} → Peer fallback 사용 → <code>{FALLBACK_LEVEL_LABEL[result.fallbackLevel as FallbackLevel] ?? result.fallbackLevel}</code> 단계에서 후보 선정
                        </p>
                    </div>
                    <div>
                        <p className="text-xs font-semibold mb-1" style={{ color: "var(--mayo-text-secondary)" }}>확인하면 좋은 값</p>
                        <div className="grid grid-cols-2 gap-2">
                            <MiniStat label="비교 표본" value={`${result.sampleCount}개`} />
                            <MiniStat label="평균 유사도" value={`${(result.averageSimilarity * 100).toFixed(1)}%`} />
                            <MiniStat label="유사 축제 참고 범위" value={`${fmt(result.p25Krw)} ~ ${fmt(result.p75Krw)}`} span2 />
                        </div>
                    </div>
                </div>
                </>
            )}

            {/* 분석적 표시(상세 진단 정보) — 기본 접힘 */}
            <MayoDivider />
            <details className="text-xs">
                <summary className="cursor-pointer text-[11px] font-semibold" style={{ color: "var(--mayo-text-muted)" }}>분석적 표시 (상세) ▸</summary>
                <div className="mt-2">
                    <FieldGrid
                        rows={[
                            ["Reliability tier", <span key="t" className="font-semibold">{tier}</span>],
                            ["Reliability reason", <span key="r" className="text-xs" style={{ color: "var(--mayo-text-secondary)" }}>{result.reliabilityReason}</span>],
                            ["Estimate basis", <code key="e">{result.estimateBasis}</code>],
                            ["Series history", seriesHistorySummary(result)],
                            ["Fallback level", <code key="f">{FALLBACK_LEVEL_LABEL[result.fallbackLevel as FallbackLevel] ?? result.fallbackLevel}</code>],
                        ]}
                    />
                </div>

                {result.reliabilityDiagnostic && (
                    <div className="mt-3">
                        <p className="text-[11px] font-semibold mb-1.5" style={{ color: "var(--mayo-text-muted)" }}>Reliability 진단 (G0 이후 재검증)</p>
                        <FieldGrid
                            rows={[
                                ["reasonKey", <code key="rk">{result.reliabilityDiagnostic.reasonKey}</code>],
                                [
                                    "Historical dispersion",
                                    result.reliabilityDiagnostic.historicalDispersion !== null
                                        ? `log(P75/P25) = ${result.reliabilityDiagnostic.historicalDispersion.toFixed(4)}`
                                        : "— (historyCount<2, 측정 불가)",
                                ],
                                [
                                    "Calibration threshold",
                                    result.reliabilityDiagnostic.volatilityThreshold !== null
                                        ? result.reliabilityDiagnostic.volatilityThreshold.toFixed(4)
                                        : "— (calibration pool 부족)",
                                ],
                                ["estimateSource", result.seriesSignal.estimateSource ?? "—"],
                                ["latestHistoricalGap", result.seriesSignal.latestHistoricalGap !== undefined ? `${result.seriesSignal.latestHistoricalGap}년` : "—"],
                            ]}
                        />
                        <p className="text-[10px] mt-1.5" style={{ color: "var(--mayo-text-muted)" }}>
                            G0 이후 backtest 연구 결과: HIGH/MEDIUM의 정확도(MdAPE) 차이는 작아졌지만, historical dispersion(변동성)
                            자체는 여전히 뚜렷하게 구분됩니다 — 신뢰도는 정확도 등급이 아니라 과거 데이터 근거의 안정성 지표입니다.
                        </p>
                    </div>
                )}
            </details>

            <p className="text-[11px] mt-3 italic" style={{ color: "var(--mayo-text-muted)" }}>
                신뢰도는 &lsquo;이 예산이 맞을 확률&rsquo;이 아니라, 이 추정에 사용한 데이터 근거의 강도를 나타냅니다. 숫자 % confidence로 환산되는 값이 아닙니다.
            </p>
        </Card>
    );
}

function MiniStat({ label, value, span2 }: { label: string; value: string; span2?: boolean }) {
    return (
        <div className={`rounded-lg px-2.5 py-2 flex flex-col gap-0.5 ${span2 ? "col-span-2" : ""}`} style={{ background: "var(--mayo-bg-subtle)" }}>
            <span className="text-[11px]" style={{ color: "var(--mayo-text-muted)" }}>{label}</span>
            <span className="text-xs font-semibold" style={{ color: "var(--mayo-text)" }}>{value}</span>
        </div>
    );
}

function SeriesHistoryCard({
    seriesDisplay,
}: {
    seriesDisplay: Extract<ReturnType<typeof resolveSeriesDisplayState>, { kind: "SERIES_APPLIED" }>;
}) {
    return (
        <Card title="Series 경로 상세">
            <FieldGrid
                rows={[
                    ["계산 경로", <MayoBadge key="p" color="green" variant="solid" size="sm">SERIES</MayoBadge>],
                    ["동일 축제", seriesDisplay.canonicalName],
                    ["과거 이력", `${seriesDisplay.historyCount}회`],
                    ["사용 연도", seriesDisplay.historicalYears.length > 0 ? seriesDisplay.historicalYears.join(" / ") : "—"],
                    ["예상 예산 산정", "CPI 보정된 동일 축제 과거 예산의 median"],
                    ["추천 계획 예산", "예상 예산 × 1.05 (고정 buffer)"],
                ]}
            />
            <p className="text-xs mt-3" style={{ color: "var(--mayo-text-muted)" }}>
                동일 축제 이력 기반이어도 아래 &ldquo;Peer 통계&rdquo; 카드는 참고용으로 계속 함께 계산됩니다 — 최종 추정에는 쓰이지 않는 보조 비교입니다.
            </p>
        </Card>
    );
}

const EXCLUSION_REASON_LABEL: Record<SeriesHistoryExclusionReason, string> = {
    MISSING_OR_NONPOSITIVE: "유효한 예산 정보 없음",
    UNIT_SCALE_SUSPECT: "예산 단위 이상 의심",
    MISSING_FEATURE: "지역/유형 정보 없음",
};

const ESTIMATE_SOURCE_LABEL: Record<"LATEST" | "MEDIAN", string> = {
    LATEST: "최근 동일 축제 계획예산",
    MEDIAN: "과거 동일 축제 예산 중앙값",
};

/**
 * READ-ONLY DIAGNOSTIC(Series Data Quality Audit) 표시 라벨 — 24절 원칙: "잘못된 데이터"/"오류
 * 데이터"/"사용 불가" 같은 확정적 표현을 쓰지 않는다. severity는 검토 우선순위일 뿐 오류 확정이
 * 아니다("REVIEW_REQUIRED" != "DATA_ERROR_CONFIRMED").
 */
const AUDIT_SEVERITY_LABEL: Record<DataQualityAuditSeverity, string> = {
    NONE: "추가 검토 신호 없음",
    INFO: "참고",
    MEDIUM: "검토 필요",
    HIGH: "검토 필요(우선)",
};
const AUDIT_REASON_LABEL: Record<DataQualityAuditReason, string> = {
    COMPONENT_SUM_MISMATCH: "구성 합계 확인 필요",
    YEAR_OVER_YEAR_SCALE_JUMP: "전년 대비 급격한 규모 변화",
    SERIES_PRIOR_MEDIAN_DEVIATION: "과거 중앙값 대비 급격한 규모 변화",
    DIGIT_SHIFT_PATTERN: "10배/100배 단위 변화 패턴과 유사",
    ISOLATED_SPIKE_PATTERN: "전후 연도와 비교해 일시적 급변 패턴",
};

function AuditSeverityBadge({ severity }: { severity: DataQualityAuditSeverity }) {
    if (severity === "NONE") return <span style={{ color: "var(--mayo-text-muted)" }}>—</span>;
    const badgeColor = severity === "HIGH" ? "red" as const : severity === "MEDIUM" ? "purple" as const : "blue" as const;
    return (
        <MayoBadge color={badgeColor} variant="soft" size="sm">
            {severity === "HIGH" && "! "}
            {AUDIT_SEVERITY_LABEL[severity]}
        </MayoBadge>
    );
}

/** row 하나의 감사 상세 — "동일 축제 과거 이력" 표의 확장 셀, Top anomalies 표에서 공통으로 쓴다. */
function AuditRecordDetail({ r }: { r: SeriesDataQualityAuditRecord }) {
    return (
        <div className="flex flex-col gap-0.5">
            <AuditSeverityBadge severity={r.severity} />
            {/* 8절 — 기존 flag(VALID)와 이 Series 문맥 진단을 혼동하지 않도록 나란히 보여준다.
                (severity!=="NONE"인 record는 own-history eligibility를 이미 통과했으므로
                budgetQualityFlag는 항상 "VALID"다 - 그 자체가 이 기능의 핵심 메시지.) */}
            {r.severity !== "NONE" && r.budgetQualityFlag && (
                <span className="text-[10px]" style={{ color: "var(--mayo-text-muted)" }}>기존 데이터 품질 flag: {r.budgetQualityFlag}</span>
            )}
            {r.reasons.length > 0 && (
                <ul className="text-[10px] leading-tight" style={{ color: "var(--mayo-text-muted)" }}>
                    {r.reasons.map((reason) => (
                        <li key={reason}>
                            · {AUDIT_REASON_LABEL[reason]}
                            {reason === "YEAR_OVER_YEAR_SCALE_JUMP" && r.yearOverYearRatio !== null && ` (전년 대비 ${r.yearOverYearRatio.toFixed(1)}배)`}
                            {reason === "SERIES_PRIOR_MEDIAN_DEVIATION" && r.priorMedianRatio !== null && ` (중앙값 대비 ${r.priorMedianRatio.toFixed(1)}배)`}
                            {reason === "COMPONENT_SUM_MISMATCH" && r.componentMismatchRatio !== null && ` (${r.componentMismatchRatio.toFixed(1)}배 차이)`}
                            {reason === "DIGIT_SHIFT_PATTERN" && r.suspectedDigitShiftFactor !== null && ` (약 ${r.suspectedDigitShiftFactor}배)`}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/**
 * "동일 축제 과거 이력" — Series 계산(computeOwnHistorySignal)에 실제로 쓰인 개별 historical
 * record를 표로 풀어 보여준다(표시 전용, 계산은 전혀 다시 하지 않는다). API가 이미 leakage-safe
 * 필터/CPI all-or-nothing 규칙을 적용해 내려준 값을 그대로 렌더링만 한다.
 *
 * PHASE G0 — "eligibleForSeriesCalculation"(own-history eligibility를 통과해 이 series에 실제로
 * 연결된 record)과 "usedAsPointEstimateSource"(그 record가 seriesEstimatedBudgetKrw 숫자에 직접
 * 반영됐는가)를 분리해서 보여준다. LATEST 분기에서는 eligible record 중 딱 하나만 point estimate
 * source이고, 나머지 eligible record는 "제외"가 아니라 "유효 이력(참고)"로 표시한다.
 *
 * 하단 parity checker는 estimateSource에 맞춰(LATEST면 해당 한 건, MEDIAN이면 eligible 전체의
 * median) API estimatedBudgetKrw와 일치하는지만 확인한다(×1.05 추천 공식 검산은 이미 있는
 * RecommendationCheckCard가 담당 - 여기서 중복하지 않는다).
 */
function SeriesHistoryDetailCard({ detail, result }: { detail: SeriesHistoryDetailDto; result: MultiYearBudgetEstimateResponse }) {
    const eligibleRecords = detail.records.filter((r) => r.eligibleForSeriesCalculation);
    const excludedRecords = detail.records.filter((r) => !r.eligibleForSeriesCalculation);
    const pointEstimateRecords = detail.records.filter((r) => r.usedAsPointEstimateSource);
    // cpiFullyAvailable=false면 own-history.ts가 point estimate 계산에 원본(nominal) 값을 그대로
    // 썼다 - 여기서도 같은 값을 재계산에 써야 API 값과 일치한다(cpiAdjustedBudgetKrw는 이 경우
    // 전부 null로 내려오므로 originalBudgetKrw를 대신 쓴다).
    const pointEstimateValues = pointEstimateRecords.map((r) => (detail.cpiFullyAvailable ? r.cpiAdjustedBudgetKrw! : r.originalBudgetKrw!));
    const computedEstimate =
        pointEstimateValues.length === 0
            ? null
            : detail.estimateSource === "LATEST"
                ? Math.round(pointEstimateValues[0])
                : Math.round(quantile(pointEstimateValues, 0.5));
    const estimateMatchesApi = computedEstimate !== null && computedEstimate === result.estimatedBudgetKrw;

    // READ-ONLY DIAGNOSTIC(Series Data Quality Audit) — datasetYear+festivalName으로 join한다.
    // seriesDataQualityAudit.records는 own-history eligibility를 통과한 record만 담고 있으므로
    // (excluded record는 애초에 감사 대상이 아니다) 제외된 행은 조회되지 않는 게 정상이다.
    const auditByKey = new Map<string, SeriesDataQualityAuditRecord>();
    for (const r of result.seriesDataQualityAudit?.records ?? []) {
        auditByKey.set(`${r.datasetYear}::${r.festivalName}`, r);
    }
    const audit = result.seriesDataQualityAudit;
    const pointEstimateAuditRows = pointEstimateRecords
        .map((r) => auditByKey.get(`${r.datasetYear}::${r.festivalName}`))
        .filter((r): r is SeriesDataQualityAuditRecord => r !== undefined && r.severity !== "NONE");

    return (
        <Card title="동일 축제 과거 이력">
            <div className="mb-3">
                <MayoAlert type="success">
                    추정 기준: <span className="font-semibold">{ESTIMATE_SOURCE_LABEL[detail.estimateSource]}</span>
                    {" · "}최근 이력: {detail.latestHistoricalYear}년{" · "}계획연도와 차이: {detail.latestHistoricalGap}년
                    {detail.estimateSource === "MEDIAN" && <span> — 최근 이력이 3년 이상 오래되어 중앙값을 사용했습니다.</span>}
                </MayoAlert>
            </div>

            {/* 15/16절 — 데이터 품질 진단 요약. severity는 오류 확정이 아니라 검토 우선순위다. */}
            {audit && (
                <MayoCard variant="outlined" padding="sm">
                    <p className="font-semibold text-xs mb-1.5" style={{ color: "var(--mayo-text-secondary)" }}>데이터 품질 진단</p>
                    {audit.reviewRequiredCount === 0 ? (
                        <p className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>추가 검토 신호 없음</p>
                    ) : (
                        <p className="text-xs" style={{ color: "var(--mayo-text-secondary)" }}>
                            검토 필요 record: <span className="font-semibold">{audit.reviewRequiredCount} / {audit.recordCount}</span>
                            {" · "}HIGH: {audit.highCount}{" · "}MEDIUM: {audit.mediumCount}{" · "}참고: {audit.infoCount}
                        </p>
                    )}
                    {pointEstimateAuditRows.length > 0 && (
                        <div className="mt-2">
                            <MayoAlert type="warning">
                                예상 예산 기준값에 데이터 검토 신호가 있습니다:
                                {pointEstimateAuditRows.map((r) => (
                                    <div key={r.recordId} className="mt-1">
                                        <span className="font-semibold">{r.datasetYear}년</span> <AuditSeverityBadge severity={r.severity} />
                                    </div>
                                ))}
                            </MayoAlert>
                        </div>
                    )}
                    <p className="text-[10px] mt-1.5" style={{ color: "var(--mayo-text-muted)" }}>
                        데이터 품질 진단은 오류 확정이 아니라 검토 우선순위입니다. 표시된 값은 자동 수정되거나 예산 계산에서 제외되지 않습니다.
                    </p>
                </MayoCard>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <MiniStat label="확인된 과거 이력" value={`${detail.displayedRecordCount}회`} />
                <MiniStat label="유효 이력" value={`${detail.eligibleForSeriesCalculationCount}회`} />
                <MiniStat label="계산 제외" value={`${detail.excludedCount}회`} />
                <MiniStat label="관측 연도 범위" value={`${detail.firstObservedYear}~${detail.lastObservedYear}`} />
            </div>

            {detail.excludedCount > 0 && (
                <div className="mb-2">
                    <MayoAlert type="warning">
                        확인된 과거 이력 {detail.displayedRecordCount}회 중 {detail.excludedCount}회는 예산 정보가 없거나 유효하지 않아 계산에서 제외됐습니다 — 아래 표에서 &ldquo;계산 사용 여부&rdquo;를 확인하세요.
                    </MayoAlert>
                </div>
            )}

            {!detail.cpiFullyAvailable && (
                <div className="mb-3">
                    <MayoAlert type="info">
                        이 계획연도 기준 CPI 값이 일부 연도에 없어(CPI 보정표 미보유), 이번 계산은 CPI 보정 없이 원본(nominal) 예산 그대로 추정했습니다 — 아래 &ldquo;CPI 보정 예산&rdquo; 열이 모든 행에서 비어 있는 것은 정상입니다(일부 행만 보정되지 않습니다).
                    </MayoAlert>
                </div>
            )}

            <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0" style={{ background: "var(--mayo-surface)" }}>
                        <tr style={{ background: "var(--mayo-bg-subtle)" }}>
                            <th className="text-left px-2 py-1.5" style={{ borderBottom: "1px solid var(--mayo-border)" }}>연도</th>
                            <th className="text-left px-2 py-1.5" style={{ borderBottom: "1px solid var(--mayo-border)" }}>당시 축제명</th>
                            <th className="text-left px-2 py-1.5" style={{ borderBottom: "1px solid var(--mayo-border)" }}>지역/시군구</th>
                            <th className="text-left px-2 py-1.5" style={{ borderBottom: "1px solid var(--mayo-border)" }}>축제유형</th>
                            <th className="text-left px-2 py-1.5" style={{ borderBottom: "1px solid var(--mayo-border)" }}>장소유형</th>
                            <th className="text-right px-2 py-1.5" style={{ borderBottom: "1px solid var(--mayo-border)" }}>개최기간</th>
                            <th className="text-right px-2 py-1.5" style={{ borderBottom: "1px solid var(--mayo-border)" }}>당시 계획예산</th>
                            <th className="text-right px-2 py-1.5" style={{ borderBottom: "1px solid var(--mayo-border)" }}>CPI 보정 예산</th>
                            <th className="text-left px-2 py-1.5" style={{ borderBottom: "1px solid var(--mayo-border)" }}>계산 사용 여부</th>
                            <th className="text-left px-2 py-1.5" style={{ borderBottom: "1px solid var(--mayo-border)" }}>데이터 품질</th>
                        </tr>
                    </thead>
                    <tbody>
                        {detail.records.map((r, i) => {
                            const auditRow = auditByKey.get(`${r.datasetYear}::${r.festivalName}`);
                            return (
                            <tr
                                key={i}
                                style={{
                                    borderBottom: "1px solid var(--mayo-border)",
                                    ...(r.usedAsPointEstimateSource ? { background: "var(--mayo-bg-subtle)" } : !r.eligibleForSeriesCalculation ? { background: "var(--mayo-bg-subtle)", color: "var(--mayo-text-muted)" } : {}),
                                }}
                            >
                                <td className="px-2 py-1.5">{r.datasetYear}</td>
                                <td className="px-2 py-1.5">{r.festivalName}</td>
                                <td className="px-2 py-1.5">
                                    {r.region ? REGION_DISPLAY[r.region] : "—"}{r.district ? `/${r.district}` : ""}
                                </td>
                                <td className="px-2 py-1.5">
                                    {r.festivalTypes.length > 0 ? r.festivalTypes.map((t) => FESTIVAL_TYPE_DISPLAY[t]).join("/") : "—"}
                                </td>
                                <td className="px-2 py-1.5">{r.venueType ? VENUE_TYPE_DISPLAY[r.venueType] : "—"}</td>
                                <td className="px-2 py-1.5 text-right">{r.durationDays !== null ? `${r.durationDays}일` : "정보 없음"}</td>
                                <td className="px-2 py-1.5 text-right">{r.originalBudgetKrw !== null ? fmt(r.originalBudgetKrw) : "정보 없음"}</td>
                                <td className="px-2 py-1.5 text-right">
                                    {r.eligibleForSeriesCalculation ? (r.cpiAdjustedBudgetKrw !== null ? fmt(r.cpiAdjustedBudgetKrw) : "— (nominal 사용)") : "—"}
                                </td>
                                <td className="px-2 py-1.5">
                                    {r.usedAsPointEstimateSource ? (
                                        <MayoBadge color="green" variant="soft" size="sm">예상 예산 기준값</MayoBadge>
                                    ) : r.eligibleForSeriesCalculation ? (
                                        <span style={{ color: "var(--mayo-text-secondary)" }}>유효 이력(참고)</span>
                                    ) : (
                                        <span style={{ color: "var(--mayo-text-muted)" }}>제외 ({EXCLUSION_REASON_LABEL[r.exclusionReason!]})</span>
                                    )}
                                </td>
                                <td className="px-2 py-1.5">
                                    {auditRow ? <AuditRecordDetail r={auditRow} /> : <span style={{ color: "var(--mayo-text-muted)" }}>—</span>}
                                </td>
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <details className="mt-2 text-[11px]" style={{ color: "var(--mayo-text-muted)" }}>
                <summary className="cursor-pointer font-medium">표 해석 안내 및 parity 검증 ▸</summary>
                <div className="mt-1 flex flex-col gap-1">
                    <p>개최기간은 참고 정보이며 Series 예산 산식(×1.05)에는 직접 사용되지 않습니다.</p>
                    {detail.estimateSource === "LATEST" && eligibleRecords.length > pointEstimateRecords.length && (
                        <p>&ldquo;유효 이력(참고)&rdquo; 행은 제외된 것이 아닙니다 — 최근 이력 기준값 외 나머지는 참고용으로 표시됩니다.</p>
                    )}
                    {excludedRecords.length > 0 && (
                        <p>제외된 record는 정규화된 축제명 기준 매칭 후 걸러진 것의 근사치입니다.</p>
                    )}
                </div>
                <MayoDivider />
                <div>
                    <p className="text-[11px] font-semibold mb-1.5" style={{ color: "var(--mayo-text-muted)" }}>estimate parity 검증 (표시 전용)</p>
                    <div className="font-mono text-xs rounded p-3 flex flex-col gap-0.5" style={{ background: "var(--mayo-bg-subtle)" }}>
                        <div>
                            {detail.estimateSource === "LATEST" ? "예상 예산 기준값(최근 이력)" : `${detail.cpiFullyAvailable ? "CPI 보정" : "원본(nominal)"} 예산 ${pointEstimateValues.length}건의 median`}
                        </div>
                        <div>→ {computedEstimate !== null ? fmt(computedEstimate) : "—"} <span style={{ color: "var(--mayo-text-muted)" }}>(재계산값)</span></div>
                        <div className="pt-1 mt-1" style={{ borderTop: "1px solid var(--mayo-border)" }}>API estimatedBudgetKrw = {fmt(result.estimatedBudgetKrw)}</div>
                        <div>일치 = {estimateMatchesApi ? "✓" : "✗"}</div>
                    </div>
                </div>
            </details>
        </Card>
    );
}

/**
 * PHASE — Final Production Benchmark & Future-Year Safety(20절). "예산 추정 / Data Quality /
 * Reliability / Future-year safety"는 서로 다른 축이다 - 이 카드는 그중 Future-year safety만
 * 담당한다(계획연도가 보유 데이터보다 미래일 때 G0/CPI가 어떤 근거로 계산됐는지 보여줄 뿐, 새
 * 계산을 하지 않는다 - 전부 API가 이미 계산한 seriesSignal/seriesHistoryDetail 값 그대로).
 */
function FutureYearSafetyCard({ result }: { result: MultiYearBudgetEstimateResponse }) {
    const signal = result.seriesSignal;
    if (signal.status !== "MATCHED" || signal.latestHistoricalYear === undefined || signal.latestHistoricalGap === undefined || signal.estimateSource === undefined) {
        return null;
    }
    const cpiFullyAvailable = result.seriesHistoryDetail?.cpiFullyAvailable ?? null;

    return (
        <Card title="Future-year 진단">
            <FieldGrid
                rows={[
                    ["계획연도", `${result.planningYear}년`],
                    ["최신 동일 축제 이력", `${signal.latestHistoricalYear}년`],
                    ["차이(gap)", `${signal.latestHistoricalGap}년`],
                    ["추정 기준", ESTIMATE_SOURCE_LABEL[signal.estimateSource]],
                    [
                        "CPI 적용",
                        cpiFullyAvailable === null
                            ? "—"
                            : cpiFullyAvailable
                                ? "CPI 보정 적용"
                                : "미래/미지원 연도라 CPI 보정 없이 명목(nominal) 예산 기준",
                    ],
                ]}
            />
            <p className="text-[10px] mt-2" style={{ color: "var(--mayo-text-muted)" }}>
                이 카드는 Data Quality(source value 검토 신호)·Reliability(과거 데이터 근거의 안정성)와는 별개 축입니다 —
                &ldquo;audit HIGH&rdquo;와 &ldquo;reliability LOW&rdquo;와 &ldquo;future fallback(명목 예산 사용)&rdquo;은 서로
                다른 의미이며 자동으로 연결되지 않습니다.
            </p>
        </Card>
    );
}

function AlgorithmValuesCard({ result }: { result: MultiYearBudgetEstimateResponse }) {
    const hasSeriesSignal = result.seriesSignal.status === "MATCHED";
    return (
        <Card title="알고리즘 적용값">
            <FieldGrid
                rows={[
                    ["Estimate basis", <code key="1">{result.estimateBasis}</code>],
                    ["Recommendation basis", <code key="2">{result.recommendationBasis}</code>],
                    ["Range basis", <code key="3">{result.rangeBasis}</code>],
                    ["Data quality basis", <code key="4">{result.dataQualityBasis}</code>],
                    ["Fallback level", <code key="5">{FALLBACK_LEVEL_LABEL[result.fallbackLevel as FallbackLevel] ?? result.fallbackLevel}</code>],
                    ["Average similarity", `${(result.averageSimilarity * 100).toFixed(1)}%`],
                    ["Sample count", `${result.sampleCount}`],
                    ["Distinct years", `${result.distinctYearsUsed}`],
                    ["Effective year count", result.effectiveYearCount.toFixed(1)],
                    ["Series match method", hasSeriesSignal ? (result.seriesSignal.matchMethod ?? "—") : "— (해당 없음)"],
                    ["dataQualityV3 (legacy, 참고용)", `${result.dataQualityV3.toFixed(1)}점`],
                ]}
            />
        </Card>
    );
}

function DataUsageCard({ result }: { result: MultiYearBudgetEstimateResponse }) {
    return (
        <Card title="데이터 사용 현황">
            <FieldGrid
                rows={[
                    ["참조 대상 pool", result.referencePoolEarliestYear !== null && result.referencePoolLatestYear !== null ? `${result.referencePoolEarliestYear}~${result.referencePoolLatestYear}` : "—"],
                    ["정책상 허용 범위", `${result.referenceYearFrom}~${result.referenceYearTo}`],
                    ["최종 비교 표본", result.earliestSourceYear !== null && result.latestSourceYear !== null ? `${result.earliestSourceYear}~${result.latestSourceYear}` : "—"],
                    ["실제 활용 연도", `${result.distinctYearsUsed}개`],
                    ["유효 연도 수", result.effectiveYearCount.toFixed(1)],
                    ["최종 표본", `${result.sampleCount}개`],
                ]}
            />
        </Card>
    );
}


/**
 * PHASE 7 — production 코드(lib/multiyear/baseline-estimator.ts의 selectFinalSample/
 * computeCoreStats, lib/multiyear/planning-estimator.ts의 estimateForPlanning)에 정확히 맞춘
 * 설명만 담는다. 확인된 사실:
 * - topCandidates는 finalSample(유사도 threshold 통과 + weight 내림차순 정렬 + 최대 50건 컷)의
 *   앞 10건일 뿐이다 - 별도로 다시 추출한 집합이 아니다. 정렬 순서 그대로 잘라낸 것이므로 항상
 *   "유사도가 가장 높은 10건"이다.
 * - 하지만 예상 예산/추천 예산/P25~P75/가중평균 등 실제 통계는 finalSample 전체(최대 50건)로
 *   계산되고, 화면에 보이는 10건만으로 계산되지 않는다(estimateForPlanning: computeCoreStats(fs, ...)
 *   가 먼저 fs.finalSample 전체로 실행되고, topCandidates는 그 뒤 slice(0,10)으로 표시용만 따로 만듦).
 * - 정렬 기준은 weight(=similarity²) 내림차순이고, weight는 similarity의 단조 증가 함수이므로
 *   "유사도 높은 순"과 사실상 같은 순서다. exact tie만 결정적 규칙(sourceSha256|sourceSheet|
 *   sourceRow)으로 2차 정렬된다 - 재현성을 위한 규칙일 뿐 "더 좋은 후보"라는 의미가 아니다.
 * - "과거 계획 예산"(originalBudgetKrw)은 CPI 보정도, winsorize도, 기간보정도 전혀 거치지 않은
 *   원본 과거 예산이다(Peer는 CPI OFF 정책 그대로).
 * - "N일 기준 조정 예산"(durationAdjustedBudgetKrw)은 adjustDuration(원 예산, sourceDuration,
 *   목표 기간) = 원 예산 × clamp(목표일수/과거일수, 0.5, 2.0)^0.55 의 결과다. sourceDuration이
 *   없는(null) 후보는 이 함수가 원 예산을 그대로 반환한다(무보정) - 후보에서 제외되지 않는다.
 * - 실제 통계 계산(P25~P75/가중평균/예상 예산)에는 이 조정 예산에 winsorize(같은 유형 broad
 *   population 기준 상하위 5% clip, 기간보정 다음 단계)까지 한 번 더 적용된 값이 들어간다 -
 *   그 winsorize 이후 값은 API가 별도 필드로 내려주지 않으므로 이 표에는 표시할 수 없다(추측 금지,
 *   해당 사실을 그대로 안내).
 */
function CandidatesCard({
    candidates,
    sampleCount,
    requestedDurationDays,
}: {
    candidates: MultiYearPredictionCandidateDto[];
    sampleCount: number;
    requestedDurationDays: number | null;
}) {
    const adjustedHeader = requestedDurationDays !== null ? `${requestedDurationDays}일 기준 조정` : "조정 예산";
    const candidateColumns = [
        { key: "festivalName", label: "축제명" },
        { key: "sourceYear", label: "연도", width: "55px" },
        { key: "region", label: "지역", render: (_v: unknown, row: Record<string, unknown>) => `${(row.region as string) ?? "—"}${row.district ? `/${row.district}` : ""}` },
        { key: "festivalType", label: "유형" },
        { key: "durationDays", label: "기간", render: (v: unknown) => (v as number | null) !== null ? `${v}일` : "—" },
        { key: "originalBudgetKrw", label: "원본 예산", render: (v: unknown) => fmt(v as number) },
        { key: "durationAdjustedBudgetKrw", label: adjustedHeader, render: (v: unknown) => fmt(v as number) },
        { key: "similarity", label: "유사도", render: (v: unknown) => `${((v as number) * 100).toFixed(1)}%` },
        { key: "finalWeight", label: "Weight", render: (v: unknown) => (v as number).toFixed(3) },
    ];

    return (
        <div className="flex flex-col gap-2">
            <p className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>
                유사도 순 상위 {candidates.length}건 표시 · 전체 {sampleCount}건으로 통계 계산
            </p>
            <MayoTable
                columns={candidateColumns}
                data={candidates.map((c, i) => ({ ...c, _idx: i })) as unknown as Record<string, unknown>[]}
                rowKey="_idx"
                striped
                bordered
            />
        </div>
    );
}

const AUDIT_SEVERITY_TAB_OPTIONS: { value: DataQualityAuditSeverity | "ALL"; label: string }[] = [
    { value: "ALL", label: "전체" },
    { value: "HIGH", label: "HIGH" },
    { value: "MEDIUM", label: "MEDIUM" },
    { value: "INFO", label: "참고" },
];

/**
 * 17/18절 — "전체 데이터 품질 감사"(READ-ONLY DIAGNOSTIC). 특정 estimate 결과와 무관하게 항상
 * 표시된다(어떤 series-linked VALID record가 review 우선순위가 높은지, 보유 데이터 전체 기준).
 * `GET /api/v1/data-quality-audit`을 처음 펼쳤을 때만 호출한다(페이지 로드마다 자동 호출하지
 * 않음).
 */
/** MayoAccordion용 Inner — 마운트 시 자동 fetch. */
function GlobalDataQualityAuditInner() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<DataQualityAuditResponse | null>(null);
    const [severity, setSeverity] = useState<DataQualityAuditSeverity | "ALL">("ALL");
    const [reason, setReason] = useState<DataQualityAuditReason | "ALL">("ALL");
    const [q, setQ] = useState("");

    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            setLoading(true);
            setError(null);
            fetchDataQualityAudit({ severity, reason: reason === "ALL" ? undefined : reason, q: q.trim() || undefined, limit: 50 })
                .then((res) => { if (!cancelled) setData(res); })
                .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "데이터 품질 감사 조회 실패"); })
                .finally(() => { if (!cancelled) setLoading(false); });
        }, SEARCH_DEBOUNCE_MS);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [severity, reason, q]);

    const auditTableColumns = [
        { key: "canonicalSeriesName", label: "축제" },
        { key: "datasetYear", label: "연도", width: "60px" },
        { key: "budgetKrw", label: "예산", render: (v: unknown) => (v as number | null) !== null ? fmt(v as number) : "—" },
        { key: "previousBudgetKrw", label: "이전 예산", render: (v: unknown) => (v as number | null) !== null ? fmt(v as number) : "—" },
        { key: "budgetQualityFlag", label: "기존 flag", render: (v: unknown) => (v as string) ?? "—" },
        { key: "severity", label: "진단", render: (_v: unknown, row: Record<string, unknown>) => <AuditRecordDetail r={row as unknown as SeriesDataQualityAuditRecord} /> },
    ];

    return (
        <div className="flex flex-col gap-3 text-xs">
            <p className="text-[11px]" style={{ color: "var(--mayo-text-muted)" }}>
                데이터 품질 진단은 오류 확정이 아니라 검토 우선순위입니다.
            </p>
            {loading && !data && <MayoLoadingSpinner size="sm" color="blue" label="불러오는 중..." />}
            {error && <MayoAlert type="error">{error}</MayoAlert>}
            {data && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <MiniStat label="감사 대상" value={`${data.summary.auditPoolRecordCount.toLocaleString()}건`} />
                        <MiniStat label="검토 필요" value={`${data.summary.reviewRequiredCount.toLocaleString()}건 (${((data.summary.reviewRequiredCount / data.summary.auditPoolRecordCount) * 100).toFixed(1)}%)`} />
                        <MiniStat label="HIGH" value={`${data.summary.highCount.toLocaleString()}건`} />
                        <MiniStat label="MEDIUM" value={`${data.summary.mediumCount.toLocaleString()}건`} />
                    </div>
                    <MayoDivider />
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex gap-1">
                            {AUDIT_SEVERITY_TAB_OPTIONS.map((opt) => (
                                <MayoBtn key={opt.value} type="button" onClick={() => setSeverity(opt.value)} variant={severity === opt.value ? "primary" : "secondary"} color="green" size="xs">{opt.label}</MayoBtn>
                            ))}
                        </div>
                        <MayoSelect size="sm" value={reason} onChange={(e) => setReason(e.target.value as DataQualityAuditReason | "ALL")} options={[{ value: "ALL", label: "reason 전체" }, ...(Object.keys(AUDIT_REASON_LABEL) as DataQualityAuditReason[]).map((r) => ({ value: r, label: AUDIT_REASON_LABEL[r] }))]} />
                        <div className="flex-1 min-w-[8rem]">
                            <MayoInput type="text" size="sm" placeholder="축제명 검색" value={q} onChange={(e) => setQ(e.target.value)} />
                        </div>
                    </div>
                    <p className="text-[10px]" style={{ color: "var(--mayo-text-muted)" }}>
                        {data.matchedCount.toLocaleString()}건 중 {data.returnedCount.toLocaleString()}건 표시
                    </p>
                    <MayoTable columns={auditTableColumns} data={data.anomalies as unknown as Record<string, unknown>[]} rowKey="recordId" striped bordered emptyText="조건에 맞는 record가 없습니다." />
                </>
            )}
        </div>
    );
}

/** MayoAccordion용 Inner — 마운트 시 자동 fetch (한 번만). */
function GlobalReliabilityAuditInner() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<ReliabilityAuditResponse | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchReliabilityAudit()
            .then((res) => { if (!cancelled) setData(res); })
            .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Reliability 감사 조회 실패"); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const fmtPct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(2)}%`);
    const fmtNum = (v: number | null) => (v === null ? "—" : v.toFixed(4));

    const reliabilityTableColumns = [
        { key: "tier", label: "Tier", render: (v: unknown) => <span className="font-semibold">{v as string}</span> },
        { key: "n", label: "n", render: (v: unknown) => (v as number).toLocaleString() },
        { key: "estimateMdApe", label: "Est. MdAPE", render: (v: unknown) => fmtPct(v as number | null) },
        { key: "estimateP90Ape", label: "P90", render: (v: unknown) => fmtPct(v as number | null) },
        { key: "estimateP95Ape", label: "P95", render: (v: unknown) => fmtPct(v as number | null) },
        { key: "recommendationMdApe", label: "Rec. MdAPE", render: (v: unknown) => fmtPct(v as number | null) },
        { key: "historicalDispersionMedian", label: "Dispersion median", render: (v: unknown) => fmtNum(v as number | null) },
        { key: "singleHistoryCount", label: "Single/Multi", render: (_v: unknown, row: Record<string, unknown>) => `${row.singleHistoryCount}/${row.multiHistoryCount}` },
    ];

    return (
        <div className="flex flex-col gap-3 text-xs">
            <p className="text-[11px]" style={{ color: "var(--mayo-text-muted)" }}>
                신뢰도는 추정에 사용한 과거 데이터 근거의 안정성 지표입니다. 이 backtest는 production 판정식을 바꾸지 않습니다.
            </p>
            {loading && !data && <MayoLoadingSpinner size="sm" color="blue" label="불러오는 중..." />}
            {error && <MayoAlert type="error">{error}</MayoAlert>}
            {data && (
                <>
                    <p className="text-[10px]" style={{ color: "var(--mayo-text-muted)" }}>fold: {data.summary.foldYears.join("/")} · Series n={data.summary.seriesN.toLocaleString()}</p>
                    <MayoTable columns={reliabilityTableColumns} data={data.summary.tiers as unknown as Record<string, unknown>[]} rowKey="tier" striped bordered />
                </>
            )}
        </div>
    );
}
