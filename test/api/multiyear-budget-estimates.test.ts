import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/v1/multiyear-budget-estimates/route";

/**
 * POST /api/v1/multiyear-budget-estimates의 request -> policy -> response 계약을 검증한다.
 * 이 테스트는 CandidateSelectorV1/유사도/기간보정/winsorize 등 알고리즘 공식 자체를 재검증하지
 * 않는다 - 그건 scripts/verify-multiyear-*.ts(golden fixture, algorithm parity regression)의
 * 역할이고, 여기서는 API 레이어의 정책 분기(HISTORICAL_ONLY/SAME_YEAR/downgrade/422)와 응답 필드
 * 계약만 확인한다.
 *
 * 실제 DB(2017~2026 MultiYearFestivalRecord + 현재 publication status: 2025/2026만
 * PUBLISHED_PLAN_COMPLETE)를 읽기 전용으로 사용한다 - 아무것도 쓰지 않는다.
 */
const BASE_BODY = {
  regionCode: "SEOUL",
  festivalTypes: ["CULTURE_ART"],
  venueType: "VILLAGE",
  durationDays: 2,
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

describe("POST /api/v1/multiyear-budget-estimates - contract 시나리오", () => {
  it("2026 HISTORICAL_ONLY: status와 무관하게 <2026, referenceYearTo=2025", async () => {
    const { status, json } = await callPlanningApi({ ...BASE_BODY, planningYear: 2026, referenceDataPolicy: "HISTORICAL_ONLY" });
    expect(status).toBe(200);
    expect(json.appliedReferenceDataPolicy).toBe("HISTORICAL_ONLY");
    expect(json.referenceYearTo).toBe(2025);
    expect(json.latestSourceYear).toBe(2025);
  });

  it("2026 SAME_YEAR + 실제 DB상 2026=PUBLISHED_PLAN_COMPLETE: downgrade 없이 2026까지", async () => {
    const { status, json } = await callPlanningApi({
      ...BASE_BODY,
      planningYear: 2026,
      referenceDataPolicy: "INCLUDE_PUBLISHED_SAME_YEAR",
    });
    expect(status).toBe(200);
    expect(json.requestedReferenceDataPolicy).toBe("INCLUDE_PUBLISHED_SAME_YEAR");
    expect(json.appliedReferenceDataPolicy).toBe("INCLUDE_PUBLISHED_SAME_YEAR");
    expect(json.referenceYearTo).toBe(2026);
    expect(json.latestSourceYear).toBe(2026);
  });

  it("2020 SAME_YEAR + status row 없음: HISTORICAL_ONLY로 downgrade", async () => {
    const { status, json } = await callPlanningApi({
      ...BASE_BODY,
      planningYear: 2020,
      referenceDataPolicy: "INCLUDE_PUBLISHED_SAME_YEAR",
    });
    expect(status).toBe(200);
    expect(json.requestedReferenceDataPolicy).toBe("INCLUDE_PUBLISHED_SAME_YEAR");
    expect(json.appliedReferenceDataPolicy).toBe("HISTORICAL_ONLY");
    expect(json.referenceYearTo).toBe(2019);
  });

  it("2027 HISTORICAL_ONLY: 정책 window(<2027)와 실제 latestSourceYear(2026)가 일치", async () => {
    const { status, json } = await callPlanningApi({ ...BASE_BODY, planningYear: 2027, referenceDataPolicy: "HISTORICAL_ONLY" });
    expect(status).toBe(200);
    expect(json.referenceYearFrom).toBe(2017);
    expect(json.referenceYearTo).toBe(2026);
    expect(json.latestSourceYear).toBe(2026);
  });

  it("2030 HISTORICAL_ONLY: 정책 window(referenceYearTo=2029)와 실제 보유 데이터(latestSourceYear=2026)가 다름", async () => {
    const { status, json } = await callPlanningApi({ ...BASE_BODY, planningYear: 2030, referenceDataPolicy: "HISTORICAL_ONLY" });
    expect(status).toBe(200);
    expect(json.referenceYearTo).toBe(2029);
    expect(json.latestSourceYear).toBe(2026);
    expect(json.latestSourceYear).toBeLessThan(json.referenceYearTo);
  });

  it("2017 HISTORICAL_ONLY: reference pool 0건 -> 422", async () => {
    const { status, json } = await callPlanningApi({ ...BASE_BODY, planningYear: 2017, referenceDataPolicy: "HISTORICAL_ONLY" });
    expect(status).toBe(422);
    expect(json.message).toBeDefined();
  });

  it("2017 SAME_YEAR + status 없음: downgrade 후에도 reference pool 0건 -> 422", async () => {
    const { status } = await callPlanningApi({ ...BASE_BODY, planningYear: 2017, referenceDataPolicy: "INCLUDE_PUBLISHED_SAME_YEAR" });
    expect(status).toBe(422);
  });

  it("2016 HISTORICAL_ONLY: 422", async () => {
    const { status } = await callPlanningApi({ ...BASE_BODY, planningYear: 2016, referenceDataPolicy: "HISTORICAL_ONLY" });
    expect(status).toBe(422);
  });
});

describe("POST /api/v1/multiyear-budget-estimates - request validation", () => {
  it("planningYear 없음 -> 400", async () => {
    const { status } = await callPlanningApi({ ...BASE_BODY });
    expect(status).toBe(400);
  });

  it("planningYear가 정수가 아님 -> 400", async () => {
    const { status } = await callPlanningApi({ ...BASE_BODY, planningYear: 2026.5 });
    expect(status).toBe(400);
  });

  it("planningYear가 문자열 -> 400", async () => {
    const { status } = await callPlanningApi({ ...BASE_BODY, planningYear: "2026" });
    expect(status).toBe(400);
  });

  it("유효하지 않은 referenceDataPolicy -> 400", async () => {
    const { status } = await callPlanningApi({ ...BASE_BODY, planningYear: 2026, referenceDataPolicy: "ALWAYS_INCLUDE" });
    expect(status).toBe(400);
  });

  it("festivalTypes 빈 배열 -> 400", async () => {
    const { status } = await callPlanningApi({ ...BASE_BODY, festivalTypes: [], planningYear: 2026 });
    expect(status).toBe(400);
  });

  it("festivalTypes에 유효하지 않은 값 포함 -> 400", async () => {
    const { status } = await callPlanningApi({ ...BASE_BODY, festivalTypes: ["NOT_A_TYPE"], planningYear: 2026 });
    expect(status).toBe(400);
  });

  it("유효하지 않은 region -> 400", async () => {
    const { status } = await callPlanningApi({ ...BASE_BODY, regionCode: "ATLANTIS", planningYear: 2026 });
    expect(status).toBe(400);
  });

  it("유효하지 않은 venueType -> 400", async () => {
    const { status } = await callPlanningApi({ ...BASE_BODY, venueType: "SPACE_STATION", planningYear: 2026 });
    expect(status).toBe(400);
  });

  it("durationDays가 2 미만 -> 400", async () => {
    const { status } = await callPlanningApi({ ...BASE_BODY, durationDays: 1, planningYear: 2026 });
    expect(status).toBe(400);
  });

  it("durationDays가 숫자가 아님 -> 400", async () => {
    const { status } = await callPlanningApi({ ...BASE_BODY, durationDays: "이틀", planningYear: 2026 });
    expect(status).toBe(400);
  });
});
