"use client";

import { useEffect, useState } from "react";
import type { BudgetEstimateResponse, MetadataResponse } from "@/lib/domain/types";
import { estimateMultiYearBudget, MultiYearBudgetEstimateResponse } from "@/lib/api/multiyear-budget-estimates";

export default function AssistantTesterPage() {
    const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
    const [metaError, setMetaError] = useState<string | null>(null);

    // 폼 상태
    const [regionCode, setRegionCode] = useState("");
    const [district, setDistrict] = useState("");
    const [festivalType, setFestivalType] = useState("");
    const [venueType, setVenueType] = useState("");
    const [durationDays, setDurationDays] = useState(3);

    // 결과 상태
    const [result, setResult] = useState<BudgetEstimateResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // 다년도 계획예산 폼 상태
    const [myRegionCode, setMyRegionCode] = useState("");
    const [myDistrict, setMyDistrict] = useState("");
    const [myFestivalTypes, setMyFestivalTypes] = useState<string[]>([]);
    const [myVenueType, setMyVenueType] = useState("");
    const [myDurationDays, setMyDurationDays] = useState(3);
    const [planningYear, setPlanningYear] = useState(2027);
    const [referenceDataPolicy, setReferenceDataPolicy] = useState<"HISTORICAL_ONLY" | "INCLUDE_PUBLISHED_SAME_YEAR">("HISTORICAL_ONLY");

    const [myResult, setMyResult] = useState<MultiYearBudgetEstimateResponse | null>(null);
    const [myError, setMyError] = useState<string | null>(null);
    const [myLoading, setMyLoading] = useState(false);

    // 메타데이터 로드
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

                    setMyRegionCode(data.regions[0]?.code ?? "");
                    setMyFestivalTypes(data.festivalTypes[0]?.code ? [data.festivalTypes[0].code] : []);
                    setMyVenueType(data.venueTypes[0]?.code ?? "");
                }
            })
            .catch((e) => setMetaError(String(e)));
    }, []);

    const districts = metadata?.districtsByRegion[regionCode] ?? [];
    const myDistricts = metadata?.districtsByRegion[myRegionCode] ?? [];

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setResult(null);
        setLoading(true);
        try {
            const res = await fetch("/api/v1/budget-estimates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    regionCode,
                    district: district || undefined,
                    festivalType,
                    venueType,
                    durationDays: Number(durationDays),
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.message ?? "오류가 발생했습니다.");
            } else {
                setResult(data);
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }

    function toggleMyFestivalType(code: string) {
        setMyFestivalTypes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
    }

    async function handleMultiYearSubmit(e: React.FormEvent) {
        e.preventDefault();
        setMyError(null);
        setMyResult(null);
        setMyLoading(true);
        try {
            const data = await estimateMultiYearBudget({
                regionCode: myRegionCode,
                district: myDistrict || undefined,
                festivalTypes: myFestivalTypes,
                venueType: myVenueType,
                durationDays: Number(myDurationDays),
                planningYear: Number(planningYear),
                referenceDataPolicy,
            });
            setMyResult(data);
        } catch (e) {
            setMyError(e instanceof Error ? e.message : "다년도 계획예산 추정에 실패했습니다.");
        } finally {
            setMyLoading(false);
        }
    }

    return (
        <main className="min-h-screen bg-gray-50 p-8 text-gray-900">
            <div className="max-w-3xl mx-auto">
                <h1 className="text-2xl font-bold mb-1">축제 예산 추정 테스터</h1>
                <p className="text-sm text-gray-900 mb-6">festival-budget-assistant 알고리즘 연동 확인용</p>

                {metaError && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                        메타데이터 오류: {metaError}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-6 flex flex-col gap-4 mb-6">
                    {/* 지역 */}
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

                    {/* 시군구 */}
                    <div className="flex flex-col gap-1">
                        <label className="text-sm font-medium">시군구 <span className="text-gray-900 font-normal">(선택)</span></label>
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

                    {/* 축제 유형 */}
                    <div className="flex flex-col gap-1">
                        <label className="text-sm font-medium">축제 유형</label>
                        <select
                            className="border rounded px-3 py-2 text-sm"
                            value={festivalType}
                            onChange={(e) => setFestivalType(e.target.value)}
                            disabled={!metadata}
                        >
                            {metadata?.festivalTypes.map((t) => (
                                <option key={t.code} value={t.code}>{t.displayName}</option>
                            ))}
                        </select>
                    </div>

                    {/* 장소 유형 */}
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

                    {/* 개최 일수 */}
                    <div className="flex flex-col gap-1">
                        <label className="text-sm font-medium">개최 일수 <span className="text-gray-900">(최소 2일)</span></label>
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
                        disabled={loading || !metadata}
                        className="mt-2 bg-blue-600 text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? "추정 중..." : "예산 추정"}
                    </button>
                </form>

                {error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-6">
                        {error}
                    </div>
                )}

                {result && <ResultCard result={result} />}

                <div className="mt-12 pt-8 border-t border-gray-200">
                    <h2 className="text-2xl font-bold mb-1">다년도 계획예산</h2>
                    <p className="text-sm text-gray-900 mb-6">2017~2026년 공개 개최계획 데이터를 참고해 미래 축제의 계획예산을 추정합니다.</p>

                    <form onSubmit={handleMultiYearSubmit} className="bg-white rounded-xl shadow p-6 flex flex-col gap-4 mb-6">
                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">기획연도</label>
                            <p className="text-xs text-gray-900 mb-1">어느 연도에 개최할 축제를 기획하고 계신가요? (데이터가 수집된 연도가 아니라, 앞으로 열릴 축제의 개최연도입니다)</p>
                            <input
                                type="number"
                                className="border rounded px-3 py-2 text-sm w-32"
                                value={planningYear}
                                onChange={(e) => setPlanningYear(Number(e.target.value))}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">광역자치단체</label>
                            <select
                                className="border rounded px-3 py-2 text-sm"
                                value={myRegionCode}
                                onChange={(e) => { setMyRegionCode(e.target.value); setMyDistrict(""); }}
                                disabled={!metadata}
                            >
                                {metadata?.regions.map((r) => (
                                    <option key={r.code} value={r.code}>{r.displayName}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">시군구 <span className="text-gray-900 font-normal">(선택)</span></label>
                            <select
                                className="border rounded px-3 py-2 text-sm"
                                value={myDistrict}
                                onChange={(e) => setMyDistrict(e.target.value)}
                                disabled={myDistricts.length === 0}
                            >
                                <option value="">-- 선택 안 함 --</option>
                                {myDistricts.map((d) => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">축제 유형 <span className="text-gray-900 font-normal">(복수 선택 가능)</span></label>
                            <div className="flex flex-wrap gap-3">
                                {metadata?.festivalTypes.map((t) => (
                                    <label key={t.code} className="flex items-center gap-1.5 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={myFestivalTypes.includes(t.code)}
                                            onChange={() => toggleMyFestivalType(t.code)}
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
                                value={myVenueType}
                                onChange={(e) => setMyVenueType(e.target.value)}
                                disabled={!metadata}
                            >
                                {metadata?.venueTypes.map((v) => (
                                    <option key={v.code} value={v.code}>{v.displayName}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium">개최 일수 <span className="text-gray-900">(최소 2일)</span></label>
                            <input
                                type="number"
                                min={2}
                                max={180}
                                className="border rounded px-3 py-2 text-sm w-32"
                                value={myDurationDays}
                                onChange={(e) => setMyDurationDays(Number(e.target.value))}
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium">참고 데이터 정책</label>
                            <label className="flex items-start gap-2 text-sm border rounded-lg p-3 cursor-pointer has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50">
                                <input
                                    type="radio"
                                    name="referenceDataPolicy"
                                    className="mt-1"
                                    checked={referenceDataPolicy === "HISTORICAL_ONLY"}
                                    onChange={() => setReferenceDataPolicy("HISTORICAL_ONLY")}
                                />
                                <span>
                                    <span className="font-medium block">과거 공개자료만 사용</span>
                                    <span className="text-gray-900 text-xs">기획연도 이전에 공개된 축제 계획자료만 참고합니다.</span>
                                </span>
                            </label>
                            <label className="flex items-start gap-2 text-sm border rounded-lg p-3 cursor-pointer has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50">
                                <input
                                    type="radio"
                                    name="referenceDataPolicy"
                                    className="mt-1"
                                    checked={referenceDataPolicy === "INCLUDE_PUBLISHED_SAME_YEAR"}
                                    onChange={() => setReferenceDataPolicy("INCLUDE_PUBLISHED_SAME_YEAR")}
                                />
                                <span>
                                    <span className="font-medium block">기획연도 공개자료도 포함</span>
                                    <span className="text-gray-900 text-xs">기획연도의 공식 축제 계획자료가 완성 공개된 경우 해당 연도 자료도 함께 참고합니다.</span>
                                </span>
                            </label>
                        </div>

                        <button
                            type="submit"
                            disabled={myLoading || !metadata || myFestivalTypes.length === 0}
                            className="mt-2 bg-emerald-600 text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {myLoading ? "추정 중..." : "다년도 계획예산 추정"}
                        </button>
                    </form>

                    {myError && (
                        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-6">
                            {myError}
                        </div>
                    )}

                    {myResult && <MultiYearResultCard result={myResult} />}
                </div>
            </div>
        </main>
    );
}

function ResultCard({ result }: { result: BudgetEstimateResponse }) {
    const fmt = (n: number) => new Intl.NumberFormat("ko-KR").format(n) + "원";
    const confidenceColor =
        result.confidence.level === "HIGH" ? "text-green-600" :
        result.confidence.level === "MEDIUM" ? "text-yellow-600" : "text-red-600";

    return (
        <div className="bg-white rounded-xl shadow p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
                <h2 className="font-bold text-lg">추정 결과</h2>
                <span className="text-xs text-gray-900">{result.algorithmVersion} · {result.datasetYear}년 데이터</span>
            </div>

            {/* 핵심 수치 */}
            <div className="grid grid-cols-3 gap-3">
                <StatBox label="추천 예산" value={fmt(result.recommendedBudgetKrw)} highlight />
                <StatBox label="추정 예산 (기하평균)" value={fmt(result.estimatedBudgetKrw)} />
                <StatBox label="가중 평균" value={fmt(result.weightedAverageBudgetKrw)} />
                <StatBox label="P50 (중앙값)" value={fmt(result.p50Krw)} />
                <StatBox label="P60" value={fmt(result.p60Krw)} />
                <StatBox label="표본 수" value={`${result.sampleCount}건`} />
            </div>

            {/* 범위 */}
            <div className="flex gap-2 items-center text-sm">
                <span className="text-gray-900">일반 범위</span>
                <span className="font-medium">{fmt(result.typicalRange.minKrw)}</span>
                <span className="text-gray-900">~</span>
                <span className="font-medium">{fmt(result.typicalRange.maxKrw)}</span>
                <span className="text-gray-900 text-xs">(P25~P75)</span>
            </div>

            {/* 신뢰도 */}
            <div className="flex gap-3 items-center text-sm">
                <span className="text-gray-900">신뢰도</span>
                <span className={`font-bold ${confidenceColor}`}>{result.confidence.label}</span>
                <span className="text-gray-900">{result.confidence.score.toFixed(1)}점</span>
                <span className="text-gray-900 text-xs">fallback: {result.fallbackLabel}</span>
            </div>

            {/* 경고 */}
            {result.warnings.length > 0 && (
                <div className="flex flex-col gap-1">
                    {result.warnings.map((w, i) => (
                        <p key={i} className="text-xs text-yellow-700 bg-yellow-50 px-3 py-1.5 rounded">⚠ {w}</p>
                    ))}
                </div>
            )}

            {/* 유사 축제 */}
            {result.similarFestivals.length > 0 && (
                <div>
                    <p className="text-sm font-medium mb-2">유사 축제 (상위 5개)</p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="text-left px-2 py-1.5 border-b">축제명</th>
                                    <th className="text-left px-2 py-1.5 border-b">지역</th>
                                    <th className="text-left px-2 py-1.5 border-b">유형</th>
                                    <th className="text-right px-2 py-1.5 border-b">예산</th>
                                    <th className="text-right px-2 py-1.5 border-b">유사도</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.similarFestivals.map((f, i) => (
                                    <tr key={i} className="border-b last:border-0">
                                        <td className="px-2 py-1.5">{f.festivalName}</td>
                                        <td className="px-2 py-1.5 text-gray-900">{f.region}</td>
                                        <td className="px-2 py-1.5 text-gray-900">{f.festivalType}</td>
                                        <td className="px-2 py-1.5 text-right">{fmt(f.budgetKrw)}</td>
                                        <td className="px-2 py-1.5 text-right text-gray-900">{f.similarity}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Scope breakdown */}
            {result.scopeWeightBreakdown.length > 0 && (
                <div>
                    <p className="text-sm font-medium mb-2">Fallback 단계별 weight 점유율</p>
                    <div className="flex flex-col gap-1">
                        {result.scopeWeightBreakdown.map((s, i) => (
                            <div key={i} className="flex justify-between text-xs">
                                <span className="text-gray-900">{s.label}</span>
                                <span className="font-medium">{s.weightSharePercent.toFixed(1)}%</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* raw JSON 토글 */}
            <details className="text-xs">
                <summary className="cursor-pointer text-gray-900">raw JSON 보기</summary>
                <pre className="mt-2 bg-gray-50 p-3 rounded overflow-x-auto text-gray-900">
                    {JSON.stringify(result, null, 2)}
                </pre>
            </details>
        </div>
    );
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div className={`rounded-lg p-3 flex flex-col gap-0.5 ${highlight ? "bg-blue-50 border border-blue-200" : "bg-gray-50"}`}>
            <span className="text-xs text-gray-900">{label}</span>
            <span className={`text-sm font-bold ${highlight ? "text-blue-700" : "text-gray-800"}`}>{value}</span>
        </div>
    );
}

const REFERENCE_POLICY_LABEL: Record<string, string> = {
    HISTORICAL_ONLY: "과거 공개자료만 사용",
    INCLUDE_PUBLISHED_SAME_YEAR: "기획연도 공개자료도 포함",
};

function MultiYearResultCard({ result }: { result: MultiYearBudgetEstimateResponse }) {
    const fmt = (n: number) => new Intl.NumberFormat("ko-KR").format(n) + "원";
    const downgraded = result.requestedReferenceDataPolicy !== result.appliedReferenceDataPolicy;
    const maxWeightShare = Math.max(0, ...result.yearWeightBreakdown.map((y) => y.weightShare));

    return (
        <div className="bg-white rounded-xl shadow p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">{result.planningYear}년 기획 계획예산</h3>
                <span className="text-xs text-gray-900">{result.model}</span>
            </div>

            {/* 세 값을 서로 대체하지 않고 명확히 분리해서 보여준다(서로 다른 파이프라인 단계).
                - 정책상 범위(referenceYearTo): appliedReferenceDataPolicy가 허용하는 연도 상한.
                  planningYear/정책만으로 정해지며 실제 보유 데이터와 무관하다.
                - 참조 대상 데이터(referencePoolEarliestYear~LatestYear): filterReferencePool 결과
                  전체(= CandidateSelector 진입 전)의 실제 datasetYear 범위. "실제로 후보 탐색에
                  쓸 수 있었던 데이터가 어디까지 있었는가" - referenceYearTo보다 작을 수 있다(정책은
                  더 먼 미래까지 허용해도 실제 보유 데이터가 거기까지 없을 때).
                - 최종 비교 표본(earliestSourceYear~latestSourceYear): CandidateSelectorV1 +
                  similarity 기반 top-N 컷 이후 실제 최종 통계 계산에 포함된 연도. 참조 대상 데이터
                  전체가 탐색됐다고 해서 그 안의 모든 연도가 최종 표본에 남는 건 아니다 - 최신 연도
                  후보가 similarity 하한(threshold)은 넘어도 다른 연도의 더 높은 similarity 후보에
                  top-N cut에서 밀려날 수 있다(정상적인 selector/scoring 결과). */}
            <div className="flex flex-col gap-2 bg-gray-50 rounded-lg px-4 py-3 text-sm">
                <div className="flex items-center gap-3">
                    <span className="text-gray-900 w-28 shrink-0">참조 대상 데이터</span>
                    <span className="font-bold text-gray-800">
                        {result.referencePoolEarliestYear !== null && result.referencePoolLatestYear !== null
                            ? `${result.referencePoolEarliestYear}~${result.referencePoolLatestYear}`
                            : "참조 가능한 데이터 없음"}
                    </span>
                    <span className="text-xs text-gray-900">({REFERENCE_POLICY_LABEL[result.appliedReferenceDataPolicy] ?? result.appliedReferenceDataPolicy})</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-gray-900 w-28 shrink-0">최종 비교 표본</span>
                    <span className="font-bold text-gray-800">
                        {result.earliestSourceYear !== null && result.latestSourceYear !== null
                            ? `${result.earliestSourceYear}~${result.latestSourceYear} 중 ${result.distinctYearsUsed}개 연도`
                            : "참고 가능한 데이터 없음"}
                    </span>
                </div>
                {result.referencePoolLatestYear !== null && result.referencePoolLatestYear < result.referenceYearTo && (
                    <p className="text-xs text-gray-900">
                        정책상 {result.referenceYearTo}년까지 참고할 수 있으나, 현재 참조 가능한 데이터는 {result.referencePoolLatestYear}년까지입니다.
                    </p>
                )}
            </div>

            {downgraded && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                    ℹ️ 해당 연도의 공개 축제 계획자료가 아직 완성 상태로 등록되지 않아 과거 연도 자료만 사용했습니다.
                    (요청: {REFERENCE_POLICY_LABEL[result.requestedReferenceDataPolicy]} → 적용: {REFERENCE_POLICY_LABEL[result.appliedReferenceDataPolicy]})
                </div>
            )}

            {/* 핵심 수치 - "예측값"이 아니라 계획 판단 도구라는 의미를 명칭에 반영 */}
            <div className="grid grid-cols-3 gap-3">
                <StatBox label="데이터 기준 예산" value={fmt(result.estimatedBudgetKrw)} />
                <StatBox label="기획 추천 예산" value={fmt(result.recommendedBudgetKrw)} highlight />
                <StatBox label="가중 평균" value={fmt(result.weightedAverageBudgetKrw)} />
            </div>
            <div className="flex gap-2 items-center text-sm">
                <span className="text-gray-900">일반적 범위</span>
                <span className="font-medium">{fmt(result.p25Krw)}</span>
                <span className="text-gray-900">~</span>
                <span className="font-medium">{fmt(result.p75Krw)}</span>
                <span className="text-gray-900 text-xs">(P25~P75, 중앙값 {fmt(result.p50Krw)})</span>
            </div>

            {/* 다년도 사용 정도 */}
            <div className="grid grid-cols-3 gap-3 text-sm">
                <StatBox label="최종 비교 축제" value={`${result.sampleCount}개`} />
                <StatBox label="실제 활용 연도" value={`${result.distinctYearsUsed}개 연도`} />
                <StatBox
                    label="유효 연도 수"
                    value={result.effectiveYearCount.toFixed(1)}
                />
            </div>
            <p className="text-xs text-gray-900 -mt-3" title="여러 연도의 자료가 얼마나 균형 있게 반영되었는지를 나타냅니다. 특정 연도에 비중이 몰릴수록 실제 연도 수보다 낮아집니다.">
                ⓘ 유효 연도 수 = 여러 연도 자료가 얼마나 균형 있게 반영됐는지(특정 연도에 쏠릴수록 실제 연도 수보다 낮아짐)
            </p>

            {/* 연도별 반영 비중 */}
            {result.yearWeightBreakdown.length > 0 && (
                <details className="text-sm" open>
                    <summary className="cursor-pointer font-medium mb-2">연도별 반영 비중</summary>
                    <div className="flex flex-col gap-1.5 mt-2">
                        {result.yearWeightBreakdown.map((y) => (
                            <div key={y.year} className="flex items-center gap-2 text-xs">
                                <span className="w-12 text-gray-900">{y.year}</span>
                                <div className="flex-1 bg-gray-100 rounded h-3 overflow-hidden">
                                    <div
                                        className="bg-emerald-500 h-full rounded"
                                        style={{ width: `${maxWeightShare > 0 ? (y.weightShare / maxWeightShare) * 100 : 0}%` }}
                                    />
                                </div>
                                <span className="w-20 text-right text-gray-900">{(y.weightShare * 100).toFixed(1)}% ({y.candidateCount}건)</span>
                            </div>
                        ))}
                    </div>
                </details>
            )}

            <div className="flex gap-3 items-center text-xs text-gray-900 flex-wrap">
                <span>fallback: {result.fallbackLevel}</span>
                <span>평균 유사도: {(result.averageSimilarity * 100).toFixed(1)}%</span>
                <span>dataQualityV3: {result.dataQualityV3.toFixed(1)}점</span>
            </div>

            {/* raw JSON 토글 */}
            <details className="text-xs">
                <summary className="cursor-pointer text-gray-900">raw JSON 보기</summary>
                <pre className="mt-2 bg-gray-50 p-3 rounded overflow-x-auto text-gray-900">
                    {JSON.stringify(result, null, 2)}
                </pre>
            </details>
        </div>
    );
}
