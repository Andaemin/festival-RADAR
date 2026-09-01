import { FestivalType, Region, VenueType } from "@/lib/domain/enums";
import { clusterKeyOf, clusterKeyString } from "./scoring";
import { tryAdjustForCpi } from "./cpi";
import { SeriesEstimateSource } from "./own-history";
import { SeriesRecordWithQuality } from "./record-loader";
import { FrozenSeriesModel } from "./types";

/**
 * PHASE — assistant-tester 진단용 Series own-history 상세 노출.
 *
 * 이 모듈은 계산을 새로 하지 않는다 - `own-history.ts`(computeOwnHistorySignal)가 이미
 * production 응답(estimatedBudgetKrw)에 쓰는 것과 **정확히 같은 leakage-safe 필터
 * (`datasetYear < planningYear`)와 CPI 적용 규칙(하나라도 CPI_TABLE에 없으면 전체 nominal
 * fallback)을 그대로 재현**해서, "실제 계산에 쓰인 개별 record가 무엇인지"를 표시 전용으로
 * 풀어서 보여줄 뿐이다. matcher/threshold/own-history eligibility 자체는 전혀 건드리지 않는다 -
 * `FrozenSeriesModel`(이미 own-history eligibility를 통과한 것만 담고 있음)과 원본
 * {@link SeriesRecordWithQuality}[] 목록만 읽는다.
 *
 * PHASE G0 — own-history.ts가 median 고정에서 gap-aware(LATEST/MEDIAN)로 바뀌면서
 * "eligibleForSeriesCalculation"(own-history eligibility를 통과해 이 series에 실제로 연결된
 * record인가)과 "usedAsPointEstimateSource"(그 record가 실제 seriesEstimatedBudgetKrw 숫자에
 * 직접 반영됐는가)를 분리했다. estimateSource="LATEST"면 eligible record 중 **딱 하나**(가장
 * 최근 record)만 point estimate source이고, 나머지 eligible record는 여전히 "유효한 이력"이지만
 * "계산 제외"는 아니다(제외는 own-history eligibility 자체를 통과하지 못한 record에만 쓴다).
 * estimateSource="MEDIAN"이면 eligible record 전체가 point estimate source다(median은 전체를
 * 집계하므로) - 이 경우는 Phase G0 이전과 동일한 동작이다.
 */

export type SeriesHistoryExclusionReason = "MISSING_OR_NONPOSITIVE" | "UNIT_SCALE_SUSPECT" | "MISSING_FEATURE";

export interface SeriesHistoryRecordDetailDto {
  datasetYear: number;
  festivalName: string;
  region: Region | null;
  district: string | null;
  festivalTypes: FestivalType[];
  venueType: VenueType | null;
  durationDays: number | null;
  originalBudgetKrw: number | null;
  cpiAdjustedBudgetKrw: number | null;
  /** own-history eligibility(VALID budget + region/유형 존재)를 통과해 이 series 그룹에 실제로
   *  연결된 record인가. false면 exclusionReason이 채워진다. */
  eligibleForSeriesCalculation: boolean;
  /** 이 record가 실제 seriesEstimatedBudgetKrw 값에 직접 반영됐는가 - LATEST 분기에서는 딱 하나만
   *  true, MEDIAN 분기에서는 eligible record 전체가 true. eligibleForSeriesCalculation=false면
   *  항상 false. */
  usedAsPointEstimateSource: boolean;
  exclusionReason: SeriesHistoryExclusionReason | null;
}

export interface SeriesHistoryDetailDto {
  canonicalName: string;
  firstObservedYear: number;
  lastObservedYear: number;
  /** 이 카드에 표시되는 전체 row 수(= eligibleForSeriesCalculationCount + excludedCount). "이
   *  leakage-safe 범위 안에서 같은 series로 확인된 record 전체"를 뜻하며, own-history 계산
   *  자체가 참조하는 `seriesSignal.historyCount`(=eligibleForSeriesCalculationCount와 항상 같음)와는
   *  의미가 다르다 - 혼동하지 않도록 필드명을 분리했다. */
  displayedRecordCount: number;
  /** own-history eligibility를 통과한 record 수 - `seriesSignal.historyCount`와 항상 같다. PHASE
   *  G0부터 "이 record들 전부가 point estimate에 쓰였다"는 뜻은 아니다(LATEST 분기 참고 - 아래
   *  estimateSource/각 record의 usedAsPointEstimateSource로 구분해서 봐야 한다). */
  eligibleForSeriesCalculationCount: number;
  /** displayedRecordCount - eligibleForSeriesCalculationCount. own-history eligibility(VALID
   *  budget + region/유형 존재)를 통과하지 못해 계산에서 제외된 record 수(clusterKey 기준 최선의
   *  근사치, production 매칭 판정을 대신하지 않음). */
  excludedCount: number;
  /** false면 이 series의 point estimate 전체가 CPI 미적용(nominal) fallback을 썼다는 뜻 - 이 경우
   *  개별 record의 cpiAdjustedBudgetKrw는 전부 null로 내려간다(일부만 보정된 것처럼 보이지
   *  않게 하기 위함, own-history.ts와 동일한 all-or-nothing 규칙 - LATEST/MEDIAN 분기 공통). */
  cpiFullyAvailable: boolean;
  /** PHASE G0 — seriesEstimatedBudgetKrw가 LATEST(최근 comparable budget)에서 왔는지 MEDIAN(기존
   *  전체 이력 중앙값)에서 왔는지. own-history.ts의 estimateSource를 그대로 옮긴 값이다. */
  estimateSource: SeriesEstimateSource;
  latestHistoricalYear: number;
  /** planningYear - latestHistoricalYear. */
  latestHistoricalGap: number;
  /** datasetYear 오름차순. 같은 연도라면 eligible record가 먼저 온다(표시 순서일 뿐 계산에는
   *  영향 없음). */
  records: SeriesHistoryRecordDetailDto[];
}

/**
 * @param matchedGroupId `lookupTarget`이 이미 판정한 matchedGroupId(이 모듈은 매칭을 다시
 *                        하지 않는다 - 호출부가 넘겨준 결과만 신뢰한다).
 * @param planningYear own-history.ts와 동일한 leakage-safe cutoff(`datasetYear < planningYear`).
 * @param model `getCachedFrozenSeriesModel`이 이미 이 planningYear 기준으로 만든 모델 - own-history
 *              eligibility(VALID budget, region/유형 존재)를 통과한 record만 `group.members`에
 *              들어 있다.
 * @param allSeriesRecords `getCachedSeriesRecords`가 반환한 전체 raw record(필터링 이전) -
 *              오직 "제외된 record" 진단 목록을 만들 때만 쓴다. 이 그룹의 유효 member들이 실제로
 *              갖는 clusterKey(scope+region+district+정규화된 이름 - `scoring.ts`의 `clusterKeyOf`,
 *              production matcher가 EXACT/NORMALIZED_EXACT 판정에 쓰는 바로 그 결정적 키)와 정확히
 *              같은 key를 가진 raw record만 찾는다. "제18회"/"제22회"처럼 회차 표기만 다른 같은
 *              축제를 놓치지 않기 위해 raw festivalName 문자열 그대로 비교하지 않고 반드시 이
 *              정규화 키로 비교한다 - 다만 FUZZY/CHAIN 임계값(0.92 등)은 전혀 재사용하지 않으므로,
 *              이름이 크게 다르게 표기된 excluded record까지는 잡지 못할 수 있다(최선의 근사치이며
 *              production 매칭 판정 자체를 대신하지 않는다).
 * @param estimateSource `computeSeriesSignal`이 이미 계산한 값(own-history.ts) - 이 함수가 다시
 *              판정하지 않는다. 어떤 record가 point estimate source인지 표시하는 데만 쓴다.
 * @param latestHistoricalYear 동일하게 이미 계산된 값을 그대로 받는다(재계산 금지 - 호출부의
 *              seriesSignal과 100% 같은 값이어야 한다).
 */
export function buildSeriesHistoryDetail(
  matchedGroupId: number,
  planningYear: number,
  model: FrozenSeriesModel,
  allSeriesRecords: SeriesRecordWithQuality[],
  estimateSource: SeriesEstimateSource,
  latestHistoricalYear: number
): SeriesHistoryDetailDto | null {
  const group = model.groupsById.get(matchedGroupId);
  if (!group) return null;

  // own-history.ts의 historical 필터/정렬과 동일(방어적으로 다시 확인) - group.members는 이미
  // 이 planningYear 기준 leakage-safe trainingPool로 빌드됐으므로 사실상 항상 전부 남는다.
  const historical = group.members
    .filter((m) => m.datasetYear < planningYear)
    .sort((a, b) => (a.datasetYear !== b.datasetYear ? a.datasetYear - b.datasetYear : a.id - b.id));

  // own-history.ts와 동일한 all-or-nothing CPI 규칙: 하나라도 CPI_TABLE에 없으면(예:
  // planningYear>=2027이라 CPI[planningYear-1]이 없음) 전체 nominal fallback.
  const adjustedBudgets = historical.map((h) => tryAdjustForCpi(h.budgetKrw, h.datasetYear, planningYear));
  const cpiFullyAvailable = adjustedBudgets.every((v): v is number => v !== null);

  // PHASE G0 — own-history.ts와 동일한 tie-break(동일 latestHistoricalYear에 record가 2개 이상이면
  // id가 가장 작은 쪽)로 "실제 point estimate source" record를 하나로 정한다. estimateSource가
  // MEDIAN이면 이 특정 id는 쓰지 않고 eligible 전체를 point estimate source로 표시한다.
  const latestYearRecords = historical.filter((h) => h.datasetYear === latestHistoricalYear).sort((a, b) => a.id - b.id);
  const latestRecordId = latestYearRecords[0]?.id ?? null;

  const usedIds = new Set(historical.map((h) => h.id));

  const eligibleRecords: SeriesHistoryRecordDetailDto[] = historical.map((h, i) => ({
    datasetYear: h.datasetYear,
    festivalName: h.festivalName,
    region: h.region,
    district: h.district,
    festivalTypes: [...h.typeTokens],
    venueType: h.venueType,
    durationDays: h.durationDays,
    originalBudgetKrw: h.budgetKrw,
    cpiAdjustedBudgetKrw: cpiFullyAvailable ? Math.round(adjustedBudgets[i]!) : null,
    eligibleForSeriesCalculation: true,
    usedAsPointEstimateSource: estimateSource === "MEDIAN" ? true : h.id === latestRecordId,
    exclusionReason: null,
  }));

  // 계산에서 제외된 record를 숨기지 않는다(가능한 범위에서 진단용으로만). 이 series 그룹의
  // 유효 member들과 clusterKey(scope+region+district+정규화된 이름)가 정확히 같은 raw record 중,
  // 아직 이 그룹에 연결되지 않은(=own-history eligibility에서 걸러진) 것만 보조로 붙인다. raw
  // festivalName 문자열 그대로 비교하지 않는다 - "제18회"/"제22회"처럼 회차만 다른 표기를
  // 정규화 없이 비교하면 서로 다른 문자열로 보여 놓치기 때문이다.
  const validClusterKeys = new Set(historical.map((h) => clusterKeyString(clusterKeyOf(h))));
  const excludedRecords: SeriesHistoryRecordDetailDto[] = allSeriesRecords
    .filter((r) => r.datasetYear < planningYear && !usedIds.has(r.id) && validClusterKeys.has(clusterKeyString(clusterKeyOf(r))))
    .map((r) => {
      // 두 사유가 겹치면(budget도 무효고 region/유형도 없음) budget 쪽을 우선 표시한다(더 근본적
      // 사유 - "계산 사용 여부"만 판단할 때는 어느 쪽이든 결과가 같지만, 사용자에게는 하나만
      // 보여줘야 한다).
      const lowQuality = r.budgetQualityFlag !== "VALID";
      const exclusionReason: SeriesHistoryExclusionReason = lowQuality
        ? (r.budgetQualityFlag as SeriesHistoryExclusionReason)
        : "MISSING_FEATURE";
      return {
        datasetYear: r.datasetYear,
        festivalName: r.festivalName,
        region: r.region,
        district: r.district,
        festivalTypes: [...r.typeTokens],
        venueType: r.venueType,
        durationDays: r.durationDays,
        originalBudgetKrw: lowQuality ? null : r.budgetKrw,
        cpiAdjustedBudgetKrw: null,
        eligibleForSeriesCalculation: false,
        usedAsPointEstimateSource: false,
        exclusionReason,
      };
    });

  const records = [...eligibleRecords, ...excludedRecords].sort((a, b) =>
    a.datasetYear !== b.datasetYear ? a.datasetYear - b.datasetYear : Number(b.eligibleForSeriesCalculation) - Number(a.eligibleForSeriesCalculation)
  );

  return {
    canonicalName: group.canonicalName,
    firstObservedYear: group.firstObservedYear,
    lastObservedYear: group.lastObservedYear,
    displayedRecordCount: records.length,
    eligibleForSeriesCalculationCount: eligibleRecords.length,
    excludedCount: excludedRecords.length,
    cpiFullyAvailable,
    estimateSource,
    latestHistoricalYear,
    latestHistoricalGap: planningYear - latestHistoricalYear,
    records,
  };
}
