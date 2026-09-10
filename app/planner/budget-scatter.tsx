"use client";

import { useState } from "react";
import { MayoCard } from "mayoui-react";
import type { BudgetEfficiencySummary, BudgetScatterPoint } from "@/lib/planner/types";

/**
 * 예산-방문객 포지셔닝 맵.
 *
 * "1인당 투입비 9,539원"이라는 한 줄로는 그 값이 후한지 빠듯한지 알 수 없다.
 * 같은 코호트를 흩뿌려 놓으면 중앙값이 분포의 어디쯤인지, 우리 계획이 어느
 * 쪽에 서게 되는지가 한눈에 보인다.
 *
 * **두 축 모두 로그다.** 예산은 500만원부터 수십억까지 3자릿수 넘게 벌어져
 * 선형 축에서는 점의 90%가 왼쪽 끝에 뭉친다. 로그로 두면 1인당 투입비가 같은
 * 축제들이 직선 위에 놓여, 중앙값선이 곧은 대각선이 된다.
 *
 * 툴팁은 month-chart와 같은 모양이되 위치만 점을 따라간다 - 점이 흩어져 있어
 * 고정 위치에 띄우면 어느 점을 말하는지 알 수 없다.
 */

const POINT = "#2a78d6";
const MEDIAN_LINE = "#25b366";

const W = 420;
const H = 260;
const PAD = { top: 14, right: 14, bottom: 30, left: 46 };

/** 점이 이보다 적으면 분포라고 부를 수 없어 카드를 통째로 숨긴다. */
const MIN_POINTS = 8;

/** 원 단위를 축 눈금용으로 줄인다. */
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

/** 10의 거듭제곱 눈금만 쓴다. 로그축에서 간격이 일정해 읽기 쉽다. */
function powerTicks(min: number, max: number): number[] {
    const ticks: number[] = [];
    for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
        const v = 10 ** e;
        if (v >= min && v <= max) ticks.push(v);
    }
    return ticks;
}

function krwFull(value: number): string {
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억원`;
    if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만원`;
    return `${value.toLocaleString("ko-KR")}원`;
}

interface Props {
    budgetEfficiency: BudgetEfficiencySummary;
    /** 코퍼스가 포괄하는 연도 [최소, 최대]. 집계 조건 문구에 그대로 적는다. */
    datasetYearRange: [number, number];
    /** 지역 동일유형 축제 수. 전국으로 갈아탄 이유를 설명하는 데만 쓴다. */
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

    /** 1인당 투입비가 c원으로 일정한 축제들이 놓이는 선(visitors = budget / c). */
    const cpvLine = (c: number) => {
        const clamp = (v: number) => Math.min(yMax, Math.max(yMin, v));
        return { x1: lx(xMin), y1: ly(clamp(xMin / c)), x2: lx(xMax), y2: ly(clamp(xMax / c)) };
    };

    const mid = cpvLine(median);

    /** 중앙값 대비 몇 % 저렴한가. 음수면 더 비싸다. */
    const gapPct = hovered === null ? 0 : Math.round(((median - hovered.costPerVisitorKrw) / median) * 100);

    return (
        <MayoCard variant="outlined" padding="md">
            <h2 className="text-base font-bold mb-1" style={{ color: "var(--mayo-text)" }}>
                예산 · 방문객 포지셔닝
            </h2>
            <p className="text-xs mb-3" style={{ color: "var(--mayo-text-muted)" }}>
                점 하나가 축제 하나입니다. 초록선 위쪽은 같은 예산으로 더 많이 모은 축제이며, 점에 마우스를
                올리면 축제명이 나옵니다.
            </p>

            {/* 지역 표본이 얇으면 엔진이 전국으로 갈아탄다. 그 사실을 반드시 밝힌다. */}
            <div
                className="text-[11px] rounded px-2.5 py-2 mb-4 flex flex-col gap-0.5"
                style={{ background: "var(--mayo-bg-subtle)", color: "var(--mayo-text-muted)" }}
            >
                <div>
                    <strong style={{ color: "var(--mayo-text-secondary)" }}>집계 조건</strong>{" "}
                    {datasetYearRange[0]}~{datasetYearRange[1]}년 · {typeLabel} · 예산과 방문객이 모두 기록된
                    축제만(방문객 1,000명 이상)
                </div>
                <div>
                    <strong style={{ color: "var(--mayo-text-secondary)" }}>표본</strong>{" "}
                    {cohortScope === "REGION" ? `${regionLabel} ${typeLabel}` : `전국 ${typeLabel}`} {sampleCount}건
                    {scatter.length < sampleCount ? ` 중 ${scatter.length}건 표시` : ""}
                </div>
                {cohortScope === "NATIONAL" && (
                    <div style={{ color: "var(--mayo-text-secondary)" }}>
                        {regionLabel}에는 {typeLabel} 축제가 {regionSameTypeCount}건뿐이라 전국 기준으로 비교합니다.
                    </div>
                )}
            </div>

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
                            // 점 위쪽에 띄우되, 위가 좁으면 아래로 뒤집는다.
                            transform:
                                ly(hovered.visitors) < H * 0.42
                                    ? "translate(-50%, 12px)"
                                    : "translate(-50%, calc(-100% - 12px))",
                        }}
                    >
                        <div className="font-bold mb-1">{hovered.festivalName}</div>
                        <div>예산 {krwFull(hovered.totalBudgetKrw)}</div>
                        <div>방문객 {hovered.visitors.toLocaleString("ko-KR")}명</div>
                        <div
                            className="mt-1.5 pt-1.5"
                            style={{ borderTop: "1px solid var(--mayo-border)" }}
                        >
                            1인당 {hovered.costPerVisitorKrw.toLocaleString("ko-KR")}원
                            <span style={{ color: "var(--mayo-text-muted)" }}>
                                {" "}
                                · 중앙값보다 {Math.abs(gapPct)}% {gapPct >= 0 ? "낮음" : "높음"}
                            </span>
                        </div>
                    </div>
                )}

                <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="예산 대비 방문객 분포">
                    {powerTicks(yMin, yMax).map((t) => (
                        <g key={`y${t}`}>
                            <line
                                x1={PAD.left}
                                y1={ly(t)}
                                x2={W - PAD.right}
                                y2={ly(t)}
                                stroke="var(--mayo-border)"
                                strokeWidth={1}
                            />
                            <text
                                x={PAD.left - 6}
                                y={ly(t) + 3}
                                textAnchor="end"
                                fontSize={9}
                                fill="var(--mayo-text-muted)"
                            >
                                {personTick(t)}
                            </text>
                        </g>
                    ))}
                    {powerTicks(xMin, xMax).map((t) => (
                        <text
                            key={`x${t}`}
                            x={lx(t)}
                            y={H - PAD.bottom + 13}
                            textAnchor="middle"
                            fontSize={9}
                            fill="var(--mayo-text-muted)"
                        >
                            {krwTick(t)}
                        </text>
                    ))}

                    {[p25, p75].map((c) =>
                        c === null ? null : (
                            <line
                                key={c}
                                {...cpvLine(c)}
                                stroke={MEDIAN_LINE}
                                strokeWidth={1}
                                strokeDasharray="3 3"
                                opacity={0.45}
                            />
                        )
                    )}
                    <line x1={mid.x1} y1={mid.y1} x2={mid.x2} y2={mid.y2} stroke={MEDIAN_LINE} strokeWidth={1.5} />

                    {scatter.map((p) => {
                        const isHovered = hovered === p;
                        return (
                            <circle
                                key={`${p.festivalName}-${p.totalBudgetKrw}-${p.visitors}`}
                                cx={lx(p.totalBudgetKrw)}
                                cy={ly(p.visitors)}
                                r={isHovered ? 5 : 2.6}
                                fill={POINT}
                                stroke={isHovered ? "var(--mayo-surface)" : "none"}
                                strokeWidth={isHovered ? 1.5 : 0}
                                opacity={hovered === null ? 0.55 : isHovered ? 1 : 0.18}
                                style={{ transition: "opacity 120ms" }}
                            />
                        );
                    })}

                    {/* 점이 작아 그대로는 잡기 어렵다. 보이지 않는 넓은 원을 겹쳐 판정만 맡긴다. */}
                    {scatter.map((p) => (
                        <circle
                            key={`hit-${p.festivalName}-${p.totalBudgetKrw}-${p.visitors}`}
                            cx={lx(p.totalBudgetKrw)}
                            cy={ly(p.visitors)}
                            r={7}
                            fill="transparent"
                            onMouseEnter={() => setHovered(p)}
                            onMouseLeave={() => setHovered(null)}
                        />
                    ))}

                    <text x={W - PAD.right} y={H - 3} textAnchor="end" fontSize={9} fill="var(--mayo-text-muted)">
                        총예산 →
                    </text>
                    <text x={2} y={PAD.top - 4} fontSize={9} fill="var(--mayo-text-muted)">
                        방문객 ↑
                    </text>
                </svg>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs" style={{ color: "var(--mayo-text-muted)" }}>
                <span className="flex items-center gap-1.5">
                    <svg width="18" height="6" aria-hidden>
                        <line x1="0" y1="3" x2="18" y2="3" stroke={MEDIAN_LINE} strokeWidth="1.5" />
                    </svg>
                    1인당 {median.toLocaleString("ko-KR")}원 (중앙값)
                </span>
                {p25 !== null && p75 !== null && (
                    <span className="flex items-center gap-1.5">
                        <svg width="18" height="6" aria-hidden>
                            <line
                                x1="0"
                                y1="3"
                                x2="18"
                                y2="3"
                                stroke={MEDIAN_LINE}
                                strokeWidth="1"
                                strokeDasharray="3 3"
                                opacity="0.45"
                            />
                        </svg>
                        하위 25% {p25.toLocaleString("ko-KR")}원 · 상위 25% {p75.toLocaleString("ko-KR")}원
                    </span>
                )}
            </div>
        </MayoCard>
    );
}
