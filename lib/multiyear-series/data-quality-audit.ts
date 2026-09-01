import { PrismaClient } from "@/lib/generated/prisma";
import { quantile } from "@/lib/utils/weighted-statistics";
import { SeriesRecordWithQuality } from "./record-loader";
import { FrozenSeriesGroup, FrozenSeriesModel, SeriesRecordLite } from "./types";

/**
 * PHASE — Series Data Quality Audit(READ-ONLY DIAGNOSTIC).
 *
 * 이 모듈은 절대로:
 *   - budget 값을 자동 수정/scale-correct 하지 않는다
 *   - budgetQualityFlag를 VALID -> INVALID로 바꾸지 않는다
 *   - Series estimate(own-history.ts computeOwnHistorySignal)의 계산을 바꾸거나, 그 계산에서
 *     어떤 record도 자동 제외하지 않는다
 *   - matcher(series-linker.ts/series-lookup.ts)/CPI(cpi.ts)/reliability(reliability.ts)/
 *     Peer(lib/multiyear/*)/canonical CSV/DB를 건드리지 않는다
 *
 * 이 모듈의 산출물(`severity`, `reasons`)은 "REVIEW_REQUIRED"(사람이 검토할 가치가 높다)를 뜻할
 * 뿐 "DATA_ERROR_CONFIRMED"를 뜻하지 않는다. own-history.ts가 이미 leakage-safe하게 골라 놓은
 * {@link FrozenSeriesModel}(=own-history eligibility를 통과한 VALID record만 `group.members`에
 * 있음)을 입력으로 받아, 같은 Series 문맥 안에서 "이 VALID record가 그럼에도 불구하고 이상해
 * 보이는가"만 진단한다 - own-history.ts/series-linker.ts/series-lookup.ts/cpi.ts 어느 것도
 * import하지 않고 다시 계산하지 않는다(이미 계산된 model/allSeriesRecords만 읽는다).
 *
 * 실제 데이터에서 확인된 대표 케이스(연구 근거):
 *   - 밀양아리랑대축제 2023(제65회): budgetTotalMillion=23100, national=30+local=2280=2310
 *     -> ratio=10.0 (COMPONENT_SUM_MISMATCH)
 *   - 밀양대추축제(제14~16회): 2023=20M -> 2024=2000M(제15회) -> 2025=20M(제16회)
 *     -> ratio=100.0 (DIGIT_SHIFT_PATTERN + ISOLATED_SPIKE_PATTERN)
 *   - 해운대모래축제: 2023=673M -> 2024=6804M -> 2025=745M -> ratio≈10.1x (ISOLATED_SPIKE_PATTERN)
 *   - 청송사과축제(제17~19회): 2023=760M -> 2024=7000M -> 2025=995M -> YoY ratio≈9.2x(INFO 미만
 *     10x)이지만 prior median(660M, 2024 이전 5개 연도 기준) 대비로는 ratio≈10.6x(MEDIUM) -
 *     YoY 단독으로는 못 잡는 걸 prior-median이 잡는 실제 사례(그래서 두 reason을 분리했다).
 *   - 부산국제록페스티벌: 2023=2930M -> 2024=4000M -> 2025=7200M(진짜 지속 성장, spike 아님) -
 *     YoY ratio는 INFO 수준(<10x)에 머무르고 ISOLATED_SPIKE_PATTERN/DIGIT_SHIFT_PATTERN/
 *     COMPONENT_SUM_MISMATCH는 전혀 뜨지 않는다(prior median 대비로는 다년간 누적 성장 때문에
 *     MEDIUM이 뜰 수 있으나 이는 정당한 review 신호이지 오판이 아니다) - G0 estimate(72억, 2025
 *     record 그대로)는 이 모듈이 존재해도 절대 바뀌지 않는다.
 */

// ─────────────────────────────────────────────────────────────────────────
// Reason / severity
// ─────────────────────────────────────────────────────────────────────────

export type DataQualityAuditReason =
  | "COMPONENT_SUM_MISMATCH"
  | "YEAR_OVER_YEAR_SCALE_JUMP"
  | "SERIES_PRIOR_MEDIAN_DEVIATION"
  | "DIGIT_SHIFT_PATTERN"
  | "ISOLATED_SPIKE_PATTERN";

export type DataQualityAuditSeverity = "NONE" | "INFO" | "MEDIUM" | "HIGH";

/** 시간축 비율(YoY/prior-median) 공통 severity 3단 컷 - research diagnostic 목적으로 우선
 *  고정한 값이며 production 의미를 부여하지 않는다(spec 4절 지시사항 그대로). */
export const RATIO_SEVERITY_INFO_MIN = 3;
export const RATIO_SEVERITY_MEDIUM_MIN = 10;
export const RATIO_SEVERITY_HIGH_MIN = 20;

/** component 합계 비교 tolerance - 두 값이 서로 다른 두 CSV 컬럼(budget_total_million vs
 *  budget_national/local/other_million)에서 온 whole-number "million" 단위라, 반올림만으로는
 *  거의 차이가 나지 않는다(실측: 부산국제록페스티벌 등 정상 케이스는 전부 정확히 일치). 그래도
 *  아주 근소한 차이까지 anomaly로 잡지 않도록 2% tolerance를 둔다. */
export const COMPONENT_MISMATCH_TOLERANCE_RATIO = 1.02;
/** tolerance 초과 ~ 이 값 미만은 MEDIUM, 이 값 이상은 HIGH. 밀양아리랑대축제 2023(ratio=10.0)
 *  같은 명백한 자릿수 단위 불일치를 HIGH로 잡기 위한 값 - spec 3절 예시와 일치하도록 고정. */
export const COMPONENT_MISMATCH_HIGH_RATIO = 2.0;

/** "10배/100배/1000배 근처" 판정 - ±5% 허용오차(이전 연구와 동일하게 좁은 tolerance를 우선
 *  사용한다는 spec 6절 지시사항 그대로). factor 후보 사이 간격(10x/100x/1000x)이 5%보다 훨씬
 *  넓어 겹치지 않는다. */
export const DIGIT_SHIFT_FACTORS = [10, 100, 1000] as const;
export const DIGIT_SHIFT_TOLERANCE = 0.05;

/** isolated spike - 전/후 모두와 이 배수 이상 벌어져야 "급변"으로 본다. */
export const ISOLATED_SPIKE_MIN_RATIO = 3;
/** 전/후(prev vs next) 값끼리는 이 배수 미만으로 서로 가까워야 "일시적 급변 후 원복"으로 본다
 *  (그렇지 않으면 그냥 계단식 레벨 변화 - spike로 보지 않는다). */
export const ISOLATED_SPIKE_NEIGHBOR_SIMILARITY_MAX_RATIO = 3;

const SEVERITY_ORDER: Record<DataQualityAuditSeverity, number> = { NONE: 0, INFO: 1, MEDIUM: 2, HIGH: 3 };

function severityForRatio(ratio: number): DataQualityAuditSeverity {
  if (ratio >= RATIO_SEVERITY_HIGH_MIN) return "HIGH";
  if (ratio >= RATIO_SEVERITY_MEDIUM_MIN) return "MEDIUM";
  if (ratio >= RATIO_SEVERITY_INFO_MIN) return "INFO";
  return "NONE";
}

function maxSeverity(a: DataQualityAuditSeverity, b: DataQualityAuditSeverity): DataQualityAuditSeverity {
  return SEVERITY_ORDER[b] > SEVERITY_ORDER[a] ? b : a;
}

/** 대칭 비율 - 항상 1 이상, "몇 배 차이나는가"를 방향과 무관하게 표현한다. */
function symmetricRatio(a: number, b: number): number {
  return Math.max(a / b, b / a);
}

// ─────────────────────────────────────────────────────────────────────────
// 실제 canonical 필드 - prisma/schema.prisma MultiYearFestivalRecord 그대로.
// budgetTotalMillion/budgetNationalMillion/budgetLocalMillion/budgetOtherMillion은 전부
// 같은 "million KRW" 단위(같은 CSV 컬럼군, scripts/multiyear-import/canonicalize.ts 확인) -
// 별도 단위 환산 없이 직접 비교 가능하다. SeriesRecordLite(own-history.ts가 쓰는 타입)에는
// 이 component 필드들이 없어서 별도로 읽는다 - own-history.ts/record-loader.ts의 기존
// loadAllSeriesRecords()는 전혀 건드리지 않는다(완전히 새 read-only 쿼리).
// ─────────────────────────────────────────────────────────────────────────

export interface SeriesRecordBudgetComponents {
  /** 원문 그대로(표시 전용, ratio 계산에는 쓰지 않는다 - budgetTotalMillion이 이미 canonical
   *  numeric total이다). */
  budgetTotalRaw: string | null;
  budgetTotalMillion: number | null;
  budgetNationalMillion: number | null;
  budgetLocalMillion: number | null;
  budgetOtherMillion: number | null;
}

export async function loadSeriesRecordBudgetComponents(prisma: PrismaClient): Promise<Map<number, SeriesRecordBudgetComponents>> {
  const rows = await prisma.multiYearFestivalRecord.findMany({
    select: {
      id: true,
      budgetTotalRaw: true,
      budgetTotalMillion: true,
      budgetNationalMillion: true,
      budgetLocalMillion: true,
      budgetOtherMillion: true,
    },
  });

  const map = new Map<number, SeriesRecordBudgetComponents>();
  for (const r of rows) {
    map.set(r.id, {
      budgetTotalRaw: r.budgetTotalRaw,
      budgetTotalMillion: r.budgetTotalMillion !== null ? r.budgetTotalMillion.toNumber() : null,
      budgetNationalMillion: r.budgetNationalMillion !== null ? r.budgetNationalMillion.toNumber() : null,
      budgetLocalMillion: r.budgetLocalMillion !== null ? r.budgetLocalMillion.toNumber() : null,
      budgetOtherMillion: r.budgetOtherMillion !== null ? r.budgetOtherMillion.toNumber() : null,
    });
  }
  return map;
}

/**
 * process-local single-flight 캐시 - runtime-cache.ts와 동일한 (revision) 키 패턴이지만, 그 파일을
 * 전혀 건드리지 않기 위해 이 모듈 안에서 독립적으로 둔다(estimate 요청마다 매번 전체 테이블을
 * 다시 스캔하지 않기 위함 - spec 22절 성능 요구사항).
 */
interface ComponentsCacheEntry {
  revision: number;
  promise: Promise<Map<number, SeriesRecordBudgetComponents>>;
}
let componentsCache: ComponentsCacheEntry | null = null;

export function getCachedSeriesRecordBudgetComponents(
  prisma: PrismaClient,
  revision: number
): Promise<Map<number, SeriesRecordBudgetComponents>> {
  if (componentsCache !== null && componentsCache.revision !== revision) {
    componentsCache = null;
  }
  if (componentsCache === null) {
    componentsCache = { revision, promise: loadSeriesRecordBudgetComponents(prisma) };
  }
  return componentsCache.promise;
}

/** 테스트 전용 - 모듈 레벨 캐시 상태를 초기화한다(vitest 격리용). production 코드는 호출하지 않는다. */
export function __resetDataQualityAuditCacheForTests() {
  componentsCache = null;
}

// ─────────────────────────────────────────────────────────────────────────
// Row DTO
// ─────────────────────────────────────────────────────────────────────────

export interface SeriesDataQualityAuditRecord {
  recordId: number;
  datasetYear: number;
  festivalName: string;
  canonicalSeriesName: string;

  budgetKrw: number | null;
  /** own-history eligibility를 통과해 이 함수의 입력(group.members)에 들어온 record는 항상
   *  "VALID"다(own-history.ts가 이미 VALID만 걸러 놓았으므로) - 그래도 재판정하지 않고 원본
   *  {@link SeriesRecordWithQuality}에서 그대로 읽어온다(향후 이 전제가 바뀌어도 값을 지어내지
   *  않기 위함). 이 값이 항상 VALID로 보이는 것 자체가 이 기능의 핵심 메시지다: "기존 flag는
   *  VALID인데 Series 문맥에서는 이상할 수 있다." */
  budgetQualityFlag: string | null;

  previousDatasetYear: number | null;
  previousBudgetKrw: number | null;
  yearOverYearRatio: number | null;

  priorMedianBudgetKrw: number | null;
  priorMedianSampleSize: number;
  priorMedianRatio: number | null;

  nextDatasetYear: number | null;
  nextBudgetKrw: number | null;

  componentTotalKrw: number | null;
  componentSumKrw: number | null;
  componentMismatchRatio: number | null;

  /** ≈10/≈100/≈1000 중 매칭된 값(없으면 null). DIGIT_SHIFT_PATTERN reason이 있을 때만 채워진다. */
  suspectedDigitShiftFactor: number | null;

  reasons: DataQualityAuditReason[];
  severity: DataQualityAuditSeverity;

  sourceSheet: string | null;
  sourceRow: number | null;
}

export interface SeriesGroupDataQualitySummary {
  groupId: number;
  canonicalName: string;
  recordCount: number;
  reviewRequiredCount: number;
  highCount: number;
  mediumCount: number;
  infoCount: number;
  /** 기존 budgetQualityFlag가 VALID가 아닌 record 수 - 이 함수의 입력 자체가 own-history
   *  eligibility(=VALID만)를 통과한 record만 담고 있으므로 정상적으로는 항상 0이다(방어적으로
   *  계산만 하고 임의로 0을 가정하지 않는다 - 위 필드 설명 참고). */
  existingQualitySuspectCount: number;
  maxYearOverYearRatio: number | null;
  maxPriorMedianRatio: number | null;
  hasComponentMismatch: boolean;
  hasDigitShiftPattern: boolean;
  hasIsolatedSpike: boolean;
  records: SeriesDataQualityAuditRecord[];
}

// ─────────────────────────────────────────────────────────────────────────
// Core
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param model 이미 leakage-safe cutoff로 빌드된 {@link FrozenSeriesModel}(estimate 응답에 붙일
 *              row-level audit이면 해당 planningYear로 빌드된 model을, "전체 데이터 감사"면
 *              보유 데이터 전체를 포함하도록 빌드된 model을 넘긴다 - 이 함수는 어느 쪽인지 모르고
 *              모른다는 사실 자체가 안전장치다: model에 이미 들어있는 것만 감사한다).
 * @param allSeriesRecords `budgetQualityFlag` 표시 전용 - own-history eligibility 판정을
 *              다시 하지 않는다(record-loader.ts의 기존 결과를 그대로 읽기만 한다).
 * @param componentsById {@link loadSeriesRecordBudgetComponents}(또는 캐시된 버전)의 결과.
 */
export function auditSeriesDataQuality(
  model: FrozenSeriesModel,
  allSeriesRecords: SeriesRecordWithQuality[],
  componentsById: Map<number, SeriesRecordBudgetComponents>
): SeriesGroupDataQualitySummary[] {
  const qualityFlagById = new Map(allSeriesRecords.map((r) => [r.id, r.budgetQualityFlag]));

  const groups: SeriesGroupDataQualitySummary[] = [];
  for (const group of model.groupsById.values()) {
    groups.push(auditGroup(group, qualityFlagById, componentsById));
  }
  groups.sort((a, b) => a.groupId - b.groupId);
  return groups;
}

function auditGroup(
  group: FrozenSeriesGroup,
  qualityFlagById: Map<number, string>,
  componentsById: Map<number, SeriesRecordBudgetComponents>
): SeriesGroupDataQualitySummary {
  // own-history.ts/series-linker.ts와 동일한 결정적 정렬(연도 오름차순, 동률이면 id 오름차순).
  const sorted = [...group.members].sort((a, b) => (a.datasetYear !== b.datasetYear ? a.datasetYear - b.datasetYear : a.id - b.id));

  const records: SeriesDataQualityAuditRecord[] = sorted.map((cur, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    const next = i < sorted.length - 1 ? sorted[i + 1] : null;
    // "그 record보다 이전에 존재하는 Series history만" - index가 아니라 datasetYear로 엄격히
    // 필터한다(동일 연도 tie가 있어도 미래 record가 섞여 들어가지 않도록).
    const priorMembers = sorted.filter((m) => m.datasetYear < cur.datasetYear);

    return auditRecord(cur, group.canonicalName, prev, next, priorMembers, qualityFlagById, componentsById);
  });

  const highCount = records.filter((r) => r.severity === "HIGH").length;
  const mediumCount = records.filter((r) => r.severity === "MEDIUM").length;
  const infoCount = records.filter((r) => r.severity === "INFO").length;
  const yoyRatios = records.map((r) => r.yearOverYearRatio).filter((v): v is number => v !== null);
  const priorRatios = records.map((r) => r.priorMedianRatio).filter((v): v is number => v !== null);

  return {
    groupId: group.groupId,
    canonicalName: group.canonicalName,
    recordCount: records.length,
    reviewRequiredCount: highCount + mediumCount + infoCount,
    highCount,
    mediumCount,
    infoCount,
    existingQualitySuspectCount: records.filter((r) => r.budgetQualityFlag !== null && r.budgetQualityFlag !== "VALID").length,
    maxYearOverYearRatio: yoyRatios.length > 0 ? Math.max(...yoyRatios) : null,
    maxPriorMedianRatio: priorRatios.length > 0 ? Math.max(...priorRatios) : null,
    hasComponentMismatch: records.some((r) => r.reasons.includes("COMPONENT_SUM_MISMATCH")),
    hasDigitShiftPattern: records.some((r) => r.reasons.includes("DIGIT_SHIFT_PATTERN")),
    hasIsolatedSpike: records.some((r) => r.reasons.includes("ISOLATED_SPIKE_PATTERN")),
    records,
  };
}

function auditRecord(
  cur: SeriesRecordLite,
  canonicalSeriesName: string,
  prev: SeriesRecordLite | null,
  next: SeriesRecordLite | null,
  priorMembers: SeriesRecordLite[],
  qualityFlagById: Map<number, string>,
  componentsById: Map<number, SeriesRecordBudgetComponents>
): SeriesDataQualityAuditRecord {
  const reasons: DataQualityAuditReason[] = [];
  let severity: DataQualityAuditSeverity = "NONE";

  // ── YEAR_OVER_YEAR_SCALE_JUMP ──
  let yearOverYearRatio: number | null = null;
  if (prev !== null && prev.budgetKrw > 0 && cur.budgetKrw > 0) {
    yearOverYearRatio = symmetricRatio(cur.budgetKrw, prev.budgetKrw);
    if (yearOverYearRatio >= RATIO_SEVERITY_INFO_MIN) {
      reasons.push("YEAR_OVER_YEAR_SCALE_JUMP");
      severity = maxSeverity(severity, severityForRatio(yearOverYearRatio));
    }
  }

  // ── SERIES_PRIOR_MEDIAN_DEVIATION ──
  let priorMedianBudgetKrw: number | null = null;
  let priorMedianRatio: number | null = null;
  if (priorMembers.length > 0) {
    priorMedianBudgetKrw = Math.round(quantile(priorMembers.map((m) => m.budgetKrw), 0.5));
    if (priorMedianBudgetKrw > 0 && cur.budgetKrw > 0) {
      priorMedianRatio = symmetricRatio(cur.budgetKrw, priorMedianBudgetKrw);
      if (priorMedianRatio >= RATIO_SEVERITY_INFO_MIN) {
        reasons.push("SERIES_PRIOR_MEDIAN_DEVIATION");
        severity = maxSeverity(severity, severityForRatio(priorMedianRatio));
      }
    }
  }

  // ── DIGIT_SHIFT_PATTERN (YoY ratio 기준 - spec 6절 예시가 previous/current 비교) ──
  // 이 reason은 severity를 독자적으로 올리지 않는다 - "10배/100배/1000배에 가까운 모양"이라는
  // 정보만 태그로 덧붙인다(예: 정확히 10.0x는 YEAR_OVER_YEAR_SCALE_JUMP만으로 이미 MEDIUM이다).
  // severity는 항상 실제 크기(ratio band)로만 정해진다 - "숫자 모양이 둥글다"는 이유만으로
  // 9.x배와 10.0배 사이에 임의의 단절을 만들지 않기 위함.
  let suspectedDigitShiftFactor: number | null = null;
  if (yearOverYearRatio !== null) {
    for (const factor of DIGIT_SHIFT_FACTORS) {
      const lower = factor * (1 - DIGIT_SHIFT_TOLERANCE);
      const upper = factor * (1 + DIGIT_SHIFT_TOLERANCE);
      if (yearOverYearRatio >= lower && yearOverYearRatio <= upper) {
        suspectedDigitShiftFactor = factor;
        reasons.push("DIGIT_SHIFT_PATTERN");
        break;
      }
    }
  }

  // ── ISOLATED_SPIKE_PATTERN ──
  if (prev !== null && next !== null && prev.budgetKrw > 0 && next.budgetKrw > 0 && cur.budgetKrw > 0) {
    const ratioToPrev = symmetricRatio(cur.budgetKrw, prev.budgetKrw);
    const ratioToNext = symmetricRatio(cur.budgetKrw, next.budgetKrw);
    const ratioPrevNext = symmetricRatio(prev.budgetKrw, next.budgetKrw);
    if (
      ratioToPrev >= ISOLATED_SPIKE_MIN_RATIO &&
      ratioToNext >= ISOLATED_SPIKE_MIN_RATIO &&
      ratioPrevNext < ISOLATED_SPIKE_NEIGHBOR_SIMILARITY_MAX_RATIO
    ) {
      reasons.push("ISOLATED_SPIKE_PATTERN");
      severity = maxSeverity(severity, severityForRatio(Math.min(ratioToPrev, ratioToNext)));
    }
  }

  // ── COMPONENT_SUM_MISMATCH ──
  const components = componentsById.get(cur.id) ?? null;
  let componentTotalKrw: number | null = null;
  let componentSumKrw: number | null = null;
  let componentMismatchRatio: number | null = null;
  if (components !== null && components.budgetTotalMillion !== null && components.budgetTotalMillion > 0) {
    const parts = [components.budgetNationalMillion, components.budgetLocalMillion, components.budgetOtherMillion];
    const reportedCount = parts.filter((v) => v !== null).length;
    if (reportedCount > 0) {
      const sumMillion = parts.reduce((s: number, v) => s + (v ?? 0), 0);
      componentTotalKrw = Math.round(components.budgetTotalMillion * 1_000_000);
      componentSumKrw = Math.round(sumMillion * 1_000_000);
      if (sumMillion > 0) {
        componentMismatchRatio = symmetricRatio(components.budgetTotalMillion, sumMillion);
        if (componentMismatchRatio >= COMPONENT_MISMATCH_TOLERANCE_RATIO) {
          reasons.push("COMPONENT_SUM_MISMATCH");
          severity = maxSeverity(severity, componentMismatchRatio >= COMPONENT_MISMATCH_HIGH_RATIO ? "HIGH" : "MEDIUM");
        }
      } else {
        // 구성요소가 명시적으로 전부 0으로 보고됐는데 총액은 0보다 큼 - 유한 비율로 표현할 수
        // 없으므로(0으로 나눔) ratio는 null로 두되, 이 자체가 가장 뚜렷한 불일치이므로 HIGH.
        reasons.push("COMPONENT_SUM_MISMATCH");
        severity = maxSeverity(severity, "HIGH");
      }
    }
  }

  return {
    recordId: cur.id,
    datasetYear: cur.datasetYear,
    festivalName: cur.festivalName,
    canonicalSeriesName,
    budgetKrw: cur.budgetKrw,
    budgetQualityFlag: qualityFlagById.get(cur.id) ?? null,
    previousDatasetYear: prev?.datasetYear ?? null,
    previousBudgetKrw: prev?.budgetKrw ?? null,
    yearOverYearRatio,
    priorMedianBudgetKrw,
    priorMedianSampleSize: priorMembers.length,
    priorMedianRatio,
    nextDatasetYear: next?.datasetYear ?? null,
    nextBudgetKrw: next?.budgetKrw ?? null,
    componentTotalKrw,
    componentSumKrw,
    componentMismatchRatio,
    suspectedDigitShiftFactor,
    reasons,
    severity,
    sourceSheet: cur.sourceSheet,
    sourceRow: cur.sourceRow,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Aggregation - global summary / top anomalies
// ─────────────────────────────────────────────────────────────────────────

export interface GlobalDataQualityAuditSummary {
  /** 이 감사가 실제로 대상으로 삼은 record 수(=넘겨받은 model의 모든 group.members 합) - "전체
   *  canonical data"가 아니라 "own-history eligibility를 통과한 Series-linked VALID record"임을
   *  분모와 함께 명시하기 위한 필드(spec 12절 요구사항: 정확한 분모를 항상 함께 표시). */
  auditPoolRecordCount: number;
  reviewRequiredCount: number;
  highCount: number;
  mediumCount: number;
  infoCount: number;
  /** YoY와 prior-median 중 더 큰 쪽을 기준으로 한 "연도간 변화" 배수 카운트(component
   *  mismatch/digit-shift는 별도 카운트로 분리 - spec 12절 예시와 동일한 구분). */
  yearlyChangeAtLeast10xCount: number;
  yearlyChangeAtLeast20xCount: number;
  yearlyChangeAtLeast100xCount: number;
  componentMismatchCount: number;
  digitShiftPatternCount: number;
  isolatedSpikeCount: number;
  reasonDistribution: Record<DataQualityAuditReason, number>;
  severityDistribution: Record<DataQualityAuditSeverity, number>;
}

function timeSeriesRatio(r: SeriesDataQualityAuditRecord): number | null {
  const candidates = [r.yearOverYearRatio, r.priorMedianRatio].filter((v): v is number => v !== null);
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function overallSortRatio(r: SeriesDataQualityAuditRecord): number {
  const candidates = [r.yearOverYearRatio, r.priorMedianRatio, r.componentMismatchRatio].filter((v): v is number => v !== null);
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

export function summarizeGlobalDataQualityAudit(groups: SeriesGroupDataQualitySummary[]): GlobalDataQualityAuditSummary {
  const allRecords = groups.flatMap((g) => g.records);

  const reasonDistribution: Record<DataQualityAuditReason, number> = {
    COMPONENT_SUM_MISMATCH: 0,
    YEAR_OVER_YEAR_SCALE_JUMP: 0,
    SERIES_PRIOR_MEDIAN_DEVIATION: 0,
    DIGIT_SHIFT_PATTERN: 0,
    ISOLATED_SPIKE_PATTERN: 0,
  };
  const severityDistribution: Record<DataQualityAuditSeverity, number> = { NONE: 0, INFO: 0, MEDIUM: 0, HIGH: 0 };
  for (const r of allRecords) {
    for (const reason of r.reasons) reasonDistribution[reason]++;
    severityDistribution[r.severity]++;
  }

  const yearlyRatios = allRecords.map(timeSeriesRatio).filter((v): v is number => v !== null);

  return {
    auditPoolRecordCount: allRecords.length,
    reviewRequiredCount: allRecords.filter((r) => r.severity !== "NONE").length,
    highCount: severityDistribution.HIGH,
    mediumCount: severityDistribution.MEDIUM,
    infoCount: severityDistribution.INFO,
    yearlyChangeAtLeast10xCount: yearlyRatios.filter((v) => v >= 10).length,
    yearlyChangeAtLeast20xCount: yearlyRatios.filter((v) => v >= 20).length,
    yearlyChangeAtLeast100xCount: yearlyRatios.filter((v) => v >= 100).length,
    componentMismatchCount: reasonDistribution.COMPONENT_SUM_MISMATCH,
    digitShiftPatternCount: reasonDistribution.DIGIT_SHIFT_PATTERN,
    isolatedSpikeCount: reasonDistribution.ISOLATED_SPIKE_PATTERN,
    reasonDistribution,
    severityDistribution,
  };
}

/**
 * 정렬: HIGH 먼저 -> ratio 큰 순(yoy/priorMedian/componentMismatch 중 최대) -> datasetYear 오름차순
 * -> canonicalName. 전부 deterministic tie-break(spec 17절 요구사항).
 */
export function topDataQualityAnomalies(groups: SeriesGroupDataQualitySummary[], n: number): SeriesDataQualityAuditRecord[] {
  const severityRank: Record<DataQualityAuditSeverity, number> = { HIGH: 0, MEDIUM: 1, INFO: 2, NONE: 3 };
  const all = groups.flatMap((g) => g.records).filter((r) => r.severity !== "NONE");
  const sorted = [...all].sort((a, b) => {
    if (severityRank[a.severity] !== severityRank[b.severity]) return severityRank[a.severity] - severityRank[b.severity];
    const ratioDiff = overallSortRatio(b) - overallSortRatio(a);
    if (ratioDiff !== 0) return ratioDiff;
    if (a.datasetYear !== b.datasetYear) return a.datasetYear - b.datasetYear;
    return a.canonicalSeriesName.localeCompare(b.canonicalSeriesName);
  });
  return sorted.slice(0, n);
}
