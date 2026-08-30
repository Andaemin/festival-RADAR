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

/**
 * 포화도에 셀 축제를 "최근 몇 개 연도에 등장한 것"으로 제한하는 창의 크기.
 *
 * 코퍼스는 2017~2026 누적 3,582건이라, 창이 없으면 **2017년에 한 번 나오고 사라진 축제까지
 * 현재의 경쟁자로 센다.** 실측(서울/문화예술/10월): 62건 중 16건이 2017~2019년에만
 * 등장하고 그 뒤 8년간 원장에 없다. 그런데 화면 문구는 "이미 62건 있습니다"라는 현재형이다.
 *
 * 창을 3개년으로 잡은 이유는 **원장에 결번이 흔하기 때문**이다. 2회 이상 등장한 축제의
 * 27.9%가 등장 연도 사이에 구멍을 갖는다(화천산천어축제 2020~2022 결번, 광주비엔날레는
 * 격년제). 1~2개년으로 좁히면 한 해 쉰 축제와 격년제 축제를 "없어졌다"고 잘못 판단한다.
 * 3개년이면 격년 한 주기와 한 해 결번을 모두 흡수한다.
 *
 * 임계값 6건/3건은 코퍼스가 단일 연도(1,266건)였을 때 정해진 값이다. 창별 HIGH 판정률
 * 실측은 이렇다 - 창 없음 18.9% / 4개년 11.5% / **3개년 8.7%** / 2개년 7.1% / 단일 연도 4.5%.
 * 3개년이 임계값이 원래 겨냥한 분포에 가장 가깝다.
 *
 * **이 창은 포화도와 월별 분포에만 적용한다.** 화이트스페이스와 코호트 건수는
 * "이런 형태가 성립하는가"를 묻는 것이라 오래된 사례도 근거로 유효하다.
 */
export const ACTIVE_WINDOW_YEARS = 3;

/**
 * 포화도에 셀 축제의 하한 연도. 코퍼스에서 직접 도출한다.
 *
 * 데이터셋 최신 연도를 인자로 받지 않고 레코드에서 구하는 이유는, 이 값이 코퍼스와
 * 어긋나면 창이 조용히 빗나가기 때문이다(예: 2027년 데이터를 넣었는데 상수는 2026).
 */
export function activeSinceYear(all: PlannerRecord[]): number {
    let latest = 0;
    for (const r of all) if (r.lastSeenYear > latest) latest = r.lastSeenYear;
    return latest - (ACTIVE_WINDOW_YEARS - 1);
}

/**
 * 전국 축제의 이 비율 미만이 열리는 달은 추천 후보에서 제외한다.
 *
 * 실측(2017~2026 코퍼스 3,485건): 1월 1.2% · 2월 1.3% · 10월 27.3%.
 * 1·2월이 비어 있는 것은 기회가 아니라 **전국이 피하는 달**이라는 신호다.
 * 3%로 두면 1·2월만 걸러지고 11월(3.8%)·12월(4.0%)은 남는다
 * (12월은 빛축제·크리스마스 계열이 실제로 성립하는 달이다).
 */
const MIN_NATIONAL_SHARE = 0.03;

export function buildMonthDistribution(
    all: PlannerRecord[],
    region: Region,
    festivalType: FestivalType,
    /** 이 연도 이후에 원장에 등장한 축제만 센다. activeSinceYear()로 구한다. */
    activeSince: number
): MonthDistributionEntry[] {
    const entries: MonthDistributionEntry[] = [];
    const live = all.filter((r) => r.lastSeenYear >= activeSince);

    for (let month = 1; month <= 12; month++) {
        const inMonth = live.filter((r) => r.startMonth === month);
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
    month: number,
    /** 문구에 집계 범위를 밝히는 데 쓴다. buildMonthDistribution에 넘긴 값과 같아야 한다. */
    activeSince: number
): SaturationWarning | null {
    const entry = distribution.find((d) => d.month === month);
    if (!entry) return null;

    const { regionCount, regionSameTypeCount } = entry;

    // 집계 범위를 문장에 박아 둔다. "이미 N건 있습니다"라고만 쓰면 10년 누적을
    // 기획연도의 경쟁 상황으로 읽게 된다.
    const scope = `최근 ${ACTIVE_WINDOW_YEARS}개 연도(${activeSince}~${activeSince + ACTIVE_WINDOW_YEARS - 1}년) 기준`;

    let level: SaturationWarning["level"];
    let message: string;

    if (regionSameTypeCount >= HIGH_THRESHOLD) {
        level = "HIGH";
        message = `${scope} ${month}월에 같은 지역·같은 유형 축제가 ${regionSameTypeCount}건 열렸습니다. 관객이 직접 겹치므로 시기를 옮기거나 소재를 확실히 차별화해야 합니다.`;
    } else if (regionSameTypeCount >= MEDIUM_THRESHOLD) {
        level = "MEDIUM";
        message = `${scope} ${month}월에 같은 지역·같은 유형 축제가 ${regionSameTypeCount}건 열렸습니다. 개최일이 겹치지 않는지 확인하세요.`;
    } else {
        level = "LOW";
        message = `${scope} ${month}월은 같은 지역·같은 유형 축제가 ${regionSameTypeCount}건으로 비교적 여유롭습니다.`;
    }

    return { month, competingCount: regionCount, sameTypeCompetingCount: regionSameTypeCount, level, message };
}

/** 후보 월 1건. 전국 계절성과 견준 상대 지표를 함께 담는다. */
export interface MonthOpportunity extends MonthDistributionEntry {
    /** 전국 축제 중 이 달이 차지하는 비중 (0~1) */
    nationalShare: number;
    /** 이 지역·유형이 전국 계절성을 그대로 따랐다면 이 달에 있었을 건수 */
    expectedCount: number;
    /** 실제 - 기대. 음수일수록 이 지역이 전국 대비 덜 하고 있다는 뜻 */
    surplus: number;
}

/**
 * 개최를 검토할 만한 달을 고른다.
 *
 * **절대 건수가 아니라 전국 계절성 대비 상대값으로 판단한다.**
 * 예전에는 `regionSameTypeCount`가 가장 작은 달을 골랐는데, 그러면 1·2월이 거의 항상
 * 이긴다. 지역에 0건이니까. 하지만 1월은 전국에서도 1.2%뿐이라 "우리 지역만 비어 있는
 * 기회"가 아니라 "다들 피하는 달"이다. 실측 결과 85개 조합 중 41개(48%)가 한겨울
 * 또는 한여름을 추천하고 있었다.
 *
 * 그래서 전국 분포로 기대치를 만들고, 기대보다 얼마나 적은지(surplus)로 줄을 세운다.
 *   기대치  = 지역 동일유형 총건수 x (그 달의 전국 비중)
 *   surplus = 실제 - 기대치        (음수가 클수록 덜 하고 있다 = 기회)
 *
 * 전국 비중이 MIN_NATIONAL_SHARE 미만인 달은 애초에 후보에서 뺀다.
 */
export function findLeastSaturatedMonths(
    distribution: MonthDistributionEntry[],
    limit = 3
): MonthOpportunity[] {
    const nationalTotal = distribution.reduce((sum, d) => sum + d.nationalCount, 0);
    const regionSameTypeTotal = distribution.reduce((sum, d) => sum + d.regionSameTypeCount, 0);
    if (nationalTotal === 0) return [];

    return distribution
        .map((d) => {
            const nationalShare = d.nationalCount / nationalTotal;
            const expectedCount = regionSameTypeTotal * nationalShare;
            return {
                ...d,
                nationalShare,
                expectedCount,
                surplus: d.regionSameTypeCount - expectedCount,
            };
        })
        .filter((d) => d.nationalShare >= MIN_NATIONAL_SHARE)
        // 기대보다 많이 모자란 달이 먼저. 같으면 전국에서 더 활발한 달을 택한다.
        .sort((a, b) => a.surplus - b.surplus || b.nationalCount - a.nationalCount)
        .slice(0, limit);
}
