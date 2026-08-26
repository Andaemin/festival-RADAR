import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getMultiYearDataRevision } from "@/lib/multiyear-series/data-revision";
import { getCachedFrozenSeriesModel, getCachedSeriesRecords } from "@/lib/multiyear-series/runtime-cache";
import { searchFrozenSeries } from "@/lib/multiyear-series/series-search";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * PHASE 2(assistant-tester 기존 축제 검색/자동기입) — read-only autocomplete API.
 *
 * `/api/v1/multiyear-budget-estimates`가 이미 쓰고 있는 leakage-safe cache 경로
 * (getMultiYearDataRevision → getCachedSeriesRecords → getCachedFrozenSeriesModel)를 그대로
 * 재사용한다 - 이 route는 별도 series linker를 만들지 않고, 검색 요청마다 9천여 건 전체를 다시
 * 클러스터링하지도 않는다(이미 캐시된 FrozenSeriesModel을 읽기만 함).
 *
 * estimate 본체(POST /api/v1/multiyear-budget-estimates)의 계산 로직은 이 파일이 전혀 건드리지
 * 않는다 - 완전히 독립된 GET 전용 read endpoint다.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const planningYearRaw = searchParams.get("planningYear");
  const limitRaw = searchParams.get("limit");

  if (q === "") {
    return NextResponse.json({ message: "q는 필수 항목입니다." }, { status: 400 });
  }

  const planningYear = planningYearRaw !== null ? Number(planningYearRaw) : NaN;
  if (!Number.isInteger(planningYear)) {
    return NextResponse.json({ message: "planningYear는 정수여야 합니다." }, { status: 400 });
  }

  let limit = DEFAULT_LIMIT;
  if (limitRaw !== null) {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return NextResponse.json({ message: "limit은 1 이상의 정수여야 합니다." }, { status: 400 });
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  try {
    const dataRevision = await getMultiYearDataRevision(prisma);
    const allSeriesRecords = await getCachedSeriesRecords(prisma, dataRevision);
    // leakage-safe: getCachedFrozenSeriesModel 내부에서 datasetYear < planningYear로 이미
    // 걸러진 trainingPool만으로 model을 만든다(estimator와 완전히 동일한 cutoff 규칙, 5절).
    const model = await getCachedFrozenSeriesModel(allSeriesRecords, dataRevision, planningYear);

    const results = searchFrozenSeries(model, q, limit);
    return NextResponse.json({ results });
  } catch (error) {
    console.error("[GET /api/v1/multiyear-series-search]", error);
    return NextResponse.json({ message: "축제 검색 중 오류가 발생했습니다." }, { status: 500 });
  }
}
