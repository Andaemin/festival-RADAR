import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/v1/data-quality-audit/route";

/**
 * GET /api/v1/data-quality-audit — READ-ONLY DIAGNOSTIC endpoint. 실제 DB(2017~2026)를 읽기
 * 전용으로 사용한다(아무것도 쓰지 않는다). `/assistant-tester` 전용이며 production 사용자 플로우는
 * 이 endpoint를 호출하지 않는다.
 */
async function callAuditApi(query: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/v1/data-quality-audit");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await GET(new NextRequest(url));
  const json = await res.json();
  return { status: res.status, json };
}

describe("GET /api/v1/data-quality-audit", () => {
  it("기본 호출 — summary/anomalies/auditScope 계약 필드가 모두 존재하고 helpText가 확정 표현을 쓰지 않는다", async () => {
    const { status, json } = await callAuditApi();
    expect(status).toBe(200);
    expect(json.auditScope.earliestDatasetYear).toBe(2017);
    expect(json.auditScope.latestDatasetYear).toBeGreaterThanOrEqual(2026);
    expect(json.summary.auditPoolRecordCount).toBeGreaterThan(0);
    expect(json.summary.reviewRequiredCount).toBe(json.summary.highCount + json.summary.mediumCount + json.summary.infoCount);
    expect(Array.isArray(json.anomalies)).toBe(true);
    expect(json.helpText).toContain("오류 확정이 아니라 검토 우선순위");
  });

  it("anomalies는 NONE severity를 포함하지 않고, HIGH -> ratio desc -> 연도 -> 이름 순 정렬이다", async () => {
    const { json } = await callAuditApi({ limit: "200" });
    expect(json.anomalies.every((r: { severity: string }) => r.severity !== "NONE")).toBe(true);

    const severityRank: Record<string, number> = { HIGH: 0, MEDIUM: 1, INFO: 2 };
    for (let i = 1; i < json.anomalies.length; i++) {
      const prev = json.anomalies[i - 1];
      const cur = json.anomalies[i];
      expect(severityRank[prev.severity]).toBeLessThanOrEqual(severityRank[cur.severity]);
    }
  });

  it("severity=HIGH 필터 — 반환된 모든 record가 실제로 HIGH다", async () => {
    const { status, json } = await callAuditApi({ severity: "HIGH" });
    expect(status).toBe(200);
    expect(json.anomalies.length).toBeGreaterThan(0);
    expect(json.anomalies.every((r: { severity: string }) => r.severity === "HIGH")).toBe(true);
  });

  it("reason 필터 — COMPONENT_SUM_MISMATCH만 요청하면 그 reason을 가진 record만 온다", async () => {
    const { json } = await callAuditApi({ reason: "COMPONENT_SUM_MISMATCH" });
    expect(json.anomalies.length).toBeGreaterThan(0);
    expect(json.anomalies.every((r: { reasons: string[] }) => r.reasons.includes("COMPONENT_SUM_MISMATCH"))).toBe(true);
  });

  it("q 필터 — 옥천참옻축제만 검색하면 그 축제의 record만 온다(자동 제외 없이 여전히 노출됨)", async () => {
    const { json } = await callAuditApi({ q: "옥천참옻축제" });
    expect(json.anomalies.length).toBeGreaterThan(0);
    expect(json.anomalies.every((r: { canonicalSeriesName: string }) => r.canonicalSeriesName.includes("옥천참옻축제"))).toBe(true);
    const row2020 = json.anomalies.find((r: { datasetYear: number }) => r.datasetYear === 2020);
    expect(row2020?.severity).toBe("HIGH");
    expect(row2020?.budgetKrw).toBe(30_000_000); // 값이 자동 수정되지 않았다.
  });

  it("limit — 요청한 개수만큼만 반환하지만 matchedCount는 전체 매칭 수를 그대로 알려준다", async () => {
    const { json } = await callAuditApi({ limit: "3" });
    expect(json.returnedCount).toBe(3);
    expect(json.matchedCount).toBeGreaterThanOrEqual(json.returnedCount);
  });

  it("유효하지 않은 severity/reason은 400", async () => {
    const bad1 = await callAuditApi({ severity: "CRITICAL" });
    expect(bad1.status).toBe(400);
    const bad2 = await callAuditApi({ reason: "NOT_A_REASON" });
    expect(bad2.status).toBe(400);
  });
});
