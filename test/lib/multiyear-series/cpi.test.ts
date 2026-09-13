import { describe, expect, it } from "vitest";
import { CPI_TABLE, tryAdjustForCpi } from "@/lib/multiyear-series/cpi";

/**
 * Feature: KOSIS CPI OpenAPI 연동 — tryAdjustForCpi에 새로 추가된 optional `cpiTable` 인자를
 * 검증한다. 계산식 자체(adjustedBudget = source × cpiTable[planningYear-1] / cpiTable[sourceYear])는
 * 전혀 바뀌지 않았다 - 이 테스트는 "어느 table을 넘기든 같은 식이 그대로 적용된다"와 "인자를
 * 생략하면 기존과 100% 동일하게 static CPI_TABLE을 쓴다"만 확인한다.
 */
describe("tryAdjustForCpi — cpiTable 인자(KOSIS 연동 additive 변경)", () => {
  it("cpiTable 생략 시 기존과 완전히 동일(static CPI_TABLE)하게 계산한다", () => {
    const withoutArg = tryAdjustForCpi(100_000_000, 2017, 2020);
    const withExplicitStatic = tryAdjustForCpi(100_000_000, 2017, 2020, CPI_TABLE);
    expect(withoutArg).not.toBeNull();
    expect(withoutArg).toBe(withExplicitStatic);
    expect(withoutArg).toBeCloseTo(100_000_000 * (CPI_TABLE[2019] / CPI_TABLE[2017]), 6);
  });

  it("KOSIS 모양의 custom cpiTable을 넘기면 그 table 값으로 정확히 계산한다(같은 공식, 다른 source)", () => {
    const kosisShapedTable = { 2017: 100.0, 2018: 105.0 };
    const adjusted = tryAdjustForCpi(100_000_000, 2017, 2019, kosisShapedTable);
    // baseYear = planningYear-1 = 2018.
    expect(adjusted).toBeCloseTo(100_000_000 * (105.0 / 100.0), 6);
  });

  it("custom cpiTable에 baseYear(planningYear-1)가 없으면 null(가장 가까운 값으로 대체하지 않음)", () => {
    const kosisShapedTable = { 2017: 100.0 }; // 2018 없음.
    expect(tryAdjustForCpi(100_000_000, 2017, 2019, kosisShapedTable)).toBeNull();
  });

  it("custom cpiTable에 sourceYear가 없으면 null", () => {
    const kosisShapedTable = { 2018: 105.0 }; // 2017(sourceYear) 없음.
    expect(tryAdjustForCpi(100_000_000, 2017, 2019, kosisShapedTable)).toBeNull();
  });

  it("KOSIS fallback 시나리오: KOSIS가 planningYear-1을 아직 발표하지 않은 custom table을 넘겨도 " +
    "추정치를 만들어내지 않고 null을 반환한다(§7 - 월별 평균/보간/직전 연도 복사 금지)", () => {
    // 예: planningYear=2027인데 KOSIS가 아직 2026년 연간 CPI를 발표하지 않은 상황을 흉내낸다.
    const kosisWithoutLatestYear = { 2017: 97.645, 2018: 99.086, 2019: 99.466, 2020: 100.0, 2021: 102.5, 2022: 107.72, 2023: 111.59, 2024: 114.18, 2025: 116.61 };
    expect(tryAdjustForCpi(100_000_000, 2020, 2027, kosisWithoutLatestYear)).toBeNull();
  });
});
