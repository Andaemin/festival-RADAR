/**
 * 다년도 원본의 개최기간 원문(`periodRaw`)에서 **시작 월**을 뽑는다.
 *
 * 배경: MultiYearFestivalRecord에는 startMonth 컬럼이 없다. canonical CSV(31개 헤더)에도
 * `period_raw`만 있고 월이 파생돼 있지 않다. 그런데 플래너의 시기 이동 카드·포화도·
 * 월별 분포·소재 제철(./seasonality.ts)이 전부 월을 필요로 한다.
 *
 * 임포터는 Spring 프로젝트와 bit 단위 parity를 지켜야 해서 건드리지 않는다.
 * 대신 코퍼스를 만들 때 이 함수로 파생한다.
 *
 * 연도별 표기가 제각각이다 (2026-08-25 전수 확인):
 *   2017·2018·2021·2024  "5.27~5.28"  "10.4~10.7"
 *   2019·2020            "4.5~4.11. (7일간)"  "10월 중"
 *   2022                 "22. 10. 8.~10."  "11.4.~20.(예정)"
 *   2023                 "봄(5.12.~5.14.). 여름(7.28.~8.13.)"
 *   2025·2026            "2026/9/12/2026/9/13"  "2025/6//2025/6/"
 *
 * 판정할 수 없으면 **null을 돌려준다**. 억지로 숫자를 고르면 포화도와 제철이 통째로
 * 오염되므로, 모르는 것은 모르는 채로 두는 편이 낫다.
 */

/** "2026/9/12/2026/9/13", "2025/6//2025/6/" — 2025년 이후 슬래시 표기 */
const SLASH_FORMAT = /^\s*(\d{4})\/(\d{1,2})\//;

/** "10월 중", "10월" */
const KOREAN_MONTH = /(\d{1,2})\s*월/;

/** 선행 2자리 연도. "22. 10. 8.~10." 의 맨 앞 22를 월로 오인하지 않기 위한 것. */
const LEADING_YY = /^\s*['"]?(\d{2})\s*[.\-/]\s*/;

/** "5.27", "10.4", "4.5." — 월.일 표기의 첫 등장 */
const MONTH_DOT_DAY = /(\d{1,2})\s*[.\-/]\s*(\d{1,2})/;

function validMonth(n: number): number | null {
    return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

/**
 * @param periodRaw 원문 개최기간
 * @param datasetYear 해당 행의 연도. 선행 2자리 연도("22. 10. 8.")를 걷어내는 데 쓴다.
 */
export function parseStartMonth(periodRaw: string | null, datasetYear?: number): number | null {
    if (!periodRaw) return null;
    const text = periodRaw.trim();
    if (text.length === 0) return null;

    // 1) 슬래시 표기는 구조가 명확하다. 두 번째 조각이 월이다.
    const slash = SLASH_FORMAT.exec(text);
    if (slash) return validMonth(Number(slash[2]));

    // 2) "N월" 표기가 있으면 그것을 최우선으로 믿는다("10월 중"처럼 일자가 없는 경우).
    //    단 월.일 표기가 더 앞에 있으면 그쪽이 시작월이다("5.12.~5.14. 6월 재공연").
    const korean = KOREAN_MONTH.exec(text);
    const dotFirst = MONTH_DOT_DAY.exec(text);
    if (korean && (!dotFirst || korean.index <= dotFirst.index)) {
        return validMonth(Number(korean[1]));
    }

    // 3) 선행 2자리 연도를 떼어낸다. dataset_year의 뒤 두 자리와 같을 때만 연도로 본다
    //    ("22. 10. 8." 의 22는 2022년). 아니면 월일 수 있으므로 손대지 않는다.
    let body = text;
    const yy = LEADING_YY.exec(text);
    if (yy && datasetYear !== undefined && Number(yy[1]) === datasetYear % 100) {
        body = text.slice(yy[0].length);
    }

    // 4) 일반형: 처음 나오는 "월.일"의 월
    const dot = MONTH_DOT_DAY.exec(body);
    if (dot) return validMonth(Number(dot[1]));

    // 5) 마지막 수단: 홀로 있는 1~12 숫자 하나뿐이면 그것을 월로 본다
    const lone = body.match(/\d{1,2}/g);
    if (lone && lone.length === 1) return validMonth(Number(lone[0]));

    return null;
}
