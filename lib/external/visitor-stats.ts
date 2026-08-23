import { REGION_DISPLAY, Region } from "@/lib/domain/enums";

/**
 * 한국관광공사 관광 빅데이터 — 광역 지자체 일자별 방문자 수.
 *
 * KT(내국인)·SKT(외국인) 이동통신 기반 실측치다. 우리 DB의 `previousVisitors`는
 * 지자체 자체 추산이라 집계 방식이 제각각인데, 이 데이터는 동일 방법론으로 전국을
 * 재기 때문에 **지역 간 비교**에 쓸 수 있다.
 *
 * 기획에서 쓰는 핵심 지표는 **외지인 비율**이다. 축제로 외부 관광객을 끌어오려는
 * 기획인지, 지역 주민 대상 기획인지가 이 숫자에서 갈린다.
 *
 * 엔드포인트 (2026-08-23 실측 확인):
 *   https://apis.data.go.kr/B551011/DataLabService/metcoRegnVisitrDDList
 *   필수: startYmd, endYmd (YYYYMMDD). 지역 필터 파라미터는 없고 전국이 함께 온다.
 *   응답: areaCode(행정표준코드) / touDivCd 1=현지인 2=외지인 3=외국인 / touNum
 *
 * 인증키는 TourAPI와 같은 것을 쓴다(같은 포털 계정).
 */

const BASE_URL = "https://apis.data.go.kr/B551011/DataLabService/metcoRegnVisitrDDList";

/** Region -> 행정표준코드. TourAPI의 areaCode와 다른 체계다. 2026-08-23 실측 검증. */
const AREA_CODE: Record<Region, string> = {
    [Region.SEOUL]: "11",
    [Region.BUSAN]: "26",
    [Region.DAEGU]: "27",
    [Region.INCHEON]: "28",
    [Region.GWANGJU]: "29",
    [Region.DAEJEON]: "30",
    [Region.ULSAN]: "31",
    [Region.SEJONG]: "36",
    [Region.GYEONGGI]: "41",
    [Region.CHUNGBUK]: "43",
    [Region.CHUNGNAM]: "44",
    [Region.JEONNAM]: "46",
    [Region.GYEONGBUK]: "47",
    [Region.GYEONGNAM]: "48",
    [Region.JEJU]: "50",
    [Region.GANGWON]: "51",
    [Region.JEONBUK]: "52",
};

const TOU_LOCAL = "1";
const TOU_OUTSIDER = "2";
const TOU_FOREIGNER = "3";

export interface VisitorProfile {
    year: number;
    month: number;
    regionLabel: string;
    localVisitors: number;
    outsiderVisitors: number;
    foreignVisitors: number;
    totalVisitors: number;
    /** (외지인 + 외국인) / 전체. 관광 유입력의 대리 지표. */
    outsiderRatio: number;
    /** 전국 동월 평균 외지인 비율 */
    nationalOutsiderRatio: number;
    /** 외지인 비율 순위 (1위 = 가장 높음, 17개 시도 중) */
    outsiderRatioRank: number;
}

export function isVisitorStatsEnabled(): boolean {
    return !!process.env.TOUR_API_SERVICE_KEY;
}

/** 월 단위 집계는 바뀌지 않으므로 프로세스 메모리에 캐시한다. */
const globalForVisitor = globalThis as unknown as {
    visitorStats?: Map<string, VisitorProfile[]>;
};

function cache(): Map<string, VisitorProfile[]> {
    globalForVisitor.visitorStats ??= new Map();
    return globalForVisitor.visitorStats;
}

interface RawRow {
    areaCode: string;
    touDivCd: string;
    touNum: string;
}

function lastDayOfMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

/**
 * 해당 연월의 광역 지자체별 방문자 프로필을 계산한다.
 *
 * 하루 51행(17개 시도 × 3개 구분)이라 한 달이면 최대 1,600행 정도다.
 * numOfRows를 넉넉히 잡아 한 번에 받는다.
 */
export async function fetchMonthlyVisitorProfiles(year: number, month: number): Promise<VisitorProfile[]> {
    const key = `${year}-${month}`;
    const cached = cache().get(key);
    if (cached) return cached;

    const mm = String(month).padStart(2, "0");
    const url = new URL(BASE_URL);
    url.searchParams.set("serviceKey", process.env.TOUR_API_SERVICE_KEY ?? "");
    url.searchParams.set("MobileOS", "ETC");
    url.searchParams.set("MobileApp", "festival-radar");
    url.searchParams.set("_type", "json");
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "2000");
    url.searchParams.set("startYmd", `${year}${mm}01`);
    url.searchParams.set("endYmd", `${year}${mm}${String(lastDayOfMonth(year, month)).padStart(2, "0")}`);

    const res = await fetch(url.toString(), { next: { revalidate: 60 * 60 * 24 * 30 } });
    const text = await res.text();

    if (text.trimStart().startsWith("<") || text.includes("OpenAPI_ServiceResponse")) {
        const msg = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(text)?.[1] ?? text.slice(0, 160);
        throw new Error(`방문자수 API: ${msg}`);
    }

    const json = JSON.parse(text);
    if (json?.resultCode && json.resultCode !== "0000") {
        throw new Error(`방문자수 API: ${json.resultMsg ?? json.resultCode}`);
    }

    const raw = json?.response?.body?.items?.item;
    const rows: RawRow[] = !raw ? [] : Array.isArray(raw) ? raw : [raw];
    if (rows.length === 0) return [];

    // areaCode -> 구분별 합계
    const sums = new Map<string, { local: number; outsider: number; foreigner: number }>();
    for (const r of rows) {
        const n = Number(r.touNum);
        if (!Number.isFinite(n)) continue;
        const acc = sums.get(r.areaCode) ?? { local: 0, outsider: 0, foreigner: 0 };
        if (r.touDivCd === TOU_LOCAL) acc.local += n;
        else if (r.touDivCd === TOU_OUTSIDER) acc.outsider += n;
        else if (r.touDivCd === TOU_FOREIGNER) acc.foreigner += n;
        sums.set(r.areaCode, acc);
    }

    const codeToRegion = new Map(Object.entries(AREA_CODE).map(([r, c]) => [c, r as Region]));

    const partial = [...sums.entries()]
        .map(([code, s]) => {
            const region = codeToRegion.get(code);
            if (!region) return null;
            const total = s.local + s.outsider + s.foreigner;
            return {
                region,
                regionLabel: REGION_DISPLAY[region],
                localVisitors: Math.round(s.local),
                outsiderVisitors: Math.round(s.outsider),
                foreignVisitors: Math.round(s.foreigner),
                totalVisitors: Math.round(total),
                outsiderRatio: total > 0 ? (s.outsider + s.foreigner) / total : 0,
            };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

    // 전국 평균은 지역 평균이 아니라 전체 합 기준으로 낸다(대도시 가중 반영).
    const grandTotal = partial.reduce((a, p) => a + p.totalVisitors, 0);
    const grandOutsider = partial.reduce((a, p) => a + p.outsiderVisitors + p.foreignVisitors, 0);
    const nationalOutsiderRatio = grandTotal > 0 ? grandOutsider / grandTotal : 0;

    const ranked = [...partial].sort((a, b) => b.outsiderRatio - a.outsiderRatio);

    const profiles: VisitorProfile[] = partial.map((p) => ({
        year,
        month,
        regionLabel: p.regionLabel,
        localVisitors: p.localVisitors,
        outsiderVisitors: p.outsiderVisitors,
        foreignVisitors: p.foreignVisitors,
        totalVisitors: p.totalVisitors,
        outsiderRatio: Number(p.outsiderRatio.toFixed(4)),
        nationalOutsiderRatio: Number(nationalOutsiderRatio.toFixed(4)),
        outsiderRatioRank: ranked.findIndex((r) => r.region === p.region) + 1,
    }));

    // region으로 되찾을 수 있게 라벨 순이 아닌 원래 순서를 유지한 채 캐시한다.
    cache().set(key, profiles);
    return profiles;
}

/** 특정 지역의 프로필만 뽑는다. */
export async function fetchRegionVisitorProfile(
    region: Region,
    year: number,
    month: number
): Promise<VisitorProfile | null> {
    const all = await fetchMonthlyVisitorProfiles(year, month);
    return all.find((p) => p.regionLabel === REGION_DISPLAY[region]) ?? null;
}
