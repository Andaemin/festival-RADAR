/**
 * Multi-Year festival importer의 정규화 상수.
 * 값을 바꿀 때는 이 파일만 수정한다 (알고리즘/스키마 코드와 분리).
 */

/** scripts/import-multiyear-festivals.ts가 만드는 MultiYearImportBatch.importerVersion 값.
 *  normalization 로직을 바꾸면 이 값을 올려서, 같은 원본 파일이라도 새 batch로 재적재되게 한다.
 *  1.0.1: budget*Million precision을 Decimal(14,2)→Decimal(18,3)로 교정(Spring과 scale 일치,
 *  forensic 대조로 발견된 정밀도 손실 버그 수정). 재적재 시 기존 1.0.0 데이터를 먼저 비워야
 *  같은 festival-year가 중복 2세트로 쌓이지 않는다(스크립트 자체는 idempotency만 보장하고
 *  기존 버전 데이터 정리는 별도 단계다). */
export const IMPORTER_VERSION = "1.0.1";

export const DEFAULT_CSV_PATH = "prisma/data/festival_2017_2026_sanitized.csv";

/** CSV에 반드시 존재해야 하는 header. 이름 기준으로 컬럼을 찾고, 위치(index)에 의존하지 않는다. */
export const REQUIRED_HEADERS = [
  "dataset_year",
  "source_sheet",
  "source_row",
  "source_sha256",
  "region_raw",
  "region",
  "district_raw",
  "district",
  "festival_name",
  "festival_type_raw",
  "festival_type",
  "venue_raw",
  "venue_type_raw",
  "venue_type",
  "period_raw",
  "duration_days",
  "duration_source",
  "duration_note_raw",
  "cycle",
  "event_mode",
  "event_status",
  "covid_affected",
  "first_held_year",
  "budget_total_raw",
  "budget_total_million",
  "budget_national_million",
  "budget_local_million",
  "budget_other_million",
  "budget_quality_flag",
  "budget_quality_note",
  "visitor_total_persons",
] as const;

/** 지역 canonical 한글명 → 기존 production Region enum. 값이 하나라도 안 매핑되면
 *  importer는 실패해야 한다 (silent skip 금지). */
export const REGION_MAP: Record<string, string> = {
  서울: "SEOUL",
  부산: "BUSAN",
  대구: "DAEGU",
  인천: "INCHEON",
  광주: "GWANGJU",
  대전: "DAEJEON",
  울산: "ULSAN",
  세종: "SEJONG",
  경기: "GYEONGGI",
  강원: "GANGWON",
  충북: "CHUNGBUK",
  충남: "CHUNGNAM",
  전북: "JEONBUK",
  전남: "JEONNAM",
  경북: "GYEONGBUK",
  경남: "GYEONGNAM",
  제주: "JEJU",
  // CSV의 알려진 정규화 누락 케이스 (2017 세종 시트 12건). '세종'과 동일 의미.
  "세종특별 자치시청": "SEJONG",
};

/** venue_type(CSV canonical 한글 라벨) → 기존 production VenueType enum. */
export const VENUE_TYPE_MAP: Record<string, string> = {
  마을형: "VILLAGE",
  녹지형: "GREEN",
  수변형: "WATERFRONT",
  독립형: "INDEPENDENT",
  기타: "OTHER",
  미정: "UNDECIDED",
};

/** cycle raw 텍스트 중 명확히 canonical化 가능한 값만. 나머지는 전부 null (지어내지 않음). */
export const CYCLE_MAP: Record<string, string> = {
  매년: "ANNUAL",
  격년: "BIENNIAL",
  일회성: "ONE_TIME",
  최초: "FIRST_TIME",
};

/** festival_type 컬럼(파이프 구분)에 등장 가능한 canonical 값. */
export const KNOWN_FESTIVAL_TYPES = [
  "CULTURE_ART",
  "NATURE_ECOLOGY",
  "COMMUNITY",
  "TRADITION_HISTORY",
  "LOCAL_SPECIALTY",
  "OTHER",
  "UNKNOWN",
] as const;

export const KNOWN_DURATION_SOURCES = ["EXPLICIT_TEXT", "SOURCE_TOTAL_DAYS", "UNPARSED"] as const;

export const KNOWN_BUDGET_QUALITY_FLAGS = ["VALID", "MISSING_OR_NONPOSITIVE", "UNIT_SCALE_SUSPECT"] as const;

/**
 * district_raw가 실제 시군구가 아니라 광역/조직 placeholder인 경우의 목록.
 * 반드시 정확히 일치(exact match, trim 후)하는 경우에만 null로 취급한다.
 * 부분 문자열 검사 금지 — "시"가 이 목록에 있다고 "수원시"까지 null이 되면 안 된다.
 */
export const DISTRICT_PLACEHOLDERS = new Set<string>([
  "-",
  "시자체",
  "본청",
  "도",
  "시",
  "지자체",
  "도자체",
  "시 자체",
  "미기재",
  "서울시",
  "울산시",
  "제주도",
  "세종시",
  "제주도 본청",
  "대구광역시",
]);
