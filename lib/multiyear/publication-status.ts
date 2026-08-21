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
