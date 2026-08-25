/**
 * Spring `com.festival.budgetassist.multiyear.series.FestivalNameNormalizer`의 1:1 포팅.
 * 축제명에서 연도/회차 표기만 걷어내 "같은 축제의 다른 연도 표기"를 하나의 문자열로 모은다.
 *
 * 목표 예시: "제27회 무주반딧불축제", "제28회 무주반딧불축제", "2025 무주반딧불축제" → "무주반딧불축제".
 *
 * 의도적으로 보수적이다(Spring과 동일):
 * - 제거하는 것: 앞쪽 연도(4자리), "제n회"/"n회", 괄호 안이 연도·회차·순수 숫자뿐인 경우의 괄호
 *   전체, 장식용 특수기호(「」『』【】〈〉), 중복/leading·trailing 공백.
 * - 제거하지 않는 것: "축제"/"페스티벌" 등 표기 차이, 회차/연도 문맥이 아닌 숫자, 이름 내부의
 *   단일 공백(공백 유무 차이는 fuzzy 매칭 단계의 신호로 남겨둔다).
 *
 * threshold/정규화 규칙은 Spring frozen implementation과 절대 다르게 바꾸지 않는다.
 */

// "2025", "2025년" 처럼 이름 맨 앞에 오는 연도.
const LEADING_YEAR = /^(19|20)\d{2}\s*년?\s*/;

// "제27회", "제 27 회" 등 - 이름 어디에 있든 제거.
const JE_ROUND = /제\s*\d+\s*회\s*/g;

// "27회", "10 회" - "제"가 없는 회차 표기.
const BARE_ROUND = /\d+\s*회\s*/g;

// 괄호 그룹 전체(내용 검사는 코드에서 별도로 함).
const PAREN_GROUP = /[(（][^)）]*[)）]/g;

// 괄호 안 내용이 연도/회차/순수 숫자뿐인지 판정.
const PAREN_CONTENT_IS_YEAR_OR_ROUND = /^((19|20)\d{2}\s*년?|제?\s*\d+\s*회|\d+)$/;

// 장식용 괄호/인용부호류 - 핵심 단어를 지우지 않는 순수 장식 문자만 대상으로 한다.
const DECORATIVE_BRACKETS = /[「」『』【】〈〉]/g;

// 가장자리에 남은 연결부호(하이픈/가운뎃점/쉼표 등)를 정리하기 위한 패턴.
const EDGE_CONNECTORS = /^[\s\-·ㆍ,./]+|[\s\-·ㆍ,./]+$/g;

const WHITESPACE_RUN = /\s+/g;

/** 괄호 안 내용이 연도/회차/숫자뿐인 그룹만 통째로 제거하고, 그 외 괄호는 그대로 둔다. */
function removeYearOrRoundParens(s: string): string {
  let result = "";
  let lastEnd = 0;
  PAREN_GROUP.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PAREN_GROUP.exec(s)) !== null) {
    const content = s.slice(match.index + 1, match.index + match[0].length - 1).trim();
    result += s.slice(lastEnd, match.index);
    if (!PAREN_CONTENT_IS_YEAR_OR_ROUND.test(content)) {
      result += match[0];
    } else {
      result += " ";
    }
    lastEnd = match.index + match[0].length;
  }
  result += s.slice(lastEnd);
  return result;
}

export function normalizeFestivalName(rawFestivalName: string | null | undefined): string {
  if (rawFestivalName === null || rawFestivalName === undefined) return "";
  let s = rawFestivalName.trim();
  if (s === "") return s;

  s = s.replace(LEADING_YEAR, "");
  s = removeYearOrRoundParens(s);
  s = s.replace(JE_ROUND, " ");
  s = s.replace(BARE_ROUND, " ");
  s = s.replace(DECORATIVE_BRACKETS, "");
  s = s.replace(WHITESPACE_RUN, " ");
  s = s.replace(EDGE_CONNECTORS, "");
  s = s.trim();

  return s === "" ? rawFestivalName.trim() : s;
}

/**
 * fuzzy 매칭용 보조 키 - 정규화된 이름에서 공백까지 마저 제거한다. EXACT/NORMALIZED_EXACT
 * 결정적 매칭 기준(canonicalName)에는 쓰지 않는다.
 */
export function fuzzyKey(normalizedName: string | null | undefined): string {
  if (normalizedName === null || normalizedName === undefined) return "";
  return normalizedName.replace(WHITESPACE_RUN, "");
}
