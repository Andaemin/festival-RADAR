import { PrismaClient } from "@/lib/generated/prisma";
import { Region } from "@/lib/domain/enums";
import { resolveTypeTokensFromRelation } from "@/lib/multiyear/feature-resolver";
import { SeriesRecordLite } from "./types";

export type SeriesRecordWithQuality = SeriesRecordLite & { budgetQualityFlag: string };

/**
 * PHASE 9B-1 — series linker 전용 로더. 기존 `lib/multiyear/record-loader.ts`(baseline S0)는
 * 건드리지 않고, series 판정에 필요한 raw 필드(regionRaw/districtRaw/typeTokensRaw)를 추가로
 * 실어 나른다. id ASC 정렬은 기존 로더와 동일 - Spring이 리포지토리에서 읽는 순서와 최대한
 * 맞추기 위함(deterministic tie-break에 영향).
 *
 * `typeTokens`(missing-feature 판정용, production FestivalType 5종 필터링)는 기존
 * `resolveTypeTokensFromRelation`을 그대로 재사용한다 - baseline trainingPool과 동일한 기준으로
 * 걸러야 leakage-safe fold의 training pool이 두 경로에서 정확히 같아진다.
 */
export async function loadAllSeriesRecords(prisma: PrismaClient): Promise<SeriesRecordWithQuality[]> {
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
    regionRaw: r.regionRaw,
    // district(canonical, importer가 만든 placeholder-제거 컬럼)는 series 판정에 전혀 쓰이지
    // 않는다 - series-linker.ts가 districtRaw + DistrictPlaceholderNormalizer로 매번 다시
    // 계산한다. 인터페이스를 만족시키기 위한 값이며 미사용임을 명확히 하려고 trim만 한다.
    district: trimOrNull(r.districtRaw),
    districtRaw: r.districtRaw,
    typeTokens: resolveTypeTokensFromRelation(r.types),
    typeTokensRaw: new Set(r.types.map((t) => t.type as string)),
    venueType: (r.venueType as SeriesRecordLite["venueType"]) ?? null,
    durationDays: r.durationDays,
    budgetKrw: r.budgetTotalKrw !== null ? Number(r.budgetTotalKrw) : 0,
    budgetQualityFlag: r.budgetQualityFlag,
  }));
}

function trimOrNull(s: string | null): string | null {
  if (s === null) return null;
  const trimmed = s.trim();
  return trimmed === "" ? null : trimmed;
}
