import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/v1/multiyear-budget-estimates/route";

/**
 * PHASE — Explicit Series Identity Routing. 실제 DB(2017~2026)를 읽기 전용으로 사용한다.
 * root cause: 서울거리예술축제는 5/6개 연도가 district=null(REGION_LEVEL)인데, 사용자가 이번
 * 계획연도에 district(예: 송파구)를 입력하면 target의 scope가 DISTRICT_LEVEL로 바뀌어 자동
 * matcher(lookupTarget)의 scope hard gate에 걸려 UNMATCHED -> Peer로 떨어졌다(회귀 방지용
 * 실측 baseline 참고: historyCount=3, historicalYears=[2017,2018,2021], estimateSource=MEDIAN).
 *
 * 이 테스트는 `selectedSeriesIdentity`(canonicalName+regionCode)를 명시적으로 보낼 때만
 * district가 identity gate에서 제외되고, 그 필드를 보내지 않은 자동/자유입력 경로는 기존
 * matcher semantics(district hard gate 포함) 그대로임을 확인한다.
 */
const BASE_BODY = {
  regionCode: "SEOUL",
  festivalTypes: ["CULTURE_ART"],
  venueType: "VILLAGE",
  durationDays: 5,
  planningYear: 2026,
  referenceDataPolicy: "HISTORICAL_ONLY",
  festivalName: "서울거리예술축제",
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

describe("Explicit Series Identity Routing — 서울거리예술축제(district 유무에 따른 Series/Peer 분기 회귀)", () => {
  it("explicit 선택 + district 없음 → Series(baseline)", async () => {
    const { status, json } = await callPlanningApi({
      ...BASE_BODY,
      selectedSeriesIdentity: { canonicalName: "서울거리예술축제", regionCode: "SEOUL" },
    });
    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("MATCHED");
    expect(json.estimateBasis).toBe("SERIES_HISTORY_MEDIAN");
    expect(json.seriesSignal.historyCount).toBe(3);
    expect(json.seriesSignal.historicalYears).toEqual([2017, 2018, 2021]);
    expect(json.seriesSignal.estimateSource).toBe("MEDIAN");
  });

  it("explicit 선택 + district=송파구 → 동일 Series 유지(estimateBasis/estimateSource/historical source 불변)", async () => {
    const baseline = await callPlanningApi({
      ...BASE_BODY,
      selectedSeriesIdentity: { canonicalName: "서울거리예술축제", regionCode: "SEOUL" },
    });
    const withDistrict = await callPlanningApi({
      ...BASE_BODY,
      district: "송파구",
      selectedSeriesIdentity: { canonicalName: "서울거리예술축제", regionCode: "SEOUL" },
    });

    expect(withDistrict.status).toBe(200);
    expect(withDistrict.json.seriesSignal.status).toBe("MATCHED");
    expect(withDistrict.json.estimateBasis).toBe("SERIES_HISTORY_MEDIAN");
    expect(withDistrict.json.seriesSignal.historyCount).toBe(3);
    expect(withDistrict.json.seriesSignal.historicalYears).toEqual([2017, 2018, 2021]);
    expect(withDistrict.json.seriesSignal.estimateSource).toBe("MEDIAN");

    // G0 계산값 자체는 완전히 동일해야 한다(district는 표시 metadata일 뿐, identity gate에서
    // 제외됐을 뿐 계산에는 애초에 관여하지 않는다는 것까지 재확인).
    expect(withDistrict.json.estimatedBudgetKrw).toBe(baseline.json.estimatedBudgetKrw);
    expect(withDistrict.json.recommendedBudgetKrw).toBe(baseline.json.recommendedBudgetKrw);
    expect(withDistrict.json.seriesSignal.seriesEstimatedBudgetKrw).toBe(baseline.json.seriesSignal.seriesEstimatedBudgetKrw);
    expect(withDistrict.json.reliabilityTier).toBe(baseline.json.reliabilityTier);

    // 응답의 district 자체는 여전히 이번 요청의 입력값을 반영해야 한다(identity 판단에서만
    // 제외됐을 뿐, "이번 계획 정보"로서는 그대로 유지 - referenceYearFrom 등 peer 필드는 무관하나
    // 최소한 seriesSignal이 district 유무로 값 자체가 안 바뀐다는 것으로 간접 확인 가능).
  });

  it("explicit 선택 + district='송파구' + durationDays 변경 → 동일 Series 유지", async () => {
    const { status, json } = await callPlanningApi({
      ...BASE_BODY,
      district: "송파구",
      durationDays: 10,
      selectedSeriesIdentity: { canonicalName: "서울거리예술축제", regionCode: "SEOUL" },
    });
    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("MATCHED");
    expect(json.estimateBasis).toBe("SERIES_HISTORY_MEDIAN");
  });

  it("explicit 선택 + district='송파구' + venueType 변경 → 동일 Series 유지", async () => {
    const { status, json } = await callPlanningApi({
      ...BASE_BODY,
      district: "송파구",
      venueType: "GREEN",
      selectedSeriesIdentity: { canonicalName: "서울거리예술축제", regionCode: "SEOUL" },
    });
    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("MATCHED");
    expect(json.estimateBasis).toBe("SERIES_HISTORY_MEDIAN");
  });

  it("explicit 선택 + district='송파구' + festivalTypes 변경 → 동일 Series 유지", async () => {
    const { status, json } = await callPlanningApi({
      ...BASE_BODY,
      district: "송파구",
      festivalTypes: ["TRADITION_HISTORY"],
      selectedSeriesIdentity: { canonicalName: "서울거리예술축제", regionCode: "SEOUL" },
    });
    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("MATCHED");
    expect(json.estimateBasis).toBe("SERIES_HISTORY_MEDIAN");
  });

  it("자동 매칭(selectedSeriesIdentity 없음) + district='송파구' → 기존 matcher 그대로 UNMATCHED(Peer) - 회귀 없음", async () => {
    const { status, json } = await callPlanningApi({ ...BASE_BODY, district: "송파구" });
    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("UNMATCHED");
    expect(json.estimateBasis).toBe("PEER_SIMILARITY");
  });

  it("자동 매칭(selectedSeriesIdentity 없음) + district 없음 → 기존과 동일하게 MATCHED(자동 경로 자체는 불변)", async () => {
    const { status, json } = await callPlanningApi({ ...BASE_BODY });
    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("MATCHED");
    expect(json.seriesSignal.historyCount).toBe(3);
  });

  it("selectedSeriesIdentity.canonicalName이 festivalName과 다르면 조용히 무시하고 자동 matcher 경로를 탄다", async () => {
    const { status, json } = await callPlanningApi({
      ...BASE_BODY,
      district: "송파구",
      selectedSeriesIdentity: { canonicalName: "전혀 다른 축제 이름", regionCode: "SEOUL" },
    });
    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("UNMATCHED"); // identity가 안 맞으면 자동 경로(district 게이트 그대로) 그대로.
  });

  it("selectedSeriesIdentity.regionCode가 요청의 regionCode와 다르면 조용히 무시한다", async () => {
    const { status, json } = await callPlanningApi({
      ...BASE_BODY,
      district: "송파구",
      selectedSeriesIdentity: { canonicalName: "서울거리예술축제", regionCode: "BUSAN" },
    });
    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("UNMATCHED");
  });

  it("완전히 새로운 축제(신규) + selectedSeriesIdentity 없음 → 여전히 Peer(회귀 없음)", async () => {
    const { status, json } = await callPlanningApi({
      ...BASE_BODY,
      festivalName: "완전히 새로운 테스트 축제 이름 ABC",
      district: "송파구",
    });
    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("UNMATCHED");
    expect(json.estimateBasis).toBe("PEER_SIMILARITY");
  });

  it("G0 golden case(부산국제록페스티벌, planningYear=2026)는 이번 변경과 무관하게 그대로 유지된다", async () => {
    const { status, json } = await callPlanningApi({
      regionCode: "BUSAN",
      festivalTypes: ["CULTURE_ART"],
      venueType: "GREEN",
      durationDays: 3,
      planningYear: 2026,
      referenceDataPolicy: "HISTORICAL_ONLY",
      festivalName: "부산국제록페스티벌",
    });
    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("MATCHED");
    expect(json.seriesSignal.estimateSource).toBe("LATEST");
    expect(json.seriesSignal.latestHistoricalGap).toBe(1);
  });
});
