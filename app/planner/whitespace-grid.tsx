"use client";

import { useState } from "react";
import { MayoCard } from "mayoui-react";
import type { WhitespaceGridCell, WhitespaceReport } from "@/lib/planner/types";

/**
 * 장소 x 시기 화이트스페이스 격자.
 *
 * 축별 표는 "10월이 기회"까지만 말한다. 격자는 "10월에 어디서"까지 짚어준다 -
 * 기획서에 바로 옮겨 적을 수 있는 단위가 여기서 처음 나온다.
 *
 * 색은 초록 한 계열의 농도만 쓴다. 점수가 연속값이라 색을 여러 개 쓰면 경계가
 * 생기지 않는 곳에 경계가 생긴 것처럼 보인다. 농도만으로는 읽기 어려우므로
 * 칸마다 점수를 숫자로 함께 적는다 - 흑백 인쇄에서도 값이 남는다.
 *
 * 툴팁은 month-chart와 같은 방식이다(위쪽 고정 위치 + pointer-events-none).
 * 칸마다 띄우면 격자를 가로로 스크롤할 때 잘리고, 가장자리 칸에서 카드 밖으로 넘친다.
 */

const HIGH = "#25b366";

/** 이 점수 이상이면 글자를 흰색으로 뒤집는다. 배경이 진해져 검정 글씨가 묻힌다. */
const INVERT_AT = 0.55;

/** 이 점수 이상을 "빈 자리"라고 부른다. 기대치의 절반도 안 채워졌다는 뜻이다. */
const OPPORTUNITY_AT = 0.5;

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** 소수 한 자리까지만. "기대 1.9건"이 "기대 1.9411건"보다 읽힌다. */
function oneDecimal(value: number): string {
    return value.toFixed(1);
}

interface Props {
    whitespace: WhitespaceReport;
    /** 사용자가 고른 장소 유형. 해당 행과 칸을 표시한다. */
    venueType: string;
    /** 사용자가 고른 희망 개최월. 없으면 null. */
    targetMonth: number | null;
    /** 코퍼스가 포괄하는 연도 [최소, 최대]. 집계 조건 문구에 그대로 적는다. */
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

    /** 이 칸에 지역이 "몇 건쯤 있었어야 하는가". 점수 공식이 쓰는 기대치와 같다. */
    const expectedOf = (cell: WhitespaceGridCell): number =>
        coverage.national === 0 ? 0 : coverage.region * (cell.nationalCount / coverage.national);

    const verdictOf = (cell: WhitespaceGridCell): string => {
        if (cell.opportunityScore === null) return "전국 사례가 3건 미만이라 점수를 매기지 않습니다.";
        if (cell.opportunityScore >= OPPORTUNITY_AT) return "기대보다 크게 적습니다 — 빈 자리입니다.";
        if (cell.opportunityScore > 0) return "기대보다 조금 적습니다.";
        return "기대만큼 이미 열리고 있습니다 — 차별화가 어렵습니다.";
    };

    return (
        <MayoCard variant="outlined" padding="md">
            <h2 className="text-base font-bold mb-1" style={{ color: "var(--mayo-text)" }}>
                화이트스페이스 지도 — 장소 × 시기
            </h2>
            <p className="text-xs mb-3" style={{ color: "var(--mayo-text-muted)" }}>
                전국에는 사례가 있는데 {regionLabel} {typeLabel}에는 없는 조합일수록 진합니다. 숫자는 0~100
                기회점수이며, 칸에 마우스를 올리면 근거 수치가 나옵니다.
            </p>

            {/* 어떤 축제를 세고 있는지 화면에서 바로 확인되게 한다 - 표본이 코호트보다 작은 이유까지. */}
            <div
                className="text-[11px] rounded px-2.5 py-2 flex flex-col gap-0.5"
                style={{ background: "var(--mayo-bg-subtle)", color: "var(--mayo-text-muted)" }}
            >
                <div>
                    <strong style={{ color: "var(--mayo-text-secondary)" }}>집계 조건</strong>{" "}
                    {datasetYearRange[0]}~{datasetYearRange[1]}년 · {typeLabel} · 개최 장소와 시기가 모두 기록된
                    축제만
                </div>
                <div>
                    <strong style={{ color: "var(--mayo-text-secondary)" }}>표본</strong> 전국 {coverage.national}건
                    · {regionLabel} {coverage.region}건
                </div>
                <div>장소 유형은 최근 연도 원장에만 있는 항목이라 그 이전 축제는 빠집니다.</div>
            </div>

            <div className="relative pt-12">
                {hovered && (
                    <div
                        className="absolute top-0 left-1/2 -translate-x-1/2 z-10 rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none whitespace-nowrap"
                        style={{
                            background: "var(--mayo-bg-muted)",
                            color: "var(--mayo-text)",
                            boxShadow: "var(--mayo-shadow-md)",
                        }}
                    >
                        <div className="font-bold mb-1">
                            {hovered.venueLabel} × {hovered.month}월
                            {hovered.opportunityScore !== null && (
                                <span style={{ color: HIGH }}>
                                    {" · "}
                                    기회점수 {Math.round(hovered.opportunityScore * 100)}
                                </span>
                            )}
                        </div>
                        <div>전국 {hovered.nationalCount}건</div>
                        <div>
                            {regionLabel} {typeLabel}: {hovered.regionCount}건
                            <span style={{ color: "var(--mayo-text-muted)" }}>
                                {" "}
                                (기대 {oneDecimal(expectedOf(hovered))}건)
                            </span>
                        </div>
                        <div
                            className="mt-1.5 pt-1.5"
                            style={{
                                borderTop: "1px solid var(--mayo-border)",
                                color: "var(--mayo-text-secondary)",
                            }}
                        >
                            {verdictOf(hovered)}
                        </div>
                    </div>
                )}

                <div className="overflow-x-auto">
                    <table className="border-separate" style={{ borderSpacing: 3, minWidth: 460 }}>
                        <thead>
                            <tr>
                                <th />
                                {MONTHS.map((m) => {
                                    const lit = m === targetMonth || hovered?.month === m;
                                    return (
                                        <th
                                            key={m}
                                            className={`text-[10px] pb-1 ${lit ? "font-bold" : "font-medium"}`}
                                            style={{
                                                color: lit ? "var(--mayo-text)" : "var(--mayo-text-muted)",
                                                width: 30,
                                            }}
                                        >
                                            {m}
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
                                            className={`text-[11px] text-right pr-2 whitespace-nowrap ${lit ? "font-bold" : "font-medium"}`}
                                            style={{ color: lit ? "var(--mayo-text)" : "var(--mayo-text-muted)" }}
                                        >
                                            {row[0].venueLabel}
                                        </th>
                                        {row.map((c) => {
                                            const score = c.opportunityScore;
                                            const isPicked = isPickedRow && c.month === targetMonth;
                                            const isHovered =
                                                hovered?.venueType === c.venueType && hovered?.month === c.month;
                                            return (
                                                <td
                                                    key={c.month}
                                                    className="text-[10px] text-center rounded cursor-default"
                                                    onMouseEnter={() => setHovered(c)}
                                                    onMouseLeave={() => setHovered(null)}
                                                    style={{
                                                        height: 26,
                                                        background:
                                                            score === null
                                                                ? "var(--mayo-bg-subtle)"
                                                                : `rgba(37, 179, 102, ${(0.06 + score * 0.9).toFixed(3)})`,
                                                        color:
                                                            score === null
                                                                ? "var(--mayo-text-muted)"
                                                                : score >= INVERT_AT
                                                                  ? "#fff"
                                                                  : "var(--mayo-text)",
                                                        // 선택한 칸은 항상, 마우스가 올라간 칸은 그 순간만 테두리를 준다.
                                                        outline: isHovered
                                                            ? "2px solid var(--mayo-text)"
                                                            : isPicked
                                                              ? `2px solid ${HIGH}`
                                                              : undefined,
                                                        outlineOffset: isHovered || isPicked ? 1 : undefined,
                                                        // 나머지를 흐리게 해 지금 읽고 있는 칸이 어디인지 분명히 한다.
                                                        opacity: hovered === null || isHovered ? 1 : 0.4,
                                                        transition: "opacity 120ms",
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
            </div>

            <div
                className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-4 text-xs"
                style={{ color: "var(--mayo-text-muted)" }}
            >
                <span className="flex items-center gap-1.5">
                    <span
                        className="w-3 h-3 rounded-sm inline-block"
                        style={{ background: "rgba(37,179,102,0.1)" }}
                    />
                    이미 포화
                </span>
                <span className="flex items-center gap-1.5">
                    <span
                        className="w-3 h-3 rounded-sm inline-block"
                        style={{ background: "rgba(37,179,102,0.96)" }}
                    />
                    빈 자리
                </span>
                <span className="flex items-center gap-1.5">
                    <span
                        className="w-3 h-3 rounded-sm inline-block"
                        style={{ background: "var(--mayo-bg-subtle)" }}
                    />
                    – 근거 부족(전국 3건 미만)
                </span>
                {targetMonth !== null && (
                    <span className="flex items-center gap-1.5">
                        <span
                            className="w-3 h-3 rounded-sm inline-block"
                            style={{ outline: `2px solid ${HIGH}`, outlineOffset: -2 }}
                        />
                        내 계획 ({targetMonth}월)
                    </span>
                )}
            </div>

            {best && best.opportunityScore !== null && (
                <p className="text-sm mt-3" style={{ color: "var(--mayo-text-secondary)" }}>
                    가장 비어 있는 조합은{" "}
                    <strong>
                        {best.venueLabel} × {best.month}월
                    </strong>
                    입니다 — 전국 {best.nationalCount}건이 이미 성립했지만 {regionLabel} {typeLabel}에는{" "}
                    {best.regionCount}건뿐입니다 (기대 {oneDecimal(expectedOf(best))}건).
                </p>
            )}
        </MayoCard>
    );
}
