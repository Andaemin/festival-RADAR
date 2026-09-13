"use client";

import { useState } from "react";
import { MayoCard, MayoBtn, MayoTable, MayoBarChart } from "mayoui-react";
import type { MonthDistributionEntry } from "@/lib/planner/types";

const SERIES_COLOR = "#2a78d6";
const RECOMMENDED_COLOR = "#25b366";
const TOOLTIP_NAME_LIMIT = 5;

interface Props {
    distribution: MonthDistributionEntry[];
    targetMonth: number | null;
    recommendedMonth: number | null;
    regionLabel: string;
    typeLabel: string;
}

export default function MonthChart({
    distribution,
    targetMonth,
    recommendedMonth,
    regionLabel,
    typeLabel,
}: Props) {
    const [showTable, setShowTable] = useState(false);

    const barData = distribution.map((d) => {
        const label = `${d.month}월${d.month === targetMonth ? "(희망)" : ""}${d.month === recommendedMonth ? "(추천)" : ""}`;
        return {
            label,
            [`${regionLabel} ${typeLabel}`]: d.regionSameTypeCount,
        };
    });

    return (
        <MayoCard variant="outlined" padding="md">
            <div className="flex items-start justify-between gap-4 mb-1">
                <h2 className="text-base font-bold" style={{ color: "var(--mayo-text)" }}>
                    월별 경쟁 축제 수 — {regionLabel} {typeLabel}
                </h2>
                <MayoBtn variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)}>
                    {showTable ? "차트로 보기" : "표로 보기"}
                </MayoBtn>
            </div>
            <p className="text-xs mb-3" style={{ color: "var(--mayo-text-muted)" }}>
                막대는 같은 지역·같은 유형 축제 건수입니다.
            </p>

            {showTable ? (
                <MayoTable
                    columns={[
                        { key: "month", label: "월", width: 100, render: (_v: unknown, row: Record<string, unknown>) => `${row.month}월${row.target ? " (희망)" : ""}${row.recommended ? " (추천)" : ""}` },
                        { key: "regionSameTypeCount", label: `${regionLabel} 동일유형`, sortable: true },
                        { key: "regionCount", label: `${regionLabel} 전체`, sortable: true },
                        { key: "nationalCount", label: "전국 전체", sortable: true },
                        {
                            key: "sameTypeFestivalNames",
                            label: "경쟁 축제 (방문객 많은 순)",
                            render: (_v: unknown, row: Record<string, unknown>) => {
                                const names = row.sameTypeFestivalNames as string[];
                                if (names.length === 0) {
                                    return <span style={{ color: "var(--mayo-text-muted)" }}>—</span>;
                                }
                                return (
                                    <span className="text-xs leading-relaxed">{names.join(", ")}</span>
                                );
                            },
                        },
                    ]}
                    data={distribution.map((d) => ({
                        month: d.month,
                        regionSameTypeCount: d.regionSameTypeCount,
                        regionCount: d.regionCount,
                        nationalCount: d.nationalCount,
                        sameTypeFestivalNames: d.sameTypeFestivalNames,
                        target: d.month === targetMonth,
                        recommended: d.month === recommendedMonth,
                    }))}
                    rowKey="month"
                    striped
                    bordered
                />
            ) : (
                <div>
                    <div className="slim-bar-chart">
                        <MayoBarChart
                            data={barData}
                            series={[
                                { key: `${regionLabel} ${typeLabel}`, color: SERIES_COLOR, label: `${regionLabel} ${typeLabel}` },
                            ]}
                            height={220}
                            showGrid
                        />
                    </div>

                    {/* 범례 */}
                    <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs" style={{ color: "var(--mayo-text-muted)" }}>
                        {targetMonth && (
                            <span className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: SERIES_COLOR }} />
                                희망 개최월 ({targetMonth}월)
                            </span>
                        )}
                        {recommendedMonth && (
                            <span className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: RECOMMENDED_COLOR }} />
                                추천 개최월 ({recommendedMonth}월)
                            </span>
                        )}
                    </div>
                </div>
            )}
        </MayoCard>
    );
}
