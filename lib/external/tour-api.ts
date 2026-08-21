/**
 * 한국관광공사 TourAPI 4.0 (국문 관광정보 서비스) 클라이언트.
 *
 * 문체부 개최계획 데이터에는 축제 "내용"이 없다. TourAPI의 상세정보(detailIntro)와
 * 소개정보(detailCommon)에는 세부 프로그램(program)과 개요(overview) 텍스트가 있어,
 * 추천 근거 축제에 실제 기획 내용을 붙일 수 있다.
 *
 * ⚠️ 엔드포인트 경로와 오퍼레이션 이름은 공공데이터포털의 서비스 상세 페이지 기준으로
 *    확인이 필요하다. TourAPI 4.0은 KorService2를 쓰지만, 신청한 서비스에 따라 경로가
 *    다를 수 있어 TOUR_API_BASE_URL로 덮어쓸 수 있게 해 두었다.
 *
 * 필요한 환경변수:
 *   TOUR_API_SERVICE_KEY  공공데이터포털 발급 인증키(Decoding 키)
 *   TOUR_API_BASE_URL     (선택) 기본값 https://apis.data.go.kr/B551011/KorService2
 */

import { Region } from "@/lib/domain/enums";

const DEFAULT_BASE_URL = "https://apis.data.go.kr/B551011/KorService2";

/** 축제/공연/행사 콘텐츠 타입 ID */
const CONTENT_TYPE_FESTIVAL = 15;

/**
 * 우리 Region enum → TourAPI areaCode.
 * ⚠️ TourAPI 고유 번호 체계라 실제 코드 목록(areaCode2 오퍼레이션)과 대조해 검증할 것.
 */
const AREA_CODE: Record<Region, number> = {
    [Region.SEOUL]: 1,
    [Region.INCHEON]: 2,
    [Region.DAEJEON]: 3,
    [Region.DAEGU]: 4,
    [Region.GWANGJU]: 5,
    [Region.BUSAN]: 6,
    [Region.ULSAN]: 7,
    [Region.SEJONG]: 8,
    [Region.GYEONGGI]: 31,
    [Region.GANGWON]: 32,
    [Region.CHUNGBUK]: 33,
    [Region.CHUNGNAM]: 34,
    [Region.GYEONGBUK]: 35,
    [Region.GYEONGNAM]: 36,
    [Region.JEONBUK]: 37,
    [Region.JEONNAM]: 38,
    [Region.JEJU]: 39,
};

export interface TourApiFestivalSummary {
    contentId: string;
    title: string;
    address: string | null;
    eventStartDate: string | null;
    eventEndDate: string | null;
    imageUrl: string | null;
}

export interface TourApiFestivalDetail extends TourApiFestivalSummary {
    /** 세부 프로그램 - 추천 엔진이 가장 원하는 필드 */
    program: string | null;
    /** 축제 개요 서술 */
    overview: string | null;
    eventPlace: string | null;
    sponsor: string | null;
    useTimeFestival: string | null;
    ageLimit: string | null;
    playTime: string | null;
}

export function isTourApiEnabled(): boolean {
    return !!process.env.TOUR_API_SERVICE_KEY;
}

function baseUrl(): string {
    return process.env.TOUR_API_BASE_URL || DEFAULT_BASE_URL;
}

function buildUrl(operation: string, params: Record<string, string | number>): string {
    const url = new URL(`${baseUrl()}/${operation}`);
    // serviceKey는 이미 URL 인코딩된 키가 들어올 수 있어 searchParams로 넣으면 이중 인코딩된다.
    // URLSearchParams가 한 번만 인코딩하도록 디코딩 키를 넣는 것을 전제로 한다.
    url.searchParams.set("serviceKey", process.env.TOUR_API_SERVICE_KEY ?? "");
    url.searchParams.set("MobileOS", "ETC");
    url.searchParams.set("MobileApp", "festival-radar");
    url.searchParams.set("_type", "json");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    return url.toString();
}

/** data.go.kr은 오류 시 JSON이 아니라 XML을 돌려주는 일이 잦다. 그 경우를 구분해 던진다. */
async function callTourApi(operation: string, params: Record<string, string | number>): Promise<unknown[]> {
    const res = await fetch(buildUrl(operation, params), {
        // 축제 데이터는 자주 바뀌지 않으므로 하루 캐시.
        next: { revalidate: 86400 },
    });

    const text = await res.text();

    // 인증키 오류·트래픽 초과는 XML 또는 OpenAPI_ServiceResponse JSON으로 오고, 스키마가
    // 정상 응답과 완전히 다르다. 사용자에게 보일 메시지만 뽑아 짧게 던진다.
    if (text.trimStart().startsWith("<")) {
        const msg = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(text)?.[1] ?? text.slice(0, 200);
        throw new Error(`TourAPI ${operation}: ${msg}`);
    }
    if (text.includes("OpenAPI_ServiceResponse")) {
        const header = JSON.parse(text)?.OpenAPI_ServiceResponse?.cmmMsgHeader ?? {};
        const msg = header.returnAuthMsg ?? header.errMsg ?? "알 수 없는 오류";
        throw new Error(`TourAPI ${operation}: ${msg} (코드 ${header.returnReasonCode ?? "?"})`);
    }
    if (!res.ok) {
        throw new Error(`TourAPI ${operation} HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = JSON.parse(text);
    const header = json?.response?.header;
    if (header && header.resultCode !== "0000") {
        throw new Error(`TourAPI ${operation} resultCode=${header.resultCode} ${header.resultMsg ?? ""}`);
    }

    const items = json?.response?.body?.items;
    // 결과가 0건이면 items가 빈 문자열로 오는 경우가 있다.
    if (!items || typeof items === "string") return [];
    const item = items.item;
    if (!item) return [];
    return Array.isArray(item) ? item : [item];
}

function str(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    return s.length > 0 ? s : null;
}

/** 지역·기간으로 축제 목록을 조회한다. */
export async function searchFestivals(options: {
    region?: Region;
    /** YYYYMMDD */
    eventStartDate: string;
    numOfRows?: number;
}): Promise<TourApiFestivalSummary[]> {
    const params: Record<string, string | number> = {
        eventStartDate: options.eventStartDate,
        numOfRows: options.numOfRows ?? 20,
        pageNo: 1,
        arrange: "Q", // 수정일순 (이미지 있는 것 우선이 아닌 최신순)
    };
    if (options.region) params.areaCode = AREA_CODE[options.region];

    const items = await callTourApi("searchFestival2", params);

    return items.map((raw) => {
        const it = raw as Record<string, unknown>;
        return {
            contentId: String(it.contentid ?? ""),
            title: String(it.title ?? ""),
            address: str(it.addr1),
            eventStartDate: str(it.eventstartdate),
            eventEndDate: str(it.eventenddate),
            imageUrl: str(it.firstimage),
        };
    });
}

/** 축제 1건의 세부 프로그램·개요를 가져온다. detailIntro2 + detailCommon2를 합친다. */
export async function fetchFestivalDetail(
    summary: TourApiFestivalSummary
): Promise<TourApiFestivalDetail> {
    const [introItems, commonItems] = await Promise.all([
        callTourApi("detailIntro2", {
            contentId: summary.contentId,
            contentTypeId: CONTENT_TYPE_FESTIVAL,
        }).catch(() => [] as unknown[]),
        callTourApi("detailCommon2", {
            contentId: summary.contentId,
            overviewYN: "Y",
        }).catch(() => [] as unknown[]),
    ]);

    const intro = (introItems[0] ?? {}) as Record<string, unknown>;
    const common = (commonItems[0] ?? {}) as Record<string, unknown>;

    return {
        ...summary,
        program: str(intro.program),
        eventPlace: str(intro.eventplace),
        sponsor: str(intro.sponsor1),
        useTimeFestival: str(intro.usetimefestival),
        ageLimit: str(intro.agelimit),
        playTime: str(intro.playtime),
        overview: str(common.overview),
    };
}

/**
 * 축제명으로 TourAPI 상세 내용을 찾아 붙인다.
 * 이름이 정확히 일치하지 않는 경우가 많아(회차·연도 표기 차이) 느슨하게 매칭한다.
 */
export async function enrichByFestivalName(
    festivalNames: string[],
    region: Region | undefined,
    planningYear: number
): Promise<Map<string, TourApiFestivalDetail>> {
    const result = new Map<string, TourApiFestivalDetail>();
    if (!isTourApiEnabled() || festivalNames.length === 0) return result;

    // 기획연도 기준으로 1년치를 훑는다.
    const summaries = await searchFestivals({
        region,
        eventStartDate: `${planningYear - 1}0101`,
        numOfRows: 100,
    });

    const normalize = (s: string) => s.replace(/\s+/g, "").replace(/제?\d+회/g, "").replace(/(19|20)\d{2}년?/g, "");

    for (const name of festivalNames) {
        const target = normalize(name);
        const hit = summaries.find((s) => {
            const t = normalize(s.title);
            return t.includes(target) || target.includes(t);
        });
        if (!hit) continue;

        try {
            result.set(name, await fetchFestivalDetail(hit));
        } catch {
            // 상세 조회 1건 실패가 전체 추천을 막지 않도록 조용히 건너뛴다.
        }
    }

    return result;
}
