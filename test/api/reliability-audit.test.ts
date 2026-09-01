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

  it("baseline parity(spec 1절) 계약 - n=2242, HIGH=1200, MEDIUM=1042, helpText가 확정 표현을 쓰지 않는다", async () => {
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.summary.seriesN).toBe(2242);
    const high = json.summary.tiers.find((t: { tier: string }) => t.tier === "HIGH");
    const medium = json.summary.tiers.find((t: { tier: string }) => t.tier === "MEDIUM");
    expect(high.n).toBe(1200);
    expect(medium.n).toBe(1042);
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
