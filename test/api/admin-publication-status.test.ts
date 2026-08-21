import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getStatusList } from "@/app/api/v1/admin/multiyear-datasets/publication-status/route";
import { PUT as putStatus } from "@/app/api/v1/admin/multiyear-datasets/publication-status/[year]/route";
import { POST as planningPost } from "@/app/api/v1/multiyear-budget-estimates/route";
import { prisma } from "@/lib/db/prisma";
import { signExpiredTestToken, signTestToken } from "../helpers/jwt";

/**
 * publication-status 관리자 API(인증 + CRUD)와, "상태 변경이 실제로 Planning 계산에 반영되는가"
 * 통합 테스트. 실제 2025/2026 운영 status는 절대 건드리지 않는다 - 쓰기 테스트는 전부 실제
 * 축제 데이터가 없는 더미 연도(TEST_YEAR=9999)나, 실제 데이터는 있지만 원래 status row가 없는
 * 2021년을 쓰고 마지막에 원상태로 정리한다.
 */
const TEST_YEAR = 9999; // 실제 MultiYearFestivalRecord가 전혀 없는 더미 연도 - CRUD 동작만 검증.
const INTEGRATION_YEAR = 2021; // 실제 데이터가 있고, 현재 status row가 없는(=PARTIAL) 연도.

function listReq(token?: string) {
  return new NextRequest("http://localhost/api/v1/admin/multiyear-datasets/publication-status", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function putReq(year: number, status: string | undefined, token?: string) {
  return new NextRequest(`http://localhost/api/v1/admin/multiyear-datasets/publication-status/${year}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(status === undefined ? {} : { status }),
  });
}

beforeAll(async () => {
  process.env.MULTIYEAR_ADMIN_UI_ENABLED = "true";
  // 혹시 이전 실행이 비정상 종료해 남아 있을 수 있는 더미/통합 연도 row를 미리 정리한다.
  await prisma.multiYearDatasetPublicationStatus.deleteMany({ where: { datasetYear: { in: [TEST_YEAR, INTEGRATION_YEAR] } } });
});

afterAll(async () => {
  // 테스트가 만든 row는 반드시 지운다 - 2021은 원래 "row 없음(=PARTIAL)" 상태였으므로 그 상태로 복원.
  await prisma.multiYearDatasetPublicationStatus.deleteMany({ where: { datasetYear: { in: [TEST_YEAR, INTEGRATION_YEAR] } } });
});

describe("admin publication-status API - 인증", () => {
  it("Authorization 헤더 없음 -> 401", async () => {
    const res = await getStatusList(listReq());
    expect(res.status).toBe(401);
  });

  it("형식이 잘못된 토큰 -> 401", async () => {
    const res = await getStatusList(listReq("not-a-jwt"));
    expect(res.status).toBe(401);
  });

  it("만료된 토큰 -> 401", async () => {
    const token = await signExpiredTestToken("ADMIN");
    const res = await getStatusList(listReq(token));
    expect(res.status).toBe(401);
  });

  it("유효하지만 role=USER인 토큰 -> 403", async () => {
    const token = await signTestToken("USER");
    const res = await getStatusList(listReq(token));
    expect(res.status).toBe(403);
  });

  it("유효한 ADMIN 토큰으로 GET -> 200", async () => {
    const token = await signTestToken("ADMIN");
    const res = await getStatusList(listReq(token));
    expect(res.status).toBe(200);
  });

  it("유효한 ADMIN 토큰으로 PUT -> 성공(더미 연도)", async () => {
    const token = await signTestToken("ADMIN");
    const res = await putStatus(putReq(TEST_YEAR, "PUBLISHED_PLAN_COMPLETE", token), {
      params: Promise.resolve({ year: String(TEST_YEAR) }),
    });
    expect(res.status).toBe(200);
  });

  it("USER 토큰으로 PUT 시도 -> 403 (실제로 변경되지 않아야 함)", async () => {
    const token = await signTestToken("USER");
    const res = await putStatus(putReq(TEST_YEAR, "PARTIAL", token), { params: Promise.resolve({ year: String(TEST_YEAR) }) });
    expect(res.status).toBe(403);
    const row = await prisma.multiYearDatasetPublicationStatus.findUnique({ where: { datasetYear: TEST_YEAR } });
    expect(row?.status).toBe("PUBLISHED_PLAN_COMPLETE"); // 이전 ADMIN PUT 결과가 그대로 유지돼야 함
  });
});

describe("admin publication-status API - 조회", () => {
  it("row가 없는 연도는 목록에서 logical PARTIAL로 표시된다", async () => {
    const token = await signTestToken("ADMIN");
    const res = await getStatusList(listReq(token));
    const json = await res.json();
    const entry2021 = json.entries.find((e: { datasetYear: number }) => e.datasetYear === INTEGRATION_YEAR);
    expect(entry2021).toBeDefined();
    expect(entry2021.status).toBe("PARTIAL");
    expect(entry2021.publishedAt).toBeNull();
    expect(entry2021.recordCount).toBeGreaterThan(0); // 2021은 실제 축제 데이터가 있는 연도
  });
});

describe("admin publication-status API - 상태 변경 규칙 (Spring setStatus parity)", () => {
  it("PARTIAL -> PUBLISHED_PLAN_COMPLETE: publishedAt이 채워진다", async () => {
    const token = await signTestToken("ADMIN");
    const before = Date.now();
    const res = await putStatus(putReq(INTEGRATION_YEAR, "PUBLISHED_PLAN_COMPLETE", token), {
      params: Promise.resolve({ year: String(INTEGRATION_YEAR) }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("PUBLISHED_PLAN_COMPLETE");
    expect(json.publishedAt).not.toBeNull();
    expect(new Date(json.publishedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("동일 상태(COMPLETE) 재설정: publishedAt이 새 시각으로 갱신된다 (Spring 동작과 동일)", async () => {
    const token = await signTestToken("ADMIN");
    const first = await putStatus(putReq(INTEGRATION_YEAR, "PUBLISHED_PLAN_COMPLETE", token), {
      params: Promise.resolve({ year: String(INTEGRATION_YEAR) }),
    });
    const firstPublishedAt = (await first.json()).publishedAt;

    await new Promise((r) => setTimeout(r, 20));

    const second = await putStatus(putReq(INTEGRATION_YEAR, "PUBLISHED_PLAN_COMPLETE", token), {
      params: Promise.resolve({ year: String(INTEGRATION_YEAR) }),
    });
    const secondPublishedAt = (await second.json()).publishedAt;

    expect(new Date(secondPublishedAt).getTime()).toBeGreaterThan(new Date(firstPublishedAt).getTime());
  });

  it("PUBLISHED_PLAN_COMPLETE -> PARTIAL: publishedAt이 null로 지워진다", async () => {
    const token = await signTestToken("ADMIN");
    const res = await putStatus(putReq(INTEGRATION_YEAR, "PARTIAL", token), {
      params: Promise.resolve({ year: String(INTEGRATION_YEAR) }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("PARTIAL");
    expect(json.publishedAt).toBeNull();
  });

  it("유효하지 않은 status 값 -> 400", async () => {
    const token = await signTestToken("ADMIN");
    const res = await putStatus(putReq(INTEGRATION_YEAR, "DONE", token), { params: Promise.resolve({ year: String(INTEGRATION_YEAR) }) });
    expect(res.status).toBe(400);
  });

  it("year가 정수가 아님 -> 400", async () => {
    const token = await signTestToken("ADMIN");
    const res = await putStatus(putReq(0, "PARTIAL", token), { params: Promise.resolve({ year: "twenty-twenty-one" }) });
    expect(res.status).toBe(400);
  });
});

describe("통합: publication status 변경이 Planning API 결과에 실제로 반영되는가", () => {
  async function planningSameYear(planningYear: number) {
    const req = new NextRequest("http://localhost/api/v1/multiyear-budget-estimates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        regionCode: "SEOUL",
        festivalTypes: ["CULTURE_ART"],
        venueType: "VILLAGE",
        durationDays: 2,
        planningYear,
        referenceDataPolicy: "INCLUDE_PUBLISHED_SAME_YEAR",
      }),
    });
    return (await (await planningPost(req)).json()) as { appliedReferenceDataPolicy: string; referenceYearTo: number };
  }

  it("PARTIAL(row 없음) 상태에서는 downgrade, COMPLETE로 바꾸면 same-year가 실제로 허용된다", async () => {
    // 사전 조건: INTEGRATION_YEAR는 이 시점에 row가 없어야 한다(위 describe 블록 마지막이 PARTIAL로 남겨둠).
    const before = await planningSameYear(INTEGRATION_YEAR);
    expect(before.appliedReferenceDataPolicy).toBe("HISTORICAL_ONLY");
    expect(before.referenceYearTo).toBe(INTEGRATION_YEAR - 1);

    const token = await signTestToken("ADMIN");
    const putRes = await putStatus(putReq(INTEGRATION_YEAR, "PUBLISHED_PLAN_COMPLETE", token), {
      params: Promise.resolve({ year: String(INTEGRATION_YEAR) }),
    });
    expect(putRes.status).toBe(200);

    const after = await planningSameYear(INTEGRATION_YEAR);
    expect(after.appliedReferenceDataPolicy).toBe("INCLUDE_PUBLISHED_SAME_YEAR");
    expect(after.referenceYearTo).toBe(INTEGRATION_YEAR);
  });
});
