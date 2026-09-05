import { afterAll, describe, expect, it } from "vitest";
import { GET, __resetReliabilityAuditCacheForTests } from "@/app/api/v1/reliability-audit/route";

/**
 * GET /api/v1/reliability-audit — READ-ONLY DIAGNOSTIC endpoint. 실제 DB(2017~2026)를 읽기
 * 전용으로 사용한다(아무것도 쓰지 않는다). `/assistant-tester` 전용이며 production 사용자
 * 플로우는 이 endpoint를 호출하지 않는다.
 */
describe("GET /api/v1/reliability-audit", () => {
  afterAll(() => {
    __resetReliabilityAuditCacheForTests();
  });

  // 이 수치는 canonical CSV에 종속된다. 원본 교체 시 함께 갱신할 것.
  // festival_2017_2026.csv 기준(2026-09-04): 이전 sanitized 판에서 n=2242/HIGH=1200/MEDIUM=1042.
  // 예산 자릿수 오류 10건이 교정되며 분석 가능한 series가 9개 늘었다.
  it("baseline parity(spec 1절) 계약 - n=2251, HIGH=1211, MEDIUM=1040, helpText가 확정 표현을 쓰지 않는다", async () => {
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.summary.seriesN).toBe(2251);
    const high = json.summary.tiers.find((t: { tier: string }) => t.tier === "HIGH");
    const medium = json.summary.tiers.find((t: { tier: string }) => t.tier === "MEDIUM");
    expect(high.n).toBe(1211);
    expect(medium.n).toBe(1040);
    expect(json.helpText).toContain("이 예산이 맞을 확률");
  }, 60_000);

  it("두 번째 호출은 캐시를 재사용한다(같은 dataRevision이면 동일 promise, 재계산 없이 빠르게 응답)", async () => {
    const start = Date.now();
    const res = await GET();
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(2000); // 재계산이면 수 초가 걸린다 - 캐시 hit이면 즉시 응답.
  });
});
