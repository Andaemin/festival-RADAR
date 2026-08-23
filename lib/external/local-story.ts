/**
 * 지역 스토리 제공자(provider) — 기본 백엔드: 국가유산청 (lib/external/heritage.ts)
 *
 * ┌─ 이 모듈이 필요한 이유 ────────────────────────────────────────────────┐
 * │ 추천 엔진(lib/planner)은 "전어: 전국 6건 / 경북 0건" 같은 수치 근거는   │
 * │ 만들지만, "왜 하필 이 지역에서?"에 답하지 못한다. 그 지역의 설화·지명   │
 * │ 유래·향토자산 텍스트가 있으면                                          │
 * │   1) 추천 카드에 스토리 근거를 붙일 수 있고                            │
 * │   2) lib/llm/plan-draft.ts 가 지역 특성을 지어내지 않고 인용할 수 있다  │
 * │      (할루시네이션 방지 — 프롬프트 규칙이 수치뿐 아니라 정성 주장까지   │
 * │       근거에 묶이려면 이 텍스트가 필요하다)                            │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ⛔ 원래 쓰려던 지역N문화(한국문화원연합회) 오픈API는 사용할 수 없다.
 *    2026-08-22 확인 결과:
 *      - 공식 가이드(https://www.nculture.org/api/apiGuideInfo.do)에 적힌
 *        http://www.kccf.or.kr/openapi/rest/contents 가 404.
 *        응답 서버 배너가 `old.kccf.or.kr / Apache 2.0.52 / PHP 4.3.9`로,
 *        폐기된 레거시 호스트로 넘어간다. contents 외 story/culture/heritage/
 *        list 경로도 전부 404.
 *      - 가이드 페이지에 개발가이드 다운로드 링크도, 인증키 신청 경로도 없다.
 *      - 2025-11-08자 문의 답변에서 연합회가 API 사용법을 안내하지 않고
 *        "행사정보는 한국관광공사 소관"이라며 타 기관으로 안내했다.
 *    → 오픈API가 유지보수되지 않는 것으로 판단하고 연결을 포기했다.
 *
 * ✅ 2026-08-23: 국가유산청 국가유산 정보 Open API로 대체 완료.
 *    **인증키가 필요 없고**(data.go.kr 항목은 유형이 LINK), 지역별 지정문화유산의
 *    명칭·소재지·설명 텍스트를 준다. 별도 설정 없이 기본 동작한다.
 *
 * ✅ 그래서 이 파일은 특정 서비스가 아니라 **교체 가능한 어댑터**로 남겨둔다.
 *    응답 스키마를 하드코딩하지 않고 findItemArray/FIELD_CANDIDATES로 탐색하므로,
 *    다른 제공자로 갈아끼울 때 대개 환경변수 2개만 바꾸면 된다.
 *
 * ── 다른 API로 교체하는 방법 ────────────────────────────────────────────
 *  1. .env 에 아래 둘을 넣는다. 그 순간 자동 활성화된다(코드 수정 불필요).
 *       LOCAL_STORY_SERVICE_KEY = 발급 인증키
 *       LOCAL_STORY_BASE_URL    = 엔드포인트 전체 URL
 *  2. LOCAL_STORY_DEBUG=1 로 한 번 호출하면 실제 응답 필드 키가 서버 로그에
 *     찍힌다. 그 이름을 FIELD_CANDIDATES 에 추가한다.
 *  3. 쿼리 파라미터 이름이 다르면 buildRequestUrl()만 고치면 된다.
 *     (현재는 공공데이터포털 관례인 serviceKey/pageNo/numOfRows/keyword 를 쓴다)
 *
 * ── 교체 후보 (2026-08-22 조사) ─────────────────────────────────────────
 *  1순위) 국가유산청_전국 지정문화재 현황
 *         https://www.data.go.kr/data/15034324/openapi.do
 *         시도별 소재지 + 설명내용 텍스트. 국가 지정·관리 기록이라 출처
 *         신뢰도가 높다. 우리 코퍼스에서 이미 `국가유산`이 2위 키워드(15건),
 *         `야행`이 3위(12건)라 데이터가 직접 맞물린다.
 *  2순위) 한국문화정보원_디지털문화자원 정보조회서비스
 *         https://www.data.go.kr/data/15139738/openapi.do
 *         자동승인·일 10,000회로 조건은 좋으나, 문화 콘텐츠 본문이 아니라
 *         디지털 에셋 카탈로그(설명/저작권/분류)일 가능성이 높다. 기대치 낮음.
 *  참고) 문화포털 오픈API
 *         https://www.culture.go.kr/data/openapi/openapiInfo.do
 */

import { REGION_DISPLAY, Region } from "@/lib/domain/enums";
import { fetchRegionHeritage } from "./heritage";

export interface LocalStory {
    title: string;
    /** 설화·유래 본문. LLM 프롬프트에 근거로 주입할 텍스트. */
    summary: string | null;
    regionName: string | null;
    sourceUrl: string | null;
}

/** 커스텀 제공자(환경변수)가 설정되어 있으면 그쪽을 우선한다. */
function hasCustomProvider(): boolean {
    return !!process.env.LOCAL_STORY_SERVICE_KEY && !!process.env.LOCAL_STORY_BASE_URL;
}

/** 국가유산청이 키 없이 동작하므로 항상 사용 가능하다. */
export function isLocalStoryEnabled(): boolean {
    return true;
}

/** 화면에 어떤 출처를 쓰고 있는지 밝힌다. */
export function localStoryProviderName(): string {
    return hasCustomProvider() ? "사용자 지정 제공자" : "국가유산청 국가유산 정보";
}

/**
 * 응답 필드 이름 후보. 제공자마다 다르므로 앞에서부터 먼저 걸리는 값을 쓴다.
 * 새 제공자를 붙일 때 LOCAL_STORY_DEBUG=1 로 확인한 실제 키를 여기 추가한다.
 */
const FIELD_CANDIDATES = {
    // ccbaMnm1 / ccbaMnm2 는 국가유산청 지정문화재 API의 국문 명칭 필드 후보
    title: ["title", "cntntsNm", "clturNm", "ccbaMnm1", "ccbaMnm2", "name", "제목"],
    // content 는 국가유산청 설명내용 필드 후보
    summary: ["summary", "cntntsCn", "content", "description", "ccbaMnm3", "내용"],
    region: ["regionNm", "areaNm", "ctprvnNm", "ccbaCtcdNm", "ccsiNm", "지역"],
    url: ["url", "linkUrl", "cntntsUrl", "imageUrl"],
};

function pick(obj: Record<string, unknown>, candidates: string[]): string | null {
    for (const key of candidates) {
        const v = obj[key];
        if (v !== null && v !== undefined && String(v).trim().length > 0) return String(v).trim();
    }
    return null;
}

/**
 * 응답 본문 어디에 배열이 있든 첫 번째로 발견되는 객체 배열을 결과로 본다.
 * 제공자마다 래핑 구조가 달라(response.body.items.item / result / data …)
 * 경로를 하드코딩하지 않는다.
 */
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

/** 쿼리 파라미터는 공공데이터포털 관례를 따른다. 제공자가 다르면 여기만 고치면 된다. */
function buildRequestUrl(keyword: string, limit: number): string {
    const url = new URL(process.env.LOCAL_STORY_BASE_URL as string);
    url.searchParams.set("serviceKey", process.env.LOCAL_STORY_SERVICE_KEY as string);
    url.searchParams.set("keyword", keyword);
    url.searchParams.set("numOfRows", String(limit));
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("_type", "json");
    return url.toString();
}

/**
 * 지역의 문화 자산·설화를 가져온다.
 *
 * 기본은 국가유산청(키 불필요). LOCAL_STORY_BASE_URL이 설정되어 있으면 그 제공자를 쓴다.
 */
export async function searchLocalStories(region: Region, limit = 5): Promise<LocalStory[]> {
    if (!hasCustomProvider()) {
        return fetchRegionHeritage(region, limit);
    }

    const res = await fetch(buildRequestUrl(REGION_DISPLAY[region] ?? region, limit), {
        next: { revalidate: 86400 },
    });
    const text = await res.text();

    if (!res.ok) throw new Error(`지역 스토리 API HTTP ${res.status}: ${text.slice(0, 200)}`);
    if (text.trimStart().startsWith("<")) {
        // 공공데이터포털은 인증키 오류를 XML로 돌려주는 일이 잦다.
        const msg = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(text)?.[1] ?? text.slice(0, 200);
        throw new Error(`지역 스토리 API 오류 응답: ${msg}`);
    }

    const json = JSON.parse(text);
    const items = findItemArray(json);
    if (!items) return [];

    if (process.env.LOCAL_STORY_DEBUG === "1") {
        console.info("[local-story] 응답 필드 키:", Object.keys(items[0] ?? {}).join(", "));
    }

    return items.slice(0, limit).map((it) => ({
        title: pick(it, FIELD_CANDIDATES.title) ?? "(제목 없음)",
        summary: pick(it, FIELD_CANDIDATES.summary),
        regionName: pick(it, FIELD_CANDIDATES.region),
        sourceUrl: pick(it, FIELD_CANDIDATES.url),
    }));
}
