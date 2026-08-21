import { describe, expect, it } from "vitest";
import { ReferenceDataPolicy, resolveEffectivePolicy } from "@/lib/multiyear/reference-data-policy";

/**
 * 순수 함수 단위 테스트 - status row 없음/PARTIAL/PUBLISHED_PLAN_COMPLETE 3가지 statusLookup
 * 결과에 대한 downgrade 판정을 DB 없이 직접 검증한다. HTTP 레벨 시나리오(2020년처럼 실제로 row가
 * 없는 연도, 2025/2026처럼 실제 COMPLETE인 연도)는 test/api/multiyear-budget-estimates.test.ts에서
 * 별도로 검증한다 - 여기서는 "PARTIAL 명시 row"와 "row 자체 없음"이 결과적으로 동일하게
 * 처리되는지까지 포함해 resolveEffectivePolicy 자체의 판정 로직만 좁게 확인한다.
 */
describe("resolveEffectivePolicy", () => {
  it("HISTORICAL_ONLY 요청은 status와 무관하게 항상 HISTORICAL_ONLY", () => {
    expect(resolveEffectivePolicy(2026, ReferenceDataPolicy.HISTORICAL_ONLY, () => "PUBLISHED_PLAN_COMPLETE")).toBe(
      ReferenceDataPolicy.HISTORICAL_ONLY
    );
    expect(resolveEffectivePolicy(2026, ReferenceDataPolicy.HISTORICAL_ONLY, () => null)).toBe(ReferenceDataPolicy.HISTORICAL_ONLY);
  });

  it("SAME_YEAR 요청 + status row 없음(null) -> HISTORICAL_ONLY로 downgrade", () => {
    const applied = resolveEffectivePolicy(2026, ReferenceDataPolicy.INCLUDE_PUBLISHED_SAME_YEAR, () => null);
    expect(applied).toBe(ReferenceDataPolicy.HISTORICAL_ONLY);
  });

  it("SAME_YEAR 요청 + 명시적 PARTIAL row -> HISTORICAL_ONLY로 downgrade", () => {
    const applied = resolveEffectivePolicy(2026, ReferenceDataPolicy.INCLUDE_PUBLISHED_SAME_YEAR, () => "PARTIAL");
    expect(applied).toBe(ReferenceDataPolicy.HISTORICAL_ONLY);
  });

  it("SAME_YEAR 요청 + PUBLISHED_PLAN_COMPLETE -> 그대로 INCLUDE_PUBLISHED_SAME_YEAR", () => {
    const applied = resolveEffectivePolicy(2026, ReferenceDataPolicy.INCLUDE_PUBLISHED_SAME_YEAR, () => "PUBLISHED_PLAN_COMPLETE");
    expect(applied).toBe(ReferenceDataPolicy.INCLUDE_PUBLISHED_SAME_YEAR);
  });

  it("statusLookup은 planningYear로만 조회한다(다른 연도 상태에 영향받지 않음)", () => {
    const applied = resolveEffectivePolicy(2027, ReferenceDataPolicy.INCLUDE_PUBLISHED_SAME_YEAR, (year) =>
      year === 2027 ? "PUBLISHED_PLAN_COMPLETE" : "PARTIAL"
    );
    expect(applied).toBe(ReferenceDataPolicy.INCLUDE_PUBLISHED_SAME_YEAR);
  });
});
