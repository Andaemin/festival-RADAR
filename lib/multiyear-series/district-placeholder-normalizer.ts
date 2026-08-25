/**
 * Spring `com.festival.budgetassist.multiyear.series.DistrictPlaceholderNormalizer`의 1:1
 * 포팅. district(시군구) 값 중 실제 기초자치단체를 가리키지 않는 "region-level placeholder"를
 * 식별한다. 이 모듈이 series 그룹핑 키를 계산할 때만 쓰이고, DB의 districtRaw 원본이나 기존
 * Prisma `district`(importer가 만든 canonical 컬럼)는 절대 건드리지 않는다 - 이 모듈은 매번
 * districtRaw를 입력으로 받아 새로 판정한다(기존 canonical 컬럼과 로직이 다를 수 있으므로
 * 재사용하지 않는다 - Spring frozen 판정을 그대로 재현하는 게 목적).
 *
 * 목록은 Spring Javadoc 그대로 옮긴 것이다(2026-08-08 기준, 실제 10,198행 district_raw/
 * district_text 전체 빈도표 검토 결과) - 여기서 새로 추가/삭제하지 않는다.
 */

const PLACEHOLDERS = new Set<string>([
  "-",
  "시자체",
  "시 자체",
  "본청",
  "도",
  "시",
  "지자체",
  "도자체",
  "미기재",
  "서울시",
  "울산시",
  "제주도",
  "세종시",
  "제주도 본청",
  "대구광역시",
  "인천관광공사",
  "대전마케팅공사",
  "서울관광재단",
  "인천도시공사",
  "서부공원녹지사업소",
  "대공원",
  "인천경제자유구역청",
  "울 산 시설공단",
  "경제청",
  "민간",
]);

const TRAILING_PAREN = /\s*[(（][^)）]*[)）]\s*$/;

/** districtCandidate는 이미 trim된 문자열이거나 null일 수 있다. */
export function isRegionLevelPlaceholder(districtCandidate: string | null | undefined): boolean {
  if (districtCandidate === null || districtCandidate === undefined) return true;
  const trimmed = districtCandidate.trim();
  if (trimmed === "") return true;
  if (PLACEHOLDERS.has(trimmed)) return true;
  const withoutTrailingParen = trimmed.replace(TRAILING_PAREN, "").trim();
  return withoutTrailingParen !== trimmed && PLACEHOLDERS.has(withoutTrailingParen);
}
