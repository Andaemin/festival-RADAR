/**
 * Spring 로컬 프로젝트가 만든 multiyear-backtest-baseline-predictions.csv(2024/2025/2026 fold,
 * 3,432행)를 ground-truth로 삼아 Express로 포팅한 baseline S0 계산(lib/multiyear/*)이 동일한
 * 결과를 내는지 검증한다. DB에 아무것도 쓰지 않는다(읽기 전용).
 *
 * 실행:
 *   npx tsx scripts/verify-multiyear-baseline.ts [--file <csv-path>] [--limit N]
 *   (--file 생략 시 prisma/data/multiyear-backtest-baseline-predictions.csv)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Spring → Express Baseline S0 parity 기록 (2026-08-20 정밀도 수정 반영 후)
 *
 * Fixture: 2024 fold 1,001 / 2025 fold 1,193 / 2026 fold 1,238 / total 3,432
 *
 * Exact match:
 *   recommendedBudgetKrw : 3432/3432
 *   p75Krw                : 3432/3432
 *   sampleCount            : 3432/3432
 *   fallbackLevel          : 3432/3432
 *   dataQualityV3          : 3432/3432
 *
 * Known numeric reproducibility limitation (버그 아님, 수정하지 않음):
 *   estimatedBudgetKrw mismatch      : 50/3432 (max diff 16원)
 *   weightedAverageBudgetKrw mismatch: 50/3432 (max diff 3원)
 *   p25Krw mismatch                  : 22/3432 (max diff 139원)
 *   root cause: 후보 집합/similarity/weight/winsorize 경계는 bit 단위까지 완전히 동일함을
 *   forensic 대조(Spring 원본 DB에 접속해 Java 실측치와 직접 비교)로 확인했다. 유일한 차이는
 *   기간보정(durationAdjust)의 Math.pow(ratio, elasticity) 호출이 duration=4처럼 특정 비율에서
 *   Java Math.pow와 JS Math.pow 사이에 정확히 1 ULP(마지막 비트) 차이를 내는 것 - 두 언어 모두
 *   IEEE754 double이지만 transcendental 함수의 correctly-rounded 결과를 표준이 보장하지 않아
 *   생기는 구조적 한계다. Spring 쪽도 같은 한계를 가지므로 "정답"이 하나로 정해져 있지 않고,
 *   Math.pow 결과를 인위적으로 반올림/보정하는 코드는 추가하지 않는다.
 *
 * (참고: 애초에 88건이었던 불일치 중 다수는 이 한계가 아니라 Phase 2 스키마
 * budgetTotalMillion 등이 Decimal(14,2)였던 실제 버그(3건, 최대 5,000원 정밀도 손실) 때문이었다.
 * Spring의 Decimal(18,3)에 맞춰 스키마를 고치고 canonical CSV로 재적재한 뒤, 10,198건 예산
 * 컬럼 4개를 Spring DB와 전수 대조해 mismatch 0건을 확인했다. 남은 50/22건이 위 Math.pow 한계다.)
 * ─────────────────────────────────────────────────────────────────────────
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../lib/generated/prisma";
import { FestivalType, Region, VenueType } from "../lib/domain/enums";
import { buildTrainingPool, computeBaselineEstimate } from "../lib/multiyear/baseline-estimator";
import { loadAllMultiYearRecords, MultiYearRecordWithQuality } from "../lib/multiyear/record-loader";
import { MultiYearQuery } from "../lib/multiyear/types";

const DEFAULT_FIXTURE_PATH = "prisma/data/multiyear-backtest-baseline-predictions.csv";
const KNOWN_FESTIVAL_TYPES = new Set<string>(Object.values(FestivalType));

// dataQualityV3만 floating tolerance 허용 - KRW 정수값/sampleCount/fallbackLevel은 exact match.
const V3_ABS_TOLERANCE = 1e-6;

interface FixtureRow {
  targetYear: number;
  festivalName: string;
  region: string;
  district: string | null;
  festivalType: string;
  venueType: string | null;
  durationDays: number | null;
  estimatedBudget: number;
  weightedAverage: number;
  recommendedBudget: number;
  p25: number;
  p75: number;
  sampleCount: number;
  fallbackLevel: string;
  dataQualityV3: number;
}

function parseArgs(argv: string[]): { file: string; limit: number | null } {
  let file = DEFAULT_FIXTURE_PATH;
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") file = argv[++i];
    else if (argv[i].startsWith("--file=")) file = argv[i].slice("--file=".length);
    else if (argv[i] === "--limit") limit = Number(argv[++i]);
    else if (argv[i].startsWith("--limit=")) limit = Number(argv[i].slice("--limit=".length));
  }
  return { file: path.resolve(file), limit };
}

function loadFixture(filePath: string): FixtureRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`fixture CSV를 찾을 수 없습니다: ${filePath}`);
  }
  let content = fs.readFileSync(filePath, "utf-8");
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const wb = XLSX.read(content, { type: "string" });
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number | null>>(wb.Sheets[wb.SheetNames[0]], { defval: null });

  return rows.map((r) => ({
    targetYear: Number(r["targetYear"]),
    festivalName: String(r["festivalName"]),
    region: String(r["region"]),
    district: r["district"] === null ? null : String(r["district"]),
    festivalType: String(r["festivalType"]),
    venueType: r["venueType"] === null ? null : String(r["venueType"]),
    durationDays: r["durationDays"] === null ? null : Number(r["durationDays"]),
    estimatedBudget: Number(r["estimatedBudget"]),
    weightedAverage: Number(r["weightedAverage"]),
    recommendedBudget: Number(r["recommendedBudget"]),
    p25: Number(r["p25"]),
    p75: Number(r["p75"]),
    sampleCount: Number(r["sampleCount"]),
    fallbackLevel: String(r["fallbackLevel"]),
    dataQualityV3: Number(r["dataQualityV3"]),
  }));
}

/** Spring MultiYearBacktestQuery.from(target)와 동일 - target(=fixture row)을 query로 변환한다. */
function buildQuery(row: FixtureRow): MultiYearQuery {
  const typeTokens = new Set<FestivalType>();
  for (const token of row.festivalType.split("|")) {
    const trimmed = token.trim();
    if (KNOWN_FESTIVAL_TYPES.has(trimmed)) typeTokens.add(trimmed as FestivalType);
  }
  return {
    region: row.region as Region,
    district: row.district,
    typeTokens,
    venueType: row.venueType ? (row.venueType as VenueType) : null,
    durationDays: row.durationDays,
  };
}

interface FieldMismatch {
  row: FixtureRow;
  field: string;
  expected: string;
  actual: string;
}

async function main() {
  const { file, limit } = parseArgs(process.argv.slice(2));
  console.log(`fixture: ${file}`);

  const fixtureRows = loadFixture(file);
  const rowsToCheck = limit ? fixtureRows.slice(0, limit) : fixtureRows;
  console.log(`fixture rows: ${fixtureRows.length}, 검증 대상: ${rowsToCheck.length}`);

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });
  let allRecords: MultiYearRecordWithQuality[];
  try {
    allRecords = await loadAllMultiYearRecords(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log(`DB record 수: ${allRecords.length}`);

  const trainingPoolCache = new Map<number, ReturnType<typeof buildTrainingPool>>();
  const getTrainingPool = (targetYear: number) => {
    if (!trainingPoolCache.has(targetYear)) {
      trainingPoolCache.set(targetYear, buildTrainingPool(allRecords, targetYear));
    }
    return trainingPoolCache.get(targetYear)!;
  };

  const exactFieldCounts: Record<string, { pass: number; fail: number }> = {};
  const toleranceFieldCounts: Record<string, { pass: number; fail: number }> = {};
  const mismatches: FieldMismatch[] = [];
  let rowsFullyMatched = 0;

  const bumpExact = (field: string, pass: boolean) => {
    exactFieldCounts[field] ??= { pass: 0, fail: 0 };
    exactFieldCounts[field][pass ? "pass" : "fail"]++;
  };
  const bumpTolerance = (field: string, pass: boolean) => {
    toleranceFieldCounts[field] ??= { pass: 0, fail: 0 };
    toleranceFieldCounts[field][pass ? "pass" : "fail"]++;
  };

  for (const row of rowsToCheck) {
    const { trainingPool } = getTrainingPool(row.targetYear);
    const trainingYearFrom = trainingPool.length > 0 ? Math.min(...trainingPool.map((r) => r.datasetYear)) : row.targetYear;
    const trainingYearTo = row.targetYear - 1;
    const query = buildQuery(row);

    const result = computeBaselineEstimate(row.targetYear, trainingYearFrom, trainingYearTo, trainingPool, query);

    let rowOk = true;
    const checkExact = (field: string, expected: number | string, actual: number | string) => {
      const ok = expected === actual;
      bumpExact(field, ok);
      if (!ok) {
        rowOk = false;
        mismatches.push({ row, field, expected: String(expected), actual: String(actual) });
      }
    };
    const checkTolerance = (field: string, expected: number, actual: number) => {
      const ok = Math.abs(expected - actual) <= V3_ABS_TOLERANCE || Math.abs(expected - actual) <= Math.abs(expected) * 1e-6;
      bumpTolerance(field, ok);
      if (!ok) {
        rowOk = false;
        mismatches.push({ row, field, expected: String(expected), actual: String(actual) });
      }
    };

    checkExact("estimatedBudgetKrw", row.estimatedBudget, result.estimatedBudgetKrw);
    checkExact("weightedAverageBudgetKrw", row.weightedAverage, result.weightedAverageBudgetKrw);
    checkExact("recommendedBudgetKrw", row.recommendedBudget, result.recommendedBudgetKrw);
    checkExact("p25Krw", row.p25, result.p25Krw);
    checkExact("p75Krw", row.p75, result.p75Krw);
    checkExact("sampleCount", row.sampleCount, result.sampleCount);
    checkExact("fallbackLevel", row.fallbackLevel, result.fallbackLevel);
    checkTolerance("dataQualityV3", row.dataQualityV3, result.dataQualityV3);

    if (rowOk) rowsFullyMatched++;
  }

  console.log("");
  console.log("── exact match 필드 ──────────────────────────────");
  for (const [field, c] of Object.entries(exactFieldCounts)) {
    console.log(`${c.fail === 0 ? "✅" : "❌"} ${field.padEnd(28)} pass=${c.pass} fail=${c.fail}`);
  }
  console.log("");
  console.log("── tolerance match 필드 (|Δ| <= 1e-6 절대 또는 상대) ──");
  for (const [field, c] of Object.entries(toleranceFieldCounts)) {
    console.log(`${c.fail === 0 ? "✅" : "❌"} ${field.padEnd(28)} pass=${c.pass} fail=${c.fail}`);
  }

  console.log("");
  console.log(`행 전체 일치: ${rowsFullyMatched} / ${rowsToCheck.length}`);

  if (mismatches.length > 0) {
    console.log("");
    console.log(`불일치 샘플 (최대 20건 / 전체 ${mismatches.length}건):`);
    for (const m of mismatches.slice(0, 20)) {
      console.log(
        `  [${m.row.targetYear}/${m.row.festivalName}] ${m.field}: expected=${m.expected} actual=${m.actual} ` +
          `(region=${m.row.region} district=${m.row.district} type=${m.row.festivalType} venue=${m.row.venueType} duration=${m.row.durationDays})`
      );
    }
  }

  const allExactPass = Object.values(exactFieldCounts).every((c) => c.fail === 0);
  const allTolerancePass = Object.values(toleranceFieldCounts).every((c) => c.fail === 0);
  process.exit(allExactPass && allTolerancePass ? 0 : 1);
}

main().catch((e) => {
  console.error("검증 실패:", e);
  process.exit(1);
});
