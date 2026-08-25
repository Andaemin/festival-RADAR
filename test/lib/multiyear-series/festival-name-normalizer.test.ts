import { describe, expect, it } from "vitest";
import { fuzzyKey, normalizeFestivalName } from "@/lib/multiyear-series/festival-name-normalizer";

/**
 * Spring FestivalNameNormalizer(frozen) 포팅 검증 - Spring Javadoc의 목표 예시를 그대로 옮겨
 * DB 없이 순수 함수로 검증한다. threshold/규칙 자체를 여기서 바꾸지 않는다.
 */
describe("normalizeFestivalName", () => {
  it("앞쪽 연도를 제거한다", () => {
    expect(normalizeFestivalName("2025 무주반딧불축제")).toBe("무주반딧불축제");
    expect(normalizeFestivalName("2025년 무주반딧불축제")).toBe("무주반딧불축제");
  });

  it("제n회/n회 회차 표기를 제거한다", () => {
    expect(normalizeFestivalName("제27회 무주반딧불축제")).toBe("무주반딧불축제");
    expect(normalizeFestivalName("제 27 회 무주반딧불축제")).toBe("무주반딧불축제");
    expect(normalizeFestivalName("27회 무주반딧불축제")).toBe("무주반딧불축제");
  });

  it("연도/회차/숫자만 있는 괄호 그룹만 제거하고 그 외 괄호는 보존한다", () => {
    expect(normalizeFestivalName("이름(2025)")).toBe("이름");
    expect(normalizeFestivalName("이름(제27회)")).toBe("이름");
    expect(normalizeFestivalName("이름(부제목)")).toBe("이름(부제목)");
  });

  it("장식용 괄호/인용부호를 제거한다", () => {
    expect(normalizeFestivalName("「이름」축제")).toBe("이름축제");
    expect(normalizeFestivalName("『이름』축제")).toBe("이름축제");
  });

  it("이름 내부 공백은 지우지 않는다 - fuzzy 신호로만 쓴다", () => {
    expect(normalizeFestivalName("무주 반딧불축제")).toBe("무주 반딧불축제");
  });

  it("회차/연도 문맥이 아닌 숫자는 보존한다", () => {
    expect(normalizeFestivalName("3.1운동 100주년 기념축제")).toContain("3.1운동");
  });

  it("정규화 결과가 빈 문자열이면 원본 trim값으로 폴백한다", () => {
    expect(normalizeFestivalName("2025")).toBe("2025");
  });

  it("null/undefined는 빈 문자열", () => {
    expect(normalizeFestivalName(null)).toBe("");
    expect(normalizeFestivalName(undefined)).toBe("");
  });

  it("가장자리 연결부호(하이픈 등)를 정리한다", () => {
    expect(normalizeFestivalName("- 이름축제 -")).toBe("이름축제");
  });
});

describe("fuzzyKey", () => {
  it("공백을 전부 제거한다", () => {
    expect(fuzzyKey("무주 반딧불축제")).toBe("무주반딧불축제");
  });

  it("같은 축제의 공백 표기 차이를 동일한 키로 수렴시킨다", () => {
    const a = fuzzyKey(normalizeFestivalName("제16회 진안고원 운장산고로쇠축제"));
    const b = fuzzyKey(normalizeFestivalName("진안고원운장산 고로쇠축제"));
    const c = fuzzyKey(normalizeFestivalName("제16회 진안고원운장산고로쇠축제"));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
