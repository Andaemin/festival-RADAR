"use client";

import { useState } from "react";
import { MayoCard, MayoTag, MayoAccordion, MayoTable, MayoDivider } from "mayoui-react";
import type { BudgetEfficiencySummary, BudgetScatterPoint } from "@/lib/planner/types";

const POINT = "#2a78d6";
const MEDIAN_LINE = "#25b366";
const MIN_POINTS = 8;

// viewBox 기준 좌표 — 실제 렌더링은 w-full로 반응형
const W = 640;
const H = 400;
const PAD = { top: 20, right: 20, bottom: 40, left: 56 };

function krw(value: number): string {
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억원`;
    if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만원`;
    return `${value.toLocaleString("ko-KR")}원`;
}

function krwTick(value: number): string {
    if (value >= 100_000_000) return `${value / 100_000_000}억`;
    if (value >= 10_000_000) return `${value / 10_000_000}천만`;
    if (value >= 10_000) return `${Math.round(value / 10_000)}만`;
    return `${value}`;
}

function personTick(value: number): string {
    if (value >= 10_000) return `${value / 10_000}만`;
    if (value >= 1_000) return `${value / 1_000}천`;
    return `${value}`;
}

function powerTicks(min: number, max: number): number[] {
    const ticks: number[] = [];
    for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
        const v = 10 ** e;
        if (v >= min && v <= max) ticks.push(v);
    }
    return ticks;
}

function efficiencyGrade(cost: number, median: number): { label: string; color: "green" | "blue" | "purple" | "orange" | "red" } {
    const ratio = cost / median;
    if (ratio <= 0.5) return { label: "매우 효율적", color: "green" };
    if (ratio <= 0.8) return { label: "효율적", color: "blue" };
    if (ratio <= 1.2) return { label: "평균", color: "purple" };
    if (ratio <= 1.8) return { label: "높은 편", color: "orange" };
    return { label: "매우 높음", color: "red" };
}

interface Props {
    budgetEfficiency: BudgetEfficiencySummary;
    datasetYearRange: [number, number];
    regionSameTypeCount: number;
    regionLabel: string;
    typeLabel: string;
}

export default function BudgetScatter({
    budgetEfficiency,
    datasetYearRange,
    regionSameTypeCount,
    regionLabel,
    typeLabel,
}: Props) {
    const {
        scatter,
        sampleCount,
        cohortScope,
        medianCostPerVisitorKrw: median,
        p25CostPerVisitorKrw: p25,
        p75CostPerVisitorKrw: p75,
    } = budgetEfficiency;
    const [hovered, setHovered] = useState<BudgetScatterPoint | null>(null);

    if (scatter.length < MIN_POINTS || median === null) return null;

    const scopeLabel = cohortScope === "REGION" ? `${regionLabel} ${typeLabel}` : `전국 ${typeLabel}`;

    const budgets = scatter.map((p) => p.totalBudgetKrw);
    const visitors = scatter.map((p) => p.visitors);
    const xMin = Math.min(...budgets);
    const xMax = Math.max(...budgets);
    const yMin = Math.min(...visitors);
    const yMax = Math.max(...visitors);

    const xSpan = Math.log10(xMax) - Math.log10(xMin) || 1;
    const ySpan = Math.log10(yMax) - Math.log10(yMin) || 1;

    const lx = (v: number) => PAD.left + ((Math.log10(v) - Math.log10(xMin)) / xSpan) * (W - PAD.left - PAD.right);
    const ly = (v: number) => H - PAD.bottom - ((Math.log10(v) - Math.log10(yMin)) / ySpan) * (H - PAD.top - PAD.bottom);

    const cpvLine = (c: number) => {
        const clamp = (v: number) => Math.min(yMax, Math.max(yMin, v));
        return { x1: lx(xMin), y1: ly(clamp(xMin / c)), x2: lx(xMax), y2: ly(clamp(xMax / c)) };
    };

    const mid = cpvLine(median);
    const gapPct = hovered === null ? 0 : Math.round(((median - hovered.costPerVisitorKrw) / median) * 100);

    // 테이블 데이터
    const tableData = [...scatter]
        .sort((a, b) => a.costPerVisitorKrw - b.costPerVisitorKrw)
        .map((p, i) => ({
            rank: i + 1,
            festivalName: p.festivalName,
            totalBudgetKrw: p.totalBudgetKrw,
            visitors: p.visitors,
            costPerVisitorKrw: p.costPerVisitorKrw,
        }));

    return (
        <MayoCard variant="outlined" padding="md">
            <h2 className="text-base font-bold mb-1" style={{ color: "var(--mayo-text)" }}>
                예산 · 방문객 포지셔닝
            </h2>
            <p className="text-xs mb-1" style={{ color: "var(--mayo-text-muted)" }}>
                {scopeLabel} {sampleCount}건 · {datasetYearRange[0]}~{datasetYearRange[1]}년
                {cohortScope === "NATIONAL" && ` · ${regionLabel} ${regionSameTypeCount}건 → 전국 확대`}
            </p>

            {/* 요약 지표 */}
            <div className="flex flex-wrap gap-3 mb-3 text-xs" style={{ color: "var(--mayo-text-muted)" }}>
                <span>중앙값 <strong style={{ color: "#25b366" }}>{krw(median)}</strong>/인</span>
                {p25 !== null && <span>Q1 <strong>{krw(p25)}</strong></span>}
                {p75 !== null && <span>Q3 <strong>{krw(p75)}</strong></span>}
            </div>

            {/* 산점도 */}
            <div className="relative">
                {hovered && (
                    <div
                        className="absolute z-10 rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none whitespace-nowrap"
                        style={{
                            background: "var(--mayo-bg-muted)",
                            color: "var(--mayo-text)",
                            boxShadow: "var(--mayo-shadow-md)",
                            left: `${(lx(hovered.totalBudgetKrw) / W) * 100}%`,
                            top: `${(ly(hovered.visitors) / H) * 100}%`,
                            transform: ly(hovered.visitors) < H * 0.4
                                ? "translate(-50%, 10px)"
                                : "translate(-50%, calc(-100% - 10px))",
                        }}
                    >
                        <div className="font-bold mb-0.5">{hovered.festivalName}</div>
                        <div>예산 {krw(hovered.totalBudgetKrw)} · 방문객 {hovered.visitors.toLocaleString("ko-KR")}명</div>
                        <div
                            className="mt-1 pt-1"
                            style={{ borderTop: "1px solid var(--mayo-border)" }}
                        >
                            1인당 {krw(hovered.costPerVisitorKrw)}
                            <span style={{ color: "var(--mayo-text-muted)" }}>
                                {" · "}중앙값보다 {Math.abs(gapPct)}% {gapPct >= 0 ? "낮음" : "높음"}
                            </span>
                        </div>
                    </div>
                )}

                <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 380 }} role="img" aria-label="예산 대비 방문객 분포">
                    {/* Y축 그리드 */}
                    {powerTicks(yMin, yMax).map((t) => (
                        <g key={`y${t}`}>
                            <line x1={PAD.left} y1={ly(t)} x2={W - PAD.right} y2={ly(t)} stroke="var(--mayo-border)" strokeWidth={0.5} />
                            <text x={PAD.left - 6} y={ly(t) + 3} textAnchor="end" fontSize={10} fill="var(--mayo-text-muted)">{personTick(t)}</text>
                        </g>
                    ))}
                    {/* X축 라벨 */}
                    {powerTicks(xMin, xMax).map((t) => (
                        <text key={`x${t}`} x={lx(t)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={10} fill="var(--mayo-text-muted)">{krwTick(t)}</text>
                    ))}

                    {/* IQR 대각선 */}
                    {[p25, p75].map((c) =>
                        c === null ? null : (
                            <line key={c} {...cpvLine(c)} stroke={MEDIAN_LINE} strokeWidth={0.5} strokeDasharray="4 3" opacity={0.4} />
                        )
                    )}
                    {/* 중앙값 대각선 */}
                    <line {...mid} stroke={MEDIAN_LINE} strokeWidth={1} />

                    {/* 점 */}
                    {scatter.map((p) => {
                        const isH = hovered === p;
                        return (
                            <circle
                                key={`${p.festivalName}-${p.totalBudgetKrw}`}
                                cx={lx(p.totalBudgetKrw)}
                                cy={ly(p.visitors)}
                                r={isH ? 5 : 3}
                                fill={POINT}
                                stroke={isH ? "var(--mayo-surface)" : "none"}
                                strokeWidth={isH ? 1.5 : 0}
                                opacity={hovered === null ? 0.5 : isH ? 1 : 0.15}
                                style={{ transition: "opacity 120ms" }}
                            />
                        );
                    })}
                    {/* 투명 히트 영역 */}
                    {scatter.map((p) => (
                        <circle
                            key={`hit-${p.festivalName}-${p.totalBudgetKrw}`}
                            cx={lx(p.totalBudgetKrw)}
                            cy={ly(p.visitors)}
                            r={10}
                            fill="transparent"
                            onMouseEnter={() => setHovered(p)}
                            onMouseLeave={() => setHovered(null)}
                        />
                    ))}

                    <text x={W - PAD.right} y={H - 4} textAnchor="end" fontSize={10} fill="var(--mayo-text-muted)">총예산 →</text>
                    <text x={2} y={PAD.top - 4} fontSize={10} fill="var(--mayo-text-muted)">방문객 ↑</text>
                </svg>
            </div>

            {/* 범례 */}
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-[11px]" style={{ color: "var(--mayo-text-muted)" }}>
                <span className="flex items-center gap-1">
                    <svg width="16" height="5" aria-hidden><line x1="0" y1="2.5" x2="16" y2="2.5" stroke={MEDIAN_LINE} strokeWidth="1" /></svg>
                    중앙값
                </span>
                <span className="flex items-center gap-1">
                    <svg width="16" height="5" aria-hidden><line x1="0" y1="2.5" x2="16" y2="2.5" stroke={MEDIAN_LINE} strokeWidth="0.5" strokeDasharray="4 3" opacity="0.4" /></svg>
                    Q1·Q3
                </span>
                <span>초록선 위 = 같은 예산으로 더 많이 모은 축제</span>
            </div>

            {/* 상세 테이블 드롭다운 */}
            <div className="mt-3">
                <MayoAccordion
                    bordered
                    items={[{
                        value: "table",
                        label: `축제별 예산 효율 상세 (${scatter.length}건)`,
                        children: (
                            <MayoTable
                                columns={[
                                    { key: "rank", label: "#", width: 30 },
                                    { key: "festivalName", label: "축제명", sortable: true },
                                    { key: "totalBudgetKrw", label: "예산", width: 80, sortable: true, render: (v: unknown) => krw(Number(v)) },
                                    { key: "visitors", label: "방문객", width: 80, sortable: true, render: (v: unknown) => { const n = Number(v); return n >= 10000 ? `${Math.round(n / 10000).toLocaleString()}만명` : `${n.toLocaleString()}명`; } },
                                    {
                                        key: "costPerVisitorKrw", label: "1인당", width: 110, sortable: true,
                                        render: (v: unknown) => {
                                            const n = Number(v);
                                            const grade = efficiencyGrade(n, median);
                                            return (<div className="flex items-center gap-1"><span>{krw(n)}</span><MayoTag color={grade.color} variant="soft" size="sm">{grade.label}</MayoTag></div>);
                                        },
                                    },
                                ]}
                                data={tableData as unknown as Record<string, unknown>[]}
                                rowKey="rank"
                                bordered
                                striped
                            />
                        ),
                    }]}
                />
            </div>
        </MayoCard>
    );
}
