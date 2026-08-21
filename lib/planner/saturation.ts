import { FestivalType, Region } from "@/lib/domain/enums";
import { MonthDistributionEntry, PlannerRecord, SaturationWarning } from "./types";

/**
 * 시기·지역 포화도.
 *
 * 같은 달·같은 광역자치단체에 이미 몇 개의 축제가 열리는지 센다. 같은 유형이면 관객이
 * 직접 겹치므로 따로 집계한다. 기획자 입장에서 "10월 경북 국화축제는 이미 6건"이라는
 * 정보가 예산 추정치보다 먼저 필요하다.
 */

/** 동일 유형 경쟁 건수 임계값. */
const HIGH_THRESHOLD = 6;
const MEDIUM_THRESHOLD = 3;

export function buildMonthDistribution(
    all: PlannerRecord[],
    region: Region,
    festivalType: FestivalType
): MonthDistributionEntry[] {
    const entries: MonthDistributionEntry[] = [];

    for (let month = 1; month <= 12; month++) {
        const inMonth = all.filter((r) => r.startMonth === month);
        entries.push({
            month,
            nationalCount: inMonth.length,
            regionCount: inMonth.filter((r) => r.region === region).length,
            regionSameTypeCount: inMonth.filter(
                (r) => r.region === region && r.festivalType === festivalType
            ).length,
        });
    }

    return entries;
}

export function evaluateSaturation(
    distribution: MonthDistributionEntry[],
    month: number
): SaturationWarning | null {
    const entry = distribution.find((d) => d.month === month);
    if (!entry) return null;

    const { regionCount, regionSameTypeCount } = entry;

    let level: SaturationWarning["level"];
    let message: string;

    if (regionSameTypeCount >= HIGH_THRESHOLD) {
        level = "HIGH";
        message = `${month}월에 같은 지역·같은 유형 축제가 이미 ${regionSameTypeCount}건 있습니다. 관객이 직접 겹치므로 시기를 옮기거나 소재를 확실히 차별화해야 합니다.`;
    } else if (regionSameTypeCount >= MEDIUM_THRESHOLD) {
        level = "MEDIUM";
        message = `${month}월에 같은 지역·같은 유형 축제가 ${regionSameTypeCount}건 있습니다. 개최일이 겹치지 않는지 확인하세요.`;
    } else {
        level = "LOW";
        message = `${month}월은 같은 지역·같은 유형 축제가 ${regionSameTypeCount}건으로 비교적 여유롭습니다.`;
    }

    return { month, competingCount: regionCount, sameTypeCompetingCount: regionSameTypeCount, level, message };
}

/**
 * 같은 지역 동일 유형 기준으로 가장 한산한 달을 고른다.
 * 전국적으로 아예 개최 사례가 없는 달(한겨울 등)은 후보에서 뺀다 - 데이터가 없는 게 아니라
 * 그 시기에 축제를 여는 것 자체가 비현실적이라는 신호일 수 있기 때문이다.
 */
export function findLeastSaturatedMonths(
    distribution: MonthDistributionEntry[],
    limit = 3
): MonthDistributionEntry[] {
    return [...distribution]
        .filter((d) => d.nationalCount > 0)
        .sort((a, b) => a.regionSameTypeCount - b.regionSameTypeCount || b.nationalCount - a.nationalCount)
        .slice(0, limit);
}
