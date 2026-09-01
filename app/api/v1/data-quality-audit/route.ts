import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  DataQualityAuditReason,
  DataQualityAuditSeverity,
  auditSeriesDataQuality,
  getCachedSeriesRecordBudgetComponents,
  summarizeGlobalDataQualityAudit,
  topDataQualityAnomalies,
} from "@/lib/multiyear-series/data-quality-audit";
import { getMultiYearDataRevision } from "@/lib/multiyear-series/data-revision";
import { getCachedFrozenSeriesModel, getCachedSeriesRecords } from "@/lib/multiyear-series/runtime-cache";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const VALID_SEVERITIES: DataQualityAuditSeverity[] = ["HIGH", "MEDIUM", "INFO"];
const VALID_REASONS: DataQualityAuditReason[] = [
  "COMPONENT_SUM_MISMATCH",
  "YEAR_OVER_YEAR_SCALE_JUMP",
  "SERIES_PRIOR_MEDIAN_DEVIATION",
  "DIGIT_SHIFT_PATTERN",
  "ISOLATED_SPIKE_PATTERN",
];

/**
 * PHASE — Series Data Quality Audit(READ-ONLY DIAGNOSTIC) 전체 데이터 감사 endpoint.
 *
 * `/assistant-tester`(내부 검증용 tester UI)에서만 호출한다 - 어떤 production 사용자 플로우도
 * 이 endpoint를 자동 호출하지 않는다. DB write는 전혀 없다.
 *
 * "전체 데이터 감사"는 특정 planningYear의 leakage-safe cutoff와 무관하게 보유 데이터 전체
 * (own-history eligibility를 통과한 VALID + region/유형 존재 record 전체)를 대상으로 한다 -
 * `/api/v1/multiyear-budget-estimates`의 개별 추정(row-level `seriesDataQualityAudit`, 특정
 * planningYear 기준 leakage-safe)과는 별개 영역이다(spec 21절 - 섞지 않는다).
 *
 * 성능(spec 22절): allSeriesRecords/FrozenSeriesModel/budget components 전부 기존
 * runtime-cache.ts 패턴과 동일하게 dataRevision 단위로 process-local 캐시된다 - 요청마다 9천여
 * 건을 다시 스캔/클러스터링하지 않는다. FrozenSeriesModel은 `getCachedFrozenSeriesModel`을
 * planningYear = maxAvailableDatasetYear+1로 호출해 재사용한다(effectiveTrainingThroughYear가
 * 이미 "보유 데이터 전체 포함" cutoff로 saturate시켜준다 - 별도 "전체용" 캐시를 새로 만들 필요가
 * 없다).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const severityRaw = searchParams.get("severity");
  let severityFilter: DataQualityAuditSeverity | null = null;
  if (severityRaw !== null && severityRaw !== "ALL") {
    if (!VALID_SEVERITIES.includes(severityRaw as DataQualityAuditSeverity)) {
      return NextResponse.json({ message: `유효하지 않은 severity입니다: ${severityRaw} (HIGH/MEDIUM/INFO/ALL)` }, { status: 400 });
    }
    severityFilter = severityRaw as DataQualityAuditSeverity;
  }

  const reasonRaw = searchParams.get("reason");
  let reasonFilter: DataQualityAuditReason | null = null;
  if (reasonRaw !== null) {
    if (!VALID_REASONS.includes(reasonRaw as DataQualityAuditReason)) {
      return NextResponse.json({ message: `유효하지 않은 reason입니다: ${reasonRaw}` }, { status: 400 });
    }
    reasonFilter = reasonRaw as DataQualityAuditReason;
  }

  const q = searchParams.get("q")?.trim() ?? "";

  const limitRaw = searchParams.get("limit");
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
    const componentsById = await getCachedSeriesRecordBudgetComponents(prisma, dataRevision);

    const maxAvailableDatasetYear = allSeriesRecords.reduce((max, r) => Math.max(max, r.datasetYear), -Infinity);
    // "전체" - 어떤 특정 planningYear의 leakage cutoff도 적용하지 않는다(보유 데이터 전체 포함).
    const model = await getCachedFrozenSeriesModel(allSeriesRecords, dataRevision, maxAvailableDatasetYear + 1);

    const groups = auditSeriesDataQuality(model, allSeriesRecords, componentsById);
    const summary = summarizeGlobalDataQualityAudit(groups);

    let anomalies = topDataQualityAnomalies(groups, groups.reduce((s, g) => s + g.recordCount, 0));
    if (severityFilter !== null) anomalies = anomalies.filter((r) => r.severity === severityFilter);
    if (reasonFilter !== null) anomalies = anomalies.filter((r) => r.reasons.includes(reasonFilter));
    if (q !== "") anomalies = anomalies.filter((r) => r.festivalName.includes(q) || r.canonicalSeriesName.includes(q));
    const matchedCount = anomalies.length;
    anomalies = anomalies.slice(0, limit);

    return NextResponse.json({
      auditScope: {
        description: "leakage-safe Series-linked VALID record 전체(own-history eligibility를 통과한 record) - canonical 원본 전체가 아닙니다.",
        earliestDatasetYear: 2017,
        latestDatasetYear: maxAvailableDatasetYear,
        dataRevision,
      },
      summary,
      anomalies,
      matchedCount,
      returnedCount: anomalies.length,
      helpText: "데이터 품질 진단은 오류 확정이 아니라 검토 우선순위입니다. 표시된 값은 자동 수정되거나 예산 계산에서 제외되지 않습니다.",
    });
  } catch (error) {
    console.error("[GET /api/v1/data-quality-audit]", error);
    return NextResponse.json({ message: "데이터 품질 감사 중 오류가 발생했습니다." }, { status: 500 });
  }
}
