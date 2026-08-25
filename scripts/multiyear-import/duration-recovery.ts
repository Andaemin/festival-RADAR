/**
 * PHASE 27 — Duration Canonical Recovery. 순수 함수만 모아둔 모듈(I/O 없음, normalize.ts와
 * 같은 컨벤션 - 테스트에서 이 파일만 import해서 검증 가능하게 분리했다).
 *
 * 목적: canonical CSV의 `period_raw`(원문 보존 컬럼)에서, 규칙 기반으로 **결정적으로** 계산
 * 가능한 duration만 복구한다. Phase 26 감사에서 확정한 SAFE_RECOVERABLE 판정 기준을 그대로
 * 고정 이식했다(범위를 넓히지 않음) - 정규식/분류 로직은 `scripts/phase26-duration-venue-data-
 * integrity-audit.ts`의 `classifyDurationText`와 동일하되, 재사용 가능하도록 export하고
 * `recoveredDays`뿐 아니라 `rule`(=duration_source에 쓸 값)까지 함께 반환하도록 정리했다.
 *
 * 절대 자동 복구하지 않는 것(그대로 null 유지): 월단위("N월 중"), 계절 표현(봄/여름/가을/겨울/
 * 상반기/하반기), 반복 개최(매주/격주/상시), 복수 구간(줄바꿈/"/"/복수 "~", 단 총일수 주석이
 * 붙은 경우는 예외), 연도 미명시+월 역순(연도걸침 추정 필요), "미정" 등 명시적 TBD.
 */

export type DurationRecoveryCategory = "SAFE_RECOVERABLE" | "POSSIBLY_RECOVERABLE" | "NOT_RECOVERABLE";

/** canonical CSV의 `duration_source` 컬럼에 실제로 쓸 수 있는 기존 enum 값(Prisma
 *  `MultiYearDurationSource`: EXPLICIT_TEXT/SOURCE_TOTAL_DAYS/UNPARSED) 중에서 고른다 - 새
 *  literal을 만들지 않는다. 이 모듈이 하는 일은 전부 "period_raw의 명시적 텍스트에서 계산"이므로
 *  전부 기존 EXPLICIT_TEXT로 표기한다(2017-2021이 EXPLICIT_TEXT로 성공한 것과 동일한 의미). */
export const RECOVERY_DURATION_SOURCE = "EXPLICIT_TEXT" as const;

export interface DurationRecoveryResult {
  category: DurationRecoveryCategory;
  /** SAFE_RECOVERABLE일 때만 non-null. */
  recoveredDays: number | null;
  /** 세부 규칙 태그(리포트/CSV용) - Phase 26의 patternTag와 동일 명명. */
  rule: string;
}

const META_PAREN = /\(\s*(예정|확정|취소|잠정)\s*\)/g;
const DAYCOUNT_PAREN = /\((\d{1,2})\s*일간?\)/;
const TBD_TOKENS = new Set(["미정", "-", ".", "추후", "추후공지", "협의중"]);

/** 시작~종료(포함) inclusive day count. 2017-2021 EXPLICIT_TEXT golden 대조로 검증된 semantics
 *  (예: "5.25~5.26" = 2일, 같은 날 = 1일). 400일 초과/음수는 방어적으로 null(비정상 값 생성 방지). */
function daysBetween(y1: number, m1: number, d1: number, y2: number, m2: number, d2: number): number | null {
  const a = new Date(y1, m1 - 1, d1).getTime();
  const b = new Date(y2, m2 - 1, d2).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const diffDays = Math.round((b - a) / 86_400_000) + 1;
  return diffDays >= 1 && diffDays <= 400 ? diffDays : null;
}

/**
 * period_raw 원문 텍스트 하나를 분류하고, SAFE_RECOVERABLE이면 durationDays까지 계산한다.
 * datasetYear는 연도 미명시 날짜(예: "5.25~5.26")의 기준 연도로 쓰인다.
 *
 * durationNoteRaw(옵션): 2017년 golden parity 대조로 실제 확인된 사실 - 2017은 `duration_note_raw`
 * 컬럼에 "(N일간)" 형태의 명시적 총일수가 별도로 보존돼 있고, 기존 정상 duration_days는 이 값을
 * period_raw의 날짜 계산보다 **우선** 사용한다(예: period_raw="미정"인데 duration_note_raw=
 * "(2일간)"이면 existing duration_days=2 - period_raw만으로는 절대 재현 불가능했던 케이스).
 * 2022-2024(이번 Phase의 실제 복구 대상)는 duration_note_raw가 100% 비어있어 이 우선순위 규칙이
 * 실제 복구 결과에는 전혀 영향을 주지 않는다 - golden parity를 정확히 재현하기 위해서만 반영한다.
 */
export function classifyRecoverableDuration(periodRawIn: unknown, datasetYear: number, durationNoteRawIn?: unknown): DurationRecoveryResult {
  if (typeof durationNoteRawIn === "string") {
    const noteMatch = durationNoteRawIn.match(DAYCOUNT_PAREN);
    if (noteMatch) return { category: "SAFE_RECOVERABLE", recoveredDays: Number(noteMatch[1]), rule: "EXPLICIT_DAYCOUNT_NOTE" };
  }

  // period_raw는 대부분 문자열이지만, 원본 Excel 셀이 실제 날짜 서식이었던 극소수 행은 숫자
  // (엑셀 날짜 serial)로 넘어온다 - 짝이 되는 종료일 존재 여부가 불확실해 규칙 기반 결정을
  // 보류한다(추측 금지).
  if (periodRawIn !== null && periodRawIn !== undefined && typeof periodRawIn !== "string") {
    return { category: "POSSIBLY_RECOVERABLE", recoveredDays: null, rule: "NUMERIC_EXCEL_DATE_SERIAL" };
  }
  const raw0 = (periodRawIn ?? "").toString().trim();
  if (raw0 === "") return { category: "NOT_RECOVERABLE", recoveredDays: null, rule: "EMPTY" };
  if (TBD_TOKENS.has(raw0)) return { category: "NOT_RECOVERABLE", recoveredDays: null, rule: "TBD_PLACEHOLDER" };

  const daycountMatch = raw0.match(DAYCOUNT_PAREN);
  const stripped = raw0.replace(META_PAREN, "").trim();

  if (/매주|격주|상시|정기적/.test(raw0)) return { category: "POSSIBLY_RECOVERABLE", recoveredDays: null, rule: "RECURRING" };
  if (/\n|\r|\//.test(raw0) || (raw0.match(/[~\-∼]/g) ?? []).length > 1) {
    // 총일수 주석("(N일간)")이 정확히 1개뿐일 때만 SAFE로 취급한다. golden parity 대조로 실제
    // 확인된 반례가 있다 - "07월~08월 (30일간) 12월~02월 (60일간)"처럼 세그먼트마다 서로 다른
    // 일수 주석이 여러 개 붙어있으면 어느 것이 "그" duration인지 결정적으로 알 수 없다(기존 값은
    // 60이었는데 첫 번째 주석은 30) - 이런 경우까지 SAFE로 넓히지 않는다(6절 원칙).
    const daycountMatchesAll = raw0.match(new RegExp(DAYCOUNT_PAREN.source, "g")) ?? [];
    if (daycountMatchesAll.length === 1 && daycountMatch) {
      return { category: "SAFE_RECOVERABLE", recoveredDays: Number(daycountMatch[1]), rule: "MULTI_SEGMENT_WITH_DAYCOUNT" };
    }
    return { category: "POSSIBLY_RECOVERABLE", recoveredDays: null, rule: "MULTI_SEGMENT" };
  }
  if (/봄|여름|가을|겨울|상반기|하반기/.test(raw0)) return { category: "POSSIBLY_RECOVERABLE", recoveredDays: null, rule: "SEASON_WORD" };
  if (/중\s*$|^\d{1,2}\s*[~\-]\s*\d{1,2}\s*월/.test(stripped) || /^\d{1,2}\s*월\s*(중|초|말|초순|중순|하순)?\s*$/.test(stripped)) {
    return { category: "POSSIBLY_RECOVERABLE", recoveredDays: null, rule: "MONTH_ONLY" };
  }

  if (daycountMatch) {
    return { category: "SAFE_RECOVERABLE", recoveredDays: Number(daycountMatch[1]), rule: "EXPLICIT_DAYCOUNT_ANNOTATION" };
  }

  const rangeFull = stripped.match(
    /^'?(\d{2,4})?\.?\s*(\d{1,2})\s*\.\s*(\d{1,2})\.?\s*[~\-∼]\s*'?(\d{2,4})?\.?\s*(\d{1,2})\s*\.\s*(\d{1,2})\.?$/
  );
  if (rangeFull) {
    const [, y1s, m1s, d1s, y2s, m2s, d2s] = rangeFull;
    const m1 = Number(m1s), d1 = Number(d1s), m2 = Number(m2s), d2 = Number(d2s);
    if (m1 >= 1 && m1 <= 12 && d1 >= 1 && d1 <= 31 && m2 >= 1 && m2 <= 12 && d2 >= 1 && d2 <= 31) {
      const y1 = y1s ? (y1s.length === 2 ? 2000 + Number(y1s) : Number(y1s)) : datasetYear;
      let y2 = y2s ? (y2s.length === 2 ? 2000 + Number(y2s) : Number(y2s)) : datasetYear;
      if (!y1s && !y2s && m2 < m1) {
        return { category: "POSSIBLY_RECOVERABLE", recoveredDays: null, rule: "AMBIGUOUS_YEAR_WRAP" };
      }
      if (!y2s && y1s) y2 = y1;
      const days = daysBetween(y1, m1, d1, y2, m2, d2);
      if (days !== null) return { category: "SAFE_RECOVERABLE", recoveredDays: days, rule: "EXPLICIT_RANGE_FULL" };
    }
  }

  const rangeShort = stripped.match(/^'?(\d{2,4})?\.?\s*(\d{1,2})\s*\.\s*(\d{1,2})\.?\s*[~\-∼]\s*(\d{1,2})\.?$/);
  if (rangeShort) {
    const [, ys, ms, d1s, d2s] = rangeShort;
    const m = Number(ms), d1 = Number(d1s), d2 = Number(d2s);
    if (m >= 1 && m <= 12 && d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31 && d2 >= d1) {
      const y = ys ? (ys.length === 2 ? 2000 + Number(ys) : Number(ys)) : datasetYear;
      const days = daysBetween(y, m, d1, y, m, d2);
      if (days !== null) return { category: "SAFE_RECOVERABLE", recoveredDays: days, rule: "EXPLICIT_RANGE_SHORTHAND" };
    }
  }

  const single = stripped.match(/^'?(\d{2,4})?\.?\s*(\d{1,2})\s*\.\s*(\d{1,2})\.?$/);
  if (single) {
    const [, , ms, ds] = single;
    const m = Number(ms), d = Number(ds);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { category: "SAFE_RECOVERABLE", recoveredDays: 1, rule: "SINGLE_DATE" };
  }

  if (/\d/.test(stripped)) return { category: "POSSIBLY_RECOVERABLE", recoveredDays: null, rule: "OTHER_WITH_DIGITS" };
  return { category: "NOT_RECOVERABLE", recoveredDays: null, rule: "NO_DATE_INFO" };
}
