import { Prisma, $Enums } from "../../lib/generated/prisma";
import type { RawCsvRow } from "./csv-loader";
import {
  isKnownBudgetQualityFlag,
  isKnownDurationSource,
  normalizeCycleType,
  normalizeDistrict,
  normalizeRegion,
  normalizeVenueType,
  parseBoolean,
  parseFestivalTypes,
  toDecimalString,
  toIntOrNull,
  trimToNull,
} from "./normalize";

export interface RowIssue {
  datasetYear: unknown;
  sourceSheet: unknown;
  sourceRow: unknown;
  field: string;
  rawValue: unknown;
  message: string;
}

export interface CanonicalRecord {
  datasetYear: number;
  sourceSheet: string;
  sourceRow: number;
  sourceSha256: string;

  regionRaw: string;
  region: $Enums.Region | null;
  districtRaw: string | null;
  district: string | null;

  festivalName: string;

  festivalTypeRaw: string | null;
  types: $Enums.MultiYearFestivalType[];

  venueRaw: string | null;
  venueTypeRaw: string | null;
  venueType: $Enums.VenueType | null;

  periodRaw: string | null;
  durationDays: number | null;
  durationSource: $Enums.MultiYearDurationSource | null;
  durationNoteRaw: string | null;

  cycleRaw: string | null;
  cycleType: $Enums.CycleType | null;

  eventMode: string | null;
  eventStatus: string | null;
  covidAffected: boolean;

  firstHeldYear: number | null;

  budgetTotalRaw: string | null;
  budgetTotalMillion: string | null;
  budgetTotalKrw: bigint | null;
  budgetNationalMillion: string | null;
  budgetLocalMillion: string | null;
  budgetOtherMillion: string | null;
  budgetQualityFlag: $Enums.MultiYearBudgetQualityFlag;
  budgetQualityNote: string | null;

  visitorTotalPersons: number | null;
}

/** million(백만원, 소수 2자리까지) → KRW. decimal.js 기반 정수 연산이라 JS float 오차가 없다. */
function millionToKrw(millionDecimalString: string | null): bigint | null {
  if (millionDecimalString === null) return null;
  const krw = new Prisma.Decimal(millionDecimalString).mul(1_000_000);
  return BigInt(krw.toFixed(0));
}

export function canonicalizeRow(raw: RawCsvRow): { record: CanonicalRecord | null; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const datasetYearRaw = raw["dataset_year"];
  const sourceSheetRaw = raw["source_sheet"];
  const sourceRowRaw = raw["source_row"];

  const pushIssue = (field: string, rawValue: unknown, message: string) => {
    issues.push({ datasetYear: datasetYearRaw, sourceSheet: sourceSheetRaw, sourceRow: sourceRowRaw, field, rawValue, message });
  };

  const datasetYear = toIntOrNull(datasetYearRaw);
  const sourceSheet = trimToNull(sourceSheetRaw);
  const sourceRow = toIntOrNull(sourceRowRaw);
  const sourceSha256 = trimToNull(raw["source_sha256"]);
  const festivalName = trimToNull(raw["festival_name"]);
  const budgetQualityFlagRaw = trimToNull(raw["budget_quality_flag"]);

  // 이 필드들이 없으면 애초에 DB row(NOT NULL 컬럼)를 만들 수 없다 — fatal.
  if (datasetYear === null) pushIssue("dataset_year", datasetYearRaw, "dataset_year가 없거나 숫자가 아님");
  if (sourceSheet === null) pushIssue("source_sheet", sourceSheetRaw, "source_sheet가 없음");
  if (sourceRow === null) pushIssue("source_row", sourceRowRaw, "source_row가 없거나 숫자가 아님");
  if (sourceSha256 === null) pushIssue("source_sha256", raw["source_sha256"], "source_sha256이 없음");
  if (festivalName === null) pushIssue("festival_name", raw["festival_name"], "festival_name이 없음");
  if (budgetQualityFlagRaw === null || !isKnownBudgetQualityFlag(budgetQualityFlagRaw)) {
    pushIssue("budget_quality_flag", budgetQualityFlagRaw, `알 수 없는 budget_quality_flag 값: ${budgetQualityFlagRaw}`);
  }

  const regionRaw = trimToNull(raw["region_raw"]) ?? "";
  const regionCanonicalSource = raw["region"];
  const region = normalizeRegion(regionCanonicalSource);
  if (regionCanonicalSource !== null && region === null) {
    pushIssue("region", regionCanonicalSource, `매핑 불가한 region 값: ${String(regionCanonicalSource)}`);
  }

  const venueTypeCanonicalSource = raw["venue_type"];
  const venueTypeResult = normalizeVenueType(venueTypeCanonicalSource);
  if (venueTypeResult === undefined) {
    pushIssue("venue_type", venueTypeCanonicalSource, `매핑 불가한 venue_type 값: ${String(venueTypeCanonicalSource)}`);
  }
  const venueType = venueTypeResult === undefined ? null : venueTypeResult;

  const { types, unknownTokens } = parseFestivalTypes(raw["festival_type"]);
  if (unknownTokens.length > 0) {
    pushIssue("festival_type", raw["festival_type"], `알 수 없는 festival_type 토큰: ${unknownTokens.join(", ")}`);
  }
  if (types.length === 0 && trimToNull(raw["festival_type"]) !== null) {
    pushIssue("festival_type", raw["festival_type"], "festival_type 값이 있으나 유효 토큰 0개");
  }

  const durationSourceRaw = trimToNull(raw["duration_source"]);
  if (durationSourceRaw !== null && !isKnownDurationSource(durationSourceRaw)) {
    pushIssue("duration_source", durationSourceRaw, `알 수 없는 duration_source 값: ${durationSourceRaw}`);
  }

  const budgetTotalRawValue = raw["budget_total_raw"];
  const budgetTotalMillion = toDecimalString(raw["budget_total_million"]);

  if (issues.some((i) => ["dataset_year", "source_sheet", "source_row", "source_sha256", "festival_name", "budget_quality_flag"].includes(i.field))) {
    // NOT NULL 컬럼을 채울 수 없는 fatal row. 값을 지어내지 않고 record 자체를 만들지 않는다.
    return { record: null, issues };
  }

  const record: CanonicalRecord = {
    datasetYear: datasetYear!,
    sourceSheet: sourceSheet!,
    sourceRow: sourceRow!,
    sourceSha256: sourceSha256!,

    regionRaw,
    region: region as $Enums.Region | null,
    districtRaw: trimToNull(raw["district_raw"]),
    district: normalizeDistrict(raw["district_raw"]),

    festivalName: festivalName!,

    festivalTypeRaw: trimToNull(raw["festival_type_raw"]),
    types: types as $Enums.MultiYearFestivalType[],

    venueRaw: trimToNull(raw["venue_raw"]),
    venueTypeRaw: trimToNull(raw["venue_type_raw"]),
    venueType: venueType as $Enums.VenueType | null,

    periodRaw: trimToNull(raw["period_raw"]),
    durationDays: toIntOrNull(raw["duration_days"]),
    durationSource: (durationSourceRaw as $Enums.MultiYearDurationSource | null) ?? null,
    durationNoteRaw: trimToNull(raw["duration_note_raw"]),

    cycleRaw: trimToNull(raw["cycle"]),
    cycleType: normalizeCycleType(raw["cycle"]) as $Enums.CycleType | null,

    eventMode: trimToNull(raw["event_mode"]),
    eventStatus: trimToNull(raw["event_status"]),
    covidAffected: parseBoolean(raw["covid_affected"]),

    firstHeldYear: toIntOrNull(raw["first_held_year"]),

    budgetTotalRaw: budgetTotalRawValue === null || budgetTotalRawValue === undefined ? null : String(budgetTotalRawValue),
    budgetTotalMillion,
    budgetTotalKrw: millionToKrw(budgetTotalMillion),
    budgetNationalMillion: toDecimalString(raw["budget_national_million"]),
    budgetLocalMillion: toDecimalString(raw["budget_local_million"]),
    budgetOtherMillion: toDecimalString(raw["budget_other_million"]),
    budgetQualityFlag: budgetQualityFlagRaw as $Enums.MultiYearBudgetQualityFlag,
    budgetQualityNote: trimToNull(raw["budget_quality_note"]),

    visitorTotalPersons: toIntOrNull(raw["visitor_total_persons"]),
  };

  return { record, issues };
}
