import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/v1/multiyear-budget-estimates/route";

/**
 * PHASE — Final Production Benchmark & Future-Year Safety(route 레벨). 실제 DB(2017~2026)를
 * 읽기 전용으로 사용한다. G0 formula/CPI 정책/reliability threshold/Peer 로직은 이 Phase에서
 * 전혀 바뀌지 않는다 - 실제 production route(POST 핸들러)를 미래 planningYear/extreme input에
 * 그대로 적용했을 때 crash/NaN 없이 안전하게 동작하는지만 확인한다.
 */
const BASE_BODY = {
  regionCode: "BUSAN",
  festivalTypes: ["CULTURE_ART"],
  venueType: "GREEN",
  durationDays: 3,
};

async function callPlanningApi(body: Record<string, unknown>) {
  const req = new NextRequest("http://localhost/api/v1/multiyear-budget-estimates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  const json = await res.json();
  return { status: res.status, json };
}

function expectFiniteNonNegative(json: Record<string, unknown>, fields: string[]) {
  for (const f of fields) {
    const v = json[f];
    expect(typeof v, `${f} should be a number`).toBe("number");
    expect(Number.isFinite(v as number), `${f}=${v} should be finite`).toBe(true);
    expect(v as number, `${f}=${v} should be >= 0`).toBeGreaterThanOrEqual(0);
  }
}

describe("12. G0 gap transition future test(route 레벨 regression, 부산국제록페스티벌 latestHistoricalYear=2026)", () => {
  it("2027(gap=1)->LATEST, 2028(gap=2)->LATEST, 2029(gap=3)->MEDIAN, 2030(gap=4)->MEDIAN — production route에서 exact 확인", async () => {
    const expected = [
      { year: 2027, gap: 1, source: "LATEST" },
      { year: 2028, gap: 2, source: "LATEST" },
      { year: 2029, gap: 3, source: "MEDIAN" },
      { year: 2030, gap: 4, source: "MEDIAN" },
    ];
    for (const { year, gap, source } of expected) {
      const { status, json } = await callPlanningApi({ ...BASE_BODY, planningYear: year, festivalName: "부산국제록페스티벌" });
      expect(status).toBe(200);
      expect(json.seriesSignal.status).toBe("MATCHED");
      expect(json.seriesSignal.latestHistoricalYear).toBe(2026);
      expect(json.seriesSignal.latestHistoricalGap).toBe(gap);
      expect(json.seriesSignal.estimateSource).toBe(source);
      expectFiniteNonNegative(json, ["estimatedBudgetKrw", "recommendedBudgetKrw"]);
    }
  }, 30_000);
});

describe("14. Recommendation future safety — 미래 planningYear에서도 recommendation = estimate * 1.05 정확히 유지", () => {
  it.each([2027, 2028, 2029, 2030, 2035])("planningYear=%i: recommendedBudgetKrw = round(estimatedBudgetKrw * 1.05)", async (year) => {
    const { status, json } = await callPlanningApi({ ...BASE_BODY, planningYear: year, festivalName: "부산국제록페스티벌" });
    expect(status).toBe(200);
    if (json.seriesSignal.status === "MATCHED") {
      expect(json.recommendedBudgetKrw).toBe(Math.round(json.estimatedBudgetKrw * 1.05));
    }
  });
});

describe("16. Series → Peer fallback future test", () => {
  it.each([2027, 2030, 2035])("planningYear=%i: 실제 존재하는 series 이름 -> MATCHED(Series routing 정상)", async (year) => {
    const { status, json } = await callPlanningApi({ ...BASE_BODY, planningYear: year, festivalName: "부산국제록페스티벌" });
    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("MATCHED");
    expect(json.estimateBasis).toBe("SERIES_HISTORY_MEDIAN");
  });

  it.each([2027, 2030, 2035])("planningYear=%i: 완전히 새로운 축제 이름 -> UNMATCHED, Peer fallback으로 정상 라우팅", async (year) => {
    const { status, json } = await callPlanningApi({
      ...BASE_BODY,
      planningYear: year,
      festivalName: "2035년에 처음 열리는 완전히 새로운 미래 축제 이름 XYZ",
    });
    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("UNMATCHED");
    expect(json.estimateBasis).toBe("PEER_SIMILARITY");
    expect(json.reliabilityTier).toBe("LOW");
    expect(json.seriesHistoryDetail).toBeNull();
    expect(json.seriesDataQualityAudit).toBeNull();
  });
});

describe("17. Peer future safety — 미래 planningYear에서도 Peer 통계가 정상 계산된다", () => {
  it.each([2027, 2030, 2035])("planningYear=%i: sampleCount/similarity/P25~P75/recommendation이 전부 유한값", async (year) => {
    const { status, json } = await callPlanningApi({ ...BASE_BODY, planningYear: year });
    expect(status).toBe(200);
    expect(json.reliabilityTier).toBe("LOW"); // festivalName 없음 -> NOT_REQUESTED -> 항상 LOW
    expectFiniteNonNegative(json, [
      "estimatedBudgetKrw",
      "recommendedBudgetKrw",
      "p25Krw",
      "p50Krw",
      "p60Krw",
      "p75Krw",
      "sampleCount",
      "weightedAverageBudgetKrw",
    ]);
  });
});

describe("21. API/Estimator invariance — Future-Year Safety 진단(tester UI/lib 추가)이 core 응답값에 전혀 영향을 주지 않는다", () => {
  it("부산국제록페스티벌 planningYear=2026 G0 golden case core 필드가 이번 Phase 전후로 완전히 동일하다(pinned)", async () => {
    const { status, json } = await callPlanningApi({ ...BASE_BODY, planningYear: 2026, festivalName: "부산국제록페스티벌" });
    expect(status).toBe(200);
    expect(json.estimateBasis).toBe("SERIES_HISTORY_MEDIAN");
    expect(json.estimatedBudgetKrw).toBe(7_200_000_000);
    expect(json.recommendedBudgetKrw).toBe(Math.round(7_200_000_000 * 1.05));
    expect(json.seriesSignal.estimateSource).toBe("LATEST");
    expect(json.seriesSignal.latestHistoricalGap).toBe(1);
    expect(json.reliabilityTier).toBe("MEDIUM");
    expect(json.reliabilityDiagnostic.reasonKey).toBe("SERIES_VOLATILE");
    // Peer evidence/statistics는 Series MATCHED 여부와 무관하게 항상 계산되어 있어야 한다.
    expect(Number.isFinite(json.p25Krw)).toBe(true);
    expect(Number.isFinite(json.p75Krw)).toBe(true);
    expect(json.sampleCount).toBeGreaterThan(0);
  });
});

describe("18. Extreme input regression(future planningYear와 조합)", () => {
  it("durationDays=1(validation 미만) -> 미래 planningYear에서도 여전히 400(crash 아님)", async () => {
    const { status, json } = await callPlanningApi({ ...BASE_BODY, durationDays: 1, planningYear: 2030 });
    expect(status).toBe(400);
    expect(json.message).toBeDefined();
  });

  it("durationDays가 매우 긺(3650일) -> 미래 planningYear에서도 crash 없이 유한값 반환", async () => {
    const { status, json } = await callPlanningApi({ ...BASE_BODY, durationDays: 3650, planningYear: 2030 });
    expect(status).toBe(200);
    expectFiniteNonNegative(json, ["estimatedBudgetKrw", "recommendedBudgetKrw"]);
  });

  it("district 미입력 + venueType=UNDECIDED -> 미래 planningYear에서도 crash 없이 정상 응답", async () => {
    const { status, json } = await callPlanningApi({ ...BASE_BODY, venueType: "UNDECIDED", district: undefined, planningYear: 2030 });
    expect(status).toBe(200);
    expectFiniteNonNegative(json, ["estimatedBudgetKrw", "recommendedBudgetKrw"]);
  });

  it("신규 festivalName + 미래 planningYear(2035) 조합 -> crash 없이 Peer fallback", async () => {
    const { status, json } = await callPlanningApi({
      ...BASE_BODY,
      planningYear: 2035,
      festivalName: "존재하지 않는 극단 테스트 축제 이름",
    });
    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("UNMATCHED");
    expectFiniteNonNegative(json, ["estimatedBudgetKrw", "recommendedBudgetKrw"]);
  });
});
