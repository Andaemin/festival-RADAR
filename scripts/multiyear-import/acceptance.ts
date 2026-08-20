import type { DryRunReport } from "./stats";

/** 로컬 프로젝트에서 사전 검증된 2017~2026 canonical dataset의 기대값.
 *  이 값과 다르면 importer가 조용히 숫자를 맞추지 말고 차이를 그대로 보고해야 한다. */
export const EXPECTED_ROWS_BY_YEAR: Record<number, number> = {
  2017: 733,
  2018: 886,
  2019: 884,
  2020: 968,
  2021: 1004,
  2022: 944,
  2023: 1129,
  2024: 1170,
  2025: 1214,
  2026: 1266,
};
export const EXPECTED_TOTAL_ROWS = 10198;

export const EXPECTED_VALID = 9930;
export const EXPECTED_MISSING_OR_NONPOSITIVE = 258;
export const EXPECTED_UNIT_SCALE_SUSPECT = 10;

export const EXPECTED_MULTI_TYPE_ROWS = 152;
export const EXPECTED_SOURCE_SHA_COUNT = 10;

export const EXPECTED_MEDIAN_BY_YEAR: Record<number, number> = {
  2017: 200,
  2018: 200,
  2019: 200,
  2020: 198,
  2021: 166.4,
  2022: 170,
  2023: 196,
  2024: 200,
  2025: 200,
  2026: 204.5,
};

export interface AcceptanceCheck {
  label: string;
  expected: string;
  actual: string;
  pass: boolean;
}

export function runAcceptanceChecks(report: DryRunReport): AcceptanceCheck[] {
  const checks: AcceptanceCheck[] = [];

  const push = (label: string, expected: unknown, actual: unknown, pass: boolean) =>
    checks.push({ label, expected: String(expected), actual: String(actual), pass });

  push("total rows", EXPECTED_TOTAL_ROWS, report.totalRows, report.totalRows === EXPECTED_TOTAL_ROWS);

  for (const [yearStr, expected] of Object.entries(EXPECTED_ROWS_BY_YEAR)) {
    const year = Number(yearStr);
    const actual = report.rowsByYear[year] ?? 0;
    push(`rows[${year}]`, expected, actual, actual === expected);
  }

  const validActual = report.budgetQualityCounts["VALID"] ?? 0;
  const missingActual = report.budgetQualityCounts["MISSING_OR_NONPOSITIVE"] ?? 0;
  const suspectActual = report.budgetQualityCounts["UNIT_SCALE_SUSPECT"] ?? 0;
  push("budget VALID", EXPECTED_VALID, validActual, validActual === EXPECTED_VALID);
  push("budget MISSING_OR_NONPOSITIVE", EXPECTED_MISSING_OR_NONPOSITIVE, missingActual, missingActual === EXPECTED_MISSING_OR_NONPOSITIVE);
  push("budget UNIT_SCALE_SUSPECT", EXPECTED_UNIT_SCALE_SUSPECT, suspectActual, suspectActual === EXPECTED_UNIT_SCALE_SUSPECT);

  push("multi-type rows", EXPECTED_MULTI_TYPE_ROWS, report.multiTypeRows, report.multiTypeRows === EXPECTED_MULTI_TYPE_ROWS);
  push("source SHA256 count", EXPECTED_SOURCE_SHA_COUNT, report.sourceSha256Count, report.sourceSha256Count === EXPECTED_SOURCE_SHA_COUNT);
  push("unmapped region count", 0, report.unmappedRegionCount, report.unmappedRegionCount === 0);
  push("row-level issues", 0, report.issueCount, report.issueCount === 0);
  push("fatal rows skipped", 0, report.fatalRowsSkipped, report.fatalRowsSkipped === 0);

  for (const [yearStr, expectedMedian] of Object.entries(EXPECTED_MEDIAN_BY_YEAR)) {
    const year = Number(yearStr);
    const actual = report.budgetSanityByYear[year]?.medianMillion;
    const pass = actual !== undefined && Math.abs(actual - expectedMedian) < 0.01;
    push(`median[${year}]M`, expectedMedian, actual ?? "N/A", pass);
  }

  return checks;
}

export function printAcceptanceChecks(checks: AcceptanceCheck[]): boolean {
  console.log("");
  console.log("── Acceptance 기준 ──────────────────────────────────");
  let allPass = true;
  for (const c of checks) {
    const mark = c.pass ? "✅" : "❌";
    console.log(`${mark} ${c.label.padEnd(24)} expected=${c.expected} actual=${c.actual}`);
    if (!c.pass) allPass = false;
  }
  console.log("──────────────────────────────────────────────────────");
  console.log(allPass ? "모든 acceptance 기준 통과." : "일부 acceptance 기준 실패 — 실제 DB insert를 진행하지 않습니다.");
  return allPass;
}
