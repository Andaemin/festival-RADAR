import { PlannerRecord } from "./types";

/**
 * 소재 키워드의 "제철"을 코퍼스에서 직접 계산한다.
 *
 * 배경: 추천 엔진은 시기 카드(TIMING_SHIFT)와 소재 카드(KEYWORD_MASHUP)를 서로
 * 모른 채 만든다. 그래서 "6월 개최 추천"과 "크리스마스 소재 추천"이 한 응답에
 * 함께 나가고, LLM이 둘을 이어 붙이면 "6월에 크리스마스 축제"가 된다.
 * (2026-08-25 전수 시뮬레이션: 매시업 카드 85개 중 32개가 이 충돌 상태였다.)
 *
 * 해결에 외부 데이터는 필요 없다. **그 소재를 쓰는 축제들이 실제로 몇 월에
 * 열리는지** 세면 제철이 나온다. 실측 예:
 *   벚꽃 41건 -> 3월 9 / 4월 32          => 100%가 3~4월. 계절 소재
 *   크리스마스 10건 -> 11월 1 / 12월 9    => 100%가 11~12월. 계절 소재
 *   거리 15건 -> 3~11월에 고루 분포        => 계절 무관
 *
 * 판정은 **원형 3개월 창**으로 한다. 12월과 1월이 이어지는 소재(곶감, 눈꽃)를
 * 끊지 않기 위해서다.
 */

/** 이 미만이면 분포를 신뢰할 수 없다. 표본이 적으면 "계절 무관"으로 두고 거르지 않는다. */
const MIN_SAMPLE = 4;

/** 3개월 창에 이 비율 이상 몰려 있어야 계절 소재로 본다. */
const CONCENTRATION = 0.7;

/** 제철 판정에 쓰는 연속 개월 수. */
const WINDOW_SIZE = 3;

export interface KeywordSeason {
    /** 제철로 판정된 연속 개월 (1~12). 원형이라 [12, 1, 2]처럼 해를 넘길 수 있다. */
    months: number[];
    /** 제철 창에 속한 비율 */
    share: number;
    /** 판정에 쓴 축제 건수 */
    sampleSize: number;
}

/** month(1~12)에서 시작하는 WINDOW_SIZE개월 창. 12월을 넘으면 1월로 돌아온다. */
function windowFrom(month: number): number[] {
    return Array.from({ length: WINDOW_SIZE }, (_, i) => ((month - 1 + i) % 12) + 1);
}

/**
 * 코퍼스 전체에서 키워드별 제철 사전을 만든다.
 *
 * 계절 소재로 판정된 것만 담는다. 사전에 없는 키워드는 "계절 무관 또는 판정 불가"이며,
 * 호출부는 이를 **거르지 않는다**(모른다고 막으면 과잉 차단이 된다).
 */
export function buildKeywordSeasonality(records: PlannerRecord[]): Map<string, KeywordSeason> {
    const monthsByKeyword = new Map<string, number[]>();
    for (const r of records) {
        if (r.startMonth === null) continue;
        for (const k of r.keywords) {
            const arr = monthsByKeyword.get(k);
            if (arr) arr.push(r.startMonth);
            else monthsByKeyword.set(k, [r.startMonth]);
        }
    }

    const seasonality = new Map<string, KeywordSeason>();
    for (const [keyword, months] of monthsByKeyword) {
        if (months.length < MIN_SAMPLE) continue;

        const counts = new Array(13).fill(0) as number[];
        for (const m of months) counts[m] += 1;

        let bestCount = 0;
        let bestStart = 1;
        for (let start = 1; start <= 12; start += 1) {
            const total = windowFrom(start).reduce((sum, m) => sum + counts[m], 0);
            if (total > bestCount) {
                bestCount = total;
                bestStart = start;
            }
        }

        const share = bestCount / months.length;
        if (share < CONCENTRATION) continue;

        seasonality.set(keyword, {
            months: windowFrom(bestStart),
            share: Number(share.toFixed(3)),
            sampleSize: months.length,
        });
    }
    return seasonality;
}

/**
 * 해당 개월에 이 소재를 쓸 수 있는지.
 * 제철을 모르는 소재는 항상 통과시킨다.
 */
export function fitsMonth(
    seasonality: Map<string, KeywordSeason>,
    keyword: string,
    month: number | null
): boolean {
    if (month === null) return true;
    const season = seasonality.get(keyword);
    return !season || season.months.includes(month);
}

/** 카드 근거로 붙일 한 줄. 계절 소재가 아니면 null. */
export function describeSeason(
    seasonality: Map<string, KeywordSeason>,
    keyword: string
): string | null {
    const season = seasonality.get(keyword);
    if (!season) return null;
    return (
        `"${keyword}" 축제 ${season.sampleSize}건 중 ${Math.round(season.share * 100)}%가 ` +
        `${season.months.join("·")}월에 열립니다. 개최 시기를 이 범위 밖으로 잡으면 소재가 성립하지 않습니다.`
    );
}
