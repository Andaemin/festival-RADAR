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
 * 색이 뜻을 갖는 건 **추천 월 하나뿐**이다(초록). 희망 개최월은 사용자가 이미 아는
 * 값이라 색으로 강조할 이유가 없어 테두리로만 표시한다 - 예전에는 빨강으로 칠했는데
 * 한산한 달을 골라도 위험 신호처럼 읽혔다.
 *
 * 남은 색 대비는 파랑 대 초록이라 적록색맹에서도 갈린다(문제가 되는 조합은 녹/적이다).
 * 그래도 색만으로 의미를 전달하지 않도록 범례에 월 숫자를 함께 적는다.
 */

const SERIES = "#2a78d6";
/** 추천 개최월. 채움색으로 표시하는 유일한 의미색이다. */
const RECOMMENDED = "#1f9d55";
/**
 * 희망 개최월 테두리. 막대와 같은 파랑이지만 outlineOffset으로 사이를 띄우기 때문에
 * 고리 모양으로 분명히 보인다 - 검정 테두리는 너무 무겁게 읽혔다.
 */
const TARGET_OUTLINE = SERIES;

/** 툴팁에 적을 축제명 개수. 차트를 다 덮지 않도록 표(전체 목록)보다 짧게 끊는다. */
const TOOLTIP_NAME_LIMIT = 5;

interface Props {
    distribution: MonthDistributionEntry[];
    /** 사용자가 희망한 개최월. 테두리 + 라벨로 표시된다(포화 여부는 별도 경보 카드가 알린다). */
    targetMonth: number | null;
    /** 엔진이 추천한 한산한 월. 초록 채움 + 라벨로 표시된다. */
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
                막대는 같은 지역·같은 유형 축제 건수입니다. 막대에 마우스를 올리면 전국 건수와 실제 경쟁 축제명을 볼 수 있습니다.
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
                                // 한 달 최대 43건이라 한 줄로 두면 표가 옆으로 늘어난다. 줄바꿈시킨다.
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

                            {hoveredEntry.sameTypeFestivalNames.length > 0 && (
                                <div
                                    className="mt-1.5 pt-1.5 max-w-[220px]"
                                    style={{ borderTop: "1px solid var(--mayo-border)" }}
                                >
                                    {hoveredEntry.sameTypeFestivalNames
                                        .slice(0, TOOLTIP_NAME_LIMIT)
                                        .map((name) => (
                                            <div key={name} className="truncate">
                                                · {name}
                                            </div>
                                        ))}
                                    {hoveredEntry.regionSameTypeCount > TOOLTIP_NAME_LIMIT && (
                                        <div style={{ color: "var(--mayo-text-muted)" }}>
                                            외 {hoveredEntry.regionSameTypeCount - TOOLTIP_NAME_LIMIT}건 — 자세히는 &lsquo;표로 보기&rsquo;
                                        </div>
                                    )}
                                </div>
                            )}
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
                                        // 칸을 꽉 채우지 않고 살짝 줄여 막대 사이가 벌어져 보이게 한다.
                                        // 칸(flex-1) 자체는 그대로라 아래 월 라벨과 중심이 어긋나지 않는다.
                                        className="w-[94%] rounded-t"
                                        style={{
                                            height: `${Math.max(heightPct, d.regionSameTypeCount > 0 ? 4 : 1)}%`,
                                            minHeight: 2,
                                            background: isRecommended ? RECOMMENDED : SERIES,
                                            opacity: d.regionSameTypeCount === 0 ? 0.25 : 1,
                                            outline: isTarget ? `2px solid ${TARGET_OUTLINE}` : undefined,
                                            outlineOffset: isTarget ? 2 : undefined,
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
                                <span
                                    className="w-3 h-3 rounded-sm inline-block"
                                    style={{ background: SERIES, outline: `2px solid ${TARGET_OUTLINE}`, outlineOffset: 1 }}
                                />
                                희망 개최월 ({targetMonth}월)
                            </span>
                        )}
                        {recommendedMonth && (
                            <span className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: RECOMMENDED }} />
                                추천 개최월 ({recommendedMonth}월)
                            </span>
                        )}
                    </div>
                </div>
            )}
        </MayoCard>
    );
}
