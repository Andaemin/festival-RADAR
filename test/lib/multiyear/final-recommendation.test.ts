import { describe, expect, it } from "vitest";
import { computeFinalPeerRecommendation } from "@/lib/multiyear/final-recommendation";

/**
 * PHASE 19-A — Peer 최종 recommendation(= max(estimated, P60), confidence-derived contingency
 * 완전 제거)의 계약을 검증한다. 함수 시그니처 자체가 confidence/dataQuality 인자를 받지 않으므로
 * "legacy confidence가 recommendation에 영향을 줄 수 없다"는 것이 타입 수준에서부터 보장된다 -
 * 아래 테스트는 그 동작(estimated/p60만으로 값이 정해짐)을 값 수준에서도 재확인한다.
 */
describe("computeFinalPeerRecommendation", () => {
  it("estimated > p60이면 estimated 그대로(추가 contingency 없음)", () => {
    expect(computeFinalPeerRecommendation(100_000_000, 90_000_000)).toBe(100_000_000);
  });

  it("p60 > estimated이면 p60 floor를 그대로 쓴다(추가 contingency 없음)", () => {
    expect(computeFinalPeerRecommendation(80_000_000, 100_000_000)).toBe(100_000_000);
  });

  it("estimated === p60이면 그 값 그대로", () => {
    expect(computeFinalPeerRecommendation(100_000_000, 100_000_000)).toBe(100_000_000);
  });

  it("동일한 (estimated, p60) 입력이면 항상 동일한 값을 낸다 - 다른 호출 컨텍스트(예: sampleCount/similarity/completeness 변화)가 끼어들 여지가 시그니처상 없다", () => {
    const a = computeFinalPeerRecommendation(123_456_789, 100_000_000);
    const b = computeFinalPeerRecommendation(123_456_789, 100_000_000);
    expect(a).toBe(b);
    expect(a).toBe(123_456_789);
  });
});
