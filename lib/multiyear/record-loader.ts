import { PrismaClient } from "@/lib/generated/prisma";
import { Region, VenueType } from "@/lib/domain/enums";
import { resolveDistrict, resolveTypeTokensFromRelation } from "./feature-resolver";
import { MultiYearRecordLite } from "./types";

export type MultiYearRecordWithQuality = MultiYearRecordLite & { budgetQualityFlag: string };

/**
 * DB의 MultiYearFestivalRecord 전체를 baseline S0 계산용 경량 구조로 로드한다.
 *
 * id ASC로 정렬해서 읽는다 - CandidateSelector의 레벨 내부 순회 순서(동점 tie-break)가
 * Spring MultiYearBacktestService가 리포지토리에서 읽은 순서와 최대한 같아지도록 하기 위함이다
 * (Phase 2에서 같은 canonical CSV를 원본 순서 그대로 import했으므로, id 순서가 두 프로젝트에서
 * 사실상 동일한 원본 row 순서를 반영한다).
 *
 * budgetKrw는 budgetTotalKrw가 null인 record(MISSING_OR_NONPOSITIVE 등 budgetTotalMillion이
 * 없는 경우)에는 0을 채워 둔다 - 이런 record는 buildTrainingPool에서 budgetQualityFlag로
 * 어차피 제외되므로 이 값이 계산에 쓰일 일이 없다(Spring MultiYearFeatureResolver.budgetKrw가
 * "사전에 제외되어야 한다"고 명시한 것과 동일한 전제).
 */
export async function loadAllMultiYearRecords(prisma: PrismaClient): Promise<MultiYearRecordWithQuality[]> {
  const rows = await prisma.multiYearFestivalRecord.findMany({
    orderBy: { id: "asc" },
    include: { types: true, importBatch: { select: { sourceSha256: true } } },
  });

  return rows.map((r) => ({
    id: r.id,
    datasetYear: r.datasetYear,
    festivalName: r.festivalName,
    sourceSha256: r.importBatch.sourceSha256,
    sourceSheet: r.sourceSheet,
    sourceRow: r.sourceRow,
    region: (r.region as Region | null) ?? null,
    district: resolveDistrict(r.districtRaw),
    typeTokens: resolveTypeTokensFromRelation(r.types),
    venueType: (r.venueType as VenueType | null) ?? null,
    durationDays: r.durationDays,
    budgetKrw: r.budgetTotalKrw !== null ? Number(r.budgetTotalKrw) : 0,
    budgetQualityFlag: r.budgetQualityFlag,
  }));
}
