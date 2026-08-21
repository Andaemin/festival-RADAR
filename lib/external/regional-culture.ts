/**
 * 지역N문화(한국문화원연합회) 오픈 API 클라이언트.
 *
 * 축제의 모태가 되는 지역 설화·향토자산·역사 배경 텍스트를 가져와, "스토리가 있는 기획"
 * 추천의 근거로 쓴다.
 *
 * ⚠️ 주의: TourAPI와 달리 이 API의 정확한 응답 스키마를 코드 작성 시점에 확정하지 못했다.
 *    그래서 필드 매핑을 FIELD_CANDIDATES로 느슨하게 두고, 실제 응답에서 먼저 발견되는
 *    키를 쓴다. 실제 키를 확인하면 FIELD_CANDIDATES를 정확한 이름 하나로 좁히는 것이 좋다.
 *    (진단용으로 REGIONAL_CULTURE_DEBUG=1 을 켜면 원본 응답 키를 로그로 남긴다.)
 *
 * 필요한 환경변수:
 *   REGIONAL_CULTURE_SERVICE_KEY  발급 인증키
 *   REGIONAL_CULTURE_BASE_URL     서비스 엔드포인트 (전체 URL)
 */

export interface LocalStory {
    title: string;
    summary: string | null;
    regionName: string | null;
    sourceUrl: string | null;
}

export function isRegionalCultureEnabled(): boolean {
    return !!process.env.REGIONAL_CULTURE_SERVICE_KEY && !!process.env.REGIONAL_CULTURE_BASE_URL;
}

/** 응답 필드 이름 후보. 앞에 있는 것부터 찾아 먼저 걸리는 값을 쓴다. */
const FIELD_CANDIDATES = {
    title: ["title", "cntntsNm", "clturNm", "name", "제목"],
    summary: ["summary", "cntntsCn", "description", "content", "내용"],
    region: ["regionNm", "areaNm", "ctprvnNm", "지역"],
    url: ["url", "linkUrl", "cntntsUrl"],
};

function pick(obj: Record<string, unknown>, candidates: string[]): string | null {
    for (const key of candidates) {
        const v = obj[key];
        if (v !== null && v !== undefined && String(v).trim().length > 0) return String(v).trim();
    }
    return null;
}

/** 응답 본문 어디에 배열이 있든 첫 번째로 발견되는 객체 배열을 결과로 본다. */
function findItemArray(node: unknown, depth = 0): Record<string, unknown>[] | null {
    if (depth > 6 || node === null || typeof node !== "object") return null;

    if (Array.isArray(node)) {
        const objects = node.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
        return objects.length > 0 ? objects : null;
    }

    for (const value of Object.values(node as Record<string, unknown>)) {
        const found = findItemArray(value, depth + 1);
        if (found) return found;
    }
    return null;
}

export async function searchLocalStories(keyword: string, limit = 5): Promise<LocalStory[]> {
    if (!isRegionalCultureEnabled()) return [];

    const url = new URL(process.env.REGIONAL_CULTURE_BASE_URL as string);
    url.searchParams.set("serviceKey", process.env.REGIONAL_CULTURE_SERVICE_KEY as string);
    url.searchParams.set("keyword", keyword);
    url.searchParams.set("numOfRows", String(limit));
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("_type", "json");

    const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
    const text = await res.text();

    if (!res.ok) throw new Error(`지역N문화 API HTTP ${res.status}: ${text.slice(0, 200)}`);
    if (text.trimStart().startsWith("<")) {
        throw new Error(`지역N문화 API가 XML 오류를 반환했습니다: ${text.slice(0, 200)}`);
    }

    const json = JSON.parse(text);
    const items = findItemArray(json);
    if (!items) return [];

    if (process.env.REGIONAL_CULTURE_DEBUG === "1") {
        console.info("[regional-culture] 응답 필드 키:", Object.keys(items[0] ?? {}).join(", "));
    }

    return items.slice(0, limit).map((it) => ({
        title: pick(it, FIELD_CANDIDATES.title) ?? "(제목 없음)",
        summary: pick(it, FIELD_CANDIDATES.summary),
        regionName: pick(it, FIELD_CANDIDATES.region),
        sourceUrl: pick(it, FIELD_CANDIDATES.url),
    }));
}
