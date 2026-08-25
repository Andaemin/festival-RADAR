"use client";

import { useEffect, useState } from "react";
import type { MetadataResponse } from "@/lib/domain/types";
import { FALLBACK_LEVEL_LABEL, FallbackLevel } from "@/lib/domain/enums";
import {
    estimateMultiYearBudget,
    MultiYearBudgetEstimateResponse,
    MultiYearPredictionCandidateDto,
} from "@/lib/api/multiyear-budget-estimates";
import { resolveSeriesDisplayState, SERIES_FALLBACK_MESSAGE } from "@/lib/multiyear-series/planning-ui-display";

/** Duration sensitivity 한 행의 상태 — 성공/실패를 개별 보존한다(13절, 한 duration 실패가 전체를
 *  지우지 않음). */
type SensitivityRow =
    | { durationDays: number; isCurrent: boolean; status: "loading" }
    | { durationDays: number; isCurrent: boolean; status: "success"; data: MultiYearBudgetEstimateResponse }
    | { durationDays: number; isCurrent: boolean; status: "error"; error: string };

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

    // 다년도 계획예산 폼 상태
    const [festivalName, setFestivalName] = useState("");
    const [regionCode, setRegionCode] = useState("");
    const [district, setDistrict] = useState("");
    const [festivalTypes, setFestivalTypes] = useState<string[]>([]);
    const [venueType, setVenueType] = useState("");
    const [durationDays, setDurationDays] = useState(3);
    const [planningYear, setPlanningYear] = useState(2027);

    const [result, setResult] = useState<MultiYearBudgetEstimateResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    /** 현재 표시 중인 result를 만들어낸 실제 요청 파라미터의 스냅샷. Duration sensitivity는 이
     *  스냅샷을 기준으로 durationDays만 바꿔 재요청한다 - 폼을 계산 후에 건드려도(재제출 전)
     *  sensitivity가 화면에 보이는 result와 다른 조건으로 나가지 않게 하기 위함이다("동일 축제
     *  조건에서"라는 요구사항을 라이브 폼 상태가 아니라 결과 자체에 묶어 보장한다). */
    const [submittedParams, setSubmittedParams] = useState<{
        regionCode: string;
        district: string;
        festivalTypes: string[];
        venueType: string;
        planningYear: number;
        festivalName: string;
    } | null>(null);

    // Duration sensitivity — 기존 result/loading/error와 완전히 분리된 별도 state(13절).
    const [sensitivityRows, setSensitivityRows] = useState<SensitivityRow[] | null>(null);
    const [sensitivityLoading, setSensitivityLoading] = useState(false);

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

    const districts = metadata?.districtsByRegion[regionCode] ?? [];

    function toggleFestivalType(code: string) {
        setFestivalTypes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setResult(null);
        // 새 계산을 시작하면 이전 결과에 딸려 있던 duration sensitivity도 함께 초기화한다 - 다른
        // 조건의 결과에 이전 sensitivity가 남아있으면 안 된다.
        setSensitivityRows(null);
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
            setSubmittedParams({ regionCode, district, festivalTypes, venueType, planningYear: Number(planningYear), festivalName });
        } catch (e) {
            setError(e instanceof Error ? e.message : "다년도 계획예산 추정에 실패했습니다.");
        } finally {
            setLoading(false);
        }
    }

    /**
     * Duration sensitivity(1~13절) — 별도 계산 로직을 만들지 않는다(4절). 현재 result를 만든
     * `submittedParams`를 그대로 고정하고 durationDays만 바꿔 동일한 production 함수
     * (`estimateMultiYearBudget` → `/api/v1/multiyear-budget-estimates`)를 그대로 재호출한다.
     * 자동 실행하지 않는다(2절) - 이 함수는 버튼 클릭으로만 호출된다.
     */
    async function runDurationSensitivity() {
        if (!submittedParams) return;
        const currentDuration = Number(durationDays);
        // 3절 — preset(3/7/15/30) ∪ 현재 입력 duration, 중복 제거 후 오름차순. 기존 duration input
        // 정책(2~180)을 그대로 재사용해 범위 밖 값은 추가하지 않는다.
        const allDurations = Array.from(new Set([3, 7, 15, 30, currentDuration]))
            .filter((d) => d >= 2 && d <= 180)
            .sort((a, b) => a - b);

        setSensitivityLoading(true);
        setSensitivityRows(allDurations.map((d) => ({ durationDays: d, isCurrent: d === currentDuration, status: "loading" })));

        // Promise.allSettled — 한 duration 호출이 실패해도 나머지 결과를 보존한다(13절).
        const settled = await Promise.allSettled(
            allDurations.map((d) =>
                estimateMultiYearBudget({
                    regionCode: submittedParams.regionCode,
                    district: submittedParams.district || undefined,
                    festivalTypes: submittedParams.festivalTypes,
                    venueType: submittedParams.venueType,
                    durationDays: d,
                    planningYear: submittedParams.planningYear,
                    referenceDataPolicy: "HISTORICAL_ONLY",
                    festivalName: submittedParams.festivalName.trim() || undefined,
                })
            )
        );
        setSensitivityRows(
            allDurations.map((d, i) => {
                const s = settled[i];
                const isCurrent = d === currentDuration;
                return s.status === "fulfilled"
                    ? { durationDays: d, isCurrent, status: "success", data: s.value }
                    : { durationDays: d, isCurrent, status: "error", error: s.reason instanceof Error ? s.reason.message : "요청 실패" };
            })
        );
        setSensitivityLoading(false);
    }

    const regionName = metadata?.regions.find((r) => r.code === regionCode)?.displayName ?? regionCode;
    const typeNames = festivalTypes
        .map((c) => metadata?.festivalTypes.find((t) => t.code === c)?.displayName ?? c)
        .join(", ");
    const venueName = metadata?.venueTypes.find((v) => v.code === venueType)?.displayName ?? venueType;

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
                                onChange={(e) => setPlanningYear(Number(e.target.value))}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">축제명 <span className="text-gray-500 font-normal">(선택)</span></label>
                            <input
                                type="text"
                                className="border rounded px-3 py-2 text-sm"
                                placeholder="예: 한강페스티벌 (신규 축제거나 모르면 비워두세요)"
                                value={festivalName}
                                onChange={(e) => setFestivalName(e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">광역자치단체</label>
                            <select
                                className="border rounded px-3 py-2 text-sm"
                                value={regionCode}
                                onChange={(e) => { setRegionCode(e.target.value); setDistrict(""); }}
                                disabled={!metadata}
                            >
                                {metadata?.regions.map((r) => (
                                    <option key={r.code} value={r.code}>{r.displayName}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">시군구 <span className="text-gray-500 font-normal">(선택)</span></label>
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
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">축제 유형 <span className="text-gray-500 font-normal">(복수 선택 가능)</span></label>
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
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">장소 유형</label>
                            <select
                                className="border rounded px-3 py-2 text-sm"
                                value={venueType}
                                onChange={(e) => setVenueType(e.target.value)}
                                disabled={!metadata}
                            >
                                {metadata?.venueTypes.map((v) => (
                                    <option key={v.code} value={v.code}>{v.displayName}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">개최 일수 <span className="text-gray-500">(최소 2일)</span></label>
                            <input
                                type="number"
                                min={2}
                                max={180}
                                className="border rounded px-3 py-2 text-sm w-32"
                                value={durationDays}
                                onChange={(e) => setDurationDays(Number(e.target.value))}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !metadata || festivalTypes.length === 0}
                            className="mt-2 bg-emerald-600 text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? "계산 중..." : "다년도 계획예산 계산"}
                        </button>
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
                            <dd className="font-medium">{durationDays}일</dd>
                            <dt className="text-gray-500">축제명</dt>
                            <dd className="font-medium">{festivalName.trim() || "(없음 — 신규 축제로 취급)"}</dd>
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
                    {result && (
                        <ResultPane
                            result={result}
                            sensitivityRows={sensitivityRows}
                            sensitivityLoading={sensitivityLoading}
                            onRunSensitivity={runDurationSensitivity}
                        />
                    )}
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

function ResultPane({
    result,
    sensitivityRows,
    sensitivityLoading,
    onRunSensitivity,
}: {
    result: MultiYearBudgetEstimateResponse;
    sensitivityRows: SensitivityRow[] | null;
    sensitivityLoading: boolean;
    onRunSensitivity: () => void;
}) {
    const isSeries = result.estimateBasis === "SERIES_HISTORY_MEDIAN";
    const seriesDisplay = resolveSeriesDisplayState(result.estimateBasis, result.seriesSignal);
    const noSample = result.sampleCount === 0;

    return (
        <div className="flex flex-col gap-4">
            {/* 1. 현재 입력 결과 — 핵심 결과 4개 */}
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

            {/* 2. 추천 공식 검산(표시 전용, production 값을 대체하지 않음) */}
            <RecommendationCheckCard result={result} />

            {/* 3. 신뢰도 / 근거 */}
            <ReliabilityCard result={result} />

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

            {seriesDisplay.kind === "SERIES_APPLIED" && (
                <SeriesHistoryCard seriesDisplay={seriesDisplay} />
            )}
            {(seriesDisplay.kind === "UNMATCHED" || seriesDisplay.kind === "AMBIGUOUS" || seriesDisplay.kind === "NO_VALID_HISTORY") && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                    ℹ️ {SERIES_FALLBACK_MESSAGE[seriesDisplay.kind]}
                </div>
            )}

            {/* 4. Duration sensitivity */}
            <DurationSensitivityCard
                result={result}
                rows={sensitivityRows}
                loading={sensitivityLoading}
                onRun={onRunSensitivity}
            />

            {/* 5. 상세 알고리즘 diagnostic — 알고리즘 적용값 / 데이터 사용 현황 */}
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
            {result.topCandidates.length > 0 && <CandidatesCard candidates={result.topCandidates} />}

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
 * Duration sensitivity — 동일 조건에서 durationDays만 바꿨을 때 Peer 후보 구성/P60/예상·추천
 * 예산이 얼마나 달라지는지 확인한다(실측 진단: 서울/문화예술/마을형, planningYear=2027에서
 * 3→7→15→30일 recommendedBudget이 3.38억→2.85억→2.00억→2.85억로 비단조 변화하는 사례를 확인함).
 *
 * - 별도 계산 로직 없음 - `estimateMultiYearBudget()`(production API)을 durationDays만 바꿔
 *   그대로 재호출한다(page.tsx의 `runDurationSensitivity` 참고).
 * - candidate 교체 건수를 이 UI가 임의로 계산하지 않는다 - production API는 topCandidates(최대
 *   10건)만 반환하고 finalSample 전체(최대 50건)는 내려주지 않으므로, "overlap"은 반드시
 *   "상위 표시 후보(top 10) 기준"이라고 명시한다. full churn 수치가 필요하면 별도 debug API
 *   설계가 필요하다(이번 UI 작업 범위 밖).
 * - 실측 결과, churn 건수 자체보다 "P60 백분위 근처의 후보가 바뀌는지"가 recommendation 변화폭에
 *   더 큰 영향을 준다는 것이 확인됐다(예: 84%가 교체된 3→7 전환은 P60이 15.6%만 움직인 반면,
 *   10%만 교체된 7→15/15→30 전환은 P60이 30~43% 움직임) - 이 통찰은 문구로만 반영하고, UI가
 *   기여도(%) 를 추측해 수치화하지는 않는다.
 */
function DurationSensitivityCard({
    result,
    rows,
    loading,
    onRun,
}: {
    result: MultiYearBudgetEstimateResponse;
    rows: SensitivityRow[] | null;
    loading: boolean;
    onRun: () => void;
}) {
    const isSeriesBase = result.estimateBasis === "SERIES_HISTORY_MEDIAN";
    const successRows = (rows ?? []).filter((r): r is Extract<SensitivityRow, { status: "success" }> => r.status === "success");

    // 8절 — 비단조 변화 감지: recommendedBudgetKrw가 duration 오름차순에서 한 번이라도 감소하면.
    // Series 기반 결과는 recommendedBudgetKrw가 duration과 무관하게 항상 동일하므로(§1 참고)
    // 구조적으로 이 판정에서 감소가 나오지 않는다 - 오류가 아니라 정상 동작이다.
    let nonMonotonic = false;
    for (let i = 1; i < successRows.length; i++) {
        if (successRows[i].data.recommendedBudgetKrw < successRows[i - 1].data.recommendedBudgetKrw) {
            nonMonotonic = true;
            break;
        }
    }

    const maxRecommended = Math.max(1, ...successRows.map((r) => r.data.recommendedBudgetKrw));

    function driverLabel(r: MultiYearBudgetEstimateResponse): string {
        if (r.estimateBasis !== "PEER_SIMILARITY") return "— (Series 고정)";
        return r.p60Krw >= r.estimatedBudgetKrw ? "P60" : "예상 예산";
    }

    /** 11절 — topCandidates(최대 10건)만으로 계산하는 overlap. festivalName+sourceYear를 근사
     *  식별자로 쓴다(API가 안정적인 고유키를 내려주지 않으므로) - "상위 표시 후보 기준"이라고
     *  항상 명시하고, production finalSample 50건 전체 기준 수치(8/50 같은)는 절대 주장하지 않는다. */
    function topCandidateOverlap(prev: MultiYearBudgetEstimateResponse, cur: MultiYearBudgetEstimateResponse): { overlap: number; total: number } {
        const prevKeys = new Set(prev.topCandidates.map((c) => `${c.festivalName}|${c.sourceYear}`));
        const curKeys = cur.topCandidates.map((c) => `${c.festivalName}|${c.sourceYear}`);
        const overlap = curKeys.filter((k) => prevKeys.has(k)).length;
        return { overlap, total: cur.topCandidates.length };
    }

    return (
        <Card title="Duration sensitivity">
            <p className="text-xs text-gray-500 mb-3">
                {isSeriesBase
                    ? "현재 Series 추정 경로에서는 개최기간(durationDays)이 최종 Series 예상·추천 예산 산식에 직접 사용되지 않습니다(estimate=CPI 보정 median, recommendation=estimate×1.05 — 둘 다 durationDays를 입력으로 쓰지 않음). 아래 기간 민감도는 Peer 기준의 보조 비교입니다."
                    : "동일 축제 조건(festivalName/지역/유형/장소/계획연도 고정)에서 durationDays만 바꿔 production API를 다시 호출합니다 — 이 결과는 최종 추천값에 직접 영향을 줍니다."}
            </p>

            {!rows && (
                <button
                    type="button"
                    onClick={onRun}
                    disabled={loading}
                    className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? "확인 중..." : "기간 민감도 확인 (3/7/15/30일 + 현재 입력)"}
                </button>
            )}

            {rows && (
                <div className="flex flex-col gap-3">
                    {nonMonotonic && (
                        <div className="flex flex-col gap-1">
                            <span className="inline-flex items-center gap-1 self-start px-2 py-1 rounded-full text-xs font-semibold border bg-amber-50 text-amber-800 border-amber-200">
                                ⚠ 기간 증가에 따른 비단조 변화 감지
                            </span>
                            <p className="text-xs text-gray-700 mt-1">
                                기간 민감도 주의 — 유사 축제 기반 추정에서는 개최기간이 달라지면 비교 대상 축제의 순위와 최종 표본 구성이 바뀔 수 있습니다. 따라서 기간이 증가해도 예상·추천 예산이 항상 증가하지는 않습니다.
                            </p>
                            <p className="text-[11px] text-gray-400">
                                이는 개최기간 자체의 단순 배율뿐 아니라, duration similarity에 따른 Peer 후보 구성 변화의 영향을 받기 때문입니다. 알고리즘 오류가 아니라 현재 Peer 모델의 known sensitivity입니다.
                            </p>
                        </div>
                    )}

                    {/* 15절 — LOW+Peer일 때만 연결 설명을 추가한다. Series는 computePlanningReliability의
                        seriesApplied 분기 구조상 LOW가 나올 수 없으므로(reliability.ts) 이 조합은 발생하지
                        않는다 - reliabilityTier 자체는 이 카드가 절대 바꾸지 않는다. */}
                    {!isSeriesBase && result.reliabilityTier === "LOW" && (
                        <p className="text-xs text-gray-500">
                            동일 축제 자체 이력 대신 유사 축제 데이터를 사용하는 결과이므로, 기간 변경에 따른 비교 표본 변화도 함께 확인하세요.
                        </p>
                    )}

                    <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="text-left px-2 py-1.5 border-b">기간</th>
                                    <th className="text-left px-2 py-1.5 border-b">basis</th>
                                    <th className="text-left px-2 py-1.5 border-b">신뢰도</th>
                                    <th className="text-right px-2 py-1.5 border-b">예상 예산</th>
                                    <th className="text-right px-2 py-1.5 border-b">추천 계획 예산</th>
                                    <th className="text-right px-2 py-1.5 border-b">P60</th>
                                    <th className="text-left px-2 py-1.5 border-b">결정값</th>
                                    <th className="text-right px-2 py-1.5 border-b">표본수</th>
                                    <th className="text-right px-2 py-1.5 border-b">평균유사도</th>
                                    <th className="text-left px-2 py-1.5 border-b">fallback</th>
                                    <th className="text-right px-2 py-1.5 border-b">Δ추천</th>
                                    <th className="text-left px-2 py-1.5 border-b">Top10 overlap</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, i) => {
                                    const prevRow = i > 0 ? rows[i - 1] : null;
                                    const prevSuccess = prevRow?.status === "success" ? prevRow : null;
                                    const curSuccess = row.status === "success" ? row : null;
                                    const delta = prevSuccess && curSuccess ? ((curSuccess.data.recommendedBudgetKrw - prevSuccess.data.recommendedBudgetKrw) / prevSuccess.data.recommendedBudgetKrw) * 100 : null;
                                    const overlap = prevSuccess && curSuccess ? topCandidateOverlap(prevSuccess.data, curSuccess.data) : null;
                                    return (
                                        <tr key={row.durationDays} className={`border-b last:border-0 ${row.isCurrent ? "bg-indigo-50 font-medium" : ""}`}>
                                            <td className="px-2 py-1.5">{row.durationDays}일{row.isCurrent && <span className="text-[10px] text-indigo-600 ml-1">(현재 입력)</span>}</td>
                                            {row.status === "loading" && <td className="px-2 py-1.5 text-gray-400" colSpan={10}>조회 중...</td>}
                                            {row.status === "error" && <td className="px-2 py-1.5 text-red-600" colSpan={10}>실패: {row.error}</td>}
                                            {row.status === "success" && (
                                                <>
                                                    <td className="px-2 py-1.5 text-gray-500">{row.data.estimateBasis === "SERIES_HISTORY_MEDIAN" ? "SERIES" : "PEER"}</td>
                                                    <td className="px-2 py-1.5 text-gray-500">{row.data.reliabilityTier}</td>
                                                    <td className="px-2 py-1.5 text-right">{fmt(row.data.estimatedBudgetKrw)}</td>
                                                    <td className="px-2 py-1.5 text-right font-semibold">{fmt(row.data.recommendedBudgetKrw)}</td>
                                                    <td className="px-2 py-1.5 text-right text-gray-500">{fmt(row.data.p60Krw)}</td>
                                                    <td className="px-2 py-1.5 text-gray-500">{driverLabel(row.data)}</td>
                                                    <td className="px-2 py-1.5 text-right text-gray-500">{row.data.sampleCount}</td>
                                                    <td className="px-2 py-1.5 text-right text-gray-500">{(row.data.averageSimilarity * 100).toFixed(1)}%</td>
                                                    <td className="px-2 py-1.5 text-gray-500">{FALLBACK_LEVEL_LABEL[row.data.fallbackLevel as FallbackLevel] ?? row.data.fallbackLevel}</td>
                                                    <td className={`px-2 py-1.5 text-right ${delta !== null && delta < 0 ? "text-red-600" : delta !== null && delta > 0 ? "text-emerald-600" : "text-gray-400"}`}>
                                                        {delta !== null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%` : "—"}
                                                    </td>
                                                    <td className="px-2 py-1.5 text-gray-500">{overlap ? `${overlap.overlap}/${overlap.total}(top10 기준)` : "—"}</td>
                                                </>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* 12절 — 추천 계획 예산 horizontal bar(새 chart library 없이 Tailwind div width만) */}
                    <div className="flex flex-col gap-1">
                        {successRows.map((row) => (
                            <div key={row.durationDays} className="flex items-center gap-2 text-xs">
                                <span className="w-10 text-gray-500">{row.durationDays}일</span>
                                <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden">
                                    <div
                                        className={`h-full rounded ${row.isCurrent ? "bg-indigo-500" : "bg-indigo-300"}`}
                                        style={{ width: `${(row.data.recommendedBudgetKrw / maxRecommended) * 100}%` }}
                                    />
                                </div>
                                <span className="w-16 text-right text-gray-600">{fmtEok(row.data.recommendedBudgetKrw)}</span>
                            </div>
                        ))}
                    </div>

                    <button type="button" onClick={onRun} disabled={loading} className="self-start text-xs text-gray-500 underline disabled:opacity-50">
                        {loading ? "확인 중..." : "다시 확인"}
                    </button>
                </div>
            )}
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

function CandidatesCard({ candidates }: { candidates: MultiYearPredictionCandidateDto[] }) {
    return (
        <Card title={`Top peer candidates (상위 ${candidates.length}건)`}>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-white">
                        <tr className="bg-gray-50">
                            <th className="text-left px-2 py-1.5 border-b">축제명</th>
                            <th className="text-left px-2 py-1.5 border-b">연도</th>
                            <th className="text-left px-2 py-1.5 border-b">지역</th>
                            <th className="text-left px-2 py-1.5 border-b">유형</th>
                            <th className="text-right px-2 py-1.5 border-b">기간</th>
                            <th className="text-right px-2 py-1.5 border-b">원 예산</th>
                            <th className="text-right px-2 py-1.5 border-b">조정 예산</th>
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
                                <td className="px-2 py-1.5 text-right text-gray-500">{c.durationDays ?? "—"}</td>
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
            <p className="text-[11px] text-gray-400 mt-2">
                유형/지역/장소/기간 각각의 세부 유사도 점수(sub-score)는 현재 API가 반환하지 않습니다 — 종합 유사도(similarity)와 최종 반영 weight(finalWeight)만 표시됩니다.
            </p>
        </Card>
    );
}
