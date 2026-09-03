"use client";

import { useState } from "react";
import { MayoCard, MayoBtn, MayoTable } from "mayoui-react";
import type { MonthDistributionEntry } from "@/lib/planner/types";

/**
 * 월별 경쟁 분포 막대차트.
 *
 * 한 축·한 계열만 쓴다. 전국 건수는 지역 건수와 자릿수가 달라 두 번째 축을 만들면
 * 왜곡되므로 막대로 그리지 않고 툴팁에만 담는다.
 *
 * 색은 두 가지뿐이다(파랑 계열색 + 빨강 경고색). 추천 월은 세 번째 색을 쓰지 않고
 * 테두리와 글자 라벨로 표시한다 - 적록색맹에서 녹/적 구분이 무너지기 때문이다.
 */

const SERIES = "#2a78d6";
const CRITICAL = "#d03b3b";

interface Props {
    distribution: MonthDistributionEntry[];
    /** 사용자가 희망한 개최월. 혼잡하면 빨강으로 표시된다. */
    targetMonth: number | null;
    /** 엔진이 추천한 한산한 월. 테두리 + 라벨로 표시된다. */
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
    const [hovered, setHovered] = useState<number | null>(null);
    const [showTable, setShowTable] = useState(false);

    const max = Math.max(1, ...distribution.map((d) => d.regionSameTypeCount));
    const hoveredEntry = distribution.find((d) => d.month === hovered) ?? null;

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
            <p className="text-xs mb-5" style={{ color: "var(--mayo-text-muted)" }}>
                막대는 같은 지역·같은 유형 축제 건수입니다. 막대에 마우스를 올리면 전국 건수도 볼 수 있습니다.
            </p>

            {showTable ? (
                <MayoTable
                    columns={[
                        { key: "month", label: "월", width: 100, render: (_v: unknown, row: Record<string, unknown>) => `${row.month}월${row.target ? " (희망)" : ""}${row.recommended ? " (추천)" : ""}` },
                        { key: "regionSameTypeCount", label: `${regionLabel} 동일유형`, sortable: true },
                        { key: "regionCount", label: `${regionLabel} 전체`, sortable: true },
                        { key: "nationalCount", label: "전국 전체", sortable: true },
                    ]}
                    data={distribution.map((d) => ({
                        month: d.month,
                        regionSameTypeCount: d.regionSameTypeCount,
                        regionCount: d.regionCount,
                        nationalCount: d.nationalCount,
                        target: d.month === targetMonth,
                        recommended: d.month === recommendedMonth,
                    }))}
                    rowKey="month"
                    striped
                    bordered
                />
            ) : (
                <div className="relative">
                    {hoveredEntry && (
                        <div
                            className="absolute -top-2 left-1/2 -translate-x-1/2 z-10 rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none"
                            style={{ background: "var(--mayo-bg-muted)", color: "var(--mayo-text)", boxShadow: "var(--mayo-shadow-md)" }}
                        >
                            <div className="font-bold mb-1">{hoveredEntry.month}월</div>
                            <div>
                                {regionLabel} {typeLabel}: {hoveredEntry.regionSameTypeCount}건
                            </div>
                            <div>
                                {regionLabel} 전체: {hoveredEntry.regionCount}건
                            </div>
                            <div>전국 전체: {hoveredEntry.nationalCount}건</div>
                        </div>
                    )}

                    <div className="flex items-end gap-[2px] h-44 pt-6" style={{ borderBottom: "1px solid var(--mayo-border)" }}>
                        {distribution.map((d) => {
                            const isTarget = d.month === targetMonth;
                            const isRecommended = d.month === recommendedMonth;
                            const heightPct = (d.regionSameTypeCount / max) * 100;

                            return (
                                <div
                                    key={d.month}
                                    className="flex-1 flex flex-col justify-end items-center h-full relative"
                                    onMouseEnter={() => setHovered(d.month)}
                                    onMouseLeave={() => setHovered(null)}
                                >
                                    {d.regionSameTypeCount > 0 && (
                                        <span
                                            className="text-[10px] font-medium mb-1"
                                            style={{ color: "var(--mayo-text-muted)" }}
                                        >
                                            {d.regionSameTypeCount}
                                        </span>
                                    )}
                                    <div
                                        className="w-full rounded-t"
                                        style={{
                                            height: `${Math.max(heightPct, d.regionSameTypeCount > 0 ? 4 : 1)}%`,
                                            minHeight: 2,
                                            background: isTarget ? CRITICAL : SERIES,
                                            opacity: d.regionSameTypeCount === 0 ? 0.25 : 1,
                                            outline: isRecommended ? `2px solid ${SERIES}` : undefined,
                                            outlineOffset: isRecommended ? 2 : undefined,
                                        }}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    <div className="flex gap-[2px] mt-2">
                        {distribution.map((d) => (
                            <div
                                key={d.month}
                                className="flex-1 text-center text-[10px]"
                                style={{ color: "var(--mayo-text-muted)" }}
                            >
                                {d.month}
                            </div>
                        ))}
                    </div>

                    {/* 색만으로 의미를 전달하지 않도록 라벨을 함께 둔다. */}
                    <div className="flex flex-wrap gap-x-5 gap-y-1 mt-4 text-xs" style={{ color: "var(--mayo-text-muted)" }}>
                        {targetMonth && (
                            <span className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: CRITICAL }} />
                                희망 개최월 ({targetMonth}월)
                            </span>
                        )}
                        {recommendedMonth && (
                            <span className="flex items-center gap-1.5">
                                <span
                                    className="w-3 h-3 rounded-sm inline-block"
                                    style={{ background: SERIES, outline: `2px solid ${SERIES}`, outlineOffset: 1 }}
                                />
                                추천 개최월 ({recommendedMonth}월)
                            </span>
                        )}
                    </div>
                </div>
            )}
        </MayoCard>
    );
}
