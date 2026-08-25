import { PrismaClient } from "@/lib/generated/prisma";

/**
 * PHASE 9C-A.1 — 새 revision 시스템을 만들지 않고 기존 stable identity를 그대로 쓴다.
 *
 * `MultiYearImportBatch`(연도별 import 단위, autoincrement PK)는
 * `scripts/multiyear-import/persist.ts`가 INSERT-only로만 다룬다 - 동일
 * (datasetYear, sourceSha256, canonicalDatasetSha256, importerVersion) 조합은 조용히
 * skip하고, 기존 batch row를 절대 update하지 않는다(연도 재적재는 새 sourceSha256/
 * canonicalDatasetSha256/importerVersion 조합으로 새 row를 만드는 방식뿐이다). 따라서
 * `MAX(id)`는 "데이터가 실제로 바뀔 때만(새 연도 추가, 또는 기존 연도가 다른 내용/importer
 * 버전으로 재적재될 때만) 증가하는" 안전한 revision 신호다.
 *
 * publication status(`MultiYearDatasetPublicationStatus`)는 own-history series 계산
 * (buildSeriesTrainingPool -> buildFrozenSeriesModel -> lookupTarget/computeOwnHistorySignal)
 * 어디에도 관여하지 않는다 - peer 추정(estimateForPlanning의 referenceDataPolicy)에만
 * 영향을 준다. 그래서 revision에 포함하지 않는다(series 캐시와 무관한 값을 넣으면 publication
 * status만 바뀌어도 불필요하게 series 캐시를 통째로 버리게 된다).
 */
export async function getMultiYearDataRevision(prisma: PrismaClient): Promise<number> {
  const latest = await prisma.multiYearImportBatch.findFirst({
    orderBy: { id: "desc" },
    select: { id: true },
  });
  return latest?.id ?? 0;
}
