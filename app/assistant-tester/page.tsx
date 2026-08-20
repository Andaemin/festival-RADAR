"use client";

import { useEffect, useState } from "react";
import type { BudgetEstimateResponse, MetadataResponse } from "@/lib/domain/types";

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
                }
            })
            .catch((e) => setMetaError(String(e)));
    }, []);

    const districts = metadata?.districtsByRegion[regionCode] ?? [];

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

    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-3xl mx-auto">
                <h1 className="text-2xl font-bold mb-1">축제 예산 추정 테스터</h1>
                <p className="text-sm text-gray-500 mb-6">festival-budget-assistant 알고리즘 연동 확인용</p>

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
                        <label className="text-sm font-medium">시군구 <span className="text-gray-400 font-normal">(선택)</span></label>
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
                        <label className="text-sm font-medium">개최 일수 <span className="text-gray-400">(최소 2일)</span></label>
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
                <span className="text-xs text-gray-400">{result.algorithmVersion} · {result.datasetYear}년 데이터</span>
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
                <span className="text-gray-500">일반 범위</span>
                <span className="font-medium">{fmt(result.typicalRange.minKrw)}</span>
                <span className="text-gray-400">~</span>
                <span className="font-medium">{fmt(result.typicalRange.maxKrw)}</span>
                <span className="text-gray-400 text-xs">(P25~P75)</span>
            </div>

            {/* 신뢰도 */}
            <div className="flex gap-3 items-center text-sm">
                <span className="text-gray-500">신뢰도</span>
                <span className={`font-bold ${confidenceColor}`}>{result.confidence.label}</span>
                <span className="text-gray-400">{result.confidence.score.toFixed(1)}점</span>
                <span className="text-gray-400 text-xs">fallback: {result.fallbackLabel}</span>
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
                                        <td className="px-2 py-1.5 text-gray-500">{f.region}</td>
                                        <td className="px-2 py-1.5 text-gray-500">{f.festivalType}</td>
                                        <td className="px-2 py-1.5 text-right">{fmt(f.budgetKrw)}</td>
                                        <td className="px-2 py-1.5 text-right text-gray-500">{f.similarity}</td>
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
                                <span className="text-gray-600">{s.label}</span>
                                <span className="font-medium">{s.weightSharePercent.toFixed(1)}%</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* raw JSON 토글 */}
            <details className="text-xs">
                <summary className="cursor-pointer text-gray-400 hover:text-gray-600">raw JSON 보기</summary>
                <pre className="mt-2 bg-gray-50 p-3 rounded overflow-x-auto text-gray-600">
                    {JSON.stringify(result, null, 2)}
                </pre>
            </details>
        </div>
    );
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div className={`rounded-lg p-3 flex flex-col gap-0.5 ${highlight ? "bg-blue-50 border border-blue-200" : "bg-gray-50"}`}>
            <span className="text-xs text-gray-500">{label}</span>
            <span className={`text-sm font-bold ${highlight ? "text-blue-700" : "text-gray-800"}`}>{value}</span>
        </div>
    );
}
