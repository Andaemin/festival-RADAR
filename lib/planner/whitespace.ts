import { VENUE_TYPE_DISPLAY, VenueType } from "@/lib/domain/enums";
import { PlannerRecord, WhitespaceAxisEntry, WhitespaceReport } from "./types";

/**
 * 화이트스페이스 분석.
 *
 * 핵심 정의: **전국에서는 충분히 검증됐는데 우리 지역 동일 유형에는 없거나 드문 선택지**가
 * 차별화 기회다. 전국 사례가 있으니 "성립 가능성"은 이미 입증됐고, 지역에 없으니 "새롭다".
 *
 * 반대로 지역에 몰려 있는 선택지는 레드오션이므로 점수가 낮게 나온다.
 * LLM 추측이 아니라 결합분포 집계라서 근거 수치를 그대로 화면에 제시할 수 있다.
 */

/** 전국 사례가 이 건수 미만이면 "검증됐다"고 보지 않는다. */
const MIN_NATIONAL_SUPPORT = 3;

/** 전국 사례가 이 건수를 넘으면 근거량 점수는 더 오르지 않는다. */
const SUPPORT_SATURATION = 12;

export const DURATION_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
    { key: "1-2", label: "1~2일 (주말 집중형)", min: 1, max: 2 },
    { key: "3-4", label: "3~4일 (연휴형)", min: 3, max: 4 },
    { key: "5-7", label: "5~7일 (주간형)", min: 5, max: 7 },
    { key: "8-14", label: "8~14일 (장기형)", min: 8, max: 14 },
    { key: "15+", label: "15일 이상 (시즌형)", min: 15, max: Number.MAX_SAFE_INTEGER },
];

export function durationBucketOf(days: number | null): string | null {
    if (days === null || days < 1) return null;
    return DURATION_BUCKETS.find((b) => days >= b.min && days <= b.max)?.key ?? null;
}

/**
 * 축 하나에 대해 기회 점수를 계산한다.
 *
 * @param nationalValues 전국 동일 유형 코호트에서 각 레코드가 갖는 값(복수 가능)
 * @param regionValues   지역 동일 유형 코호트에서 각 레코드가 갖는 값
 * @param labelOf        코드 → 표시 이름
 */
function scoreAxis(
    nationalValues: string[][],
    regionValues: string[][],
    labelOf: (value: string) => string
): WhitespaceAxisEntry[] {
    const nationalCounts = new Map<string, number>();
    for (const values of nationalValues) {
        for (const v of new Set(values)) nationalCounts.set(v, (nationalCounts.get(v) ?? 0) + 1);
    }

    const regionCounts = new Map<string, number>();
    for (const values of regionValues) {
        for (const v of new Set(values)) regionCounts.set(v, (regionCounts.get(v) ?? 0) + 1);
    }

    // 지역 코호트가 0건이면 나눗셈이 무의미하다. 이때는 전국 근거량만으로 순위를 매긴다.
    const regionTotal = Math.max(1, regionValues.length);

    const entries: WhitespaceAxisEntry[] = [];
    for (const [value, nationalCount] of nationalCounts) {
        if (nationalCount < MIN_NATIONAL_SUPPORT) continue;

        const regionCount = regionCounts.get(value) ?? 0;
        const support = Math.min(1, nationalCount / SUPPORT_SATURATION);
        const novelty = 1 - Math.min(1, regionCount / regionTotal);

        entries.push({
            value,
            label: labelOf(value),
            nationalCount,
            regionCount,
            opportunityScore: Number((support * novelty).toFixed(4)),
        });
    }

    return entries.sort(
        (a, b) => b.opportunityScore - a.opportunityScore || b.nationalCount - a.nationalCount
    );
}

export interface WhitespaceInput {
    /** 전국 동일 유형 */
    national: PlannerRecord[];
    /** 해당 지역 동일 유형 */
    region: PlannerRecord[];
}

export function analyzeWhitespace({ national, region }: WhitespaceInput): WhitespaceReport {
    // 장소: UNDECIDED("미정")는 기획 선택지가 아니므로 제외한다.
    const venueOf = (r: PlannerRecord): string[] =>
        r.venueType && r.venueType !== VenueType.UNDECIDED ? [r.venueType] : [];

    const monthOf = (r: PlannerRecord): string[] =>
        r.startMonth !== null ? [String(r.startMonth)] : [];

    const durationOf = (r: PlannerRecord): string[] => {
        const bucket = durationBucketOf(r.durationDays);
        return bucket ? [bucket] : [];
    };

    const keywordOf = (r: PlannerRecord): string[] => r.keywords;

    return {
        venue: scoreAxis(
            national.map(venueOf),
            region.map(venueOf),
            (v) => VENUE_TYPE_DISPLAY[v as VenueType] ?? v
        ),
        month: scoreAxis(national.map(monthOf), region.map(monthOf), (m) => `${m}월`),
        durationBucket: scoreAxis(
            national.map(durationOf),
            region.map(durationOf),
            (k) => DURATION_BUCKETS.find((b) => b.key === k)?.label ?? k
        ),
        keyword: scoreAxis(national.map(keywordOf), region.map(keywordOf), (k) => k),
    };
}
