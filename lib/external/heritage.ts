import { Region } from "@/lib/domain/enums";
import type { LocalStory } from "./local-story";

/**
 * 국가유산청 국가유산 정보 Open API 클라이언트.
 *
 * 폐기된 지역N문화(lib/external/local-story.ts 주석 참고)를 대체한다.
 * 지역별 지정문화유산의 명칭·소재지·**설명 텍스트(content)**를 준다.
 *
 * ✅ 인증키가 필요 없다. 공공데이터포털 활용신청 없이 바로 호출된다
 *    (data.go.kr의 해당 항목은 유형이 LINK로, 기관 자체 API로 연결만 한다).
 *
 * 엔드포인트 (2026-08-23 실측 확인):
 *   목록  https://www.cha.go.kr/cha/SearchKindOpenapiList.do?ccbaCtcd={시도코드}
 *   상세  https://www.cha.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=&ccbaAsno=&ccbaCtcd=
 * 응답은 JSON이 아니라 XML이고, 텍스트는 CDATA로 감싸여 온다.
 */

const LIST_URL = "https://www.cha.go.kr/cha/SearchKindOpenapiList.do";
const DETAIL_URL = "https://www.cha.go.kr/cha/SearchKindOpenapiDt.do";

/**
 * Region -> 국가유산청 시도코드(ccbaCtcd). 2026-08-23 전 코드 실측 검증.
 *
 * ⚠️ 광주(24)와 전남(36)은 이 API에서 "전남광주"로 합쳐져 있어 같은 결과를 돌려준다.
 *    광주 요청에도 전남 유산이 섞여 나오므로 화면에서 지역명을 그대로 노출할 것.
 */
const CTCD: Record<Region, string> = {
    [Region.SEOUL]: "11",
    [Region.BUSAN]: "21",
    [Region.DAEGU]: "22",
    [Region.INCHEON]: "23",
    [Region.GWANGJU]: "24",
    [Region.DAEJEON]: "25",
    [Region.ULSAN]: "26",
    [Region.SEJONG]: "45",
    [Region.GYEONGGI]: "31",
    [Region.GANGWON]: "32",
    [Region.CHUNGBUK]: "33",
    [Region.CHUNGNAM]: "34",
    [Region.JEONBUK]: "35",
    [Region.JEONNAM]: "36",
    [Region.GYEONGBUK]: "37",
    [Region.GYEONGNAM]: "38",
    [Region.JEJU]: "50",
};

/** 지정 등급 우선순위. 앞에 있을수록 인지도가 높아 축제 소재로 쓸 만하다. */
const GRADE_PRIORITY = [
    "국보",
    "보물",
    "사적",
    "명승",
    "천연기념물",
    "국가무형유산",
    "국가민속문화유산",
];

interface HeritageListItem {
    kdcd: string;
    asno: string;
    ctcd: string;
    name: string;
    grade: string;
    districtName: string;
}

/** 평평한 XML에서 태그 값을 뽑는다. CDATA 래핑을 벗긴다. */
function tagValue(xml: string, tag: string): string | null {
    const m = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`).exec(xml);
    return m ? m[1].trim() || null : null;
}

function itemBlocks(xml: string): string[] {
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
}

async function fetchXml(url: string): Promise<string> {
    const res = await fetch(url, { next: { revalidate: 60 * 60 * 24 * 30 } });
    if (!res.ok) throw new Error(`국가유산청 API HTTP ${res.status}`);
    const text = await res.text();
    if (!text.trimStart().startsWith("<")) {
        throw new Error(`국가유산청 API가 XML이 아닌 응답을 반환했습니다: ${text.slice(0, 120)}`);
    }
    return text;
}

async function fetchList(region: Region, pageUnit: number): Promise<HeritageListItem[]> {
    const xml = await fetchXml(`${LIST_URL}?ccbaCtcd=${CTCD[region]}&pageUnit=${pageUnit}&pageIndex=1`);

    return itemBlocks(xml)
        .map((block) => ({
            kdcd: tagValue(block, "ccbaKdcd") ?? "",
            asno: tagValue(block, "ccbaAsno") ?? "",
            ctcd: tagValue(block, "ccbaCtcd") ?? "",
            name: tagValue(block, "ccbaMnm1") ?? "",
            grade: tagValue(block, "ccmaName") ?? "",
            districtName: tagValue(block, "ccsiName") ?? "",
        }))
        .filter((it) => it.kdcd && it.asno && it.name);
}

async function fetchDetail(item: HeritageListItem): Promise<string | null> {
    const xml = await fetchXml(
        `${DETAIL_URL}?ccbaKdcd=${item.kdcd}&ccbaAsno=${item.asno}&ccbaCtcd=${item.ctcd}`
    );
    return tagValue(xml, "content");
}

/** 국가유산청은 키가 없어도 되므로 항상 사용 가능하다. */
export function isHeritageEnabled(): boolean {
    return true;
}

/**
 * 지역의 대표 국가유산을 설명 텍스트와 함께 가져온다.
 *
 * 목록 1회 + 상세 N회를 호출한다. 유산 데이터는 거의 바뀌지 않으므로 fetch 캐시를
 * 30일로 두었다.
 */
export async function fetchRegionHeritage(region: Region, limit = 5): Promise<LocalStory[]> {
    // 등급 상위를 고르려면 후보를 넉넉히 받아야 한다.
    const candidates = await fetchList(region, 100);

    const ranked = [...candidates].sort((a, b) => {
        const rank = (g: string) => {
            const i = GRADE_PRIORITY.indexOf(g);
            return i === -1 ? GRADE_PRIORITY.length : i;
        };
        return rank(a.grade) - rank(b.grade);
    });

    const picked = ranked.slice(0, limit);

    const stories = await Promise.all(
        picked.map(async (item): Promise<LocalStory> => {
            let summary: string | null = null;
            try {
                summary = await fetchDetail(item);
            } catch {
                // 상세 1건 실패가 전체를 막지 않는다. 명칭만으로도 소재 힌트는 된다.
            }
            return {
                title: item.name,
                summary,
                regionName: item.districtName || null,
                sourceUrl: `https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaKdcd=${item.kdcd}&ccbaAsno=${item.asno}&ccbaCtcd=${item.ctcd}`,
            };
        })
    );

    return stories;
}
