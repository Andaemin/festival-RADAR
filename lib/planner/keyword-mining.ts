import { REGION_DISPLAY, Region } from "@/lib/domain/enums";

/**
 * 축제명에서 "소재 토큰"을 뽑는다.
 *
 * 문체부 데이터에는 축제 내용을 서술하는 컬럼이 없다. 하지만 축제명 자체가 텍스트이고,
 * 대부분 `<지역> + <소재> + 축제` 꼴이라 지역명과 상투어를 걷어내면 소재가 남는다.
 * (예: "제25회 서울억새축제" → "억새", "2026 서울라이트 한강 빛섬축제" → "라이트","한강","빛섬")
 *
 * 형태소 분석기를 쓰지 않으므로 개별 토큰은 완벽하지 않다. 대신 코퍼스 전체에서
 * MIN_CORPUS_FREQUENCY회 이상 등장한 토큰만 소재로 승격시켜 잡음을 걷어낸다.
 */

/** 소재로 보기 어려운 상투어. 축제명에서 문자열 단위로 제거한다. */
const GENERIC_TERMS = [
    "대축제",
    "축제",
    "페스티벌",
    "페스타",
    "축전",
    "문화제",
    "예술제",
    "한마당",
    "대잔치",
    "잔치",
    "행사",
    "기념행사",
    "주간",
    "위크",
    "엑스포",
    "박람회",
    "festival",
    "FESTIVAL",
    "Festival",
    "fest",
    "FEST",
];

/** 소재 판정에서 제외할 단독 토큰(제거 후 남아도 의미 없는 것). */
const STOP_TOKENS = new Set([
    "제",
    "년",
    "회",
    "차",
    "및",
    "그리고",
    "with",
    "and",
    "the",
    "in",
    "of",
    "시",
    "군",
    "구",
    "도",
    "읍",
    "면",
    "동",
    "리",
    "전국",
    "지역",
    "전통",
    "문화",
    "관광",
    "시민",
    "군민",
    "구민",
    "도민",
    "주민",
    "가족",
    "어린이",
    "청소년",
    "국제",
    "세계",
    "한국",
    "대한민국",
    "제일",
    "최대",
    "봄",
    "여름",
    "가을",
    "겨울",
]);

/** 코퍼스 전체에서 이 횟수 이상 등장해야 소재 키워드로 인정한다. */
export const MIN_CORPUS_FREQUENCY = 2;

/**
 * 지역명 장음절 변형. REGION_DISPLAY는 "경기"처럼 짧은 형태만 갖고 있어서
 * 축제명에 흔한 "경기도"/"서울특별시" 같은 표기를 따로 지워야 한다.
 */
const REGION_NAME_SUFFIXES = ["특별자치도", "특별자치시", "특별시", "광역시", "도", "시"];

/** 한국어 용언 활용형으로 끝나는 토큰(예: "함께하는", "없는")은 소재가 아니다. */
const VERBAL_ENDINGS = ["하는", "있는", "없는", "되는", "지는", "치는", "리는"];

const YEAR_PATTERN = /(19|20)\d{2}\s*년?/g;
const ORDINAL_PATTERN = /제?\s*\d+\s*(회|주년|차|번째)/g;
const PAREN_PATTERN = /[（([{][^）)\]}]*[）)\]}]/g;
const SPLIT_PATTERN = /[\s·・,./&\-–—~!?:;"'"'"「」『』<>＜＞|+*]+/;
const HANGUL_OR_ALNUM = /[가-힣a-zA-Z0-9]/;

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const REGION_NAMES = Object.values(Region).flatMap((r) => {
    const short = REGION_DISPLAY[r];
    return [short, ...REGION_NAME_SUFFIXES.map((suffix) => short + suffix)];
});

/**
 * "포항시" → ["포항시", "포항"]. 축제명은 대개 접미사 없이 "포항국제불빛축제"라고 쓰므로
 * 접미사를 뗀 형태까지 지워야 시·군명이 소재로 새지 않는다.
 */
function districtVariants(districtNames: Iterable<string>): string[] {
    const out = new Set<string>();
    for (const d of districtNames) {
        if (d.length < 2) continue;
        out.add(d);
        const bare = d.replace(/[시군구]$/, "");
        if (bare.length >= 2) out.add(bare);
    }
    return [...out];
}

/** "철쭉제" → "철쭉". 접미사 "제"는 상투어라 소재에서 떼어낸다. */
function normalizeToken(token: string): string {
    if (token.length >= 3 && token.endsWith("제")) return token.slice(0, -1);
    return token;
}

/**
 * 축제명 1건을 토큰 배열로 쪼갠다. 지역명·시군구명·상투어·회차·연도를 제거한 뒤 남은 조각.
 *
 * @param districtNames 코퍼스에 등장하는 시군구명. 지역명과 함께 제거 대상이다.
 */
export function tokenizeFestivalName(name: string, districtNames: Iterable<string> = []): string[] {
    let s = name.normalize("NFC");

    s = s.replace(PAREN_PATTERN, " ");
    s = s.replace(ORDINAL_PATTERN, " ");
    s = s.replace(YEAR_PATTERN, " ");

    // 시군구명 → 지역명 → 상투어 순으로 제거한다. 긴 문자열부터 지워야
    // "대축제"가 "축제"보다 먼저 걸리고, "고성군"이 "고성"보다 먼저 걸린다.
    const removals = [...districtVariants(districtNames), ...REGION_NAMES, ...GENERIC_TERMS].sort(
        (a, b) => b.length - a.length
    );

    for (const term of removals) {
        s = s.replace(new RegExp(escapeRegExp(term), "g"), " ");
    }

    return s
        .split(SPLIT_PATTERN)
        .map((t) => normalizeToken(t.trim()))
        .filter((t) => t.length >= 2 && t.length <= 8)
        .filter((t) => HANGUL_OR_ALNUM.test(t))
        .filter((t) => !STOP_TOKENS.has(t))
        .filter((t) => !VERBAL_ENDINGS.some((e) => t.endsWith(e)))
        // 숫자만 남은 조각 제거
        .filter((t) => !/^\d+$/.test(t));
}

/**
 * 코퍼스 전체에서 소재 키워드 사전을 만든다.
 * MIN_CORPUS_FREQUENCY 미만으로 등장한 토큰은 잡음으로 보고 버린다.
 */
export function buildKeywordVocabulary(
    names: string[],
    districtNames: Iterable<string> = [],
    minFrequency: number = MIN_CORPUS_FREQUENCY
): Map<string, number> {
    const counts = new Map<string, number>();
    for (const name of names) {
        // 같은 축제명 안에서 같은 토큰이 두 번 나와도 1회로 센다.
        for (const token of new Set(tokenizeFestivalName(name, districtNames))) {
            counts.set(token, (counts.get(token) ?? 0) + 1);
        }
    }

    const vocabulary = new Map<string, number>();
    for (const [token, count] of counts) {
        if (count >= minFrequency) vocabulary.set(token, count);
    }
    return vocabulary;
}

/**
 * 사전에 등재된 토큰만 남겨 축제 1건의 소재 키워드를 확정한다.
 *
 * 한국어 축제명은 띄어쓰기 없는 복합어가 많아("국가유산야행") 토큰이 사전에 통째로는
 * 없는 경우가 흔하다. 그래서 사전 미등재 토큰은 안에 들어있는 사전 등재어를 찾아 쪼갠다.
 */
export function extractKeywords(
    name: string,
    vocabulary: Map<string, number>,
    districtNames: Iterable<string> = []
): string[] {
    const found = new Set<string>();

    for (const token of new Set(tokenizeFestivalName(name, districtNames))) {
        if (vocabulary.has(token)) {
            found.add(token);
            continue;
        }
        // 복합어 분해: 긴 사전어부터 시도해 "국가유산야행" → 국가유산 + 야행.
        for (const entry of vocabulary.keys()) {
            if (entry.length >= 2 && entry.length < token.length && token.includes(entry)) {
                found.add(entry);
            }
        }
    }

    return [...found];
}
