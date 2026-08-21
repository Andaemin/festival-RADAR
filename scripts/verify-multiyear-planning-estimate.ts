/**
 * Spring에서 직접 생성한 golden fixture(fixtures/multiyear/planning-estimate-reference.csv,
 * 21개 대표 쿼리 x A/B/C/D 시나리오 = 84행)를 ground-truth로 삼아 Express
 * estimateForPlanning(lib/multiyear/planning-estimator.ts)이 동일한 결과를 내는지 검증한다.
 * DB에 아무것도 쓰지 않는다(읽기 전용).
 *
 * 시나리오 B(2026을 임시 PARTIAL로 내려 downgrade를 재현)는 실제 DB의 publication status를
 * 바꾸지 않고, 그 행만 in-memory로 override한 lookup을 써서 재현한다.
 *
 * 실행: npx tsx scripts/verify-multiyear-planning-estimate.ts [--file <csv-path>]
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../lib/generated/prisma";
import { FestivalType, Region, VenueType } from "../lib/domain/enums";
import { estimateForPlanning } from "../lib/multiyear/planning-estimator";
import { loadPublicationStatusByYear } from "../lib/multiyear/publication-status";
import { loadAllMultiYearRecords } from "../lib/multiyear/record-loader";
import { ReferenceDataPolicy } from "../lib/multiyear/reference-data-policy";
import { MultiYearPublicationStatusValue } from "../lib/multiyear/reference-data-policy";
import { MultiYearQuery } from "../lib/multiyear/types";

const DEFAULT_FIXTURE_PATH = "fixtures/multiyear/planning-estimate-reference.csv";
const KNOWN_FESTIVAL_TYPES = new Set<string>(Object.values(FestivalType));
const NUMERIC_ABS_TOLERANCE = 1e-6;
const BUDGET_REL_TOLERANCE = 1e-4;

function parseArgs(argv: string[]): { file: string } {
  let file = DEFAULT_FIXTURE_PATH;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") file = argv[++i];
    else if (argv[i].startsWith("--file=")) file = argv[i].slice("--file=".length);
  }
  return { file: path.resolve(file) };
}

interface FixtureRow {
  scenario: string;
  region: string;
  district: string | null;
  festivalType: string;
  venueType: string | null;
  durationDays: number;
  planningYear: number;
  requestedPolicy: string;
  appliedPolicy: string;
  referenceYearFrom: number;
  referenceYearTo: number;
  earliestSourceYear: number;
  latestSourceYear: number;
  sampleCount: number;
  distinctYearsUsed: number;
  effectiveYearCount: number;
  fallbackLevel: string;
  estimatedBudget: number;
  weightedAverage: number;
  recommendedBudget: number;
  p25: number;
  p50: number;
  p75: number;
  averageSimilarity: number;
  dataQualityV3: number;
  yearWeightBreakdown: string;
}

function loadFixture(filePath: string): FixtureRow[] {
  if (!fs.existsSync(filePath)) throw new Error(`fixture CSV를 찾을 수 없습니다: ${filePath}`);
  let content = fs.readFileSync(filePath, "utf-8");
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const wb = XLSX.read(content, { type: "string" });
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number | null>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const num = (v: unknown) => Number(v);
  const str = (v: unknown) => (v === null ? null : String(v));

  return rows.map((r) => ({
    scenario: String(r["scenario"]),
    region: String(r["region"]),
    district: str(r["district"]),
    festivalType: String(r["festivalType"]),
    venueType: str(r["venueType"]),
    durationDays: num(r["durationDays"]),
    planningYear: num(r["planningYear"]),
    requestedPolicy: String(r["requestedPolicy"]),
    appliedPolicy: String(r["appliedPolicy"]),
    referenceYearFrom: num(r["referenceYearFrom"]),
    referenceYearTo: num(r["referenceYearTo"]),
    earliestSourceYear: num(r["earliestSourceYear"]),
    latestSourceYear: num(r["latestSourceYear"]),
    sampleCount: num(r["sampleCount"]),
    distinctYearsUsed: num(r["distinctYearsUsed"]),
    effectiveYearCount: num(r["effectiveYearCount"]),
    fallbackLevel: String(r["fallbackLevel"]),
    estimatedBudget: num(r["estimatedBudget"]),
    weightedAverage: num(r["weightedAverage"]),
    recommendedBudget: num(r["recommendedBudget"]),
    p25: num(r["p25"]),
    p50: num(r["p50"]),
    p75: num(r["p75"]),
    averageSimilarity: num(r["averageSimilarity"]),
    dataQualityV3: num(r["dataQualityV3"]),
    yearWeightBreakdown: String(r["yearWeightBreakdown"] ?? ""),
  }));
}

function buildQuery(row: FixtureRow): MultiYearQuery {
  const typeTokens = new Set<FestivalType>();
  for (const token of row.festivalType.split("+")) {
    const trimmed = token.trim();
    if (KNOWN_FESTIVAL_TYPES.has(trimmed)) typeTokens.add(trimmed as FestivalType);
  }
  return {
    region: row.region as Region,
    district: row.district,
    typeTokens,
    venueType: row.venueType ? (row.venueType as VenueType) : null,
    durationDays: Number.isFinite(row.durationDays) ? row.durationDays : null,
  };
}

function parseYearWeightBreakdown(s: string): { year: number; candidateCount: number; weightShare: number }[] {
  if (!s) return [];
  return s.split("|").map((part) => {
    const [year, count, share] = part.split(":");
    return { year: Number(year), candidateCount: Number(count), weightShare: Number(share) };
  });
}

interface Mismatch {
  row: FixtureRow;
  field: string;
  expected: string;
  actual: string;
}

async function main() {
  const { file } = parseArgs(process.argv.slice(2));
  console.log(`fixture: ${file}`);
  const rows = loadFixture(file);
  console.log(`fixture rows: ${rows.length}`);

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });
  let allRecords, realStatusMap: Map<number, MultiYearPublicationStatusValue>;
  try {
    allRecords = await loadAllMultiYearRecords(prisma);
    realStatusMap = await loadPublicationStatusByYear(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log("실제 publication status:", [...realStatusMap.entries()]);

  const fieldCounts: Record<string, { pass: number; fail: number }> = {};
  const mismatches: Mismatch[] = [];
  let rowsFullyMatched = 0;

  const bump = (field: string, pass: boolean) => {
    fieldCounts[field] ??= { pass: 0, fail: 0 };
    fieldCounts[field][pass ? "pass" : "fail"]++;
  };

  for (const row of rows) {
    const query = buildQuery(row);
    const requestedPolicy = row.requestedPolicy as ReferenceDataPolicy;

    // 시나리오 B: Spring이 2026을 임시로 PARTIAL로 내렸던 것과 동일하게, 이 행만 override.
    const statusMap = new Map(realStatusMap);
    if (row.scenario === "B") {
      statusMap.set(2026, "PARTIAL");
    }

    const result = estimateForPlanning(query, row.planningYear, requestedPolicy, allRecords, statusMap);

    let rowOk = true;
    const checkExact = (field: string, expected: unknown, actual: unknown) => {
      const ok = String(expected) === String(actual);
      bump(field, ok);
      if (!ok) {
        rowOk = false;
        mismatches.push({ row, field, expected: String(expected), actual: String(actual) });
      }
    };
    const checkNumeric = (field: string, expected: number, actual: number, relTolerance = NUMERIC_ABS_TOLERANCE) => {
      const ok = Math.abs(expected - actual) <= NUMERIC_ABS_TOLERANCE || Math.abs(expected - actual) <= Math.abs(expected) * relTolerance;
      bump(field, ok);
      if (!ok) {
        rowOk = false;
        mismatches.push({ row, field, expected: String(expected), actual: String(actual) });
      }
    };

    checkExact("appliedPolicy", row.appliedPolicy, result.appliedReferenceDataPolicy);
    checkExact("referenceYearFrom", row.referenceYearFrom, result.referenceYearFrom);
    checkExact("referenceYearTo", row.referenceYearTo, result.referenceYearTo);
    checkExact("earliestSourceYear", row.earliestSourceYear, result.earliestSourceYear);
    checkExact("latestSourceYear", row.latestSourceYear, result.latestSourceYear);
    checkExact("sampleCount", row.sampleCount, result.sampleCount);
    checkExact("distinctYearsUsed", row.distinctYearsUsed, result.distinctYearsUsed);
    checkExact("fallbackLevel", row.fallbackLevel, result.fallbackLevel);
    checkExact("recommendedBudget", row.recommendedBudget, result.recommendedBudgetKrw);
    checkExact("p75", row.p75, result.p75Krw);

    checkNumeric("effectiveYearCount", row.effectiveYearCount, result.effectiveYearCount);
    checkNumeric("averageSimilarity", row.averageSimilarity, result.averageSimilarity);
    checkNumeric("dataQualityV3", row.dataQualityV3, result.dataQualityV3);
    checkNumeric("estimatedBudget", row.estimatedBudget, result.estimatedBudgetKrw, BUDGET_REL_TOLERANCE);
    checkNumeric("weightedAverage", row.weightedAverage, result.weightedAverageBudgetKrw, BUDGET_REL_TOLERANCE);
    checkNumeric("p25", row.p25, result.p25Krw, BUDGET_REL_TOLERANCE);
    checkNumeric("p50", row.p50, result.p50Krw, BUDGET_REL_TOLERANCE);

    // yearWeightBreakdown: year/candidateCount는 exact, weightShare는 tolerance. 합도 1에 근접해야 함.
    const expectedBreakdown = parseYearWeightBreakdown(row.yearWeightBreakdown);
    const actualBreakdown = result.yearWeightBreakdown;
    checkExact(
      "yearWeightBreakdown_years",
      expectedBreakdown.map((y) => `${y.year}:${y.candidateCount}`).join("|"),
      actualBreakdown.map((y) => `${y.year}:${y.candidateCount}`).join("|")
    );
    let shareDiffOk = expectedBreakdown.length === actualBreakdown.length;
    if (shareDiffOk) {
      for (let i = 0; i < expectedBreakdown.length; i++) {
        if (Math.abs(expectedBreakdown[i].weightShare - actualBreakdown[i].weightShare) > 1e-6) shareDiffOk = false;
      }
    }
    bump("yearWeightBreakdown_shares", shareDiffOk);
    if (!shareDiffOk) {
      rowOk = false;
      mismatches.push({
        row,
        field: "yearWeightBreakdown_shares",
        expected: JSON.stringify(expectedBreakdown),
        actual: JSON.stringify(actualBreakdown),
      });
    }
    const shareSum = actualBreakdown.reduce((s, y) => s + y.weightShare, 0);
    bump("yearWeightBreakdown_sumTo1", actualBreakdown.length === 0 || Math.abs(shareSum - 1) < 1e-6);

    if (rowOk) rowsFullyMatched++;
  }

  console.log("");
  console.log("── 필드별 결과 ──────────────────────────────");
  for (const [field, c] of Object.entries(fieldCounts)) {
    console.log(`${c.fail === 0 ? "✅" : "❌"} ${field.padEnd(28)} pass=${c.pass} fail=${c.fail}`);
  }
  console.log("");
  console.log(`행 전체 일치: ${rowsFullyMatched} / ${rows.length}`);

  // 시나리오별 요약
  const byScenario: Record<string, number> = {};
  for (const r of rows) byScenario[r.scenario] = (byScenario[r.scenario] ?? 0) + 1;
  console.log("시나리오별 행 수:", byScenario);

  if (mismatches.length > 0) {
    console.log("");
    console.log(`불일치 샘플 (최대 20건 / 전체 ${mismatches.length}건):`);
    for (const m of mismatches.slice(0, 20)) {
      console.log(
        `  [${m.row.scenario}/${m.row.region}/${m.row.festivalType}/${m.row.venueType}/${m.row.durationDays}/planningYear=${m.row.planningYear}] ${m.field}: expected=${m.expected} actual=${m.actual}`
      );
    }
  }

  const exactFail = Object.entries(fieldCounts).some(
    ([f, c]) => !["effectiveYearCount", "averageSimilarity", "dataQualityV3", "estimatedBudget", "weightedAverage", "p25", "p50", "yearWeightBreakdown_shares", "yearWeightBreakdown_sumTo1"].includes(f) && c.fail > 0
  );
  process.exit(exactFail ? 1 : 0);
}

main().catch((e) => {
  console.error("검증 실패:", e);
  process.exit(1);
});
