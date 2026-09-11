"use client";

import { useState } from "react";
import { MayoCard, MayoTag } from "mayoui-react";
import type { WhitespaceGridCell, WhitespaceReport } from "@/lib/planner/types";

const HIGH = "#25b366";
const INVERT_AT = 0.55;
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function oneDecimal(value: number): string {
    return value.toFixed(1);
}

interface Props {
    whitespace: WhitespaceReport;
    venueType: string;
    targetMonth: number | null;
    datasetYearRange: [number, number];
    regionLabel: string;
    typeLabel: string;
}

export default function WhitespaceGrid({
    whitespace,
    venueType,
    targetMonth,
    datasetYearRange,
    regionLabel,
    typeLabel,
}: Props) {
    const { venueMonthGrid: grid, venueMonthCoverage: coverage } = whitespace;
    const [hovered, setHovered] = useState<WhitespaceGridCell | null>(null);

    if (grid.length === 0) return null;

    const venues = [...new Set(grid.map((c) => c.venueType))];
    const scored = grid.filter((c) => c.opportunityScore !== null);
    const best = scored.reduce<WhitespaceGridCell | null>(
        (acc, c) => (acc === null || (c.opportunityScore ?? 0) > (acc.opportunityScore ?? 0) ? c : acc),
        null
    );

    const expectedOf = (cell: WhitespaceGridCell): number =>
        coverage.national === 0 ? 0 : coverage.region * (cell.nationalCount / coverage.national);

    const verdictOf = (cell: WhitespaceGridCell): string => {
        if (cell.opportunityScore === null) return "전국 사례 3건 미만 — 점수 산정 불가";
        if (cell.opportunityScore >= 0.5) return "기대보다 크게 적음 — 빈 자리";
        if (cell.opportunityScore > 0) return "기대보다 조금 적음";
        return "이미 충분히 열리고 있음";
    };

    return (
        <MayoCard variant="outlined" padding="md" style={{ overflow: "visible" }}>
            <h2 className="text-base font-bold mb-1" style={{ color: "var(--mayo-text)" }}>
                화이트스페이스 지도 — 장소 × 시기
            </h2>
            <p className="text-xs mb-3" style={{ color: "var(--mayo-text-muted)" }}>
                {regionLabel} {typeLabel} · {datasetYearRange[0]}~{datasetYearRange[1]}년 ·
                전국 {coverage.national}건 중 {regionLabel} {coverage.region}건
            </p>

            {/* 히트맵 그리드 */}
            <div className="relative overflow-visible">
                {/* 툴팁 — 테이블 위에 떠야 하므로 z-50 */}
                {hovered && (
                    <div
                        className="absolute z-50 rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none whitespace-nowrap"
                        style={{
                            background: "var(--mayo-bg-muted)",
                            color: "var(--mayo-text)",
                            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                            top: -8,
                            left: "50%",
                            transform: "translateX(-50%) translateY(-100%)",
                        }}
                    >
                        <div className="font-bold">
                            {hovered.venueLabel} × {hovered.month}월
                            {hovered.opportunityScore !== null && (
                                <span style={{ color: HIGH }}> · 기회점수 {Math.round(hovered.opportunityScore * 100)}</span>
                            )}
                        </div>
                        <div style={{ color: "var(--mayo-text-muted)" }}>
                            전국 {hovered.nationalCount}건 · {regionLabel} {hovered.regionCount}건 (기대 {oneDecimal(expectedOf(hovered))}건) · {verdictOf(hovered)}
                        </div>
                    </div>
                )}

                <table className="mx-auto" style={{ borderSpacing: 3, borderCollapse: "separate" }}>
                    <thead>
                        <tr>
                            <th style={{ width: 56 }} />
                            {MONTHS.map((m) => {
                                const lit = m === targetMonth || hovered?.month === m;
                                return (
                                    <th
                                        key={m}
                                        className={`text-[11px] pb-1 text-center ${lit ? "font-bold" : "font-normal"}`}
                                        style={{ color: lit ? "var(--mayo-text)" : "var(--mayo-text-muted)", width: 30 }}
                                    >
                                        {m}월
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {venues.map((v) => {
                            const row = grid.filter((c) => c.venueType === v);
                            const isPickedRow = v === venueType;
                            const lit = isPickedRow || hovered?.venueType === v;
                            return (
                                <tr key={v}>
                                    <th
                                        className={`text-[11px] text-right pr-1.5 whitespace-nowrap ${lit ? "font-bold" : "font-normal"}`}
                                        style={{ color: lit ? "var(--mayo-text)" : "var(--mayo-text-muted)" }}
                                    >
                                        {row[0].venueLabel}
                                    </th>
                                    {row.map((c) => {
                                        const score = c.opportunityScore;
                                        const isPicked = isPickedRow && c.month === targetMonth;
                                        const isHovered = hovered?.venueType === c.venueType && hovered?.month === c.month;
                                        return (
                                            <td
                                                key={c.month}
                                                className="text-[11px] text-center rounded cursor-default"
                                                onMouseEnter={() => setHovered(c)}
                                                onMouseLeave={() => setHovered(null)}
                                                style={{
                                                    height: 28,
                                                    padding: "0 2px",
                                                    background: score === null
                                                        ? "var(--mayo-bg-subtle)"
                                                        : `rgba(37, 179, 102, ${(0.06 + score * 0.9).toFixed(3)})`,
                                                    color: score === null
                                                        ? "var(--mayo-text-muted)"
                                                        : score >= INVERT_AT ? "#fff" : "var(--mayo-text)",
                                                    outline: isHovered
                                                        ? "2px solid var(--mayo-text)"
                                                        : isPicked
                                                            ? `2px solid ${HIGH}`
                                                            : undefined,
                                                    outlineOffset: isHovered || isPicked ? 1 : undefined,
                                                    opacity: hovered === null || isHovered ? 1 : 0.4,
                                                    transition: "opacity 120ms",
                                                    fontWeight: score !== null && score >= 0.5 ? 600 : 400,
                                                }}
                                            >
                                                {score === null ? "–" : Math.round(score * 100)}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* 범례 */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs" style={{ color: "var(--mayo-text-muted)" }}>
                <span className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded-sm inline-block" style={{ background: "rgba(37,179,102,0.1)" }} />
                    포화
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded-sm inline-block" style={{ background: "rgba(37,179,102,0.96)" }} />
                    빈 자리
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded-sm inline-block" style={{ background: "var(--mayo-bg-subtle)" }} />
                    근거 부족
                </span>
                {targetMonth !== null && (
                    <span className="flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 rounded-sm inline-block" style={{ outline: `2px solid ${HIGH}`, outlineOffset: -2 }} />
                        내 계획
                    </span>
                )}
            </div>

            {/* 최고 기회 칸 안내 */}
            {best && best.opportunityScore !== null && (
                <div className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--mayo-bg-subtle)" }}>
                    <span style={{ color: "var(--mayo-text)" }}>
                        가장 비어 있는 조합: </span>
                    <MayoTag color="green" variant="solid" size="sm">{best.venueLabel} × {best.month}월</MayoTag>
                    <span className="ml-1" style={{ color: "var(--mayo-text-muted)" }}>
                        — 전국 {best.nationalCount}건 중 {regionLabel} {best.regionCount}건 (기대 {oneDecimal(expectedOf(best))}건)
                    </span>
                </div>
            )}
        </MayoCard>
    );
}
