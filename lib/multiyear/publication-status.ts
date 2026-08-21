import { PrismaClient } from "@/lib/generated/prisma";
import { MultiYearPublicationStatusValue } from "./reference-data-policy";

/**
 * MultiYearDatasetPublicationStatus 테이블을 연도->상태 Map으로 로드한다. row가 없는 연도는
 * Map에도 없다 - 호출부(resolveEffectivePolicy의 statusLookup)가 "없으면 PARTIAL 취급"을
 * 담당한다(이 함수 자체는 없음/PARTIAL을 구분하지 않고 있는 그대로만 옮긴다).
 *
 * 이 테이블은 MultiYearImportBatch와 완전히 별개다 - "파일을 DB에 넣었는가"와 "이 연도가 운영상
 * 공개 완료로 인정되는가"는 다른 질문이라 자동으로 채워지지 않는다. 값은 별도 seed 스크립트
 * (scripts/seed-multiyear-publication-status.ts)로만 채운다.
 */
export async function loadPublicationStatusByYear(
  prisma: PrismaClient
): Promise<Map<number, MultiYearPublicationStatusValue>> {
  const rows = await prisma.multiYearDatasetPublicationStatus.findMany();
  const map = new Map<number, MultiYearPublicationStatusValue>();
  for (const r of rows) {
    map.set(r.datasetYear, r.status as MultiYearPublicationStatusValue);
  }
  return map;
}

/** Map에서 연도 조회 - 없으면 null(= resolveEffectivePolicy가 PARTIAL과 동일하게 취급). */
export function lookupPublicationStatus(
  map: Map<number, MultiYearPublicationStatusValue>,
  year: number
): MultiYearPublicationStatusValue | null {
  return map.get(year) ?? null;
}

export interface MultiYearPublicationStatusEntry {
  datasetYear: number;
  status: MultiYearPublicationStatusValue;
  publishedAt: Date | null;
  recordCount: number;
}

/**
 * 관리자 화면/API용 연도별 상태 목록. Spring MultiYearAdminPublicationStatusService.list()와
 * 동일하게 "실제 데이터가 있는 모든 연도"를 기준으로 만든다 - status row가 없는 연도도 목록에
 * 나오고 logical PARTIAL로 표시된다(실제 row 존재 여부와 별개).
 */
export async function listPublicationStatusWithRecordCounts(prisma: PrismaClient): Promise<MultiYearPublicationStatusEntry[]> {
  const yearRows = await prisma.multiYearFestivalRecord.groupBy({
    by: ["datasetYear"],
    _count: { _all: true },
    orderBy: { datasetYear: "asc" },
  });

  const statusRows = await prisma.multiYearDatasetPublicationStatus.findMany();
  const statusByYear = new Map(statusRows.map((r) => [r.datasetYear, r]));

  return yearRows.map((y) => {
    const existing = statusByYear.get(y.datasetYear);
    return {
      datasetYear: y.datasetYear,
      status: (existing?.status as MultiYearPublicationStatusValue) ?? "PARTIAL",
      publishedAt: existing?.publishedAt ?? null,
      recordCount: y._count._all,
    };
  });
}

/**
 * 연도 1개의 status를 upsert한다 - Spring MultiYearAdminPublicationStatusService.setStatus와
 * 동일한 규칙: 이전 상태가 무엇이었든 상관없이 무조건 status를 그대로 반영하고,
 * PUBLISHED_PLAN_COMPLETE로 설정할 때만 publishedAt=현재 시각, 그 외(PARTIAL)에는
 * publishedAt=null로 "덮어쓴다" - 이미 COMPLETE인 연도를 다시 COMPLETE로 설정해도
 * publishedAt이 새 시각으로 갱신된다(같은 상태 재설정도 예외 없음, Spring과 동일).
 */
export async function upsertPublicationStatus(
  prisma: PrismaClient,
  datasetYear: number,
  status: MultiYearPublicationStatusValue
): Promise<MultiYearPublicationStatusEntry> {
  const publishedAt = status === "PUBLISHED_PLAN_COMPLETE" ? new Date() : null;
  const saved = await prisma.multiYearDatasetPublicationStatus.upsert({
    where: { datasetYear },
    update: { status, publishedAt },
    create: { datasetYear, status, publishedAt },
  });
  const recordCount = await prisma.multiYearFestivalRecord.count({ where: { datasetYear } });
  return {
    datasetYear: saved.datasetYear,
    status: saved.status as MultiYearPublicationStatusValue,
    publishedAt: saved.publishedAt,
    recordCount,
  };
}
