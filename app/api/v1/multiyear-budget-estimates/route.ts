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
import { applySeriesPlanningSemantics } from "@/lib/multiyear-series/apply-planning-semantics";
import { auditSeriesDataQuality, getCachedSeriesRecordBudgetComponents, SeriesGroupDataQualitySummary } from "@/lib/multiyear-series/data-quality-audit";
import { getMultiYearDataRevision } from "@/lib/multiyear-series/data-revision";
import { computeCpiAdjustedVolatility, computePlanningReliability, EMPTY_FROZEN_SERIES_MODEL } from "@/lib/multiyear-series/reliability";
import { getCachedFrozenSeriesModel, getCachedSeriesRecords, getCachedVolatilityThreshold } from "@/lib/multiyear-series/runtime-cache";
import { buildSeriesHistoryDetail, SeriesHistoryDetailDto } from "@/lib/multiyear-series/series-history-detail";
import { lookupTarget } from "@/lib/multiyear-series/series-lookup";
import { computeSeriesSignal, SERIES_SIGNAL_NOT_REQUESTED, SeriesSignalResponse } from "@/lib/multiyear-series/series-signal";
import { buildSyntheticTargetRecord } from "@/lib/multiyear-series/target-from-query";
import { FrozenSeriesModel } from "@/lib/multiyear-series/types";

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

  // PHASE 9C-A(Series Shadow Integration): festivalName은 optional이다 - 없으면 아래 모든 series
  // 관련 계산/쿼리를 건너뛰고, estimatedBudgetKrw/recommendedBudgetKrw/P25~P75/confidence 등
  // 기존 응답 필드는 이 파라미터가 추가되기 전과 100% 동일하게 나온다(회귀 테스트로 확인).
  const festivalName = typeof body.festivalName === "string" ? body.festivalName.trim() || undefined : undefined;

  const query: MultiYearQuery = {
    region: regionCode as Region,
    district: body.district?.trim() || null,
    typeTokens: new Set(festivalTypes as FestivalType[]),
    venueType: venueType as VenueType,
    durationDays,
    festivalName,
  };

  try {
    // PHASE 9C-A.1: festivalName이 없으면 dataRevision 조회조차 하지 않는다(series 비활성 요청은
    // 이 Phase 이전과 완전히 동일한 쿼리만 나간다).
    const [allRecords, publicationStatusByYear, dataRevision] = await Promise.all([
      loadAllMultiYearRecords(prisma),
      loadPublicationStatusByYear(prisma),
      festivalName ? getMultiYearDataRevision(prisma) : Promise.resolve<number | null>(null),
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

    // estimateForPlanning은 festivalName을 전혀 읽지 않는다 - P25/P50/P60/P75/weightedAverage/
    // sampleCount/dataQualityV3/fallbackLevel 등 peer evidence/statistics는 이 Phase에서도
    // 절대 수정하지 않는다(아래에서 result를 그대로 spread한다). series signal은 그 결과와
    // 완전히 무관하게 별도로 계산한다.
    const result = estimateForPlanning(query, planningYear, requestedPolicy, allRecords, publicationStatusByYear);

    // PHASE 9C-A.1: FrozenSeriesModel은 target(festivalName)과 무관하다 - (dataRevision,
    // effectiveTrainingThroughYear) 단위로 process-local 캐시에서 재사용한다(동일 키에 대한
    // 동시 요청은 in-flight Promise를 공유해 buildFrozenSeriesModel을 중복 실행하지 않는다).
    //
    // PHASE 19-B: reliability(computePlanningReliability)도 이 model/threshold를 그대로 재사용한다
    // - festivalName이 없으면 seriesSignal이 NOT_REQUESTED로 고정되므로 model/threshold는
    // computePlanningReliability의 LOW 분기에서 전혀 읽히지 않는다(EMPTY_FROZEN_SERIES_MODEL/
    // threshold=null을 그대로 둬도 안전 - reliability.ts 참고). 이 두 변수를 조건부로만 채우고
    // computePlanningReliability는 아래에서 딱 한 번, 무조건 호출한다 - route.ts가 "festivalName
    // 없으면 LOW"라는 판정 로직을 별도로 다시 만들지 않기 위함이다.
    let seriesSignal: SeriesSignalResponse = SERIES_SIGNAL_NOT_REQUESTED;
    let seriesModelForReliability: FrozenSeriesModel = EMPTY_FROZEN_SERIES_MODEL;
    let volatilityThreshold: number | null = null;
    // assistant-tester 진단용 — Series MATCHED일 때 실제 계산에 쓰인 개별 historical record를
    // 노출한다(seriesSignal의 매칭 판정을 재사용할 뿐, 새로 매칭하지 않는다). MATCHED가 아니면
    // 항상 null - production 계산(estimatedBudgetKrw 등)에는 이 필드가 전혀 관여하지 않는다.
    let seriesHistoryDetail: SeriesHistoryDetailDto | null = null;
    // READ-ONLY DIAGNOSTIC(Series Data Quality Audit) — assistant-tester 진단용 additive 필드.
    // own-history.ts/computeSeriesSignal의 계산을 전혀 다시 하지 않는다 - 이미 계산된
    // model/allSeriesRecords를 그대로 읽어 "이 Series의 VALID historical record 중 review가
    // 필요해 보이는 것"만 진단할 뿐이다. estimatedBudgetKrw/recommendedBudgetKrw 등 production
    // 계산 어디에도 이 필드는 입력으로 쓰이지 않는다(REVIEW_REQUIRED != DATA_ERROR_CONFIRMED).
    let seriesDataQualityAudit: SeriesGroupDataQualitySummary | null = null;
    // READ-ONLY DIAGNOSTIC(G0 이후 Reliability Revalidation) — reliability.ts의
    // computeCpiAdjustedVolatility(private historicalMembers와 동일한 historical 집합)를 그대로
    // 재사용해 raw dispersion 값만 노출한다. reliability tier 판정식 자체는 전혀 다시 만들지
    // 않는다 - computePlanningReliability(아래에서 호출)가 낸 tier/reasonKey를 그대로 표시할 뿐.
    let reliabilityHistoricalDispersion: number | null = null;
    if (festivalName && dataRevision !== null) {
      const allSeriesRecords = await getCachedSeriesRecords(prisma, dataRevision);
      const model = await getCachedFrozenSeriesModel(allSeriesRecords, dataRevision, planningYear);
      seriesSignal = computeSeriesSignal(festivalName, query.region, query.district, query.typeTokens, planningYear, model);
      seriesModelForReliability = model;
      const thresholdResult = await getCachedVolatilityThreshold(allSeriesRecords, dataRevision, planningYear);
      volatilityThreshold = thresholdResult.threshold;

      if (seriesSignal.status === "MATCHED") {
        const target = buildSyntheticTargetRecord({
          festivalName,
          region: query.region,
          district: query.district,
          typeTokens: query.typeTokens,
          planningYear,
        });
        const lookup = lookupTarget(target, model);
        // seriesSignal.status==="MATCHED"면 estimateSource/latestHistoricalYear는 항상 채워져
        // 있다(own-history.ts가 VALID history가 있을 때만 MATCHED를 반환하므로) - re-derive하지
        // 않고 이미 계산된 값을 그대로 넘긴다.
        if (lookup.matchedGroupId !== null && seriesSignal.estimateSource !== undefined && seriesSignal.latestHistoricalYear !== undefined) {
          seriesHistoryDetail = buildSeriesHistoryDetail(
            lookup.matchedGroupId,
            planningYear,
            model,
            allSeriesRecords,
            seriesSignal.estimateSource,
            seriesSignal.latestHistoricalYear
          );

          // model은 이미 이 planningYear 기준 leakage-safe cutoff로 빌드됐으므로(9절/getCachedFrozenSeriesModel),
          // 이 감사도 자동으로 datasetYear < planningYear만 본다(spec 21절 leakage safety 요구사항).
          const componentsById = await getCachedSeriesRecordBudgetComponents(prisma, dataRevision);
          const auditGroups = auditSeriesDataQuality(model, allSeriesRecords, componentsById);
          seriesDataQualityAudit = auditGroups.find((g) => g.groupId === lookup.matchedGroupId) ?? null;

          const historicalForDispersion = model.groupsById.get(lookup.matchedGroupId)!.members.filter((m) => m.datasetYear < planningYear);
          reliabilityHistoricalDispersion = computeCpiAdjustedVolatility(historicalForDispersion, planningYear);
        }
      }
    }

    // PHASE 9C-C: Phase 9C-B에서 확정한 semantics를 순수 함수로 배선한다 - series MATCHED(+VALID
    // history)일 때만 estimatedBudgetKrw/recommendedBudgetKrw를 series 값으로 교체하고, 그 외
    // 모든 경우(NOT_REQUESTED/UNMATCHED/AMBIGUOUS/NO_VALID_HISTORY)는 peer 값 그대로다.
    // P25/P50/P60/P75/weightedAverage/sampleCount/dataQualityV3/confidence는 이 함수가 아예
    // 손대지 않는다 - `...result`로 그대로 흘려보낸다.
    const applied = applySeriesPlanningSemantics(
      { estimatedBudgetKrw: result.estimatedBudgetKrw, recommendedBudgetKrw: result.recommendedBudgetKrw, p60Krw: result.p60Krw },
      seriesSignal
    );

    // PHASE 19-B: reliability는 Phase 19-A production 함수를 그대로 호출한다 - route.ts는 재계산
    // 로직을 만들지 않는다. numeric legacy confidence/dataQualityV3는 이 계산에 전혀 관여하지
    // 않는다(computePlanningReliability 시그니처 자체에 그런 인자가 없다).
    const reliability = computePlanningReliability(
      seriesSignal,
      festivalName ?? "",
      query.region,
      query.district,
      query.typeTokens,
      planningYear,
      seriesModelForReliability,
      volatilityThreshold
    );

    return NextResponse.json({
      model: MULTIYEAR_PLANNING_MODEL,
      ...result,
      estimatedBudgetKrw: applied.estimatedBudgetKrw,
      recommendedBudgetKrw: applied.recommendedBudgetKrw,
      estimateBasis: applied.estimateBasis,
      recommendationBasis: applied.recommendationBasis,
      rangeBasis: applied.rangeBasis,
      dataQualityBasis: applied.dataQualityBasis,
      seriesSignal,
      // assistant-tester 진단용 additive 필드 — Series MATCHED일 때만 채워진다(그 외 null).
      // production 계산 어디에서도 이 필드를 입력으로 읽지 않는다.
      seriesHistoryDetail,
      // READ-ONLY DIAGNOSTIC(Series Data Quality Audit) — Series MATCHED일 때만 채워진다. severity/
      // reasons는 "REVIEW_REQUIRED"를 뜻할 뿐 "DATA_ERROR_CONFIRMED"가 아니다 - 자동 수정/제외 없음.
      seriesDataQualityAudit,
      // PHASE 19-B — additive 신규 필드. legacy dataQualityV3/confidence류와 이름·의미 모두
      // 분리된 사용자 신뢰도 표시용 필드(HIGH/MEDIUM/LOW + 설명 문구) - 기존 필드는 하나도
      // 지우거나 바꾸지 않았다.
      reliabilityTier: reliability.tier,
      reliabilityReason: reliability.reasonText,
      // READ-ONLY DIAGNOSTIC(G0 이후 Reliability Revalidation) — Series MATCHED일 때만 채워진다.
      // reasonKey/historicalDispersion/volatilityThreshold 전부 이미 계산된 값을 그대로 노출할
      // 뿐이며, 이 필드의 존재가 estimatedBudgetKrw/recommendedBudgetKrw/reliabilityTier 등 다른
      // 어떤 필드에도 영향을 주지 않는다(순수 표시용 additive 필드).
      reliabilityDiagnostic:
        seriesSignal.status === "MATCHED"
          ? { reasonKey: reliability.reasonKey, historicalDispersion: reliabilityHistoricalDispersion, volatilityThreshold }
          : null,
    });
  } catch (error) {
    console.error("[POST /api/v1/multiyear-budget-estimates]", error);
    return NextResponse.json({ message: "다년도 계획예산 추정 중 오류가 발생했습니다." }, { status: 500 });
  }
}
