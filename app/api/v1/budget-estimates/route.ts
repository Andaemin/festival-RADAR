import { NextRequest, NextResponse } from "next/server";
import { BudgetEstimateRequest } from "@/lib/domain/types";
import { FestivalType, Region, VenueType } from "@/lib/domain/enums";
import { estimateBudget } from "@/lib/services/budget-estimator";
import { getLatestDatasetYear, loadFestivalRecords } from "@/lib/services/festival-record-source";

export async function POST(request: NextRequest) {
  let body: BudgetEstimateRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "요청 본문이 올바른 JSON 형식이 아닙니다." }, { status: 400 });
  }

  const { regionCode, festivalType, venueType, durationDays } = body;

  if (!regionCode || !festivalType || !venueType || !durationDays) {
    return NextResponse.json(
      { message: "regionCode, festivalType, venueType, durationDays는 필수 항목입니다." },
      { status: 400 }
    );
  }

  if (!Object.values(Region).includes(regionCode as Region)) {
    return NextResponse.json({ message: `유효하지 않은 지역 코드입니다: ${regionCode}` }, { status: 400 });
  }
  if (!Object.values(FestivalType).includes(festivalType as FestivalType)) {
    return NextResponse.json({ message: `유효하지 않은 축제 유형입니다: ${festivalType}` }, { status: 400 });
  }
  if (!Object.values(VenueType).includes(venueType as VenueType)) {
    return NextResponse.json({ message: `유효하지 않은 장소 유형입니다: ${venueType}` }, { status: 400 });
  }
  if (typeof durationDays !== "number" || durationDays < 2) {
    return NextResponse.json({ message: "durationDays는 2 이상의 숫자여야 합니다." }, { status: 400 });
  }

  try {
    // 최신 연도의 예산 확정분만 쓴다(다년도 원장 기준. 옛 CONFIRMED = budgetQualityFlag VALID).
    // 전 연도를 넣으면 추정 결과가 달라지므로 의미를 그대로 유지한다 - 다년도 추정은
    // lib/multiyear/*가 따로 담당한다.
    const datasetYear = await getLatestDatasetYear();

    if (!datasetYear) {
      return NextResponse.json(
        { message: "적재된 축제 데이터가 없습니다. 먼저 데이터를 임포트하세요." },
        { status: 503 }
      );
    }

    const yearPool = await loadFestivalRecords({ datasetYear, budgetValidOnly: true });

    const result = estimateBudget(body, yearPool);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/v1/budget-estimates]", error);
    return NextResponse.json({ message: "예산 추정 중 오류가 발생했습니다." }, { status: 500 });
  }
}
