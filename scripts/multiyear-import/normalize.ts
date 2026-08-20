/**
 * 순수 정규화 함수 모음. DB/CSV I/O 없이 값 → 값 변환만 한다.
 * 테스트에서 이 파일만 import해서 검증할 수 있도록 분리했다.
 */
import {
  CYCLE_MAP,
  DISTRICT_PLACEHOLDERS,
  KNOWN_BUDGET_QUALITY_FLAGS,
  KNOWN_DURATION_SOURCES,
  KNOWN_FESTIVAL_TYPES,
  REGION_MAP,
  VENUE_TYPE_MAP,
} from "./constants";

export function trimToNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/** region canonical 한글값을 Region enum 문자열로 매핑한다.
 *  매핑 실패 시 null을 반환한다 — 호출부가 이걸 "unmapped"로 집계해서 실패시켜야 한다. */
export function normalizeRegion(regionValue: unknown): string | null {
  const s = trimToNull(regionValue);
  if (!s) return null;
  return REGION_MAP[s] ?? null;
}

/** venue_type 한글 라벨을 VenueType enum 문자열로 매핑한다.
 *  값이 없으면(null) 그대로 null (2017~2024 정상 데이터).
 *  값이 있는데 매핑 테이블에 없으면 undefined를 반환해 "unmapped"로 구분한다. */
export function normalizeVenueType(venueTypeValue: unknown): string | null | undefined {
  const s = trimToNull(venueTypeValue);
  if (!s) return null;
  return VENUE_TYPE_MAP[s] ?? undefined;
}

/** cycle raw 텍스트 중 명확한 값만 canonical CycleType으로. 나머지는 null. */
export function normalizeCycleType(cycleRaw: unknown): string | null {
  const s = trimToNull(cycleRaw);
  if (!s) return null;
  return CYCLE_MAP[s] ?? null;
}

/** district_raw에서 placeholder(exact match)만 제거한 canonical district.
 *  부분 문자열 검사를 하지 않는다 — trim 후 정확히 일치할 때만 null. */
export function normalizeDistrict(districtRaw: unknown): string | null {
  const s = trimToNull(districtRaw);
  if (!s) return null;
  return DISTRICT_PLACEHOLDERS.has(s) ? null : s;
}

/** "CULTURE_ART|NATURE_ECOLOGY" → ["CULTURE_ART","NATURE_ECOLOGY"] (trim + dedupe).
 *  알 수 없는 토큰이 섞여 있으면 unknownTokens에 채워서 반환한다 (silent drop 금지). */
export function parseFestivalTypes(festivalTypeValue: unknown): {
  types: string[];
  unknownTokens: string[];
} {
  const s = trimToNull(festivalTypeValue);
  if (!s) return { types: [], unknownTokens: [] };

  const known = new Set<string>(KNOWN_FESTIVAL_TYPES);
  const tokens = s
    .split("|")
    .map((t) => t.trim())
    .filter((t) => t !== "");

  const types: string[] = [];
  const unknownTokens: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (!known.has(token)) {
      unknownTokens.push(token);
      continue;
    }
    if (!seen.has(token)) {
      seen.add(token);
      types.push(token);
    }
  }
  return { types, unknownTokens };
}

export function isKnownDurationSource(value: unknown): boolean {
  const s = trimToNull(value);
  return s !== null && (KNOWN_DURATION_SOURCES as readonly string[]).includes(s);
}

export function isKnownBudgetQualityFlag(value: unknown): boolean {
  const s = trimToNull(value);
  return s !== null && (KNOWN_BUDGET_QUALITY_FLAGS as readonly string[]).includes(s);
}

export function parseBoolean(value: unknown): boolean {
  const s = trimToNull(value);
  return s?.toLowerCase() === "true";
}

/** 숫자 또는 숫자 문자열을 소수점 3자리 Decimal-safe 문자열로 (HALF_UP).
 *  scale=3은 Spring MultiYearFestivalRecord의 @Column(precision=18, scale=3)과 맞춘 canonical
 *  정밀도다 - 예산 원본(CSV)이 42.85714285714286처럼 무한/장주기 소수인 경우가 있어 2자리로는
 *  정밀도가 손실된다(forensic 대조로 실제 확인됨). toFixed(3)은 JS에서 양수에 대해 반올림
 *  (round-half-away-from-zero)이라 HALF_UP과 결과가 같다. */
export function toDecimalString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(3);
}

export function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}
