import { quantile } from "../../lib/utils/weighted-statistics";
import type { CanonicalRecord, RowIssue } from "./canonicalize";

export interface DryRunReport {
  canonicalCsvSha256: string;
  importerVersion: string;
  totalRows: number;
  fatalRowsSkipped: number;
  datasetYearRange: [number, number] | null;
  rowsByYear: Record<number, number>;

  budgetQualityCounts: Record<string, number>;
  budgetQualityByYear: Record<number, Record<string, number>>;

  missingVenueType: number;
  missingCycle: number;
  missingDuration: number;

  singleTypeRows: number;
  multiTypeRows: number;
  uniqueMultiTypeCombinations: number;
  rowsWithUnknownType: number;
  rowsWithOtherType: number;

  districtPlaceholderNulled: number;

  regionUniqueValues: string[];
  unmappedRegionCount: number;
  unmappedRegionValues: string[];

  venueUniqueValues: string[];
  unmappedVenueCount: number;
  unmappedVenueValues: string[];

  sourceSha256Count: number;
  sourceSheetCount: number;

  budgetSanityByYear: Record<
    number,
    { count: number; medianMillion: number; p25Million: number; p75Million: number; minMillion: number; maxMillion: number }
  >;

  issueCount: number;
  issuesSample: RowIssue[];
}

export function buildDryRunReport(params: {
  canonicalCsvSha256: string;
  importerVersion: string;
  records: CanonicalRecord[];
  issues: RowIssue[];
  fatalRowsSkipped: number;
  rawRegionValues: Set<string>;
  rawVenueValues: Set<string>;
}): DryRunReport {
  const { records, issues, rawRegionValues, rawVenueValues } = params;

  const rowsByYear: Record<number, number> = {};
  const budgetQualityCounts: Record<string, number> = {};
  const budgetQualityByYear: Record<number, Record<string, number>> = {};
  const sourceSha256Set = new Set<string>();
  const sourceSheetSet = new Set<string>();
  const multiTypeCombinations = new Set<string>();

  let missingVenueType = 0;
  let missingCycle = 0;
  let missingDuration = 0;
  let singleTypeRows = 0;
  let multiTypeRows = 0;
  let rowsWithUnknownType = 0;
  let rowsWithOtherType = 0;
  let districtPlaceholderNulled = 0;

  const budgetByYearValid: Record<number, number[]> = {};

  for (const r of records) {
    rowsByYear[r.datasetYear] = (rowsByYear[r.datasetYear] ?? 0) + 1;

    budgetQualityCounts[r.budgetQualityFlag] = (budgetQualityCounts[r.budgetQualityFlag] ?? 0) + 1;
    budgetQualityByYear[r.datasetYear] = budgetQualityByYear[r.datasetYear] ?? {};
    budgetQualityByYear[r.datasetYear][r.budgetQualityFlag] = (budgetQualityByYear[r.datasetYear][r.budgetQualityFlag] ?? 0) + 1;

    sourceSha256Set.add(r.sourceSha256);
    sourceSheetSet.add(r.sourceSheet);

    if (r.venueType === null) missingVenueType++;
    if (r.cycleRaw === null) missingCycle++;
    if (r.durationDays === null) missingDuration++;

    if (r.types.length === 1) singleTypeRows++;
    if (r.types.length > 1) {
      multiTypeRows++;
      multiTypeCombinations.add([...r.types].sort().join("|"));
    }
    if (r.types.includes("UNKNOWN")) rowsWithUnknownType++;
    if (r.types.includes("OTHER")) rowsWithOtherType++;

    if (r.districtRaw !== null && r.district === null) districtPlaceholderNulled++;

    if (r.budgetQualityFlag === "VALID" && r.budgetTotalMillion !== null) {
      (budgetByYearValid[r.datasetYear] ??= []).push(Number(r.budgetTotalMillion));
    }
  }

  const unmappedRegionValues = [
    ...new Set(issues.filter((i) => i.field === "region").map((i) => String(i.rawValue))),
  ];
  const unmappedVenueValues = [
    ...new Set(issues.filter((i) => i.field === "venue_type").map((i) => String(i.rawValue))),
  ];

  const years = Object.keys(rowsByYear).map(Number).sort((a, b) => a - b);

  const budgetSanityByYear: DryRunReport["budgetSanityByYear"] = {};
  for (const year of years) {
    const values = budgetByYearValid[year] ?? [];
    if (values.length === 0) continue;
    budgetSanityByYear[year] = {
      count: values.length,
      medianMillion: quantile(values, 0.5),
      p25Million: quantile(values, 0.25),
      p75Million: quantile(values, 0.75),
      minMillion: Math.min(...values),
      maxMillion: Math.max(...values),
    };
  }

  return {
    canonicalCsvSha256: params.canonicalCsvSha256,
    importerVersion: params.importerVersion,
    totalRows: records.length,
    fatalRowsSkipped: params.fatalRowsSkipped,
    datasetYearRange: years.length > 0 ? [years[0], years[years.length - 1]] : null,
    rowsByYear,

    budgetQualityCounts,
    budgetQualityByYear,

    missingVenueType,
    missingCycle,
    missingDuration,

    singleTypeRows,
    multiTypeRows,
    uniqueMultiTypeCombinations: multiTypeCombinations.size,
    rowsWithUnknownType,
    rowsWithOtherType,

    districtPlaceholderNulled,

    regionUniqueValues: [...rawRegionValues].sort(),
    unmappedRegionCount: unmappedRegionValues.length,
    unmappedRegionValues,

    venueUniqueValues: [...rawVenueValues].sort(),
    unmappedVenueCount: unmappedVenueValues.length,
    unmappedVenueValues,

    sourceSha256Count: sourceSha256Set.size,
    sourceSheetCount: sourceSheetSet.size,

    budgetSanityByYear,

    issueCount: issues.length,
    issuesSample: issues.slice(0, 30),
  };
}

export function printDryRunReport(report: DryRunReport): void {
  const line = (s = "") => console.log(s);
  line("═══════════════════════════════════════════════════");
  line("Multi-Year Festival Importer — DRY RUN 결과");
  line("═══════════════════════════════════════════════════");
  line(`canonical CSV SHA256 : ${report.canonicalCsvSha256}`);
  line(`importer version     : ${report.importerVersion}`);
  line(`total rows            : ${report.totalRows} (fatal skipped: ${report.fatalRowsSkipped})`);
  line(`dataset year range    : ${report.datasetYearRange?.join(" ~ ") ?? "N/A"}`);
  line("");
  line("연도별 row 수:");
  for (const [year, count] of Object.entries(report.rowsByYear).sort()) line(`  ${year}: ${count}`);
  line("");
  line(`budget quality 전체   : ${JSON.stringify(report.budgetQualityCounts)}`);
  line("budget quality 연도별:");
  for (const [year, counts] of Object.entries(report.budgetQualityByYear).sort()) line(`  ${year}: ${JSON.stringify(counts)}`);
  line("");
  line(`missing venueType     : ${report.missingVenueType} / ${report.totalRows}`);
  line(`missing cycle         : ${report.missingCycle} / ${report.totalRows}`);
  line(`missing duration      : ${report.missingDuration} / ${report.totalRows}`);
  line("");
  line(`single-type rows      : ${report.singleTypeRows}`);
  line(`multi-type rows       : ${report.multiTypeRows}`);
  line(`unique multi-type set : ${report.uniqueMultiTypeCombinations}`);
  line(`UNKNOWN type rows     : ${report.rowsWithUnknownType}`);
  line(`OTHER type rows       : ${report.rowsWithOtherType}`);
  line("");
  line(`district placeholder→null : ${report.districtPlaceholderNulled}`);
  line("");
  line(`region unique values (${report.regionUniqueValues.length}): ${report.regionUniqueValues.join(", ")}`);
  line(`unmapped region count : ${report.unmappedRegionCount} ${report.unmappedRegionCount > 0 ? "→ " + report.unmappedRegionValues.join(", ") : ""}`);
  line("");
  line(`venue unique values (${report.venueUniqueValues.length}): ${report.venueUniqueValues.join(", ")}`);
  line(`unmapped venue count  : ${report.unmappedVenueCount} ${report.unmappedVenueCount > 0 ? "→ " + report.unmappedVenueValues.join(", ") : ""}`);
  line("");
  line(`source SHA256 count   : ${report.sourceSha256Count} (기대: 10, 연도당 1개)`);
  line(`source sheet count    : ${report.sourceSheetCount}`);
  line("");
  line("budget sanity (VALID만, 백만원 단위):");
  for (const [year, s] of Object.entries(report.budgetSanityByYear).sort()) {
    line(
      `  ${year}: n=${s.count} median=${s.medianMillion} P25=${s.p25Million} P75=${s.p75Million} min=${s.minMillion} max=${s.maxMillion}`
    );
  }
  line("");
  line(`row-level issue count : ${report.issueCount}`);
  if (report.issueCount > 0) {
    line("issue 샘플 (최대 30개):");
    for (const issue of report.issuesSample) {
      line(`  [${issue.datasetYear}/${issue.sourceSheet}#${issue.sourceRow}] ${issue.field}: ${issue.message}`);
    }
  }
  line("═══════════════════════════════════════════════════");
}
