import { describe, expect, it } from "vitest";
import { classifyRecoverableDuration } from "../../../scripts/multiyear-import/duration-recovery";

/**
 * PHASE 27 — duration recovery 단위 테스트. 모든 케이스는 실제 canonical CSV의 2022-2024
 * UNPARSED period_raw에서 관찰된 실제 패턴에 기반한다(존재하지 않는 format을 과도하게 지원하지
 * 않는다).
 */
describe("classifyRecoverableDuration - SAFE_RECOVERABLE(결정적 계산 가능)", () => {
  it("단순 범위: 5.25~5.26 → 2일(inclusive)", () => {
    const r = classifyRecoverableDuration("5.25~5.26", 2024);
    expect(r.category).toBe("SAFE_RECOVERABLE");
    expect(r.recoveredDays).toBe(2);
    expect(r.rule).toBe("EXPLICIT_RANGE_FULL");
  });

  it("동일일: 5.25~5.25 → 1일", () => {
    const r = classifyRecoverableDuration("5.25~5.25", 2024);
    expect(r.category).toBe("SAFE_RECOVERABLE");
    expect(r.recoveredDays).toBe(1);
  });

  it("단일일자(구분자 없음): 3.9. → 1일", () => {
    const r = classifyRecoverableDuration("3.9.", 2024);
    expect(r.category).toBe("SAFE_RECOVERABLE");
    expect(r.recoveredDays).toBe(1);
    expect(r.rule).toBe("SINGLE_DATE");
  });

  it("명시 일수 주석(실제 2022-2024 데이터에서 관찰된 형태): 10월(3일간) → 3일", () => {
    // "N~N월(3일간)"처럼 문자열이 "N~N월"로 *시작*하는 형태는 month-only 판정이 먼저
    // 걸려 POSSIBLY로 빠진다(아래 별도 테스트) - EXPLICIT_DAYCOUNT_ANNOTATION이 실제로
    // 살아남는 실데이터 형태("10월(3일간)", "4월 중 (3일간)" 등)로 검증한다.
    const r = classifyRecoverableDuration("10월(3일간)", 2022);
    expect(r.category).toBe("SAFE_RECOVERABLE");
    expect(r.recoveredDays).toBe(3);
    expect(r.rule).toBe("EXPLICIT_DAYCOUNT_ANNOTATION");
  });

  it("명시 일수 주석(월 중 + 일수, 실제 데이터): 4월 중 (3일간) → 3일", () => {
    const r = classifyRecoverableDuration("4월 중 (3일간)", 2024);
    expect(r.category).toBe("SAFE_RECOVERABLE");
    expect(r.recoveredDays).toBe(3);
    expect(r.rule).toBe("EXPLICIT_DAYCOUNT_ANNOTATION");
  });

  it("같은 달 축약형: 9.24.~25. → 2일", () => {
    const r = classifyRecoverableDuration("9.24.~25.", 2022);
    expect(r.category).toBe("SAFE_RECOVERABLE");
    expect(r.recoveredDays).toBe(2);
    expect(r.rule).toBe("EXPLICIT_RANGE_SHORTHAND");
  });

  it("연도 경계(양쪽 연도 명시, 연말→연초): 24. 12. 20. ~ '25. 1. 12. → 24일", () => {
    const r = classifyRecoverableDuration("24. 12. 20. ~ '25. 1. 12.", 2024);
    expect(r.category).toBe("SAFE_RECOVERABLE");
    expect(r.recoveredDays).toBe(24);
    expect(r.rule).toBe("EXPLICIT_RANGE_FULL");
  });

  it("연도 경계(실제 2024 데이터): 12. 31. ~ 1. 1. → 연도 미명시 + 월 역순은 추측하지 않고 POSSIBLY", () => {
    // "12. 31. ~ 1. 1."처럼 양쪽 다 연도가 없고 월이 거꾸로면(12→1) 연도 걸침 여부를
    // 확신할 수 없어 SAFE로 자동 처리하지 않는다(AMBIGUOUS_YEAR_WRAP) - 안전 우선.
    const r = classifyRecoverableDuration("12. 31. ~ 1. 1.", 2024);
    expect(r.category).toBe("POSSIBLY_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
    expect(r.rule).toBe("AMBIGUOUS_YEAR_WRAP");
  });

  it("점 없는 범위: 9.30~10.2 → 3일", () => {
    const r = classifyRecoverableDuration("9.30~10.2", 2022);
    expect(r.category).toBe("SAFE_RECOVERABLE");
    expect(r.recoveredDays).toBe(3);
  });

  it("예정 등 meta 주석은 무시하고 계산: 10.04.~10.05.(예정) → 2일", () => {
    const r = classifyRecoverableDuration("10.04.~10.05.(예정)", 2024);
    expect(r.category).toBe("SAFE_RECOVERABLE");
    expect(r.recoveredDays).toBe(2);
  });
});

describe("classifyRecoverableDuration - duration_note_raw 우선순위(2017 golden parity로 실제 확인된 semantics)", () => {
  it("period_raw가 '미정'이어도 duration_note_raw에 명시 일수가 있으면 그것을 우선 사용(실제 2017 데이터)", () => {
    const r = classifyRecoverableDuration("미정", 2017, "(2일간)");
    expect(r.category).toBe("SAFE_RECOVERABLE");
    expect(r.recoveredDays).toBe(2);
    expect(r.rule).toBe("EXPLICIT_DAYCOUNT_NOTE");
  });

  it("period_raw 날짜범위와 duration_note_raw가 둘 다 있으면 duration_note_raw가 이긴다(실제 2017 데이터: 8.11~8.13인데 실제 값은 2)", () => {
    const r = classifyRecoverableDuration("8.11~8.13", 2017, "(2일간)");
    expect(r.category).toBe("SAFE_RECOVERABLE");
    expect(r.recoveredDays).toBe(2); // period_raw만으로 계산하면 3(inclusive)이 되지만 note가 우선
    expect(r.rule).toBe("EXPLICIT_DAYCOUNT_NOTE");
  });

  it("duration_note_raw가 '(미정)'처럼 명시 일수가 없으면 period_raw 로직으로 폴백", () => {
    const r = classifyRecoverableDuration("9월 ~ 10월 중", 2017, "(미정)");
    expect(r.category).toBe("POSSIBLY_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
  });

  it("2022-2024(이번 Phase 실제 복구 대상)는 duration_note_raw가 없으므로 기존 period_raw 로직 그대로 동작", () => {
    const r = classifyRecoverableDuration("5.25~5.26", 2024, null);
    expect(r.category).toBe("SAFE_RECOVERABLE");
    expect(r.recoveredDays).toBe(2);
    expect(r.rule).toBe("EXPLICIT_RANGE_FULL");
  });
});

describe("classifyRecoverableDuration - 자동 복구 금지(NOT/POSSIBLY_RECOVERABLE, null 유지)", () => {
  it("월 단위: 5월중 → null(POSSIBLY)", () => {
    const r = classifyRecoverableDuration("5월중", 2024);
    expect(r.category).toBe("POSSIBLY_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
    expect(r.rule).toBe("MONTH_ONLY");
  });

  it("월 범위: 9~10월 → null(POSSIBLY)", () => {
    const r = classifyRecoverableDuration("9~10월", 2022);
    expect(r.category).toBe("POSSIBLY_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
  });

  it("반복 개최: 매주 토요일 → null(POSSIBLY)", () => {
    const r = classifyRecoverableDuration("매주 토요일", 2023);
    expect(r.category).toBe("POSSIBLY_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
    expect(r.rule).toBe("RECURRING");
  });

  it("계절 범위: 7~8월 → null(POSSIBLY, MONTH_ONLY)", () => {
    const r = classifyRecoverableDuration("7~8월", 2022);
    expect(r.category).toBe("POSSIBLY_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
  });

  it("계절+복수구간(실데이터): 봄(5.12.~5.14.). 여름(7.28.~8.13.) → null(POSSIBLY, 복수 '~'이라 MULTI_SEGMENT가 우선 판정)", () => {
    const r = classifyRecoverableDuration("봄(5.12.~5.14.). 여름(7.28.~8.13.)", 2023);
    expect(r.category).toBe("POSSIBLY_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
    expect(r.rule).toBe("MULTI_SEGMENT");
  });

  it("계절 단어 단독(복수구간 아님): 상반기~하반기 진행 → null(POSSIBLY, SEASON_WORD)", () => {
    const r = classifyRecoverableDuration("상반기~하반기 진행", 2023);
    expect(r.category).toBe("POSSIBLY_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
    expect(r.rule).toBe("SEASON_WORD");
  });

  it("명시적 미정: 미정 → null(NOT_RECOVERABLE)", () => {
    const r = classifyRecoverableDuration("미정", 2023);
    expect(r.category).toBe("NOT_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
    expect(r.rule).toBe("TBD_PLACEHOLDER");
  });

  it("빈 값: null → NOT_RECOVERABLE", () => {
    const r = classifyRecoverableDuration(null, 2023);
    expect(r.category).toBe("NOT_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
  });

  it("복수 구간 + 반복(실데이터, 줄바꿈): 상반기.../하반기... 매주 일요일 → null(POSSIBLY, '매주' 포함이라 RECURRING이 우선 판정)", () => {
    const r = classifyRecoverableDuration("-상반기:4.30.~7.2. 매주 일요일(10회)\n-하반기:9.3.~11.12. 매주 일요일(10회)", 2023);
    expect(r.category).toBe("POSSIBLY_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
    expect(r.rule).toBe("RECURRING");
  });

  it("복수 구간(반복 표현 없음, 실데이터): 5.5.~6.23./9.1.~10.27. → null(POSSIBLY, MULTI_SEGMENT)", () => {
    const r = classifyRecoverableDuration("5.5.~6.23./9.1.~10.27.", 2024);
    expect(r.category).toBe("POSSIBLY_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
    expect(r.rule).toBe("MULTI_SEGMENT");
  });

  it("월범위로 *시작*하는 일수주석은 month-only 판정이 우선(보수적): 3~4월(3일간) → null(POSSIBLY)", () => {
    // "N~N월"로 문자열이 시작하면 뒤에 명시 일수가 있어도 month-only 규칙이 먼저 걸린다 -
    // 의도된 보수적 동작(범위를 넓히지 않는다는 원칙에 따라 그대로 유지, SAFE로 승격하지 않음).
    const r = classifyRecoverableDuration("3~4월(3일간)", 2022);
    expect(r.category).toBe("POSSIBLY_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
    expect(r.rule).toBe("MONTH_ONLY");
  });

  it("숫자 있지만 정형 패턴 아님: 상시 → POSSIBLY_RECOVERABLE(RECURRING)", () => {
    const r = classifyRecoverableDuration("상시", 2023);
    expect(r.category).toBe("POSSIBLY_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
  });

  it("엑셀 날짜 serial(숫자)로 넘어온 값 → POSSIBLY_RECOVERABLE, 추측 안 함", () => {
    const r = classifyRecoverableDuration(45017.000601851854, 2023);
    expect(r.category).toBe("POSSIBLY_RECOVERABLE");
    expect(r.recoveredDays).toBeNull();
    expect(r.rule).toBe("NUMERIC_EXCEL_DATE_SERIAL");
  });
});
