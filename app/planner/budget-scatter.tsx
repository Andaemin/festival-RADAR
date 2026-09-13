"use client";

import { useState } from "react";
import { MayoCard, MayoTag, MayoAccordion, MayoTable, MayoDialog } from "mayoui-react";
import type { BudgetEfficiencySummary, BudgetScatterPoint } from "@/lib/planner/types";

const MEDIAN_COLOR = "#25b366";
const MIN_POINTS = 8;
const BIN_COUNT = 10;

const W = 560;
const H = 240;
const PAD = { top: 20, right: 16, bottom: 32, left: 32 };

// 구간별 색상: 효율적(녹색) → 평균(파란) → 비효율(주황/빨강)
function binColor(binMid: number, median: number): string {
    const ratio = binMid / median;
    if (ratio <= 0.5) return "#10b981"; // 매우 효율적
    if (ratio <= 0.8) return "#34d399"; // 효율적
    if (ratio <= 1.2) return "#2a78d6"; // 평균 근처
    if (ratio <= 1.8) return "#f59e0b"; // 높은 편
    return "#ef4444";                   // 매우 높음
}

function krw(value: number): string {
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억원`;
    if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만원`;
    return `${value.toLocaleString("ko-KR")}원`;
}

function krwShort(value: number): string {
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
    if (value >= 10_000) return `${Math.round(value / 10_000)}만`;
    return `${value}`;
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
    hideDetailTable?: boolean;
}

export default function BudgetScatter({
    budgetEfficiency,
    datasetYearRange,
    regionSameTypeCount,
    regionLabel,
    typeLabel,
    hideDetailTable,
}: Props) {
    const {
        scatter,
        sampleCount,
        cohortScope,
        medianCostPerVisitorKrw: median,
        p25CostPerVisitorKrw: p25,
        p75CostPerVisitorKrw: p75,
    } = budgetEfficiency;
    const [hoveredBin, setHoveredBin] = useState<number | null>(null);
    const [modalBin, setModalBin] = useState<number | null>(null);

    if (scatter.length < MIN_POINTS || median === null) return null;

    const scopeLabel = cohortScope === "REGION" ? `${regionLabel} ${typeLabel}` : `전국 ${typeLabel}`;
    const costs = scatter.map((p) => p.costPerVisitorKrw).sort((a, b) => a - b);

    const logMin = Math.log10(costs[0]);
    const logMax = Math.log10(costs[costs.length - 1]);
    const logStep = (logMax - logMin) / BIN_COUNT;

    const bins = Array.from({ length: BIN_COUNT }, (_, i) => {
        const lo = 10 ** (logMin + i * logStep);
        const hi = 10 ** (logMin + (i + 1) * logStep);
        const mid = 10 ** (logMin + (i + 0.5) * logStep);
        const items = scatter.filter((p) =>
            i === BIN_COUNT - 1
                ? p.costPerVisitorKrw >= lo && p.costPerVisitorKrw <= hi
                : p.costPerVisitorKrw >= lo && p.costPerVisitorKrw < hi,
        );
        return { lo, hi, mid, count: items.length, items };
    });

    const maxCount = Math.max(...bins.map((b) => b.count));
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const barW = plotW / BIN_COUNT;

    const barX = (i: number) => PAD.left + i * barW;
    const barH = (count: number) => maxCount === 0 ? 0 : (count / maxCount) * plotH;
    const barY = (count: number) => PAD.top + plotH - barH(count);

    const medLogPos = (Math.log10(median) - logMin) / (logMax - logMin);
    const medX = PAD.left + medLogPos * plotW;

    const yTickStep = Math.max(1, Math.ceil(maxCount / 4));
    const yTicks: number[] = [];
    for (let t = 0; t <= maxCount; t += yTickStep) yTicks.push(t);
    if (yTicks[yTicks.length - 1] < maxCount) yTicks.push(maxCount);

    const sorted = [...scatter].sort((a, b) => a.costPerVisitorKrw - b.costPerVisitorKrw);
    const tableData = sorted.map((p, i) => ({
        rank: i + 1,
        festivalName: p.festivalName,
        totalBudgetKrw: p.totalBudgetKrw,
        visitors: p.visitors,
        costPerVisitorKrw: p.costPerVisitorKrw,
    }));

    // 모달용 데이터
    const modalItems = modalBin !== null
        ? [...bins[modalBin].items].sort((a, b) => a.costPerVisitorKrw - b.costPerVisitorKrw)
        : [];

    return (
        <MayoCard variant="outlined" padding="md" style={{ overflow: "visible" }}>
            <div className="flex items-baseline gap-1 sm:gap-2 flex-wrap mb-2">
                <h2 className="text-xs sm:text-sm font-bold whitespace-nowrap" style={{ color: "var(--mayo-text)" }}>
                    예산 효율 분포
                </h2>
                <span className="text-[10px] sm:text-[11px] whitespace-nowrap" style={{ color: "var(--mayo-text-muted)" }}>
                    {scopeLabel} {sampleCount}건 · {datasetYearRange[0]}~{datasetYearRange[1]}년
                    {cohortScope === "NATIONAL" && ` · ${regionLabel} ${regionSameTypeCount}건 → 전국 확대`}
                </span>
                <span className="text-[10px] sm:text-[11px] whitespace-nowrap" style={{ color: "var(--mayo-text-muted)" }}>
                    중앙값 <strong style={{ color: MEDIAN_COLOR }}>{krw(median)}</strong>/인
                    {p25 !== null && <> · Q1 <strong>{krw(p25)}</strong></>}
                    {p75 !== null && <> · Q3 <strong>{krw(p75)}</strong></>}
                </span>
            </div>

            {/* 히스토그램 */}
            <div className="relative overflow-visible">
                {hoveredBin !== null && bins[hoveredBin].count > 0 && (
                    <div
                        className="absolute z-50 rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none whitespace-nowrap"
                        style={{
                            background: "var(--mayo-bg-muted)",
                            color: "var(--mayo-text)",
                            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                            left: `${((barX(hoveredBin) + barW / 2) / W) * 100}%`,
                            bottom: `${((H - barY(bins[hoveredBin].count) + 8) / H) * 100}%`,
                            transform: "translateX(-50%)",
                        }}
                    >
                        <div className="font-bold">{bins[hoveredBin].count}건 — 클릭하여 상세 보기</div>
                        <div style={{ color: "var(--mayo-text-muted)" }}>
                            {krw(bins[hoveredBin].lo)} ~ {krw(bins[hoveredBin].hi)}
                        </div>
                    </div>
                )}

                <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="1인당 비용 히스토그램">
                    {yTicks.map((t) => {
                        const y = PAD.top + plotH - (maxCount === 0 ? 0 : (t / maxCount) * plotH);
                        return (
                            <g key={`y${t}`}>
                                <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="var(--mayo-border)" strokeWidth={0.5} />
                                <text x={PAD.left - 4} y={y + 3} textAnchor="end" fontSize={7} fill="var(--mayo-text-muted)">{t}</text>
                            </g>
                        );
                    })}

                    {bins.map((bin, i) => {
                        const isH = hoveredBin === i;
                        const color = binColor(bin.mid, median);
                        return (
                            <g key={i}>
                                <rect
                                    x={barX(i) + 1}
                                    y={barY(bin.count)}
                                    width={barW - 2}
                                    height={barH(bin.count)}
                                    fill={color}
                                    opacity={hoveredBin === null ? 0.8 : isH ? 1 : 0.3}
                                    rx={2}
                                    style={{ transition: "opacity 120ms" }}
                                />
                                <rect
                                    x={barX(i)}
                                    y={PAD.top}
                                    width={barW}
                                    height={plotH}
                                    fill="transparent"
                                    style={{ cursor: bin.count > 0 ? "pointer" : "default" }}
                                    onMouseEnter={() => setHoveredBin(i)}
                                    onMouseLeave={() => setHoveredBin(null)}
                                    onClick={() => { if (bin.count > 0) setModalBin(i); }}
                                />
                            </g>
                        );
                    })}

                    <line x1={medX} y1={PAD.top - 4} x2={medX} y2={PAD.top + plotH} stroke={MEDIAN_COLOR} strokeWidth={1.5} strokeDasharray="4 3" />
                    <text x={medX} y={PAD.top - 7} textAnchor="middle" fontSize={7} fill={MEDIAN_COLOR}>중앙값</text>

                    {[0, Math.floor(BIN_COUNT / 4), Math.floor(BIN_COUNT / 2), Math.floor(BIN_COUNT * 3 / 4), BIN_COUNT].map((i) => {
                        const v = 10 ** (logMin + i * logStep);
                        return (
                            <text key={`xl${i}`} x={barX(Math.min(i, BIN_COUNT - 1)) + (i === BIN_COUNT ? barW : 0)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={7} fill="var(--mayo-text-muted)">
                                {krwShort(Math.round(v))}
                            </text>
                        );
                    })}

                    <text x={W - PAD.right} y={H - 4} textAnchor="end" fontSize={7} fill="var(--mayo-text-muted)">1인당 비용 →</text>
                    <text x={2} y={PAD.top - 4} fontSize={7} fill="var(--mayo-text-muted)">축제 수</text>
                </svg>
            </div>

            {/* 범례 */}
            <div className="flex flex-wrap gap-x-2 sm:gap-x-3 gap-y-0.5 mt-1 text-[10px] sm:text-[11px]" style={{ color: "var(--mayo-text-muted)" }}>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#10b981" }} />
                    효율적
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#2a78d6" }} />
                    평균
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#f59e0b" }} />
                    높은 편
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#ef4444" }} />
                    매우 높음
                </span>
                <span className="flex items-center gap-1">
                    <svg width="12" height="10" aria-hidden><line x1="6" y1="0" x2="6" y2="10" stroke={MEDIAN_COLOR} strokeWidth="1.5" strokeDasharray="4 3" /></svg>
                    중앙값
                </span>
            </div>

            {/* 상세 테이블 드롭다운 */}
            {!hideDetailTable && (
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
                                            key: "costPerVisitorKrw", label: "1인당", width: 140, sortable: true,
                                            render: (v: unknown) => {
                                                const n = Number(v);
                                                const grade = efficiencyGrade(n, median);
                                                return (<div className="flex items-center gap-1 whitespace-nowrap"><span>{krw(n)}</span><MayoTag color={grade.color} variant="soft" size="sm">{grade.label}</MayoTag></div>);
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
            )}

            {/* 구간 상세 모달 */}
            <MayoDialog
                open={modalBin !== null}
                onClose={() => setModalBin(null)}
                title={modalBin !== null ? `${krw(bins[modalBin].lo)} ~ ${krw(bins[modalBin].hi)} 구간 (${bins[modalBin].count}건)` : ""}
                size="lg"
            >
                {modalBin !== null && modalItems.length > 0 && (
                    <MayoTable
                        columns={[
                            { key: "festivalName", label: "축제명", sortable: true },
                            { key: "totalBudgetKrw", label: "예산", width: 90, sortable: true, render: (v: unknown) => krw(Number(v)) },
                            { key: "visitors", label: "방문객", width: 90, sortable: true, render: (v: unknown) => { const n = Number(v); return n >= 10000 ? `${Math.round(n / 10000).toLocaleString()}만명` : `${n.toLocaleString()}명`; } },
                            {
                                key: "costPerVisitorKrw", label: "1인당 비용", width: 160, sortable: true,
                                render: (v: unknown) => {
                                    const n = Number(v);
                                    const grade = efficiencyGrade(n, median);
                                    return (<div className="flex items-center gap-1 whitespace-nowrap"><span>{krw(n)}</span><MayoTag color={grade.color} variant="soft" size="sm">{grade.label}</MayoTag></div>);
                                },
                            },
                        ]}
                        data={modalItems.map((p, i) => ({
                            _key: `${p.festivalName}-${i}`,
                            festivalName: p.festivalName,
                            totalBudgetKrw: p.totalBudgetKrw,
                            visitors: p.visitors,
                            costPerVisitorKrw: p.costPerVisitorKrw,
                        })) as unknown as Record<string, unknown>[]}
                        rowKey="_key"
                        bordered
                        striped
                    />
                )}
            </MayoDialog>
        </MayoCard>
    );
}

export function BudgetDetailTable({
    budgetEfficiency,
}: {
    budgetEfficiency: BudgetEfficiencySummary;
}) {
    const { scatter, medianCostPerVisitorKrw: median } = budgetEfficiency;
    if (scatter.length < MIN_POINTS || median === null) return null;

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
    );
}
