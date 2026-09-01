import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/v1/multiyear-budget-estimates/route";
import { SERIES_PLANNING_BUFFER_RATE } from "@/lib/multiyear-series/apply-planning-semantics";

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

/**
 * PHASE 9C-A(Series Shadow Integration)/9C-C(Series-aware Planning API Integration).
 *
 * festivalName은 optional additive 필드다. seriesSignal.status가 MATCHED(+VALID history)일
 * 때만 estimatedBudgetKrw/recommendedBudgetKrw가 series 값으로 바뀐다(estimateBasis/
 * recommendationBasis로 확인 가능) - 그 외(NOT_REQUESTED/UNMATCHED/AMBIGUOUS/
 * NO_VALID_HISTORY)는 기존 Planning V1 peer 결과가 완전히 그대로 유지된다. P25/P50/P60/P75/
 * weightedAverageBudgetKrw/sampleCount/dataQualityV3는 seriesSignal 상태와 무관하게 항상
 * peer 그대로다(rangeBasis/dataQualityBasis도 항상 PEER_* 고정).
 *
 * 아래 대표 사례(EXACT/NORMALIZED_EXACT/FUZZY/AMBIGUOUS/UNMATCHED)는 실제 DB 2026 데이터에서
 * scripts/find-series-test-cases.ts로 확인한 실제 record다. NO_VALID_HISTORY는 leakage-safe
 * 설계상(series 모델이 항상 datasetYear<planningYear로만 구성됨) 실제 DB/API 경로로는
 * 구조적으로 재현되지 않는다 - lib/multiyear-series/own-history.test.ts와
 * apply-planning-semantics.test.ts에서 직접 구성한 fixture로 이미 커버한다.
 */
describe("POST /api/v1/multiyear-budget-estimates - seriesSignal + basis metadata (festivalName)", () => {
  /**
   * peer(=PEER_FALLBACK) 기준값을 얻기 위해 festivalName 없이 같은 조건으로 호출한다.
   * PHASE 19-A: peer recommendedBudgetKrw는 이제 confidence-derived contingency가 완전히
   * 제거된 max(estimatedBudgetKrw, p60Krw)다 - 매 호출마다 그 구조를 재확인한다.
   */
  async function callPeerOnly(overrides: Record<string, unknown>) {
    const { status, json: peer } = await callPlanningApi(overrides);
    expect(status).toBe(200);
    expect(peer.recommendedBudgetKrw).toBe(Math.max(peer.estimatedBudgetKrw, peer.p60Krw));
    return { peer };
  }

  it("festivalName 없음 -> seriesSignal.status=NOT_REQUESTED, basis는 전부 PEER_*, 기존 필드는 festivalName 유무와 무관하게 동일, reliabilityTier=LOW", async () => {
    const withoutName = await callPlanningApi({ ...BASE_BODY, planningYear: 2026, referenceDataPolicy: "HISTORICAL_ONLY" });
    expect(withoutName.status).toBe(200);
    expect(withoutName.json.seriesSignal).toEqual({ status: "NOT_REQUESTED" });
    expect(withoutName.json.estimateBasis).toBe("PEER_SIMILARITY");
    expect(withoutName.json.recommendationBasis).toBe("PEER_PLANNING");
    expect(withoutName.json.rangeBasis).toBe("PEER_EMPIRICAL_P25_P75");
    expect(withoutName.json.dataQualityBasis).toBe("PEER_SAMPLE");
    // PHASE 19-B — Peer fallback(여기서는 애초에 series를 요청하지도 않은 경우)은 항상 LOW다.
    expect(withoutName.json.reliabilityTier).toBe("LOW");
    expect(withoutName.json.reliabilityReason).toBe(
      "동일 축제의 충분한 과거 예산 이력을 확인하지 못해 유사 축제 데이터를 기반으로 추정했습니다."
    );

    const withBlankName = await callPlanningApi({ ...BASE_BODY, planningYear: 2026, referenceDataPolicy: "HISTORICAL_ONLY", festivalName: "   " });
    expect(withBlankName.json.seriesSignal).toEqual({ status: "NOT_REQUESTED" });

    // festivalName 유무가 기존 필드(estimatedBudgetKrw 등)에 전혀 영향을 주지 않아야 한다
    // (이 이름은 어떤 series에도 안 걸리므로 UNMATCHED -> peer 그대로가 되어야 함).
    const withName = await callPlanningApi({
      ...BASE_BODY,
      planningYear: 2026,
      referenceDataPolicy: "HISTORICAL_ONLY",
      festivalName: "아무 이름을 넣어도 무관한 축제",
    });
    expect(withName.json.seriesSignal.status).toBe("UNMATCHED");
    expect(withName.json.estimatedBudgetKrw).toBe(withoutName.json.estimatedBudgetKrw);
    expect(withName.json.recommendedBudgetKrw).toBe(withoutName.json.recommendedBudgetKrw);
    expect(withName.json.p25Krw).toBe(withoutName.json.p25Krw);
    expect(withName.json.p50Krw).toBe(withoutName.json.p50Krw);
    expect(withName.json.p60Krw).toBe(withoutName.json.p60Krw);
    expect(withName.json.p75Krw).toBe(withoutName.json.p75Krw);
    expect(withName.json.weightedAverageBudgetKrw).toBe(withoutName.json.weightedAverageBudgetKrw);
    expect(withName.json.dataQualityV3).toBe(withoutName.json.dataQualityV3);
    expect(withName.json.sampleCount).toBe(withoutName.json.sampleCount);
  });

  it("EXACT: estimatedBudget=seriesMedian, recommendedBudget=R1, P25/P50/P60/P75/dataQuality는 peer와 동일, reliabilityTier=MEDIUM(실제 DB 기준 volatile series)", async () => {
    const overrides = {
      regionCode: "SEOUL",
      district: "-",
      festivalTypes: ["CULTURE_ART"],
      venueType: "VILLAGE",
      durationDays: 2,
      planningYear: 2026,
    };
    const { peer } = await callPeerOnly(overrides);
    const { status, json } = await callPlanningApi({ ...overrides, festivalName: "한강페스티벌" });

    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("MATCHED");
    expect(json.seriesSignal.matchMethod).toBe("EXACT");
    expect(json.seriesSignal.canonicalName).toBe("한강페스티벌");
    expect(json.seriesSignal.historyCount).toBeGreaterThan(0);
    expect(json.seriesSignal.historicalYears.every((y: number) => y < 2026)).toBe(true);

    // 최종 semantics
    expect(json.estimateBasis).toBe("SERIES_HISTORY_MEDIAN");
    expect(json.recommendationBasis).toBe("SERIES_HISTORY_WITH_FIXED_BUFFER");
    expect(json.rangeBasis).toBe("PEER_EMPIRICAL_P25_P75");
    expect(json.dataQualityBasis).toBe("PEER_SAMPLE");
    expect(json.estimatedBudgetKrw).toBe(json.seriesSignal.seriesEstimatedBudgetKrw);
    expect(json.recommendedBudgetKrw).toBe(Math.round(json.seriesSignal.seriesEstimatedBudgetKrw * (1 + SERIES_PLANNING_BUFFER_RATE)));

    // PHASE 19-B — 실제 DB 2026 데이터 기준(scripts/_tmp로 확인, 재현 방법은 find-series-test-cases.ts와 동일):
    // 한강페스티벌은 historyCount=3, CPI-adjusted volatility가 leakage-safe threshold를 초과해 MEDIUM(SERIES_VOLATILE)이다.
    expect(json.seriesSignal.historyCount).toBeGreaterThanOrEqual(2); // volatility 계산 가능 전제
    expect(json.reliabilityTier).toBe("MEDIUM");
    expect(json.reliabilityReason).toBe("동일 축제의 과거 예산 이력을 활용했지만, 물가 보정 후 연도별 예산 변동폭이 큰 편입니다.");
    // PHASE G0 — 부산국제록 외의 실제 Series MATCHED 케이스에서도 새 additive 필드가 정상 배선되는지
    // 확인(정확한 값은 부산국제록 golden case가 이미 검증했으므로, 여기서는 "정의돼 있고 estimateSource에
    // 맞춰 seriesEstimatedBudgetKrw가 일관되는지"만 재확인한다).
    expect(json.seriesSignal.latestHistoricalGap).toBeGreaterThan(0);
    expect(["LATEST", "MEDIAN"]).toContain(json.seriesSignal.estimateSource);
    expect(json.seriesHistoryDetail.estimateSource).toBe(json.seriesSignal.estimateSource);
    const pointEstimateRecords = json.seriesHistoryDetail.records.filter((r: { usedAsPointEstimateSource: boolean }) => r.usedAsPointEstimateSource);
    if (json.seriesSignal.estimateSource === "LATEST") {
      expect(pointEstimateRecords.length).toBe(1);
    } else {
      expect(pointEstimateRecords.length).toBe(json.seriesHistoryDetail.eligibleForSeriesCalculationCount);
    }

    // peer evidence/statistics(P25/P50/P60/P75/weightedAverage/sampleCount/dataQuality)는
    // series 적용 전 peer 결과와 완전히 동일해야 한다(Series로 대체되지 않음).
    expect(json.p25Krw).toBe(peer.p25Krw);
    expect(json.p50Krw).toBe(peer.p50Krw);
    expect(json.p60Krw).toBe(peer.p60Krw);
    expect(json.p75Krw).toBe(peer.p75Krw);
    expect(json.weightedAverageBudgetKrw).toBe(peer.weightedAverageBudgetKrw);
    expect(json.sampleCount).toBe(peer.sampleCount);
    expect(json.dataQualityV3).toBe(peer.dataQualityV3);
  });

  it("NORMALIZED_EXACT: 회차/연도 표기만 다른 실제 축제명 -> MATCHED + NORMALIZED_EXACT, semantics 동일하게 적용, reliabilityTier=HIGH(실제 DB 기준 historyCount=1, PHASE 31-B SINGLE_HISTORY reason)", async () => {
    const overrides = {
      regionCode: "SEOUL",
      district: "-",
      festivalTypes: ["CULTURE_ART"],
      venueType: "VILLAGE",
      durationDays: 2,
      planningYear: 2026,
    };
    const { peer } = await callPeerOnly(overrides);
    const { status, json } = await callPlanningApi({ ...overrides, festivalName: "2026 서울무형문화축제" });

    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("MATCHED");
    expect(json.seriesSignal.matchMethod).toBe("NORMALIZED_EXACT");
    expect(json.seriesSignal.canonicalName).toBe("서울무형문화축제");
    expect(json.estimateBasis).toBe("SERIES_HISTORY_MEDIAN");
    expect(json.estimatedBudgetKrw).toBe(json.seriesSignal.seriesEstimatedBudgetKrw);
    expect(json.recommendedBudgetKrw).toBe(Math.round(json.seriesSignal.seriesEstimatedBudgetKrw * (1 + SERIES_PLANNING_BUFFER_RATE)));
    expect(json.p25Krw).toBe(peer.p25Krw);
    expect(json.p75Krw).toBe(peer.p75Krw);
    expect(json.dataQualityV3).toBe(peer.dataQualityV3);

    // PHASE 19-B — 실제 DB 2026 데이터 기준: 이 record는 historyCount=1이라 volatility 계산이
    // 애초에 불가능하고, Phase 17/18 규칙대로 항상 HIGH로 분류된다(tier 산정은 변경 없음).
    // PHASE 31-B — 다만 historyCount=1은 "연도별 변동"을 측정할 수 없으므로, reason 문구는
    // "안정적"이라 주장하지 않는 SINGLE_HISTORY 문구여야 한다.
    expect(json.seriesSignal.historyCount).toBe(1);
    expect(json.reliabilityTier).toBe("HIGH");
    expect(json.reliabilityReason).toBe("동일 축제의 과거 예산 이력을 활용해 예산을 추정했습니다.");
  });

  it("PHASE 31-B — historyCount>=2 & reliabilityTier=HIGH(실제 DB 기준 stable series): reasonText는 기존 SERIES_STABLE 문구를 그대로 유지한다", async () => {
    const overrides = {
      regionCode: "SEOUL",
      district: "구로구",
      festivalTypes: ["COMMUNITY"],
      venueType: "WATERFRONT",
      durationDays: 2,
      planningYear: 2026,
    };
    const { peer } = await callPeerOnly(overrides);
    const { status, json } = await callPlanningApi({ ...overrides, festivalName: "구로G페스티벌" });

    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("MATCHED");
    expect(json.seriesSignal.matchMethod).toBe("EXACT");
    expect(json.seriesSignal.canonicalName).toBe("구로G페스티벌");
    expect(json.estimateBasis).toBe("SERIES_HISTORY_MEDIAN");
    expect(json.estimatedBudgetKrw).toBe(json.seriesSignal.seriesEstimatedBudgetKrw);
    expect(json.recommendedBudgetKrw).toBe(Math.round(json.seriesSignal.seriesEstimatedBudgetKrw * (1 + SERIES_PLANNING_BUFFER_RATE)));
    expect(json.p25Krw).toBe(peer.p25Krw);
    expect(json.p75Krw).toBe(peer.p75Krw);
    expect(json.dataQualityV3).toBe(peer.dataQualityV3);

    // 실제 DB 2026 데이터 기준: historyCount=4(2020/2022/2023/2025) - 변동을 실제로 측정할 수
    // 있고, 측정 결과가 leakage-safe threshold 이하라 HIGH다. reasonKey는 SERIES_STABLE(기존
    // 문구 유지)이어야 한다 - SINGLE_HISTORY 문구가 아니다.
    expect(json.seriesSignal.historyCount).toBeGreaterThanOrEqual(2);
    expect(json.reliabilityTier).toBe("HIGH");
    expect(json.reliabilityReason).toBe("동일 축제의 과거 예산 이력을 활용했고, 물가 보정 후 연도별 예산 변동이 비교적 안정적입니다.");
  });

  it("FUZZY: 표기가 살짝 다른 실제 축제명 -> MATCHED + FUZZY, semantics 동일하게 적용", async () => {
    const overrides = {
      regionCode: "SEOUL",
      district: "노원구",
      festivalTypes: ["COMMUNITY"],
      venueType: "VILLAGE",
      durationDays: 2,
      planningYear: 2026,
    };
    const { peer } = await callPeerOnly(overrides);
    const { status, json } = await callPlanningApi({ ...overrides, festivalName: "노원수제맥주축제" });

    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("MATCHED");
    expect(json.seriesSignal.matchMethod).toBe("FUZZY");
    expect(json.seriesSignal.canonicalName).toBe("노원 수제맥주 축제");
    expect(json.estimateBasis).toBe("SERIES_HISTORY_MEDIAN");
    expect(json.estimatedBudgetKrw).toBe(json.seriesSignal.seriesEstimatedBudgetKrw);
    expect(json.recommendedBudgetKrw).toBe(Math.round(json.seriesSignal.seriesEstimatedBudgetKrw * (1 + SERIES_PLANNING_BUFFER_RATE)));
    expect(json.p25Krw).toBe(peer.p25Krw);
    expect(json.p75Krw).toBe(peer.p75Krw);

    // PHASE 19-B — 실제 DB 2026 데이터 기준: historyCount=2, volatility가 threshold를 초과해 MEDIUM.
    expect(json.seriesSignal.historyCount).toBe(2);
    expect(json.reliabilityTier).toBe("MEDIUM");
    expect(json.reliabilityReason).toBe("동일 축제의 과거 예산 이력을 활용했지만, 물가 보정 후 연도별 예산 변동폭이 큰 편입니다.");
  });

  it("AMBIGUOUS fallback: 여러 series에 동시에 HIGH로 걸리는 실제 축제명 -> peer 결과 완전히 그대로, reliabilityTier=LOW", async () => {
    const overrides = {
      regionCode: "INCHEON",
      district: "-",
      festivalTypes: ["CULTURE_ART"],
      venueType: "VILLAGE",
      durationDays: 2,
      planningYear: 2026,
    };
    const { peer } = await callPeerOnly(overrides);
    const { status, json } = await callPlanningApi({ ...overrides, festivalName: "제21회 인천 펜타포트 음악축제" });

    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("AMBIGUOUS");
    expect(json.seriesSignal.seriesEstimatedBudgetKrw).toBeUndefined();
    expect(json.seriesSignal.matchMethod).toBeUndefined();
    expect(json.estimateBasis).toBe("PEER_SIMILARITY");
    expect(json.recommendationBasis).toBe("PEER_PLANNING");
    expect(json.estimatedBudgetKrw).toBe(peer.estimatedBudgetKrw);
    expect(json.recommendedBudgetKrw).toBe(peer.recommendedBudgetKrw);
    expect(json.p25Krw).toBe(peer.p25Krw);
    expect(json.p75Krw).toBe(peer.p75Krw);
    expect(json.dataQualityV3).toBe(peer.dataQualityV3);
    // PHASE 19-B — AMBIGUOUS도 PEER_FALLBACK 취급이므로 항상 LOW다.
    expect(json.reliabilityTier).toBe("LOW");
    expect(json.reliabilityReason).toBe(
      "동일 축제의 충분한 과거 예산 이력을 확인하지 못해 유사 축제 데이터를 기반으로 추정했습니다."
    );
  });

  it("UNMATCHED fallback: 과거 이력이 없는 실제 축제명 -> peer 결과 완전히 그대로, reliabilityTier=LOW", async () => {
    const overrides = {
      regionCode: "SEOUL",
      district: "-",
      festivalTypes: ["CULTURE_ART"],
      venueType: "VILLAGE",
      durationDays: 2,
      planningYear: 2026,
    };
    const { peer } = await callPeerOnly(overrides);
    const { status, json } = await callPlanningApi({ ...overrides, festivalName: "2026 한강 서래섬 피크닉 콘서트(봄)" });

    expect(status).toBe(200);
    expect(json.seriesSignal.status).toBe("UNMATCHED");
    expect(json.seriesSignal.seriesEstimatedBudgetKrw).toBeUndefined();
    expect(json.estimateBasis).toBe("PEER_SIMILARITY");
    expect(json.recommendationBasis).toBe("PEER_PLANNING");
    expect(json.estimatedBudgetKrw).toBe(peer.estimatedBudgetKrw);
    expect(json.recommendedBudgetKrw).toBe(peer.recommendedBudgetKrw);
    expect(json.p25Krw).toBe(peer.p25Krw);
    expect(json.p75Krw).toBe(peer.p75Krw);
    // PHASE 19-B
    expect(json.reliabilityTier).toBe("LOW");
    expect(json.reliabilityReason).toBe(
      "동일 축제의 충분한 과거 예산 이력을 확인하지 못해 유사 축제 데이터를 기반으로 추정했습니다."
    );
  });

  it("own-history는 INCLUDE_PUBLISHED_SAME_YEAR여도 planningYear와 같은 연도를 절대 쓰지 않는다 - peer는 같은 정책으로 계산된 결과와 일치", async () => {
    const overrides = {
      regionCode: "SEOUL",
      district: "-",
      festivalTypes: ["CULTURE_ART"],
      venueType: "VILLAGE",
      durationDays: 2,
      planningYear: 2026,
      referenceDataPolicy: "INCLUDE_PUBLISHED_SAME_YEAR", // 실제 DB상 2026=PUBLISHED_PLAN_COMPLETE
    };
    const { peer } = await callPeerOnly(overrides);
    const { json } = await callPlanningApi({ ...overrides, festivalName: "한강페스티벌" });

    expect(json.seriesSignal.status).toBe("MATCHED");
    // own-history는 same-year 정책과 무관하게 항상 <planningYear만 사용한다.
    expect(json.seriesSignal.historicalYears.every((y: number) => y < 2026)).toBe(true);
    expect(json.seriesSignal.latestHistoricalYear).toBeLessThan(2026);
    // 반면 peer P25~P75/estimatedBudget 등은 SAME_YEAR 정책이 적용된 peer 결과와 동일해야
    // 한다(series 전환이 peer의 정책 적용 자체를 방해하지 않음).
    expect(json.appliedReferenceDataPolicy).toBe(peer.appliedReferenceDataPolicy);
    expect(json.referenceYearTo).toBe(peer.referenceYearTo);
    expect(json.p25Krw).toBe(peer.p25Krw);
    expect(json.p75Krw).toBe(peer.p75Krw);
    expect(json.recommendedBudgetKrw).toBe(Math.round(json.seriesSignal.seriesEstimatedBudgetKrw * (1 + SERIES_PLANNING_BUFFER_RATE)));
  });

  /**
   * route-level regression — 실제 API 호출 경로(POST 핸들러, 이 파일의 다른 테스트와 동일하게
   * NextRequest를 만들어 실제 export된 POST를 그대로 호출)에서 부산국제록페스티벌이 정확히
   * MATCHED로 처리되는지 확인한다. 이 케이스는 한때 curl 커맨드라인 인자로 한글 festivalName을
   * 전달했을 때(Windows Git Bash → 네이티브 curl.exe 인자 인코딩 문제)만 UNMATCHED로 잘못
   * 보이는 진단 혼선이 있었다 - route.ts/computeSeriesSignal/lookupTarget 자체는 항상 정확했다
   * (direct 함수 호출·in-process route 호출 모두 MATCHED로 일치했음). 이 테스트는 NextRequest에
   * JS 문자열을 그대로 실어 보내 그런 인코딩 문제가 재발해도(또는 다른 경로 통합 문제가 생겨도)
   * 바로 잡아낸다.
   */
  it("route 경계 regression — 부산국제록페스티벌 planningYear=2026: 실제 POST 핸들러 호출에서도 MATCHED (leakage-safe: 2026 미포함, historyCount=7)", async () => {
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
    expect(json.seriesSignal.matchMethod).toBe("EXACT");
    expect(json.seriesSignal.canonicalName).toBe("부산국제록페스티벌");
    expect(json.seriesSignal.historyCount).toBe(7);
    // leakage-safe: planningYear=2026 자신의 record(2026)는 절대 포함되지 않는다.
    expect(json.seriesSignal.historicalYears.every((y: number) => y < 2026)).toBe(true);
    expect(json.estimateBasis).toBe("SERIES_HISTORY_MEDIAN"); // literal 이름 자체는 G0 도입 이후에도 유지(apply-planning-semantics.ts 참고 - UI gate로 쓰이는 literal이라 임의로 바꾸지 않음).
    expect(json.estimatedBudgetKrw).toBe(json.seriesSignal.seriesEstimatedBudgetKrw);

    // seriesHistoryDetail(assistant-tester 진단용 additive 필드) — 실제 DB 기준: 유효 7건 +
    // 2022(budgetQualityFlag=MISSING_OR_NONPOSITIVE) 1건 제외 = 표시 8건.
    expect(json.seriesHistoryDetail).not.toBeNull();
    expect(json.seriesHistoryDetail.eligibleForSeriesCalculationCount).toBe(7);
    expect(json.seriesHistoryDetail.excludedCount).toBe(1);
    expect(json.seriesHistoryDetail.displayedRecordCount).toBe(8);
    expect(json.seriesHistoryDetail.records.some((r: { datasetYear: number }) => r.datasetYear === 2026)).toBe(false);
    const excluded2022 = json.seriesHistoryDetail.records.find((r: { datasetYear: number }) => r.datasetYear === 2022);
    expect(excluded2022?.eligibleForSeriesCalculation).toBe(false);
    expect(excluded2022?.exclusionReason).toBe("MISSING_OR_NONPOSITIVE");
  });

  /**
   * PHASE G0 golden case — 부산국제록페스티벌(연구 문서의 대표 사례)이 실제 production route를
   * 거쳐서도 정확히 LATEST 분기로 라우팅되고, 2025 record 하나만 point estimate source가 되며
   * (나머지 6건은 "eligible이지만 point estimate source는 아님"), 2026 actual이 계산 input 어디에도
   * 쓰이지 않는지 확인한다. estimatedBudgetKrw ≈ 72억(연구 재현값과 parity).
   */
  it("G0 golden case — 부산국제록페스티벌 planningYear=2026: latestHistoricalGap=1 → estimateSource=LATEST, estimatedBudgetKrw≈72억, 2025 record만 point estimate source", async () => {
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
    expect(json.seriesSignal.latestHistoricalYear).toBe(2025);
    expect(json.seriesSignal.latestHistoricalGap).toBe(1);
    expect(json.seriesSignal.estimateSource).toBe("LATEST");
    // 연구 문서 재현값과 parity(2025 record는 CPI base year 자신이라 무보정 - planningYear=2026 ->
    // baseYear=2025 -> CPI[2025]/CPI[2025]=1).
    expect(json.estimatedBudgetKrw).toBe(7_200_000_000);
    expect(json.recommendedBudgetKrw).toBe(Math.round(7_200_000_000 * 1.05));

    expect(json.seriesHistoryDetail.estimateSource).toBe("LATEST");
    expect(json.seriesHistoryDetail.latestHistoricalYear).toBe(2025);
    expect(json.seriesHistoryDetail.latestHistoricalGap).toBe(1);
    // 2026 actual은 leakage-safe 재확인: history record 어디에도 2026이 없어야 한다.
    expect(json.seriesHistoryDetail.records.every((r: { datasetYear: number }) => r.datasetYear < 2026)).toBe(true);

    const record2025 = json.seriesHistoryDetail.records.find((r: { datasetYear: number }) => r.datasetYear === 2025);
    expect(record2025?.eligibleForSeriesCalculation).toBe(true);
    expect(record2025?.usedAsPointEstimateSource).toBe(true);

    // 나머지 eligible record(2017/2018/2019/2021/2023/2024)는 "제외"가 아니라 "eligible이지만
    // point estimate source는 아님" 상태여야 한다(10절 semantics 분리).
    const otherEligible = json.seriesHistoryDetail.records.filter(
      (r: { datasetYear: number; eligibleForSeriesCalculation: boolean }) => r.datasetYear !== 2025 && r.eligibleForSeriesCalculation
    );
    expect(otherEligible.length).toBe(6);
    expect(otherEligible.every((r: { usedAsPointEstimateSource: boolean }) => r.usedAsPointEstimateSource === false)).toBe(true);

    // READ-ONLY DIAGNOSTIC(Series Data Quality Audit) — additive 필드, estimatedBudgetKrw(72억)에
    // 전혀 영향을 주지 않는다(위 assertion들과 완전히 동일). 부산국제록페스티벌은 지속 성장 케이스라
    // DIGIT_SHIFT/ISOLATED_SPIKE/COMPONENT_MISMATCH로 오판되지 않아야 한다(spec 19절 known case).
    expect(json.seriesDataQualityAudit).not.toBeNull();
    expect(json.seriesDataQualityAudit.recordCount).toBe(7);
    expect(json.seriesDataQualityAudit.hasDigitShiftPattern).toBe(false);
    expect(json.seriesDataQualityAudit.hasIsolatedSpike).toBe(false);
    expect(json.seriesDataQualityAudit.hasComponentMismatch).toBe(false);
    expect(json.seriesDataQualityAudit.highCount).toBe(0);

    // 2025(point estimate source, 72억)는 prior median 대비 정당한 review 신호(MEDIUM)를 가질 수
    // 있다 - 이는 실제 다년간 성장을 반영한 것이지 오류가 아니다(HIGH가 아니어야 함).
    const auditRow2025 = json.seriesDataQualityAudit.records.find((r: { datasetYear: number }) => r.datasetYear === 2025);
    expect(auditRow2025).toBeDefined();
    expect(auditRow2025.budgetQualityFlag).toBe("VALID");
    expect(auditRow2025.severity).not.toBe("HIGH");
    expect(auditRow2025.reasons).not.toContain("DIGIT_SHIFT_PATTERN");
    expect(auditRow2025.reasons).not.toContain("ISOLATED_SPIKE_PATTERN");
    expect(auditRow2025.reasons).not.toContain("COMPONENT_SUM_MISMATCH");

    // READ-ONLY DIAGNOSTIC(G0 이후 Reliability Revalidation) — additive 필드, 위 estimate/
    // recommendation/reliabilityTier 값에 전혀 영향을 주지 않는다. historyCount=7(>=2)이므로
    // historicalDispersion은 항상 계산 가능해야 하고(null이면 안 됨), reasonKey는 tier와 구조적으로
    // 일치해야 한다(MEDIUM<->SERIES_VOLATILE, HIGH+multi-history<->SERIES_STABLE).
    expect(json.reliabilityDiagnostic).not.toBeNull();
    expect(json.reliabilityDiagnostic.historicalDispersion).not.toBeNull();
    if (json.reliabilityTier === "MEDIUM") {
      expect(json.reliabilityDiagnostic.reasonKey).toBe("SERIES_VOLATILE");
    } else {
      expect(json.reliabilityTier).toBe("HIGH");
      expect(json.reliabilityDiagnostic.reasonKey).toBe("SERIES_STABLE"); // historyCount=7이므로 SINGLE_HISTORY일 수 없다.
    }
  });
});

/**
 * PHASE 19-B Part 8 — 위 개별 시나리오에서 이미 확인한 것 외에, "legacy confidence가
 * recommendation/reliability에 영향을 주지 않는다"를 서로 다른 실제 query 여러 개에 걸쳐
 * 구조적으로 재확인한다. dataQualityV3(=legacy confidence 계산에 쓰이는 sampleCount/similarity/
 * completeness와 밀접하게 연동되는 지표)가 쿼리마다 실제로 다르게 나오는 것을 전제로, 그런데도
 * peer recommendedBudgetKrw는 항상 max(estimatedBudgetKrw, p60Krw)라는 단순 공식과 정확히
 * 일치함을 확인한다 - "confidence가 높든 낮든 공식이 절대 안 바뀐다"는 것을 여러 데이터 포인트로
 * 보여준다(단일 함수 시그니처 증명은 test/lib/multiyear/final-recommendation.test.ts 참고).
 */
describe("POST /api/v1/multiyear-budget-estimates - PHASE 19-B: legacy confidence 독립성 & recommendationBasis 최종 semantics", () => {
  const QUERIES: Record<string, unknown>[] = [
    { regionCode: "SEOUL", festivalTypes: ["CULTURE_ART"], venueType: "VILLAGE", durationDays: 2, planningYear: 2026 },
    { regionCode: "SEOUL", district: "노원구", festivalTypes: ["COMMUNITY"], venueType: "VILLAGE", durationDays: 2, planningYear: 2026 },
    { regionCode: "INCHEON", festivalTypes: ["CULTURE_ART"], venueType: "VILLAGE", durationDays: 2, planningYear: 2026 },
    { regionCode: "SEOUL", festivalTypes: ["CULTURE_ART"], venueType: "VILLAGE", durationDays: 7, planningYear: 2026 },
  ];

  it("서로 다른 실제 query(dataQualityV3가 서로 다르게 나옴)마다 peer recommendedBudgetKrw는 항상 max(estimatedBudgetKrw, p60Krw)와 정확히 일치한다", async () => {
    const results = await Promise.all(QUERIES.map((q) => callPlanningApi(q)));
    const dataQualityValues = new Set(results.map((r) => r.json.dataQualityV3));
    // 전제 확인: 쿼리마다 실제로 dataQualityV3가 달라진다(=legacy confidence 관련 입력이 균일하지 않다).
    expect(dataQualityValues.size).toBeGreaterThan(1);

    for (const { json } of results) {
      expect(json.recommendedBudgetKrw).toBe(Math.max(json.estimatedBudgetKrw, json.p60Krw));
    }
  });

  it("recommendationBasis는 SERIES_HISTORY_WITH_FIXED_BUFFER 또는 PEER_PLANNING 둘 중 하나만 가능하고, WITH_CONTINGENCY 계열 literal은 더 이상 존재하지 않는다", async () => {
    const results = await Promise.all([
      callPlanningApi({ regionCode: "SEOUL", district: "-", festivalTypes: ["CULTURE_ART"], venueType: "VILLAGE", durationDays: 2, planningYear: 2026, festivalName: "한강페스티벌" }),
      callPlanningApi({ regionCode: "SEOUL", festivalTypes: ["CULTURE_ART"], venueType: "VILLAGE", durationDays: 2, planningYear: 2026 }),
    ]);
    for (const { json } of results) {
      expect(["SERIES_HISTORY_WITH_FIXED_BUFFER", "PEER_PLANNING"]).toContain(json.recommendationBasis);
      expect(json.recommendationBasis).not.toMatch(/CONTINGENCY/);
    }
  });

  it("reliabilityTier는 MATCHED(+VALID history)에서만 HIGH/MEDIUM일 수 있고, 그 외 모든 status에서는 LOW다", async () => {
    const results = await Promise.all([
      callPlanningApi({ regionCode: "SEOUL", district: "-", festivalTypes: ["CULTURE_ART"], venueType: "VILLAGE", durationDays: 2, planningYear: 2026, festivalName: "한강페스티벌" }), // MATCHED
      callPlanningApi({ regionCode: "SEOUL", district: "-", festivalTypes: ["CULTURE_ART"], venueType: "VILLAGE", durationDays: 2, planningYear: 2026, festivalName: "2026 한강 서래섬 피크닉 콘서트(봄)" }), // UNMATCHED
      callPlanningApi({ regionCode: "INCHEON", district: "-", festivalTypes: ["CULTURE_ART"], venueType: "VILLAGE", durationDays: 2, planningYear: 2026, festivalName: "제21회 인천 펜타포트 음악축제" }), // AMBIGUOUS
      callPlanningApi({ regionCode: "SEOUL", festivalTypes: ["CULTURE_ART"], venueType: "VILLAGE", durationDays: 2, planningYear: 2026 }), // NOT_REQUESTED
    ]);
    const [matched, unmatched, ambiguous, notRequested] = results;
    expect(["HIGH", "MEDIUM"]).toContain(matched.json.reliabilityTier);
    expect(unmatched.json.reliabilityTier).toBe("LOW");
    expect(ambiguous.json.reliabilityTier).toBe("LOW");
    expect(notRequested.json.reliabilityTier).toBe("LOW");
  });
});
