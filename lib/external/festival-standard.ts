/**
 * 행정안전부 전국문화축제표준데이터.
 *
 * 229개 지자체가 직접 등록하는 축제 원장이다. 우리 DB(문체부 축제 현황)에 없는
 * **개최장소·주최기관·정확한 개최일·홈페이지·좌표**를 준다.
 *
 * ⚠️ 기대치를 낮게 잡을 것 (2026-08-25 전수 1,305건 실측):
 *   - `fstvlCo`(축제내용)는 100% 채워져 있지만 **길이 중앙값 24자**이고, 67%가 30자 이하다.
 *     내용의 31%는 "공연+체험+부스+먹거리" 식 프로그램 나열이라 소재 추출용 텍스트가 아니다.
 *     예: 여의도 봄꽃축제 -> "개막식 퍼레이드+문화행사(공연·전시·체험)+먹거리존"
 *     서술형 소개가 필요하면 TourAPI의 overview/program(lib/external/tour-api.ts)이 훨씬 낫다.
 *   - `opar`(개최장소)는 100% 채워지고 지명이라 표기가 안정적이다. 다만 "수국정원",
 *     "튤립공원"처럼 **시설 이름에 든 식물명이 그 축제의 소재는 아니다**
 *     (도초 수국정원에서 4월에 간재미축제를 한다). 소재 판정 근거로 단독 사용 금지.
 *
 * 엔드포인트 (2026-08-25 실측 확인):
 *   https://api.data.go.kr/openapi/tn_pubr_public_cltur_fstvl_api
 *   파라미터: serviceKey, pageNo, numOfRows, type=json  (TourAPI와 달리 `_type`이 아니라 `type`)
 *   응답: { header:{resultCode,resultMsg}, body:{totalCount, items:{item:[...]}} }
 *   총 1,305건. numOfRows 상한이 1,000이라 2페이지로 나눠 받는다.
 *
 * 인증키는 TourAPI와 같은 것을 쓴다(같은 포털 계정).
 * 갱신 주기는 분기라 캐시를 길게 잡는다.
 */

const BASE_URL = "https://api.data.go.kr/openapi/tn_pubr_public_cltur_fstvl_api";

/** API가 허용하는 페이지 크기 상한. 총 1,305건이라 2페이지면 전부 받는다. */
const PAGE_SIZE = 1000;
const MAX_PAGES = 3;

export interface FestivalStandardRecord {
    festivalName: string;
    /** 개최장소. 100% 채워진다. */
    venue: string | null;
    /** YYYY-MM-DD */
    startDate: string | null;
    endDate: string | null;
    /** 축제내용. 대부분 프로그램 나열이다(위 주석 참고). */
    content: string | null;
    hostOrganization: string | null;
    supervisingOrganization: string | null;
    homepageUrl: string | null;
    /** 연계 관광지·시설. 12%만 채워진다. */
    relatedInfo: string | null;
    roadAddress: string | null;
    latitude: number | null;
    longitude: number | null;
    /** 등록한 지자체명 */
    institutionName: string | null;
}

export function isFestivalStandardEnabled(): boolean {
    return !!process.env.TOUR_API_SERVICE_KEY;
}

/**
 * 분기 갱신 · 1,305건 정적 데이터라 요청마다 다시 받을 이유가 없다.
 * dev의 HMR에서도 살아남도록 globalThis에 캐시한다 - lib/db/prisma.ts와 같은 방식.
 */
const globalForStandard = globalThis as unknown as { festivalStandardList?: FestivalStandardRecord[] };

export function invalidateFestivalStandardList(): void {
    globalForStandard.festivalStandardList = undefined;
}

interface RawItem {
    fstvlNm?: string;
    opar?: string;
    fstvlStartDate?: string;
    fstvlEndDate?: string;
    fstvlCo?: string;
    mnnstNm?: string;
    auspcInsttNm?: string;
    homepageUrl?: string;
    relateInfo?: string;
    rdnmadr?: string;
    latitude?: string;
    longitude?: string;
    insttNm?: string;
}

function str(v: string | undefined): string | null {
    const s = (v ?? "").trim();
    return s.length > 0 ? s : null;
}

function num(v: string | undefined): number | null {
    const n = Number((v ?? "").trim());
    return Number.isFinite(n) && n !== 0 ? n : null;
}

function toRecord(raw: RawItem): FestivalStandardRecord | null {
    const festivalName = str(raw.fstvlNm);
    if (!festivalName) return null;
    return {
        festivalName,
        venue: str(raw.opar),
        startDate: str(raw.fstvlStartDate),
        endDate: str(raw.fstvlEndDate),
        content: str(raw.fstvlCo),
        hostOrganization: str(raw.mnnstNm),
        supervisingOrganization: str(raw.auspcInsttNm),
        homepageUrl: str(raw.homepageUrl),
        relatedInfo: str(raw.relateInfo),
        roadAddress: str(raw.rdnmadr),
        latitude: num(raw.latitude),
        longitude: num(raw.longitude),
        institutionName: str(raw.insttNm),
    };
}

async function fetchPage(pageNo: number): Promise<{ items: RawItem[]; totalCount: number }> {
    const url = new URL(BASE_URL);
    url.searchParams.set("serviceKey", process.env.TOUR_API_SERVICE_KEY ?? "");
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(PAGE_SIZE));
    url.searchParams.set("type", "json");

    const res = await fetch(url.toString(), { next: { revalidate: 60 * 60 * 24 * 30 } });
    const text = await res.text();

    // 인증 실패·서비스 미신청은 JSON이 아니라 XML 오류 봉투로 돌아온다.
    if (text.trimStart().startsWith("<") || text.includes("OpenAPI_ServiceResponse")) {
        const msg = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(text)?.[1] ?? text.slice(0, 160);
        throw new Error(`전국문화축제표준데이터 API: ${msg}`);
    }

    const json = JSON.parse(text);
    const code = json?.header?.resultCode;
    if (code && code !== "00") {
        throw new Error(`전국문화축제표준데이터 API: ${json?.header?.resultMsg ?? code}`);
    }

    const raw = json?.body?.items?.item;
    const items: RawItem[] = !raw ? [] : Array.isArray(raw) ? raw : [raw];
    return { items, totalCount: Number(json?.body?.totalCount) || 0 };
}

/** 전체 목록을 받아 캐시한다. */
export async function loadFestivalStandardList(): Promise<FestivalStandardRecord[]> {
    if (globalForStandard.festivalStandardList) return globalForStandard.festivalStandardList;

    const collected: FestivalStandardRecord[] = [];
    let totalCount = Infinity;

    for (let page = 1; page <= MAX_PAGES && collected.length < totalCount; page += 1) {
        const { items, totalCount: total } = await fetchPage(page);
        totalCount = total || collected.length + items.length;
        for (const raw of items) {
            const rec = toRecord(raw);
            if (rec) collected.push(rec);
        }
        if (items.length < PAGE_SIZE) break;
    }

    globalForStandard.festivalStandardList = collected;
    return collected;
}

/**
 * 회차·연도·상투어를 걷어낸 비교용 이름.
 * tour-api.ts의 normalizeTitle과 같은 규칙이다(두 소스의 표기 습관이 같다).
 */
function normalizeTitle(s: string): string {
    return s
        .normalize("NFC")
        .replace(/[\s()（）]/g, "")
        .replace(/제?\s*\d+\s*(회|주년|차)/g, "")
        .replace(/(19|20)\d{2}년?/g, "")
        .replace(/축제|페스티벌|페스타|축전/g, "");
}

/**
 * 두 축제명이 같은 축제인지 판정한다.
 *
 * tour-api.ts와 동일하게 **재현율보다 정확도**를 택한다. 틀린 축제의 장소·내용이
 * LLM 프롬프트에 들어가면 그 자체가 할루시네이션 원인이 되기 때문이다.
 * (실측: 정규화 후 완전일치만으로 우리 DB 1,266건 중 37.2%가 연결된다.)
 */
function isSameFestival(a: string, b: string): boolean {
    if (a === b) return true;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.length >= 5 && long.includes(short) && long.length - short.length <= 4;
}

/** 축제명들로 표준데이터를 찾아 붙인다. 못 찾은 이름은 결과에 없다. */
export async function findFestivalStandardsByNames(
    festivalNames: string[]
): Promise<Map<string, FestivalStandardRecord>> {
    const result = new Map<string, FestivalStandardRecord>();
    if (!isFestivalStandardEnabled() || festivalNames.length === 0) return result;

    const indexed = (await loadFestivalStandardList()).map((rec) => ({
        rec,
        norm: normalizeTitle(rec.festivalName),
    }));

    for (const name of festivalNames) {
        const target = normalizeTitle(name);
        if (target.length < 2) continue;
        // 같은 축제가 연도별로 여러 건 등록돼 있다. 개최일이 가장 최근인 것을 쓴다.
        const hits = indexed.filter((x) => isSameFestival(target, x.norm));
        if (hits.length === 0) continue;
        const latest = hits.sort((a, b) => (b.rec.startDate ?? "").localeCompare(a.rec.startDate ?? ""))[0];
        result.set(name, latest.rec);
    }
    return result;
}
