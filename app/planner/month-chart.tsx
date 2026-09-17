"use client";

import { useId, useState, type MouseEvent } from "react";
import { MayoCard, MayoBtn, MayoTable, MayoBarChart } from "mayoui-react";
import type { MonthDistributionEntry } from "@/lib/planner/types";

/**
 * 월별 경쟁 분포 막대차트.
 *
 * 색이 뜻을 갖는 건 **추천 월 하나뿐**이다(초록). 희망 개최월은 사용자가 이미 아는
 * 값이라 새 색을 쓰지 않고 같은 색 빗금으로만 구분한다(추천월과 겹치면 초록 빗금).
 *
 * MayoBarChart는 시리즈 단위 색만 받고 막대별 색을 지정할 수 없다. 대신 렌더 구조가
 * 고정돼 있어 CSS로 덮어쓴다: svg 안에서 데이터 `<g>`가 마지막 N개이고, 각 `<g>`의 첫
 * rect(`.mayo-bar-chart__bar`)가 막대다. 그리드 `<g>` 개수에 기대지 않도록 뒤에서부터 센다.
 *
 * 빗금은 컴포넌트 안의 0×0 숨김 svg에 `<pattern>`으로 정의하고 `fill: url(#id)`로 참조한다.
 * 같은 문서 안이면 다른 svg 요소에서도 참조가 된다.
 *
 * 호버 툴팁의 색 점은 라이브러리가 시리즈 색을 inline style로 박는다. 어느 달을 호버 중인지는
 * 툴팁 마크업만 봐서는 알 수 없으므로 래퍼에서 mouseover를 가로채 달을 알아내고, 래퍼 클래스로
 * 점의 배경을 `!important`로 덮어쓴다(HTML 요소라 빗금은 repeating-linear-gradient로 그린다).
 */

const SERIES_COLOR = "#2a78d6";
/** 추천 개최월. 채움색으로 표시하는 유일한 의미색이다. */
const RECOMMENDED_COLOR = "#25b366";
const TOOLTIP_NAME_LIMIT = 5;
/** 빗금 한 주기(px). 줄 굵기는 이 값의 절반이다. */
const HATCH_SIZE = 6;

function barSelector(scope: string, indexFromEnd: number) {
    return `.${scope} .mayo-chart svg > g:nth-last-of-type(${indexFromEnd}) > .mayo-bar-chart__bar`;
}

/**
 * HatchPattern과 같은 모양의 CSS 빗금. 툴팁 점처럼 HTML 요소에 쓴다.
 * 8px 원 안에 들어가야 하므로 주기는 막대(HATCH_SIZE)보다 좁게 잡는다.
 */
function hatchGradient(color: string) {
    const size = 3;
    return `repeating-linear-gradient(-45deg, ${color} 0 ${size / 2}px, color-mix(in srgb, ${color} 22%, transparent) ${size / 2}px ${size}px)`;
}

type HoverKind = "target" | "recommended" | "both";

/** 호버 중인 달에 맞춰 툴팁 색 점을 막대와 같은 모양으로 맞춘다. */
function tooltipDotCss(scope: string) {
    const dot = (kind: HoverKind) => `.${scope}.hover-${kind} .mayo-chart-tooltip__dot`;
    return [
        `${dot("target")}{background:${hatchGradient(SERIES_COLOR)} !important;}`,
        `${dot("recommended")}{background:${RECOMMENDED_COLOR} !important;}`,
        `${dot("both")}{background:${hatchGradient(RECOMMENDED_COLOR)} !important;}`,
    ].join(" ");
}

/** 45° 빗금 패턴. 줄은 `color`, 줄 사이는 같은 색을 옅게 깔아 빈 막대처럼 안 보이게 한다. */
function HatchPattern({ id, color }: { id: string; color: string }) {
    return (
        <pattern id={id} patternUnits="userSpaceOnUse" width={HATCH_SIZE} height={HATCH_SIZE} patternTransform="rotate(45)">
            <rect width={HATCH_SIZE} height={HATCH_SIZE} fill={color} opacity={0.22} />
            <rect width={HATCH_SIZE / 2} height={HATCH_SIZE} fill={color} />
        </pattern>
    );
}

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
    const [hoverKind, setHoverKind] = useState<HoverKind | null>(null);
    // useId는 ':'를 포함해 클래스명·url(#) 참조에 못 쓰므로 걸러낸다.
    const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const scope = `month-chart-${uid}`;
    const hatchBlueId = `${scope}-hatch-blue`;
    const hatchGreenId = `${scope}-hatch-green`;

    const highlightCss = distribution
        .flatMap((d, i) => {
            const isTarget = d.month === targetMonth;
            const isRecommended = d.month === recommendedMonth;
            if (!isTarget && !isRecommended) return [];
            const fill = isTarget
                ? `url(#${isRecommended ? hatchGreenId : hatchBlueId})`
                : RECOMMENDED_COLOR;
            return [`${barSelector(scope, distribution.length - i)}{fill:${fill};}`];
        })
        .concat(tooltipDotCss(scope))
        .join(" ");

    function kindOf(month: number): HoverKind | null {
        const isTarget = month === targetMonth;
        const isRecommended = month === recommendedMonth;
        if (isTarget && isRecommended) return "both";
        if (isTarget) return "target";
        if (isRecommended) return "recommended";
        return null;
    }

    // 라이브러리와 같은 규칙으로 호버 달을 찾는다: 데이터 <g>는 svg의 마지막 N개.
    // 그리드 <g> 위에서는 라이브러리도 이전 호버를 유지하므로 여기서도 건드리지 않는다.
    function handleMouseOver(e: MouseEvent<HTMLDivElement>) {
        const g = (e.target as Element).closest("svg > g");
        if (!g?.parentElement) return;
        const groups = Array.from(g.parentElement.children).filter((el) => el.tagName === "g");
        const indexFromEnd = groups.length - groups.indexOf(g);
        if (indexFromEnd < 1 || indexFromEnd > distribution.length) return;
        setHoverKind(kindOf(distribution[distribution.length - indexFromEnd].month));
    }

    const barData = distribution.map((d) => {
        let label = `${d.month}월`;
        if (d.month === targetMonth) label += "\n희망";
        else if (d.month === recommendedMonth) label += "\n추천";
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
                <div
                    className={`${scope}${hoverKind ? ` hover-${hoverKind}` : ""}`}
                    onMouseOver={handleMouseOver}
                    onMouseLeave={() => setHoverKind(null)}
                >
                    <style>{highlightCss}</style>
                    <svg width={0} height={0} aria-hidden style={{ position: "absolute" }}>
                        <defs>
                            <HatchPattern id={hatchBlueId} color={SERIES_COLOR} />
                            <HatchPattern id={hatchGreenId} color={RECOMMENDED_COLOR} />
                        </defs>
                    </svg>
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

                    {/* 범례 — 색만으로 의미를 전달하지 않도록 월 숫자를 함께 적는다. */}
                    <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs" style={{ color: "var(--mayo-text-muted)" }}>
                        {targetMonth && (
                            <span className="flex items-center gap-1.5">
                                <svg width={12} height={12} className="inline-block rounded-sm">
                                    <rect width={12} height={12} rx={2} fill={`url(#${hatchBlueId})`} />
                                </svg>
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
