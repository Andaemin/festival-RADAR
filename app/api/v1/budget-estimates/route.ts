import { NextRequest, NextResponse } from "next/server";
import { BudgetEstimateRequest } from "@/lib/domain/types";
import { FestivalType, Region, VenueType } from "@/lib/domain/enums";
import { estimateBudget } from "@/lib/services/budget-estimator";
import { prisma } from "@/lib/db/prisma";

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
    // 최신 연도의 CONFIRMED 예산 레코드 전체 로드
    const latestYear = await prisma.festivalRecord.aggregate({ _max: { datasetYear: true } });
    const datasetYear = latestYear._max.datasetYear;

    if (!datasetYear) {
      return NextResponse.json(
        { message: "적재된 축제 데이터가 없습니다. 먼저 데이터를 임포트하세요." },
        { status: 503 }
      );
    }

    const records = await prisma.festivalRecord.findMany({
      where: { datasetYear, budgetStatus: "CONFIRMED" },
      select: {
        id: true,
        datasetYear: true,
        festivalName: true,
        region: true,
        administrativeDistrict: true,
        festivalType: true,
        venueType: true,
        durationDays: true,
        totalBudgetKrw: true,
      },
    });

    const yearPool = records.map((r) => ({
      ...r,
      region: r.region as Region,
      festivalType: r.festivalType as FestivalType,
      venueType: r.venueType as VenueType,
    }));

    const result = estimateBudget(body, yearPool);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/v1/budget-estimates]", error);
    return NextResponse.json({ message: "예산 추정 중 오류가 발생했습니다." }, { status: 500 });
  }
}
