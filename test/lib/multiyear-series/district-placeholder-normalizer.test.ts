import { describe, expect, it } from "vitest";
import { isRegionLevelPlaceholder } from "@/lib/multiyear-series/district-placeholder-normalizer";

/** Spring DistrictPlaceholderNormalizer(frozen) 포팅 검증. */
describe("isRegionLevelPlaceholder", () => {
  it("null/undefined/빈 문자열은 placeholder", () => {
    expect(isRegionLevelPlaceholder(null)).toBe(true);
    expect(isRegionLevelPlaceholder(undefined)).toBe(true);
    expect(isRegionLevelPlaceholder("")).toBe(true);
    expect(isRegionLevelPlaceholder("   ")).toBe(true);
  });

  it("범용 placeholder 값들", () => {
    for (const v of ["-", "시자체", "본청", "도", "시", "지자체", "도자체", "미기재"]) {
      expect(isRegionLevelPlaceholder(v)).toBe(true);
    }
  });

  it("광역지역명을 그대로 반복한 값도 placeholder", () => {
    expect(isRegionLevelPlaceholder("서울시")).toBe(true);
    expect(isRegionLevelPlaceholder("제주도")).toBe(true);
  });

  it("trailing 괄호 부연설명을 뗀 뒤 재판정한다", () => {
    expect(isRegionLevelPlaceholder("시자체 (문화재단)")).toBe(true);
    expect(isRegionLevelPlaceholder("도자체 (관광과)")).toBe(true);
  });

  it("실제 시군구는 placeholder가 아니다", () => {
    expect(isRegionLevelPlaceholder("진안군")).toBe(false);
    expect(isRegionLevelPlaceholder("강남구")).toBe(false);
    expect(isRegionLevelPlaceholder("수원시 장안구")).toBe(false);
  });

  it("접미어가 붙은 실제 시군구는 의도적으로 placeholder 처리하지 않는다(Spring frozen 설계)", () => {
    expect(isRegionLevelPlaceholder("중구청")).toBe(false);
  });

  it("부분 문자열이 아니라 정확히 일치할 때만 placeholder", () => {
    // "시자체"를 포함하지만 완전히 일치하지 않는 값
    expect(isRegionLevelPlaceholder("시자체 강화군")).toBe(false);
  });
});
