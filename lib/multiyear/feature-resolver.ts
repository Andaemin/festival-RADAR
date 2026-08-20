import { FestivalType } from "@/lib/domain/enums";
import { MultiYearRecordLite } from "./types";

/** Prisma MultiYearFestivalRecordType.type 값 중 production FestivalType 5종만 통과시킨다.
 *  OTHER/UNKNOWN은 조용히 무시한다(Spring MultiYearFeatureResolver.resolveTypeTokens와 동일 -
 *  강제 매핑하지 않는다는 원칙의 연장). */
const KNOWN_FESTIVAL_TYPES = new Set<string>(Object.values(FestivalType));

export function resolveTypeTokensFromRelation(typeRows: { type: string }[]): Set<FestivalType> {
  const result = new Set<FestivalType>();
  for (const row of typeRows) {
    if (KNOWN_FESTIVAL_TYPES.has(row.type)) {
      result.add(row.type as FestivalType);
    }
  }
  return result;
}

export function typesOverlap(a: Set<FestivalType>, b: Set<FestivalType>): boolean {
  for (const t of a) {
    if (b.has(t)) return true;
  }
  return false;
}

/** districtRaw를 trim만 해서 그대로 쓴다 (Phase 2의 placeholder-정규화 `district` 컬럼은
 *  의도적으로 쓰지 않는다 - Spring MultiYearFeatureResolver.resolveDistrict와 동일한 설계). */
export function resolveDistrict(districtRaw: string | null): string | null {
  if (districtRaw === null) return null;
  const trimmed = districtRaw.trim();
  return trimmed === "" ? null : trimmed;
}
