"use client";

import { useEffect, useState } from "react";
import type { MetadataResponse } from "@/lib/domain/types";
import { FALLBACK_LEVEL_LABEL, FallbackLevel, FESTIVAL_TYPE_DISPLAY, REGION_DISPLAY, VENUE_TYPE_DISPLAY } from "@/lib/domain/enums";
import {
    estimateMultiYearBudget,
    MultiYearBudgetEstimateResponse,
    MultiYearPredictionCandidateDto,
    searchMultiYearSeries,
} from "@/lib/api/multiyear-budget-estimates";
import { resolveSeriesDisplayState, SERIES_FALLBACK_MESSAGE } from "@/lib/multiyear-series/planning-ui-display";
import { buildSeriesSearchResultKey, type SeriesSearchResult } from "@/lib/multiyear-series/series-search";

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
 * 다년도 계획예산 알고리즘 테스터 — 내부 검증용.
 *
 * 이 페이지는 최종 사용자용 UI가 아니다. `estimateMultiYearBudget()`(production API,
 * `/api/v1/multiyear-budget-estimates`)이 돌려주는 값을 "읽고 설명"하기만 한다 - 알고리즘을
 * 다시 계산하지 않는다. 유일한 예외는 §10의 recommendation formula 검산(§14/§15 문서 공식을
 * production이 실제로 지키는지 표시용으로 재확인하는 것)이며, 이 결과로 API 값을 대체하지
 * 않는다(불일치가 나오면 그대로 경고만 띄운다).
 *
 * 2026 단년도(`/api/v1/budget-estimates`, `BudgetEstimateResponse`) 관련 UI/state/handler는
 * 이 페이지에서 완전히 제거했다 - production API 자체나 다른 소비자(`lib/services/budget-estimator.ts`
 * 등)는 건드리지 않았다.
 */
export default function AssistantTesterPage() {
    const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
    const [metaError, setMetaError] = useState<string | null>(null);

    // PHASE 6 — "과년도에 개최했던 축제" vs "신규 축제"를 먼저 명시적으로 고른다. EXISTING을
    // 기본값으로 둔다 - 이 tester의 핵심 기능(과거 데이터 검색)을 먼저 마주치게 하되, 상단에 항상
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

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        // 버튼 disabled로 이미 막지만, Enter 키 제출 등 예외 경로까지 대비한 방어적 재확인
        // (canSubmit과 동일 조건). durationDays=""였다면 Number("")=0이 그대로 request에 실릴 수
        // 있었던 문제를 여기서도 완전히 막는다.
        if (!canSubmit) return;
        setError(null);
        setResult(null);
        setMetadataResetNotice(false);
        setLoading(true);
        try {
            const data = await estimateMultiYearBudget({
                regionCode,
                district: district || undefined,
                festivalTypes,
                venueType,
                durationDays: Number(durationDays),
                planningYear: Number(planningYear),
                // 3절 — 이 tester의 기본 production 검증 조건은 항상 HISTORICAL_ONLY로 고정한다
                // (참고 데이터 정책 라디오 UI 자체를 제거했다 - 요청대로 "제거하는 방향"을 택함).
                referenceDataPolicy: "HISTORICAL_ONLY",
                festivalName: festivalName.trim() || undefined,
            });
            setResult(data);
            setSubmittedDurationDays(Number(durationDays));
        } catch (e) {
            setError(e instanceof Error ? e.message : "다년도 계획예산 추정에 실패했습니다.");
        } finally {
            setLoading(false);
        }
    }

    const regionName = metadata?.regions.find((r) => r.code === regionCode)?.displayName ?? regionCode;
    const typeNames = festivalTypes
        .map((c) => metadata?.festivalTypes.find((t) => t.code === c)?.displayName ?? c)
        .join(", ");
    const venueName = metadata?.venueTypes.find((v) => v.code === venueType)?.displayName ?? venueType;

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
        <main className="min-h-screen lg:h-screen bg-gray-50 text-gray-900 flex flex-col p-4 lg:p-6 lg:overflow-hidden">
            <header className="shrink-0 mb-4">
                <h1 className="text-xl font-bold">다년도 계획예산 알고리즘 테스터</h1>
                <p className="text-xs text-gray-600 mt-0.5">
                    2017~2026 공개 축제 계획 데이터를 기반으로 하는 최종 production 알고리즘(<code className="text-[11px]">estimateMultiYearBudget</code>)의 계산 근거를 검증하기 위한 내부 도구입니다 — 최종 사용자용 화면이 아닙니다.
                </p>
            </header>

            {metaError && (
                <div className="shrink-0 mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 max-w-[1600px] w-full mx-auto">
                    메타데이터 오류: {metaError}
                </div>
            )}

            <div className="flex-1 min-h-0 w-full max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-[minmax(320px,38%)_1fr] gap-4 lg:gap-6">
                {/* 좌측: 입력 조건 */}
                <section className="lg:overflow-y-auto lg:pr-1 flex flex-col gap-4 pb-4">
                    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-5 flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">계획연도</label>
                            <input
                                type="number"
                                className="border rounded px-3 py-2 text-sm w-32"
                                value={planningYear}
                                onChange={(e) => handlePlanningYearChange(Number(e.target.value))}
                            />
                        </div>

                        {/* PHASE 6 — 축제 구분을 가장 먼저 명시적으로 고른다(radio 대신 기존 UI
                            톤에 맞는 segmented control). 현재 모드가 항상 채워진 배경색으로 뚜렷이
                            드러난다. */}
                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">어떤 축제를 계획하고 있나요?</label>
                            <div className="flex gap-2" role="radiogroup" aria-label="축제 구분">
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={festivalMode === "EXISTING"}
                                    onClick={() => handleFestivalModeChange("EXISTING")}
                                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${
                                        festivalMode === "EXISTING" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                                    }`}
                                >
                                    과년도에 개최했던 축제
                                </button>
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={festivalMode === "NEW"}
                                    onClick={() => handleFestivalModeChange("NEW")}
                                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${
                                        festivalMode === "NEW" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                                    }`}
                                >
                                    신규 축제
                                </button>
                            </div>
                        </div>

                        {festivalMode === "EXISTING" ? (
                            <div className="flex flex-col gap-1 relative">
                                <label className="text-sm font-medium">축제명 검색</label>
                                <input
                                    type="text"
                                    className="border rounded px-3 py-2 text-sm"
                                    placeholder="예: 부산국제록페스티벌 (2자 이상 입력 시 과거 데이터 검색)"
                                    value={seriesSearchText}
                                    onChange={(e) => handleSeriesSearchTextChange(e.target.value)}
                                    onFocus={() => {
                                        if (seriesSearchResults.length > 0) setSeriesSearchOpen(true);
                                    }}
                                    onBlur={() => setSeriesSearchOpen(false)}
                                />

                                {/* PHASE 6 — 검색어 자체는 festivalName이 아니라는 것을 항상 보이는
                                    자리에서 설명한다. selectedSeries/reset 안내가 있으면 그쪽이 더
                                    구체적이므로 이 일반 안내는 자리를 양보한다. */}
                                {!selectedSeries && !metadataResetNotice && (
                                    <p className="text-[11px] text-gray-500 mt-0.5">
                                        과거 데이터에 있는 실제 축제를 검색해 목록에서 직접 선택해주세요. 이 입력창의 글자 자체는 최종 축제명이 아닙니다.
                                    </p>
                                )}

                                {metadataResetNotice && !selectedSeries && (
                                    <p className="text-[11px] text-amber-700 mt-0.5">
                                        ⓘ 검색어를 수정해 이전 선택과 자동입력 정보를 초기화했습니다 — 목록에서 다시 선택해주세요.
                                    </p>
                                )}

                                {seriesSearchOpen && (
                                    <div
                                        className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border rounded-lg shadow-lg max-h-72 overflow-y-auto text-sm"
                                        // mousedown이 input의 blur보다 먼저 발생하므로, 여기서 선택 클릭을
                                        // 처리하면 blur가 먼저 dropdown을 닫아버리는 문제가 없다.
                                        onMouseDown={(e) => e.preventDefault()}
                                    >
                                        {seriesSearchLoading && (
                                            <div className="px-3 py-2.5 text-xs text-gray-400">검색 중...</div>
                                        )}
                                        {/* PHASE 6 — EXISTING mode에서는 결과 없음이어도 free-text로
                                            계산할 수 없다는 것을 명확히 안내하고 '신규 축제'로의 전환을
                                            제안한다(ambiguous free-text path 제거). */}
                                        {!seriesSearchLoading && seriesSearchResults.length === 0 && (
                                            <div className="px-3 py-2.5 text-xs text-gray-500">
                                                과거 데이터에서 해당 축제를 찾지 못했습니다. 새로운 축제를 계획 중이라면 위에서 &lsquo;신규 축제&rsquo;를 선택해주세요.
                                            </div>
                                        )}
                                        {/* 결과가 "과거 데이터에서 찾은 관련 축제" 목록임을 heading으로
                                            명시한다. FrozenSeries/SeriesGroup/historyCount 같은 내부 용어는
                                            화면에 그대로 노출하지 않는다("과거 이력 N회"로 표현). */}
                                        {!seriesSearchLoading && seriesSearchResults.length > 0 && (
                                            <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 bg-gray-50 border-b sticky top-0">
                                                과거 데이터에서 찾은 관련 축제
                                            </div>
                                        )}
                                        {/* PHASE 6 — 비슷한 이름/동명 축제를 구분할 수 있도록 canonical
                                            name/지역/시군구/유형/관측연도/이력 횟수를 전부 보여준다. 내부
                                            Series ID/groupId는 노출하지 않는다. */}
                                        {!seriesSearchLoading && seriesSearchResults.map((r) => (
                                            <button
                                                key={buildSeriesSearchResultKey(r)}
                                                type="button"
                                                onClick={() => handleSelectSeries(r)}
                                                className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-0"
                                            >
                                                <div className="font-medium text-gray-800">{r.canonicalName}</div>
                                                <div className="text-[11px] text-gray-500 mt-0.5">
                                                    {[
                                                        r.regionCode ? REGION_DISPLAY[r.regionCode] : null,
                                                        r.district ?? null,
                                                        r.fieldStatus.festivalTypes === "STABLE" && r.autoFill.festivalTypes.length > 0
                                                            ? r.autoFill.festivalTypes.map((t) => FESTIVAL_TYPE_DISPLAY[t]).join("/")
                                                            : null,
                                                    ]
                                                        .filter(Boolean)
                                                        .join(" · ") || "지역/유형 정보가 연도별로 상이"}
                                                </div>
                                                <div className="text-[11px] text-gray-400">
                                                    {r.firstObservedYear}~{r.lastObservedYear} · 과거 이력 {r.historyCount}회
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {/* PHASE 6 — Series 선택 즉시 별도의 시각적 블록으로 "과거 이력 기반
                                    기본 정보"를 보여준다. STABLE/MIXED/MISSING 원문은 노출하지 않는다. */}
                                {selectedSeries && (
                                    <div className="mt-1 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm">
                                        <p className="text-emerald-800 font-medium">✓ 과거 축제 데이터를 불러왔습니다.</p>
                                        <p className="text-emerald-900 font-semibold mt-1">{selectedSeries.canonicalName}</p>
                                        <p className="text-[11px] text-emerald-700">
                                            과거 이력 {selectedSeries.historyCount}회 · {selectedSeries.firstObservedYear}~{selectedSeries.lastObservedYear}
                                        </p>
                                        <div className="mt-2 pt-2 border-t border-emerald-200 flex flex-col gap-0.5">
                                            <p className="text-[11px] font-semibold text-emerald-700 mb-0.5">과거 이력 기반 기본 정보</p>
                                            <SeriesFieldSummaryRow
                                                label="광역자치단체"
                                                status={selectedSeries.fieldStatus.region}
                                                value={selectedSeries.autoFill.regionCode ? REGION_DISPLAY[selectedSeries.autoFill.regionCode] : null}
                                            />
                                            <SeriesFieldSummaryRow label="시군구" status={selectedSeries.fieldStatus.district} value={selectedSeries.autoFill.district} />
                                            <SeriesFieldSummaryRow
                                                label="축제 유형"
                                                status={selectedSeries.fieldStatus.festivalTypes}
                                                value={selectedSeries.autoFill.festivalTypes.length > 0 ? selectedSeries.autoFill.festivalTypes.map((t) => FESTIVAL_TYPE_DISPLAY[t]).join("/") : null}
                                            />
                                            <SeriesFieldSummaryRow
                                                label="장소 유형"
                                                status={selectedSeries.fieldStatus.venueType}
                                                value={selectedSeries.autoFill.venueType ? VENUE_TYPE_DISPLAY[selectedSeries.autoFill.venueType] : null}
                                            />
                                        </div>
                                        <p className="text-[11px] text-emerald-600 mt-2">아래 값들은 자유롭게 수정할 수 있습니다 — 자동 설정된 값은 원래대로 유지될 때만 표시됩니다.</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-1">
                                <label className="text-sm font-medium">축제명 <span className="text-gray-500 font-normal">(선택)</span></label>
                                <input
                                    type="text"
                                    className="border rounded px-3 py-2 text-sm"
                                    placeholder="예: 한강페스티벌 (신규 축제 이름을 자유롭게 입력하세요)"
                                    value={festivalName}
                                    onChange={(e) => handleNewFestivalNameChange(e.target.value)}
                                />
                                <p className="text-[11px] text-gray-500 mt-0.5">새로운 축제이므로 이름을 입력하지 않아도 계산할 수 있습니다.</p>
                            </div>
                        )}

                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">
                                광역자치단체
                                {regionAutoFilled && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">자동 설정</span>}
                            </label>
                            <select
                                className="border rounded px-3 py-2 text-sm"
                                value={regionCode}
                                onChange={(e) => { setRegionCode(e.target.value); setDistrict(""); }}
                                disabled={!metadata}
                            >
                                {/* Series autofill이 region MIXED/MISSING으로 판정하면 빈 값("")을 넣는다
                                    (handleSelectSeries 참고) - 이 placeholder가 그 상태를 표현한다. 빈 값은
                                    실제 지역 코드가 아니므로 submit 전에 사용자가 반드시 다시 선택해야 한다. */}
                                <option value="">직접 선택</option>
                                {metadata?.regions.map((r) => (
                                    <option key={r.code} value={r.code}>{r.displayName}</option>
                                ))}
                            </select>
                            {selectedSeries && selectedSeries.fieldStatus.region !== "STABLE" && !regionCode && (
                                <p className="text-[11px] text-gray-500 mt-0.5">{seriesFieldHint(selectedSeries.fieldStatus.region)}</p>
                            )}
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">
                                시군구 <span className="text-gray-500 font-normal">(선택)</span>
                                {districtAutoFilled && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">자동 설정</span>}
                            </label>
                            <select
                                className="border rounded px-3 py-2 text-sm"
                                value={district}
                                onChange={(e) => setDistrict(e.target.value)}
                                disabled={districts.length === 0}
                            >
                                <option value="">-- 선택 안 함 --</option>
                                {districts.map((d) => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                            {/* district는 estimate 필수값이 아니라 계산을 막지 않는다. 다만 series를
                                선택했는데 비어 있으면(부산국제록페스티벌처럼 과거 이력에 시군구 정보
                                자체가 없는 경우 포함) 이유를 알려준다 - "MISSING" 같은 내부 용어는
                                쓰지 않는다. */}
                            {selectedSeries && selectedSeries.fieldStatus.district !== "STABLE" && district === "" && (
                                <p className="text-[11px] text-gray-500 mt-0.5">{seriesFieldHint(selectedSeries.fieldStatus.district)}(선택 입력 항목입니다)</p>
                            )}
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">
                                축제 유형 <span className="text-gray-500 font-normal">(복수 선택 가능)</span>
                                {festivalTypesAutoFilled && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">자동 설정</span>}
                            </label>
                            <div className="flex flex-wrap gap-3">
                                {metadata?.festivalTypes.map((t) => (
                                    <label key={t.code} className="flex items-center gap-1.5 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={festivalTypes.includes(t.code)}
                                            onChange={() => toggleFestivalType(t.code)}
                                        />
                                        {t.displayName}
                                    </label>
                                ))}
                            </div>
                            {selectedSeries && selectedSeries.fieldStatus.festivalTypes !== "STABLE" && festivalTypes.length === 0 && (
                                <p className="text-[11px] text-gray-500 mt-0.5">{seriesFieldHint(selectedSeries.fieldStatus.festivalTypes)}</p>
                            )}
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">
                                장소 유형
                                {venueAutoFilled && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">자동 설정</span>}
                            </label>
                            <select
                                className="border rounded px-3 py-2 text-sm"
                                value={venueType}
                                onChange={(e) => setVenueType(e.target.value)}
                                disabled={!metadata}
                            >
                                {/* Series autofill이 venueType MIXED/MISSING으로 판정하면 빈 값("")을 넣는다
                                    (예: 대학로 차 없는 거리 축제 - 2025/2026 장소유형이 서로 달라 MIXED) -
                                    이 경우 임의로 첫 metadata 값을 대신 넣지 않고 사용자가 직접 고르게 한다. */}
                                <option value="">직접 선택</option>
                                {metadata?.venueTypes.map((v) => (
                                    <option key={v.code} value={v.code}>{v.displayName}</option>
                                ))}
                            </select>
                            {selectedSeries && selectedSeries.fieldStatus.venueType !== "STABLE" && !venueType && (
                                <p className="text-[11px] text-gray-500 mt-0.5">{seriesFieldHint(selectedSeries.fieldStatus.venueType)}</p>
                            )}
                        </div>

                        {/* PHASE 6 — durationDays는 절대 Series history에서 자동입력하지 않는다는
                            기존 정책을 유지하면서, "올해 계획 정보"로 시각적 구분만 더한다. */}
                        <div className="flex flex-col gap-1 pt-2 border-t border-gray-100">
                            <p className="text-[11px] font-semibold text-gray-400">올해 계획 정보</p>
                            <label className="text-sm font-medium">
                                개최 일수 <span className="text-gray-500 font-normal">(직접 입력 — Series를 선택해도 자동입력되지 않습니다)</span>
                            </label>
                            <input
                                type="number"
                                min={2}
                                max={180}
                                placeholder="예: 3"
                                className="border rounded px-3 py-2 text-sm w-32"
                                value={durationDays}
                                onChange={(e) => setDurationDays(e.target.value === "" ? "" : Number(e.target.value))}
                            />
                            <p className="text-[11px] text-gray-500">올해 계획한 개최기간을 직접 입력해주세요.</p>
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !metadata || !canSubmit}
                            className="mt-2 bg-emerald-600 text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? "계산 중..." : "다년도 계획예산 계산"}
                        </button>
                        {/* 비활성 사유를 기존 noSample 배너와 같은 스타일(옅은 amber 박스)로 더
                            눈에 띄게 표시한다 - "너무 강한 error UI"는 피하되 바로 보이게 한다. */}
                        {!canSubmit && (
                            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                                계산하려면 다음 정보를 입력해주세요: <span className="font-semibold">{missingRequiredFields.join(" · ")}</span>
                                {missingDueToSeries && (
                                    <p className="text-xs text-amber-700 mt-1">과거 이력이 연도별로 달라 자동입력하지 않은 항목이 있습니다.</p>
                                )}
                            </div>
                        )}
                    </form>

                    {error && (
                        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                            {error}
                        </div>
                    )}

                    {/* 5절 — 폼 값과 실제 API로 보내는 값이 눈에 보이도록, 현재 form state를 그대로 반영한 요약 */}
                    <div className="bg-white rounded-xl shadow p-4 text-xs">
                        <p className="font-semibold mb-2 text-gray-700">입력 요약 (API 요청값)</p>
                        <dl className="grid grid-cols-[5.5rem_1fr] gap-y-1.5 gap-x-2">
                            <dt className="text-gray-500">계획연도</dt>
                            <dd className="font-medium">{planningYear}</dd>
                            <dt className="text-gray-500">지역</dt>
                            <dd className="font-medium">{regionName}{district ? ` / ${district}` : ""}</dd>
                            <dt className="text-gray-500">유형</dt>
                            <dd className="font-medium">{typeNames || "(선택 안 됨)"}</dd>
                            <dt className="text-gray-500">장소</dt>
                            <dd className="font-medium">{venueName}</dd>
                            <dt className="text-gray-500">기간</dt>
                            <dd className="font-medium">{durationDays === "" ? "(미입력)" : `${durationDays}일`}</dd>
                            <dt className="text-gray-500">축제명</dt>
                            <dd className="font-medium">
                                {festivalName.trim() ||
                                    (festivalMode === "EXISTING" ? "(기존 축제를 선택해주세요)" : "(없음 — 신규 축제로 취급)")}
                            </dd>
                            <dt className="text-gray-500">Reference policy</dt>
                            <dd className="font-medium">HISTORICAL_ONLY <span className="text-gray-400 font-normal">(고정)</span></dd>
                        </dl>
                    </div>
                </section>

                {/* 우측: 결과 / 계산 근거 */}
                <section className="lg:overflow-y-auto lg:pl-1 flex flex-col gap-4 pb-4">
                    {!result && (
                        <div className="bg-white rounded-xl shadow p-8 text-sm text-gray-500 text-center">
                            좌측에서 조건을 입력하고 계산을 실행하면 결과가 여기 표시됩니다.
                        </div>
                    )}
                    {result && <ResultPane result={result} requestedDurationDays={submittedDurationDays} />}
                </section>
            </div>
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
const RELIABILITY_COLOR: Record<string, string> = {
    HIGH: "text-emerald-700 bg-emerald-50 border-emerald-200",
    MEDIUM: "text-amber-700 bg-amber-50 border-amber-200",
    LOW: "text-gray-700 bg-gray-100 border-gray-200",
};
/** tester용 등급 의미 설명(고정 문구) — production `reliabilityReason`을 대체하지 않는다.
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

    return (
        <div className="flex flex-col gap-4">
            {/* 6절 — 핵심 결과 4개 */}
            <div className="grid grid-cols-2 gap-3">
                <MetricBox label="예상 예산" value={fmt(result.estimatedBudgetKrw)} />
                <MetricBox label="추천 계획 예산" value={fmt(result.recommendedBudgetKrw)} highlight />
                <MetricBox label="추정 방식" value={isSeries ? "SERIES" : "PEER"} sub={ESTIMATE_BASIS_LABEL[result.estimateBasis]} />
                <MetricBox
                    label="신뢰도"
                    value={RELIABILITY_LABEL[result.reliabilityTier] ?? result.reliabilityTier}
                    badgeClassName={RELIABILITY_COLOR[result.reliabilityTier]}
                />
            </div>

            {noSample && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                    ⚠ 비교 가능한 유사 축제 표본을 찾지 못했습니다(sampleCount=0, fallbackLevel=NONE) — 위 예상/추천 예산은 0원입니다.
                </div>
            )}

            {/* 신뢰도 상세 설명 — 등급/이유/의미를 한 카드에서 (reliabilityReason은 항상 API 원문 그대로) */}
            <ReliabilityCard result={result} />

            {/* 7절 — 예산 산정 근거 */}
            <Card title="예산 산정 근거">
                <FieldGrid
                    rows={[
                        ["Estimate basis", <code key="eb">{result.estimateBasis}</code>],
                        ["Recommendation basis", <code key="rb">{result.recommendationBasis}</code>],
                        ["Sample count", `${result.sampleCount}건`],
                        [
                            "Reference year range",
                            result.earliestSourceYear !== null && result.latestSourceYear !== null
                                ? `${result.earliestSourceYear}~${result.latestSourceYear} (${result.distinctYearsUsed}개 연도)`
                                : "—",
                        ],
                    ]}
                />
            </Card>

            {/* 10절 — 추천 공식 검증(표시 전용, production 값을 대체하지 않음) */}
            <RecommendationCheckCard result={result} />

            {/* 8절 — Series 경로 상세(계산 경로가 SERIES일 때 가장 눈에 띄게) */}
            {seriesDisplay.kind === "SERIES_APPLIED" && (
                <SeriesHistoryCard seriesDisplay={seriesDisplay} />
            )}
            {(seriesDisplay.kind === "UNMATCHED" || seriesDisplay.kind === "AMBIGUOUS" || seriesDisplay.kind === "NO_VALID_HISTORY") && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                    ℹ️ {SERIES_FALLBACK_MESSAGE[seriesDisplay.kind]}
                </div>
            )}

            {/* 15절 — 알고리즘 적용값 / 11절 — 데이터 사용 현황 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <AlgorithmValuesCard result={result} />
                <DataUsageCard result={result} />
            </div>

            {/* 9절/13절 — Peer 통계(estimateBasis와 무관하게 항상 계산되어 API에 채워진다 - Series가
                최종 추정이어도 "보조 비교"로 함께 보여준다). */}
            <PeerStatsCard result={result} isPrimary={!isSeries} />

            {/* 12절 — 연도별 반영 비중 */}
            {result.yearWeightBreakdown.length > 0 && <YearWeightCard result={result} />}

            {/* 17절 — Top peer candidates */}
            {result.topCandidates.length > 0 && (
                <CandidatesCard candidates={result.topCandidates} sampleCount={result.sampleCount} requestedDurationDays={requestedDurationDays} />
            )}

            {/* 20절 — Raw JSON(기본 닫힘) */}
            <details className="bg-white rounded-xl shadow p-4 text-xs">
                <summary className="cursor-pointer text-gray-600 font-medium">개발자 정보 ▸ Raw API Response</summary>
                <pre className="mt-2 bg-gray-50 p-3 rounded overflow-x-auto text-gray-700 max-h-96 overflow-y-auto">
                    {JSON.stringify(result, null, 2)}
                </pre>
            </details>
        </div>
    );
}

/**
 * PHASE 6 — "과거 이력 기반 기본 정보" 요약 블록의 한 줄. STABLE이면 실제 값 + "자동 설정"
 * 태그, MIXED/MISSING이면 각각 "직접 선택"/"정보 없음"만 보여준다(내부 STABLE/MIXED/MISSING
 * 문자열 자체는 노출하지 않음).
 */
function SeriesFieldSummaryRow({ label, status, value }: { label: string; status: "STABLE" | "MIXED" | "MISSING"; value: string | null }) {
    const displayValue = status === "STABLE" ? value ?? "—" : status === "MIXED" ? "직접 선택" : "정보 없음";
    return (
        <div className="flex items-center justify-between text-xs py-0.5">
            <span className="text-emerald-700">{label}</span>
            <span className="flex items-center gap-1.5">
                <span className="font-medium text-emerald-900">{displayValue}</span>
                {status === "STABLE" && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-200 text-emerald-800 rounded">자동 설정</span>}
            </span>
        </div>
    );
}

function MetricBox({ label, value, sub, highlight, badgeClassName }: { label: string; value: string; sub?: string; highlight?: boolean; badgeClassName?: string }) {
    return (
        <div className={`rounded-xl p-4 flex flex-col gap-1 border ${badgeClassName ?? (highlight ? "bg-blue-50 border-blue-200" : "bg-white border-gray-200")}`}>
            <span className="text-xs text-gray-500">{label}</span>
            <span className={`text-lg font-bold ${highlight ? "text-blue-700" : ""}`}>{value}</span>
            {sub && <span className="text-[11px] text-gray-500">{sub}</span>}
        </div>
    );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="bg-white rounded-xl shadow p-4">
            <p className="font-semibold text-sm mb-3">{title}</p>
            {children}
        </div>
    );
}

function FieldGrid({ rows }: { rows: [string, React.ReactNode][] }) {
    return (
        <dl className="grid grid-cols-[9rem_1fr] gap-y-2 gap-x-3 text-sm">
            {rows.map(([label, value], i) => (
                <div key={i} className="contents">
                    <dt className="text-gray-500">{label}</dt>
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
                <span
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold border ${
                        pass ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
                    }`}
                >
                    {pass ? "✓ PASS" : "⚠ API recommendation mismatch"}
                </span>
                <span className="text-xs text-gray-500">
                    {isSeries ? "Series: recommendedBudget = estimatedBudget × 1.05" : "Peer: recommendedBudget = max(estimatedBudget, P60)"}
                </span>
            </div>
            <div className="font-mono text-xs bg-gray-50 rounded p-3 flex flex-col gap-0.5">
                <div>{formulaText}</div>
                <div>= {fmt(expected)} <span className="text-gray-400">(공식 검산값)</span></div>
                <div className="pt-1 border-t mt-1">API recommendedBudgetKrw = {fmt(result.recommendedBudgetKrw)}</div>
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
 * - RELIABILITY_MEANING은 tester 전용 보조 설명(고정, 짧은 한 줄)이며 reliabilityReason과
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
                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-bold border ${RELIABILITY_COLOR[tier]}`}>
                    {tier} · {RELIABILITY_LABEL[tier] ?? tier}
                </span>
            </div>

            <p className="text-sm text-gray-800">{RELIABILITY_MEANING[tier] ?? ""}</p>
            <p className="text-xs text-gray-500 mt-1.5">
                API 근거 문구(reliabilityReason): <span className="text-gray-700">&ldquo;{result.reliabilityReason}&rdquo;</span>
            </p>

            {isLow && (
                <div className="border-t mt-3 pt-3 flex flex-col gap-3">
                    <div>
                        <p className="text-xs font-semibold text-gray-600 mb-1">왜 낮은가?</p>
                        <p className="text-xs text-gray-600">
                            → {seriesHistorySummary(result)} → Peer fallback 사용 → <code>{FALLBACK_LEVEL_LABEL[result.fallbackLevel as FallbackLevel] ?? result.fallbackLevel}</code> 단계에서 후보 선정
                        </p>
                    </div>
                    <div>
                        <p className="text-xs font-semibold text-gray-600 mb-1">확인하면 좋은 값</p>
                        <div className="grid grid-cols-2 gap-2">
                            <MiniStat label="비교 표본" value={`${result.sampleCount}개`} />
                            <MiniStat label="평균 유사도" value={`${(result.averageSimilarity * 100).toFixed(1)}%`} />
                            <MiniStat label="유사 축제 참고 범위" value={`${fmt(result.p25Krw)} ~ ${fmt(result.p75Krw)}`} span2 />
                        </div>
                    </div>
                </div>
            )}

            {/* tester 전용 — 분석적 표시(일반 사용자 화면에는 두지 않을 정보) */}
            <div className="border-t mt-3 pt-3">
                <p className="text-[11px] font-semibold text-gray-400 mb-1.5">분석적 표시 (tester 전용)</p>
                <FieldGrid
                    rows={[
                        ["Reliability tier", <span key="t" className="font-semibold">{tier}</span>],
                        ["Reliability reason", <span key="r" className="text-gray-700 text-xs">{result.reliabilityReason}</span>],
                        ["Estimate basis", <code key="e">{result.estimateBasis}</code>],
                        ["Series history", seriesHistorySummary(result)],
                        ["Fallback level", <code key="f">{FALLBACK_LEVEL_LABEL[result.fallbackLevel as FallbackLevel] ?? result.fallbackLevel}</code>],
                    ]}
                />
            </div>

            <p className="text-[11px] text-gray-400 mt-3 italic">
                ⓘ 신뢰도는 &lsquo;이 예산이 맞을 확률&rsquo;이 아니라, 이 추정에 사용한 데이터 근거의 강도를 나타냅니다. 숫자 % confidence로 환산되는 값이 아닙니다.
            </p>
        </Card>
    );
}

function MiniStat({ label, value, span2 }: { label: string; value: string; span2?: boolean }) {
    return (
        <div className={`bg-gray-50 rounded-lg px-2.5 py-2 flex flex-col gap-0.5 ${span2 ? "col-span-2" : ""}`}>
            <span className="text-[11px] text-gray-500">{label}</span>
            <span className="text-xs font-semibold text-gray-800">{value}</span>
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
                    ["계산 경로", <span key="p" className="font-bold text-emerald-700">SERIES</span>],
                    ["동일 축제", seriesDisplay.canonicalName],
                    ["과거 이력", `${seriesDisplay.historyCount}회`],
                    ["사용 연도", seriesDisplay.historicalYears.length > 0 ? seriesDisplay.historicalYears.join(" / ") : "—"],
                    ["예상 예산 산정", "CPI 보정된 동일 축제 과거 예산의 median"],
                    ["추천 계획 예산", "예상 예산 × 1.05 (고정 buffer)"],
                ]}
            />
            <p className="text-xs text-gray-500 mt-3">
                동일 축제 이력 기반이어도 아래 &ldquo;Peer 통계&rdquo; 카드는 참고용으로 계속 함께 계산됩니다 — 최종 추정에는 쓰이지 않는 보조 비교입니다.
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
            <p className="text-[11px] text-gray-400 mt-3">
                Fallback level/Average similarity는 Series/Peer 여부와 무관하게 항상 계산됩니다(Peer 후보 탐색이 estimate basis와 별개로 항상 실행되기 때문) — Series 경로에서도 &ldquo;—&rdquo;로 비지 않습니다.
            </p>
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

function PeerStatsCard({ result, isPrimary }: { result: MultiYearBudgetEstimateResponse; isPrimary: boolean }) {
    if (result.sampleCount === 0) return null;
    return (
        <Card title={isPrimary ? "Peer 통계 (최종 추정 근거)" : "Peer 통계 (보조 비교 — 유사 축제 참고 범위)"}>
            <div className="flex items-center gap-3 text-xs text-gray-500 mb-3 flex-wrap">
                <span>Fallback level: <code>{FALLBACK_LEVEL_LABEL[result.fallbackLevel as FallbackLevel] ?? result.fallbackLevel}</code></span>
                <span>최종 비교 축제: {result.sampleCount}개</span>
                <span>평균 유사도: {(result.averageSimilarity * 100).toFixed(1)}%</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                {isPrimary ? (
                    <div className="flex justify-between col-span-2">
                        <span className="text-gray-500">가중 기하평균</span>
                        <span className="font-semibold">{fmtEok(result.estimatedBudgetKrw)} <span className="text-xs text-gray-400">← 예상 예산</span></span>
                    </div>
                ) : (
                    <div className="flex justify-between col-span-2 text-gray-400">
                        <span>가중 기하평균</span>
                        <span>— (Series 경로에서는 API가 Peer 기하평균을 별도로 내려주지 않음)</span>
                    </div>
                )}
                <div className="flex justify-between">
                    <span className="text-gray-500">가중 평균</span>
                    <span>{fmtEok(result.weightedAverageBudgetKrw)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500">P50</span>
                    <span>{fmtEok(result.p50Krw)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500">P25</span>
                    <span>{fmtEok(result.p25Krw)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500">P60</span>
                    <span>{fmtEok(result.p60Krw)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500">P75</span>
                    <span>{fmtEok(result.p75Krw)}</span>
                </div>
            </div>
            <p className="text-xs text-gray-500 mt-3">
                유사 축제 참고 범위: {fmt(result.p25Krw)} ~ {fmt(result.p75Krw)}
            </p>
        </Card>
    );
}

function YearWeightCard({ result }: { result: MultiYearBudgetEstimateResponse }) {
    const maxWeightShare = Math.max(0, ...result.yearWeightBreakdown.map((y) => y.weightShare));
    return (
        <Card title="연도별 반영 비중">
            <div className="flex flex-col gap-1.5">
                {result.yearWeightBreakdown.map((y) => (
                    <div key={y.year} className="flex items-center gap-2 text-xs">
                        <span className="w-10 text-gray-500">{y.year}</span>
                        <div className="flex-1 bg-gray-100 rounded h-3 overflow-hidden">
                            <div
                                className="bg-emerald-500 h-full rounded"
                                style={{ width: `${maxWeightShare > 0 ? (y.weightShare / maxWeightShare) * 100 : 0}%` }}
                            />
                        </div>
                        <span className="w-24 text-right text-gray-500">{(y.weightShare * 100).toFixed(1)}% ({y.candidateCount}건)</span>
                    </div>
                ))}
            </div>
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
    const adjustedHeader = requestedDurationDays !== null ? `${requestedDurationDays}일 기준 조정 예산` : "조정 예산";
    return (
        <Card title={`계산에 사용된 유사 축제 표본 중 상위 ${candidates.length}건`}>
            <p className="text-xs text-gray-600 mb-2">
                현재 입력 조건과 유사한 과거 축제를 유사도 순으로 보여줍니다. 최종 계산(예상 예산·추천 예산·P25~P75 등)에는 아래
                표에 보이는 {candidates.length}건만이 아니라, 선택된 전체 Peer 후보군 {sampleCount}건이 사용됩니다.
            </p>
            <p className="text-[11px] text-gray-400 mb-3">
                정렬 기준: 축제 유형·지역·장소 유형·개최기간의 유사도를 종합한 similarity가 높은 순(통계 가중치 = similarity²
                이므로 사실상 같은 순서입니다).
            </p>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-white">
                        <tr className="bg-gray-50">
                            <th className="text-left px-2 py-1.5 border-b">축제명</th>
                            <th className="text-left px-2 py-1.5 border-b">연도</th>
                            <th className="text-left px-2 py-1.5 border-b">지역</th>
                            <th className="text-left px-2 py-1.5 border-b">유형</th>
                            <th className="text-right px-2 py-1.5 border-b">개최기간</th>
                            <th className="text-right px-2 py-1.5 border-b">과거 계획 예산</th>
                            <th className="text-right px-2 py-1.5 border-b">{adjustedHeader}</th>
                            <th className="text-right px-2 py-1.5 border-b">유사도</th>
                            <th className="text-right px-2 py-1.5 border-b">weight</th>
                            <th className="text-left px-2 py-1.5 border-b">fallback 단계</th>
                        </tr>
                    </thead>
                    <tbody>
                        {candidates.map((c, i) => (
                            <tr key={i} className="border-b last:border-0">
                                <td className="px-2 py-1.5">{c.festivalName}</td>
                                <td className="px-2 py-1.5 text-gray-500">{c.sourceYear}</td>
                                <td className="px-2 py-1.5 text-gray-500">{c.region ?? "—"}{c.district ? `/${c.district}` : ""}</td>
                                <td className="px-2 py-1.5 text-gray-500">{c.festivalType}</td>
                                <td className="px-2 py-1.5 text-right text-gray-500">
                                    {c.durationDays !== null ? `${c.durationDays}일` : "정보 없음"}
                                </td>
                                <td className="px-2 py-1.5 text-right">{fmt(c.originalBudgetKrw)}</td>
                                <td className="px-2 py-1.5 text-right">{fmt(c.durationAdjustedBudgetKrw)}</td>
                                <td className="px-2 py-1.5 text-right text-gray-500">{(c.similarity * 100).toFixed(1)}%</td>
                                <td className="px-2 py-1.5 text-right text-gray-500">{c.finalWeight.toFixed(3)}</td>
                                <td className="px-2 py-1.5 text-gray-500">{c.fallbackStage ?? "—"}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="mt-2 flex flex-col gap-1">
                <p className="text-[11px] text-gray-400">
                    과거 축제 기간이 현재 계획({requestedDurationDays !== null ? `${requestedDurationDays}일` : "입력한 개최일수"})보다
                    짧으면 조정 예산이 커지고, 길면 작아질 수 있습니다(기간이 같으면 조정 예산 = 과거 계획 예산). 다만 기간 차이가
                    아주 클 때는 보정 비율 자체가 0.5~2.0배 범위로 제한됩니다.
                </p>
                <p className="text-[11px] text-gray-400">
                    개최기간 정보가 없는(&ldquo;정보 없음&rdquo;) 과거 축제는 기간 보정을 적용하지 않습니다 — 조정 예산이 과거 계획
                    예산과 동일하게 표시됩니다.
                </p>
                <p className="text-[11px] text-gray-400">
                    유형/지역/장소/기간 각각의 세부 유사도 점수(sub-score)는 현재 API가 반환하지 않습니다 — 종합 유사도(similarity)와
                    최종 반영 weight(finalWeight)만 표시됩니다.
                </p>
                <p className="text-[11px] text-gray-400">
                    이 표의 과거 계획 예산/조정 예산은 원본 값입니다. 실제 통계 계산(예상 예산·P25~P75 등)에는 이상치를 완화하기
                    위한 winsorize(같은 유형 축제 전체 기준 상하위 5% 클리핑) 처리가 조정 예산에 추가로 한 번 더 적용된 값이
                    쓰이며, 그 값은 이 표에 별도로 표시되지 않습니다.
                </p>
            </div>
            <details className="mt-2 text-[11px] text-gray-400">
                <summary className="cursor-pointer">정렬 세부 규칙(개발자용)</summary>
                <p className="mt-1">
                    유사도(정확히는 그 제곱값인 통계 가중치)가 완전히 같은 후보끼리는 재현성을 위한 결정적 규칙(원본 데이터의
                    소스 파일·시트·행 위치 기준)으로 순서만 고정합니다 — &ldquo;더 좋은 후보&rdquo;라는 의미는 아닙니다.
                </p>
            </details>
        </Card>
    );
}
