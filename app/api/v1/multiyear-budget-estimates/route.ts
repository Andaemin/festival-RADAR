import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { FestivalType, Region, VenueType } from "@/lib/domain/enums";
import { estimateForPlanning, MULTIYEAR_PLANNING_MODEL } from "@/lib/multiyear/planning-estimator";
import { MultiYearBudgetEstimateRequest } from "@/lib/multiyear/planning-api-types";
import { loadPublicationStatusByYear } from "@/lib/multiyear/publication-status";
import { loadAllMultiYearRecords } from "@/lib/multiyear/record-loader";
import { ReferenceDataPolicy, resolveEffectivePolicy } from "@/lib/multiyear/reference-data-policy";
import { filterReferencePool } from "@/lib/multiyear/reference-year-filter";
import { MultiYearQuery } from "@/lib/multiyear/types";

/**
 * 다년도(2017~) Planning Assistant API - Phase 5에서 Spring parity(84/84 golden fixture)까지
 * 검증한 estimateForPlanning을 그대로 호출한다. 기존 production {@code /api/v1/budget-estimates}
 * (2026 단일연도 S0)는 이 라우트가 생겨도 전혀 바뀌지 않는다 - 별도 경로/별도 계산 엔진이다.
 */
export async function POST(request: NextRequest) {
  let body: MultiYearBudgetEstimateRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "요청 본문이 올바른 JSON 형식이 아닙니다." }, { status: 400 });
  }

  const { regionCode, festivalTypes, venueType, durationDays, planningYear } = body;

  if (!regionCode || !Array.isArray(festivalTypes) || festivalTypes.length === 0 || !venueType || durationDays === undefined || planningYear === undefined) {
    return NextResponse.json(
      { message: "regionCode, festivalTypes(1개 이상), venueType, durationDays, planningYear는 필수 항목입니다." },
      { status: 400 }
    );
  }

  if (!Object.values(Region).includes(regionCode as Region)) {
    return NextResponse.json({ message: `유효하지 않은 지역 코드입니다: ${regionCode}` }, { status: 400 });
  }
  for (const t of festivalTypes) {
    if (!Object.values(FestivalType).includes(t as FestivalType)) {
      return NextResponse.json({ message: `유효하지 않은 축제 유형입니다: ${t}` }, { status: 400 });
    }
  }
  if (!Object.values(VenueType).includes(venueType as VenueType)) {
    return NextResponse.json({ message: `유효하지 않은 장소 유형입니다: ${venueType}` }, { status: 400 });
  }
  if (typeof durationDays !== "number" || durationDays < 2) {
    return NextResponse.json({ message: "durationDays는 2 이상의 숫자여야 합니다." }, { status: 400 });
  }
  if (typeof planningYear !== "number" || !Number.isInteger(planningYear)) {
    return NextResponse.json({ message: "planningYear는 정수여야 합니다." }, { status: 400 });
  }

  let requestedPolicy: ReferenceDataPolicy;
  if (body.referenceDataPolicy === undefined || body.referenceDataPolicy === null || body.referenceDataPolicy === "") {
    requestedPolicy = ReferenceDataPolicy.HISTORICAL_ONLY;
  } else if (Object.values(ReferenceDataPolicy).includes(body.referenceDataPolicy as ReferenceDataPolicy)) {
    requestedPolicy = body.referenceDataPolicy as ReferenceDataPolicy;
  } else {
    return NextResponse.json(
      { message: `유효하지 않은 referenceDataPolicy입니다: ${body.referenceDataPolicy} (HISTORICAL_ONLY 또는 INCLUDE_PUBLISHED_SAME_YEAR만 허용)` },
      { status: 400 }
    );
  }

  const query: MultiYearQuery = {
    region: regionCode as Region,
    district: body.district?.trim() || null,
    typeTokens: new Set(festivalTypes as FestivalType[]),
    venueType: venueType as VenueType,
    durationDays,
  };

  try {
    const [allRecords, publicationStatusByYear] = await Promise.all([
      loadAllMultiYearRecords(prisma),
      loadPublicationStatusByYear(prisma),
    ]);

    // reference pool 0건 판정은 반드시 "실제로 적용될 정책"을 먼저 확정한 뒤 그 정책 기준으로
    // 해야 한다. requested가 아니라 resolveEffectivePolicy가 돌려주는 appliedPolicy로 필터링한
    // 결과가 0건일 때만 도메인 오류다 - 예: planningYear=2017/HISTORICAL_ONLY는 "<2017"이 기준이라
    // 2017년 데이터(733건)가 있어도 0건이 맞다. "<=planningYear"로 미리 넓게 체크하면 이런
    // 경우를 놓치고 estimateForPlanning이 조용히 sampleCount=0인 200 응답을 돌려주게 된다.
    const appliedPolicy = resolveEffectivePolicy(planningYear, requestedPolicy, (year) => publicationStatusByYear.get(year) ?? null);
    const includeSameYear = appliedPolicy === ReferenceDataPolicy.INCLUDE_PUBLISHED_SAME_YEAR;
    const referencePool = filterReferencePool(allRecords, planningYear, includeSameYear);
    if (referencePool.length === 0) {
      const availableYears = allRecords.map((r) => r.datasetYear);
      const minYear = availableYears.length > 0 ? Math.min(...availableYears) : null;
      const maxYear = availableYears.length > 0 ? Math.max(...availableYears) : null;
      return NextResponse.json(
        {
          message: `planningYear=${planningYear}(적용 정책: ${appliedPolicy})에 대해 참고할 수 있는 다년도 데이터가 없습니다. (보유 데이터: ${minYear}~${maxYear})`,
        },
        { status: 422 }
      );
    }

    const result = estimateForPlanning(query, planningYear, requestedPolicy, allRecords, publicationStatusByYear);
    return NextResponse.json({ model: MULTIYEAR_PLANNING_MODEL, ...result });
  } catch (error) {
    console.error("[POST /api/v1/multiyear-budget-estimates]", error);
    return NextResponse.json({ message: "다년도 계획예산 추정 중 오류가 발생했습니다." }, { status: 500 });
  }
}
